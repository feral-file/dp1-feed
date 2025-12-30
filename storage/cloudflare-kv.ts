import type { KVNamespace } from '@cloudflare/workers-types';
import type {
  KeyValueStorage,
  StorageProvider,
  KVListResult,
  KVListOptions,
  KVGetOptions,
} from './interfaces';

/**
 * Configuration for CloudFlare KV API access
 */
export interface CloudFlareKVConfig {
  accountId: string;
  namespaceId: string;
  apiToken: string;
  localBinding?: boolean; // If true, use bindings for bulk ops (for local dev)
}

/**
 * CloudFlare KV API response
 */
interface CloudFlareKVBulkResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: {
    successful_key_count: number;
    unsuccessful_keys?: string[];
  };
}

/**
 * CloudFlare KV implementation with hybrid approach:
 * - Reads use KV bindings for low latency
 * - Single writes use KV bindings for simplicity
 * - Bulk writes use KV API for efficiency (up to 10k items per request)
 */
export class CloudFlareKVStorage implements KeyValueStorage {
  private readonly BULK_WRITE_LIMIT = 10000;

  constructor(
    private kv: KVNamespace,
    private config: CloudFlareKVConfig
  ) {}

  /**
   * Read operations use KV bindings for low latency
   */
  async get(key: string, options?: KVGetOptions): Promise<string | null> {
    return await this.kv.get(key, options as any);
  }

  async getMultiple(keys: string[], options?: KVGetOptions): Promise<Map<string, any>> {
    if (keys.length === 0) return new Map();

    // CloudFlare KV supports native batch gets with up to 100 keys per request
    const resultMap = new Map<string, any>();
    const batchSize = 100;

    // Process keys in batches of 100 using native batch operations
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);

