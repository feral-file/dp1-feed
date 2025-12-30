import type {
  KeyValueStorage,
  StorageProvider,
  KVListResult,
  KVListOptions,
  KVGetOptions,
} from './interfaces';

/**
 * Configuration for etcd connection
 */
export interface EtcdConfig {
  endpoint: string;
  username?: string;
  password?: string;
  prefix?: string;
}

/**
 * etcd v3 API response types
 */
interface EtcdKV {
  key: string;
  value: string;
  create_revision?: string;
  mod_revision?: string;
  version?: string;
}

interface EtcdRangeResponse {
  header?: {
    cluster_id?: string;
    member_id?: string;
    revision?: string;
    raft_term?: string;
  };
  kvs?: EtcdKV[];
  more?: boolean;
  count?: string;
}

interface EtcdTxnResponse {
  header?: {
    cluster_id?: string;
    member_id?: string;
    revision?: string;
    raft_term?: string;
  };
  succeeded?: boolean;
  responses?: Array<{
    response_put?: any;
    response_delete_range?: any;
  }>;
}

/**
 * etcd v3 implementation of the KeyValueStorage interface using REST API
 * Compatible with workerd runtime (no Node.js dependencies)
 */
export class EtcdKVStorage implements KeyValueStorage {
  private config: EtcdConfig;
  private namespace: string;
  private readonly BULK_WRITE_LIMIT = 128; // etcd transaction limit (conservative)

  constructor(config: EtcdConfig, namespace: string = '') {
    this.config = config;
    this.namespace = namespace;
  }

  private getKey(key: string): string {
    const prefix = this.config.prefix || 'dp1';
    return this.namespace ? `${prefix}/${this.namespace}/${key}` : `${prefix}/${key}`;
  }

