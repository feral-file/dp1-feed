import type { Env } from '../types';
import { SqliteStorageProvider } from '../storage/sqlite-kv';
import { SqliteQueueProvider } from '../queue/sqlite-queue';

/**
 * SQLite environment bindings interface
 * Minimal configuration for single-process deployment
 */
export interface SqliteBindings {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;

  // JWT configuration for user authentication (optional)
  JWT_PUBLIC_KEY?: string;
  JWT_JWKS_URL?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;

  // SQLite configuration
  SQLITE_DB_PATH: string; // Path to database file (or ':memory:')

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string;
}

/**
 * Shared state for SQLite providers (reused across requests)
 */
let storageProvider: SqliteStorageProvider | null = null;
let queueProvider: SqliteQueueProvider | null = null;

/**
 * Initialize environment from SQLite bindings
 * Creates providers on first call, reuses them on subsequent calls
 */
export function initializeSqliteEnv(bindings: SqliteBindings): Env {
  if (!bindings.SQLITE_DB_PATH) {
    throw new Error('Missing required SQLite configuration: SQLITE_DB_PATH');
  }

  // Create providers once (singleton pattern for single-process deployment)
  if (!storageProvider) {
    storageProvider = new SqliteStorageProvider({ dbPath: bindings.SQLITE_DB_PATH });
    console.log(`SQLite storage initialized: ${bindings.SQLITE_DB_PATH}`);
  }

  if (!queueProvider) {
    queueProvider = new SqliteQueueProvider(storageProvider.getDatabase());
    console.log('SQLite queue initialized');
  }

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    JWT_PUBLIC_KEY: bindings.JWT_PUBLIC_KEY,
    JWT_JWKS_URL: bindings.JWT_JWKS_URL,
    JWT_ISSUER: bindings.JWT_ISSUER,
    JWT_AUDIENCE: bindings.JWT_AUDIENCE,
    storageProvider,
    queueProvider,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}

/**
 * Get the queue provider (for starting/stopping the processor)
 */
export function getSqliteQueueProvider(): SqliteQueueProvider | null {
  return queueProvider;
}

/**
 * Close all SQLite connections (for graceful shutdown)
 */
export function closeSqliteConnections(): void {
  if (queueProvider) {
    queueProvider.stopProcessing();
    queueProvider = null;
  }
  if (storageProvider) {
    storageProvider.close();
    storageProvider = null;
  }
  console.log('SQLite connections closed');
}
