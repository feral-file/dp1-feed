import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Context } from 'hono';
import { selfHostedEnvMiddleware } from './env-selfhosted';
import type { Env } from '../types';
import type { SelfHostedBindings } from '../env/selfhosted';

// Mock the env initialization
vi.mock('../env/selfhosted', () => ({
  initializeSelfHostedEnv: vi.fn(),
}));

describe('selfHostedEnvMiddleware', () => {
  let mockContext: any;
  let mockNext: any;
  let mockInitializeSelfHostedEnv: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue(undefined);

    // Get the mocked function from the module
    const { initializeSelfHostedEnv } = await import('../env/selfhosted');
    mockInitializeSelfHostedEnv = initializeSelfHostedEnv as any;

    // Mock the env module - since the actual module doesn't exist in tests
    mockInitializeSelfHostedEnv.mockImplementation(() => {
      return Promise.resolve({
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        ENVIRONMENT: 'test',
        storageProvider: {} as any,
        queueProvider: {} as any,
      });
    });

    // Create mock context
    mockContext = {
      var: {},
      env: {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        ENVIRONMENT: 'test',
        ETCD_ENDPOINT: 'http://localhost:2379',
        NATS_ENDPOINT: 'nats://localhost:4222',
        NATS_STREAM: 'DP1_WRITE_OPERATIONS',
        NATS_SUBJECT: 'dp1.write.operations',
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

    mockInitializeSelfHostedEnv.mockResolvedValue(mockEnv);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSelfHostedEnv).toHaveBeenCalledWith(mockContext.env);
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

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSelfHostedEnv).not.toHaveBeenCalled();
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle initialization errors and return error response', async () => {
    const error = new Error('Initialization failed');
    mockInitializeSelfHostedEnv.mockRejectedValue(error);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSelfHostedEnv).toHaveBeenCalledWith(mockContext.env);
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
    mockInitializeSelfHostedEnv.mockRejectedValue(error);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Unknown error');
  });

  it('should handle async initialization errors', async () => {
    const error = new Error('Async initialization failed');
    mockInitializeSelfHostedEnv.mockImplementation(() => {
      return Promise.reject(error);
    });

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockInitializeSelfHostedEnv).toHaveBeenCalledWith(mockContext.env);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Async initialization failed');
  });

  it('should handle network errors during initialization', async () => {
    const error = new Error('Network timeout');
    mockInitializeSelfHostedEnv.mockRejectedValue(error);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Network timeout');
  });

  it('should handle missing environment variables gracefully', async () => {
    // Test with minimal env
    mockContext.env = {
      API_SECRET: 'test-secret',
      // Missing other required variables
    };

    const error = new Error('Missing required environment variables');
    mockInitializeSelfHostedEnv.mockRejectedValue(error);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Missing required environment variables');
  });

  it('should handle empty environment object', async () => {
    mockContext.env = {};

    const error = new Error('Empty environment configuration');
    mockInitializeSelfHostedEnv.mockRejectedValue(error);

    await selfHostedEnvMiddleware(mockContext as any, mockNext);

    expect(mockContext.res).toBeDefined();
    expect(mockContext.res.status).toBe(500);

    const responseText = await mockContext.res.text();
    const responseBody = JSON.parse(responseText);
    expect(responseBody.details).toBe('Empty environment configuration');
  });
});
