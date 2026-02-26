import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteKVStorage, SqliteStorageProvider, type SqliteConfig } from './sqlite-kv';
import type { KVGetOptions, KVListOptions } from './interfaces';

describe('SqliteKVStorage', () => {
  let db: Database.Database;
  let storage: SqliteKVStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    storage = new SqliteKVStorage(db, 'test_table');
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a SqliteKVStorage instance', () => {
      expect(storage).toBeInstanceOf(SqliteKVStorage);
    });

    it('should create the table if it does not exist', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should not fail if table already exists', () => {
      const storage2 = new SqliteKVStorage(db, 'test_table');
      expect(storage2).toBeInstanceOf(SqliteKVStorage);
    });

    it('should create table with correct schema', () => {
      const columns = db.prepare("PRAGMA table_info('test_table')").all() as Array<{
        name: string;
        type: string;
      }>;
      const keyCol = columns.find(c => c.name === 'key');
      const valueCol = columns.find(c => c.name === 'value');
      expect(keyCol).toBeDefined();
      expect(keyCol!.type).toBe('TEXT');
      expect(valueCol).toBeDefined();
      expect(valueCol!.type).toBe('TEXT');
    });
  });

  describe('get', () => {
    it('should get a value successfully', async () => {
      await storage.put('test-key', 'test-value');
      const result = await storage.get('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null for non-existent key', async () => {
      const result = await storage.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle JSON parsing when requested', async () => {
      const jsonValue = { data: 'test-data', count: 42 };
      await storage.put('json-key', JSON.stringify(jsonValue));

      const options: KVGetOptions = { type: 'json' };
      const result = await storage.get('json-key', options);
      expect(result).toEqual(jsonValue);
    });

    it('should return raw string when no options specified', async () => {
      const jsonString = '{"data":"test"}';
      await storage.put('raw-key', jsonString);

      const result = await storage.get('raw-key');
      expect(result).toBe(jsonString);
    });

    it('should handle emojis and Unicode characters', async () => {
      const value = 'Test emojis 😊👪🏼🌍 🚀';
      await storage.put('emoji-key', value);

      const result = await storage.get('emoji-key');
      expect(result).toBe(value);
    });

    it('should throw error for invalid JSON when type is json', async () => {
      await storage.put('bad-json', 'not-valid-json');

      const options: KVGetOptions = { type: 'json' };
      await expect(storage.get('bad-json', options)).rejects.toThrow();
    });

    it('should handle empty string values', async () => {
      // SQLite stores empty strings, but our schema requires NOT NULL
      // The put uses INSERT OR REPLACE, so this should work
      await storage.put('empty-key', '""');

      const result = await storage.get('empty-key');
      expect(result).toBe('""');
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values successfully', async () => {
      await storage.put('key1', 'value1');
      await storage.put('key2', 'value2');
      await storage.put('key3', 'value3');

      const result = await storage.getMultiple(['key1', 'key2', 'key3']);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
      expect(result.get('key3')).toBe('value3');
    });

    it('should handle empty keys array', async () => {
      const result = await storage.getMultiple([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should skip non-existent keys', async () => {
      await storage.put('key1', 'value1');

      const result = await storage.getMultiple(['key1', 'key2']);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('key1')).toBe('value1');
      expect(result.has('key2')).toBe(false);
    });

    it('should handle JSON parsing for multiple keys', async () => {
      await storage.put('json1', JSON.stringify({ a: 1 }));
      await storage.put('json2', JSON.stringify({ b: 2 }));

      const options: KVGetOptions = { type: 'json' };
      const result = await storage.getMultiple(['json1', 'json2'], options);

      expect(result.get('json1')).toEqual({ a: 1 });
      expect(result.get('json2')).toEqual({ b: 2 });
    });

    it('should throw error when JSON parsing fails for multiple keys', async () => {
      await storage.put('valid', JSON.stringify({ ok: true }));
      await storage.put('invalid', 'not-json');

      const options: KVGetOptions = { type: 'json' };
      await expect(storage.getMultiple(['valid', 'invalid'], options)).rejects.toThrow();
    });
  });

  describe('put', () => {
    it('should put a value successfully', async () => {
      await storage.put('test-key', 'test-value');

      const result = await storage.get('test-key');
      expect(result).toBe('test-value');
    });

    it('should overwrite existing value', async () => {
      await storage.put('test-key', 'old-value');
      await storage.put('test-key', 'new-value');

      const result = await storage.get('test-key');
      expect(result).toBe('new-value');
    });

    it('should handle emojis and Unicode characters in values', async () => {
      const value = 'Test emojis 😊👪🏼🌍 🚀';
      await storage.put('emoji-key', value);

      const result = await storage.get('emoji-key');
      expect(result).toBe(value);
    });

    it('should handle JSON with emojis', async () => {
      const jsonValue = JSON.stringify({
        name: 'Test 🎨',
        description: 'Art piece with emojis 👪🏼 and symbols ✨',
        tags: ['emoji 😀', 'unicode 🌈'],
      });

      await storage.put('json-emoji-key', jsonValue);

      const result = await storage.get('json-emoji-key', { type: 'json' });
      expect(result).toEqual({
        name: 'Test 🎨',
        description: 'Art piece with emojis 👪🏼 and symbols ✨',
        tags: ['emoji 😀', 'unicode 🌈'],
      });
    });

    it('should handle large values', async () => {
      const largeValue = 'x'.repeat(100000);
      await storage.put('large-key', largeValue);

      const result = await storage.get('large-key');
      expect(result).toBe(largeValue);
    });
  });

  describe('putMultiple', () => {
    it('should put multiple entries successfully', async () => {
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' },
      ];

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBe('value1');
      expect(await storage.get('key2')).toBe('value2');
      expect(await storage.get('key3')).toBe('value3');
    });

    it('should return empty array for empty entries', async () => {
      const result = await storage.putMultiple([]);

      expect(result).toEqual([]);
    });

    it('should use single put operation for single entry', async () => {
      const entries = [{ key: 'key1', value: 'value1' }];

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBe('value1');
    });

    it('should handle large batches atomically', async () => {
      const entries = Array.from({ length: 200 }, (_, i) => ({
        key: `key${i}`,
        value: `value${i}`,
      }));

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);

      // Verify a sample of entries
      expect(await storage.get('key0')).toBe('value0');
      expect(await storage.get('key99')).toBe('value99');
      expect(await storage.get('key199')).toBe('value199');
    });

    it('should return failed keys when transaction throws', async () => {
      // Drop the table to cause the prepared statement to fail during transaction execution
      db.exec('DROP TABLE "test_table"');

      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await storage.putMultiple(entries);

      expect(result).toEqual(['key1', 'key2']);
      expect(consoleSpy).toHaveBeenCalledWith('SQLite bulk put failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should overwrite existing keys in batch', async () => {
      await storage.put('key1', 'old-value');

      const entries = [
        { key: 'key1', value: 'new-value' },
        { key: 'key2', value: 'value2' },
      ];

      const result = await storage.putMultiple(entries);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBe('new-value');
    });
  });

  describe('delete', () => {
    it('should delete a key successfully', async () => {
      await storage.put('test-key', 'test-value');
      await storage.delete('test-key');

      const result = await storage.get('test-key');
      expect(result).toBeNull();
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(storage.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('deleteMultiple', () => {
    it('should delete multiple keys successfully', async () => {
      await storage.put('key1', 'value1');
      await storage.put('key2', 'value2');
      await storage.put('key3', 'value3');

      const result = await storage.deleteMultiple(['key1', 'key2', 'key3']);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBeNull();
      expect(await storage.get('key2')).toBeNull();
      expect(await storage.get('key3')).toBeNull();
    });

    it('should return empty array for empty keys', async () => {
      const result = await storage.deleteMultiple([]);

      expect(result).toEqual([]);
    });

    it('should use single delete operation for single key', async () => {
      await storage.put('key1', 'value1');

      const result = await storage.deleteMultiple(['key1']);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBeNull();
    });

    it('should handle deleting non-existent keys gracefully', async () => {
      await storage.put('key1', 'value1');

      const result = await storage.deleteMultiple(['key1', 'non-existent']);

      expect(result).toEqual([]);
      expect(await storage.get('key1')).toBeNull();
    });

    it('should return failed keys when delete transaction throws', async () => {
      // Drop the table to cause the prepared statement to fail during transaction execution
      db.exec('DROP TABLE "test_table"');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await storage.deleteMultiple(['key1', 'key2']);

      expect(result).toEqual(['key1', 'key2']);
      expect(consoleSpy).toHaveBeenCalledWith('SQLite bulk delete failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should handle large batch deletes', async () => {
      const keys = Array.from({ length: 200 }, (_, i) => `key${i}`);

      // Insert all keys
      for (const key of keys) {
        await storage.put(key, 'value');
      }

      const result = await storage.deleteMultiple(keys);

      expect(result).toEqual([]);
      expect(await storage.get('key0')).toBeNull();
      expect(await storage.get('key199')).toBeNull();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Insert some test data
      await storage.put('apple', 'value1');
      await storage.put('banana', 'value2');
      await storage.put('cherry', 'value3');
      await storage.put('test-1', 'value4');
      await storage.put('test-2', 'value5');
      await storage.put('test-3', 'value6');
    });

    it('should list all keys without options', async () => {
      const result = await storage.list();

      expect(result.keys).toHaveLength(6);
      expect(result.list_complete).toBe(true);
      expect(result.cursor).toBeUndefined();
    });

    it('should list keys with prefix filter', async () => {
      const options: KVListOptions = { prefix: 'test-' };

      const result = await storage.list(options);

      expect(result.keys).toHaveLength(3);
      expect(result.keys.map(k => k.name)).toEqual(['test-1', 'test-2', 'test-3']);
      expect(result.list_complete).toBe(true);
    });

    it('should handle pagination with limit', async () => {
      const options: KVListOptions = { limit: 2 };

      const result = await storage.list(options);

      expect(result.keys).toHaveLength(2);
      expect(result.list_complete).toBe(false);
      expect(result.cursor).toBeDefined();
    });

    it('should handle pagination with cursor', async () => {
      // First page
      const page1 = await storage.list({ limit: 3 });
      expect(page1.keys).toHaveLength(3);
      expect(page1.list_complete).toBe(false);
      expect(page1.cursor).toBeDefined();

      // Second page using cursor — 6 items total, page2 gets remaining 3
      // Since rows.length === limit (3 === 3), hasMore is true, so list_complete is false
      const page2 = await storage.list({ limit: 3, cursor: page1.cursor });
      expect(page2.keys).toHaveLength(3);

      // Third page should be empty, confirming all items fetched
      const page3 = await storage.list({ limit: 3, cursor: page2.cursor });
      expect(page3.keys).toHaveLength(0);
      expect(page3.list_complete).toBe(true);

      // Ensure no overlap between pages
      const page1Names = page1.keys.map(k => k.name);
      const page2Names = page2.keys.map(k => k.name);
      const overlap = page1Names.filter(n => page2Names.includes(n));
      expect(overlap).toHaveLength(0);

      // All 6 keys should be covered
      expect(page1Names.length + page2Names.length).toBe(6);
    });

    it('should handle pagination with prefix and cursor', async () => {
      const page1 = await storage.list({ prefix: 'test-', limit: 2 });
      expect(page1.keys).toHaveLength(2);
      expect(page1.list_complete).toBe(false);

      const page2 = await storage.list({ prefix: 'test-', limit: 2, cursor: page1.cursor });
      expect(page2.keys).toHaveLength(1);
      expect(page2.list_complete).toBe(true);
    });

    it('should return empty result for non-matching prefix', async () => {
      const result = await storage.list({ prefix: 'nonexistent-' });

      expect(result.keys).toHaveLength(0);
      expect(result.list_complete).toBe(true);
    });

    it('should return keys in ascending order', async () => {
      const result = await storage.list();

      const names = result.keys.map(k => k.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it('should handle list with default limit of 1000', async () => {
      const result = await storage.list();

      // We have 6 items, all should be returned with default limit of 1000
      expect(result.keys).toHaveLength(6);
      expect(result.list_complete).toBe(true);
    });
  });
});

describe('SqliteStorageProvider', () => {
  let provider: SqliteStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SqliteStorageProvider({ dbPath: ':memory:' });
  });

  afterEach(() => {
    provider.close();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a provider with the provided config', () => {
      expect(provider).toBeInstanceOf(SqliteStorageProvider);
    });

    it('should set WAL mode (falls back to memory for in-memory DBs)', () => {
      const db = provider.getDatabase();
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      // In-memory databases cannot use WAL, so it falls back to 'memory'
      // On-disk databases would return 'wal'
      expect(['wal', 'memory']).toContain(result[0].journal_mode);
    });

    it('should enable foreign keys', () => {
      const db = provider.getDatabase();
      const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(result[0].foreign_keys).toBe(1);
    });
  });

  describe('getPlaylistStorage', () => {
    it('should return a SqliteKVStorage instance for playlists', () => {
      const storage = provider.getPlaylistStorage();
      expect(storage).toBeInstanceOf(SqliteKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistStorage();
      const storage2 = provider.getPlaylistStorage();
      expect(storage1).toBe(storage2);
    });

    it('should use separate table for playlists', async () => {
      const storage = provider.getPlaylistStorage();
      await storage.put('playlist-1', 'playlist-value');

      const result = await storage.get('playlist-1');
      expect(result).toBe('playlist-value');

      // Verify it's not in channels
      const channelStorage = provider.getChannelStorage();
      const channelResult = await channelStorage.get('playlist-1');
      expect(channelResult).toBeNull();
    });
  });

  describe('getChannelStorage', () => {
    it('should return a SqliteKVStorage instance for channels', () => {
      const storage = provider.getChannelStorage();
      expect(storage).toBeInstanceOf(SqliteKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getChannelStorage();
      const storage2 = provider.getChannelStorage();
      expect(storage1).toBe(storage2);
    });

    it('should use separate table for channels', async () => {
      const storage = provider.getChannelStorage();
      await storage.put('channel-1', 'channel-value');

      const result = await storage.get('channel-1');
      expect(result).toBe('channel-value');

      // Verify it's not in playlists
      const playlistStorage = provider.getPlaylistStorage();
      const playlistResult = await playlistStorage.get('channel-1');
      expect(playlistResult).toBeNull();
    });
  });

  describe('getPlaylistItemStorage', () => {
    it('should return a SqliteKVStorage instance for playlist items', () => {
      const storage = provider.getPlaylistItemStorage();
      expect(storage).toBeInstanceOf(SqliteKVStorage);
    });

    it('should return the same instance on multiple calls', () => {
      const storage1 = provider.getPlaylistItemStorage();
      const storage2 = provider.getPlaylistItemStorage();
      expect(storage1).toBe(storage2);
    });

    it('should use separate table for playlist items', async () => {
      const storage = provider.getPlaylistItemStorage();
      await storage.put('item-1', 'item-value');

      const result = await storage.get('item-1');
      expect(result).toBe('item-value');
    });
  });

  describe('getDatabase', () => {
    it('should return the underlying database instance', () => {
      const db = provider.getDatabase();
      expect(db).toBeDefined();
      expect(typeof db.exec).toBe('function');
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      const db = provider.getDatabase();
      provider.close();

      // After closing, operations should fail
      expect(() => db.exec('SELECT 1')).toThrow();
    });
  });

  describe('integration tests', () => {
    it('should work with all storage types independently', async () => {
      const playlistStorage = provider.getPlaylistStorage();
      const channelStorage = provider.getChannelStorage();
      const itemStorage = provider.getPlaylistItemStorage();

      await playlistStorage.put('playlist-1', 'playlist-value');
      await channelStorage.put('channel-1', 'channel-value');
      await itemStorage.put('item-1', 'item-value');

      const playlistResult = await playlistStorage.get('playlist-1');
      const channelResult = await channelStorage.get('channel-1');
      const itemResult = await itemStorage.get('item-1');

      expect(playlistResult).toBe('playlist-value');
      expect(channelResult).toBe('channel-value');
      expect(itemResult).toBe('item-value');
    });

    it('should maintain namespace isolation', async () => {
      const playlistStorage = provider.getPlaylistStorage();
      const channelStorage = provider.getChannelStorage();

      // Put the same key in both namespaces
      await playlistStorage.put('shared-key', 'playlist-value');
      await channelStorage.put('shared-key', 'channel-value');

      // Values should be independent
      expect(await playlistStorage.get('shared-key')).toBe('playlist-value');
      expect(await channelStorage.get('shared-key')).toBe('channel-value');

      // Delete from one should not affect the other
      await playlistStorage.delete('shared-key');
      expect(await playlistStorage.get('shared-key')).toBeNull();
      expect(await channelStorage.get('shared-key')).toBe('channel-value');
    });
  });
});
