import { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Authentication middleware for Hono
 * Checks Bearer token for write operations (POST, PUT, PATCH, DELETE)
 */
export async function authMiddleware(
  c: Context<{ Bindings: any; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  const method = c.req.method;

  // Only require authentication for write operations
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await next();
    return;
  }

  // Skip auth for registry webhook (uses HMAC verification via X-Signature header)
  if (c.req.path.includes('/registry-webhook')) {
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

  if (!expectedSecret) {
    console.error('API_SECRET not configured');
    c.res = new Response(
      JSON.stringify({
        error: 'server_error',
        message: 'Server configuration error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return;
  }

  if (token !== expectedSecret) {
    c.res = new Response(
      JSON.stringify({
        error: 'unauthorized',
        message: 'Invalid API key',
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

  // Authentication successful, continue to next middleware/handler
  await next();
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
