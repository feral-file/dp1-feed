import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteEnvMiddleware } from './env-sqlite';
import type { Env } from '../types';
import type { SqliteBindings } from '../env/sqlite';

// Mock the env initialization
vi.mock('../env/sqlite', () => ({
  initializeSqliteEnv: vi.fn(),
}));

describe('sqliteEnvMiddleware', () => {
  let mockContext: any;
  let mockNext: any;
  let mockInitializeSqliteEnv: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue(undefined);

    // Get the mocked function from the module
    const { initializeSqliteEnv } = await import('../env/sqlite');
    mockInitializeSqliteEnv = initializeSqliteEnv as any;

    // Default mock implementation
    mockInitializeSqliteEnv.mockImplementation(() => {
      return {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        ENVIRONMENT: 'test',
        storageProvider: {} as any,
        queueProvider: {} as any,
      };
    });

    // Create mock context
    mockContext = {
      var: {},
      env: {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        SQLITE_DB_PATH: ':memory:',
        ENVIRONMENT: 'test',
      },
      set: vi.fn((key: string, value: any) => {
        mockContext.var[key] = value;
      }),
      res: undefined,
    };
  });

  it('should initialize environment and call next when env is not set', async () => {
    const mockEnv: Env = {
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-private-key',
      ENVIRONMENT: 'test',
      storageProvider: {} as any,
      queueProvider: {} as any,
    };

    mockInitializeSqliteEnv.mockReturnValue(mockEnv);

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSqliteEnv).toHaveBeenCalledWith(mockContext.env);
    expect(mockContext.set).toHaveBeenCalledWith('env', mockEnv);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should skip initialization and call next when env is already set', async () => {
    const existingEnv: Env = {
      API_SECRET: 'existing-secret',
      ED25519_PRIVATE_KEY: 'existing-private-key',
      ENVIRONMENT: 'existing',
      storageProvider: {} as any,
      queueProvider: {} as any,
    };

    mockContext.var.env = existingEnv;

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSqliteEnv).not.toHaveBeenCalled();
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle initialization errors and return error response', async () => {
    const error = new Error('SQLite initialization failed');
    mockInitializeSqliteEnv.mockImplementation(() => {
      throw error;
    });

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSqliteEnv).toHaveBeenCalledWith(mockContext.env);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody).toEqual({
      error: 'initialization_error',
      message: 'Failed to initialize SQLite environment',
      details: 'SQLite initialization failed',
    });
  });

  it('should handle unknown errors gracefully', async () => {
    mockInitializeSqliteEnv.mockImplementation(() => {
      throw 'String error';
    });

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Unknown error');
  });

  it('should handle missing SQLITE_DB_PATH error', async () => {
    const error = new Error('Missing required SQLite configuration: SQLITE_DB_PATH');
    mockInitializeSqliteEnv.mockImplementation(() => {
      throw error;
    });

    mockContext.env = {
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-key',
      // Missing SQLITE_DB_PATH
    };

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Missing required SQLite configuration: SQLITE_DB_PATH');
  });

  it('should handle empty environment object', async () => {
    const error = new Error('Empty environment configuration');
    mockInitializeSqliteEnv.mockImplementation(() => {
      throw error;
    });

    mockContext.env = {};

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Empty environment configuration');
  });

  it('should set Content-Type header on error response', async () => {
    mockInitializeSqliteEnv.mockImplementation(() => {
      throw new Error('Test error');
    });

    await sqliteEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res.headers.get('Content-Type')).toBe('application/json');
  });
});
