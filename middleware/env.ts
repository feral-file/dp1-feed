import { Context, Next } from 'hono';
import type { Env } from '../types';
import {
  initializeCloudFlareEnv,
  initializeSelfHostedEnv,
  isCloudFlareBindings,
  isSelfHostedBindings,
} from '../env';

/**
 * Environment initialization middleware
 * Converts raw bindings into structured Env interface based on deployment type
 *
 * This middleware:
 * - Detects deployment environment (CloudFlare Worker vs self-hosted)
 * - Initializes appropriate providers (KV/Queue for CF, alternatives for self-hosted)
 * - Sets up environment once per request and caches it
 * - Supports different deployment scenarios without mixing concerns
 */
export async function envMiddleware(
  c: Context<{ Bindings: any; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  // Skip if environment is already initialized
  if (c.var.env) {
    await next();
    return;
  }

  try {
    // Detect environment type and initialize accordingly
    const env = detectAndInitializeEnvironment(c.env);
    c.set('env', env);

    await next();
  } catch (error) {
    console.error('Environment initialization failed:', error);

    c.res = new Response(
      JSON.stringify({
        error: 'initialization_error',
        message: 'Failed to initialize application environment',
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
}

/**
 * Detects deployment environment and initializes appropriate providers
 *
 * Detection strategy:
 * 1. If env has CloudFlare-specific bindings (KVNamespace, Queue) -> CloudFlare Worker
 * 2. If env has mock providers (storageProvider, queueProvider) -> Test environment
 * 3. If env has self-hosted config -> Self-hosted deployment
 * 4. Otherwise -> Error
 */
function detectAndInitializeEnvironment(env: any): Env {
  // Case 1: Test environment - already has mock providers
  if (env && typeof env === 'object' && 'storageProvider' in env && 'queueProvider' in env) {
    console.log('Detected test environment with mock providers');
    return env as Env;
  }

  // Case 2: CloudFlare Worker environment - has raw bindings
  if (isCloudFlareBindings(env)) {
    console.log('Detected CloudFlare Worker environment');
    return initializeCloudFlareEnv(env);
  }

  // Case 3: Self-hosted environment - has self-hosted configuration
  if (isSelfHostedBindings(env)) {
    console.log('Detected self-hosted environment');
    return initializeSelfHostedEnv(env);
  }

  // Case 4: Unknown environment
  throw new Error(
    'Unable to detect environment type. Expected CloudFlare bindings, test providers, or self-hosted configuration.'
  );
}
