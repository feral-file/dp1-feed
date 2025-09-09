import type { Env, Playlist, Channel, PlaylistItem } from './types';
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
 * List playlists by channel ID with pagination
 */
export async function listPlaylistsByChannelId(
  channelId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Playlist>> {
  const storageService = createStorageService(env);
  return await storageService.listPlaylistsByChannelId(channelId, options);
}

/**
 * Save a channel with multiple indexes
 */
export async function saveChannel(
  channel: Channel,
  env: Env,
  update: boolean = false
): Promise<boolean> {
  const storageService = createStorageService(env);
  return await storageService.saveChannel(channel, env, update);
}

/**
 * Get a channel by ID or slug
 */
export async function getChannelByIdOrSlug(identifier: string, env: Env): Promise<Channel | null> {
  const storageService = createStorageService(env);
  return await storageService.getChannelByIdOrSlug(identifier);
}

/**
 * List all channels with pagination support
 */
export async function listAllChannels(
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<Channel>> {
  const storageService = createStorageService(env);
  return await storageService.listAllChannels(options);
}

/**
 * Get all channel IDs that a playlist belongs to (efficient reverse lookup)
 */
export async function getChannelsForPlaylist(playlistId: string, env: Env): Promise<string[]> {
  const storageService = createStorageService(env);
  return await storageService.getChannelsForPlaylist(playlistId);
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
 * List playlist items by channel ID with pagination
 */
export async function listPlaylistItemsByChannelId(
  channelId: string,
  env: Env,
  options: ListOptions = {}
): Promise<PaginatedResult<PlaylistItem>> {
  const storageService = createStorageService(env);
  return await storageService.listPlaylistItemsByChannelId(channelId, options);
}

// Re-export types and constants for convenience
export type { PaginatedResult, ListOptions };
export { STORAGE_KEYS };
