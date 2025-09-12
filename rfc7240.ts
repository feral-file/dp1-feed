/**
 * RFC 7240 "Prefer" header utilities
 * Supports parsing the "Prefer: respond-async" header to determine persistence behavior
 */

import type { Context } from 'hono';

export interface PreferenceResult {
  respondAsync: boolean;
}

/**
 * Parse RFC 7240 Prefer header to determine if client prefers asynchronous response
 * @param c Hono context containing request headers
 * @returns Object indicating if client prefers async response
 */
export function parsePreferHeader(c: Context): PreferenceResult {
  const preferHeader = c.req.header('prefer') || c.req.header('Prefer');

  if (!preferHeader) {
    return { respondAsync: false };
  }

  // Parse prefer header - it can contain multiple preferences separated by commas
  // Example: "respond-async, wait=100"
  const preferences = preferHeader.split(',').map(p => p.trim().toLowerCase());

  // Check if respond-async is present
  const respondAsync = preferences.some(
    pref => pref === 'respond-async' || pref.startsWith('respond-async')
  );

  return { respondAsync };
}

/**
 * Determine if the request should use asynchronous persistence
 * Default behavior is synchronous unless "Prefer: respond-async" header is present
 * @param c Hono context
 * @returns true if should use async persistence, false for sync
 */
export function shouldUseAsyncPersistence(c: Context): boolean {
  const { respondAsync } = parsePreferHeader(c);
  return respondAsync;
}
