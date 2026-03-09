import { serve } from '@hono/node-server';
import {
  type SqliteBindings,
  initializeSqliteEnv,
  getSqliteQueueProvider,
  closeSqliteConnections,
} from './env/sqlite';
import { sqliteEnvMiddleware } from './middleware/env-sqlite';
import { createApp } from './app';

/**
 * Node.js server for the DP-1 Feed Operator API with SQLite storage
 *
 * Single-process deployment: no etcd, no NATS, no separate consumer.
 * Everything runs in one process with SQLite for both storage and queuing.
 */

const app = createApp<SqliteBindings>(sqliteEnvMiddleware);

async function startServer() {
  const port = parseInt(process.env.PORT || '8787');
  const host = process.env.HOST || '0.0.0.0';
  const dbPath = process.env.SQLITE_DB_PATH || './data/dp1-feed.db';

  console.log('Starting DP-1 Feed Operator API Server (SQLite)...');
  console.log(`Server will listen on ${host}:${port}`);

  const bindings: SqliteBindings = {
    API_SECRET: process.env.API_SECRET || '',
    ED25519_PRIVATE_KEY: process.env.ED25519_PRIVATE_KEY || '',

    JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
    JWT_JWKS_URL: process.env.JWT_JWKS_URL,
    JWT_ISSUER: process.env.JWT_ISSUER,
    JWT_AUDIENCE: process.env.JWT_AUDIENCE,

    SQLITE_DB_PATH: dbPath,

    ENVIRONMENT: process.env.ENVIRONMENT || 'sqlite',
    SELF_HOSTED_DOMAINS: process.env.SELF_HOSTED_DOMAINS,
  };

  if (!bindings.API_SECRET) {
    console.error('Missing required environment variable: API_SECRET');
    process.exit(1);
  }

  if (!bindings.ED25519_PRIVATE_KEY) {
    console.error('Missing required environment variable: ED25519_PRIVATE_KEY');
    process.exit(1);
  }

  try {
    // Initialize SQLite environment (creates DB and tables)
    console.log('Initializing SQLite storage and queue...');
    initializeSqliteEnv(bindings);
    console.log(`Storage: SQLite at ${dbPath}`);

    const nodeApp = {
      fetch: (request: Request) => {
        return app.fetch(request, bindings);
      },
    };

    serve({
      fetch: nodeApp.fetch,
      port,
      hostname: host,
    });

    console.log(`DP-1 Feed Operator API Server running on http://${host}:${port}`);
    console.log(`API documentation: http://${host}:${port}/api/v1`);
    console.log(`Health check: http://${host}:${port}/api/v1/health`);

    // Start the in-process queue processor after server is listening
    const queueProvider = getSqliteQueueProvider();
    if (queueProvider) {
      const serverUrl = `http://localhost:${port}`;
      queueProvider.startProcessing(serverUrl, bindings.API_SECRET);
      console.log('Queue processor: in-process (SQLite-backed)');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  const gracefulShutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    closeSqliteConnections();
    globalThis.setTimeout(() => {
      console.log('Server shut down complete');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupGracefulShutdown();
  startServer().catch(error => {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  });
}

export { app };
