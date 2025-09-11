import { Context, Next } from 'hono';
import * as jose from 'jose';
import type { Env, JwtPayload } from '../types';

/**
 * Verify JWT token using configured public key or JWKS
 */
async function verifyJWT(
  token: string,
  env: Env
): Promise<{ isValid: boolean; payload?: JwtPayload; error?: string }> {
  try {
    // Check if JWT configuration is available
    if (!env.JWT_PUBLIC_KEY && !env.JWT_JWKS_URL) {
      return { isValid: false, error: 'JWT authentication not configured' };
    }

    // Prepare verification options - only add issuer/audience if they are non-empty
    const verifyOptions: jose.JWTVerifyOptions = {};
    if (env.JWT_ISSUER && env.JWT_ISSUER.trim() !== '') {
      verifyOptions.issuer = env.JWT_ISSUER;
    }
    if (env.JWT_AUDIENCE && env.JWT_AUDIENCE.trim() !== '') {
      verifyOptions.audience = env.JWT_AUDIENCE;
    }

    if (env.JWT_JWKS_URL) {
      // Use JWKS endpoint to fetch keys
      const JWKS = jose.createRemoteJWKSet(new URL(env.JWT_JWKS_URL));
      const { payload } = await jose.jwtVerify(token, JWKS, verifyOptions);
      return { isValid: true, payload };
    } else if (env.JWT_PUBLIC_KEY) {
      // Use PEM format public key with Web Crypto API + JWK conversion for Cloudflare Workers compatibility
      try {
        // Convert PEM to ArrayBuffer for Web Crypto API
        const pemHeader = '-----BEGIN PUBLIC KEY-----';
        const pemFooter = '-----END PUBLIC KEY-----';
        const pemContents = env.JWT_PUBLIC_KEY.replace(pemHeader, '')
          .replace(pemFooter, '')
          .replace(/\s/g, '');

        // Decode base64 to ArrayBuffer
        const binaryDer = atob(pemContents);
        const keyData = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
          keyData[i] = binaryDer.charCodeAt(i);
        }

        // Import using Web Crypto API directly
        const publicKey = await crypto.subtle.importKey(
          'spki',
          keyData,
          {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256',
          },
          true,
          ['verify']
        );

        // Convert to JWK format for jose library compatibility
        const jwk = await crypto.subtle.exportKey('jwk', publicKey);
        const { payload } = await jose.jwtVerify(token, jwk, verifyOptions);
        return { isValid: true, payload };
      } catch (error) {
        console.error('Error verifying JWT with Web Crypto API:', error);
        const publicKey = await jose.importSPKI(env.JWT_PUBLIC_KEY, 'RS256');
        const { payload } = await jose.jwtVerify(token, publicKey, verifyOptions);
        return { isValid: true, payload };
      }
    }

    return { isValid: false, error: 'No JWT verification method configured' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown JWT verification error';
    return { isValid: false, error: errorMessage };
  }
}

/**
 * Authentication middleware for Hono
 * Checks Bearer token for write operations (POST, PUT, PATCH, DELETE)
 * Supports both API key and JWT authentication
 */
export async function authMiddleware(
  c: Context<{
    Bindings: any;
    Variables: { env: Env; authType?: string; jwtPayload?: JwtPayload };
  }>,
  next: Next
): Promise<void> {
  const method = c.req.method;

  // Only require authentication for write operations
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await next();
    return;
  }

  const authorization = c.req.header('Authorization');

  if (!authorization) {
    c.res = new Response(
      JSON.stringify({
        error: 'unauthorized',
        message: 'Authorization header is required for write operations',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return;
  }

  const token = authorization.replace(/^Bearer\s+/, '');
  const expectedSecret = c.var.env.API_SECRET;

  // First, try API key authentication
  if (expectedSecret && token === expectedSecret) {
    // API key authentication successful
    c.set('authType', 'api_key');
    await next();
    return;
  }

  // If API key doesn't match, try JWT authentication
  const jwtResult = await verifyJWT(token, c.var.env);

  if (jwtResult.isValid) {
    // JWT authentication successful
    c.set('authType', 'jwt');
    c.set('jwtPayload', jwtResult.payload);
    await next();
    return;
  }

  // Both authentication methods failed
  console.error('Authentication failed:', jwtResult.error || 'Invalid API key');

  const errorMessage = expectedSecret ? 'Invalid credentials' : 'Authentication not configured';

  c.res = new Response(
    JSON.stringify({
      error: 'unauthorized',
      message: errorMessage,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
  return;
}

/**
 * CORS middleware for handling cross-origin requests
 */
export async function corsMiddleware(c: Context, next: Next): Promise<void> {
  // Handle preflight requests
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '86400');
    c.res = new Response(null, { status: 204 });
    return;
  }

  await next();

  // Add CORS headers to all responses
  c.header('Access-Control-Allow-Origin', '*'); // TODO: restrict to specific origins
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

/**
 * Error handling middleware
 */
export async function errorMiddleware(c: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (error) {
    console.error('Unhandled error:', error);

    // Check if response has already been sent
    if (c.finalized) {
      return;
    }

    c.json(
      {
        error: 'internal_error',
        message: 'An unexpected error occurred',
      },
      500
    );
    return;
  }
}

/**
 * Request logging middleware
 */
export async function loggingMiddleware(c: Context, next: Next): Promise<void> {
  const start = globalThis.performance.now();
  const method = c.req.method;
  const path = c.req.path;
  const userAgent = c.req.header('User-Agent') || 'unknown';
  const requestId = crypto.randomUUID();
  const clientIP =
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For') ||
    c.req.header('X-Real-IP') ||
    'unknown';

  // Add request ID to context for tracing
  c.set('requestId', requestId);

  // Log request start
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      type: 'request_start',
      requestId,
      method,
      path,
      clientIP,
      userAgent,
    })
  );

  try {
    await next();
  } catch (error) {
    const duration = globalThis.performance.now() - start;
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        type: 'request_error',
        requestId,
        method,
        path,
        clientIP,
        duration: duration.toFixed(2),
        error: error instanceof Error ? error.message : String(error),
      })
    );
    throw error;
  }

  const duration = globalThis.performance.now() - start;
  const status = c.res.status;
  const contentLength = c.res.headers.get('Content-Length') || '0';

  // Enhanced logging with performance metrics
  const logLevel = status >= 400 ? 'error' : 'info';
  const logMessage = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: logLevel,
    type: 'request_complete',
    requestId,
    method,
    path,
    clientIP,
    status,
    duration: duration.toFixed(2),
    contentLength,
  });

  if (logLevel === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }

  // Add performance headers for client-side monitoring
  c.header('X-Response-Time', `${duration.toFixed(2)}ms`);
  c.header('X-Request-ID', requestId);
}

/**
 * Content-Type validation middleware for JSON endpoints
 */
export async function validateJsonMiddleware(c: Context, next: Next): Promise<void> {
  const method = c.req.method;

  // Only validate JSON for write operations
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    await next();
    return;
  }

  const contentType = c.req.header('Content-Type');

  if (!contentType || !contentType.includes('application/json')) {
    c.json(
      {
        error: 'invalid_content_type',
        message: 'Content-Type must be application/json',
      },
      400
    );
    return;
  }

  await next();
}