      try {
        // Use native CloudFlare KV batch get operation - returns Map<string, any>
        const batchResults = await this.kv.get(batch, options as any);

        // Handle the case where batchResults might be null (if all keys don't exist)
        if (batchResults instanceof Map) {
          batchResults.forEach((value, key) => {
            if (value !== null) {
              resultMap.set(key, value);
            }
          });
        } else {
          // Fallback: try individual gets for this batch
          console.warn(
            `Batch get returned null, falling back to individual gets for batch:`,
            batch
          );
          for (const key of batch) {
            try {
              const data = await this.kv.get(key, options as any);
              if (data !== null) {
                if (options?.type === 'json' && typeof data === 'string') {
                  try {
                    resultMap.set(key, JSON.parse(data));
                  } catch (parseError) {
                    console.error(`Error parsing JSON for ${key}:`, parseError);
                    throw parseError;
                  }
                } else {
                  resultMap.set(key, data);
                }
              }
            } catch (individualError) {
              console.error(`Error getting key ${key}:`, individualError);
              throw individualError;
            }
          }
        }
      } catch (error) {
        console.error(`Error getting batch of keys:`, error);
        throw error;
      }
    }

    return resultMap;
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    return this.kv.list(options);
  }

  /**
   * Single write operation uses KV binding
   */
  async put(key: string, value: string): Promise<void> {
    await this.kv.put(key, value);
  }

  /**
   * Bulk write operation uses CloudFlare KV API (or bindings for local dev)
   * Handles chunking for requests exceeding 10k items
   */
  async putMultiple(entries: Array<{ key: string; value: string }>): Promise<string[]> {
    if (entries.length === 0) return [];

    // If there is only one entry, use the single write operation
    if (entries.length === 1) {
      await this.put(entries[0]!.key, entries[0]!.value);
      return [];
    }

    // For local development with miniflare, use bindings instead of API
    if (this.config.localBinding) {
      const unsuccessfulKeys: string[] = [];
      for (const entry of entries) {
        try {
          await this.kv.put(entry.key, entry.value);
        } catch (error) {
          console.error(`Failed to put key ${entry.key}:`, error);
          unsuccessfulKeys.push(entry.key);
        }
      }
      return unsuccessfulKeys;
    }

    // Use KV API for bulk operations in deployed environments
    const unsuccessfulKeys: string[] = [];
    const chunks = this.chunkArray(entries, this.BULK_WRITE_LIMIT);

    for (const chunk of chunks) {
      const response = await this.bulkWrite(chunk);
      if (response.unsuccessful_keys) {
        unsuccessfulKeys.push(...response.unsuccessful_keys);
      }
    }

    return unsuccessfulKeys;
  }

  /**
   * Single delete operation uses KV binding
   */
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  /**
   * Bulk delete operation uses CloudFlare KV API (or bindings for local dev)
   * Handles chunking for requests exceeding 10k items
   */
  async deleteMultiple(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    // If there is only one key, use the single delete operation
    if (keys.length === 1) {
      await this.delete(keys[0]!);
      return [];
    }

    // For local development with miniflare, use bindings instead of API
    if (this.config.localBinding) {
      const unsuccessfulKeys: string[] = [];
      for (const key of keys) {
        try {
          await this.kv.delete(key);
        } catch (error) {
          console.error(`Failed to delete key ${key}:`, error);
          unsuccessfulKeys.push(key);
        }
      }
      return unsuccessfulKeys;
    }

    // Use KV API for bulk operations in deployed environments
    const unsuccessfulKeys: string[] = [];
    const chunks = this.chunkArray(keys, this.BULK_WRITE_LIMIT);

    for (const chunk of chunks) {
      const response = await this.bulkDelete(chunk);
      if (response.unsuccessful_keys) {
        unsuccessfulKeys.push(...response.unsuccessful_keys);
      }
    }

    return unsuccessfulKeys;
  }

  /**
   * Call CloudFlare KV bulk write API
   */
  private async bulkWrite(
    operations: Array<{ key: string; value: string }>
  ): Promise<{ successful_key_count: number; unsuccessful_keys?: string[] }> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/storage/kv/namespaces/${this.config.namespaceId}/bulk`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`,
      },
      body: JSON.stringify(operations),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CloudFlare KV bulk write failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = (await response.json()) as CloudFlareKVBulkResponse;

    if (!result.success) {
      throw new Error(`CloudFlare KV bulk write failed: ${JSON.stringify(result.errors)}`);
    }

    return result.result;
  }

  /**
   * Call CloudFlare KV bulk delete API
   */
  private async bulkDelete(
    keys: string[]
  ): Promise<{ successful_key_count: number; unsuccessful_keys?: string[] }> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/storage/kv/namespaces/${this.config.namespaceId}/bulk/delete`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`,
      },
      body: JSON.stringify(keys),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CloudFlare KV bulk delete failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = (await response.json()) as CloudFlareKVBulkResponse;

    if (!result.success) {
      throw new Error(`CloudFlare KV bulk delete failed: ${JSON.stringify(result.errors)}`);
    }

    return result.result;
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
}

/**
 * CloudFlare storage provider that provides access to KV namespaces
 */
export class CloudFlareStorageProvider implements StorageProvider {
  private playlistStorage: CloudFlareKVStorage;
  private channelStorage: CloudFlareKVStorage;
  private playlistItemStorage: CloudFlareKVStorage;

  constructor(
    playlistKV: KVNamespace,
    channelKV: KVNamespace,
    playlistItemKV: KVNamespace,
    playlistConfig: CloudFlareKVConfig,
    channelConfig: CloudFlareKVConfig,
    playlistItemConfig: CloudFlareKVConfig
  ) {
    this.playlistStorage = new CloudFlareKVStorage(playlistKV, playlistConfig);
    this.channelStorage = new CloudFlareKVStorage(channelKV, channelConfig);
    this.playlistItemStorage = new CloudFlareKVStorage(playlistItemKV, playlistItemConfig);
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
