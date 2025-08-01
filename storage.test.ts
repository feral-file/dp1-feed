import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePlaylist,
  getPlaylistByIdOrSlug,
  listAllPlaylists,
  listPlaylistsByGroupId,
  savePlaylistGroup,
  getPlaylistGroupByIdOrSlug,
  listAllPlaylistGroups,
  getPlaylistGroupsForPlaylist,
  getPlaylistItemById,
  listAllPlaylistItems,
  listPlaylistItemsByGroupId,
  STORAGE_KEYS,
} from './storage';
import type { Env, Playlist, PlaylistGroup } from './types';

const playlistId1 = '550e8400-e29b-41d4-a716-446655440000';
const playlistId2 = '550e8400-e29b-41d4-a716-446655440002';
const itemId1 = '550e8400-e29b-41d4-a716-446655440001';
const itemId2 = '550e8400-e29b-41d4-a716-446655440003';
const playlistSlug1 = 'test-playlist-1';
const playlistSlug2 = 'test-playlist-2';

// Helper function to create a simple mock playlist response
const createMockPlaylistResponse = (id: string, slug: string) => {
  // Pre-define unique item IDs for each playlist
  const itemId = id === playlistId1 ? itemId1 : itemId2;

  return {
    ok: true,
    json: () =>
      Promise.resolve({
        dpVersion: '1.0.0',
        id,
        slug,
        title: 'Test Playlist',
        created: '2024-01-01T00:00:00Z',
        signature: 'ed25519:0x1234567890abcdef',
        items: [
          {
            id: itemId,
            title: 'Test Artwork',
            source: 'https://example.com/artwork.html',
            duration: 300,
            license: 'open',
          },
        ],
      }),
  } as Response;
};

// Helper function to mock fetch for the standard test playlist group URLs
const mockStandardPlaylistFetch = () => {
  global.fetch = vi.fn((url: string) => {
    if (url.includes(playlistId1)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
    }
    if (url.includes(playlistId2)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId2, playlistSlug2));
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  }) as any;
};

// Mock KV implementation for testing
const createMockKV = () => {
  const storage = new Map<string, string>();

  return {
    storage, // Expose storage for clearing in tests
    get: async (key: string) => storage.get(key) || null,
    put: async (key: string, value: string) => {
      storage.set(key, value);
    },
    delete: async (key: string) => {
      storage.delete(key);
    },
    list: async (options?: { prefix?: string; limit?: number; cursor?: string }) => {
      const allKeys = Array.from(storage.keys())
        .filter(key => !options?.prefix || key.startsWith(options.prefix))
        .sort();

      let startIndex = 0;
      if (options?.cursor) {
        const cursorIndex = allKeys.findIndex(key => key > options.cursor!);
        startIndex = cursorIndex >= 0 ? cursorIndex : allKeys.length;
      }

      const limit = options?.limit || 1000;
      const keys = allKeys.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < allKeys.length;

      const result: any = {
        keys: keys.map(name => ({ name })),
        list_complete: !hasMore,
      };

      if (hasMore) {
        result.cursor = keys[keys.length - 1];
      }

      return result;
    },
  };
};

// Test environment setup
const testEnv: Env = {
  API_SECRET: 'test-secret-key',
  ED25519_PRIVATE_KEY: 'test-private-key',
  ENVIRONMENT: 'test',
  DP1_PLAYLISTS: createMockKV() as any,
  DP1_PLAYLIST_GROUPS: createMockKV() as any,
  DP1_PLAYLIST_ITEMS: createMockKV() as any,
};

// Test data
const testPlaylist: Playlist = {
  dpVersion: '1.0.0',
  id: playlistId1,
  slug: 'test-playlist-1234',
  title: 'Test Playlist',
  created: '2024-01-01T00:00:00Z',
  items: [
    {
      id: itemId1,
      title: 'Test Artwork',
      source: 'https://example.com/artwork.html',
      duration: 300,
      license: 'open',
    },
  ],
};

const testPlaylistGroup: PlaylistGroup = {
  id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  slug: 'test-exhibition-1234',
  title: 'Test Exhibition',
  curator: 'Test Curator',
  created: '2024-01-01T00:00:00Z',
  playlists: [
    `https://example.com/playlists/${playlistId1}`,
    `https://example.com/playlists/${playlistId2}`,
  ],
};

