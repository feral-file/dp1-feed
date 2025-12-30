import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EtcdKVStorage,
  EtcdStorageProvider,
  encodeBase64,
  incrementString,
  type EtcdConfig,
} from './etcd-kv';
import type { KVGetOptions, KVListOptions } from './interfaces';

// Mock fetch globally
global.fetch = vi.fn();

// Helper function to calculate expected range_end
function getExpectedRangeEnd(prefix: string): string {
  return encodeBase64(incrementString(prefix));
}

describe('EtcdKVStorage', () => {
  let storage: EtcdKVStorage;
  let mockConfig: EtcdConfig;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      endpoint: 'http://localhost:2379',
      prefix: 'dp1',
    };

    storage = new EtcdKVStorage(mockConfig, 'test-namespace');
    mockFetch = global.fetch as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an etcd KV storage with the provided config and namespace', () => {
      expect(storage).toBeInstanceOf(EtcdKVStorage);
      expect((storage as any).namespace).toBe('test-namespace');
      expect((storage as any).config.prefix).toBe('dp1');
    });

    it('should create storage with custom prefix', () => {
      const customConfig = { ...mockConfig, prefix: 'custom-prefix' };
      const customStorage = new EtcdKVStorage(customConfig, 'test-namespace');
      expect(customStorage).toBeInstanceOf(EtcdKVStorage);
      expect((customStorage as any).namespace).toBe('test-namespace');
      expect((customStorage as any).config.prefix).toBe('custom-prefix');
    });

    it('should create storage without namespace', () => {
      const noNamespaceStorage = new EtcdKVStorage(mockConfig);
      expect(noNamespaceStorage).toBeInstanceOf(EtcdKVStorage);
      expect((noNamespaceStorage as any).namespace).toBe('');
      expect((noNamespaceStorage as any).config.prefix).toBe('dp1');
    });
  });

  describe('getKey', () => {
    it('should generate correct key with namespace', () => {
      const key = 'test-key';
      const expectedKey = 'dp1/test-namespace/test-key';

      // Access private method for testing
      const result = (storage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });

    it('should generate correct key without namespace', () => {
      const noNamespaceStorage = new EtcdKVStorage(mockConfig);
      const key = 'test-key';
      const expectedKey = 'dp1/test-key';

      const result = (noNamespaceStorage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });

    it('should generate correct key with custom prefix', () => {
      const customConfig = { ...mockConfig, prefix: 'custom-prefix' };
      const customStorage = new EtcdKVStorage(customConfig, 'test-namespace');
      const key = 'test-key';
      const expectedKey = 'custom-prefix/test-namespace/test-key';

      const result = (customStorage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });
  });

  describe('makeRequest', () => {
    it('should make request without authentication', async () => {
      const path = '/v3/kv/range';
      const options = { method: 'POST', body: 'test-body' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kvs: [{ key: 'dGVzdC1rZXk=', value: 'dGVzdC12YWx1ZQ==' }] }),
      });

      await (storage as any).makeRequest(path, options);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/range',
        expect.objectContaining({
          method: 'POST',
          body: 'test-body',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should make request with basic authentication', async () => {
      const authConfig = {
        ...mockConfig,
        username: 'test-user',
        password: 'test-pass',
      };
      const authStorage = new EtcdKVStorage(authConfig, 'test-namespace');

      const path = '/v3/kv/range';
      const options = { method: 'POST', body: 'test-body' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kvs: [] }),
      });

      await (authStorage as any).makeRequest(path, options);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/range',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic dGVzdC11c2VyOnRlc3QtcGFzcw==',
          }),
        })
      );
    });

    it('should handle request errors', async () => {
      const path = '/v3/kv/range';
      const options = { method: 'POST', body: 'test-body' };

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect((storage as any).makeRequest(path, options)).rejects.toThrow('Network error');
    });
  });

  describe('get', () => {
    it('should get a value successfully', async () => {
      const key = 'test-key';
      const value = 'test-value';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5', value: 'dGVzdC12YWx1ZQ==' }],
          }),
      });

      const result = await storage.get(key);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/range',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5' }),
        })
      );
      expect(result).toBe(value);
    });

    it('should return null for non-existent key', async () => {
      const key = 'non-existent-key';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kvs: [] }),
      });

      const result = await storage.get(key);

      expect(result).toBeNull();
    });

    it('should handle JSON parsing when requested', async () => {
      const key = 'test-key';
      const jsonValue = { data: 'test-data' };
      const options: KVGetOptions = { type: 'json' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [
              {
                key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5',
                value: 'eyJkYXRhIjoidGVzdC1kYXRhIn0=',
              },
            ],
          }),
      });

      const result = await storage.get(key, options);

      expect(result).toEqual(jsonValue);
    });

    it('should handle emojis and Unicode characters when getting values', async () => {
      const key = 'emoji-key';
      const expectedValue = 'Test emojis 😊👪🏼🌍 🚀';

      const base64Value = encodeBase64(expectedValue);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [
              {
                key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2Vtb2ppLWtleQ==',
                value: base64Value,
              },
            ],
          }),
      });

      const result = await storage.get(key);
      expect(result).toBe(expectedValue);
    });

    it('should throw error for invalid JSON', async () => {
      const key = 'test-key';
      const options: KVGetOptions = { type: 'json' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5', value: 'aW52YWxpZC1qc29u' }],
          }),
      });

      await expect(storage.get(key, options)).rejects.toThrow();
    });

    it('should handle etcd errors', async () => {
      const key = 'test-key';

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await storage.get(key);

      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      const key = 'test-key';

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(storage.get(key)).rejects.toThrow('Network error');
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values successfully', async () => {
      const keys = ['key1', 'key2', 'key3'];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTE=', value: 'dmFsdWUx' }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTI=', value: 'dmFsdWUy' }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [], // key3 doesn't exist
            }),
        });

      const result = await storage.getMultiple(keys);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toBeInstanceOf(Map);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
      expect(result.has('key3')).toBe(false);
    });

    it('should handle empty keys array', async () => {
      const result = await storage.getMultiple([]);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should throw error when individual key fails', async () => {
      const keys = ['key1', 'key2'];

      mockFetch
        .mockRejectedValueOnce(new Error('Network error')) // key1 fails
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTI=', value: 'dmFsdWUy' }],
            }),
        });

      await expect(storage.getMultiple(keys)).rejects.toThrow('Network error');
    });

    it('should throw error when JSON parsing fails for multiple keys', async () => {
      const keys = ['key1', 'key2'];
      const options: KVGetOptions = { type: 'json' };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTE=', value: 'eyJkYXRhIjoidmFsdWUxIn0=' }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTI=', value: 'aW52YWxpZC1qc29u' }],
            }),
        });

      await expect(storage.getMultiple(keys, options)).rejects.toThrow();
    });
  });

  describe('put', () => {
    it('should put a value successfully', async () => {
      const key = 'test-key';
      const value = 'test-value';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await storage.put(key, value);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/put',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5',
            value: 'dGVzdC12YWx1ZQ==',
          }),
        })
      );
    });

    it('should handle emojis and Unicode characters in values', async () => {
      const key = 'emoji-key';
      const value = 'Test emojis 😊👪🏼🌍 🚀';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await storage.put(key, value);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/put',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"key":"ZHAxL3Rlc3QtbmFtZXNwYWNlL2Vtb2ppLWtleQ=="'),
        })
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON with emojis', async () => {
      const key = 'json-emoji-key';
      const jsonValue = JSON.stringify({
        name: 'Test 🎨',
        description: 'Art piece with emojis 👪🏼 and symbols ✨',
        tags: ['emoji 😀', 'unicode 🌈'],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await storage.put(key, jsonValue);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/put',
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle put errors', async () => {
      const key = 'test-key';
      const value = 'test-value';

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(storage.put(key, value)).rejects.toThrow(
        'etcd put failed: 500 Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      const key = 'test-key';
      const value = 'test-value';

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(storage.put(key, value)).rejects.toThrow('Network error');
    });
  });

  describe('delete', () => {
    it('should delete a key successfully', async () => {
      const key = 'test-key';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await storage.delete(key);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/deleterange',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qta2V5',
          }),
        })
      );
    });

    it('should handle delete errors', async () => {
      const key = 'test-key';

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(storage.delete(key)).rejects.toThrow('etcd delete failed: 404 Not Found');
    });

    it('should handle network errors', async () => {
      const key = 'test-key';

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(storage.delete(key)).rejects.toThrow('Network error');
    });
  });

  describe('list', () => {
    it('should list keys successfully', async () => {
      const options: KVListOptions = { prefix: 'test-', limit: 10 };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [
              { key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3QtazE=' },
              { key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3QtazI=' },
            ],
            more: false,
          }),
      });

      const result = await storage.list(options);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/range',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3Qt',
            range_end: getExpectedRangeEnd('dp1/test-namespace/test-'),
            limit: 10,
          }),
        })
      );
      expect(result).toEqual({
        keys: [{ name: 'test-k1' }, { name: 'test-k2' }],
        list_complete: true,
        cursor: undefined,
      });
    });

    it('should list keys without options', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [{ key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL2tleTE=' }],
            more: false,
          }),
      });

      const result = await storage.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/range',
        expect.objectContaining({
          body: JSON.stringify({
            key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlLw==',
            range_end: getExpectedRangeEnd('dp1/test-namespace/'),
            limit: 1000,
          }),
        })
      );
      expect(result.keys).toHaveLength(1);
      expect(result.keys[0].name).toBe('key1');
    });

    it('should handle pagination with cursor', async () => {
      const options: KVListOptions = { prefix: 'test-', limit: 5, cursor: 'cursor-value' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [
              { key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3QtazE=' },
              { key: 'ZHAxL3Rlc3QtbmFtZXNwYWNlL3Rlc3QtazI=' },
            ],
            more: true,
          }),
      });

      const result = await storage.list(options);

      expect(result.list_complete).toBe(false);
      expect(result.cursor).toBeDefined();
    });

    it('should handle invalid cursor gracefully', async () => {
      const options: KVListOptions = { prefix: 'test-', cursor: 'invalid-cursor' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            kvs: [],
            more: false,
          }),
      });

      const result = await storage.list(options);

      expect(result.keys).toHaveLength(0);
      expect(result.list_complete).toBe(true);
    });

    it('should handle list errors', async () => {
      const options: KVListOptions = { prefix: 'test-' };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await storage.list(options);

      expect(result).toEqual({
        keys: [],
        list_complete: true,
      });
    });

    it('should handle network errors', async () => {
      const options: KVListOptions = { prefix: 'test-' };

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await storage.list(options);

      expect(result).toEqual({
        keys: [],
        list_complete: true,
      });
    });
  });

  describe('putMultiple', () => {
    it('should use bulk write transaction API for multiple entries', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
            responses: [{}, {}, {}],
          }),
      });

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/txn',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('request_put'),
        })
      );

      // Verify the transaction body contains all entries
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.success).toHaveLength(3);
      expect(callBody.success[0]).toHaveProperty('request_put');
    });

    it('should return unsuccessful keys when transaction fails', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: false,
          }),
      });

      const result = await storage.putMultiple(entries);

      expect(result).toEqual(['key1', 'key2']);
    });

    it('should throw error on API failure', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(storage.putMultiple(entries)).rejects.toThrow(
        'etcd txn failed: 500 Internal Server Error'
      );
    });

    it('should chunk operations exceeding 128 item limit', async () => {
      const entries = Array.from({ length: 200 }, (_, i) => ({
        key: `key${i}`,
        value: `value${i}`,
      }));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
            responses: [],
          }),
      });

      await storage.putMultiple(entries);

      // Should have made 2 API calls (128 + 72)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first chunk has 128 operations
      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCallBody.success).toHaveLength(128);

      // Verify second chunk has 72 operations
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.success).toHaveLength(72);
    });

    it('should use single put operation for single entry', async () => {
      const entries = [{ key: 'key1', value: 'value1' }];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      // Should call the single put endpoint, not transaction
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:2379/v3/kv/put', expect.any(Object));
    });

    it('should return empty array for empty entries', async () => {
      const result = await storage.putMultiple([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should properly encode keys and values in base64', async () => {
      const entries = [
        { key: 'test-key', value: 'test-value' },
        { key: 'test-key-2', value: 'test-value-2' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
          }),
      });

      await storage.putMultiple(entries);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const putOp = callBody.success[0].request_put;

      // Key should be base64 encoded with namespace prefix
      expect(putOp.key).toBe(encodeBase64('dp1/test-namespace/test-key'));
      // Value should be base64 encoded
      expect(putOp.value).toBe(encodeBase64('test-value'));
    });
  });

  describe('deleteMultiple', () => {
    it('should use bulk delete transaction API for multiple keys', async () => {
      const keys = ['key1', 'key2', 'key3'];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
            responses: [{}, {}, {}],
          }),
      });

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/txn',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('request_delete_range'),
        })
      );

      // Verify the transaction body contains all keys
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.success).toHaveLength(3);
      expect(callBody.success[0]).toHaveProperty('request_delete_range');
    });

    it('should return unsuccessful keys when transaction fails', async () => {
      const keys = ['key1', 'key2'];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: false,
          }),
      });

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual(['key1', 'key2']);
    });

    it('should throw error on API failure', async () => {
      const keys = ['key1', 'key2'];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(storage.deleteMultiple(keys)).rejects.toThrow(
        'etcd txn failed: 500 Internal Server Error'
      );
    });

    it('should chunk operations exceeding 128 item limit', async () => {
      const keys = Array.from({ length: 200 }, (_, i) => `key${i}`);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
            responses: [],
          }),
      });

      await storage.deleteMultiple(keys);

      // Should have made 2 API calls (128 + 72)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first chunk has 128 operations
      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCallBody.success).toHaveLength(128);

      // Verify second chunk has 72 operations
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.success).toHaveLength(72);
    });

    it('should use single delete operation for single key', async () => {
      const keys = ['key1'];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual([]);
      // Should call the single delete endpoint, not transaction
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2379/v3/kv/deleterange',
        expect.any(Object)
      );
    });

    it('should return empty array for empty keys', async () => {
      const result = await storage.deleteMultiple([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should properly encode keys in base64', async () => {
      const keys = ['test-key', 'test-key-2'];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            succeeded: true,
          }),
      });

      await storage.deleteMultiple(keys);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const deleteOp = callBody.success[0].request_delete_range;

      // Key should be base64 encoded with namespace prefix
      expect(deleteOp.key).toBe(encodeBase64('dp1/test-namespace/test-key'));
    });
  });
});

