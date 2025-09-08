import type { Env, Playlist, PlaylistGroup, PlaylistItem } from './types';
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
 * List playlists by playlist group ID with pagination
 */
export async function listPlaylistsByGroupId(
  playlistGroupId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Playlist>> {
  const storageService = createStorageService(env);
  return await storageService.listPlaylistsByGroupId(playlistGroupId, options);
}

/**
 * Save a playlist group with multiple indexes
 */
export async function savePlaylistGroup(
  playlistGroup: PlaylistGroup,
  env: Env,
  update: boolean = false
): Promise<boolean> {
  const storageService = createStorageService(env);
  return await storageService.savePlaylistGroup(playlistGroup, env, update);
}

/**
 * Get a playlist group by ID or slug
 */
export async function getPlaylistGroupByIdOrSlug(
  identifier: string,
  env: Env
): Promise<PlaylistGroup | null> {
  const storageService = createStorageService(env);
  return await storageService.getPlaylistGroupByIdOrSlug(identifier);
}

/**
 * List all playlist groups with pagination support
 */
export async function listAllPlaylistGroups(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistGroup>> {
  const storageService = createStorageService(env);
  return await storageService.listAllPlaylistGroups(options);
}

/**
 * Get all playlist group IDs that a playlist belongs to (efficient reverse lookup)
 */
export async function getPlaylistGroupsForPlaylist(
  playlistId: string,
  env: Env
): Promise<string[]> {
  const storageService = createStorageService(env);
  return await storageService.getPlaylistGroupsForPlaylist(playlistId);
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

/**
 * List playlist items by playlist group ID with pagination
 */
export async function listPlaylistItemsByGroupId(
  playlistGroupId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistItem>> {
  const storageService = createStorageService(env);
  return await storageService.listPlaylistItemsByGroupId(playlistGroupId, options);
}

// Re-export types and constants for convenience
export type { PaginatedResult, ListOptions };
export { STORAGE_KEYS };
