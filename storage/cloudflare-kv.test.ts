import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudFlareKVStorage, CloudFlareStorageProvider } from './cloudflare-kv';
import type { KVGetOptions, KVListOptions } from './interfaces';

describe('CloudFlareKVStorage', () => {
  let storage: CloudFlareKVStorage;
  let mockKV: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CloudFlare KV namespace
    mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    storage = new CloudFlareKVStorage(mockKV);
  });

  describe('constructor', () => {
    it('should create a CloudFlare KV storage with the provided KV namespace', () => {
      expect(storage).toBeInstanceOf(CloudFlareKVStorage);
    });
  });

  describe('get', () => {
    it('should get a value successfully', async () => {
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
    it('should get multiple values successfully with batch operation', async () => {
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

    it('should handle empty keys array', async () => {
      const result = await storage.getMultiple([]);

      expect(mockKV.get).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should handle batch size larger than 100', async () => {
      const keys = Array.from({ length: 250 }, (_, i) => `key${i}`);
      const batchResults1 = new Map(
        Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`])
      );
      const batchResults2 = new Map(
        Array.from({ length: 100 }, (_, i) => [`key${i + 100}`, `value${i + 100}`])
      );
      const batchResults3 = new Map(
        Array.from({ length: 50 }, (_, i) => [`key${i + 200}`, `value${i + 200}`])
      );

      mockKV.get
        .mockResolvedValueOnce(batchResults1)
        .mockResolvedValueOnce(batchResults2)
        .mockResolvedValueOnce(batchResults3);

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.size).toBe(250);
      expect(result.get('key0')).toBe('value0');
      expect(result.get('key100')).toBe('value100');
      expect(result.get('key200')).toBe('value200');
    });

    it('should fallback to individual gets when batch returns null', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce(null) // Batch operation returns null
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should fallback to individual gets when batch returns undefined', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce(undefined) // Batch operation returns undefined
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should fallback to individual gets when batch returns a string', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce('not-a-map') // Batch operation returns string instead of Map
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should fallback to individual gets when batch returns an array', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce(['not', 'a', 'map']) // Batch operation returns array instead of Map
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should fallback to individual gets when batch returns an object', async () => {
      const keys = ['key1', 'key2'];
      mockKV.get
        .mockResolvedValueOnce({ key1: 'value1', key2: 'value2' }) // Batch operation returns object instead of Map
        .mockResolvedValueOnce('value1') // Individual get for key1
        .mockResolvedValueOnce('value2'); // Individual get for key2

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
    });

    it('should throw error when individual get fails in fallback mode', async () => {
      const keys = ['key1', 'key2'];
      const individualError = new Error('Individual get failed');
      mockKV.get
        .mockResolvedValueOnce(null) // Batch operation returns null
        .mockRejectedValueOnce(individualError) // Individual get fails
        .mockResolvedValueOnce('value2'); // Individual get for key2

      await expect(storage.getMultiple(keys)).rejects.toThrow('Individual get failed');
      expect(mockKV.get).toHaveBeenCalledTimes(2); // Should fail on first individual get
    });

    it('should throw error when JSON parsing fails in fallback mode', async () => {
      const keys = ['key1', 'key2'];
      const options: KVGetOptions = { type: 'json' };
      mockKV.get
        .mockResolvedValueOnce(null) // Batch operation returns null
        .mockResolvedValueOnce('{"data": "value1"}') // JSON string
        .mockResolvedValueOnce('invalid-json'); // Invalid JSON

      await expect(storage.getMultiple(keys, options)).rejects.toThrow();
      expect(mockKV.get).toHaveBeenCalledTimes(3);
    });

    it('should handle valid JSON parsing in fallback mode', async () => {
      const keys = ['key1', 'key2'];
      const options: KVGetOptions = { type: 'json' };
      mockKV.get
        .mockResolvedValueOnce(null) // Batch operation returns null
        .mockResolvedValueOnce('{"data": "value1"}') // JSON string
        .mockResolvedValueOnce('{"data": "value2"}'); // Valid JSON

      const result = await storage.getMultiple(keys, options);

      expect(result.get('key1')).toEqual({ data: 'value1' });
      expect(result.get('key2')).toEqual({ data: 'value2' });
    });

    it('should handle multiple batches with fallback for each batch', async () => {
      const keys = Array.from({ length: 150 }, (_, i) => `key${i}`); // More than 100 keys

      // Mock responses for all the individual calls that will happen during fallback
      const mockResponses: (Map<string, string> | null | string)[] = [
        // First batch call (returns Map)
        new Map([
          ['key0', 'value0'],
          ['key1', 'value1'],
        ]),
        // Second batch call (returns null, triggers fallback)
        null,
      ];

      // Add individual responses for all 50 keys in the second batch
      for (let i = 100; i < 150; i++) {
        mockResponses.push(`value${i}`);
      }

      mockKV.get.mockImplementation(() => {
        const response = mockResponses.shift();
        if (response === undefined) {
          return Promise.resolve(null);
        }
        return Promise.resolve(response as any);
      });

      const result = await storage.getMultiple(keys);

      expect(mockKV.get).toHaveBeenCalledTimes(52); // 1 + 1 + 50 individual calls
      expect(result.get('key0')).toBe('value0');
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key100')).toBe('value100');
      expect(result.get('key101')).toBe('value101');
      expect(result.get('key149')).toBe('value149');
    });

    it('should throw error when batch operation fails', async () => {
      const keys = ['key1', 'key2'];
      const batchError = new Error('Batch failed');
      mockKV.get.mockRejectedValue(batchError);

      await expect(storage.getMultiple(keys)).rejects.toThrow('Batch failed');
      expect(mockKV.get).toHaveBeenCalledTimes(1);
    });

    it('should throw error when batch operation fails with multiple batches', async () => {
      const keys = Array.from({ length: 150 }, (_, i) => `key${i}`); // More than 100 keys
      const batchError = new Error('Batch failed');
      mockKV.get.mockRejectedValue(batchError);

      await expect(storage.getMultiple(keys)).rejects.toThrow('Batch failed');
      expect(mockKV.get).toHaveBeenCalledTimes(1); // Should fail on first batch
    });
  });

  describe('put', () => {
    it('should put a value successfully', async () => {
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
    it('should delete a key successfully', async () => {
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

  describe('list', () => {
    it('should list keys successfully', async () => {
      const options: KVListOptions = { prefix: 'test-', limit: 10 };
      const mockListResult = {
        keys: [
          { name: 'test-key1', metadata: null },
          { name: 'test-key2', metadata: { created: '2024-01-01' } },
        ],
        list_complete: true,
        cursor: undefined,
      };
      mockKV.list.mockResolvedValue(mockListResult);

      const result = await storage.list(options);

      expect(mockKV.list).toHaveBeenCalledWith(options);
      expect(result).toEqual(mockListResult);
    });

    it('should list keys without options', async () => {
      const mockListResult = {
        keys: [{ name: 'key1', metadata: null }],
        list_complete: true,
        cursor: undefined,
      };
      mockKV.list.mockResolvedValue(mockListResult);

      const result = await storage.list();

      expect(mockKV.list).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockListResult);
    });

    it('should handle list errors', async () => {
      const options: KVListOptions = { prefix: 'test-' };
      const error = new Error('List failed');
      mockKV.list.mockRejectedValue(error);

      await expect(storage.list(options)).rejects.toThrow('List failed');
    });
  });
});

describe('CloudFlareStorageProvider', () => {
  let provider: CloudFlareStorageProvider;
  let mockPlaylistKV: any;
  let mockChannelKV: any;
  let mockPlaylistItemKV: any;

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

    provider = new CloudFlareStorageProvider(mockPlaylistKV, mockChannelKV, mockPlaylistItemKV);
  });

  describe('constructor', () => {
    it('should create a provider with the provided KV namespaces', () => {
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

    it('should allow operations on playlist storage', async () => {
      const storage = provider.getPlaylistStorage();
      const key = 'playlist-1';
      const value = 'playlist-data';

      mockPlaylistKV.put.mockResolvedValue(undefined);
      mockPlaylistKV.get.mockResolvedValue(value);

      await storage.put(key, value);
      const result = await storage.get(key);

      expect(mockPlaylistKV.put).toHaveBeenCalledWith(key, value);
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

    it('should allow operations on channel storage', async () => {
      const storage = provider.getChannelStorage();
      const key = 'group-1';
      const value = 'group-data';

      mockChannelKV.put.mockResolvedValue(undefined);
      mockChannelKV.get.mockResolvedValue(value);

      await storage.put(key, value);
      const result = await storage.get(key);

      expect(mockChannelKV.put).toHaveBeenCalledWith(key, value);
      expect(mockChannelKV.get).toHaveBeenCalledWith(key, undefined);
      expect(result).toBe(value);
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

    it('should allow operations on playlist item storage', async () => {
      const storage = provider.getPlaylistItemStorage();
      const key = 'item-1';
      const value = 'item-data';

      mockPlaylistItemKV.put.mockResolvedValue(undefined);
      mockPlaylistItemKV.get.mockResolvedValue(value);

      await storage.put(key, value);
      const result = await storage.get(key);

      expect(mockPlaylistItemKV.put).toHaveBeenCalledWith(key, value);
      expect(mockPlaylistItemKV.get).toHaveBeenCalledWith(key, undefined);
      expect(result).toBe(value);
    });
  });

  describe('integration tests', () => {
    it('should work with all storage types independently', async () => {
      const playlistStorage = provider.getPlaylistStorage();
      const groupStorage = provider.getChannelStorage();
      const itemStorage = provider.getPlaylistItemStorage();

      // Test playlist storage
      mockPlaylistKV.put.mockResolvedValue(undefined);
      mockPlaylistKV.get.mockResolvedValue('playlist-value');
      await playlistStorage.put('playlist-1', 'playlist-value');
      const playlistResult = await playlistStorage.get('playlist-1');

      // Test group storage
      mockChannelKV.put.mockResolvedValue(undefined);
      mockChannelKV.get.mockResolvedValue('group-value');
      await groupStorage.put('group-1', 'group-value');
      const groupResult = await groupStorage.get('group-1');

      // Test item storage
      mockPlaylistItemKV.put.mockResolvedValue(undefined);
      mockPlaylistItemKV.get.mockResolvedValue('item-value');
      await itemStorage.put('item-1', 'item-value');
      const itemResult = await itemStorage.get('item-1');

      expect(playlistResult).toBe('playlist-value');
      expect(groupResult).toBe('group-value');
      expect(itemResult).toBe('item-value');
    });

    it('should handle errors independently across storage types', async () => {
      const playlistStorage = provider.getPlaylistStorage();
      const groupStorage = provider.getChannelStorage();
      const itemStorage = provider.getPlaylistItemStorage();

      // Playlist storage fails
      mockPlaylistKV.put.mockRejectedValue(new Error('Playlist put failed'));

      // Group storage succeeds
      mockChannelKV.put.mockResolvedValue(undefined);
      mockChannelKV.get.mockResolvedValue('group-value');

      // Item storage succeeds
      mockPlaylistItemKV.put.mockResolvedValue(undefined);
      mockPlaylistItemKV.get.mockResolvedValue('item-value');

      // Playlist operation should fail
      await expect(playlistStorage.put('playlist-1', 'value')).rejects.toThrow(
        'Playlist put failed'
      );

      // Group and item operations should succeed
      await groupStorage.put('group-1', 'group-value');
      await itemStorage.put('item-1', 'item-value');

      const groupResult = await groupStorage.get('group-1');
      const itemResult = await itemStorage.get('item-1');

      expect(groupResult).toBe('group-value');
      expect(itemResult).toBe('item-value');
    });
  });
});
