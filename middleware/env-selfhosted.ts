import { Context, Next } from 'hono';
import type { Env } from '../types';
import { type SelfHostedBindings, initializeSelfHostedEnv } from '../env/selfhosted';

/**
 * Self-hosted Node.js environment middleware
 * Initializes environment from self-hosted bindings
 */
export async function selfHostedEnvMiddleware(
  c: Context<{ Bindings: SelfHostedBindings; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  // Skip if environment is already initialized
  if (c.var.env) {
    await next();
    return;
  }

  try {
    const env = await initializeSelfHostedEnv(c.env);
    c.set('env', env);
    await next();
  } catch (error) {
    console.error('Self-hosted environment initialization failed:', error);
    return errorResponse(c, error);
  }
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