describe('EtcdStorageProvider', () => {
  let provider: EtcdStorageProvider;
  let mockConfig: EtcdConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      endpoint: 'http://localhost:2379',
      prefix: 'dp1',
    };

    provider = new EtcdStorageProvider(mockConfig);
  });

  describe('constructor', () => {
    it('should create a provider with the provided config', () => {
      expect(provider).toBeInstanceOf(EtcdStorageProvider);
    });
  });

  describe('getPlaylistStorage', () => {
    it('should return an EtcdKVStorage instance for playlists', () => {
      const storage = provider.getPlaylistStorage();

      expect(storage).toBeInstanceOf(EtcdKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistStorage();
      const storage2 = provider.getPlaylistStorage();

      expect(storage1).toBe(storage2);
    });

    it('should use correct namespace for playlists', () => {
      const storage = provider.getPlaylistStorage();
      const key = 'test-key';
      const expectedKey = 'dp1/playlists/test-key';

      const result = (storage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });
  });

  describe('getChannelStorage', () => {
    it('should return an EtcdKVStorage instance for channels', () => {
      const storage = provider.getChannelStorage();

      expect(storage).toBeInstanceOf(EtcdKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getChannelStorage();
      const storage2 = provider.getChannelStorage();

      expect(storage1).toBe(storage2);
    });

    it('should use correct namespace for channels', () => {
      const storage = provider.getChannelStorage();
      const key = 'test-key';
      const expectedKey = 'dp1/playlist-groups/test-key';

      const result = (storage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });
  });

  describe('getPlaylistItemStorage', () => {
    it('should return an EtcdKVStorage instance for playlist items', () => {
      const storage = provider.getPlaylistItemStorage();

      expect(storage).toBeInstanceOf(EtcdKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistItemStorage();
      const storage2 = provider.getPlaylistItemStorage();

      expect(storage1).toBe(storage2);
    });

    it('should use correct namespace for playlist items', () => {
      const storage = provider.getPlaylistItemStorage();
      const key = 'test-key';
      const expectedKey = 'dp1/playlist-items/test-key';

      const result = (storage as any).getKey(key);
      expect(result).toBe(expectedKey);
    });
  });

  describe('integration tests', () => {
    it('should work with all storage types independently', async () => {
      const playlistStorage = provider.getPlaylistStorage();
      const groupStorage = provider.getChannelStorage();
      const itemStorage = provider.getPlaylistItemStorage();

      // Mock successful responses for all storage types
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3BsYXlsaXN0cy9wbGF5bGlzdC0x', value: 'cGxheWxpc3QtdmFsdWU=' }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3BsYXlsaXN0LWdyb3Vwcy9ncm91cC0x', value: 'Z3JvdXAtdmFsdWU=' }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              kvs: [{ key: 'ZHAxL3BsYXlsaXN0LWl0ZW1zL2l0ZW0tMQ==', value: 'aXRlbS12YWx1ZQ==' }],
            }),
        });

      const playlistResult = await playlistStorage.get('playlist-1');
      const groupResult = await groupStorage.get('group-1');
      const itemResult = await itemStorage.get('item-1');

      expect(playlistResult).toBe('playlist-value');
      expect(groupResult).toBe('group-value');
      expect(itemResult).toBe('item-value');
    });

    it('should handle authentication across all storage types', () => {
      const authConfig = {
        ...mockConfig,
        username: 'test-user',
        password: 'test-pass',
      };
      const authProvider = new EtcdStorageProvider(authConfig);

      const playlistStorage = authProvider.getPlaylistStorage();
      const groupStorage = authProvider.getChannelStorage();
      const itemStorage = authProvider.getPlaylistItemStorage();

      // All storage instances should have the same authentication config
      expect(playlistStorage).toBeInstanceOf(EtcdKVStorage);
      expect(groupStorage).toBeInstanceOf(EtcdKVStorage);
      expect(itemStorage).toBeInstanceOf(EtcdKVStorage);
    });
  });
});
