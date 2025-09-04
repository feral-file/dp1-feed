import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePlaylist,
  getPlaylistByIdOrSlug,
  listAllPlaylists,
  getPlaylistItemById,
  listAllPlaylistItems,
  STORAGE_KEYS,
} from './storage';
import type { Env, Playlist } from './types';
import { createTestEnv, MockKeyValueStorage, MockQueue } from './test-helpers';

const playlistId1 = '550e8400-e29b-41d4-a716-446655440000';
const itemId1 = '550e8400-e29b-41d4-a716-446655440001';
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

describe('Storage Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clear storage and mock between tests
    mockStorages.playlist.storage.clear();
    mockStorages.item.storage.clear();
  });

  describe('Playlist Storage', () => {
    it('should save and retrieve playlist by ID', async () => {
      // Save playlist
      const saved = await savePlaylist(testPlaylist, testEnv, false);
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
      await savePlaylist(testPlaylist, testEnv, false);

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
        await savePlaylist(playlist, testEnv, false);
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

    it('should update playlist and handle item changes', async () => {
      // Save initial playlist
      await savePlaylist(testPlaylist, testEnv, false);

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

  describe('Playlist Items Storage', () => {
    it('should save and retrieve playlist items', async () => {
      // Save playlist (which saves items)
      await savePlaylist(testPlaylist, testEnv, false);

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
        await savePlaylist(playlist, testEnv, false);
      }

      // List all items
      const result = await listAllPlaylistItems(testEnv, { limit: 4 });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toEqual(4);
    });
  });

  describe('Storage Key Consistency', () => {
    it('should use consistent key prefixes', () => {
      expect(STORAGE_KEYS.PLAYLIST_ID_PREFIX).toBe('playlist:id:');
      expect(STORAGE_KEYS.PLAYLIST_SLUG_PREFIX).toBe('playlist:slug:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX).toBe('playlist-item:id:');
      expect(STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX).toBe('playlist:created:asc:');
      expect(STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX).toBe('playlist:created:desc:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX).toBe('playlist-item:created:asc:');
      expect(STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX).toBe('playlist-item:created:desc:');
    });

    it('should create all required indexes when saving', async () => {
      await savePlaylist(testPlaylist, testEnv, false);
      const mockPlaylistKV = mockStorages.playlist;
      const mockItemKV = mockStorages.item;

      // Check playlist indexes
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_ID_PREFIX}${testPlaylist.id}`)
      ).toBe(true);
      expect(
        mockPlaylistKV.storage.has(`${STORAGE_KEYS.PLAYLIST_SLUG_PREFIX}${testPlaylist.slug}`)
      ).toBe(true);

      // Check playlist created indexes (use sortable timestamps with :id suffix)
      const playlistCreatedKeys = Array.from(mockPlaylistKV.storage.keys());
      expect(
        playlistCreatedKeys.some(key => key.startsWith(STORAGE_KEYS.PLAYLIST_CREATED_ASC_PREFIX))
      ).toBe(true);
      expect(
        playlistCreatedKeys.some(key => key.startsWith(STORAGE_KEYS.PLAYLIST_CREATED_DESC_PREFIX))
      ).toBe(true);

      // Check playlist item indexes (stored in item storage)
      expect(
        mockItemKV.storage.has(`${STORAGE_KEYS.PLAYLIST_ITEM_ID_PREFIX}${testPlaylist.items[0].id}`)
      ).toBe(true);
      // Note: item created indexes use sortable timestamps with :id suffix
      const itemCreatedKeys = Array.from(mockItemKV.storage.keys());
      expect(
        itemCreatedKeys.some(key => key.startsWith(STORAGE_KEYS.PLAYLIST_ITEM_CREATED_ASC_PREFIX))
      ).toBe(true);
      expect(
        itemCreatedKeys.some(key => key.startsWith(STORAGE_KEYS.PLAYLIST_ITEM_CREATED_DESC_PREFIX))
      ).toBe(true);
    });
  });

  describe('Sorting', () => {
    it('should sort playlists by created asc and desc', async () => {
      const p1 = { ...testPlaylist, id: 'p-1', slug: 'p-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: 'p-2', slug: 'p-2', created: '2024-01-02T00:00:00Z' };
      const p3 = { ...testPlaylist, id: 'p-3', slug: 'p-3', created: '2024-01-03T00:00:00Z' };
      await savePlaylist(p1, testEnv, false);
      await savePlaylist(p2, testEnv, false);
      await savePlaylist(p3, testEnv, false);

      const asc = await listAllPlaylists(testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(p => p.id)).toEqual(['p-1', 'p-2', 'p-3']);

      const desc = await listAllPlaylists(testEnv, { limit: 10, sort: 'desc' });
      expect(desc.items.map(p => p.id)).toEqual(['p-3', 'p-2', 'p-1']);
    });

    it('should sort playlist items globally by created asc and desc (based on item created)', async () => {
      const p1 = { ...testPlaylist, id: 'pp-1', slug: 'pp-1', created: '2024-01-01T00:00:00Z' };
      const p2 = { ...testPlaylist, id: 'pp-2', slug: 'pp-2', created: '2024-01-02T00:00:00Z' };
      const p3 = { ...testPlaylist, id: 'pp-3', slug: 'pp-3', created: '2024-01-03T00:00:00Z' };
      p1.items = [{ ...p1.items[0], id: 'i-1', created: '2024-01-01T00:00:00.001Z' }];
      p2.items = [{ ...p2.items[0], id: 'i-2', created: '2024-01-02T00:00:00.001Z' }];
      p3.items = [{ ...p3.items[0], id: 'i-3', created: '2024-01-03T00:00:00.001Z' }];
      await savePlaylist(p1, testEnv, false);
      await savePlaylist(p2, testEnv, false);
      await savePlaylist(p3, testEnv, false);

      const asc = await listAllPlaylistItems(testEnv, { limit: 10, sort: 'asc' });
      expect(asc.items.map(i => i.id)).toEqual(['i-1', 'i-2', 'i-3']);

      const desc = await listAllPlaylistItems(testEnv, { limit: 10, sort: 'desc' });
      expect(desc.items.map(i => i.id)).toEqual(['i-3', 'i-2', 'i-1']);
    });
  });

  describe('Error Handling and Edge Cases', () => {
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
