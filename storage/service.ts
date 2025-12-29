import type { Env } from '../types';
import { PlaylistItem, Playlist, Channel } from 'ff-dp1-js';
import { PlaylistSchema, createItemContentHash } from '../types';
import type { StorageProvider, KeyValueStorage, PaginatedResult, ListOptions } from './interfaces';
import { isValidUUID } from '../helper';

// KV Storage Keys - using original prefixes to avoid data migration
export const STORAGE_KEYS = {
  PLAYLIST_ID_PREFIX: 'playlist:id:', // playlist:id:${playlistId}=>${playlistData}
  PLAYLIST_SLUG_PREFIX: 'playlist:slug:', // playlist:slug:${playlistSlug}=>${playlistId}
  // Channel keys (using original playlist-group prefixes to avoid data migration)
  CHANNEL_ID_PREFIX: 'playlist-group:id:', // playlist-group:id:${channelId}=>${channelData}
  CHANNEL_SLUG_PREFIX: 'playlist-group:slug:', // playlist-group:slug:${channelSlug}=>${channelId}
  PLAYLIST_ITEM_ID_PREFIX: 'playlist-item:id:', // playlist-item:id:${playlistItemId}=>${playlistItemData}
  PLAYLIST_ITEM_BY_CHANNEL_PREFIX: 'playlist-item:group-id:', // playlist-item:group-id:${channelId}:${playlistItemId}=>${playlistItemId}
  PLAYLIST_TO_CHANNELS_PREFIX: 'playlist-to-groups:', // playlist-to-groups:${playlistId}:${channelId}=>${channelId}
  CHANNEL_TO_PLAYLISTS_PREFIX: 'group-to-playlists:', // group-to-playlists:${channelId}:${playlistId}=>${playlistId}
  // Created-time secondary indexes (asc/desc)
  PLAYLIST_CREATED_ASC_PREFIX: 'playlist:created:asc:', // playlist:created:asc:${timestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_CREATED_DESC_PREFIX: 'playlist:created:desc:', // playlist:created:desc:${invTimestampMs}:${playlistId} => ${playlistId}
  CHANNEL_CREATED_ASC_PREFIX: 'playlist-group:created:asc:', // playlist-group:created:asc:${timestampMs}:${channelId} => ${channelId}
  CHANNEL_CREATED_DESC_PREFIX: 'playlist-group:created:desc:', // playlist-group:created:desc:${invTimestampMs}:${channelId} => ${channelId}
  PLAYLIST_ITEM_CREATED_ASC_PREFIX: 'playlist-item:created:asc:', // playlist-item:created:asc:${timestampMs}:${itemId} => ${itemId}
  PLAYLIST_ITEM_CREATED_DESC_PREFIX: 'playlist-item:created:desc:', // playlist-item:created:desc:${invTimestampMs}:${itemId} => ${itemId}
  CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX: 'group-to-playlists-created:asc:', // group-to-playlists-created:asc:${channelId}:${timestampMs}:${playlistId} => ${playlistId}
  CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX: 'group-to-playlists-created:desc:', // group-to-playlists-created:desc:${channelId}:${invTimestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX: 'playlist-item:group-created:asc:', // playlist-item:group-created:asc:${channelId}:${timestampMs}:${itemId} => ${itemId}
  PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX: 'playlist-item:group-created:desc:', // playlist-item:group-created:desc:${channelId}:${invTimestampMs}:${itemId} => ${itemId}
} as const;

/**
 * Storage service that provides high-level operations using storage abstractions
 */
export class StorageService {
  private playlistStorage: KeyValueStorage;
  private channelStorage: KeyValueStorage;
  private playlistItemStorage: KeyValueStorage;

  constructor(private readonly storageProvider: StorageProvider) {
    this.playlistStorage = this.storageProvider.getPlaylistStorage();
    this.channelStorage = this.storageProvider.getChannelStorage();
    this.playlistItemStorage = this.storageProvider.getPlaylistItemStorage();
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
    const isUuid = isValidUUID(identifier);

    if (isUuid) {
      return identifier;
    } else {
      // It's a slug, get the ID
      return await storage.get(`${slugPrefix}${identifier}`);
    }
  }

