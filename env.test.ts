import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeCloudFlareEnv,
  initializeSelfHostedEnv,
  isCloudFlareBindings,
  isSelfHostedBindings,
  type CloudFlareBindings,
  type SelfHostedBindings,
} from './env';
import { CloudFlareStorageProvider } from './storage/cloudflare-kv';
import { CloudFlareQueueProvider } from './queue/cloudflare-queue';

// Mock the storage and queue providers
vi.mock('./storage/cloudflare-kv');
vi.mock('./queue/cloudflare-queue');

describe('env.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeCloudFlareEnv', () => {
    it('should successfully initialize environment with valid CloudFlare bindings', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      };

      const bindings: CloudFlareBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_PLAYLISTS: mockKVNamespace as any,
        DP1_PLAYLIST_GROUPS: mockKVNamespace as any,
        DP1_PLAYLIST_ITEMS: mockKVNamespace as any,
        DP1_WRITE_QUEUE: mockQueue as any,
        ENVIRONMENT: 'test',
        SELF_HOSTED_DOMAINS: 'example.com,test.com',
      };

      // Act
      const result = initializeCloudFlareEnv(bindings);

      // Assert
      expect(result).toEqual({
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        storageProvider: expect.any(CloudFlareStorageProvider),
        queueProvider: expect.any(CloudFlareQueueProvider),
        ENVIRONMENT: 'test',
        SELF_HOSTED_DOMAINS: 'example.com,test.com',
      });

      expect(CloudFlareStorageProvider).toHaveBeenCalledWith(
        mockKVNamespace,
        mockKVNamespace,
        mockKVNamespace
      );
      expect(CloudFlareQueueProvider).toHaveBeenCalledWith(mockQueue);
    });

    it('should initialize environment with minimal required bindings', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      };

      const bindings: CloudFlareBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_PLAYLISTS: mockKVNamespace as any,
        DP1_PLAYLIST_GROUPS: mockKVNamespace as any,
        DP1_PLAYLIST_ITEMS: mockKVNamespace as any,
        DP1_WRITE_QUEUE: mockQueue as any,
      };

      // Act
      const result = initializeCloudFlareEnv(bindings);

      // Assert
      expect(result.API_SECRET).toBe('test-api-secret');
      expect(result.ED25519_PRIVATE_KEY).toBe('test-private-key');
      expect(result.storageProvider).toBeInstanceOf(CloudFlareStorageProvider);
      expect(result.queueProvider).toBeInstanceOf(CloudFlareQueueProvider);
      expect(result.ENVIRONMENT).toBeUndefined();
      expect(result.SELF_HOSTED_DOMAINS).toBeUndefined();
    });

    it('should throw error when KV bindings are missing', () => {
      // Arrange
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      };

      const bindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_WRITE_QUEUE: mockQueue as any,
        // Missing KV bindings
      } as any;

      // Act & Assert
      expect(() => initializeCloudFlareEnv(bindings)).toThrow(
        'Missing required KV bindings: DP1_PLAYLISTS, DP1_PLAYLIST_GROUPS, DP1_PLAYLIST_ITEMS'
      );
    });

    it('should throw error when some KV bindings are missing', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      };

      const bindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_PLAYLISTS: mockKVNamespace as any,
        DP1_PLAYLIST_GROUPS: mockKVNamespace as any,
        // Missing DP1_PLAYLIST_ITEMS
        DP1_WRITE_QUEUE: mockQueue as any,
      } as any;

      // Act & Assert
      expect(() => initializeCloudFlareEnv(bindings)).toThrow(
        'Missing required KV bindings: DP1_PLAYLISTS, DP1_PLAYLIST_GROUPS, DP1_PLAYLIST_ITEMS'
      );
    });

    it('should throw error when Queue binding is missing', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const bindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_PLAYLISTS: mockKVNamespace as any,
        DP1_PLAYLIST_GROUPS: mockKVNamespace as any,
        DP1_PLAYLIST_ITEMS: mockKVNamespace as any,
        // Missing DP1_WRITE_QUEUE
      } as any;

      // Act & Assert
      expect(() => initializeCloudFlareEnv(bindings)).toThrow(
        'Missing required Queue binding: DP1_WRITE_QUEUE'
      );
    });

    it('should throw error when KV bindings are null/undefined', () => {
      // Arrange
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      };

      const bindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        DP1_PLAYLISTS: null,
        DP1_PLAYLIST_GROUPS: undefined,
        DP1_PLAYLIST_ITEMS: null,
        DP1_WRITE_QUEUE: mockQueue as any,
      } as any;

      // Act & Assert
      expect(() => initializeCloudFlareEnv(bindings)).toThrow(
        'Missing required KV bindings: DP1_PLAYLISTS, DP1_PLAYLIST_GROUPS, DP1_PLAYLIST_ITEMS'
      );
    });
  });

  describe('initializeSelfHostedEnv', () => {
    it('should throw error for FoundationDB missing configuration', () => {
      // Arrange
      const bindings: SelfHostedBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
        NATS_SUBJECT: 'test.subject',
        // Missing FOUNDATIONDB_CLUSTER_FILE
      };

      // Act & Assert
      expect(() => initializeSelfHostedEnv(bindings)).toThrow(
        'FOUNDATIONDB_CLUSTER_FILE is required for self-hosted deployment'
      );
    });

    it('should throw error for NATS missing configuration', () => {
      // Arrange
      const bindings: SelfHostedBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        // Missing NATS_URL and NATS_STREAM
      };

      // Act & Assert
      expect(() => initializeSelfHostedEnv(bindings)).toThrow(
        'NATS_URL and NATS_STREAM are required for self-hosted deployment'
      );
    });

    it('should throw error when only NATS_URL is provided', () => {
      // Arrange
      const bindings: SelfHostedBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        // Missing NATS_STREAM
      };

      // Act & Assert
      expect(() => initializeSelfHostedEnv(bindings)).toThrow(
        'NATS_URL and NATS_STREAM are required for self-hosted deployment'
      );
    });

    it('should throw error when only NATS_STREAM is provided', () => {
      // Arrange
      const bindings: SelfHostedBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_STREAM: 'test-stream',
        // Missing NATS_URL
      };

      // Act & Assert
      expect(() => initializeSelfHostedEnv(bindings)).toThrow(
        'NATS_URL and NATS_STREAM are required for self-hosted deployment'
      );
    });

    it('should throw error for FoundationDB provider not implemented', () => {
      // Arrange
      const bindings: SelfHostedBindings = {
        API_SECRET: 'test-api-secret',
        ED25519_PRIVATE_KEY: 'test-private-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
        NATS_SUBJECT: 'test.subject',
      };

      // Act & Assert
      expect(() => initializeSelfHostedEnv(bindings)).toThrow(
        'FoundationDB storage provider not yet implemented'
      );
    });
  });

  describe('isCloudFlareBindings', () => {
    it('should return true for valid CloudFlare bindings', () => {
      // Arrange
      const mockKVNamespace = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
      const mockQueue = { send: vi.fn(), sendBatch: vi.fn() };

      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
      };

      // Act
      const result = isCloudFlareBindings(bindings);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for null input', () => {
      // Act & Assert
      expect(isCloudFlareBindings(null)).toBe(false);
    });

    it('should return false for non-object input', () => {
      // Act & Assert
      expect(isCloudFlareBindings('string')).toBe(false);
      expect(isCloudFlareBindings(123)).toBe(false);
      expect(isCloudFlareBindings(true)).toBe(false);
      expect(isCloudFlareBindings(undefined)).toBe(false);
    });

    it('should return false when missing required CloudFlare properties', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing CloudFlare-specific properties
      };

      // Act
      const result = isCloudFlareBindings(bindings);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when missing some CloudFlare properties', () => {
      // Arrange
      const mockKVNamespace = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
      const mockQueue = { send: vi.fn(), sendBatch: vi.fn() };

      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        // Missing DP1_PLAYLIST_ITEMS
        DP1_WRITE_QUEUE: mockQueue,
      };

      // Act
      const result = isCloudFlareBindings(bindings);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for self-hosted bindings', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
      };

      // Act
      const result = isCloudFlareBindings(bindings);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('isSelfHostedBindings', () => {
    it('should return true for valid self-hosted bindings with FoundationDB', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
      };

      // Act
      const result = isSelfHostedBindings(bindings);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for valid self-hosted bindings with only NATS', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
      };

      // Act
      const result = isSelfHostedBindings(bindings);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for valid self-hosted bindings with only FoundationDB', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
      };

      // Act
      const result = isSelfHostedBindings(bindings);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for null input', () => {
      // Act & Assert
      expect(isSelfHostedBindings(null)).toBe(false);
    });

    it('should return false for non-object input', () => {
      // Act & Assert
      expect(isSelfHostedBindings('string')).toBe(false);
      expect(isSelfHostedBindings(123)).toBe(false);
      expect(isSelfHostedBindings(true)).toBe(false);
      expect(isSelfHostedBindings(undefined)).toBe(false);
    });

    it('should return false when missing both FoundationDB and NATS properties', () => {
      // Arrange
      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing both FOUNDATIONDB_CLUSTER_FILE and NATS_URL
      };

      // Act
      const result = isSelfHostedBindings(bindings);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for CloudFlare bindings', () => {
      // Arrange
      const mockKVNamespace = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
      const mockQueue = { send: vi.fn(), sendBatch: vi.fn() };

      const bindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
      };

      // Act
      const result = isSelfHostedBindings(bindings);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Type guards integration', () => {
    it('should correctly identify and handle CloudFlare bindings', () => {
      // Arrange
      const mockKVNamespace = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
      const mockQueue = { send: vi.fn(), sendBatch: vi.fn() };

      const cloudflareBindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
      };

      // Act & Assert
      expect(isCloudFlareBindings(cloudflareBindings)).toBe(true);
      expect(isSelfHostedBindings(cloudflareBindings)).toBe(false);
    });

    it('should correctly identify and handle self-hosted bindings', () => {
      // Arrange
      const selfHostedBindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
      };

      // Act & Assert
      expect(isSelfHostedBindings(selfHostedBindings)).toBe(true);
      expect(isCloudFlareBindings(selfHostedBindings)).toBe(false);
    });

    it('should handle ambiguous bindings (has both CloudFlare and self-hosted properties)', () => {
      // Arrange
      const mockKVNamespace = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
      const mockQueue = { send: vi.fn(), sendBatch: vi.fn() };

      const ambiguousBindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        FOUNDATIONDB_CLUSTER_FILE: '/path/to/fdb.cluster',
        NATS_URL: 'nats://localhost:4222',
        NATS_STREAM: 'test-stream',
      };

      // Act & Assert
      // Both should return true due to the presence of their respective properties
      expect(isCloudFlareBindings(ambiguousBindings)).toBe(true);
      expect(isSelfHostedBindings(ambiguousBindings)).toBe(true);
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle empty object bindings', () => {
      // Act & Assert
      expect(isCloudFlareBindings({})).toBe(false);
      expect(isSelfHostedBindings({})).toBe(false);
    });

    it('should handle bindings with only common properties', () => {
      // Arrange
      const commonBindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
      };

      // Act & Assert
      expect(isCloudFlareBindings(commonBindings)).toBe(false);
      expect(isSelfHostedBindings(commonBindings)).toBe(false);
    });

    it('should handle bindings with falsy values for required properties', () => {
      // Arrange
      const falsyBindings = {
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        DP1_PLAYLISTS: null,
        DP1_PLAYLIST_GROUPS: undefined,
        DP1_PLAYLIST_ITEMS: false,
        DP1_WRITE_QUEUE: 0,
      };

      // Act & Assert
      // The type guard only checks for property existence, not truthiness
      // So it should return true even with falsy values
      expect(isCloudFlareBindings(falsyBindings)).toBe(true);
    });
  });
});
