import { z } from 'zod';
import {
  Playlist,
  validateDisplayPrefs,
  validateDpVersion,
  validateProvenance,
  validateRepro,
  ValidationResult,
  validatePlaylistItem,
} from 'dp1-js';

// Minimum DP-1 protocol version supported by this server
export const MIN_DP_VERSION = '1.0.0';

/**
 * Validates that update request doesn't contain protected fields
 */
export function validateNoProtectedFields(body: any): {
  isValid: boolean;
  protectedFields?: string[];
} {
  const protectedPlaylistFields = ['id', 'slug', 'created', 'signature'];
  const foundProtectedFields = protectedPlaylistFields.filter(field => field in body);

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

export interface Env {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string; // Required for playlist signing

  // Storage provider for data persistence (required)
  storageProvider: StorageProvider;

  // Queue provider for async processing (required)
  queueProvider: QueueProvider;

  // Registry webhook secret for HMAC verification (required for webhook endpoint)
  REGISTRY_WEBHOOK_SECRET?: string;

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string; // Comma-separated list of domains this worker is deployed to
}

// Generic helper to attach stable validation issues (code, path, message)
function attachValidationIssues(
  value: unknown,
  ctx: z.RefinementCtx,
  validator: (v: unknown) => ValidationResult,
  defaultMessage: string,
  code: string
) {
  const res = validator(value);
  if (res.success) {
    return;
  }

  const issues = res.error?.issues || [];
  if (issues.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ctx.path,
      message: res.error?.message || defaultMessage,
      params: { code },
      fatal: false,
    });
    return;
  }

  issues.forEach(issue => {
    const subPath =
      typeof issue?.path === 'string' && issue.path.length > 0 ? issue.path.split('.') : [];
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...ctx.path, ...subPath],
      message: issue?.message || defaultMessage,
      params: { code },
      fatal: false,
    });
  });
}

// Helper to attach stable validation issues (code, path, message) for display prefs
function attachDisplayValidationIssues(value: unknown, ctx: z.RefinementCtx) {
  return attachValidationIssues(
    value,
    ctx,
    validateDisplayPrefs,
    'Invalid display preferences',
    'invalid_display_prefs'
  );
}

function attachProvenanceValidationIssues(value: unknown, ctx: z.RefinementCtx) {
  return attachValidationIssues(
    value,
    ctx,
    validateProvenance,
    'Invalid provenance',
    'invalid_provenance'
  );
}

function attachReproValidationIssues(value: unknown, ctx: z.RefinementCtx) {
  return attachValidationIssues(value, ctx, validateRepro, 'Invalid reproduction', 'invalid_repro');
}

function attachPlaylistItemValidationIssues(value: unknown, ctx: z.RefinementCtx) {
  return attachValidationIssues(
    value,
    ctx,
    validatePlaylistItem,
    'Invalid playlist item',
    'invalid_playlist_item'
  );
}

// Zod Schemas for Request Validation

// Display Preferences Schema
const DisplayPrefsSchema = z
  .any()
  .optional()
  .superRefine((value, ctx) => attachDisplayValidationIssues(value, ctx));

// Reproduction Schema
const ReproSchema = z
  .any()
  .optional()
  .superRefine((value, ctx) => attachReproValidationIssues(value, ctx));

// Provenance Schema
const ProvenanceSchema = z
  .any()
  .optional()
  .superRefine((value, ctx) => attachProvenanceValidationIssues(value, ctx));

// Playlist Item Schema
const PlaylistItemSchema = z
  .any()
  .optional()
  .superRefine((value, ctx) => attachPlaylistItemValidationIssues(value, ctx));

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

export const PlaylistInputSchema = z.object({
  dpVersion: z
    .string()
    .max(16)
    .refine(
      version => {
        const validation = validateDpVersion(version);
        return validation.success;
      },
      version => {
        const validation = validateDpVersion(version);
        return {
          message:
            (validation as { error: { message: string } }).error.message || 'Invalid dpVersion',
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
  items: z.array(PlaylistItemInputSchema).min(1).max(1024),
});

// Update schemas that exclude protected fields
export const PlaylistUpdateSchema = z.object({
  dpVersion: z
    .string()
    .max(16)
    .refine(
      version => {
        const validation = validateDpVersion(version);
        return validation.success;
      },
      version => {
        const validation = validateDpVersion(version);
        return {
          message:
            (validation as { error: { message: string } }).error.message || 'Invalid dpVersion',
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
  items: z.array(PlaylistItemInputSchema).min(1).max(1024).optional(),
  title: z.string().max(256).optional(),
});

// Complete schemas with server-generated fields for output
export const PlaylistSchema = z.object({
  dpVersion: z
    .string()
    .max(16)
    .refine(
      version => {
        const validation = validateDpVersion(version);
        return validation.success;
      },
      version => {
        const validation = validateDpVersion(version);
        return {
          message:
            (validation as { error: { message: string } }).error.message || 'Invalid dpVersion',
        };
      }
    ),
  id: z.string().uuid(),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .max(64),
  title: z.string().max(256),
  created: z.string().datetime(),
  defaults: z
    .object({
      display: DisplayPrefsSchema,
      license: z.enum(['open', 'token', 'subscription']).optional(),
      duration: z.number().min(1).optional(),
    })
    .optional(),
  items: z.array(PlaylistItemSchema).min(1).max(1024),
  signature: z
    .string()
    .regex(/^ed25519:0x[a-fA-F0-9]+$/)
    .max(150),
});

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
export type PlaylistUpdate = z.infer<typeof PlaylistUpdateSchema>;

// Re-export queue message types from the queue package for convenience
export type {
  QueueMessage,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
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

// Utility function to transform input to complete playlist with server-generated fields
export function createPlaylistFromInput(input: PlaylistInput): Playlist {
  const playlistId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Generate IDs for all playlist items with unique timestamps
  const itemsWithIds = input.items.map((item, index) => {
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
    created: timestamp,
    defaults: input.defaults,
    items: itemsWithIds,
  };
}
