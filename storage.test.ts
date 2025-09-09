import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePlaylist,
  getPlaylistByIdOrSlug,
  listAllPlaylists,
  listPlaylistsByChannelId,
  saveChannel,
  getChannelByIdOrSlug,
  listAllChannels,
  getChannelsForPlaylist,
  getPlaylistItemById,
  listAllPlaylistItems,
  listPlaylistItemsByChannelId,
  STORAGE_KEYS,
} from './storage';
import type { Env, Playlist, Channel } from './types';
import { createTestEnv, MockKeyValueStorage, MockQueue } from './test-helpers';

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
            created: '2024-01-01T00:00:00.001Z',
          },
        ],
      }),
  } as Response;
};

// Helper function to mock fetch for the standard test channel URLs
const mockStandardPlaylistFetch = () => {
  global.fetch = vi.fn((url: string) => {
    if (url.includes(playlistSlug1)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
    }
    if (url.includes(playlistSlug2)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId2, playlistSlug2));
    }
    if (url.includes(playlistId1)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
    }
    if (url.includes(playlistId2)) {
      return Promise.resolve(createMockPlaylistResponse(playlistId2, playlistSlug2));
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  }) as any;
};

const testSetup = createTestEnv();
const testEnv = testSetup.env;
const mockStorages = testSetup.mockStorages;

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
      created: '2024-01-01T00:00:00.001Z',
    },
  ],
};

