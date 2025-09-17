import { z } from 'zod';
import * as semver from 'semver';
import canonicalize from 'canonicalize';

// Minimum DP-1 protocol version supported by this server
export const MIN_DP_VERSION = '1.0.0';

/**
 * Validates that a dpVersion is valid semver and greater than or equal to MIN_DP_VERSION
 */
export function validateDpVersion(dpVersion: string): {
  isValid: boolean;
  error?: string;
} {
  // First check if it's valid semver
  if (!semver.valid(dpVersion)) {
    return {
      isValid: false,
      error: `Invalid semantic version format: ${dpVersion}`,
    };
  }

  // Check if it meets minimum version requirement
  if (semver.lt(dpVersion, MIN_DP_VERSION)) {
    return {
      isValid: false,
      error: `dpVersion ${dpVersion} is below minimum required version ${MIN_DP_VERSION}`,
    };
  }

  return { isValid: true };
}

/**
 * Validates that update request doesn't contain protected fields
 */
export function validateNoProtectedFields(
  body: any,
  operation: 'playlist' | 'channel'
): { isValid: boolean; protectedFields?: string[] } {
  const protectedPlaylistFields = ['id', 'slug', 'created', 'signature'];
  const protectedChannelFields = ['id', 'slug', 'created', 'signature'];

  const protectedFields =
    operation === 'playlist' ? protectedPlaylistFields : protectedChannelFields;
  const foundProtectedFields = protectedFields.filter(field => field in body);

  if (foundProtectedFields.length > 0) {
    return {
      isValid: false,
      protectedFields: foundProtectedFields,
    };
  }

  return { isValid: true };
}

import type { StorageProvider } from './storage/interfaces';
import type { QueueProvider } from './queue/interfaces';

/**
 * JWT Configuration interface
 */
export interface JwtConfig {
  publicKey?: string; // PEM format public key
  jwksUrl?: string; // JWKS endpoint URL for remote key fetching
  issuer?: string; // Expected issuer claim (iss)
  audience?: string; // Expected audience claim (aud)
}

/**
 * JWT payload interface for authenticated requests
 */
export interface JwtPayload {
  sub?: string; // Subject (user ID)
  iss?: string; // Issuer
  aud?: string | string[]; // Audience
  exp?: number; // Expiration time
  iat?: number; // Issued at
  [key: string]: any; // Additional claims
}

export interface Env {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string; // Required for playlist signing

  // JWT configuration for user authentication (optional)
  JWT_PUBLIC_KEY?: string; // PEM format public key
  JWT_JWKS_URL?: string; // JWKS endpoint URL for remote key fetching
  JWT_ISSUER?: string; // Expected issuer claim (iss)
  JWT_AUDIENCE?: string; // Expected audience claim (aud)

  // Storage provider for data persistence (required)
  storageProvider: StorageProvider;

  // Queue provider for async processing (required)
  queueProvider: QueueProvider;

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string; // Comma-separated list of domains this worker is deployed to
}

// Zod Schemas for Request Validation

// Entity Schema
const EntitySchema = z.object({
  name: z.string().max(128),
  key: z
    .string()
    .regex(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/)
    .optional(),
  url: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
});

// Dynamic Query Schema
const DynamicQuerySchema = z.object({
  endpoint: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024),
  params: z.record(z.string().max(1024)),
});

