import { describe, it, expect } from 'vitest';
import { validateIdentifier, isValidUUID, isValidSlug, isValidURL } from './helper';

describe('helper.ts', () => {
  describe('isValidUUID', () => {
    it('should return true for valid lowercase UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should return true for valid uppercase UUID', () => {
      const uuid = '550E8400-E29B-41D4-A716-446655440000';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should return true for valid mixed case UUID', () => {
      const uuid = '550E8400-e29b-41D4-A716-446655440000';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should return false for UUID with missing hyphens', () => {
      const uuid = '550e8400e29b41d4a716446655440000';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should return false for UUID with too many characters', () => {
      const uuid = '550e8400-e29b-41d4-a716-4466554400000';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should return false for UUID with too few characters', () => {
      const uuid = '550e8400-e29b-41d4-a716-44665544000';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should return false for UUID with invalid characters', () => {
      const uuid = '550e8400-e29b-41d4-a716-44665544000g';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidUUID('')).toBe(false);
    });

    it('should return false for string that is not a UUID', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
    });

    it('should return false for UUID with wrong format (wrong positions of hyphens)', () => {
      const uuid = '550e-8400e29b-41d4-a716-446655440000';
      expect(isValidUUID(uuid)).toBe(false);
    });
  });

  describe('isValidSlug', () => {
    it('should return true for lowercase alphanumeric slug', () => {
      expect(isValidSlug('my-slug-123')).toBe(true);
    });

    it('should return true for uppercase alphanumeric slug', () => {
      expect(isValidSlug('MY-SLUG-123')).toBe(true);
    });

    it('should return true for mixed case alphanumeric slug', () => {
      expect(isValidSlug('My-Slug-123')).toBe(true);
    });

    it('should return true for slug with only letters', () => {
      expect(isValidSlug('my-slug')).toBe(true);
    });

    it('should return true for slug with only numbers', () => {
      expect(isValidSlug('123-456')).toBe(true);
    });

    it('should return true for slug with only hyphens', () => {
      expect(isValidSlug('---')).toBe(true);
    });

    it('should return true for single character slug', () => {
      expect(isValidSlug('a')).toBe(true);
    });

    it('should return true for single number slug', () => {
      expect(isValidSlug('1')).toBe(true);
    });

    it('should return false for slug with spaces', () => {
      expect(isValidSlug('my slug')).toBe(false);
    });

    it('should return false for slug with underscores', () => {
      expect(isValidSlug('my_slug')).toBe(false);
    });

    it('should return false for slug with special characters', () => {
      expect(isValidSlug('my-slug!')).toBe(false);
    });

    it('should return false for slug with dots', () => {
      expect(isValidSlug('my.slug')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidSlug('')).toBe(false);
    });

    it('should return false for slug with unicode characters', () => {
      expect(isValidSlug('my-slug-ñ')).toBe(false);
    });

    it('should return false for slug with emoji', () => {
      expect(isValidSlug('my-slug-😀')).toBe(false);
    });
  });

  describe('validateIdentifier', () => {
    it('should return isValid=true, isUuid=true, isSlug=true for valid UUID (UUIDs also match slug pattern)', () => {
      const result = validateIdentifier('550e8400-e29b-41d4-a716-446655440000');
      expect(result.isValid).toBe(true);
      expect(result.isUuid).toBe(true);
      expect(result.isSlug).toBe(true); // UUIDs contain only alphanumeric and hyphens, so they match slug pattern
    });

    it('should return isValid=true, isUuid=false, isSlug=true for valid slug', () => {
      const result = validateIdentifier('my-slug-123');
      expect(result.isValid).toBe(true);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(true);
    });

    it('should return isValid=false for invalid identifier', () => {
      const result = validateIdentifier('invalid identifier!');
      expect(result.isValid).toBe(false);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(false);
    });

    it('should return isValid=false for empty string', () => {
      const result = validateIdentifier('');
      expect(result.isValid).toBe(false);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(false);
    });

    it('should return isValid=false for identifier with spaces', () => {
      const result = validateIdentifier('my identifier');
      expect(result.isValid).toBe(false);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(false);
    });

    it('should return isValid=false for identifier with special characters', () => {
      const result = validateIdentifier('my@identifier#123');
      expect(result.isValid).toBe(false);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(false);
    });

    it('should correctly identify uppercase UUID', () => {
      const result = validateIdentifier('550E8400-E29B-41D4-A716-446655440000');
      expect(result.isValid).toBe(true);
      expect(result.isUuid).toBe(true);
      expect(result.isSlug).toBe(true); // UUIDs contain only alphanumeric and hyphens, so they match slug pattern
    });

    it('should correctly identify mixed case slug', () => {
      const result = validateIdentifier('My-Slug-123');
      expect(result.isValid).toBe(true);
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(true);
    });

    it('should handle edge case: string that looks like UUID but has wrong format', () => {
      const result = validateIdentifier('550e8400e29b41d4a716446655440000');
      expect(result.isValid).toBe(true); // This is a valid slug (all hex chars)
      expect(result.isUuid).toBe(false);
      expect(result.isSlug).toBe(true); // This is actually a valid slug (all hex chars)
    });
  });

  describe('isValidURL', () => {
    it('should return true for valid http URL', () => {
      expect(isValidURL('http://example.com')).toBe(true);
    });

    it('should return true for valid https URL', () => {
      expect(isValidURL('https://example.com')).toBe(true);
    });

    it('should return true for URL with path', () => {
      expect(isValidURL('https://example.com/path/to/resource')).toBe(true);
    });

    it('should return true for URL with query parameters', () => {
      expect(isValidURL('https://example.com?param1=value1&param2=value2')).toBe(true);
    });

    it('should return true for URL with fragment', () => {
      expect(isValidURL('https://example.com#section')).toBe(true);
    });

    it('should return true for URL with port', () => {
      expect(isValidURL('https://example.com:8080')).toBe(true);
    });

    it('should return true for URL with subdomain', () => {
      expect(isValidURL('https://subdomain.example.com')).toBe(true);
    });

    it('should return true for URL with IP address', () => {
      expect(isValidURL('http://192.168.1.1')).toBe(true);
    });

    it('should return true for URL with localhost', () => {
      expect(isValidURL('http://localhost:3000')).toBe(true);
    });

    it('should return false for URL without protocol', () => {
      expect(isValidURL('example.com')).toBe(false);
    });

    it('should return false for URL with ftp protocol', () => {
      expect(isValidURL('ftp://example.com')).toBe(false);
    });

    it('should return false for URL with file protocol', () => {
      expect(isValidURL('file:///path/to/file')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidURL('')).toBe(false);
    });

    it('should return false for string with spaces', () => {
      expect(isValidURL('http://example.com/path with spaces')).toBe(false);
    });

    it('should return false for malformed URL', () => {
      expect(isValidURL('http://')).toBe(false);
    });

    it('should return false for URL with only protocol', () => {
      expect(isValidURL('https://')).toBe(false);
    });

    it('should return true for URL with complex path and query', () => {
      expect(isValidURL('https://example.com/api/v1/users?page=1&limit=10#top')).toBe(true);
    });

    it('should return true for URL with authentication', () => {
      expect(isValidURL('https://user:pass@example.com')).toBe(true);
    });
  });
});