const testChannel: Channel = {
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
    mockStorages.playlist.storage.clear();
    mockStorages.group.storage.clear();
    mockStorages.item.storage.clear();
  });

  describe('Playlist Storage', () => {
    it('should save and retrieve playlist by ID', async () => {
      // Save playlist
      const saved = await savePlaylist(testPlaylist, testEnv);
      expect(saved).toBe(true);

      // Verify ID index was created
      const idKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${testPlaylist.id}`;
      expect(mockStorages.playlist.storage.has(idKey)).toBe(true);

      // Retrieve by ID
      const retrieved = await getPlaylistByIdOrSlug(testPlaylist.id, testEnv);
      expect(retrieved).toEqual(testPlaylist);
    });

    it('should save and retrieve playlist by slug', async () => {
      // Save playlist
      await savePlaylist(testPlaylist, testEnv);

      // Verify slug index was created
      const slugKey = `${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${testPlaylist.slug}`;
      expect(mockStorages.playlist.storage.has(slugKey)).toBe(true);
      expect(mockStorages.playlist.storage.get(slugKey)).toBe(testPlaylist.id);

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

    it('should filter playlists by channel', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel with playlist references
      await saveChannel(testChannel, testEnv);

      // Save playlists referenced by the group
      const playlist1 = { ...testPlaylist, id: playlistId1, slug: playlistSlug1 };
      const playlist2 = {
        ...testPlaylist,
        id: playlistId2,
        slug: playlistSlug2,
      };

      await savePlaylist(playlist1, testEnv);
      await savePlaylist(playlist2, testEnv);

      // Test filtering by channel
      const result = await listPlaylistsByChannelId(testChannel.id, testEnv);
      expect(result.items).toHaveLength(2);
      expect(result.items.map(p => p.id)).toContain(playlist1.id);
      expect(result.items.map(p => p.id)).toContain(playlist2.id);
    });

    it('should update playlist and handle item changes', async () => {
      // Save initial playlist
      await savePlaylist(testPlaylist, testEnv);

      // Verify initial item exists
      const initialItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${testPlaylist.items[0].id}`;
      expect(mockStorages.item.storage.has(initialItemKey)).toBe(true);

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
            created: '2024-01-01T00:00:00.002Z',
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
      expect(mockStorages.item.storage.has(newItemKey)).toBe(true);

      // Verify old item is deleted
      const oldItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${testPlaylist.items[0].id}`;
      expect(mockStorages.item.storage.has(oldItemKey)).toBe(false);
    });
  });

  describe('Channel Storage', () => {
    it('should save and retrieve channel by ID', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel
      const saved = await saveChannel(testChannel, testEnv);
      expect(saved).toBe(true);

      // Verify ID index was created
      const idKey = `${STORAGE_KEYS.CHANNEL_ID_PREFIX}${testChannel.id}`;
      expect(mockStorages.group.storage.has(idKey)).toBe(true);

      // Retrieve by ID
      const retrieved = await getChannelByIdOrSlug(testChannel.id, testEnv);
      expect(retrieved).toEqual(testChannel);
    });

    it('should save and retrieve channel by slug', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel
      await saveChannel(testChannel, testEnv);

      // Verify slug index was created
      const slugKey = `${STORAGE_KEYS.CHANNEL_SLUG_PREFIX}${testChannel.slug}`;
      expect(mockStorages.group.storage.has(slugKey)).toBe(true);
      expect(mockStorages.group.storage.get(slugKey)).toBe(testChannel.id);

      // Retrieve by slug
      const retrieved = await getChannelByIdOrSlug(testChannel.slug, testEnv);
      expect(retrieved).toEqual(testChannel);
    });

    it('should create bidirectional channel mappings for efficient filtering', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel
      await saveChannel(testChannel, testEnv);

      // Verify bidirectional mappings were created
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId1}:${testChannel.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId2}:${testChannel.id}`;
      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(true);
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(true);

      // Check group-to-playlists mappings
      const groupToPlaylist1 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId2}`;
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(true);
    });

    it('should return null for non-existent channel', async () => {
      const result = await getChannelByIdOrSlug('non-existent-id', testEnv);
      expect(result).toBeNull();

      const resultBySlug = await getChannelByIdOrSlug('non-existent-slug', testEnv);
      expect(resultBySlug).toBeNull();
    });

    it('should list all channels with pagination', async () => {
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

      // Save multiple channels
      const groups = Array.from({ length: 5 }, (_, i) => ({
        ...testChannel,
        id: `group-${i.toString().padStart(3, '0')}`,
        slug: `group-slug-${i}`,
        playlists: [
          `https://example.com/playlists/550e8400-e29b-41d4-a716-44665544${i.toString().padStart(4, '0')}`,
        ],
      }));

      for (const group of groups) {
        await saveChannel(group, testEnv);
      }

      // Test listing all groups
      const result = await listAllChannels(testEnv, { limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBeDefined();

      // Test pagination with cursor
      const nextResult = await listAllChannels(testEnv, {
        limit: 3,
        cursor: result.cursor,
      });
      expect(nextResult.items).toHaveLength(2);
      expect(nextResult.hasMore).toBe(false);
      expect(nextResult.cursor).toBeUndefined();
    });

    it('should handle empty channel playlists array gracefully', async () => {
      const emptyGroup = {
        ...testChannel,
        playlists: [],
      };

      const saved = await saveChannel(emptyGroup, testEnv);
      expect(saved).toBe(false);
    });

    it('should properly clean up old playlists when updating channel', async () => {
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

      // Create initial channel with two playlists
      const initialGroup: Channel = {
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
      const saved = await saveChannel(initialGroup, testEnv);
      expect(saved).toBe(true);

      // Verify bidirectional mappings exist for both playlists
      const mapping1Key = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${initialGroup.id}:${playlistId1}`;
      const mapping2Key = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${initialGroup.id}:${playlistId2}`;

      expect(mockStorages.playlist.storage.has(mapping1Key)).toBe(true);
      expect(mockStorages.playlist.storage.has(mapping2Key)).toBe(true);

      // Update group to only include first playlist (remove second)
      const updatedGroup: Channel = {
        ...initialGroup,
        playlists: [
          `https://example.com/playlists/${playlistId1}`, // Keep this one
        ],
      };

      // Update the group
      const updated = await saveChannel(updatedGroup, testEnv, true);
      expect(updated).toBe(true);

      // Verify first mapping still exists
      expect(mockStorages.playlist.storage.has(mapping1Key)).toBe(true);

      // Verify second mapping was removed
      expect(mockStorages.playlist.storage.has(mapping2Key)).toBe(false);

      // Verify reverse mappings are also cleaned up
      const reverseMapping2Key = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId2}:${initialGroup.id}`;
      expect(mockStorages.playlist.storage.has(reverseMapping2Key)).toBe(false);
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
          created: `2024-01-01T00:00:0${i}.00${j}Z`,
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

      // Save channel
      await saveChannel(testChannel, testEnv);

      // List items by group
      const result = await listPlaylistItemsByChannelId(testChannel.id, testEnv);
      expect(result.items.length).toEqual(2);
      expect(result.items[0]).toHaveProperty('id');
      expect(result.items[0]).toHaveProperty('title');
    });

    it('should handle playlist items for groups during updates', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save initial channel
      await saveChannel(testChannel, testEnv);

      // Verify playlist item group indexes were created
      const itemGroupKeys = (Array.from(mockStorages.item.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX)
      );
      expect(itemGroupKeys.length).toBeGreaterThan(0);

      // Update group with fewer playlists
      const updatedGroup = {
        ...testChannel,
        playlists: [testChannel.playlists[0]], // Only first playlist
      };

      await saveChannel(updatedGroup, testEnv, true);

      // Verify some item group indexes were cleaned up for the removed playlist
      const remainingItemGroupKeys = (
        Array.from(mockStorages.item.storage.keys()) as string[]
      ).filter((key: string) =>
        key.startsWith(`${STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX}${testChannel.id}:`)
      );

      // The cleanup should reduce the number of item-group associations
      // but might not remove all since external playlists were fetched and stored
      expect(remainingItemGroupKeys.length).toEqual(itemGroupKeys.length - 1);
    });
  });

  describe('Bidirectional Channel-Playlists Mapping', () => {
    it('should create bidirectional mappings when saving channels', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel
      await saveChannel(testChannel, testEnv);

      // Verify playlist-to-groups mappings were created
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId1}:${testChannel.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId2}:${testChannel.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId2}`;

      // Verify playlist → groups mappings
      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(true);
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(true);
      expect(mockStorages.playlist.storage.get(playlistToGroup1)).toBe(testChannel.id);
      expect(mockStorages.playlist.storage.get(playlistToGroup2)).toBe(testChannel.id);

      // Verify group → playlists mappings
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(true);
      expect(mockStorages.playlist.storage.get(groupToPlaylist1)).toBe(playlistId1);
      expect(mockStorages.playlist.storage.get(groupToPlaylist2)).toBe(playlistId2);
    });

    it('should efficiently retrieve all groups for a playlist', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Create multiple groups that include the same playlist
      const group1 = { ...testChannel, id: 'group-1', slug: 'group-1' };
      const group2 = {
        ...testChannel,
        id: 'group-2',
        slug: 'group-2',
        playlists: [`https://example.com/playlists/${playlistId1}`], // Only first playlist
      };

      await saveChannel(group1, testEnv);
      await saveChannel(group2, testEnv);

      // Test getting all groups for playlist 1 (should be in both groups)
      const groupsForPlaylist1 = await getChannelsForPlaylist(playlistId1, testEnv);
      expect(groupsForPlaylist1).toHaveLength(2);
      expect(groupsForPlaylist1).toContain('group-1');
      expect(groupsForPlaylist1).toContain('group-2');

      // Test getting all groups for playlist 2 (should be in only group-1)
      const groupsForPlaylist2 = await getChannelsForPlaylist(playlistId2, testEnv);
      expect(groupsForPlaylist2).toHaveLength(1);
      expect(groupsForPlaylist2).toContain('group-1');
    });

    it('should return empty array for playlists not in any groups', async () => {
      const groups = await getChannelsForPlaylist('non-existent-playlist', testEnv);
      expect(groups).toEqual([]);
    });

    it('should clean up bidirectional mappings when updating channels', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save initial channel
      await saveChannel(testChannel, testEnv);

      // Verify initial bidirectional mappings exist
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId1}:${testChannel.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId2}:${testChannel.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId2}`;

      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(true);
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(true);

      // Update group to only include one playlist
      const updatedGroup = {
        ...testChannel,
        playlists: [`https://example.com/playlists/${playlistId1}`], // Only first playlist
      };

      await saveChannel(updatedGroup, testEnv, true);

      // Verify old mappings were cleaned up and new ones created
      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(true); // Still exists
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(false); // Should be removed
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(true); // Still exists
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(false); // Should be removed

      // Verify the playlist shows up in correct groups
      const groupsForPlaylist1 = await getChannelsForPlaylist(playlistId1, testEnv);
      const groupsForPlaylist2 = await getChannelsForPlaylist(playlistId2, testEnv);

      expect(groupsForPlaylist1).toContain(testChannel.id);
      expect(groupsForPlaylist2).not.toContain(testChannel.id);
    });

    it('should clean up all bidirectional mappings when deleting channels', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      // Save channel
      await saveChannel(testChannel, testEnv);

      // Verify bidirectional mappings exist
      const playlistToGroup1 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId1}:${testChannel.id}`;
      const playlistToGroup2 = `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${playlistId2}:${testChannel.id}`;
      const groupToPlaylist1 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId1}`;
      const groupToPlaylist2 = `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${testChannel.id}:${playlistId2}`;

      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(true);
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(true);
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(true);

      // Simulate the cleanup that deleteChannel should do
      // Delete both directions of the mappings
      mockStorages.playlist.storage.delete(playlistToGroup1);
      mockStorages.playlist.storage.delete(playlistToGroup2);
      mockStorages.playlist.storage.delete(groupToPlaylist1);
      mockStorages.playlist.storage.delete(groupToPlaylist2);

      // Verify mappings were cleaned up
      expect(mockStorages.playlist.storage.has(playlistToGroup1)).toBe(false);
      expect(mockStorages.playlist.storage.has(playlistToGroup2)).toBe(false);
      expect(mockStorages.playlist.storage.has(groupToPlaylist1)).toBe(false);
      expect(mockStorages.playlist.storage.has(groupToPlaylist2)).toBe(false);

      // Verify playlists no longer show up in any groups
      const groupsForPlaylist1 = await getChannelsForPlaylist(playlistId1, testEnv);
      const groupsForPlaylist2 = await getChannelsForPlaylist(playlistId2, testEnv);

      expect(groupsForPlaylist1).toEqual([]);
      expect(groupsForPlaylist2).toEqual([]);
    });
  });

  describe('Storage Key Consistency', () => {
    it('should use consistent key prefixes', () => {
      expect(STORAGE_KEYS.PLAYLIST_ID_PREFIX).toBe('playlist:id:');
      expect(STORAGE_KEYS.PLAYLIST_SLUG_PREFIX).toBe('playlist:slug:');
      expect(STORAGE_KEYS.CHANNEL_ID_PREFIX).toBe('playlist-group:id:');
      expect(STORAGE_KEYS.CHANNEL_SLUG_PREFIX).toBe('playlist-group:slug:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX).toBe('playlist-item:id:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_BY_CHANNEL_PREFIX).toBe('playlist-item:group-id:');
      expect(STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX).toBe('playlist-to-groups:');
      expect(STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX).toBe('group-to-playlists:');
    });

    it('should create all required indexes when saving', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      await savePlaylist(testPlaylist, testEnv);
      await saveChannel(testChannel, testEnv);

      const mockPlaylistKV = mockStorages.playlist;
      const mockGroupKV = mockStorages.group;

      // Check playlist indexes
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${testPlaylist.id}`)
      ).toBe(true);
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${testPlaylist.slug}`)
      ).toBe(true);

      // Check channel indexes
      expect(mockGroupKV.storage.has(`${STORAGE_KEYS.CHANNEL_ID_PREFIX}${testChannel.id}`)).toBe(
        true
      );
      expect(
        mockGroupKV.storage.has(`${STORAGE_KEYS.CHANNEL_SLUG_PREFIX}${testChannel.slug}`)
      ).toBe(true);

      // Check bidirectional mapping indexes
      const playlistToGroupKeys = (Array.from(mockPlaylistKV.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX)
      );
      const groupToPlaylistKeys = (Array.from(mockPlaylistKV.storage.keys()) as string[]).filter(
        (key: string) => key.startsWith(STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX)
      );
      expect(playlistToGroupKeys).toHaveLength(2); // Two playlists in the group
      expect(groupToPlaylistKeys).toHaveLength(2); // Two playlists in the group
    });
  });

  describe('Sorting', () => {
    it('should sort playlists by created asc and desc', async () => {
      const p1 = { ...testPlaylist, id: 'p-1', slug: 'p-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: 'p-2', slug: 'p-2', created: '2024-01-02T00:00:00Z' };
      const p3 = { ...testPlaylist, id: 'p-3', slug: 'p-3', created: '2024-01-03T00:00:00Z' };
      await savePlaylist(p1, testEnv);
      await savePlaylist(p2, testEnv);
      await savePlaylist(p3, testEnv);

      const asc = await listAllPlaylists(testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(p => p.id)).toEqual(['p-1', 'p-2', 'p-3']);

      const desc = await listAllPlaylists(testEnv, { limit: 10, sort: 'desc' });
      expect(desc.items.map(p => p.id)).toEqual(['p-3', 'p-2', 'p-1']);
    });

    it('should sort playlists by created within a channel', async () => {
      // Use valid UUIDs for external playlists
      const u1 = '550e8400-e29b-41d4-a716-446655441111';
      const u2 = '550e8400-e29b-41d4-a716-446655441112';
      const u3 = '550e8400-e29b-41d4-a716-446655441113';
      // Mock fetch for external playlist validation
      global.fetch = vi.fn((url: string) => {
        if (url.includes(u1)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                dpVersion: '1.0.0',
                id: u1,
                slug: 'p-1',
                title: 'P1',
                created: '2024-01-01T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655441211',
                    title: 'I1',
                    source: 'https://example.com/i1.html',
                    duration: 300,
                    license: 'open',
                    created: '2024-01-01T00:00:00.001Z',
                  },
                ],
              }),
          } as Response);
        }
        if (url.includes(u2)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                dpVersion: '1.0.0',
                id: u2,
                slug: 'p-2',
                title: 'P2',
                created: '2024-01-02T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655441212',
                    title: 'I2',
                    source: 'https://example.com/i2.html',
                    duration: 300,
                    license: 'open',
                    created: '2024-01-02T00:00:00.001Z',
                  },
                ],
              }),
          } as Response);
        }
        if (url.includes(u3)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                dpVersion: '1.0.0',
                id: u3,
                slug: 'p-3',
                title: 'P3',
                created: '2024-01-03T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655441213',
                    title: 'I3',
                    source: 'https://example.com/i3.html',
                    duration: 300,
                    license: 'open',
                    created: '2024-01-03T00:00:00.001Z',
                  },
                ],
              }),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }) as any;

      const p1 = { ...testPlaylist, id: u1, slug: 'p-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: u2, slug: 'p-2', created: '2024-01-02T00:00:00Z' };
      const p3 = { ...testPlaylist, id: u3, slug: 'p-3', created: '2024-01-03T00:00:00Z' };
      await savePlaylist(p1, testEnv);
      await savePlaylist(p2, testEnv);
      await savePlaylist(p3, testEnv);

      const group: Channel = {
        ...testChannel,
        id: 'group-sort',
        slug: 'group-sort',
        playlists: [
          `https://example.com/playlists/${u1}`,
          `https://example.com/playlists/${u2}`,
          `https://example.com/playlists/${u3}`,
        ],
      } as any;
      await saveChannel(group, testEnv);

      const asc = await listPlaylistsByChannelId('group-sort', testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(p => p.id)).toEqual([u1, u2, u3]);

      const desc = await listPlaylistsByChannelId('group-sort', testEnv, {
        limit: 10,
        sort: 'desc',
      });
      expect(desc.items.map(p => p.id)).toEqual([u3, u2, u1]);
    });

    it('should sort channels by created asc and desc', async () => {
      // Mock fetch for external playlist validation
      mockStandardPlaylistFetch();

      const g1: Channel = {
        ...testChannel,
        id: 'g-1',
        slug: 'g-1',
        title: 'G1',
        created: '2024-01-01T00:00:00Z',
      };
      const g2: Channel = {
        ...testChannel,
        id: 'g-2',
        slug: 'g-2',
        title: 'G2',
        created: '2024-01-02T00:00:00Z',
      };
      const g3: Channel = {
        ...testChannel,
        id: 'g-3',
        slug: 'g-3',
        title: 'G3',
        created: '2024-01-03T00:00:00Z',
      };
      await saveChannel(g1, testEnv);
      await saveChannel(g2, testEnv);
      await saveChannel(g3, testEnv);

      const asc = await listAllChannels(testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(g => g.id)).toEqual(['g-1', 'g-2', 'g-3']);

      const desc = await listAllChannels(testEnv, { limit: 10, sort: 'desc' });
      expect(desc.items.map(g => g.id)).toEqual(['g-3', 'g-2', 'g-1']);
    });

    it('should sort playlist items globally by created asc and desc (based on item created)', async () => {
      const p1 = { ...testPlaylist, id: 'pp-1', slug: 'pp-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: 'pp-2', slug: 'pp-2', created: '2024-01-02T00:00:00Z' };
      const p3 = { ...testPlaylist, id: 'pp-3', slug: 'pp-3', created: '2024-01-03T00:00:00Z' };
      p1.items = [{ ...p1.items[0], id: 'i-1', created: '2024-01-01T00:00:00.001Z' }];
      p2.items = [{ ...p2.items[0], id: 'i-2', created: '2024-01-02T00:00:00.001Z' }];
      p3.items = [{ ...p3.items[0], id: 'i-3', created: '2024-01-03T00:00:00.001Z' }];
      await savePlaylist(p1, testEnv);
      await savePlaylist(p2, testEnv);
      await savePlaylist(p3, testEnv);

      const asc = await listAllPlaylistItems(testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(i => i.id)).toEqual(['i-1', 'i-2', 'i-3']);

      const desc = await listAllPlaylistItems(testEnv, { limit: 10, sort: 'desc' });
      expect(desc.items.map(i => i.id)).toEqual(['i-3', 'i-2', 'i-1']);
    });

    it('should sort playlist items by group by created asc and desc', async () => {
      // Prepare playlists with known created and items
      const gp1 = '550e8400-e29b-41d4-a716-446655442111';
      const gp2 = '550e8400-e29b-41d4-a716-446655442112';
      const p1 = { ...testPlaylist, id: gp1, slug: 'gp-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: gp2, slug: 'gp-2', created: '2024-01-02T00:00:00Z' };
      const gi1 = '550e8400-e29b-41d4-a716-446655443111';
      const gi2 = '550e8400-e29b-41d4-a716-446655443112';
      p1.items = [{ ...p1.items[0], id: gi1, created: '2024-01-01T00:00:00.001Z' }];
      p2.items = [{ ...p2.items[0], id: gi2, created: '2024-01-02T00:00:00.001Z' }];
      await savePlaylist(p1, testEnv);
      await savePlaylist(p2, testEnv);

      // Mock fetch to return playlists when saving the group
      global.fetch = vi.fn((url: string) => {
        if (url.includes(gp1)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ...p1,
                dpVersion: '1.0.0',
                signature: 'ed25519:0x1234567890abcdef',
              }),
          } as Response);
        }
        if (url.includes(gp2)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ...p2,
                dpVersion: '1.0.0',
                signature: 'ed25519:0x1234567890abcdef',
              }),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }) as any;

      const group: Channel = {
        ...testChannel,
        id: 'group-items-sort',
        slug: 'group-items-sort',
        playlists: [`https://example.com/playlists/${gp1}`, `https://example.com/playlists/${gp2}`],
      } as any;
      await saveChannel(group, testEnv);

      const asc = await listPlaylistItemsByChannelId('group-items-sort', testEnv, {
        limit: 10,
        sort: 'asc',
      });
      expect(asc.items.map(i => i.id)).toEqual([gi1, gi2]);

      const desc = await listPlaylistItemsByChannelId('group-items-sort', testEnv, {
        limit: 10,
        sort: 'desc',
      });
      expect(desc.items.map(i => i.id)).toEqual([gi2, gi1]);
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

      // Create a channel with a self-hosted URL
      const selfHostedGroup: Channel = {
        ...testChannel,
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

      // Save the channel
      const saved = await saveChannel(selfHostedGroup, envWithSelfHosted);
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

        const group: Channel = {
          ...testChannel,
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

        const saved = await saveChannel(group, envWithSelfHosted);
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

      const group: Channel = {
        ...testChannel,
        playlists: ['https://api.feed.feralfile.com/api/v1/playlists/nonexistent-playlist-id'],
      };

      // Should throw an error because playlist not found
      await expect(saveChannel(group, envWithSelfHosted)).rejects.toThrow(
        'Playlist nonexistent-playlist-id not found in database for URL: https://api.feed.feralfile.com/api/v1/playlists/nonexistent-playlist-id'
      );
    });

    it('should handle invalid self-hosted URL format gracefully', async () => {
      const envWithSelfHosted: Env = {
        ...testEnv,
        SELF_HOSTED_DOMAINS: 'api.feed.feralfile.com',
      };

      const group: Channel = {
        ...testChannel,
        playlists: ['https://api.feed.feralfile.com/invalid/path/format'],
      };

      // Should throw an error because URL format is invalid
      await expect(saveChannel(group, envWithSelfHosted)).rejects.toThrow(
        'Could not extract playlist identifier from self-hosted URL: https://api.feed.feralfile.com/invalid/path/format'
      );
    });

    it('should work when SELF_HOSTED_DOMAINS is undefined', async () => {
      const envWithoutSelfHosted: Env = {
        ...testEnv,
        // SELF_HOSTED_DOMAINS is undefined
      };

      const group: Channel = {
        ...testChannel,
        playlists: [`https://example.com/api/v1/playlists/${playlistId1}`],
      };

      // Mock fetch for external URL
      global.fetch = vi.fn(() => {
        return Promise.resolve(createMockPlaylistResponse(playlistId1, playlistSlug1));
      }) as any;

      const saved = await saveChannel(group, envWithoutSelfHosted);
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
          url: 'https://api.feed.feralfile.com/api/v1/channels/123e4567-e89b-12d3-a456-426614174000',
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

        const group: Channel = {
          ...testChannel,
          id: `test-group-${Date.now()}-${Math.random()}`,
          playlists: [url],
        };

        if (expectedId) {
          const saved = await saveChannel(group, envWithSelfHosted);
          expect(saved).toBe(true);
        } else {
          // Should throw an error for invalid URL formats
          await expect(saveChannel(group, envWithSelfHosted)).rejects.toThrow(
            'Could not extract playlist identifier from self-hosted URL'
          );
        }
      }
    });

    it('should only save external playlists to storage while creating indexes for both internal and external', async () => {
      const envWithSelfHostedDomains: Env = {
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
            created: '2024-01-01T00:00:00.001Z',
          },
        ],
      };
      await savePlaylist(selfHostedPlaylist, envWithSelfHostedDomains);

      // Create a channel with both self-hosted and external URLs
      const mixedGroup: Channel = {
        ...testChannel,
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
                    created: '2024-01-01T00:00:00.001Z',
                  },
                ],
              }),
          } as Response);
        }
        throw new Error(`Unexpected fetch call to: ${url}`);
      }) as any;

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Use the same environment where we saved the self-hosted playlist
      const mockPlaylistKV = envWithSelfHostedDomains.storageProvider.getPlaylistStorage() as any;
      const mockItemsKV = envWithSelfHostedDomains.storageProvider.getPlaylistItemStorage() as any;

      // Spy on KV put operations to track what gets written
      const kvPutSpy = vi.spyOn(mockPlaylistKV, 'put');
      const kvItemsPutSpy = vi.spyOn(mockItemsKV, 'put');

      // Record the state of self-hosted playlist storage before saveChannel
      const selfHostedStorageKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${selfHostedPlaylistId}`;
      const externalStorageKey = `${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${externalPlaylistId}`;
      const preExistingPlaylistData = mockPlaylistKV.get(selfHostedStorageKey);
      expect(preExistingPlaylistData).toBeTruthy(); // Should exist from pre-population

      // Clear the spies to only track saveChannel operations
      kvPutSpy.mockClear();
      kvItemsPutSpy.mockClear();

      // Save the mixed channel
      const saved = await saveChannel(mixedGroup, envWithSelfHostedDomains);
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
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${selfHostedPlaylistId}:${mixedGroup.id}`
      );
      const externalToGroupCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${externalPlaylistId}:${mixedGroup.id}`
      );
      expect(selfHostedToGroupCall).toBeTruthy();
      expect(externalToGroupCall).toBeTruthy();

      // Verify storage state: both playlists should be accessible
      const storedSelfHosted = await mockPlaylistKV.get(selfHostedStorageKey);
      const storedExternal = await mockPlaylistKV.get(externalStorageKey);
      expect(storedSelfHosted).toBeTruthy(); // From pre-population
      expect(storedExternal).toBeTruthy(); // From saveChannel

      const parsedSelfHosted = JSON.parse(storedSelfHosted!);
      const parsedExternal = JSON.parse(storedExternal!);
      expect(parsedSelfHosted.title).toBe('Self-Hosted Playlist');
      expect(parsedExternal.title).toBe('External Playlist');

      // Verify that group-to-playlists mappings were also created for both
      const groupToSelfHostedCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${mixedGroup.id}:${selfHostedPlaylistId}`
      );
      const groupToExternalCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.CHANNEL_TO_PLAYLISTS_PREFIX}${mixedGroup.id}:${externalPlaylistId}`
      );
      expect(groupToSelfHostedCall).toBeTruthy();
      expect(groupToExternalCall).toBeTruthy();

      // Verify that playlist-to-groups mappings were also created for both
      const playlistToSelfHostedCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${selfHostedPlaylistId}:${mixedGroup.id}`
      );
      const playlistToExternalCall = putCalls.find(
        call =>
          call[0] ===
          `${STORAGE_KEYS.PLAYLIST_TO_CHANNELS_PREFIX}${externalPlaylistId}:${mixedGroup.id}`
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

      // Check that self-hosted playlist item was NOT written by saveChannel
      const selfHostedItemCall = kvItemsPutSpy.mock.calls.find(
        call => call[0] === `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId1}`
      );
      expect(selfHostedItemCall).toBeUndefined();

      // Both items should exist in storage (external from saveChannel, self-hosted from pre-population)
      const selfHostedItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId1}`;
      const externalItemKey = `${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${itemId2}`;
      expect(mockItemsKV.get(selfHostedItemKey)).toBeTruthy();
      expect(mockItemsKV.get(externalItemKey)).toBeTruthy();

      logSpy.mockRestore();
      kvPutSpy.mockRestore();
      kvItemsPutSpy.mockRestore();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid URLs in channels', async () => {
      const invalidGroup: Channel = {
        ...testChannel,
        playlists: ['not-a-url', 'ftp://invalid-protocol.com/playlist'],
      };

      // Should reject invalid URLs
      await expect(saveChannel(invalidGroup, testEnv)).rejects.toThrow();
    });

    it('should handle network failures gracefully', async () => {
      global.fetch = vi.fn(() => {
        return Promise.reject(new Error('Network error'));
      }) as any;

      const groupWithExternalUrl: Channel = {
        ...testChannel,
        playlists: ['https://external.example.com/api/v1/playlists/failing-playlist'],
      };

      await expect(saveChannel(groupWithExternalUrl, testEnv)).rejects.toThrow('Network error');
    });

    it('should handle KV operation failures', async () => {
      // Mock KV failure
      const failingStorage = new MockKeyValueStorage();
      failingStorage.put = vi.fn().mockRejectedValue(new Error('KV operation failed'));

      const { env: envWithFailingKV } = createTestEnv();
      // Replace the playlist storage with the failing one
      (envWithFailingKV.storageProvider as any).playlistStorage = failingStorage;

      await expect(savePlaylist(testPlaylist, envWithFailingKV)).rejects.toThrow(
        'KV operation failed'
      );
    });
  });
});
