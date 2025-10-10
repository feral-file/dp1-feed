import type { Env } from './types';
import { Playlist, PlaylistItem } from 'dp1-js';
import { StorageService, STORAGE_KEYS } from './storage/service';
import type { PaginatedResult, ListOptions } from './storage/interfaces';

/**
 * Create and configure the storage service from environment
 */
function createStorageService(env: Env): StorageService {
  return new StorageService(env.storageProvider);
}

/**
 * Save a playlist with multiple indexes for efficient retrieval
 */
export async function savePlaylist(
  playlist: Playlist,
  env: Env,
  update: boolean = false
): Promise<boolean> {
  const storageService = createStorageService(env);
  return await storageService.savePlaylist(playlist, update);
}

/**
 * Get a playlist by ID or slug
 */
export async function getPlaylistByIdOrSlug(
  identifier: string,
  env: Env
): Promise<Playlist | null> {
  const storageService = createStorageService(env);
  return await storageService.getPlaylistByIdOrSlug(identifier);
}

/**
 * List all playlists with pagination support
 */
export async function listAllPlaylists(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Playlist>> {
  const storageService = createStorageService(env);
  return await storageService.listAllPlaylists(options);
}

/**
 * Get a playlist item by ID
 */
export async function getPlaylistItemById(itemId: string, env: Env): Promise<PlaylistItem | null> {
  const storageService = createStorageService(env);
  return await storageService.getPlaylistItemById(itemId);
}

/**
 * List all playlist items
 */
export async function listAllPlaylistItems(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistItem>> {
  const storageService = createStorageService(env);
  return await storageService.listAllPlaylistItems(options);
}

// Re-export types and constants for convenience
export type { PaginatedResult, ListOptions };
export { STORAGE_KEYS };
