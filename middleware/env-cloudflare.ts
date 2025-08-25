import { Context, Next } from 'hono';
import type { Env } from '../types';
import { type CloudFlareBindings, initializeCloudFlareEnv } from '../env/cloudflare';

/**
 * CloudFlare Worker environment middleware
 * Initializes environment from CloudFlare bindings
 */
export async function cloudflareEnvMiddleware(
  c: Context<{ Bindings: CloudFlareBindings; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  // Skip if environment is already initialized
  if (c.var.env) {
    await next();
    return;
  }

  try {
    const env = initializeCloudFlareEnv(c.env);
    c.set('env', env);
    await next();
  } catch (error) {
    console.error('CloudFlare environment initialization failed:', error);
    return errorResponse(c, error);
  }
}

/**
 * Test environment middleware
 * For environments that already have mock providers
 */
export async function testEnvMiddleware(
  c: Context<{ Bindings: any; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  // Skip if environment is already initialized
  if (c.var.env) {
    await next();
    return;
  }

  // Check if test environment (already has providers)
  if (
    c.env &&
    typeof c.env === 'object' &&
    'storageProvider' in c.env &&
    'queueProvider' in c.env
  ) {
    console.log('Using test environment with mock providers');
    c.set('env', c.env as Env);
    await next();
    return;
  }

  // Fallback error for test environments
  const error = new Error('Test environment must provide storageProvider and queueProvider');
  console.error('Test environment initialization failed:', error);
  return errorResponse(c, error);
}

/**
 * Helper function to create error response
 */
function errorResponse(c: Context, error: unknown): void {
  c.res = new Response(
    JSON.stringify({
      error: 'initialization_error',
      message: 'Failed to initialize application environment',
      details: error instanceof Error ? error.message : 'Unknown error',
    }),
    {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
