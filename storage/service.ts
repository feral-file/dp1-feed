import type { Env, Playlist, PlaylistGroup, PlaylistItem } from '../types';
import { PlaylistSchema } from '../types';
import type { StorageProvider, KeyValueStorage, PaginatedResult, ListOptions } from './interfaces';

// Updated KV Storage Keys with consistent prefixes
export const STORAGE_KEYS = {
  PLAYLIST_ID_PREFIX: 'playlist:id:', // playlist:id:${playlistId}=>${playlistData}
  PLAYLIST_SLUG_PREFIX: 'playlist:slug:', // playlist:slug:${playlistSlug}=>${playlistId}
  PLAYLIST_GROUP_ID_PREFIX: 'playlist-group:id:', // playlist-group:id:${playlistGroupId}=>${playlistGroupData}
  PLAYLIST_GROUP_SLUG_PREFIX: 'playlist-group:slug:', // playlist-group:slug:${playlistGroupSlug}=>${playlistGroupId}
  PLAYLIST_ITEM_ID_PREFIX: 'playlist-item:id:', // playlist-item:id:${playlistItemId}=>${playlistItemData}
  PLAYLIST_ITEM_BY_GROUP_PREFIX: 'playlist-item:group-id:', // playlist-item:group-id:${playlistGroupId}:${playlistItemId}=>${playlistItemId}
  PLAYLIST_TO_GROUPS_PREFIX: 'playlist-to-groups:', // playlist-to-groups:${playlistId}:${playlistGroupId}=>${playlistGroupId}
  GROUP_TO_PLAYLISTS_PREFIX: 'group-to-playlists:', // group-to-playlists:${groupId}:${playlistId}=>${playlistId}
  // Created-time secondary indexes (asc/desc)
  PLAYLIST_CREATED_ASC_PREFIX: 'playlist:created:asc:', // playlist:created:asc:${timestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_CREATED_DESC_PREFIX: 'playlist:created:desc:', // playlist:created:desc:${invTimestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_GROUP_CREATED_ASC_PREFIX: 'playlist-group:created:asc:', // playlist-group:created:asc:${timestampMs}:${groupId} => ${groupId}
  PLAYLIST_GROUP_CREATED_DESC_PREFIX: 'playlist-group:created:desc:', // playlist-group:created:desc:${invTimestampMs}:${groupId} => ${groupId}
  PLAYLIST_ITEM_CREATED_ASC_PREFIX: 'playlist-item:created:asc:', // playlist-item:created:asc:${timestampMs}:${itemId} => ${itemId}
  PLAYLIST_ITEM_CREATED_DESC_PREFIX: 'playlist-item:created:desc:', // playlist-item:created:desc:${invTimestampMs}:${itemId} => ${itemId}
  GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX: 'group-to-playlists-created:asc:', // group-to-playlists-created:asc:${groupId}:${timestampMs}:${playlistId} => ${playlistId}
  GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX: 'group-to-playlists-created:desc:', // group-to-playlists-created:desc:${groupId}:${invTimestampMs}:${playlistId} => ${playlistId}
  PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX: 'playlist-item:group-created:asc:', // playlist-item:group-created:asc:${groupId}:${timestampMs}:${itemId} => ${itemId}
  PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX: 'playlist-item:group-created:desc:', // playlist-item:group-created:desc:${groupId}:${invTimestampMs}:${itemId} => ${itemId}
} as const;

/**
 * Storage service that provides high-level operations using storage abstractions
 */
export class StorageService {
  private playlistStorage: KeyValueStorage;
  private playlistGroupStorage: KeyValueStorage;
  private playlistItemStorage: KeyValueStorage;

