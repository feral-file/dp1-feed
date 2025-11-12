import { Playlist, PlaylistItem } from 'dp1-js';
import type { StorageProvider, KeyValueStorage, PaginatedResult, ListOptions } from './interfaces';

// Updated KV Storage Keys with consistent prefixes
export const STORAGE_KEYS = {
  PLAYLIST_ID_PREFIX: 'playlist:id:', // playlist:id:${playlistId}=>${playlistData}
  PLAYLIST_SLUG_PREFIX: 'playlist:slug:', // playlist:slug:${playlistSlug}=>${playlistId}
  PLAYLIST_ITEM_ID_PREFIX: 'playlist-item:id:', // playlist-item:id:${playlistItemId}=>${playlistItemData}
  // Created-time secondary indexes (asc/desc)
  PLAYLIST_CREATED_ASC_PREFIX: 'playlist:created:asc:', // playlist:created:asc:${timestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_CREATED_DESC_PREFIX: 'playlist:created:desc:', // playlist:created:desc:${invTimestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_ITEM_CREATED_ASC_PREFIX: 'playlist-item:created:asc:', // playlist-item:created:asc:${timestampMs}:${itemId} => ${itemId}
  PLAYLIST_ITEM_CREATED_DESC_PREFIX: 'playlist-item:created:desc:', // playlist-item:created:desc:${invTimestampMs}:${itemId} => ${itemId}
  STAR_PREFIX: 'star:', // star:${playlistId}=>${playlistId}
  STAR_PLAYLIST_CREATED_ASC_PREFIX: 'star:created:asc:', // star:created:asc:${timestampMs}:${playlistId} => ${playlistId}
  STAR_PLAYLIST_CREATED_DESC_PREFIX: 'star:created:desc:', // star:created:desc:${invTimestampMs}:${playlistId} => ${playlistId}
} as const;

/**
 * Storage service that provides high-level operations using storage abstractions
 */
export class StorageService {
  private playlistStorage: KeyValueStorage;
  private playlistItemStorage: KeyValueStorage;
  private starStorage: KeyValueStorage;

  constructor(private readonly storageProvider: StorageProvider) {
    this.playlistStorage = this.storageProvider.getPlaylistStorage();
    this.playlistItemStorage = this.storageProvider.getPlaylistItemStorage();
    this.starStorage = this.storageProvider.getStarStorage();
  }

  /**
   * Get the underlying star storage (for advanced operations)
   */
  getStarStorage(): KeyValueStorage {
    return this.starStorage;
  }

  /**
   * Generic helper function to batch fetch data from storage
   */
  private async batchFetchFromStorage<T>(
    keys: string[],
    storage: KeyValueStorage,
    errorContext: string
  ): Promise<T[]> {
    if (keys.length === 0) return [];

    try {
      const results = await storage.getMultiple(keys, { type: 'json' });
      const orderedResults: T[] = [];

      if (results instanceof Map) {
        // Return results in the same order as input keys
        for (const key of keys) {
          const result = results.get(key);
          if (result) {
            orderedResults.push(result as T);
          }
        }
      }

      return orderedResults;
    } catch (error) {
      console.error(`Error in batch fetch for ${errorContext}:`, error);
      // Fallback to sequential fetching
      const orderedResults: T[] = [];
      for (const key of keys) {
        try {
          const data = await storage.get(key, { type: 'json' });
          if (data) {
            try {
              orderedResults.push(JSON.parse(data) as T);
            } catch (parseError) {
              console.error(`Error parsing JSON for ${key}:`, parseError);
            }
          }
        } catch (error) {
          console.error(`Error processing ${errorContext} ${key}:`, error);
        }
      }
      return orderedResults;
    }
  }

  /**
   * Utility: produce sortable timestamp strings for asc/desc indexes
   */
  private toSortableTimestamps(isoTimestamp: string): { asc: string; desc: string } {
    const ms = Number.isFinite(Number(isoTimestamp))
      ? Number(isoTimestamp)
      : Date.parse(isoTimestamp);
    const padded = String(ms).padStart(13, '0');
    const maxMs = 9999999999999; // ~ Sat Nov 20 2286
    const inv = String(maxMs - ms).padStart(13, '0');
    return { asc: padded, desc: inv };
  }

  /**
   * Utility function to resolve identifier (UUID or slug) to actual ID
   */
  private async resolveIdentifierToId(
    identifier: string,
    slugPrefix: string,
    storage: KeyValueStorage
  ): Promise<string | null> {
    // Check if it's a UUID (if not, assume it's a slug)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier
    );

