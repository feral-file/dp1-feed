import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Context } from 'hono';
import { cloudflareEnvMiddleware, testEnvMiddleware } from './env-cloudflare';
import type { Env } from '../types';
import type { CloudFlareBindings } from '../env/cloudflare';

// Mock the env initialization
vi.mock('../env/cloudflare', () => ({
  initializeCloudFlareEnv: vi.fn(),
}));

describe('cloudflareEnvMiddleware', () => {
  let mockContext: any;
  let mockNext: any;
  let mockInitializeCloudFlareEnv: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue(undefined);

    // Get the mocked function from the module
    const { initializeCloudFlareEnv } = await import('../env/cloudflare');
    mockInitializeCloudFlareEnv = initializeCloudFlareEnv as any;

    // Mock the env module - since the actual module doesn't exist in tests
    mockInitializeCloudFlareEnv.mockImplementation(() => {
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
        ENVIRONMENT: 'test',
        PLAYLIST_KV: {} as any,
        PLAYLIST_GROUP_KV: {} as any,
        PLAYLIST_ITEM_KV: {} as any,
        DP1_WRITE_QUEUE: {} as any,
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

    mockInitializeCloudFlareEnv.mockReturnValue(mockEnv);

    await cloudflareEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeCloudFlareEnv).toHaveBeenCalledWith(mockContext.env);
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

    await cloudflareEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeCloudFlareEnv).not.toHaveBeenCalled();
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle initialization errors and return error response', async () => {
    const error = new Error('Initialization failed');
    mockInitializeCloudFlareEnv.mockImplementation(() => {
      throw error;
    });

    await cloudflareEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeCloudFlareEnv).toHaveBeenCalledWith(mockContext.env);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody).toEqual({
      error: 'initialization_error',
      message: 'Failed to initialize application environment',
      details: 'Initialization failed',
    });
  });

  it('should handle unknown errors gracefully', async () => {
    const error = 'String error';
    mockInitializeCloudFlareEnv.mockImplementation(() => {
      throw error;
    });

    await cloudflareEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Unknown error');
  });
});

describe('testEnvMiddleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn().mockResolvedValue(undefined);

    // Create mock context
    mockContext = {
      var: {},
      env: {},
      set: vi.fn((key: string, value: any) => {
        mockContext.var[key] = value;
      }),
      res: undefined,
    };
  });

  it('should use test environment with mock providers', async () => {
    const mockEnv: Env = {
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-private-key',
      ENVIRONMENT: 'test',
      storageProvider: {} as any,
      queueProvider: {} as any,
    };

    mockContext.env = mockEnv;

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('env', mockEnv);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should skip initialization when env is already set', async () => {
    const existingEnv: Env = {
      API_SECRET: 'existing-secret',
      ED25519_PRIVATE_KEY: 'existing-private-key',
      ENVIRONMENT: 'existing',
      storageProvider: {} as any,
      queueProvider: {} as any,
    };

    mockContext.var.env = existingEnv;

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should return error when test environment is missing providers', async () => {
    // Mock console.log to avoid noise in tests
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockContext.env = {
      API_SECRET: 'test-secret',
      // Missing storageProvider and queueProvider
    };

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody).toEqual({
      error: 'initialization_error',
      message: 'Failed to initialize application environment',
      details: 'Test environment must provide storageProvider and queueProvider',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Test environment initialization failed:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should return error when env is not an object', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockContext.env = 'not-an-object';

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe(
      'Test environment must provide storageProvider and queueProvider'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Test environment initialization failed:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should return error when env is null', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockContext.env = null;

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe(
      'Test environment must provide storageProvider and queueProvider'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Test environment initialization failed:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should return error when env is undefined', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockContext.env = undefined;

    await testEnvMiddleware(mockContext as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe(
      'Test environment must provide storageProvider and queueProvider'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Test environment initialization failed:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