  constructor(private readonly storageProvider: StorageProvider) {
    this.playlistStorage = this.storageProvider.getPlaylistStorage();
    this.playlistGroupStorage = this.storageProvider.getPlaylistGroupStorage();
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
   * Extract playlist identifier (ID or slug) from a self-hosted playlist URL
   */
  private extractPlaylistIdentifierFromUrl(url: string): string | null {
    const urlObj = new URL(url);
    // Updated regex to handle both UUIDs and slugs
    // Matches: /api/v1/playlists/{identifier} where identifier can be:
    // - UUIDs: 79856015-edf8-4145-8be9-135222d4157d
    // - Slugs: my-awesome-playlist-slug, playlist_123, etc.
    const pathMatch = urlObj.pathname.match(/^\/api\/v1\/playlists\/([a-zA-Z0-9\-_]+)$/);
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
   * Get all playlist IDs that belong to a specific group (efficient lookup)
   */
  private async getPlaylistsForGroup(groupId: string): Promise<string[]> {
    const prefix = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${groupId}:`;
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
          // Key format: "group-to-playlists:groupId:playlistId"
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
   * Get all playlist group IDs that a playlist belongs to (efficient reverse lookup)
   */
  async getPlaylistGroupsForPlaylist(playlistId: string): Promise<string[]> {
    const prefix = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId}:`;
    let cursor: string | undefined = undefined;
    const groupIds: string[] = [];

    while (true) {
      const listResult = await this.playlistStorage.list({
        prefix: prefix,
        limit: 1000,
        cursor: cursor,
      });

      const ids = listResult.keys
        .map(key => {
          // Key format: "playlist-to-groups:playlistId:groupId"
          const parts = key.name.split(':');
          return parts[parts.length - 1]; // Get the last part (groupId)
        })
        .filter((groupId): groupId is string => groupId !== undefined);
      groupIds.push(...ids);

      if (listResult.list_complete) {
        break;
      }
      cursor = listResult.cursor;
    }

    return groupIds;
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
      // Get the playlist group IDs
      const playlistGroupIds = await this.getPlaylistGroupsForPlaylist(playlist.id);

      // Delete all items and their group associations (if any)
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
        for (const playlistGroupId of playlistGroupIds) {
          operations.push(
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:${item.id}`
            )
          );
          // Delete group-created indexes for items using item's created
          if (item.created) {
            const oldTs = this.toSortableTimestamps(item.created);
            operations.push(
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:${oldTs.asc}:${item.id}`
              ),
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroupId}:${oldTs.desc}:${item.id}`
              )
            );
          }
        }
      }

      // Add new items to the group associations
      for (const item of playlist.items) {
        for (const playlistGroupId of playlistGroupIds) {
          operations.push(
            this.playlistItemStorage.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:${item.id}`,
              item.id
            )
          );
          // Add created-time group indexes for items using item's created
          if (item.created) {
            const ts = this.toSortableTimestamps(item.created);
            operations.push(
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:${ts.asc}:${item.id}`,
                item.id
              ),
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroupId}:${ts.desc}:${item.id}`,
                item.id
              )
            );
          }
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
   * List playlists by playlist group ID with pagination
   */
  async listPlaylistsByGroupId(
    playlistGroupId: string,
    options: ListOptions = {}
  ): Promise<PaginatedResult<Playlist>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroupId}:`
        : options.sort === 'desc'
          ? `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX}${playlistGroupId}:`
          : `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroupId}:`; // Default to basic group prefix

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
   * Save a playlist group with multiple indexes
   */
  async savePlaylistGroup(
    playlistGroup: PlaylistGroup,
    env: Env,
    update: boolean = false
  ): Promise<boolean> {
    if (playlistGroup.playlists.length === 0) {
      console.error('Playlist group has no playlists');
      return false;
    }

    // First, fetch and validate all external playlists in parallel
    const playlistValidationPromises = playlistGroup.playlists.map(async playlistUrl => {
      // If it's an external URL, fetch and validate it
      if (playlistUrl.startsWith('http://') || playlistUrl.startsWith('https://')) {
        return await this.fetchAndValidatePlaylist(playlistUrl, env);
      } else {
        throw new Error(`Invalid playlist URL: ${playlistUrl}`);
      }
    });

    // Validate all playlists in parallel
    const validatedPlaylists = await Promise.all(playlistValidationPromises);

    // Turn the validated playlists into a map for quick lookup
    const validatedPlaylistsMap = new Map(
      validatedPlaylists.map(playlist => [playlist.id, playlist])
    );

    // Core playlist group operations
    const groupData = JSON.stringify(playlistGroup);
    const operations = [
      // Main record by ID
      this.playlistGroupStorage.put(
        `${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${playlistGroup.id}`,
        groupData
      ),
      // Index by slug
      this.playlistGroupStorage.put(
        `${STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX}${playlistGroup.slug}`,
        playlistGroup.id
      ),
    ];

    // Created-time indexes for playlist groups
    if (playlistGroup.created) {
      const ts = this.toSortableTimestamps(playlistGroup.created);
      operations.push(
        this.playlistGroupStorage.put(
          `${STORAGE_KEYS.PLAYLIST_GROUP_CREATED_ASC_PREFIX}${ts.asc}:${playlistGroup.id}`,
          playlistGroup.id
        ),
        this.playlistGroupStorage.put(
          `${STORAGE_KEYS.PLAYLIST_GROUP_CREATED_DESC_PREFIX}${ts.desc}:${playlistGroup.id}`,
          playlistGroup.id
        )
      );
    }

    // If this is an update, figure out which playlists are no longer in the group
    // and clean up the old indexes.
    // To be simplified, we assume that uuid v4 is unique cross-system even though
    // the chance of collision is very low and could be ignored.
    if (update) {
      // Get all playlists that are currently in the group
      const playlistIds = await this.getPlaylistsForGroup(playlistGroup.id);

      // Filter out the playlists that are no longer in the group
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
            `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId}:${playlistGroup.id}`
          )
        );
        operations.push(
          this.playlistStorage.delete(
            `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroup.id}:${playlistId}`
          )
        );
        // Also remove created-time group playlist indexes
        if (playlistGroup.created) {
          const ts = this.toSortableTimestamps(playlistGroup.created);
          operations.push(
            this.playlistStorage.delete(
              `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${playlistId}`
            ),
            this.playlistStorage.delete(
              `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX}${playlistGroup.id}:${ts.desc}:${playlistId}`
            )
          );
        }
      }

      // Clean up the group associated playlist items
      const playlistKeys = playlistIdsToUnlink.map(id => `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${id}`);
      const playlists = await this.batchFetchFromStorage<Playlist>(
        playlistKeys,
        this.playlistStorage,
        'playlist'
      );
      for (const playlist of playlists) {
        for (const item of playlist.items) {
          operations.push(
            this.playlistItemStorage.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroup.id}:${item.id}`
            )
          );
          if (playlist.created) {
            const ts = this.toSortableTimestamps(playlist.created);
            operations.push(
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${item.id}`
              ),
              this.playlistItemStorage.delete(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroup.id}:${ts.desc}:${item.id}`
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
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${validPlaylist.id}:${playlistGroup.id}`,
          playlistGroup.id
        ),
        this.playlistStorage.put(
          `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroup.id}:${validPlaylist.id}`,
          validPlaylist.id
        )
      );

      // Created-time group->playlists indexes (based on playlist created time)
      if (validPlaylist.playlist.created) {
        const ts = this.toSortableTimestamps(validPlaylist.playlist.created);
        operations.push(
          this.playlistStorage.put(
            `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${validPlaylist.id}`,
            validPlaylist.id
          ),
          this.playlistStorage.put(
            `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX}${playlistGroup.id}:${ts.desc}:${validPlaylist.id}`,
            validPlaylist.id
          )
        );
      }
    }

    // Add playlist item operations to the same batch
    for (const validPlaylist of validatedPlaylists) {
      if (
        validPlaylist.playlist &&
        validPlaylist.external &&
        validPlaylist.playlist.items.length > 0
      ) {
        for (const item of validPlaylist.playlist.items) {
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

          // Secondary index by playlist group ID
          operations.push(
            this.playlistItemStorage.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroup.id}:${item.id}`,
              item.id
            )
          );

          // Secondary index by playlist group ID + created time using item's created
          if (item.created) {
            const ts = this.toSortableTimestamps(item.created);
            operations.push(
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${item.id}`,
                item.id
              ),
              this.playlistItemStorage.put(
                `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroup.id}:${ts.desc}:${item.id}`,
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
   * Get a playlist group by ID or slug
   */
  async getPlaylistGroupByIdOrSlug(identifier: string): Promise<PlaylistGroup | null> {
    const groupId = await this.resolveIdentifierToId(
      identifier,
      STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX,
      this.playlistGroupStorage
    );

    if (!groupId) return null;

    const groupData = await this.playlistGroupStorage.get(
      `${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${groupId}`
    );
    if (!groupData) return null;

    return JSON.parse(groupData) as PlaylistGroup;
  }

  /**
   * List all playlist groups with pagination support
   */
  async listAllPlaylistGroups(options: ListOptions = {}): Promise<PaginatedResult<PlaylistGroup>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? STORAGE_KEYS.PLAYLIST_GROUP_CREATED_ASC_PREFIX
        : options.sort === 'desc'
          ? STORAGE_KEYS.PLAYLIST_GROUP_CREATED_DESC_PREFIX
          : STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX; // Default to ID prefix when no sort provided

    const response = await this.playlistGroupStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const groupKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist-group:created:(asc|desc):${ts}:${groupId}
        const parts = key.name.split(':');
        const groupId = parts[parts.length - 1];
        groupKeys.push(`${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${groupId}`);
      } else {
        // Key format: playlist-group:id:${groupId}
        groupKeys.push(key.name);
      }
    }

    const groups = await this.batchFetchFromStorage<PlaylistGroup>(
      groupKeys,
      this.playlistGroupStorage,
      'playlist group'
    );

    return {
      items: groups,
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
   * List playlist items by playlist group ID with pagination
   */
  async listPlaylistItemsByGroupId(
    playlistGroupId: string,
    options: ListOptions = {}
  ): Promise<PaginatedResult<PlaylistItem>> {
    const limit = options.limit || 1000;

    const prefix =
      options.sort === 'asc'
        ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:`
        : options.sort === 'desc'
          ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroupId}:`
          : `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:`; // Default to basic group prefix

    const response = await this.playlistItemStorage.list({
      prefix,
      limit,
      cursor: options.cursor,
    });

    const playlistItemKeys: string[] = [];
    for (const key of response.keys) {
      if (options.sort) {
        // Key format: playlist-item:group-created:(asc|desc):${groupId}:${ts}:${playlistItemId}
        const keyParts = key.name.split(':');
        const playlistItemId = keyParts[keyParts.length - 1]; // Last part is the playlist item ID
        playlistItemKeys.push(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${playlistItemId}`);
      } else {
        // Key format: playlist-item:group-id:${groupId}:${playlistItemId}
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
}
