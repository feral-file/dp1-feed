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

/**
 * etcd v3 implementation of the KeyValueStorage interface using REST API
 * Compatible with workerd runtime (no Node.js dependencies)
 */
export class EtcdKVStorage implements KeyValueStorage {
  private config: EtcdConfig;
  private namespace: string;

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
          key: btoa(etcdKey),
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

      const value = atob(data.kvs[0]!.value);

      // Handle JSON parsing if requested
      if (options?.type === 'json') {
        try {
          return JSON.parse(value);
        } catch (parseError) {
          console.error(`Error parsing JSON for key ${key}:`, parseError);
          return null;
        }
      }

      return value;
    } catch (error) {
      console.error(`Error getting key ${key} from etcd:`, error);
      return null;
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
      return resultMap;
    }
  }

  async put(key: string, value: string): Promise<void> {
    try {
      const etcdKey = this.getKey(key);
      const response = await this.makeRequest('/v3/kv/put', {
        method: 'POST',
        body: JSON.stringify({
          key: btoa(etcdKey),
          value: btoa(value),
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
          key: btoa(etcdKey),
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

  async list(options?: KVListOptions): Promise<KVListResult> {
    try {
      const prefix = this.getKey(options?.prefix || '');
      const limit = options?.limit || 1000;

      const body: any = {
        key: btoa(prefix),
        range_end: btoa(prefix + '\0'), // Get all keys with this prefix
        limit: limit,
      };

      // Handle cursor for pagination
      if (options?.cursor) {
        try {
          const cursorKey = atob(options.cursor);
          body.key = btoa(cursorKey);
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
        const fullKey = atob(kv.key);
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
        // Use the last key as cursor for next page
        const lastKey = atob(kvs[kvs.length - 1]!.key);
        cursor = btoa(lastKey + '\0'); // Increment for next range
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
  private playlistGroupStorage: EtcdKVStorage;
  private playlistItemStorage: EtcdKVStorage;

  constructor(config: EtcdConfig) {
    this.playlistStorage = new EtcdKVStorage(config, 'playlists');
    this.playlistGroupStorage = new EtcdKVStorage(config, 'playlist-groups');
    this.playlistItemStorage = new EtcdKVStorage(config, 'playlist-items');
  }

  getPlaylistStorage(): KeyValueStorage {
    return this.playlistStorage;
  }

  getPlaylistGroupStorage(): KeyValueStorage {
    return this.playlistGroupStorage;
  }

  getPlaylistItemStorage(): KeyValueStorage {
    return this.playlistItemStorage;
  }
}