  private async makeRequest(path: string, options: any = {}): Promise<Response> {
    const url = `${this.config.endpoint}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // Add basic auth if configured
    if (this.config.username && this.config.password) {
      const auth = btoa(`${this.config.username}:${this.config.password}`);
      headers['Authorization'] = `Basic ${auth}`;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  async get(key: string, options?: KVGetOptions): Promise<string | null> {
    try {
      const etcdKey = this.getKey(key);
      const response = await this.makeRequest('/v3/kv/range', {
        method: 'POST',
        body: JSON.stringify({
          key: encodeBase64(etcdKey),
        }),
      });

      if (!response.ok) {
        console.error(`etcd get failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = (await response.json()) as EtcdRangeResponse;
      if (!data.kvs || data.kvs.length === 0) {
        return null;
      }

      const value = decodeBase64(data.kvs[0]!.value);

      // Handle JSON parsing if requested
      if (options?.type === 'json') {
        try {
          return JSON.parse(value);
        } catch (parseError) {
          console.error(`Error parsing JSON for key ${key}:`, parseError);
          throw parseError;
        }
      }

      return value;
    } catch (error) {
      console.error(`Error getting key ${key} from etcd:`, error);
      throw error;
    }
  }

  async getMultiple(keys: string[], options?: KVGetOptions): Promise<Map<string, any>> {
    const resultMap = new Map<string, any>();

    if (keys.length === 0) return resultMap;

    try {
      // etcd doesn't have native batch get, so we'll do concurrent individual gets
      const promises = keys.map(async key => {
        const value = await this.get(key, options);
        return { key, value };
      });

      const results = await Promise.all(promises);

      for (const { key, value } of results) {
        if (value !== null) {
          resultMap.set(key, value);
        }
      }

      return resultMap;
    } catch (error) {
      console.error('Error getting multiple keys from etcd:', error);
      throw error;
    }
  }

  async put(key: string, value: string): Promise<void> {
    try {
      const etcdKey = this.getKey(key);
      const response = await this.makeRequest('/v3/kv/put', {
        method: 'POST',
        body: JSON.stringify({
          key: encodeBase64(etcdKey),
          value: encodeBase64(value),
        }),
      });

      if (!response.ok) {
        throw new Error(`etcd put failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error putting key ${key} to etcd:`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const etcdKey = this.getKey(key);
      const response = await this.makeRequest('/v3/kv/deleterange', {
        method: 'POST',
        body: JSON.stringify({
          key: encodeBase64(etcdKey),
        }),
      });

      if (!response.ok) {
        throw new Error(`etcd delete failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error deleting key ${key} from etcd:`, error);
      throw error;
    }
  }

  /**
   * Bulk write operation uses etcd transaction API
   * Handles chunking for requests exceeding 128 items
   */
  async putMultiple(entries: Array<{ key: string; value: string }>): Promise<string[]> {
    if (entries.length === 0) return [];

    // If there is only one entry, use the single write operation
    if (entries.length === 1) {
      await this.put(entries[0]!.key, entries[0]!.value);
      return [];
    }

    const unsuccessfulKeys: string[] = [];
    const chunks = this.chunkArray(entries, this.BULK_WRITE_LIMIT);

    for (const chunk of chunks) {
      // Build transaction with put operations
      const ops = chunk.map(entry => ({
        request_put: {
          key: encodeBase64(this.getKey(entry.key)),
          value: encodeBase64(entry.value),
        },
      }));

      const response = await this.makeRequest('/v3/kv/txn', {
        method: 'POST',
        body: JSON.stringify({
          success: ops,
        }),
      });

      if (!response.ok) {
        throw new Error(`etcd txn failed: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as EtcdTxnResponse;

      if (!result.succeeded) {
        // If transaction failed, add all keys from this chunk
        unsuccessfulKeys.push(...chunk.map(e => e.key));
      }
    }

    return unsuccessfulKeys;
  }

  /**
   * Bulk delete operation uses etcd transaction API
   * Handles chunking for requests exceeding 500 items
   */
  async deleteMultiple(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    // If there is only one key, use the single delete operation
    if (keys.length === 1) {
      await this.delete(keys[0]!);
      return [];
    }

    const unsuccessfulKeys: string[] = [];
    const chunks = this.chunkArray(keys, this.BULK_WRITE_LIMIT);

    for (const chunk of chunks) {
      // Build transaction with delete operations
      const ops = chunk.map(key => ({
        request_delete_range: {
          key: encodeBase64(this.getKey(key)),
        },
      }));

      const response = await this.makeRequest('/v3/kv/txn', {
        method: 'POST',
        body: JSON.stringify({
          success: ops,
        }),
      });

      if (!response.ok) {
        throw new Error(`etcd txn failed: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as EtcdTxnResponse;

      if (!result.succeeded) {
        // If transaction failed, add all keys from this chunk
        unsuccessfulKeys.push(...chunk);
      }
    }

    return unsuccessfulKeys;
  }

  /**
   * Chunk an array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    try {
      const prefix = this.getKey(options?.prefix || '');
      const limit = options?.limit || 1000;

      // Calculate range_end by incrementing the last byte of the prefix
      const rangeEnd = incrementString(prefix);

      const body: any = {
        key: encodeBase64(prefix),
        range_end: encodeBase64(rangeEnd), // Get all keys with this prefix
        limit: limit,
      };

      // Handle cursor for pagination
      if (options?.cursor) {
        try {
          const cursorKey = decodeBase64(options.cursor);
          body.key = encodeBase64(cursorKey);
        } catch (error) {
          console.error('Invalid cursor provided:', error);
        }
      }

      const response = await this.makeRequest('/v3/kv/range', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`etcd list failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as EtcdRangeResponse;
      const kvs = data.kvs || [];

      const keys = kvs.map(kv => {
        const fullKey = decodeBase64(kv.key);
        // Remove the namespace prefix to get the original key
        const prefixToRemove = this.getKey('');
        const name = fullKey.startsWith(prefixToRemove)
          ? fullKey.substring(prefixToRemove.length).replace(/^\//, '')
          : fullKey;

        return { name };
      });

      // Determine if there are more results
      const hasMore = data.more === true || kvs.length === limit;
      let cursor: string | undefined;

      if (hasMore && kvs.length > 0) {
        // Use the last key + 1 as cursor for next page to avoid duplicates
        const lastKey = decodeBase64(kvs[kvs.length - 1]!.key);
        const nextKey = incrementString(lastKey);
        cursor = encodeBase64(nextKey);
      }

      return {
        keys,
        list_complete: !hasMore,
        cursor,
      };
    } catch (error) {
      console.error('Error listing keys from etcd:', error);
      return {
        keys: [],
        list_complete: true,
      };
    }
  }
}

/**
 * etcd storage provider that provides access to different namespaces
 */
export class EtcdStorageProvider implements StorageProvider {
  private playlistStorage: EtcdKVStorage;
  private channelStorage: EtcdKVStorage;
  private playlistItemStorage: EtcdKVStorage;

  constructor(config: EtcdConfig) {
    this.playlistStorage = new EtcdKVStorage(config, 'playlists');
    this.channelStorage = new EtcdKVStorage(config, 'playlist-groups');
    this.playlistItemStorage = new EtcdKVStorage(config, 'playlist-items');
  }

  getPlaylistStorage(): KeyValueStorage {
    return this.playlistStorage;
  }

  getChannelStorage(): KeyValueStorage {
    return this.channelStorage;
  }

  getPlaylistItemStorage(): KeyValueStorage {
    return this.playlistItemStorage;
  }
}

/**
 * Helper functions for UTF-8 safe base64 encoding/decoding
 */
export function encodeBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Increment a string by one byte, for etcd range queries
 */
export function incrementString(str: string): string {
  // Convert string to byte array
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(bytes.length + 1);
  result.set(bytes);

  // Increment the last byte, handling overflow
  let i = bytes.length - 1;
  while (i >= 0) {
    if (bytes[i]! < 255) {
      result[i] = bytes[i]! + 1;
      return new TextDecoder().decode(result.slice(0, bytes.length));
    }
    result[i] = 0;
    i--;
  }

  // If all bytes overflowed, append a byte
  result[bytes.length] = 1;
  return new TextDecoder().decode(result);
}