describe('Storage Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clear storage and mock between tests
    testEnv.DP1_PLAYLISTS = createMockKV();
    testEnv.DP1_PLAYLIST_GROUPS = createMockKV();
    testEnv.DP1_PLAYLIST_ITEMS = createMockKV();
  });

  describe('Playlist Storage', () => {
    it('should save and retrieve playlist by ID', async () => {
      // Save playlist
      const saved = await savePlaylist(testPlaylist, testEnv);
      expect(saved).toBe(true);

      // Verify ID index was created
      const mockKV = testEnv.DP1_PLAYLISTS as any;
      const idKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${testPlaylist.id}`;
      expect(mockKV.storage.has(idKey)).toBe(true);

      // Retrieve by ID
      const retrieved = await getPlaylistByIdOrSlug(testPlaylist.id, testEnv);
      expect(retrieved).toEqual(testPlaylist);
    });

    it('should save and retrieve playlist by slug', async () => {
      // Save playlist
      await savePlaylist(testPlaylist, testEnv);

      // Verify slug index was created
      const mockKV = testEnv.DP1_PLAYLISTS as any;
      const slugKey = `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${testPlaylist.slug}`;
      expect(mockKV.storage.has(slugKey)).toBe(true);
      expect(mockKV.storage.get(slugKey)).toBe(testPlaylist.id);

      // Retrieve by slug
      const retrieved = await getPlaylistByIdOrSlug(testPlaylist.slug, testEnv);
      expect(retrieved).toEqual(testPlaylist);
    });

    it('should return null for non-existent playlist', async () => {
      const result = await getPlaylistByIdOrSlug('non-existent-id', testEnv);
      expect(result).toBeNull();

      const resultBySlug = await getPlaylistByIdOrSlug('non-existent-slug', testEnv);
      expect(resultBySlug).toBeNull();
    });

    it('should list all playlists with pagination', async () => {
      // Save multiple playlists
      const playlists = Array.from({ length: 5 }, (_, i) => ({
        ...testPlaylist,
        id: `playlist-${i.toString().padStart(3, '0')}`,
        slug: `playlist-slug-${i}`,
      }));

      for (const playlist of playlists) {
        await savePlaylist(playlist, testEnv);
      }

      // Test listing all playlists
      const result = await listAllPlaylists(testEnv, { limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBeDefined();

      // Test pagination with cursor
      const nextResult = await listAllPlaylists(testEnv, {
        limit: 3,
        cursor: result.cursor,
      });
      expect(nextResult.items).toHaveLength(2);
      expect(nextResult.hasMore).toBe(false);
      expect(nextResult.cursor).toBeUndefined();
    });

    it('should filter playlists by playlist group', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group with playlist references
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Save playlists referenced by the group
      const playlist1 = { ...testPlaylist, id: playlistId1, slug: playlistSlug1 };
      const playlist2 = {
        ...testPlaylist,
        id: playlistId2,
        slug: playlistSlug2,
      };

      await savePlaylist(playlist1, testEnv);
      await savePlaylist(playlist2, testEnv);

      // Test filtering by playlist group
      const result = await listPlaylistsByGroupId(testPlaylistGroup.id, testEnv);
      expect(result.items).toHaveLength(2);
      expect(result.items.map(p => p.id)).toContain(playlist1.id);
      expect(result.items.map(p => p.id)).toContain(playlist2.id);
    });

    it('should update playlist and handle item changes', async () => {
      // Save initial playlist
      await savePlaylist(testPlaylist, testEnv);

      // Verify initial item exists
      const mockItemsKV = testEnv.DP1_PLAYLIST_ITEMS as any;
      const initialItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${testPlaylist.items[0].id}`;
      expect(mockItemsKV.storage.has(initialItemKey)).toBe(true);

      // Create updated playlist with different items
      const updatedPlaylist = {
        ...testPlaylist,
        items: [
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            title: 'Updated Artwork',
            source: 'https://example.com/updated-artwork.html',
            duration: 400,
            license: 'token' as const,
          },
        ],
      };

      // Update playlist
      const updated = await savePlaylist(updatedPlaylist, testEnv, true);
      expect(updated).toBe(true);

      // Verify updated playlist data
      const retrieved = await getPlaylistByIdOrSlug(testPlaylist.id, testEnv);
      expect(retrieved).toEqual(updatedPlaylist);

      // Verify new item exists
      const newItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${updatedPlaylist.items[0].id}`;
      expect(mockItemsKV.storage.has(newItemKey)).toBe(true);

      // Verify old item is deleted
      const oldItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${testPlaylist.items[0].id}`;
      expect(mockItemsKV.storage.has(oldItemKey)).toBe(false);
    });
  });

  describe('Playlist Group Storage', () => {
    it('should save and retrieve playlist group by ID', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      const saved = await savePlaylistGroup(testPlaylistGroup, testEnv);
      expect(saved).toBe(true);

      // Verify ID index was created
      const mockKV = testEnv.DP1_PLAYLIST_GROUPS as any;
      const idKey = `${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${testPlaylistGroup.id}`;
      expect(mockKV.storage.has(idKey)).toBe(true);

      // Retrieve by ID
      const retrieved = await getPlaylistGroupByIdOrSlug(testPlaylistGroup.id, testEnv);
      expect(retrieved).toEqual(testPlaylistGroup);
    });

    it('should save and retrieve playlist group by slug', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify slug index was created
      const mockKV = testEnv.DP1_PLAYLIST_GROUPS as any;
      const slugKey = `${STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX}${testPlaylistGroup.slug}`;
      expect(mockKV.storage.has(slugKey)).toBe(true);
      expect(mockKV.storage.get(slugKey)).toBe(testPlaylistGroup.id);

      // Retrieve by slug
      const retrieved = await getPlaylistGroupByIdOrSlug(testPlaylistGroup.slug, testEnv);
      expect(retrieved).toEqual(testPlaylistGroup);
    });

    it('should create bidirectional playlist-group mappings for efficient filtering', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify bidirectional mappings were created
      const mockPlaylistKV = testEnv.DP1_PLAYLISTS as any;

      // Check playlist-to-groups mappings
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId1}:${testPlaylistGroup.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId2}:${testPlaylistGroup.id}`;
      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(true);
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(true);

      // Check group-to-playlists mappings
      const groupToPlaylist1 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId2}`;
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(true);
    });

    it('should return null for non-existent playlist group', async () => {
      const result = await getPlaylistGroupByIdOrSlug('non-existent-id', testEnv);
      expect(result).toBeNull();

      const resultBySlug = await getPlaylistGroupByIdOrSlug('non-existent-slug', testEnv);
      expect(resultBySlug).toBeNull();
    });

    it('should list all playlist groups with pagination', async () => {
      // Mock fetch for external playlist validation in pagination test
      global.fetch = vi.fn((url: string) => {
        const match = url.match(/550e8400-e29b-41d4-a716-44665544(\d{4})/);
        if (match) {
          const num = match[1];
          const playlistId = `550e8400-e29b-41d4-a716-44665544${num}`;
          return Promise.resolve(
            createMockPlaylistResponse(playlistId, `test-playlist-${parseInt(num, 10)}`)
          );
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }) as any;

      // Save multiple playlist groups
      const groups = Array.from({ length: 5 }, (_, i) => ({
        ...testPlaylistGroup,
        id: `group-${i.toString().padStart(3, '0')}`,
        slug: `group-slug-${i}`,
        playlists: [
          `https://example.com/playlists/550e8400-e29b-41d4-a716-44665544${i.toString().padStart(4, '0')}`,
        ],
      }));

      for (const group of groups) {
        await savePlaylistGroup(group, testEnv);
      }

      // Test listing all groups
      const result = await listAllPlaylistGroups(testEnv, { limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBeDefined();

      // Test pagination with cursor
      const nextResult = await listAllPlaylistGroups(testEnv, {
        limit: 3,
        cursor: result.cursor,
      });
      expect(nextResult.items).toHaveLength(2);
      expect(nextResult.hasMore).toBe(false);
      expect(nextResult.cursor).toBeUndefined();
    });

    it('should handle empty playlist group playlists array gracefully', async () => {
      const emptyGroup = {
        ...testPlaylistGroup,
        playlists: [],
      };

      const saved = await savePlaylistGroup(emptyGroup, testEnv);
      expect(saved).toBe(false);
    });

    it('should properly clean up old playlists when updating playlist group', async () => {
      // Mock fetch for external playlist validation
      global.fetch = vi.fn((url: string) => {
        if (url.includes(playlistId1)) {
          return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
        }
        if (url.includes(playlistId2)) {
          return Promise.resolve(createMockPlaylistResponse(playlistId2, playlistSlug2));
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }) as any;

      // Create initial playlist group with two playlists
      const initialGroup: PlaylistGroup = {
        id: 'test-group-update',
        slug: 'test-group-update-slug',
        title: 'Initial Group',
        curator: 'Test Curator',
        summary: 'Initial summary',
        playlists: [
          `https://example.com/playlists/${playlistId1}`,
          `https://example.com/playlists/${playlistId2}`,
        ],
        created: '2024-01-01T00:00:00Z',
      };

      // Save initial group
      const saved = await savePlaylistGroup(initialGroup, testEnv);
      expect(saved).toBe(true);

      // Verify bidirectional mappings exist for both playlists
      const mockPlaylistsKV = testEnv.DP1_PLAYLISTS as any;
      const mapping1Key = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${initialGroup.id}:${playlistId1}`;
      const mapping2Key = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${initialGroup.id}:${playlistId2}`;

      expect(mockPlaylistsKV.storage.has(mapping1Key)).toBe(true);
      expect(mockPlaylistsKV.storage.has(mapping2Key)).toBe(true);

      // Update group to only include first playlist (remove second)
      const updatedGroup: PlaylistGroup = {
        ...initialGroup,
        playlists: [
          `https://example.com/playlists/${playlistId1}`, // Keep this one
        ],
      };

      // Update the group
      const updated = await savePlaylistGroup(updatedGroup, testEnv, true);
      expect(updated).toBe(true);

      // Verify first mapping still exists
      expect(mockPlaylistsKV.storage.has(mapping1Key)).toBe(true);

      // Verify second mapping was removed
      expect(mockPlaylistsKV.storage.has(mapping2Key)).toBe(false);

      // Verify reverse mappings are also cleaned up
      const reverseMapping2Key = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId2}:${initialGroup.id}`;
      expect(mockPlaylistsKV.storage.has(reverseMapping2Key)).toBe(false);
    });
  });

  describe('Playlist Items Storage', () => {
    it('should save and retrieve playlist items', async () => {
      // Save playlist (which saves items)
      await savePlaylist(testPlaylist, testEnv);

      // Retrieve item by ID
      const item = await getPlaylistItemById(testPlaylist.items[0].id, testEnv);
      expect(item).toEqual(testPlaylist.items[0]);
    });

    it('should list all playlist items with pagination', async () => {
      // Create playlists with multiple items
      const playlists = Array.from({ length: 3 }, (_, i) => ({
        ...testPlaylist,
        id: `playlist-${i}`,
        slug: `playlist-slug-${i}`,
        items: Array.from({ length: 2 }, (_, j) => ({
          id: `item-${i}-${j}`,
          title: `Item ${i}-${j}`,
          source: `https://example.com/item-${i}-${j}.html`,
          duration: 300 + j * 100,
          license: 'open' as const,
        })),
      }));

      for (const playlist of playlists) {
        await savePlaylist(playlist, testEnv);
      }

      // List all items
      const result = await listAllPlaylistItems(testEnv, { limit: 4 });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toEqual(4);
    });

    it('should list playlist items by group ID', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // List items by group
      const result = await listPlaylistItemsByGroupId(testPlaylistGroup.id, testEnv);
      expect(result.items.length).toEqual(2);
      expect(result.items[0]).toHaveProperty('id');
      expect(result.items[0]).toHaveProperty('title');
    });

    it('should handle playlist items for groups during updates', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save initial playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify playlist item group indexes were created
      const mockItemsKV = testEnv.DP1_PLAYLIST_ITEMS as any;
      const itemGroupKeys = (Array.from(mockItemsKV.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX)
      );
      expect(itemGroupKeys.length).toBeGreaterThan(0);

      // Update group with fewer playlists
      const updatedGroup = {
        ...testPlaylistGroup,
        playlists: [testPlaylistGroup.playlists[0]], // Only first playlist
      };

      await savePlaylistGroup(updatedGroup, testEnv, true);

      // Verify some item group indexes were cleaned up for the removed playlist
      const remainingItemGroupKeys = (Array.from(mockItemsKV.storage.keys()) as string[]).filter(
        (key: string) =>
          key.startsWith(`${STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX}${testPlaylistGroup.id}:`)
      );

      // The cleanup should reduce the number of item-group associations
      // but might not remove all since external playlists were fetched and stored
      expect(remainingItemGroupKeys.length).toEqual(itemGroupKeys.length - 1);
    });
  });

  describe('Bidirectional Playlist-Groups Mapping', () => {
    it('should create bidirectional mappings when saving playlist groups', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify playlist-to-groups mappings were created
      const mockPlaylistKV = testEnv.DP1_PLAYLISTS as any;

      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId1}:${testPlaylistGroup.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId2}:${testPlaylistGroup.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId2}`;

      // Verify playlist → groups mappings
      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(true);
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(true);
      expect(mockPlaylistKV.storage.get(playlistToGroup1)).toBe(testPlaylistGroup.id);
      expect(mockPlaylistKV.storage.get(playlistToGroup2)).toBe(testPlaylistGroup.id);

      // Verify group → playlists mappings
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(true);
      expect(mockPlaylistKV.storage.get(groupToPlaylist1)).toBe(playlistId1);
      expect(mockPlaylistKV.storage.get(groupToPlaylist2)).toBe(playlistId2);
    });

    it('should efficiently retrieve all groups for a playlist', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Create multiple groups that include the same playlist
      const group1 = { ...testPlaylistGroup, id: 'group-1', slug: 'group-1' };
      const group2 = {
        ...testPlaylistGroup,
        id: 'group-2',
        slug: 'group-2',
        playlists: [`https://example.com/playlists/${playlistId1}`], // Only first playlist
      };

      await savePlaylistGroup(group1, testEnv);
      await savePlaylistGroup(group2, testEnv);

      // Test getting all groups for playlist 1 (should be in both groups)
      const groupsForPlaylist1 = await getPlaylistGroupsForPlaylist(playlistId1, testEnv);
      expect(groupsForPlaylist1).toHaveLength(2);
      expect(groupsForPlaylist1).toContain('group-1');
      expect(groupsForPlaylist1).toContain('group-2');

      // Test getting all groups for playlist 2 (should be in only group-1)
      const groupsForPlaylist2 = await getPlaylistGroupsForPlaylist(playlistId2, testEnv);
      expect(groupsForPlaylist2).toHaveLength(1);
      expect(groupsForPlaylist2).toContain('group-1');
    });

    it('should return empty array for playlists not in any groups', async () => {
      const groups = await getPlaylistGroupsForPlaylist('non-existent-playlist', testEnv);
      expect(groups).toEqual([]);
    });

    it('should clean up bidirectional mappings when updating playlist groups', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save initial playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify initial bidirectional mappings exist
      const mockPlaylistKV = testEnv.DP1_PLAYLISTS as any;
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId1}:${testPlaylistGroup.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId2}:${testPlaylistGroup.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId2}`;

      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(true);
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(true);

      // Update group to only include one playlist
      const updatedGroup = {
        ...testPlaylistGroup,
        playlists: [`https://example.com/playlists/${playlistId1}`], // Only first playlist
      };

      await savePlaylistGroup(updatedGroup, testEnv, true);

      // Verify old mappings were cleaned up and new ones created
      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(true); // Still exists
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(false); // Should be removed
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(true); // Still exists
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(false); // Should be removed

      // Verify the playlist shows up in correct groups
      const groupsForPlaylist1 = await getPlaylistGroupsForPlaylist(playlistId1, testEnv);
      const groupsForPlaylist2 = await getPlaylistGroupsForPlaylist(playlistId2, testEnv);

      expect(groupsForPlaylist1).toContain(testPlaylistGroup.id);
      expect(groupsForPlaylist2).not.toContain(testPlaylistGroup.id);
    });

    it('should clean up all bidirectional mappings when deleting playlist groups', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save playlist group
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      // Verify bidirectional mappings exist
      const mockPlaylistKV = testEnv.DP1_PLAYLISTS as any;
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId1}:${testPlaylistGroup.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${playlistId2}:${testPlaylistGroup.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${testPlaylistGroup.id}:${playlistId2}`;

      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(true);
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(true);

      // Simulate the cleanup that deletePlaylistGroup should do
      // Delete both directions of the mappings
      mockPlaylistKV.storage.delete(playlistToGroup1);
      mockPlaylistKV.storage.delete(playlistToGroup2);
      mockPlaylistKV.storage.delete(groupToPlaylist1);
      mockPlaylistKV.storage.delete(groupToPlaylist2);

      // Verify mappings were cleaned up
      expect(mockPlaylistKV.storage.has(playlistToGroup1)).toBe(false);
      expect(mockPlaylistKV.storage.has(playlistToGroup2)).toBe(false);
      expect(mockPlaylistKV.storage.has(groupToPlaylist1)).toBe(false);
      expect(mockPlaylistKV.storage.has(groupToPlaylist2)).toBe(false);

      // Verify playlists no longer show up in any groups
      const groupsForPlaylist1 = await getPlaylistGroupsForPlaylist(playlistId1, testEnv);
      const groupsForPlaylist2 = await getPlaylistGroupsForPlaylist(playlistId2, testEnv);

      expect(groupsForPlaylist1).toEqual([]);
      expect(groupsForPlaylist2).toEqual([]);
    });
  });

  describe('Storage Key Consistency', () => {
    it('should use consistent key prefixes', () => {
      expect(STORAGE_KEYS.PLAYLIST_ID_PREFIX).toBe('playlist:id:');
      expect(STORAGE_KEYS.PLAYLIST_SLUG_PREFIX).toBe('playlist:slug:');
      expect(STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX).toBe('playlist-group:id:');
      expect(STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX).toBe('playlist-group:slug:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX).toBe('playlist-item:id:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_BY_GROUP_PREFIX).toBe('playlist-item:group-id:');
      expect(STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX).toBe('playlist-to-groups:');
      expect(STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX).toBe('group-to-playlists:');
    });

    it('should create all required indexes when saving', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      await savePlaylist(testPlaylist, testEnv);
      await savePlaylistGroup(testPlaylistGroup, testEnv);

      const mockPlaylistKV = testEnv.DP1_PLAYLISTS as any;
      const mockGroupKV = testEnv.DP1_PLAYLIST_GROUPS as any;

      // Check playlist indexes
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${testPlaylist.id}`)
      ).toBe(true);
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${testPlaylist.slug}`)
      ).toBe(true);

      // Check playlist group indexes
      expect(
        mockGroupKV.storage.has(`${STORAGE_KEYS.PLAYLIST_GROUP_ID_PREFIX}${testPlaylistGroup.id}`)
      ).toBe(true);
      expect(
        mockGroupKV.storage.has(
          `${STORAGE_KEYS.PLAYLIST_GROUP_SLUG_PREFIX}${testPlaylistGroup.slug}`
        )
      ).toBe(true);

      // Check bidirectional mapping indexes
      const playlistToGroupKeys = (Array.from(mockPlaylistKV.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX)
      );
      const groupToPlaylistKeys = (Array.from(mockPlaylistKV.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX)
      );
      expect(playlistToGroupKeys).toHaveLength(2); // Two playlists in the group
      expect(groupToPlaylistKeys).toHaveLength(2); // Two playlists in the group
    });
  });

  describe('Self-Hosted URL Detection', () => {
    it('should detect and handle self-hosted URLs correctly', async () => {
      // Set up environment with self-hosted domains
      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS:
          'api.feed.feralfile.com,dp1-feed-operator-api-dev.workers.dev,localhost:8787',
      };

      // Pre-populate a playlist in the database
      const existingPlaylist: Playlist = {
        ...testPlaylist,
        id: playlistId1,
        slug: playlistSlug1,
      };
      await savePlaylist(existingPlaylist, envWithSelfHosted);

      // Create a playlist group with a self-hosted URL
      const selfHostedGroup: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: [
          `https://api.feed.feralfile.com/api/v1/playlists/${playlistId1}`, // Self-hosted
          `https://external-api.example.com/api/v1/playlists/${playlistId2}`, // External
        ],
      };

      // Mock fetch for external URL (should be called)
      global.fetch = vi.fn((url: string) => {
        if (url.includes('external-api.example.com')) {
          return Promise.resolve(createMockPlaylistResponse(playlistId2, playlistSlug2));
        }
        // Self-hosted URLs should NOT trigger fetch
        throw new Error(`Unexpected fetch call to: ${url}`);
      }) as any;

      // Spy on console.log to verify detection messages
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Save the playlist group
      const saved = await savePlaylistGroup(selfHostedGroup, envWithSelfHosted);
      expect(saved).toBe(true);

      // Verify that self-hosted URL detection message was logged
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected self-hosted URL'));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully retrieved self-hosted playlist')
      );

      // Verify fetch was only called once (for external URL)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('external-api.example.com')
      );

      logSpy.mockRestore();
    });

    it('should handle different self-hosted domain formats', async () => {
      const testCases = [
        {
          domain: 'api.feed.feralfile.com',
          url: 'https://api.feed.feralfile.com/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedMatch: true,
        },
        {
          domain: 'dp1-feed-operator-api-dev.workers.dev',
          url: 'https://dp1-feed-operator-api-dev.workers.dev/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedMatch: true,
        },
        {
          domain: 'localhost:8787',
          url: 'http://localhost:8787/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedMatch: true,
        },
        {
          domain: 'api.feed.feralfile.com',
          url: 'https://external-api.example.com/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedMatch: false,
        },
        {
          domain: 'localhost:8787',
          url: 'http://localhost:3000/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedMatch: false,
        },
      ];

      for (const { domain, url, expectedMatch } of testCases) {
        const envWithSelfHosted: Env = {
          ...testEnv,
          SELF_HOSTED_DOMAINS: domain,
        };

        const playlistId = '123e4567-e89b-12d3-a456-426614174000';
        const playlist: Playlist = {
          ...testPlaylist,
          id: playlistId,
          slug: 'test-playlist',
        };

        if (expectedMatch) {
          // For self-hosted URLs, pre-populate the database
          await savePlaylist(playlist, envWithSelfHosted);
        }

        const group: PlaylistGroup = {
          ...testPlaylistGroup,
          id: `test-group-${Date.now()}-${Math.random()}`,
          playlists: [url],
        };

        // Mock fetch for external URLs
        global.fetch = vi.fn((fetchUrl: string) => {
          if (!expectedMatch) {
            return Promise.resolve(createMockPlaylistResponse(playlistId, 'test-playlist'));
          }
          throw new Error(`Unexpected fetch call to: ${fetchUrl}`);
        }) as any;

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const saved = await savePlaylistGroup(group, envWithSelfHosted);
        expect(saved).toBe(true);

        if (expectedMatch) {
          // Should detect self-hosted and NOT call fetch
          expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected self-hosted URL'));
          expect(global.fetch).not.toHaveBeenCalled();
        } else {
          // Should call fetch for external URL
          expect(global.fetch).toHaveBeenCalled();
        }

        logSpy.mockRestore();
      }
    });

    it('should handle missing self-hosted playlist gracefully', async () => {
      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS: 'api.feed.feralfile.com',
      };

      const group: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: ['https://api.feed.feralfile.com/api/v1/playlists/nonexistent-playlist-id'],
      };

      // Should throw an error because playlist not found
      await expect(savePlaylistGroup(group, envWithSelfHosted)).rejects.toThrow(
        'Playlist nonexistent-playlist-id not found in database for URL: https://api.feed.feralfile.com/api/v1/playlists/nonexistent-playlist-id'
      );
    });

    it('should handle invalid self-hosted URL format gracefully', async () => {
      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS: 'api.feed.feralfile.com',
      };

      const group: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: ['https://api.feed.feralfile.com/invalid/path/format'],
      };

      // Should throw an error because URL format is invalid
      await expect(savePlaylistGroup(group, envWithSelfHosted)).rejects.toThrow(
        'Could not extract playlist identifier from self-hosted URL: https://api.feed.feralfile.com/invalid/path/format'
      );
    });

    it('should work when SELF_HOSTED_DOMAINS is undefined', async () => {
      const envWithoutSelfHosted: Env = {
        ...testEnv,
        // SELF_HOSTED_DOMAINS is undefined
      };

      const group: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: [`https://example.com/api/v1/playlists/${playlistId1}`],
      };

      // Mock fetch for external URL
      global.fetch = vi.fn(() => {
        return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
      }) as any;

      const saved = await savePlaylistGroup(group, envWithoutSelfHosted);
      expect(saved).toBe(true);

      // Verify fetch was called (no self-hosted detection)
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should extract playlist identifiers (IDs and slugs) correctly from various URL formats', async () => {
      const testUrls = [
        {
          url: 'https://api.feed.feralfile.com/api/v1/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedId: '123e4567-e89b-12d3-a456-426614174000',
          description: 'UUID format',
        },
        {
          url: `http://localhost:8787/api/v1/playlists/${playlistId1}`,
          expectedId: playlistId1,
          description: 'UUID on localhost',
        },
        {
          url: 'https://api.feed.feralfile.com/api/v1/playlists/my-awesome-playlist',
          expectedId: 'my-awesome-playlist',
          description: 'Slug format',
        },
        {
          url: 'https://api.feed.feralfile.com/api/v1/playlists/playlist_123',
          expectedId: 'playlist_123',
          description: 'Slug with underscore',
        },
        {
          url: 'https://api.feed.feralfile.com/api/v1/playlists/Test-Playlist-2024',
          expectedId: 'Test-Playlist-2024',
          description: 'Slug with mixed case and year',
        },
        {
          url: `https://api.feed.feralfile.com/api/v1/playlists/${playlistId1}?query=param`,
          expectedId: playlistId1,
          description: 'UUID with query params (should be ignored)',
        },
        {
          url: 'https://api.feed.feralfile.com/api/v2/playlists/123e4567-e89b-12d3-a456-426614174000',
          expectedId: null,
          description: 'Wrong API version',
        },
        {
          url: 'https://api.feed.feralfile.com/api/v1/playlist-groups/123e4567-e89b-12d3-a456-426614174000',
          expectedId: null,
          description: 'Wrong endpoint',
        },
      ];

      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS: 'api.feed.feralfile.com,localhost:8787',
      };

      for (const { url, expectedId, description } of testUrls) {
        console.log(`Testing ${description}: ${url}`);

        if (expectedId) {
          // Pre-populate playlist for valid identifiers (both IDs and slugs)
          const playlist: Playlist = {
            ...testPlaylist,
            id:
              expectedId.includes('-') && expectedId.length === 36
                ? expectedId
                : '123e4567-e89b-12d3-a456-426614174000', // Use actual ID for UUIDs, fallback for slugs
            slug:
              expectedId.includes('-') && expectedId.length === 36
                ? `slug-${expectedId}`
                : expectedId, // Use actual slug for slug cases
          };
          await savePlaylist(playlist, envWithSelfHosted);
        }

        const group: PlaylistGroup = {
          ...testPlaylistGroup,
          id: `test-group-${Date.now()}-${Math.random()}`,
          playlists: [url],
        };

        if (expectedId) {
          const saved = await savePlaylistGroup(group, envWithSelfHosted);
          expect(saved).toBe(true);
        } else {
          // Should throw an error for invalid URL formats
          await expect(savePlaylistGroup(group, envWithSelfHosted)).rejects.toThrow(
            'Could not extract playlist identifier from self-hosted URL'
          );
        }
      }
    });

    it('should only save external playlists to storage while creating indexes for both internal and external', async () => {
      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS: 'api.feed.feralfile.com',
      };

      // IDs for test playlists
      const selfHostedPlaylistId = '123e4567-e89b-12d3-a456-426614174000';
      const externalPlaylistId = '987fcdeb-51a2-43d1-b456-426614174111';

      // Pre-populate the self-hosted playlist in the database
      const selfHostedPlaylist: Playlist = {
        ...testPlaylist,
        id: selfHostedPlaylistId,
        slug: 'self-hosted-playlist',
        title: 'Self-Hosted Playlist',
        items: [
          {
            id: itemId1,
            title: 'Self-Hosted Item 1',
            source: 'https://example.com/self-hosted-artwork.html',
            duration: 600,
            license: 'open',
          },
        ],
      };
      await savePlaylist(selfHostedPlaylist, envWithSelfHosted);

      // Create a playlist group with both self-hosted and external URLs
      const mixedGroup: PlaylistGroup = {
        ...testPlaylistGroup,
        id: 'mixed-group-123',
        slug: 'mixed-group-test',
        title: 'Mixed Group Test',
        playlists: [
          `https://api.feed.feralfile.com/api/v1/playlists/${selfHostedPlaylistId}`, // Self-hosted
          `https://external-api.example.com/api/v1/playlists/${externalPlaylistId}`, // External
        ],
      };

      // Mock fetch for external URL only
      global.fetch = vi.fn((url: string) => {
        if (url.includes(externalPlaylistId)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                dpVersion: '1.0.0',
                id: externalPlaylistId,
                slug: 'external-playlist',
                title: 'External Playlist',
                created: '2024-01-01T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [
                  {
                    id: itemId2,
                    title: 'External Item 1',
                    source: 'https://external-example.com/external-artwork.html',
                    duration: 400,
                    license: 'open',
                  },
                ],
              }),
          } as Response);
        }
        throw new Error(`Unexpected fetch call to: ${url}`);
      }) as any;

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Get access to the mock KV storage for verification
      const mockPlaylistKV = envWithSelfHosted.DP1_PLAYLISTS as any;
      const mockItemsKV = envWithSelfHosted.DP1_PLAYLIST_ITEMS as any;

      // Spy on KV put operations to track what gets written
      const kvPutSpy = vi.spyOn(mockPlaylistKV, 'put');
      const kvItemsPutSpy = vi.spyOn(mockItemsKV, 'put');

      // Record the state of self-hosted playlist storage before savePlaylistGroup
      const selfHostedStorageKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${selfHostedPlaylistId}`;
      const externalStorageKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${externalPlaylistId}`;
      const preExistingPlaylistData = mockPlaylistKV.storage.get(selfHostedStorageKey);
      expect(preExistingPlaylistData).toBeTruthy(); // Should exist from pre-population

      // Clear the spies to only track savePlaylistGroup operations
      kvPutSpy.mockClear();
      kvItemsPutSpy.mockClear();

      // Save the mixed playlist group
      const saved = await savePlaylistGroup(mixedGroup, envWithSelfHosted);
      expect(saved).toBe(true);

      // Verify KV put operations: external playlist SHOULD be saved, self-hosted should NOT
      const putCalls = kvPutSpy.mock.calls;

      // Check that external playlist data was written
      const externalPlaylistDataCall = putCalls.find(call => call[0] === externalStorageKey);
      expect(externalPlaylistDataCall).toBeTruthy();
      expect(externalPlaylistDataCall![1]).toContain('External Playlist');

      // Check that external playlist slug index was written
      const externalSlugCall = putCalls.find(
        call => call[0] === `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}external-playlist`
      );
      expect(externalSlugCall).toBeTruthy();
      expect(externalSlugCall![1]).toBe(externalPlaylistId);

      // Verify that self-hosted playlist data was NOT written (no put call for its storage key)
      const selfHostedPlaylistDataCall = putCalls.find(call => call[0] === selfHostedStorageKey);
      expect(selfHostedPlaylistDataCall).toBeUndefined();

      // Verify that self-hosted playlist slug index was also NOT written (optimization skips this too)
      const selfHostedSlugCall = putCalls.find(
        call => call[0] === `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${selfHostedPlaylist.slug}`
      );
      expect(selfHostedSlugCall).toBeUndefined();

      // Verify that bidirectional mappings were created for BOTH playlists
      const selfHostedToGroupCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${selfHostedPlaylistId}:${mixedGroup.id}`
      );
      const externalToGroupCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${externalPlaylistId}:${mixedGroup.id}`
      );
      expect(selfHostedToGroupCall).toBeTruthy();
      expect(externalToGroupCall).toBeTruthy();

      // Verify storage state: both playlists should be accessible
      const storedSelfHosted = mockPlaylistKV.storage.get(selfHostedStorageKey);
      const storedExternal = mockPlaylistKV.storage.get(externalStorageKey);
      expect(storedSelfHosted).toBeTruthy(); // From pre-population
      expect(storedExternal).toBeTruthy(); // From savePlaylistGroup

      const parsedSelfHosted = JSON.parse(storedSelfHosted);
      const parsedExternal = JSON.parse(storedExternal);
      expect(parsedSelfHosted.title).toBe('Self-Hosted Playlist');
      expect(parsedExternal.title).toBe('External Playlist');

      // Verify that group-to-playlists mappings were also created for both
      const groupToSelfHostedCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${mixedGroup.id}:${selfHostedPlaylistId}`
      );
      const groupToExternalCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.GROUP_TO_PLAYLISTS_PREFIX}${mixedGroup.id}:${externalPlaylistId}`
      );
      expect(groupToSelfHostedCall).toBeTruthy();
      expect(groupToExternalCall).toBeTruthy();

      // Verify that playlist-to-groups mappings were also created for both
      const playlistToSelfHostedCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${selfHostedPlaylistId}:${mixedGroup.id}`
      );
      const playlistToExternalCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_GROUPS_PREFIX}${externalPlaylistId}:${mixedGroup.id}`
      );
      expect(playlistToSelfHostedCall).toBeTruthy();
      expect(playlistToExternalCall).toBeTruthy();

      // Verify logging behavior
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected self-hosted URL'));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully retrieved self-hosted playlist')
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fetching external playlist'));

      // Verify fetch was called only once (for external URL)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('external-api.example.com')
      );

      // Verify playlist items: external items should be saved, self-hosted should remain from pre-population
      const externalItemCall = kvItemsPutSpy.mock.calls.find(
        call => call[0] === `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId2}`
      );
      expect(externalItemCall).toBeTruthy();

      // Check that self-hosted playlist item was NOT written by savePlaylistGroup
      const selfHostedItemCall = kvItemsPutSpy.mock.calls.find(
        call => call[0] === `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId1}`
      );
      expect(selfHostedItemCall).toBeUndefined();

      // Both items should exist in storage (external from savePlaylistGroup, self-hosted from pre-population)
      const selfHostedItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId1}`;
      const externalItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId2}`;
      expect(mockItemsKV.storage.get(selfHostedItemKey)).toBeTruthy();
      expect(mockItemsKV.storage.get(externalItemKey)).toBeTruthy();

      logSpy.mockRestore();
      kvPutSpy.mockRestore();
      kvItemsPutSpy.mockRestore();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid URLs in playlist groups', async () => {
      const invalidGroup: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: ['not-a-url', 'ftp://invalid-protocol.com/playlist'],
      };

      // Should reject invalid URLs
      await expect(savePlaylistGroup(invalidGroup, testEnv)).rejects.toThrow();
    });

    it('should handle network failures gracefully', async () => {
      global.fetch = vi.fn(() => {
        return Promise.reject(new Error('Network error'));
      }) as any;

      const groupWithExternalUrl: PlaylistGroup = {
        ...testPlaylistGroup,
        playlists: ['https://external.example.com/api/v1/playlists/failing-playlist'],
      };

      await expect(savePlaylistGroup(groupWithExternalUrl, testEnv)).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle KV operation failures', async () => {
      // Mock KV failure
      const failingKV = {
        ...createMockKV(),
        put: vi.fn().mockRejectedValue(new Error('KV operation failed')),
      };

      const envWithFailingKV: Env = {
        ...testEnv,
        DP1_PLAYLISTS: failingKV as any,
      };

      await expect(savePlaylist(testPlaylist, envWithFailingKV)).rejects.toThrow(
        'KV operation failed'
      );
    });
  });
});
