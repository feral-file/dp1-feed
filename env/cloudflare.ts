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

  // CloudFlare KV bindings
  DP1_PLAYLISTS: KVNamespace;
  DP1_PLAYLIST_ITEMS: KVNamespace;
  DP1_STARS: KVNamespace;

  // CloudFlare Queue bindings
  DP1_WRITE_QUEUE: Queue;
  FACTS_INGEST_QUEUE: Queue;

  // Registry webhook secret for HMAC verification
  REGISTRY_WEBHOOK_SECRET?: string;

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
  if (!bindings.DP1_PLAYLISTS || !bindings.DP1_PLAYLIST_ITEMS || !bindings.DP1_STARS) {
    throw new Error('Missing required KV bindings: DP1_PLAYLISTS, DP1_PLAYLIST_ITEMS, DP1_STARS');
  }

  if (!bindings.DP1_WRITE_QUEUE) {
    throw new Error('Missing required Queue binding: DP1_WRITE_QUEUE');
  }

  if (!bindings.FACTS_INGEST_QUEUE) {
    throw new Error('Missing required Queue binding: FACTS_INGEST_QUEUE');
  }

  // Create providers from bindings
  const storageProvider = new CloudFlareStorageProvider(
    bindings.DP1_PLAYLISTS,
    bindings.DP1_PLAYLIST_ITEMS,
    bindings.DP1_STARS
  );

  const queueProvider = new CloudFlareQueueProvider(
    bindings.DP1_WRITE_QUEUE,
    bindings.FACTS_INGEST_QUEUE
  );

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    storageProvider,
    queueProvider,
    REGISTRY_WEBHOOK_SECRET: bindings.REGISTRY_WEBHOOK_SECRET,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}
