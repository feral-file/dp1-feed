import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock better-sqlite3 before importing the module under test
vi.mock('better-sqlite3', () => {
  const mockDb = {
    pragma: vi.fn().mockReturnValue([]),
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }),
    close: vi.fn(),
  };

  return {
    default: vi.fn(() => mockDb),
  };
});

// Import after mocking
import {
  initializeSqliteEnv,
  getSqliteQueueProvider,
  closeSqliteConnections,
  type SqliteBindings,
} from './sqlite';

describe('initializeSqliteEnv', () => {
  let mockBindings: SqliteBindings;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the module-level singleton state by closing any existing connections
    closeSqliteConnections();

    mockBindings = {
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-private-key',
      SQLITE_DB_PATH: ':memory:',
      ENVIRONMENT: 'test',
    };
  });

  afterEach(() => {
    closeSqliteConnections();
    vi.restoreAllMocks();
  });

  it('should initialize environment with valid bindings', () => {
    const env = initializeSqliteEnv(mockBindings);

    expect(env).toBeDefined();
    expect(env.API_SECRET).toBe('test-secret');
    expect(env.ED25519_PRIVATE_KEY).toBe('test-private-key');
    expect(env.storageProvider).toBeDefined();
    expect(env.queueProvider).toBeDefined();
  });

  it('should throw error when SQLITE_DB_PATH is missing', () => {
    const invalidBindings = {
      ...mockBindings,
      SQLITE_DB_PATH: '',
    };

    expect(() => initializeSqliteEnv(invalidBindings)).toThrow(
      'Missing required SQLite configuration: SQLITE_DB_PATH'
    );
  });

  it('should pass through JWT configuration', () => {
    const bindingsWithJwt: SqliteBindings = {
      ...mockBindings,
      JWT_PUBLIC_KEY: 'test-public-key',
      JWT_JWKS_URL: 'https://example.com/.well-known/jwks.json',
      JWT_ISSUER: 'https://example.com',
      JWT_AUDIENCE: 'test-audience',
    };

    const env = initializeSqliteEnv(bindingsWithJwt);

    expect(env.JWT_PUBLIC_KEY).toBe('test-public-key');
    expect(env.JWT_JWKS_URL).toBe('https://example.com/.well-known/jwks.json');
    expect(env.JWT_ISSUER).toBe('https://example.com');
    expect(env.JWT_AUDIENCE).toBe('test-audience');
  });

  it('should pass through optional environment variables', () => {
    const bindingsWithOptional: SqliteBindings = {
      ...mockBindings,
      ENVIRONMENT: 'production',
      SELF_HOSTED_DOMAINS: 'example.com,test.com',
    };

    const env = initializeSqliteEnv(bindingsWithOptional);

    expect(env.ENVIRONMENT).toBe('production');
    expect(env.SELF_HOSTED_DOMAINS).toBe('example.com,test.com');
  });

  it('should reuse providers on subsequent calls (singleton pattern)', () => {
    const env1 = initializeSqliteEnv(mockBindings);
    const env2 = initializeSqliteEnv(mockBindings);

    expect(env1.storageProvider).toBe(env2.storageProvider);
    expect(env1.queueProvider).toBe(env2.queueProvider);
  });
});

describe('getSqliteQueueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeSqliteConnections();
  });

  afterEach(() => {
    closeSqliteConnections();
    vi.restoreAllMocks();
  });

  it('should return null when not initialized', () => {
    const result = getSqliteQueueProvider();
    expect(result).toBeNull();
  });

  it('should return the queue provider after initialization', () => {
    initializeSqliteEnv({
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-key',
      SQLITE_DB_PATH: ':memory:',
    });

    const result = getSqliteQueueProvider();
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });
});

describe('closeSqliteConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeSqliteConnections();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should close connections and reset providers', () => {
    initializeSqliteEnv({
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-key',
      SQLITE_DB_PATH: ':memory:',
    });

    expect(getSqliteQueueProvider()).not.toBeNull();

    closeSqliteConnections();

    expect(getSqliteQueueProvider()).toBeNull();
  });

  it('should handle closing when not initialized', () => {
    // Should not throw
    expect(() => closeSqliteConnections()).not.toThrow();
  });

  it('should allow re-initialization after closing', () => {
    const bindings: SqliteBindings = {
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-key',
      SQLITE_DB_PATH: ':memory:',
    };

    initializeSqliteEnv(bindings);
    closeSqliteConnections();

    // Should be able to initialize again
    const env = initializeSqliteEnv(bindings);
    expect(env.storageProvider).toBeDefined();
    expect(env.queueProvider).toBeDefined();
  });
});
