import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CloudFlareKVStorage,
  CloudFlareStorageProvider,
  type CloudFlareKVConfig,
} from './cloudflare-kv';
import type { KVGetOptions, KVListOptions } from './interfaces';

// Mock global fetch
global.fetch = vi.fn();

describe('CloudFlareKVStorage', () => {
  let storage: CloudFlareKVStorage;
  let mockKV: any;
  let config: CloudFlareKVConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CloudFlare KV namespace
    mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    config = {
      accountId: 'test-account-id',
      namespaceId: 'test-namespace-id',
      apiToken: 'test-api-token',
    };

    storage = new CloudFlareKVStorage(mockKV, config);
  });

  describe('constructor', () => {
    it('should create a CloudFlare KV storage with the provided KV namespace and config', () => {
      expect(storage).toBeInstanceOf(CloudFlareKVStorage);
    });
  });

  describe('get', () => {
    it('should get a value successfully using KV binding', async () => {
      const key = 'test-key';
      const value = 'test-value';
      mockKV.get.mockResolvedValue(value);

      const result = await storage.get(key);

      expect(mockKV.get).toHaveBeenCalledWith(key, undefined);
      expect(result).toBe(value);
    });

    it('should get a value with options', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const options: KVGetOptions = { type: 'json' };
      mockKV.get.mockResolvedValue(value);

      const result = await storage.get(key, options);

      expect(mockKV.get).toHaveBeenCalledWith(key, options);
      expect(result).toBe(value);
    });

    it('should return null for non-existent key', async () => {
      const key = 'non-existent-key';
      mockKV.get.mockResolvedValue(null);

      const result = await storage.get(key);

      expect(mockKV.get).toHaveBeenCalledWith(key, undefined);
      expect(result).toBeNull();
    });

    it('should handle get errors', async () => {
      const key = 'test-key';
      const error = new Error('Get failed');
      mockKV.get.mockRejectedValue(error);

      await expect(storage.get(key)).rejects.toThrow('Get failed');
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values successfully with batch operation using KV binding', async () => {
      const keys = ['key1', 'key2', 'key3'];
      const batchResults = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', null], // This key doesn't exist
      ]);
      mockKV.get.mockResolvedValue(batchResults);

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledWith(keys, undefined);
      expect(result).toBeInstanceOf(Map);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
      expect(result.has('key3')).toBe(false); // Should not include null values
    });

    it('should get multiple values with options', async () => {
      const keys = ['key1', 'key2'];
      const options: KVGetOptions = { type: 'json' };
      const batchResults = new Map([
        ['key1', { data: 'value1' }],
        ['key2', { data: 'value2' }],
      ]);
      mockKV.get.mockResolvedValue(batchResults);

      const result = await storage.getMultiple(keys, options);

      expect(mockKV.get).toHaveBeenCalledWith(keys, options);
      expect(result.get('key1')).toEqual({ data: 'value1' });
      expect(result.get('key2')).toEqual({ data: 'value2' });
    });

    it('should return empty map for empty keys array', async () => {
      const result = await storage.getMultiple([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockKV.get).not.toHaveBeenCalled();
    });

    it('should handle batch operation with multiple batches (>100 keys)', async () => {
      const keys = Array.from({ length: 150 }, (_, i) => `key${i}`);
      const batch1Results = new Map(
        Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`])
      );
      const batch2Results = new Map(
        Array.from({ length: 50 }, (_, i) => [`key${i + 100}`, `value${i + 100}`])
      );

      mockKV.get.mockResolvedValueOnce(batch1Results).mockResolvedValueOnce(batch2Results);

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(150);
      expect(result.get('key0')).toBe('value0');
      expect(result.get('key149')).toBe('value149');
    });

    it('should fallback to individual gets when batch returns null', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce(null) // Batch get returns null
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.size).toBe(2);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should throw error when batch operation fails', async () => {
      const keys = ['key1', 'key2'];
      const batchError = new Error('Batch failed');
      mockKV.get.mockRejectedValue(batchError);

      await expect(storage.getMultiple(keys)).rejects.toThrow('Batch failed');
      expect(mockKV.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('should list keys successfully using KV binding', async () => {
      const options: KVListOptions = { prefix: 'test-', limit: 10 };
      const listResult = {
        keys: [{ name: 'test-key1' }, { name: 'test-key2' }],
        list_complete: true,
      };
      mockKV.list.mockResolvedValue(listResult);

      const result = await storage.list(options);

      expect(mockKV.list).toHaveBeenCalledWith(options);
      expect(result).toEqual(listResult);
    });

    it('should handle list errors', async () => {
      const options: KVListOptions = { prefix: 'test-' };
      const error = new Error('List failed');
      mockKV.list.mockRejectedValue(error);

      await expect(storage.list(options)).rejects.toThrow('List failed');
    });
  });

  describe('put', () => {
    it('should put a value using KV binding', async () => {
      const key = 'test-key';
      const value = 'test-value';
      mockKV.put.mockResolvedValue(undefined);

      await storage.put(key, value);

      expect(mockKV.put).toHaveBeenCalledWith(key, value);
    });

    it('should handle put errors', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const error = new Error('Put failed');
      mockKV.put.mockRejectedValue(error);

      await expect(storage.put(key, value)).rejects.toThrow('Put failed');
    });
  });

  describe('delete', () => {
    it('should delete a key using KV binding', async () => {
      const key = 'test-key';
      mockKV.delete.mockResolvedValue(undefined);

      await storage.delete(key);

      expect(mockKV.delete).toHaveBeenCalledWith(key);
    });

    it('should handle delete errors', async () => {
      const key = 'test-key';
      const error = new Error('Delete failed');
      mockKV.delete.mockRejectedValue(error);

      await expect(storage.delete(key)).rejects.toThrow('Delete failed');
    });
  });

  describe('putMultiple', () => {
    it('should use bulk write API for multiple entries', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' },
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 3,
            unsuccessful_keys: [],
          },
        }),
      });

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/bulk`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify(entries),
        }
      );
    });

    it('should return unsuccessful keys', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 1,
            unsuccessful_keys: ['key2'],
          },
        }),
      });

      const result = await storage.putMultiple(entries);

      expect(result).toEqual(['key2']);
    });

    it('should throw error on API failure', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error details',
      });

      await expect(storage.putMultiple(entries)).rejects.toThrow(
        'CloudFlare KV bulk write failed: 500 Internal Server Error'
      );
    });

    it('should chunk operations exceeding 10k limit', async () => {
      const entries = Array.from({ length: 15000 }, (_, i) => ({
        key: `key${i}`,
        value: `value${i}`,
      }));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 10000,
            unsuccessful_keys: [],
          },
        }),
      });

      await storage.putMultiple(entries);

      // Should have made 2 API calls (10k + 5k)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty entries', async () => {
      const result = await storage.putMultiple([]);

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('deleteMultiple', () => {
    it('should use bulk delete API for multiple keys', async () => {
      const keys = ['key1', 'key2', 'key3'];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 3,
            unsuccessful_keys: [],
          },
        }),
      });

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual([]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/bulk/delete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify(keys),
        }
      );
    });

    it('should return unsuccessful keys', async () => {
      const keys = ['key1', 'key2'];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 1,
            unsuccessful_keys: ['key2'],
          },
        }),
      });

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual(['key2']);
    });

    it('should chunk operations exceeding 10k limit', async () => {
      const keys = Array.from({ length: 15000 }, (_, i) => `key${i}`);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            successful_key_count: 10000,
            unsuccessful_keys: [],
          },
        }),
      });

      await storage.deleteMultiple(keys);

      // Should have made 2 API calls (10k + 5k)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error on API failure', async () => {
      const keys = ['key1', 'key2'];

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error details',
      });

      await expect(storage.deleteMultiple(keys)).rejects.toThrow(
        'CloudFlare KV bulk delete failed: 500 Internal Server Error'
      );
    });

    it('should return empty array for empty keys', async () => {
      const result = await storage.deleteMultiple([]);

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('CloudFlareStorageProvider', () => {
  let provider: CloudFlareStorageProvider;
  let mockPlaylistKV: any;
  let mockChannelKV: any;
  let mockPlaylistItemKV: any;
  let playlistConfig: CloudFlareKVConfig;
  let channelConfig: CloudFlareKVConfig;
  let playlistItemConfig: CloudFlareKVConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CloudFlare KV namespaces
    mockPlaylistKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    mockChannelKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    mockPlaylistItemKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    playlistConfig = {
      accountId: 'test-account-id',
      namespaceId: 'playlist-namespace-id',
      apiToken: 'test-api-token',
    };

    channelConfig = {
      accountId: 'test-account-id',
      namespaceId: 'channel-namespace-id',
      apiToken: 'test-api-token',
    };

    playlistItemConfig = {
      accountId: 'test-account-id',
      namespaceId: 'playlist-item-namespace-id',
      apiToken: 'test-api-token',
    };

    provider = new CloudFlareStorageProvider(
      mockPlaylistKV,
      mockChannelKV,
      mockPlaylistItemKV,
      playlistConfig,
      channelConfig,
      playlistItemConfig
    );
  });

  describe('constructor', () => {
    it('should create a provider with the provided KV namespaces and configs', () => {
      expect(provider).toBeInstanceOf(CloudFlareStorageProvider);
    });
  });

  describe('getPlaylistStorage', () => {
    it('should return a CloudFlareKVStorage instance for playlists', () => {
      const storage = provider.getPlaylistStorage();

      expect(storage).toBeInstanceOf(CloudFlareKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistStorage();
      const storage2 = provider.getPlaylistStorage();

      expect(storage1).toBe(storage2);
    });

    it('should allow read operations on playlist storage', async () => {
      const storage = provider.getPlaylistStorage();
      const key = 'playlist-1';
      const value = 'playlist-data';

      mockPlaylistKV.get.mockResolvedValue(value);

      const result = await storage.get(key);

      expect(mockPlaylistKV.get).toHaveBeenCalledWith(key, undefined);
      expect(result).toBe(value);
    });
  });

  describe('getChannelStorage', () => {
    it('should return a CloudFlareKVStorage instance for channels', () => {
      const storage = provider.getChannelStorage();

      expect(storage).toBeInstanceOf(CloudFlareKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getChannelStorage();
      const storage2 = provider.getChannelStorage();

      expect(storage1).toBe(storage2);
    });
  });

  describe('getPlaylistItemStorage', () => {
    it('should return a CloudFlareKVStorage instance for playlist items', () => {
      const storage = provider.getPlaylistItemStorage();

      expect(storage).toBeInstanceOf(CloudFlareKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistItemStorage();
      const storage2 = provider.getPlaylistItemStorage();

      expect(storage1).toBe(storage2);
    });
  });
});