// Display Preferences Schema
const DisplayPrefsSchema = z
  .object({
    scaling: z.enum(['fit', 'fill', 'stretch', 'auto']).optional(),
    margin: z
      .union([z.number().min(0), z.string().regex(/^[0-9]+(\.[0-9]+)?(px|%|vw|vh)$/)])
      .optional(),
    background: z
      .string()
      .regex(/^(#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})|transparent)$/)
      .optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    interaction: z
      .object({
        keyboard: z.array(z.string()).optional(),
        mouse: z
          .object({
            click: z.boolean().optional(),
            scroll: z.boolean().optional(),
            drag: z.boolean().optional(),
            hover: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .optional();

// Reproduction Schema
const ReproSchema = z
  .object({
    engineVersion: z.record(z.string()),
    seed: z
      .string()
      .regex(/^0x[a-fA-F0-9]+$/)
      .max(130)
      .optional(),
    assetsSHA256: z
      .array(
        z
          .string()
          .regex(/^0x[a-fA-F0-9]+$/)
          .max(66)
      )
      .max(1024),
    frameHash: z.object({
      sha256: z
        .string()
        .regex(/^0x[a-fA-F0-9]+$/)
        .max(66),
      phash: z
        .string()
        .regex(/^0x[a-fA-F0-9]+$/)
        .max(18)
        .optional(),
    }),
  })
  .optional();

// Provenance Schema
const ProvenanceSchema = z
  .object({
    type: z.enum(['onChain', 'seriesRegistry', 'offChainURI']),
    contract: z
      .object({
        chain: z.enum(['evm', 'tezos', 'bitmark', 'other']),
        standard: z.enum(['erc721', 'erc1155', 'fa2', 'other']).optional(),
        address: z.string().max(48).optional(),
        seriesId: z.union([z.number().min(0).max(4294967295), z.string().max(128)]).optional(),
        tokenId: z.string().max(128).optional(),
        uri: z
          .string()
          .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
          .max(1024)
          .optional(),
        metaHash: z
          .string()
          .regex(/^0x[a-fA-F0-9]+$/)
          .max(66)
          .optional(),
      })
      .optional(),
    dependencies: z
      .array(
        z.object({
          chain: z.enum(['evm', 'tezos', 'bitmark', 'other']),
          standard: z.enum(['erc721', 'erc1155', 'fa2', 'other']).optional(),
          uri: z
            .string()
            .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
            .max(1024),
        })
      )
      .max(1024)
      .optional(),
  })
  .optional();

// Playlist Item Schema
const PlaylistItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(256).optional(),
  source: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024),
  duration: z.number().min(1),
  license: z.enum(['open', 'token', 'subscription']),
  ref: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
  override: z.record(z.any()).optional(),
  display: DisplayPrefsSchema,
  repro: ReproSchema,
  provenance: ProvenanceSchema,
  created: z.string().datetime(),
});

// Base schemas without IDs for input validation
export const PlaylistItemInputSchema = z.object({
  title: z.string().max(256).optional(),
  source: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024),
  duration: z.number().min(1),
  license: z.enum(['open', 'token', 'subscription']),
  ref: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
  override: z.record(z.any()).optional(),
  display: DisplayPrefsSchema,
  repro: ReproSchema,
  provenance: ProvenanceSchema,
});

export const PlaylistInputSchema = z
  .object({
    dpVersion: z
      .string()
      .max(16)
      .refine(
        version => {
          const validation = validateDpVersion(version);
          return validation.isValid;
        },
        version => {
          const validation = validateDpVersion(version);
          return {
            message: validation.error || 'Invalid dpVersion',
          };
        }
      ),
    defaults: z
      .object({
        display: DisplayPrefsSchema,
        license: z.enum(['open', 'token', 'subscription']).optional(),
        duration: z.number().min(1).optional(),
      })
      .optional(),
    title: z.string().max(256),
    curators: z.array(EntitySchema).optional(),
    summary: z.string().max(4096).optional(),
    coverImage: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
      .max(1024)
      .optional(),
    items: z.array(PlaylistItemInputSchema).max(1024),
    dynamicQueries: z.array(DynamicQuerySchema).optional(),
  })
  .refine(
    data => {
      // Either items must have at least one item OR dynamicQueries must be present and non-empty
      return (
        (data.items && data.items.length > 0) ||
        (data.dynamicQueries && data.dynamicQueries.length > 0)
      );
    },
    {
      message: 'Playlist must have either items or dynamicQueries (or both)',
      path: ['items', 'dynamicQueries'],
    }
  );

export const ChannelInputSchema = z.object({
  title: z.string().max(256),
  curator: z.string().max(128).optional(),
  curators: z.array(EntitySchema).optional(),
  summary: z.string().max(4096).optional(),
  publisher: EntitySchema.optional(),
  playlists: z
    .array(
      z
        .string()
        .regex(/^http[s]?:\/\/[^\s]+$/)
        .max(1024)
    )
    .min(1)
    .max(1024),
  coverImage: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
});

// Update schemas that exclude protected fields
export const PlaylistUpdateSchema = z
  .object({
    dpVersion: z
      .string()
      .max(16)
      .refine(
        version => {
          const validation = validateDpVersion(version);
          return validation.isValid;
        },
        version => {
          const validation = validateDpVersion(version);
          return {
            message: validation.error || 'Invalid dpVersion',
          };
        }
      )
      .optional(),
    defaults: z
      .object({
        display: DisplayPrefsSchema,
        license: z.enum(['open', 'token', 'subscription']).optional(),
        duration: z.number().min(1).optional(),
      })
      .optional(),
    items: z.array(PlaylistItemInputSchema).max(1024).optional(),
    coverImage: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
      .max(1024)
      .optional(),
    title: z.string().max(256).optional(),
    curators: z.array(EntitySchema).optional(),
    summary: z.string().max(4096).optional(),
    dynamicQueries: z.array(DynamicQuerySchema).optional(),
  })
  .refine(
    data => {
      // If both items and dynamicQueries are provided, at least one must be non-empty
      // If only one is provided, it must be non-empty
      const hasItems = data.items && data.items.length > 0;
      const hasDynamicQueries = data.dynamicQueries && data.dynamicQueries.length > 0;

      // If neither items nor dynamicQueries are provided, that's valid (partial update)
      if (!data.items && !data.dynamicQueries) {
        return true;
      }

      // If either is provided, at least one must be non-empty
      return hasItems || hasDynamicQueries;
    },
    {
      message: 'If items or dynamicQueries are provided, at least one must be non-empty',
      path: ['items', 'dynamicQueries'],
    }
  );

export const ChannelUpdateSchema = z.object({
  title: z.string().max(256).optional(),
  curator: z.string().max(128).optional(),
  curators: z.array(EntitySchema).optional(),
  summary: z.string().max(4096).optional(),
  publisher: EntitySchema.optional(),
  playlists: z
    .array(
      z
        .string()
        .regex(/^http[s]?:\/\/[^\s]+$/)
        .max(1024)
    )
    .min(1)
    .max(1024)
    .optional(),
  coverImage: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
});

// Complete schemas with server-generated fields for output
export const PlaylistSchema = z
  .object({
    dpVersion: z
      .string()
      .max(16)
      .refine(
        version => {
          const validation = validateDpVersion(version);
          return validation.isValid;
        },
        version => {
          const validation = validateDpVersion(version);
          return {
            message: validation.error || 'Invalid dpVersion',
          };
        }
      ),
    id: z.string().uuid(),
    slug: z
      .string()
      .regex(/^[a-zA-Z0-9-]+$/)
      .max(64),
    title: z.string().max(256),
    curators: z.array(EntitySchema).optional(),
    summary: z.string().max(4096).optional(),
    created: z.string().datetime(),
    defaults: z
      .object({
        display: DisplayPrefsSchema,
        license: z.enum(['open', 'token', 'subscription']).optional(),
        duration: z.number().min(1).optional(),
      })
      .optional(),
    items: z.array(PlaylistItemSchema).max(1024),
    coverImage: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
      .max(1024)
      .optional(),
    dynamicQueries: z.array(DynamicQuerySchema).optional(),
    signature: z
      .string()
      .regex(/^ed25519:0x[a-fA-F0-9]+$/)
      .max(150),
  })
  .refine(
    data => {
      // Either items must have at least one item OR dynamicQueries must be present and non-empty
      return (
        (data.items && data.items.length > 0) ||
        (data.dynamicQueries && data.dynamicQueries.length > 0)
      );
    },
    {
      message: 'Playlist must have either items or dynamicQueries (or both)',
      path: ['items', 'dynamicQueries'],
    }
  );

export const ChannelSchema = z.object({
  id: z.string().uuid(),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .max(64),
  title: z.string().max(256),
  curator: z.string().max(128).optional(),
  curators: z.array(EntitySchema).optional(),
  summary: z.string().max(4096).optional(),
  publisher: EntitySchema.optional(),
  playlists: z
    .array(
      z
        .string()
        .regex(/^https:\/\/[^\s]+$/)
        .max(1024)
    )
    .min(1)
    .max(1024),
  created: z.string().datetime(),
  coverImage: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/)
    .max(1024)
    .optional(),
  signature: z
    .string()
    .regex(/^ed25519:0x[a-fA-F0-9]+$/)
    .max(150),
});

// DP-1 Core Types based on specification and OpenAPI schema

export interface DisplayPrefs {
  scaling?: 'fit' | 'fill' | 'stretch' | 'auto';
  margin?: number | string;
  background?: string;
  autoplay?: boolean;
  loop?: boolean;
  interaction?: {
    keyboard?: string[];
    mouse?: {
      click?: boolean;
      scroll?: boolean;
      drag?: boolean;
      hover?: boolean;
    };
  };
}

export interface Repro {
  engineVersion: Record<string, string>;
  seed?: string;
  assetsSHA256: string[];
  frameHash: {
    sha256: string;
    phash?: string;
  };
}

export interface Provenance {
  type: 'onChain' | 'seriesRegistry' | 'offChainURI';
  contract?: {
    chain: 'evm' | 'tezos' | 'bitmark' | 'other';
    standard?: 'erc721' | 'erc1155' | 'fa2' | 'other';
    address?: string;
    seriesId?: number | string;
    tokenId?: string;
    uri?: string;
    metaHash?: string;
  };
  dependencies?: Array<{
    chain: 'evm' | 'tezos' | 'bitmark' | 'other';
    standard?: 'erc721' | 'erc1155' | 'fa2' | 'other';
    uri: string;
  }>;
}

export interface PlaylistItem {
  id: string;
  title?: string;
  source: string;
  duration: number;
  license: 'open' | 'token' | 'subscription';
  ref?: string;
  override?: Record<string, any>;
  display?: DisplayPrefs;
  repro?: Repro;
  provenance?: Provenance;
  created: string;
}

export interface Playlist {
  dpVersion: string;
  id: string;
  slug: string;
  title: string;
  curators?: Entity[];
  summary?: string;
  coverImage?: string;
  created?: string;
  defaults?: {
    display?: DisplayPrefs;
    license?: 'open' | 'token' | 'subscription';
    duration?: number;
  };
  items: PlaylistItem[];
  dynamicQueries?: DynamicQuery[];
  signature?: string;
}

export interface Channel {
  id: string;
  slug: string;
  title: string;
  curator?: string;
  curators?: Entity[];
  summary?: string;
  publisher?: Entity;
  playlists: string[];
  created?: string;
  coverImage?: string;
  signature?: string;
}

export interface Entity {
  name: string;
  key?: string;
  url?: string;
}

export interface DynamicQuery {
  endpoint: string;
  params: Record<string, string>;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

// Crypto types for ed25519 signing
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

// Inferred types from Zod schemas
export type PlaylistInput = z.infer<typeof PlaylistInputSchema>;
export type PlaylistItemInput = z.infer<typeof PlaylistItemInputSchema>;
export type ChannelInput = z.infer<typeof ChannelInputSchema>;
export type PlaylistUpdate = z.infer<typeof PlaylistUpdateSchema>;
export type ChannelUpdate = z.infer<typeof ChannelUpdateSchema>;

// Re-export queue message types from the queue package for convenience
export type {
  QueueMessage,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
  CreateChannelMessage,
  UpdateChannelMessage,
  WriteOperationMessage,
} from './queue/interfaces';

// Utility function to generate slug from title
export function generateSlug(title: string): string {
  // Convert to lowercase, replace spaces and special chars with hyphens
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Add random 4-digit number to ensure uniqueness
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);

  // Ensure the slug doesn't exceed max length (64 chars)
  const maxBaseLength = 64 - 5; // Reserve 5 chars for "-1234"
  const trimmedBase =
    baseSlug.length > maxBaseLength ? baseSlug.substring(0, maxBaseLength) : baseSlug;

  return `${trimmedBase}-${randomSuffix}`;
}

/**
 * Create a deterministic content hash for playlist items using JCS (RFC 8785) and SHA-256
 * This allows us to detect changes in playlist items regardless of field order
 */
export async function createItemContentHash(item: PlaylistItemInput): Promise<string> {
  // Create a content object with only the fields that matter for change detection
  // Exclude server-generated fields like id and created
  const content = {
    title: item.title,
    source: item.source,
    duration: item.duration,
    license: item.license,
    ref: item.ref,
    override: item.override,
    display: item.display,
    repro: item.repro,
    provenance: item.provenance,
  };

  // Use JCS canonicalization for deterministic ordering
  const canonical = canonicalize(content);
  if (!canonical) {
    throw new Error('Failed to canonicalize playlist item content');
  }

  // Create SHA-256 hash of the canonical form
  // This works in both Node.js and Cloudflare Workers
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Utility function to transform input to complete playlist with server-generated fields
export function createPlaylistFromInput(input: PlaylistInput): Playlist {
  const playlistId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Generate IDs for all playlist items with unique timestamps
  const itemsWithIds = (input.items || []).map((item, index) => {
    // Create a unique timestamp for each item by adding milliseconds based on index
    const itemTimestamp = new Date(Date.now() + index).toISOString();
    return {
      ...item,
      id: crypto.randomUUID(),
      created: itemTimestamp,
    };
  });

  // Generate slug from first item title or playlist ID
  const slug = generateSlug(input.title || playlistId);

  return {
    dpVersion: input.dpVersion,
    id: playlistId,
    slug,
    title: input.title,
    curators: input.curators,
    summary: input.summary,
    coverImage: input.coverImage,
    created: timestamp,
    defaults: input.defaults,
    items: itemsWithIds,
    dynamicQueries: input.dynamicQueries,
  };
}

// Utility function to transform input to complete channel with server-generated fields
export function createChannelFromInput(input: ChannelInput): Channel {
  const channelId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const slug = generateSlug(input.title);

  return {
    id: channelId,
    slug,
    title: input.title,
    curator: input.curator,
    curators: input.curators,
    publisher: input.publisher,
    summary: input.summary,
    playlists: input.playlists,
    created: timestamp,
    coverImage: input.coverImage,
  };
}
