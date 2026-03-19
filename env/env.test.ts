import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeCloudFlareEnv } from './cloudflare';
import { initializeSelfHostedEnv } from './selfhosted';
import { CloudFlareStorageProvider } from '../storage/cloudflare';
import { CloudFlareQueueProvider } from '../queue/cloudflare-queue';

// Mock the storage and queue providers
vi.mock('../storage/cloudflare');
vi.mock('../queue/cloudflare-queue');
vi.mock('../storage/selfhosted');
vi.mock('../queue/nats-jetstream');

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
        getWithMetadata: vi.fn(),
      } as any;
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        CLOUDFLARE_API_TOKEN: 'test-api-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
        CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: 'playlists-namespace-id',
        CLOUDFLARE_CHANNELS_NAMESPACE_ID: 'channels-namespace-id',
        CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: 'playlist-items-namespace-id',
      };

      // Act
      const result = initializeCloudFlareEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.API_SECRET).toBe('test-secret');
      expect(result.ED25519_PRIVATE_KEY).toBe('test-key');
      expect(result.storageProvider).toBeInstanceOf(CloudFlareStorageProvider);
      expect(result.queueProvider).toBeInstanceOf(CloudFlareQueueProvider);
    });

    it('should throw error when KV bindings are missing', () => {
      // Arrange
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_WRITE_QUEUE: mockQueue,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing KV bindings
      };

      // Act & Assert
      expect(() => initializeCloudFlareEnv(mockBindings as any)).toThrow(
        'Missing required KV bindings: DP1_PLAYLISTS, DP1_CHANNELS, DP1_PLAYLIST_ITEMS'
      );
    });

    it('should throw error when Queue binding is missing', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      };
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        CLOUDFLARE_API_TOKEN: 'test-api-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
        CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: 'playlists-namespace-id',
        CLOUDFLARE_CHANNELS_NAMESPACE_ID: 'channels-namespace-id',
        CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: 'playlist-items-namespace-id',
        // Missing Queue binding
      };

      // Act & Assert
      expect(() => initializeCloudFlareEnv(mockBindings as any)).toThrow(
        'Missing required Queue binding: DP1_WRITE_QUEUE'
      );
    });

    it('should throw error when CloudFlare API credentials are missing in non-local environment', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as any;
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        ENVIRONMENT: 'development', // Non-local environment requires API credentials
        // Missing CloudFlare API credentials
      };

      // Act & Assert
      expect(() => initializeCloudFlareEnv(mockBindings as any)).toThrow(
        'Missing required CloudFlare API credentials: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and namespace IDs'
      );
    });

    it('should not throw error when CloudFlare API credentials are missing in local environment', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as any;
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        ENVIRONMENT: 'local', // Local environment uses bindings for bulk operations
        // Missing CloudFlare API credentials - OK for local dev
        CLOUDFLARE_ACCOUNT_ID: 'local-dev-account',
        CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: 'local-playlist-id',
        CLOUDFLARE_CHANNELS_NAMESPACE_ID: 'local-channel-id',
        CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: 'local-item-id',
      };

      // Act & Assert
      expect(() => initializeCloudFlareEnv(mockBindings as any)).not.toThrow();
    });

    it('should initialize file storage when R2 bucket is provided', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as any;
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockR2Bucket = {
        get: vi.fn(),
        put: vi.fn(),
        head: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        DP1_STATIC_FILES: mockR2Bucket,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        CLOUDFLARE_API_TOKEN: 'test-api-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
        CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: 'playlists-namespace-id',
        CLOUDFLARE_CHANNELS_NAMESPACE_ID: 'channels-namespace-id',
        CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: 'playlist-items-namespace-id',
      };

      // Act
      const result = initializeCloudFlareEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.storageProvider).toBeInstanceOf(CloudFlareStorageProvider);
      // File storage should be initialized via R2 bucket
      expect(CloudFlareStorageProvider).toHaveBeenCalledWith(
        mockBindings.DP1_PLAYLISTS,
        mockBindings.DP1_CHANNELS,
        mockBindings.DP1_PLAYLIST_ITEMS,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        mockR2Bucket
      );
    });

    it('should initialize without file storage when R2 bucket is not provided', () => {
      // Arrange
      const mockKVNamespace = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as any;
      const mockQueue = {
        send: vi.fn(),
        sendBatch: vi.fn(),
      } as any;
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_CHANNELS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        // No DP1_STATIC_FILES
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        CLOUDFLARE_API_TOKEN: 'test-api-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
        CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: 'playlists-namespace-id',
        CLOUDFLARE_CHANNELS_NAMESPACE_ID: 'channels-namespace-id',
        CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: 'playlist-items-namespace-id',
      };

      // Act
      const result = initializeCloudFlareEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.storageProvider).toBeInstanceOf(CloudFlareStorageProvider);
      // File storage should be undefined
      expect(CloudFlareStorageProvider).toHaveBeenCalledWith(
        mockBindings.DP1_PLAYLISTS,
        mockBindings.DP1_CHANNELS,
        mockBindings.DP1_PLAYLIST_ITEMS,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        undefined
      );
    });
  });

  describe('initializeSelfHostedEnv', () => {
    it('should successfully initialize environment with valid self-hosted bindings', async () => {
      // Arrange
      const mockBindings = {
        ETCD_ENDPOINT: 'http://localhost:2379',
        NATS_ENDPOINT: 'nats://localhost:4222',
        NATS_STREAM_NAME: 'DP1_WRITE_OPERATIONS',
        NATS_SUBJECT_NAME: 'dp1.write.operations',
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
      };

      // Act
      const result = await initializeSelfHostedEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.API_SECRET).toBe('test-secret');
      expect(result.ED25519_PRIVATE_KEY).toBe('test-key');
    });

    it('should throw error when etcd endpoint is missing', async () => {
      // Arrange
      const mockBindings = {
        NATS_ENDPOINT: 'nats://localhost:4222',
        NATS_STREAM_NAME: 'DP1_WRITE_OPERATIONS',
        NATS_SUBJECT_NAME: 'dp1.write.operations',
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing ETCD_ENDPOINT
      };

      // Act & Assert
      await expect(initializeSelfHostedEnv(mockBindings as any)).rejects.toThrow(
        'Missing required etcd endpoint: ETCD_ENDPOINT'
      );
    });

    it('should throw error when NATS configuration is missing', async () => {
      // Arrange
      const mockBindings = {
        ETCD_ENDPOINT: 'http://localhost:2379',
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing NATS configuration
      };

      // Act & Assert
      await expect(initializeSelfHostedEnv(mockBindings as any)).rejects.toThrow(
        'Missing required NATS configuration: NATS_ENDPOINT, NATS_STREAM_NAME, NATS_SUBJECT_NAME'
      );
    });

    it('should initialize file storage when FILE_STORAGE_PATH is provided', async () => {
      // Arrange
      const mockBindings = {
        ETCD_ENDPOINT: 'http://localhost:2379',
        NATS_ENDPOINT: 'nats://localhost:4222',
        NATS_STREAM_NAME: 'DP1_WRITE_OPERATIONS',
        NATS_SUBJECT_NAME: 'dp1.write.operations',
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        FILE_STORAGE_PATH: './test-data',
      };

      // Act
      const result = await initializeSelfHostedEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.API_SECRET).toBe('test-secret');
      expect(result.ED25519_PRIVATE_KEY).toBe('test-key');
      // Storage provider should be initialized with file storage path
    });

    it('should initialize without file storage when FILE_STORAGE_PATH is not provided', async () => {
      // Arrange
      const mockBindings = {
        ETCD_ENDPOINT: 'http://localhost:2379',
        NATS_ENDPOINT: 'nats://localhost:4222',
        NATS_STREAM_NAME: 'DP1_WRITE_OPERATIONS',
        NATS_SUBJECT_NAME: 'dp1.write.operations',
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // No FILE_STORAGE_PATH
      };

      // Act
      const result = await initializeSelfHostedEnv(mockBindings);

      // Assert
      expect(result).toBeDefined();
      expect(result.API_SECRET).toBe('test-secret');
      expect(result.ED25519_PRIVATE_KEY).toBe('test-key');
      // Storage provider should be initialized without file storage
    });
  });
});