  /**
   * Check if a URL points to a self-hosted domain
   */
  private isSelfHostedUrl(url: string, selfHostedDomains?: string | null): boolean {
    if (!selfHostedDomains) {
      return false;
    }

    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const port = urlObj.port;
    const hostWithPort = port ? `${hostname}:${port}` : hostname;

    const domains = selfHostedDomains.split(',').map(d => d.trim());

    return domains.some(domain => hostWithPort === domain || hostname === domain);
  }

  /**
   * Extract playlist identifier (ID or slug) from a playlist URL
   */
  private extractPlaylistIdentifierFromUrl(url: string): string | null {
    const urlObj = new URL(url);
    // Updated regex to handle both URL formats and both UUIDs and slugs
    // Matches:
    // - /api/v1/playlists/{identifier} (self-hosted format)
    // - /playlists/{identifier} (external format)
    // where identifier can be:
    // - UUIDs: 79856015-edf8-4145-8be9-135222d4157d
    // - Slugs: my-awesome-playlist-slug, playlist_123, etc.
    const pathMatch = urlObj.pathname.match(/^\/(?:api\/v1\/)?playlists\/([a-zA-Z0-9\-_]+)$/);
    return pathMatch ? (pathMatch[1] ?? null) : null;
  }

  /**
   * Fetch and validate an external playlist URL with strict DP-1 validation.
   * If the URL points to a self-hosted domain, queries the database directly to avoid
   * CloudFlare Workers restrictions on same-domain requests.
   */
  private async fetchAndValidatePlaylist(
    url: string,
    env: Env
  ): Promise<{ id: string; playlist: Playlist; external: boolean }> {
    // Check if this is a self-hosted URL
    if (this.isSelfHostedUrl(url, env.SELF_HOSTED_DOMAINS ?? null)) {
      console.log(`Detected self-hosted URL ${url}, querying database directly`);

      const playlistIdentifier = this.extractPlaylistIdentifierFromUrl(url);
      if (!playlistIdentifier) {
        throw new Error(`Could not extract playlist identifier from self-hosted URL: ${url}`);
      }

      // Query the database directly instead of making an HTTP request (works with both IDs and slugs)
      const playlist = await this.getPlaylistByIdOrSlug(playlistIdentifier);
      if (!playlist) {
        throw new Error(`Playlist ${playlistIdentifier} not found in database for URL: ${url}`);
      }

      // For self-hosted playlists, we trust our own data and skip validation
      console.log(`Successfully retrieved self-hosted playlist ${playlist.id} from database`);
      return { id: playlist.id, playlist, external: false };
    }

    // For external URLs, use the normal fetch approach
    console.log(`Fetching external playlist from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist from ${url}: ${response.status}`);
    }

    const rawPlaylist = await response.json();

    // Use Zod schema for strict DP-1 validation
    const validationResult = PlaylistSchema.safeParse(rawPlaylist);
    if (!validationResult.success) {
      throw new Error(`External playlist from ${url} failed DP-1 validation`);
    }

