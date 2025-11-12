import type { KVNamespace } from '@cloudflare/workers-types';
import type {
  KeyValueStorage,
  StorageProvider,
  KVListResult,
  KVListOptions,
  KVGetOptions,
} from './interfaces';

/**
 * CloudFlare KV implementation of the KeyValueStorage interface
 */
export class CloudFlareKVStorage implements KeyValueStorage {
  constructor(private kv: KVNamespace) {}

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

  async put(key: string, value: string): Promise<void> {
    await this.kv.put(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    return this.kv.list(options);
  }
}

/**
 * CloudFlare storage provider that provides access to KV namespaces
 */
export class CloudFlareStorageProvider implements StorageProvider {
  private playlistStorage: CloudFlareKVStorage;
  private playlistItemStorage: CloudFlareKVStorage;
  private starStorage: CloudFlareKVStorage;

  constructor(
    playlistKV: KVNamespace,
    playlistItemKV: KVNamespace,
    starKV: KVNamespace
  ) {
    this.playlistStorage = new CloudFlareKVStorage(playlistKV);
    this.playlistItemStorage = new CloudFlareKVStorage(playlistItemKV);
    this.starStorage = new CloudFlareKVStorage(starKV);
  }

  getPlaylistStorage(): KeyValueStorage {
    return this.playlistStorage;
  }

  getPlaylistItemStorage(): KeyValueStorage {
    return this.playlistItemStorage;
  }

  getStarStorage(): KeyValueStorage {
    return this.starStorage;
  }
}
