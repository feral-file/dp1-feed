import type { Env } from './types';
import { CloudFlareStorageProvider } from './storage/cloudflare-kv';
import { CloudFlareQueueProvider } from './queue/cloudflare-queue';
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
  DP1_PLAYLIST_GROUPS: KVNamespace;
  DP1_PLAYLIST_ITEMS: KVNamespace;

  // CloudFlare Queue binding
  DP1_WRITE_QUEUE: Queue;

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string;
}

/**
 * Self-hosted environment bindings interface
 * This represents configuration for alternative deployment scenarios
 */
export interface SelfHostedBindings {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;

  // FoundationDB configuration
  FOUNDATIONDB_CLUSTER_FILE?: string; // For FoundationDB cluster connection

  // NATS JetStream configuration
  NATS_URL?: string; // For NATS JetStream connection
  NATS_STREAM?: string; // NATS JetStream stream name
  NATS_SUBJECT?: string; // NATS JetStream subject pattern

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string;
}

/**
 * Union of all possible environment bindings
 */
export type EnvironmentBindings = CloudFlareBindings | SelfHostedBindings;

/**
 * Initialize environment from CloudFlare bindings
 * Converts raw CloudFlare bindings into our structured Env interface with providers
 */
export function initializeCloudFlareEnv(bindings: CloudFlareBindings): Env {
  // Validate required bindings
  if (!bindings.DP1_PLAYLISTS || !bindings.DP1_PLAYLIST_GROUPS || !bindings.DP1_PLAYLIST_ITEMS) {
    throw new Error(
      'Missing required KV bindings: DP1_PLAYLISTS, DP1_PLAYLIST_GROUPS, DP1_PLAYLIST_ITEMS'
    );
  }

  if (!bindings.DP1_WRITE_QUEUE) {
    throw new Error('Missing required Queue binding: DP1_WRITE_QUEUE');
  }

  // Create providers from bindings
  const storageProvider = new CloudFlareStorageProvider(
    bindings.DP1_PLAYLISTS,
    bindings.DP1_PLAYLIST_GROUPS,
    bindings.DP1_PLAYLIST_ITEMS
  );

  const queueProvider = new CloudFlareQueueProvider(bindings.DP1_WRITE_QUEUE);

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    storageProvider,
    queueProvider,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}

/**
 * Initialize environment from self-hosted bindings
 * Creates providers based on configuration for alternative deployment scenarios
 */
export function initializeSelfHostedEnv(bindings: SelfHostedBindings): Env {
  // Validate required configuration
  if (!bindings.FOUNDATIONDB_CLUSTER_FILE) {
    throw new Error('FOUNDATIONDB_CLUSTER_FILE is required for self-hosted deployment');
  }
  if (!bindings.NATS_URL || !bindings.NATS_STREAM) {
    throw new Error('NATS_URL and NATS_STREAM are required for self-hosted deployment');
  }

  // Create FoundationDB storage provider
  const storageProvider = createFoundationDBStorageProvider(bindings);

  // Create NATS JetStream queue provider
  const queueProvider = createNATSQueueProvider(bindings);

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    storageProvider,
    queueProvider,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}

/**
 * Factory function to create FoundationDB storage provider
 */
function createFoundationDBStorageProvider(_bindings: SelfHostedBindings): any {
  // Return FoundationDB storage provider
  throw new Error('FoundationDB storage provider not yet implemented');
}

/**
 * Factory function to create NATS JetStream queue provider
 */
function createNATSQueueProvider(_bindings: SelfHostedBindings): any {
  // Return NATS JetStream queue provider
  throw new Error('NATS JetStream queue provider not yet implemented');
}

/**
 * Helper function to detect if bindings are CloudFlare-specific
 */
export function isCloudFlareBindings(bindings: any): bindings is CloudFlareBindings {
  return (
    bindings &&
    typeof bindings === 'object' &&
    'DP1_PLAYLISTS' in bindings &&
    'DP1_PLAYLIST_GROUPS' in bindings &&
    'DP1_PLAYLIST_ITEMS' in bindings &&
    'DP1_WRITE_QUEUE' in bindings
  );
}

/**
 * Helper function to detect if bindings are self-hosted configuration
 */
export function isSelfHostedBindings(bindings: any): bindings is SelfHostedBindings {
  return (
    bindings &&
    typeof bindings === 'object' &&
    ('FOUNDATIONDB_CLUSTER_FILE' in bindings || 'NATS_URL' in bindings)
  );
}