    const playlist = validationResult.data;
    return { id: playlist.id, playlist, external: true };
  }

  /**
   * Get all playlist IDs that belong to a specific channel (efficient lookup)
   */
  private async getPlaylistsForChannel(channelId: string): Promise<string[]> {
    const prefix = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channelId}:`;
    const playlistIds: string[] = [];
    let cursor: string | undefined = undefined;

    while (true) {
      const listResult = await this.playlistStorage.list({
        prefix: prefix,
        limit: 1000,
        cursor: cursor,
      });

      const ids = listResult.keys
        .map(key => {
          // Key format: "group-to-playlists:channelId:playlistId"
          const parts = key.name.split(':');
          return parts[parts.length - 1]; // Get the last part (playlistId)
        })
        .filter((playlistId): playlistId is string => playlistId !== undefined);
      playlistIds.push(...ids);

      if (listResult.list_complete) {
        break;
      }
      cursor = listResult.cursor;
    }

    return playlistIds;
  }

  /**
   * Calculate what items have changed between old and new playlists
   * Uses JCS-based content hashing to detect changes regardless of field order
   * Note: Items with same content (regardless of ID) are treated as unchanged
   * and require no KV operations, solving the Cloudflare Workers subrequest limit issue
   */
  private async calculateItemChanges(
    oldItems: PlaylistItem[],
    newItems: PlaylistItem[]
  ): Promise<{
    unchanged: PlaylistItem[];
    added: PlaylistItem[];
    deleted: PlaylistItem[];
  }> {
    const oldHashes = new Map<string, PlaylistItem>();
    const newHashes = new Map<string, PlaylistItem>();

    // Create content hashes for old items
    for (const item of oldItems) {
      const hash = await createItemContentHash(item);
      oldHashes.set(hash, item);
    }

    // Create content hashes for new items
    for (const item of newItems) {
      const hash = await createItemContentHash(item);
      newHashes.set(hash, item);
    }

    const unchanged: PlaylistItem[] = [];
    const added: PlaylistItem[] = [];
    const deleted: PlaylistItem[] = [];

    // Find items with same content (regardless of ID)
    for (const [hash, oldItem] of oldHashes) {
      if (newHashes.has(hash)) {
        // Same content means unchanged - no KV operations needed
        // Even if IDs are different, the content is the same so we skip processing
        unchanged.push(oldItem);
        newHashes.delete(hash); // Remove from newHashes to avoid double processing
      }
    }

    // Remaining items in newHashes are additions
    for (const newItem of newHashes.values()) {
      added.push(newItem);
    }

    // Remaining items in oldHashes are deletions
    for (const oldItem of oldHashes.values()) {
      if (!unchanged.includes(oldItem)) {
        deleted.push(oldItem);
      }
    }

    return { unchanged, added, deleted };
  }

  /**
   * Create KV operations to delete a playlist item and all its indexes
   */
  private createItemDeletionOperations(item: PlaylistItem, channelIds: string[]): Promise<void>[] {
    const operations: Promise<void>[] = [];

    // Delete main item record
    operations.push(
      this.playlistItemStorage.delete(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`)
    );

    // Delete global created-time indexes
    if (item.created) {
      const ts = this.toSortableTimestamps(item.created);
      operations.push(
        this.playlistItemStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${ts.asc}:${item.id}`
        ),
        this.playlistItemStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${ts.desc}:${item.id}`
        )
      );
    }

    // Delete channel associations
    for (const channelId of channelIds) {
      operations.push(
        this.playlistItemStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channelId}:${item.id}`
        )
      );

      if (item.created) {
        const ts = this.toSortableTimestamps(item.created);
        operations.push(
          this.playlistItemStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channelId}:${ts.asc}:${item.id}`
          ),
          this.playlistItemStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channelId}:${ts.desc}:${item.id}`
          )
        );
      }
    }

    return operations;
  }

  /**
   * Create KV operations to insert a playlist item and all its indexes
   */
  private createItemInsertionOperations(item: PlaylistItem, channelIds: string[]): Promise<void>[] {
    const operations: Promise<void>[] = [];
    const itemData = JSON.stringify(item);

    // Insert main item record
    operations.push(
      this.playlistItemStorage.put(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`, itemData)
    );

    // Insert global created-time indexes
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

    // Insert channel associations
    for (const channelId of channelIds) {
      operations.push(
        this.playlistItemStorage.put(
          `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channelId}:${item.id}`,
          item.id
        )
      );

      if (item.created) {
        const ts = this.toSortableTimestamps(item.created);
        operations.push(
          this.playlistItemStorage.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channelId}:${ts.asc}:${item.id}`,
            item.id
          ),
          this.playlistItemStorage.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channelId}:${ts.desc}:${item.id}`,
            item.id
          )
        );
      }
    }

    return operations;
  }

  /**
   * Get all channel IDs that a playlist belongs to (efficient reverse lookup)
   */
  async getChannelsForPlaylist(playlistId: string): Promise<string[]> {
    const prefix = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId}:`;
    let cursor: string | undefined = undefined;
    const channelIds: string[] = [];

    while (true) {
      const listResult = await this.playlistStorage.list({
        prefix: prefix,
        limit: 1000,
        cursor: cursor,
      });

      const ids = listResult.keys
        .map(key => {
          // Key format: "playlist-to-groups:playlistId:channelId"
          const parts = key.name.split(':');
          return parts[parts.length - 1]; // Get the last part (channelId)
        })
        .filter((channelId): channelId is string => channelId !== undefined);
      channelIds.push(...ids);

      if (listResult.list_complete) {
        break;
      }
      cursor = listResult.cursor;
    }

    return channelIds;
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

    if (update && existingPlaylist) {
      // SMART UPDATE: Only process changed items using JCS-based content hashing
      const channelIds = await this.getChannelsForPlaylist(playlist.id);
      const itemChanges = await this.calculateItemChanges(
        existingPlaylist.items || [],
        playlist.items || []
      );

      console.log(
        `Playlist update: ${itemChanges.unchanged.length} unchanged, ${itemChanges.added.length} added, ${itemChanges.deleted.length} deleted`
      );

      // Process deletions
      for (const deletedItem of itemChanges.deleted) {
        operations.push(...this.createItemDeletionOperations(deletedItem, channelIds));
      }

      // Process additions
      for (const newItem of itemChanges.added) {
        operations.push(...this.createItemInsertionOperations(newItem, channelIds));
      }

      // Note: unchanged items require no KV operations - they're skipped entirely
    } else {
      // Initial creation - add all items
      for (const item of playlist.items || []) {
        const channelIds = await this.getChannelsForPlaylist(playlist.id);
        operations.push(...this.createItemInsertionOperations(item, channelIds));
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
   * List playlists by channel ID with pagination
   */
  async listPlaylistsByChannelId(
    channelId: string,
    options: ListOptions = {}
  ): Promise<PaginatedResult<Playlist>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX}${channelId}:`
        : options.sort === 'desc'
          ? `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX}${channelId}:`
          : `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channelId}:`; // Default to basic channel prefix

    const response = await this.playlistStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: group-to-playlists-created:(asc|desc):${groupId}:${ts}:${playlistId}
        const parts = key.name.split(':');
        const playlistId = parts[parts.length - 1];
        playlistKeys.push(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`);
      } else {
        // Key format: group-to-playlists:${groupId}:${playlistId}
        const parts = key.name.split(':');
        const playlistId = parts[parts.length - 1];
        playlistKeys.push(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`);
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
   * Save a channel with multiple indexes
   */
  async saveChannel(channel: Channel, env: Env, update: boolean = false): Promise<boolean> {
    // Allow empty playlists during updates (e.g., when deleting playlists)
    if (channel.playlists.length === 0 && !update) {
      console.error('Channel has no playlists');
      return false;
    }

    // Handle empty playlists case during updates
    let validatedPlaylists: any[] = [];
    let validatedPlaylistsMap = new Map();

    if (channel.playlists.length > 0) {
      // First, fetch and validate all external playlists in parallel
      const playlistValidationPromises = channel.playlists.map(async playlistUrl => {
        // If it's an external URL, fetch and validate it
        if (playlistUrl.startsWith('http://') || playlistUrl.startsWith('https://')) {
          return await this.fetchAndValidatePlaylist(playlistUrl, env);
        } else {
          throw new Error(`Invalid playlist URL: ${playlistUrl}`);
        }
      });

      // Validate all playlists in parallel
      validatedPlaylists = await Promise.all(playlistValidationPromises);

      // Turn the validated playlists into a map for quick lookup
      validatedPlaylistsMap = new Map(validatedPlaylists.map(playlist => [playlist.id, playlist]));
    }

    // Core channel operations
    const channelData = JSON.stringify(channel);
    const operations = [
      // Main record by ID
      this.channelStorage.put(`${STORAGE_KEYS.CHANNEL_ID_PREFIX}${channel.id}`, channelData),
      // Index by slug
      this.channelStorage.put(`${STORAGE_KEYS.CHANNEL_SLUG_PREFIX}${channel.slug}`, channel.id),
    ];

    // Created-time indexes for channels
    if (channel.created) {
      const ts = this.toSortableTimestamps(channel.created);
      operations.push(
        this.channelStorage.put(
          `${STORAGE_KEYS.CHANNEL_CREATED_ASC_PREFIX}${ts.asc}:${channel.id}`,
          channel.id
        ),
        this.channelStorage.put(
          `${STORAGE_KEYS.CHANNEL_CREATED_DESC_PREFIX}${ts.desc}:${channel.id}`,
          channel.id
        )
      );
    }

    // If this is an update, figure out which playlists are no longer in the group
    // and clean up the old indexes.
    // To be simplified, we assume that uuid v4 is unique cross-system even though
    // the chance of collision is very low and could be ignored.
    if (update) {
      // Get all playlists that are currently in the channel
      const playlistIds = await this.getPlaylistsForChannel(channel.id);

      // Filter out the playlists that are no longer in the channel
      const playlistIdsToUnlink: string[] = [];
      for (const playlistId of playlistIds) {
        if (!validatedPlaylistsMap.has(playlistId)) {
          playlistIdsToUnlink.push(playlistId);
        }
      }

      // Clean up the old bidirectional indexes
      for (const playlistId of playlistIdsToUnlink) {
        operations.push(
          this.playlistStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId}:${channel.id}`
          )
        );
        operations.push(
          this.playlistStorage.delete(
            `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channel.id}:${playlistId}`
          )
        );
        // Also remove created-time channel playlist indexes
        if (channel.created) {
          const ts = this.toSortableTimestamps(channel.created);
          operations.push(
            this.playlistStorage.delete(
              `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${playlistId}`
            ),
            this.playlistStorage.delete(
              `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${playlistId}`
            )
          );
        }
      }

      // Clean up the channel associated playlist items
      const playlistKeys = playlistIdsToUnlink.map(id => `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${id}`);
      const playlists = await this.batchFetchFromStorage<Playlist>(
        playlistKeys,
        this.playlistStorage,
        'playlist'
      );
      for (const playlist of playlists) {
        for (const item of playlist.items || []) {
          operations.push(
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channel.id}:${item.id}`
            )
          );
          if (playlist.created) {
            const ts = this.toSortableTimestamps(playlist.created);
            operations.push(
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${item.id}`
              ),
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${item.id}`
              )
            );
          }
        }
      }
    }

    // Store external playlists
    for (const validPlaylist of validatedPlaylists) {
      // If it's an external playlist with data, store it
      if (validPlaylist.external) {
        operations.push(
          this.playlistStorage.put(
            `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${validPlaylist.id}`,
            JSON.stringify(validPlaylist.playlist)
          ),
          this.playlistStorage.put(
            `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${validPlaylist.playlist.slug}`,
            validPlaylist.id
          )
        );
        // Ensure playlist created-time indexes exist
        if (validPlaylist.playlist.created) {
          const ts = this.toSortableTimestamps(validPlaylist.playlist.created);
          operations.push(
            this.playlistStorage.put(
              `${STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX}${ts.asc}:${validPlaylist.id}`,
              validPlaylist.id
            ),
            this.playlistStorage.put(
              `${STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX}${ts.desc}:${validPlaylist.id}`,
              validPlaylist.id
            )
          );
        }
      }

      // Add bidirectional indexes for efficient lookups
      operations.push(
        this.playlistStorage.put(
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${validPlaylist.id}:${channel.id}`,
          channel.id
        ),
        this.playlistStorage.put(
          `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channel.id}:${validPlaylist.id}`,
          validPlaylist.id
        )
      );

      // Created-time channel->playlists indexes (based on playlist created time)
      if (validPlaylist.playlist.created) {
        const ts = this.toSortableTimestamps(validPlaylist.playlist.created);
        operations.push(
          this.playlistStorage.put(
            `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${validPlaylist.id}`,
            validPlaylist.id
          ),
          this.playlistStorage.put(
            `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${validPlaylist.id}`,
            validPlaylist.id
          )
        );
      }
    }

    // Add playlist item operations to the same batch
    // Create channel-to-playlist-item indexes for ALL playlists (both local and external)
    for (const validPlaylist of validatedPlaylists) {
      if (
        validPlaylist.playlist &&
        validPlaylist.playlist.items &&
        validPlaylist.playlist.items.length > 0
      ) {
        for (const item of validPlaylist.playlist.items || ([] as PlaylistItem[])) {
          // For external playlists, store the item data (since it's not stored elsewhere)
          if (validPlaylist.external) {
            const itemData = JSON.stringify(item);

            // Main record by playlist item ID
            operations.push(
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`,
                itemData
              )
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

          // Create channel-to-playlist-item indexes for ALL playlists (local and external)
          operations.push(
            this.playlistItemStorage.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channel.id}:${item.id}`,
              item.id
            )
          );

          // Secondary index by channel ID + created time using item's created
          if (item.created) {
            const ts = this.toSortableTimestamps(item.created);
            operations.push(
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${item.id}`,
                item.id
              ),
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${item.id}`,
                item.id
              )
            );
          }
        }
      }
    }

    await Promise.all(operations);
    return true;
  }

  /**
   * Get a channel by ID or slug
   */
  async getChannelByIdOrSlug(identifier: string): Promise<Channel | null> {
    const channelId = await this.resolveIdentifierToId(
      identifier,
      STORAGE_KEYS.CHANNEL_SLUG_PREFIX,
      this.channelStorage
    );

    if (!channelId) return null;

    const channelData = await this.channelStorage.get(
      `${STORAGE_KEYS.CHANNEL_ID_PREFIX}${channelId}`
    );
    if (!channelData) return null;

    return JSON.parse(channelData) as Channel;
  }

  /**
   * List all channels with pagination support
   */
  async listAllChannels(options: ListOptions = {}): Promise<PaginatedResult<Channel>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? STORAGE_KEYS.CHANNEL_CREATED_ASC_PREFIX
        : options.sort === 'desc'
          ? STORAGE_KEYS.CHANNEL_CREATED_DESC_PREFIX
          : STORAGE_KEYS.CHANNEL_ID_PREFIX; // Default to ID prefix when no sort provided

    const response = await this.channelStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const channelKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist-group:created:(asc|desc):${ts}:${channelId}
        const parts = key.name.split(':');
        const channelId = parts[parts.length - 1];
        channelKeys.push(`${STORAGE_KEYS.CHANNEL_ID_PREFIX}${channelId}`);
      } else {
        // Key format: playlist-group:id:${channelId}
        channelKeys.push(key.name);
      }
    }

    const channels = await this.batchFetchFromStorage<Channel>(
      channelKeys,
      this.channelStorage,
      'channel'
    );

    return {
      items: channels,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
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

  /**
   * List playlist items by channel ID with pagination
   * Now uses the proper direct channel-to-playlist-item indexes
   */
  async listPlaylistItemsByChannelId(
    channelId: string,
    options: ListOptions = {}
  ): Promise<PaginatedResult<PlaylistItem>> {
    const limit = options.limit || 1000;

    // Use direct channel-to-playlist-item indexes (now created for both local and external playlists)
    const prefix =
      options.sort === 'asc'
        ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channelId}:`
        : options.sort === 'desc'
          ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channelId}:`
          : `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channelId}:`; // Default to basic channel prefix

    const response = await this.playlistItemStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistItemKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist-item:group-created:(asc|desc):${channelId}:${ts}:${playlistItemId}
        const keyParts = key.name.split(':');
        const playlistItemId = keyParts[keyParts.length - 1]; // Last part is the playlist item ID
        playlistItemKeys.push(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${playlistItemId}`);
      } else {
        // Key format: playlist-item:group-id:${channelId}:${playlistItemId}
        const keyParts = key.name.split(':');
        const playlistItemId = keyParts[keyParts.length - 1]; // Last part is the playlist item ID
        playlistItemKeys.push(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${playlistItemId}`);
      }
    }

    // Batch fetch all playlist items
    const playlistItems = await this.batchFetchFromStorage<PlaylistItem>(
      playlistItemKeys,
      this.playlistItemStorage,
      'playlist item'
    );

    return {
      items: playlistItems,
      cursor: response.list_complete ? undefined : response.cursor,
      hasMore: !response.list_complete,
    };
  }

  /**
   * Delete a playlist and all its related indexes and associations
   * This will:
   * 1. Remove the playlist from all channels that reference it
   * 2. Delete all playlist items and their indexes
   * 3. Delete all bidirectional channel-playlist associations
   * 4. Delete the playlist itself and its indexes
   */
  async deletePlaylist(playlistId: string, env: any): Promise<boolean> {
    // First, get the playlist to ensure it exists and get its data
    const playlist = await this.getPlaylistByIdOrSlug(playlistId);
    if (!playlist) {
      throw new Error(`Playlist ${playlistId} not found`);
    }

    const operations: Promise<void>[] = [];

    // 1. Get all channels that reference this playlist
    const channelIds = await this.getChannelsForPlaylist(playlist.id);

    // 2. Fetch all channels in parallel, then update them
    const channelKeys = channelIds.map(id => `${STORAGE_KEYS.CHANNEL_ID_PREFIX}${id}`);
    const channels = await this.batchFetchFromStorage<Channel>(
      channelKeys,
      this.channelStorage,
      'channel'
    );

    // Process channel updates in parallel and wait for them to complete
    const channelUpdatePromises = channels.map(async channel => {
      // Filter out the playlist URL that references this playlist
      const updatedPlaylists = channel.playlists.filter(playlistUrl => {
        // Extract playlist identifier from URL
        const playlistIdentifier = this.extractPlaylistIdentifierFromUrl(playlistUrl);
        return playlistIdentifier !== playlist.id && playlistIdentifier !== playlist.slug;
      });

      // Always update the channel (either with remaining playlists or empty array)
      const updatedChannel = { ...channel, playlists: updatedPlaylists };
      return this.saveChannel(updatedChannel, env, true);
    });

    // Wait for all channel updates to complete before proceeding
    await Promise.all(channelUpdatePromises);

    // 3. Delete all playlist items and their indexes
    for (const item of playlist.items || []) {
      // Delete main playlist item record
      operations.push(
        this.playlistItemStorage.delete(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`)
      );

      // Delete global created-time indexes for items
      if (item.created) {
        const ts = this.toSortableTimestamps(item.created);
        operations.push(
          this.playlistItemStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${ts.asc}:${item.id}`
          ),
          this.playlistItemStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${ts.desc}:${item.id}`
          )
        );
      }

      // Delete channel-specific playlist item indexes
      for (const channelId of channelIds) {
        operations.push(
          this.playlistItemStorage.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channelId}:${item.id}`
          )
        );

        // Delete channel-created indexes for items
        if (item.created) {
          const ts = this.toSortableTimestamps(item.created);
          operations.push(
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channelId}:${ts.asc}:${item.id}`
            ),
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channelId}:${ts.desc}:${item.id}`
            )
          );
        }
      }
    }

    // 4. Delete bidirectional channel-playlist associations
    for (const channelId of channelIds) {
      // Delete playlist-to-channel associations
      operations.push(
        this.playlistStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlist.id}:${channelId}`
        )
      );

      // Delete channel-to-playlist associations
      operations.push(
        this.playlistStorage.delete(
          `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channelId}:${playlist.id}`
        )
      );

      // Delete created-time channel-playlist indexes
      if (playlist.created) {
        const ts = this.toSortableTimestamps(playlist.created);
        operations.push(
          this.playlistStorage.delete(
            `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX}${channelId}:${ts.asc}:${playlist.id}`
          ),
          this.playlistStorage.delete(
            `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX}${channelId}:${ts.desc}:${playlist.id}`
          )
        );
      }
    }

    // 5. Delete the playlist itself and its indexes
    operations.push(
      // Main playlist record
      this.playlistStorage.delete(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlist.id}`),
      // Slug index
      this.playlistStorage.delete(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${playlist.slug}`)
    );

    // Delete created-time indexes for playlist
    if (playlist.created) {
      const ts = this.toSortableTimestamps(playlist.created);
      operations.push(
        this.playlistStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX}${ts.asc}:${playlist.id}`
        ),
        this.playlistStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX}${ts.desc}:${playlist.id}`
        )
      );
    }

    // Execute all operations in parallel
    await Promise.all(operations);

    return true;
  }

  /**
   * Delete a channel and all its related indexes and associations
   * This will:
   * 1. Get all playlists that belong to this channel
   * 2. Delete all playlist items associated with this channel
   * 3. Delete all bidirectional channel-playlist associations
   * 4. Delete the channel itself and its indexes
   * Note: Playlists themselves are preserved (channels don't own playlists)
   */
  async deleteChannel(channelId: string, _env: any): Promise<boolean> {
    // First, get the channel to ensure it exists and get its data
    const channel = await this.getChannelByIdOrSlug(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const operations: Promise<void>[] = [];

    // 1. Get all playlists that belong to this channel
    const playlistIds: string[] = [];
    for (const playlistUrl of channel.playlists) {
      const playlistIdentifier = this.extractPlaylistIdentifierFromUrl(playlistUrl);
      if (playlistIdentifier) {
        // Resolve identifier to actual ID
        const resolvedId = await this.resolveIdentifierToId(
          playlistIdentifier,
          STORAGE_KEYS.PLAYLIST_SLUG_PREFIX,
          this.playlistStorage
        );
        if (resolvedId) {
          playlistIds.push(resolvedId);
        }
      }
    }

    // 2. Get all playlist items for this channel and delete them
    // We need to iterate through all items to find those associated with this channel
    const channelItemsPrefix = `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${channel.id}:`;
    const channelItemKeys = await this.playlistItemStorage.list({
      prefix: channelItemsPrefix,
    });

    for (const key of channelItemKeys.keys) {
      // Extract item ID from key (format: "playlist-item:group-id:${channelId}:${itemId}")
      const itemId = key.name.split(':').pop();
      if (itemId) {
        // Delete the channel-specific item index
        operations.push(this.playlistItemStorage.delete(key.name));

        // Delete channel-created indexes for this item
        // We need to get the item to check its created timestamp
        const itemData = await this.playlistItemStorage.get(
          `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId}`
        );
        if (itemData) {
          const item = JSON.parse(itemData) as PlaylistItem;
          if (item.created) {
            const ts = this.toSortableTimestamps(item.created);
            operations.push(
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${itemId}`
              ),
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${itemId}`
              )
            );
          }
        }
      }
    }

    // 3. Delete bidirectional channel-playlist associations
    for (const playlistId of playlistIds) {
      // Delete playlist-to-channel associations
      operations.push(
        this.playlistStorage.delete(
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId}:${channel.id}`
        )
      );

      // Delete channel-to-playlist associations
      operations.push(
        this.playlistStorage.delete(
          `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${channel.id}:${playlistId}`
        )
      );

      // We need to get the playlist to check its created timestamp
      const playlistData = await this.playlistStorage.get(
        `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`
      );
      if (playlistData) {
        const playlist = JSON.parse(playlistData) as Playlist;
        if (playlist.created) {
          const ts = this.toSortableTimestamps(playlist.created);
          operations.push(
            this.playlistStorage.delete(
              `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_ASC_PREFIX}${channel.id}:${ts.asc}:${playlistId}`
            ),
            this.playlistStorage.delete(
              `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_CREATED_DESC_PREFIX}${channel.id}:${ts.desc}:${playlistId}`
            )
          );
        }
      }
    }

    // 4. Delete the channel itself and its indexes
    operations.push(
      // Main channel record
      this.channelStorage.delete(`${STORAGE_KEYS.CHANNEL_ID_PREFIX}${channel.id}`),
      // Slug index
      this.channelStorage.delete(`${STORAGE_KEYS.CHANNEL_SLUG_PREFIX}${channel.slug}`)
    );

    // Delete created-time indexes for channel
    if (channel.created) {
      const ts = this.toSortableTimestamps(channel.created);
      operations.push(
        this.channelStorage.delete(
          `${STORAGE_KEYS.CHANNEL_CREATED_ASC_PREFIX}${ts.asc}:${channel.id}`
        ),
        this.channelStorage.delete(
          `${STORAGE_KEYS.CHANNEL_CREATED_DESC_PREFIX}${ts.desc}:${channel.id}`
        )
      );
    }

    // Execute all operations in parallel
    await Promise.all(operations);

    return true;
  }
}