    if (isUuid) {
      return identifier;
    } else {
      // It's a slug, get the ID
      return await storage.get(`${slugPrefix}${identifier}`);
    }
  }

  /**
   * Save a playlist with multiple indexes for efficient retrieval
   */
  async savePlaylist(playlist: Playlist, update: boolean = false): Promise<boolean> {
    // Prepare all operations in a single batch
    const operations: Promise<void>[] = [];
    const playlistData = JSON.stringify(playlist);
    let existingPlaylist: Playlist | null = null;

    if (update) {
      existingPlaylist = await this.getPlaylistByIdOrSlug(playlist.id);
      if (!existingPlaylist) {
        throw new Error(`Playlist ${playlist.id} not found`);
      }
    }

    // Core playlist operations
    operations.push(
      this.playlistStorage.put(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlist.id}`, playlistData),
      this.playlistStorage.put(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${playlist.slug}`, playlist.id)
    );

    // Created-time indexes for playlists
    if (playlist.created) {
      const ts = this.toSortableTimestamps(playlist.created);
      operations.push(
        this.playlistStorage.put(
          `${STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX}${ts.asc}:${playlist.id}`,
          playlist.id
        ),
        this.playlistStorage.put(
          `${STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX}${ts.desc}:${playlist.id}`,
          playlist.id
        )
      );
    }

    // Handle old items deletion (if updating)
    // FIXME this assumes that the playlist items always be updated, which is not the case.
    // We need to handle the case where the playlist items are not updated.
    if (update && existingPlaylist) {
      // Delete all items
      for (const item of existingPlaylist.items) {
        operations.push(
          this.playlistItemStorage.delete(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`)
        );
        // Delete created-time indexes for items using item's created
        if (item.created) {
          const oldTs = this.toSortableTimestamps(item.created);
          operations.push(
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${oldTs.asc}:${item.id}`
            ),
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${oldTs.desc}:${item.id}`
            )
          );
        }
      }
    }

    // Add new items
    for (const item of playlist.items) {
      const itemData = JSON.stringify(item);
      operations.push(
        this.playlistItemStorage.put(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`, itemData)
      );
      // Global created-time indexes for items using item's created
      if (item.created) {
        const ts = this.toSortableTimestamps(item.created);
        operations.push(
          this.playlistItemStorage.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${ts.asc}:${item.id}`,
            item.id
          ),
          this.playlistItemStorage.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${ts.desc}:${item.id}`,
            item.id
          )
        );
      }
    }

    // Execute all operations in parallel
    await Promise.all(operations);

    return true;
  }

  /**
   * Get a playlist by ID or slug
   */
  async getPlaylistByIdOrSlug(identifier: string): Promise<Playlist | null> {
    const playlistId = await this.resolveIdentifierToId(
      identifier,
      STORAGE_KEYS.PLAYLIST_SLUG_PREFIX,
      this.playlistStorage
    );

    if (!playlistId) return null;

    const playlistData = await this.playlistStorage.get(
      `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`
    );
    if (!playlistData) return null;

    return JSON.parse(playlistData) as Playlist;
  }

  /**
   * List all playlists with pagination support
   */
  async listAllPlaylists(options: ListOptions = {}): Promise<PaginatedResult<Playlist>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX
        : options.sort === 'desc'
          ? STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX
          : STORAGE_KEYS.PLAYLIST_ID_PREFIX; // Default to ID prefix when no sort provided

    const response = await this.playlistStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist:created:(asc|desc):${ts}:${playlistId}
        const parts = key.name.split(':');
        const playlistId = parts[parts.length - 1];
        playlistKeys.push(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`);
      } else {
        // Key format: playlist:id:${playlistId}
        playlistKeys.push(key.name);
      }
    }

    const playlists = await this.batchFetchFromStorage<Playlist>(
      playlistKeys,
      this.playlistStorage,
      'playlist'
    );

    return {
      items: playlists,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
  }

  /**
   * List starred playlist IDs using materialized star indexes
   */
  async listStarredPlaylistIds(options: ListOptions = {}): Promise<PaginatedResult<string>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'desc'
        ? STORAGE_KEYS.STAR_PLAYLIST_CREATED_DESC_PREFIX
        : STORAGE_KEYS.STAR_PLAYLIST_CREATED_ASC_PREFIX;

    const response = await this.starStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistIds: string[] = [];
    for (const key of response.keys) {
      // Key format: star:created:(asc|desc):${ts}:${playlistId}
      const parts = key.name.split(':');
      const playlistId = parts[parts.length - 1];
      if (playlistId) {
        playlistIds.push(playlistId);
      }
    }

    return {
      items: playlistIds,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
  }

  /**
   * List starred playlists using materialized star indexes
   */
  async listStarredPlaylists(options: ListOptions = {}): Promise<PaginatedResult<Playlist>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'desc'
        ? STORAGE_KEYS.STAR_PLAYLIST_CREATED_DESC_PREFIX
        : STORAGE_KEYS.STAR_PLAYLIST_CREATED_ASC_PREFIX;

    const response = await this.starStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistIdKeys: string[] = [];
    for (const key of response.keys) {
      // Key format: star:created:(asc|desc):${ts}:${playlistId}
      const parts = key.name.split(':');
      const playlistId = parts[parts.length - 1];
      playlistIdKeys.push(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`);
    }

    const playlists = await this.batchFetchFromStorage<Playlist>(
      playlistIdKeys,
      this.playlistStorage,
      'starred playlist'
    );

    return {
      items: playlists,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
  }

  /**
   * Check if a playlist is starred
   */
  async isPlaylistStarred(playlistId: string): Promise<boolean> {
    const flagKey = `${STORAGE_KEYS.STAR_PREFIX}${playlistId}`;
    const starVal = await this.starStorage.get(flagKey);
    return Boolean(starVal);
  }

  /**
   * Check if nonce has been used (replay protection)
   */
  async isNonceUsed(nonce: string): Promise<boolean> {
    try {
      const nonceKey = `nonce:${nonce}`;
      const existing = await this.starStorage.get(nonceKey);
      return existing !== null;
    } catch (error) {
      console.error('Error checking nonce:', error);
      // If we can't check, fail safe and reject
      return true;
    }
  }

  /**
   * Store nonce to prevent replay attacks
   * Nonces expire after 24 hours (we'll use TTL if supported, or manual cleanup)
   */
  async storeNonce(nonce: string, timestamp: number): Promise<void> {
    try {
      const nonceKey = `nonce:${nonce}`;
      // Store with timestamp as value for potential cleanup
      await this.starStorage.put(nonceKey, timestamp.toString());
    } catch (error) {
      console.error('Error storing nonce:', error);
      // Don't throw - nonce storage failure shouldn't block the webhook
    }
  }

  /**
   * Update the materialized star status for a playlist
   * Handles creating/removing the flag and created-time indexes
   */
  async updatePlaylistStarStatus(playlistId: string, status: 'active' | 'revoked'): Promise<void> {
    const playlist = await this.getPlaylistByIdOrSlug(playlistId);
    const created = playlist?.created;

    const flagKey = `${STORAGE_KEYS.STAR_PREFIX}${playlistId}`;

    if (status === 'active') {
      const ops: Promise<void>[] = [this.starStorage.put(flagKey, playlistId)];
      if (created) {
        const { asc, desc } = this.toSortableTimestamps(created);
        ops.push(
          this.starStorage.put(
            `${STORAGE_KEYS.STAR_PLAYLIST_CREATED_ASC_PREFIX}${asc}:${playlistId}`,
            playlistId
          )
        );
        ops.push(
          this.starStorage.put(
            `${STORAGE_KEYS.STAR_PLAYLIST_CREATED_DESC_PREFIX}${desc}:${playlistId}`,
            playlistId
          )
        );
      }
      await Promise.all(ops);
      return;
    }

    if (status === 'revoked') {
      const ops: Promise<void>[] = [this.starStorage.delete(flagKey)];
      if (created) {
        const { asc, desc } = this.toSortableTimestamps(created);
        ops.push(
          this.starStorage.delete(
            `${STORAGE_KEYS.STAR_PLAYLIST_CREATED_ASC_PREFIX}${asc}:${playlistId}`
          )
        );
        ops.push(
          this.starStorage.delete(
            `${STORAGE_KEYS.STAR_PLAYLIST_CREATED_DESC_PREFIX}${desc}:${playlistId}`
          )
        );
      } else {
        await this.deleteStarIndexBySuffix(
          this.starStorage,
          STORAGE_KEYS.STAR_PLAYLIST_CREATED_ASC_PREFIX,
          playlistId
        );
        await this.deleteStarIndexBySuffix(
          this.starStorage,
          STORAGE_KEYS.STAR_PLAYLIST_CREATED_DESC_PREFIX,
          playlistId
        );
      }
      await Promise.all(ops);
      return;
    }

    throw new Error(`Unsupported star status: ${status}`);
  }

  /**
   * Delete star index entries by suffix (used when created timestamp is unknown)
   */
  private async deleteStarIndexBySuffix(
    kv: KeyValueStorage,
    prefix: string,
    playlistId: string
  ): Promise<void> {
    let cursor: string | undefined = undefined;
    // Paginate to find any keys ending with :playlistId
    do {
      const res: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } =
        await kv.list({ prefix, cursor });
      const tasks: Promise<void>[] = [];
      for (const k of res.keys as Array<{ name: string }>) {
        if (k.name.endsWith(`:${playlistId}`)) {
          tasks.push(kv.delete(k.name));
        }
      }
      await Promise.all(tasks);
      cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
  }

  /**
   * Get a playlist item by ID
   */
  async getPlaylistItemById(itemId: string): Promise<PlaylistItem | null> {
    const itemData = await this.playlistItemStorage.get(
      `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId}`
    );
    if (!itemData) return null;

    return JSON.parse(itemData) as PlaylistItem;
  }

  /**
   * List all playlist items
   */
  async listAllPlaylistItems(options: ListOptions = {}): Promise<PaginatedResult<PlaylistItem>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX
        : options.sort === 'desc'
          ? STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX
          : STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX; // Default to ID prefix when no sort provided

    const response = await this.playlistItemStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const itemKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist-item:created:(asc|desc):${ts}:${itemId}
        const parts = key.name.split(':');
        const itemId = parts[parts.length - 1];
        itemKeys.push(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId}`);
      } else {
        // Key format: playlist-item:id:${itemId}
        itemKeys.push(key.name);
      }
    }

    const items = await this.batchFetchFromStorage<PlaylistItem>(
      itemKeys,
      this.playlistItemStorage,
      'playlist item'
    );

    return {
      items,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
  }
}
