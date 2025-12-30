import type { Env } from '../types';
import { CloudFlareStorageProvider } from '../storage/cloudflare-kv';
import { CloudFlareQueueProvider } from '../queue/cloudflare-queue';
import type { KVNamespace, Queue } from '@cloudflare/workers-types';

/**
 * CloudFlare Worker bindings interface
 * This represents the raw bindings that CloudFlare Workers provides
 */
export interface CloudFlareBindings {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;

  // JWT configuration for user authentication (optional)
  JWT_PUBLIC_KEY?: string; // PEM format public key
  JWT_JWKS_URL?: string; // JWKS endpoint URL for remote key fetching
  JWT_ISSUER?: string; // Expected issuer claim (iss)
  JWT_AUDIENCE?: string; // Expected audience claim (aud)

  // CloudFlare KV bindings
  DP1_PLAYLISTS: KVNamespace;
  DP1_CHANNELS: KVNamespace;
  DP1_PLAYLIST_ITEMS: KVNamespace;

  // CloudFlare KV API credentials (for bulk write operations)
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_PLAYLISTS_NAMESPACE_ID: string;
  CLOUDFLARE_CHANNELS_NAMESPACE_ID: string;
  CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID: string;

  // CloudFlare Queue binding
  DP1_WRITE_QUEUE: Queue;

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string;
}

/**
 * Initialize environment from CloudFlare bindings
 * Converts raw CloudFlare bindings into our structured Env interface with providers
 */
export function initializeCloudFlareEnv(bindings: CloudFlareBindings): Env {
  // Validate required bindings
  if (!bindings.DP1_PLAYLISTS || !bindings.DP1_CHANNELS || !bindings.DP1_PLAYLIST_ITEMS) {
    throw new Error(
      'Missing required KV bindings: DP1_PLAYLISTS, DP1_CHANNELS, DP1_PLAYLIST_ITEMS'
    );
  }

  if (!bindings.DP1_WRITE_QUEUE) {
    throw new Error('Missing required Queue binding: DP1_WRITE_QUEUE');
  }

  // Detect local environment for miniflare compatibility
  const isLocal = bindings.ENVIRONMENT === 'local' || !bindings.ENVIRONMENT;

  // Validate required API credentials for bulk operations (skip for local dev)
  if (
    !isLocal &&
    (!bindings.CLOUDFLARE_API_TOKEN ||
      !bindings.CLOUDFLARE_ACCOUNT_ID ||
      !bindings.CLOUDFLARE_PLAYLISTS_NAMESPACE_ID ||
      !bindings.CLOUDFLARE_CHANNELS_NAMESPACE_ID ||
      !bindings.CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID)
  ) {
    throw new Error(
      'Missing required CloudFlare API credentials: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and namespace IDs'
    );
  }

  // Create providers from bindings
  const storageProvider = new CloudFlareStorageProvider(
    bindings.DP1_PLAYLISTS,
    bindings.DP1_CHANNELS,
    bindings.DP1_PLAYLIST_ITEMS,
    {
      accountId: bindings.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: bindings.CLOUDFLARE_PLAYLISTS_NAMESPACE_ID,
      apiToken: bindings.CLOUDFLARE_API_TOKEN,
      localBinding: isLocal, // Use bindings for bulk ops in local dev
    },
    {
      accountId: bindings.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: bindings.CLOUDFLARE_CHANNELS_NAMESPACE_ID,
      apiToken: bindings.CLOUDFLARE_API_TOKEN,
      localBinding: isLocal,
    },
    {
      accountId: bindings.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: bindings.CLOUDFLARE_PLAYLIST_ITEMS_NAMESPACE_ID,
      apiToken: bindings.CLOUDFLARE_API_TOKEN,
      localBinding: isLocal,
    }
  );

  const queueProvider = new CloudFlareQueueProvider(bindings.DP1_WRITE_QUEUE);

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    JWT_PUBLIC_KEY: bindings.JWT_PUBLIC_KEY,
    JWT_JWKS_URL: bindings.JWT_JWKS_URL,
    JWT_ISSUER: bindings.JWT_ISSUER,
    JWT_AUDIENCE: bindings.JWT_AUDIENCE,
    storageProvider,
    queueProvider,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}
