/**
 * Environment binding type definitions
 * This file contains type-only exports to avoid bundling runtime-specific code
 */

// Re-export as types only to avoid bundling
export type { CloudFlareBindings } from './cloudflare';
export type { SelfHostedBindings } from './selfhosted';

// Union type for compatibility (type-only)
export type EnvironmentBindings =
  | import('./cloudflare').CloudFlareBindings
  | import('./selfhosted').SelfHostedBindings;
