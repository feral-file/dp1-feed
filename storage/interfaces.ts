export interface KVListResult<K = string, V = unknown> {
  keys: Array<{ name: K; metadata?: V }>;
  list_complete: boolean;
  cursor?: string;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface KVGetOptions {
  type?: 'text' | 'json' | 'arrayBuffer' | 'stream';
}

/**
 * Generic key-value storage interface that abstracts the underlying storage implementation
 */
export interface KeyValueStorage {
  /**
   * Get a value by key
   */
  get(key: string, options?: KVGetOptions): Promise<string | null>;

  /**
   * Get multiple values by keys (batch operation)
   * Returns a Map where keys that don't exist are not included
   */
  getMultiple(keys: string[], options?: KVGetOptions): Promise<Map<string, any>>;

  /**
   * Put a value with a key
   */
  put(key: string, value: string): Promise<void>;

  /**
   * Delete a value by key
   */
  delete(key: string): Promise<void>;

  /**
   * List keys with optional prefix filtering and pagination
   */
  list(options?: KVListOptions): Promise<KVListResult>;
}

/**
 * Storage provider interface that provides access to different storage namespaces
 */
export interface StorageProvider {
  /**
   * Get the playlist storage namespace
   */
  getPlaylistStorage(): KeyValueStorage;

  /**
   * Get the playlist items storage namespace
   */
  getPlaylistItemStorage(): KeyValueStorage;
}

export interface PaginatedResult<T> {
  items: T[];
  cursor?: string;
  hasMore: boolean;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
  sort?: 'asc' | 'desc';
}
