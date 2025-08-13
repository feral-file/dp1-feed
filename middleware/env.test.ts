import { describe, it, expect, vi, beforeEach } from 'vitest';
import { envMiddleware } from './env';
import { createTestEnv } from '../test-helpers';
import * as envModule from '../env';

// Mock the env module functions
vi.mock('../env', () => ({
  initializeCloudFlareEnv: vi.fn(),
  initializeSelfHostedEnv: vi.fn(),
  isCloudFlareBindings: vi.fn(),
  isSelfHostedBindings: vi.fn(),
}));

describe('envMiddleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock context with proper structure
    mockContext = {
      var: { env: undefined },
      env: {},
      set: vi.fn(),
      req: {
        method: 'GET',
        header: vi.fn(),
      },
      res: undefined,
    };

    // Create mock next function
    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  describe('when environment is already initialized', () => {
    it('should skip initialization and call next', async () => {
      // Arrange
      const existingEnv = createTestEnv().env;
      mockContext.var.env = existingEnv;

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.set).not.toHaveBeenCalled();
    });
  });

  describe('test environment detection', () => {
    it('should detect test environment with mock providers', async () => {
      // Arrange
      const testEnv = createTestEnv();
      mockContext.env = testEnv.env;

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockContext.set).toHaveBeenCalledWith('env', testEnv.env);
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('should handle test environment with additional options', async () => {
      // Arrange
      const testEnv = createTestEnv({ selfHostedDomains: 'example.com,test.com' });
      mockContext.env = testEnv.env;

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockContext.set).toHaveBeenCalledWith('env', testEnv.env);
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('CloudFlare environment detection', () => {
    it('should detect and initialize CloudFlare environment', async () => {
      // Arrange
      const mockCloudFlareEnv = createTestEnv().env;
      const mockBindings = {
        DP1_PLAYLISTS: {},
        DP1_PLAYLIST_GROUPS: {},
        DP1_PLAYLIST_ITEMS: {},
        DP1_WRITE_QUEUE: {},
        API_SECRET: 'cf-secret',
        ED25519_PRIVATE_KEY: 'cf-key',
      };

      mockContext.env = mockBindings;

      vi.mocked(envModule.isCloudFlareBindings).mockReturnValue(true);
      vi.mocked(envModule.initializeCloudFlareEnv).mockReturnValue(mockCloudFlareEnv);

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(envModule.isCloudFlareBindings).toHaveBeenCalledWith(mockBindings);
      expect(envModule.initializeCloudFlareEnv).toHaveBeenCalledWith(mockBindings);
      expect(mockContext.set).toHaveBeenCalledWith('env', mockCloudFlareEnv);
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('self-hosted environment detection', () => {
    it('should detect and initialize self-hosted environment', async () => {
      // Arrange
      const mockSelfHostedEnv = createTestEnv().env;
      const mockBindings = {
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'dp1-stream',
        NATS_SUBJECT: 'dp1.>',
        API_SECRET: 'self-hosted-secret',
        ED25519_PRIVATE_KEY: 'self-hosted-key',
      };

      mockContext.env = mockBindings;

      vi.mocked(envModule.isCloudFlareBindings).mockReturnValue(false);
      vi.mocked(envModule.isSelfHostedBindings).mockReturnValue(true);
      vi.mocked(envModule.initializeSelfHostedEnv).mockReturnValue(mockSelfHostedEnv);

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(envModule.isCloudFlareBindings).toHaveBeenCalledWith(mockBindings);
      expect(envModule.isSelfHostedBindings).toHaveBeenCalledWith(mockBindings);
      expect(envModule.initializeSelfHostedEnv).toHaveBeenCalledWith(mockBindings);
      expect(mockContext.set).toHaveBeenCalledWith('env', mockSelfHostedEnv);
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('unknown environment detection', () => {
    it('should return 500 error for unknown environment', async () => {
      // Arrange
      const mockBindings = {
        UNKNOWN_BINDING: 'value',
      };

      mockContext.env = mockBindings;
      mockContext.res = undefined;

      vi.mocked(envModule.isCloudFlareBindings).mockReturnValue(false);
      vi.mocked(envModule.isSelfHostedBindings).mockReturnValue(false);

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(500);

      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'initialization_error',
        message: 'Failed to initialize application environment',
      });
    });
  });

  describe('environment initialization errors', () => {
    it('should handle initialization errors gracefully', async () => {
      // Arrange
      const mockBindings = {
        DP1_PLAYLISTS: {},
        DP1_PLAYLIST_GROUPS: {},
        DP1_PLAYLIST_ITEMS: {},
        DP1_WRITE_QUEUE: {},
        API_SECRET: 'cf-secret',
        ED25519_PRIVATE_KEY: 'cf-key',
      };

      mockContext.env = mockBindings;
      mockContext.res = undefined;

      vi.mocked(envModule.isCloudFlareBindings).mockReturnValue(true);
      vi.mocked(envModule.initializeCloudFlareEnv).mockImplementation(() => {
        throw new Error('KV initialization failed');
      });

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(500);

      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'initialization_error',
        message: 'Failed to initialize application environment',
      });
    });

    it('should handle missing environment object', async () => {
      // Arrange
      mockContext.env = undefined;
      mockContext.res = undefined;

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(500);
    });
  });

  describe('environment caching', () => {
    it('should not reinitialize environment on subsequent calls', async () => {
      // Arrange
      const testEnv = createTestEnv().env;
      mockContext.env = testEnv;

      // Act - First call
      await envMiddleware(mockContext, mockNext);

      // Reset mocks to verify second call behavior
      vi.clearAllMocks();
      mockNext.mockClear();
      mockContext.set.mockClear();

      // Set the environment as already initialized for the second call
      mockContext.var.env = testEnv;

      // Act - Second call
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockContext.set).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('environment type detection edge cases', () => {
    it('should handle empty environment object', async () => {
      // Arrange
      mockContext.env = {};
      mockContext.res = undefined;

      vi.mocked(envModule.isCloudFlareBindings).mockReturnValue(false);
      vi.mocked(envModule.isSelfHostedBindings).mockReturnValue(false);

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(500);
    });

    it('should handle null environment', async () => {
      // Arrange
      mockContext.env = null;
      mockContext.res = undefined;

      // Act
      await envMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(500);
    });
  });
});
