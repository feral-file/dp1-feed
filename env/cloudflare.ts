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

  // Create providers from bindings
  const storageProvider = new CloudFlareStorageProvider(
    bindings.DP1_PLAYLISTS,
    bindings.DP1_CHANNELS,
    bindings.DP1_PLAYLIST_ITEMS
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
