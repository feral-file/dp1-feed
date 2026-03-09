import { Context, Next } from 'hono';
import type { Env } from '../types';
import { type SqliteBindings, initializeSqliteEnv } from '../env/sqlite';

/**
 * SQLite environment middleware
 * Initializes environment from SQLite bindings (synchronous, no external connections)
 */
export async function sqliteEnvMiddleware(
  c: Context<{ Bindings: SqliteBindings; Variables: { env: Env } }>,
  next: Next
): Promise<void> {
  // Skip if environment is already initialized
  if (c.var.env) {
    await next();
    return;
  }

  try {
    const env = initializeSqliteEnv(c.env);
    c.set('env', env);
    await next();
  } catch (error) {
    console.error('SQLite environment initialization failed:', error);
    c.res = new Response(
      JSON.stringify({
        error: 'initialization_error',
        message: 'Failed to initialize SQLite environment',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
