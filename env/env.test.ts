import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeCloudFlareEnv } from './cloudflare';
import { initializeSelfHostedEnv } from './selfhosted';
import { CloudFlareStorageProvider } from '../storage/cloudflare-kv';
import { CloudFlareQueueProvider } from '../queue/cloudflare-queue';

// Mock the storage and queue providers
vi.mock('../storage/cloudflare-kv');
vi.mock('../queue/cloudflare-queue');
vi.mock('../storage/etcd-kv');
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
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        DP1_WRITE_QUEUE: mockQueue,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
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
        getWithMetadata: vi.fn(),
      };
      const mockBindings = {
        DP1_PLAYLISTS: mockKVNamespace,
        DP1_PLAYLIST_GROUPS: mockKVNamespace,
        DP1_PLAYLIST_ITEMS: mockKVNamespace,
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        // Missing Queue binding
      };

      // Act & Assert
      expect(() => initializeCloudFlareEnv(mockBindings as any)).toThrow(
        'Missing required Queue binding: DP1_WRITE_QUEUE'
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
  });


});
