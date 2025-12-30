/**
 * Validate identifier format (UUID or slug)
 */
export function validateIdentifier(identifier: string): {
  isValid: boolean;
  isUuid: boolean;
  isSlug: boolean;
} {
  const isUuid = isValidUUID(identifier);
  const isSlug = isValidSlug(identifier);

  return {
    isValid: isUuid || isSlug,
    isUuid,
    isSlug,
  };
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Check if slug is valid
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(slug);
}

/**
 * Check if URL is valid
 */
export function isValidURL(url: string): boolean {
  return /^http[s]?:\/\/[^\s]+$/.test(url);
}
