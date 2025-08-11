import type { Env, Playlist, PlaylistGroup, PlaylistItem } from './types';
import { PlaylistSchema } from './types';
import type { KVNamespaceListResult } from '@cloudflare/workers-types';

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

/**
 * Generic helper function to batch fetch data from KV store
 */
async function batchFetchFromKV<T>(
  keys: string[],
  kvNamespace: KVNamespace,
  errorContext: string
): Promise<T[]> {
  if (keys.length === 0) return [];

  // Create a map to store results by key to preserve order
  const resultsMap = new Map<string, T>();
  const batchSize = 100;
  const batches: string[][] = [];

  // Split keys into batches of 100
  for (let i = 0; i < keys.length; i += batchSize) {
    batches.push(keys.slice(i, i + batchSize));
  }

  // Process all batches in parallel
  const batchPromises = batches.map(async batch => {
    try {
      // Use batch get to fetch multiple keys at once
      const batchResults = await kvNamespace.get(batch, { type: 'json' });

      // Check if batchResults is not null and has entries (real Cloudflare environment)
      if (batchResults && typeof (batchResults as any).entries === 'function') {
        // batchResults is a Map, so we iterate over entries
        for (const [key, data] of (batchResults as any).entries()) {
          if (data) {
            try {
              // Since we used type: 'json', the data is already parsed
              resultsMap.set(key, data as T);
            } catch (error) {
              console.error(`Error processing ${errorContext} ${key}:`, error);
            }
          }
        }
      } else {
        // Fallback for test environments - process sequentially to preserve order
        for (const key of batch) {
          try {
            const data = await kvNamespace.get(key, { type: 'json' });
            if (data) {
              if (typeof data === 'string') {
                try {
                  resultsMap.set(key, JSON.parse(data) as T);
                } catch (parseError) {
                  console.error(`Error parsing JSON for ${key}:`, parseError);
                }
              } else {
                resultsMap.set(key, data as T);
              }
            }
          } catch (error) {
            console.error(`Error processing ${errorContext} ${key}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing ${errorContext} batch:`, error);
    }
  });

  await Promise.all(batchPromises);

  // Return results in the same order as input keys
  const orderedResults: T[] = [];
  for (const key of keys) {
    const result = resultsMap.get(key);
    if (result) {
      orderedResults.push(result);
    }
  }

  return orderedResults;
}

/**
 * Utility: produce sortable timestamp strings for asc/desc indexes
 */
function toSortableTimestamps(isoTimestamp: string): { asc: string; desc: string } {
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
async function resolveIdentifierToId(
  identifier: string,
  slugPrefix: string,
  kv: KVNamespace
): Promise<string | null> {
  // Check if it's a UUID (if not, assume it's a slug)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  if (isUuid) {
    return identifier;
  } else {
    // It's a slug, get the ID
    return await kv.get(`${slugPrefix}${identifier}`);
  }
}

/**
 * Check if a URL points to a self-hosted domain
 */
function isSelfHostedUrl(url: string, selfHostedDomains?: string | null): boolean {
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
function extractPlaylistIdentifierFromUrl(url: string): string | null {
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
 * Cloudflare Workers restrictions on same-domain requests.
 */
async function fetchAndValidatePlaylist(
  url: string,
  env: Env
): Promise<{ id: string; playlist: Playlist; external: boolean }> {
  // Check if this is a self-hosted URL
  if (isSelfHostedUrl(url, env.SELF_HOSTED_DOMAINS ?? null)) {
    console.log(`Detected self-hosted URL ${url}, querying database directly`);

    const playlistIdentifier = extractPlaylistIdentifierFromUrl(url);
    if (!playlistIdentifier) {
      throw new Error(`Could not extract playlist identifier from self-hosted URL: ${url}`);
    }

    // Query the database directly instead of making an HTTP request (works with both IDs and slugs)
    const playlist = await getPlaylistByIdOrSlug(playlistIdentifier, env);
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
async function getPlaylistsForGroup(groupId: string, env: Env): Promise<string[]> {
  const prefix = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${groupId}:`;
  const playlistIds: string[] = [];
  let cursor: string | null = null;
  while (true) {
    const listResult: KVNamespaceListResult<string, string> = await env.DP1_PLAYLISTS.list({
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
    cursor = (listResult as any).cursor;
  }

  return playlistIds;
}

/**
 * Get all playlist group IDs that a playlist belongs to (efficient reverse lookup)
 */
export async function getPlaylistGroupsForPlaylist(
  playlistId: string,
  env: Env
): Promise<string[]> {
  const prefix = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId}:`;
  let cursor: string | null = null;
  const groupIds: string[] = [];
  while (true) {
    const listResult: KVNamespaceListResult<string, string> = await env.DP1_PLAYLISTS.list({
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
    cursor = (listResult as any).cursor;
  }

  return groupIds;
}

/**
 * Save a playlist with multiple indexes for efficient retrieval
 */
export async function savePlaylist(
  playlist: Playlist,
  env: Env,
  update: boolean = false
): Promise<boolean> {
  // Prepare all operations in a single batch
  const operations: Promise<void>[] = [];
  const playlistData = JSON.stringify(playlist);
  let existingPlaylist: Playlist | null = null;
  if (update) {
    existingPlaylist = await getPlaylistByIdOrSlug(playlist.id, env);
    if (!existingPlaylist) {
      throw new Error(`Playlist ${playlist.id} not found`);
    }
  }

  // Core playlist operations
  operations.push(
    env.DP1_PLAYLISTS.put(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlist.id}`, playlistData),
    env.DP1_PLAYLISTS.put(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${playlist.slug}`, playlist.id)
  );

  // Created-time indexes for playlists
  if (playlist.created) {
    const ts = toSortableTimestamps(playlist.created);
    operations.push(
      env.DP1_PLAYLISTS.put(
        `${STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX}${ts.asc}:${playlist.id}`,
        playlist.id
      ),
      env.DP1_PLAYLISTS.put(
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
    const playlistGroupIds = await getPlaylistGroupsForPlaylist(playlist.id, env);

    // Delete all items and their group associations (if any)
    for (const item of existingPlaylist.items) {
      operations.push(
        env.DP1_PLAYLIST_ITEMS.delete(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`)
      );
      // Delete created-time indexes for items using item's created
      if (item.created) {
        const oldTs = toSortableTimestamps(item.created);
        operations.push(
          env.DP1_PLAYLIST_ITEMS.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${oldTs.asc}:${item.id}`
          ),
          env.DP1_PLAYLIST_ITEMS.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${oldTs.desc}:${item.id}`
          )
        );
      }
      for (const playlistGroupId of playlistGroupIds) {
        operations.push(
          env.DP1_PLAYLIST_ITEMS.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:${item.id}`
          )
        );
        // Delete group-created indexes for items using item's created
        if (item.created) {
          const oldTs = toSortableTimestamps(item.created);
          operations.push(
            env.DP1_PLAYLIST_ITEMS.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:${oldTs.asc}:${item.id}`
            ),
            env.DP1_PLAYLIST_ITEMS.delete(
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
          env.DP1_PLAYLIST_ITEMS.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:${item.id}`,
            item.id
          )
        );
        // Add created-time group indexes for items using item's created
        if (item.created) {
          const ts = toSortableTimestamps(item.created);
          operations.push(
            env.DP1_PLAYLIST_ITEMS.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:${ts.asc}:${item.id}`,
              item.id
            ),
            env.DP1_PLAYLIST_ITEMS.put(
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
      env.DP1_PLAYLIST_ITEMS.put(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`, itemData)
    );
    // Global created-time indexes for items using item's created
    if (item.created) {
      const ts = toSortableTimestamps(item.created);
      operations.push(
        env.DP1_PLAYLIST_ITEMS.put(
          `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${ts.asc}:${item.id}`,
          item.id
        ),
        env.DP1_PLAYLIST_ITEMS.put(
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
export async function getPlaylistByIdOrSlug(
  identifier: string,
  env: Env
): Promise<Playlist | null> {
  const playlistId = await resolveIdentifierToId(
    identifier,
    STORAGE_KEYS.PLAYLIST_SLUG_PREFIX,
    env.DP1_PLAYLISTS
  );

  if (!playlistId) return null;

  const playlistData = await env.DP1_PLAYLISTS.get(
    `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${playlistId}`
  );
  if (!playlistData) return null;

  return JSON.parse(playlistData) as Playlist;
}

/**
 * List all playlists with pagination support
 */
export async function listAllPlaylists(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Playlist>> {
  const limit = options.limit || 1000;

  const prefix =
    options.sort === 'asc'
      ? STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX
      : options.sort === 'desc'
        ? STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX
        : STORAGE_KEYS.PLAYLIST_ID_PREFIX; // Default to ID prefix when no sort provided
  const response = await env.DP1_PLAYLISTS.list({
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
  const playlists = await batchFetchFromKV<Playlist>(playlistKeys, env.DP1_PLAYLISTS, 'playlist');
  return {
    items: playlists,
    cursor: (response as any).list_complete ? undefined : (response as any).cursor,
    hasMore: !(response as any).list_complete,
  };
}

/**
 * List playlists by playlist group ID with pagination
 */
export async function listPlaylistsByGroupId(
  playlistGroupId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Playlist>> {
  const limit = options.limit || 1000;

  const prefix =
    options.sort === 'asc'
      ? `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroupId}:`
      : options.sort === 'desc'
        ? `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX}${playlistGroupId}:`
        : `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroupId}:`; // Default to basic group prefix
  const response = await env.DP1_PLAYLISTS.list({
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

  const playlists = await batchFetchFromKV<Playlist>(playlistKeys, env.DP1_PLAYLISTS, 'playlist');

  return {
    items: playlists,
    cursor: (response as any).list_complete ? undefined : (response as any).cursor,
    hasMore: !(response as any).list_complete,
  };
}

/**
 * Save a playlist group with multiple indexes
 */
export async function savePlaylistGroup(
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
      return await fetchAndValidatePlaylist(playlistUrl, env);
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
    env.DP1_PLAYLIST_GROUPS.put(
      `${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${playlistGroup.id}`,
      groupData
    ),
    // Index by slug
    env.DP1_PLAYLIST_GROUPS.put(
      `${STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX}${playlistGroup.slug}`,
      playlistGroup.id
    ),
  ];

  // Created-time indexes for playlist groups
  if (playlistGroup.created) {
    const ts = toSortableTimestamps(playlistGroup.created);
    operations.push(
      env.DP1_PLAYLIST_GROUPS.put(
        `${STORAGE_KEYS.PLAYLIST_GROUP_CREATED_ASC_PREFIX}${ts.asc}:${playlistGroup.id}`,
        playlistGroup.id
      ),
      env.DP1_PLAYLIST_GROUPS.put(
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
    const playlistIds = await getPlaylistsForGroup(playlistGroup.id, env);

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
        env.DP1_PLAYLISTS.delete(
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId}:${playlistGroup.id}`
        )
      );
      operations.push(
        env.DP1_PLAYLISTS.delete(
          `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroup.id}:${playlistId}`
        )
      );
      // Also remove created-time group playlist indexes
      if (playlistGroup.created) {
        const ts = toSortableTimestamps(playlistGroup.created);
        operations.push(
          env.DP1_PLAYLISTS.delete(
            `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${playlistId}`
          ),
          env.DP1_PLAYLISTS.delete(
            `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_DESC_PREFIX}${playlistGroup.id}:${ts.desc}:${playlistId}`
          )
        );
      }
    }

    // Clean up the group associated playlist items
    const playlistKeys = playlistIdsToUnlink.map(id => `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${id}`);
    const playlists = await batchFetchFromKV<Playlist>(playlistKeys, env.DP1_PLAYLISTS, 'playlist');
    for (const playlist of playlists) {
      for (const item of playlist.items) {
        operations.push(
          env.DP1_PLAYLIST_ITEMS.delete(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroup.id}:${item.id}`
          )
        );
        if (playlist.created) {
          const ts = toSortableTimestamps(playlist.created);
          operations.push(
            env.DP1_PLAYLIST_ITEMS.delete(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${item.id}`
            ),
            env.DP1_PLAYLIST_ITEMS.delete(
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
        env.DP1_PLAYLISTS.put(
          `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${validPlaylist.id}`,
          JSON.stringify(validPlaylist.playlist)
        ),
        env.DP1_PLAYLISTS.put(
          `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${validPlaylist.playlist.slug}`,
          validPlaylist.id
        )
      );
      // Ensure playlist created-time indexes exist
      if (validPlaylist.playlist.created) {
        const ts = toSortableTimestamps(validPlaylist.playlist.created);
        operations.push(
          env.DP1_PLAYLISTS.put(
            `${STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX}${ts.asc}:${validPlaylist.id}`,
            validPlaylist.id
          ),
          env.DP1_PLAYLISTS.put(
            `${STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX}${ts.desc}:${validPlaylist.id}`,
            validPlaylist.id
          )
        );
      }
    }

    // Add bidirectional indexes for efficient lookups
    operations.push(
      env.DP1_PLAYLISTS.put(
        `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${validPlaylist.id}:${playlistGroup.id}`,
        playlistGroup.id
      ),
      env.DP1_PLAYLISTS.put(
        `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${playlistGroup.id}:${validPlaylist.id}`,
        validPlaylist.id
      )
    );

    // Created-time group->playlists indexes (based on playlist created time)
    if (validPlaylist.playlist.created) {
      const ts = toSortableTimestamps(validPlaylist.playlist.created);
      operations.push(
        env.DP1_PLAYLISTS.put(
          `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${validPlaylist.id}`,
          validPlaylist.id
        ),
        env.DP1_PLAYLISTS.put(
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
          env.DP1_PLAYLIST_ITEMS.put(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${item.id}`, itemData)
        );

        // Global created-time indexes for items using item's created
        if (item.created) {
          const ts = toSortableTimestamps(item.created);
          operations.push(
            env.DP1_PLAYLIST_ITEMS.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX}${ts.asc}:${item.id}`,
              item.id
            ),
            env.DP1_PLAYLIST_ITEMS.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX}${ts.desc}:${item.id}`,
              item.id
            )
          );
        }

        // Secondary index by playlist group ID
        operations.push(
          env.DP1_PLAYLIST_ITEMS.put(
            `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroup.id}:${item.id}`,
            item.id
          )
        );

        // Secondary index by playlist group ID + created time using item's created
        if (item.created) {
          const ts = toSortableTimestamps(item.created);
          operations.push(
            env.DP1_PLAYLIST_ITEMS.put(
              `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroup.id}:${ts.asc}:${item.id}`,
              item.id
            ),
            env.DP1_PLAYLIST_ITEMS.put(
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
export async function getPlaylistGroupByIdOrSlug(
  identifier: string,
  env: Env
): Promise<PlaylistGroup | null> {
  const groupId = await resolveIdentifierToId(
    identifier,
    STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX,
    env.DP1_PLAYLIST_GROUPS
  );

  if (!groupId) return null;

  const groupData = await env.DP1_PLAYLIST_GROUPS.get(
    `${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${groupId}`
  );
  if (!groupData) return null;

  return JSON.parse(groupData) as PlaylistGroup;
}

/**
 * List all playlist groups with pagination support
 */
export async function listAllPlaylistGroups(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistGroup>> {
  const limit = options.limit || 1000;

  const prefix =
    options.sort === 'asc'
      ? STORAGE_KEYS.PLAYLIST_GROUP_CREATED_ASC_PREFIX
      : options.sort === 'desc'
        ? STORAGE_KEYS.PLAYLIST_GROUP_CREATED_DESC_PREFIX
        : STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX; // Default to ID prefix when no sort provided
  const response = await env.DP1_PLAYLIST_GROUPS.list({
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

  const groups = await batchFetchFromKV<PlaylistGroup>(
    groupKeys,
    env.DP1_PLAYLIST_GROUPS,
    'playlist group'
  );

  return {
    items: groups,
    cursor: (response as any).list_complete ? undefined : (response as any).cursor,
    hasMore: !(response as any).list_complete,
  };
}

/**
 * Get a playlist item by ID
 */
export async function getPlaylistItemById(itemId: string, env: Env): Promise<PlaylistItem | null> {
  const itemData = await env.DP1_PLAYLIST_ITEMS.get(
    `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId}`
  );
  if (!itemData) return null;

  return JSON.parse(itemData) as PlaylistItem;
}

/**
 * List all playlist items
 */
export async function listAllPlaylistItems(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistItem>> {
  const limit = options.limit || 1000;

  const prefix =
    options.sort === 'asc'
      ? STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX
      : options.sort === 'desc'
        ? STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX
        : STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX; // Default to ID prefix when no sort provided
  const response = await env.DP1_PLAYLIST_ITEMS.list({
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

  const items = await batchFetchFromKV<PlaylistItem>(
    itemKeys,
    env.DP1_PLAYLIST_ITEMS,
    'playlist item'
  );

  return {
    items,
    cursor: (response as any).list_complete ? undefined : (response as any).cursor,
    hasMore: !(response as any).list_complete,
  };
}

/**
 * List playlist items by playlist group ID with pagination
 */
export async function listPlaylistItemsByGroupId(
  playlistGroupId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistItem>> {
  const limit = options.limit || 1000;

  const prefix =
    options.sort === 'asc'
      ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_ASC_PREFIX}${playlistGroupId}:`
      : options.sort === 'desc'
        ? `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_CREATED_DESC_PREFIX}${playlistGroupId}:`
        : `${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${playlistGroupId}:`; // Default to basic group prefix
  const response = await env.DP1_PLAYLIST_ITEMS.list({
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
  const playlistItems = await batchFetchFromKV<PlaylistItem>(
    playlistItemKeys,
    env.DP1_PLAYLIST_ITEMS,
    'playlist item'
  );

  return {
    items: playlistItems,
    cursor: (response as any).list_complete ? undefined : (response as any).cursor,
    hasMore: !(response as any).list_complete,
  };
}
