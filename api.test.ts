import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from './worker';
import { generateSlug, validateDpVersion, MIN_DP_VERSION } from './types';
import { createTestEnv } from './test-helpers';

// Mock the crypto module to avoid ED25519 key issues in tests
vi.mock('./crypto', () => ({
  signPlaylist: vi.fn().mockResolvedValue('ed25519:0x1234567890abcdef'),
  getServerKeyPair: vi.fn().mockResolvedValue({
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  }),
  createCanonicalForm: vi.fn((playlist: any) => JSON.stringify(playlist) + '\n'),
}));

// Mock the queue processor for route testing
vi.mock('./queue/processor', () => ({
  queueWriteOperation: vi.fn().mockResolvedValue(undefined),
  generateMessageId: vi.fn().mockReturnValue('test-message-id'),
  processWriteOperations: vi.fn().mockImplementation(async (messageBatch: any, env: any) => {
    // Return processedCount based on the number of messages in the batch
    return {
      success: true,
      processedCount: messageBatch.messages.length,
      errors: undefined,
    };
  }),
}));

import { queueWriteOperation, generateMessageId, processWriteOperations } from './queue/processor';
import { savePlaylist, listAllPlaylistItems } from './storage';

// Constants for test playlist IDs
const playlistId1 = '550e8400-e29b-41d4-a716-446655440000';

const testSetup = createTestEnv();
const testEnv = testSetup.env;
const mockStorages = testSetup.mockStorages;

const validPlaylist = {
  dpVersion: '1.0.0',
  title: 'Test Playlist',
  items: [
    {
      title: 'Test Artwork',
      source: 'https://example.com/artwork.html',
      duration: 300,
      license: 'open' as const,
    },
    {
      title: 'Test Artwork 2',
      source: 'https://example.com/artwork2.html',
      duration: 300,
      license: 'open' as const,
    },
  ],
};

describe('DP-1 Feed Operator API', () => {
  beforeEach(() => {
    // Clear storage through the mock storage instances
    mockStorages.playlist.storage.clear();
    mockStorages.item.storage.clear();

    // Clear mock calls
    vi.clearAllMocks();

    // Set up the mock queue write operation to actually process data synchronously
    vi.mocked(queueWriteOperation).mockImplementation(async (message: any, env: any) => {
      // Process the queue message immediately by calling real storage functions
      try {
        switch (message.operation) {
          case 'create_playlist':
            await savePlaylist(message.data.playlist, env, false);
            break;
          case 'update_playlist':
            await savePlaylist(message.data.playlist, env, true);
            break;
        }
      } catch (error) {
        console.error('Mock queue processing error:', error);
        throw error;
      }
    });
  });

  describe('Health and Info Endpoints', () => {
    it('GET /api/v1/health returns healthy status', async () => {
      const req = new Request('http://localhost/api/v1/health');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.version).toBe('1.0.0');
    });

    it('GET /api/v1 returns API information', async () => {
      const req = new Request('http://localhost/api/v1');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.name).toBe('DP-1 Feed Operator API');
      expect(data.version).toBe('1.0.0');
      expect(data.specification).toBe('DP-1 v1.0.0');
    });
  });

  describe('Slug Generation', () => {
    it('should generate valid slugs from titles', () => {
      const testCases = [
        { title: 'My Amazing Art Collection', expected: /^my-amazing-art-collection-\d{4}$/ },
        { title: 'Generative Art 2024!', expected: /^generative-art-2024-\d{4}$/ },
        { title: 'Test@#$%^&*()Playlist', expected: /^test-playlist-\d{4}$/ },
        { title: '   Leading/Trailing Spaces   ', expected: /^leading-trailing-spaces-\d{4}$/ },
      ];

      testCases.forEach(({ title, expected }) => {
        const slug = generateSlug(title);
        expect(slug).toMatch(expected);
        expect(slug.length).toBeLessThanOrEqual(64);
      });
    });

    it('should handle very long titles by truncating', () => {
      const longTitle = 'A'.repeat(100);
      const slug = generateSlug(longTitle);
      expect(slug.length).toBeLessThanOrEqual(64);
      expect(slug).toMatch(/^a+-\d{4}$/);
    });

    it('should generate unique slugs for identical titles', () => {
      const title = 'Identical Title';
      const slug1 = generateSlug(title);
      const slug2 = generateSlug(title);
      expect(slug1).not.toBe(slug2);
      expect(slug1).toMatch(/^identical-title-\d{4}$/);
      expect(slug2).toMatch(/^identical-title-\d{4}$/);
    });
  });

  describe('dpVersion Validation', () => {
    it(`should validate minimum version requirement (${MIN_DP_VERSION})`, () => {
      // Valid versions (>= MIN_DP_VERSION)
      const validVersions = ['1.0.0', '1.2.3', '2.0.0'];

      validVersions.forEach(version => {
        const result = validateDpVersion(version);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      // Invalid versions (< MIN_DP_VERSION)
      const invalidVersions = ['0.8.9', '0.9.0', '0.1.0'];

      invalidVersions.forEach(version => {
        const result = validateDpVersion(version);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain(`below minimum required version ${MIN_DP_VERSION}`);
      });
    });

    it('should validate semantic version format', () => {
      // Invalid semver formats (what semver library actually considers invalid)
      const invalidFormats = ['invalid', '1.0', '', 'not-a-version', '1.0.x', 'x.y.z'];

      invalidFormats.forEach(version => {
        const result = validateDpVersion(version);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Invalid semantic version format');
      });
    });

    it('should accept valid semantic versions', () => {
      // Test versions that pass both format and minimum version requirements
      const validVersions = ['1.0.0', '10.20.30', '1.2.3', '10000000.1000000.1000000'];

      validVersions.forEach(version => {
        const result = validateDpVersion(version);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });

  describe('Protected Fields Validation', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    it('should reject playlist updates with protected fields (PATCH)', async () => {
      const invalidUpdateData = {
        id: 'custom-id', // Protected field
        slug: 'custom-slug', // Protected field
        items: [
          {
            title: 'Test Artwork',
            source: 'https://example.com/artwork.html',
            duration: 300,
            license: 'open' as const,
          },
        ],
      };

      const req = new Request('http://localhost/api/v1/playlists/test-id', {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify(invalidUpdateData),
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('protected_fields');
      expect(data.message).toContain('id, slug');
    });

    it('should allow valid playlist updates without protected fields (PATCH)', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      expect(createResponse.status).toBe(201);
      const createdPlaylist = await createResponse.json();

      // Then update it with valid data
      const validUpdateData = {
        defaults: { license: 'token' as const },
        items: [
          {
            title: 'Updated Artwork',
            source: 'https://example.com/updated-artwork.html',
            duration: 400,
            license: 'subscription' as const,
          },
        ],
      };

      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify(validUpdateData),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(200);

      const updatedData = await updateResponse.json();
      expect(updatedData.id).toBe(createdPlaylist.id); // Should preserve ID
      expect(updatedData.slug).toBe(createdPlaylist.slug); // Should preserve slug
      expect(updatedData.dpVersion).toBe(createdPlaylist.dpVersion); // Should preserve dpVersion
      expect(updatedData.items[0].title).toBe('Updated Artwork');
    });
  });

  describe('Authentication', () => {
    it('should reject POST requests without Authorization header', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBe('unauthorized');
    });

    it('should reject POST requests with invalid Bearer token', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBe('unauthorized');
    });

    it('should allow GET requests without authentication', async () => {
      const req = new Request('http://localhost/api/v1/playlists');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(200);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in responses', async () => {
      const req = new Request('http://localhost/api/v1/health');
      const response = await app.fetch(req, testEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
    });

    it('should handle OPTIONS preflight requests', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'OPTIONS',
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(204);
    });
  });

  describe('UUID/Slug Validation', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    it('should accept valid UUIDs in playlist endpoints', async () => {
      const req = new Request(`http://localhost/api/v1/playlists/${playlistId1}`, {
        headers: validAuth,
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(404); // Not found is OK, means UUID was validated
    });

    it('should accept valid slugs in playlist endpoints', async () => {
      const req = new Request('http://localhost/api/v1/playlists/test-playlist-1234', {
        headers: validAuth,
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(404); // Not found is OK, means slug was validated
    });

    it('should reject invalid identifiers in playlist endpoints', async () => {
      const invalidIds = ['invalid_id_with_underscores', 'invalid@email.com'];

      for (const invalidId of invalidIds) {
        const req = new Request(`http://localhost/api/v1/playlists/${invalidId}`, {
          headers: validAuth,
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error).toBe('invalid_id');
      }
    });
  });

  describe('Playlists API', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    it('GET /playlists returns paginated result initially', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        headers: validAuth,
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.hasMore).toBeDefined();
      expect(data.items).toHaveLength(0);
    });

    it('GET /playlists/:id returns 404 for non-existent playlist', async () => {
      const nonExistentPlaylistId = '550e8400-e29b-41d4-a716-446655440003';
      const req = new Request(`http://localhost/api/v1/playlists/${nonExistentPlaylistId}`, {
        headers: validAuth,
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('not_found');
    });

    it('POST /playlists with empty data returns 400', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify({
          // Missing required fields
        }),
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('validation_error');
    });

    it('POST /playlists with invalid data returns 400', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: 'invalid json',
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('invalid_json');
    });

    it('POST /playlists should create playlist with server-generated ID and slug', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(data.dpVersion).toBe('1.0.0'); // Server should preserve client's dpVersion
      expect(data.slug).toMatch(/^test-playlist-\d{4}$/);
      expect(data.title).toBe('Test Playlist');
      expect(data.created).toBeTruthy();
      expect(data.signature).toBeTruthy();
      expect(data.items[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Verify queue operation was called
      expect(queueWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create_playlist',
          data: expect.objectContaining({
            playlist: expect.objectContaining({
              id: data.id,
              title: 'Test Playlist',
            }),
          }),
        }),
        testEnv
      );
    });

    it('PATCH /playlists/:id should update playlist and preserve protected fields', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      expect(createResponse.status).toBe(201);

      const createdPlaylist = await createResponse.json();
      const playlistId = createdPlaylist.id;

      // Then update it with new title (only send updateable fields)
      const updatedPlaylist = {
        dpVersion: '1.0.1',
        title: 'Updated Test Playlist',
        defaults: { license: 'token' as const },
      };

      const updateReq = new Request(`http://localhost/api/v1/playlists/${playlistId}`, {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify(updatedPlaylist),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(200);

      const data = await updateResponse.json();
      expect(data.id).toBe(playlistId); // ID should remain the same
      expect(data.dpVersion).toBe('1.0.1'); // Server should preserve client's dpVersion
      expect(data.slug).toBe(createdPlaylist.slug);
      expect(data.items.length).toBe(createdPlaylist.items.length);
      for (let i = 0; i < data.items.length; i++) {
        expect(data.items[i].id).toBe(createdPlaylist.items[i].id);
        expect(data.items[i].title).toBe(createdPlaylist.items[i].title);
        expect(data.items[i].source).toBe(createdPlaylist.items[i].source);
        expect(data.items[i].duration).toBe(createdPlaylist.items[i].duration);
        expect(data.items[i].license).toBe(createdPlaylist.items[i].license);
      }

      // Verify queue operation was called for update
      expect(queueWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'update_playlist',
          data: expect.objectContaining({
            playlistId: playlistId,
            playlist: expect.objectContaining({
              id: playlistId,
              title: 'Updated Test Playlist',
            }),
          }),
        }),
        testEnv
      );
    });

    it('PUT /playlists/:id should update playlist and preserve protected fields', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      expect(createResponse.status).toBe(201);

      const createdPlaylist = await createResponse.json();
      const playlistId = createdPlaylist.id;

      // Then update it with new title (only send updateable fields)
      const updatedPlaylist = {
        dpVersion: '1.0.1',
        title: 'Updated Test Playlist',
        defaults: { license: 'token' as const },
        items: [
          {
            title: 'Updated Artwork Title',
            source: 'https://example.com/updated-artwork.html',
            duration: 400,
            license: 'subscription' as const,
          },
        ],
      };

      const updateReq = new Request(`http://localhost/api/v1/playlists/${playlistId}`, {
        method: 'PUT',
        headers: validAuth,
        body: JSON.stringify(updatedPlaylist),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(200);

      const data = await updateResponse.json();
      expect(data.id).toBe(playlistId); // ID should remain the same
      expect(data.dpVersion).toBe('1.0.1'); // Server should preserve client's dpVersion
      expect(data.slug).toBe(createdPlaylist.slug);
      expect(data.items[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Verify queue operation was called for update
      expect(queueWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'update_playlist',
          data: expect.objectContaining({
            playlistId: playlistId,
            playlist: expect.objectContaining({
              id: playlistId,
              title: 'Updated Test Playlist',
            }),
          }),
        }),
        testEnv
      );
    });

    it('PUT /playlists/:id with empty data returns 400', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      // Try update with empty data (invalid for PUT)
      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PUT',
        headers: validAuth,
        body: JSON.stringify({}),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('validation_error');
    });

    it('PATCH /playlists/:id with empty data should be a no-op and return 200', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      // No-op PATCH
      const patchReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify({}),
      });
      const patchResponse = await app.fetch(patchReq, testEnv);
      expect(patchResponse.status).toBe(200);

      const updated = await patchResponse.json();
      expect(updated.id).toBe(createdPlaylist.id);
      expect(updated.slug).toBe(createdPlaylist.slug);
      expect(updated.title).toBe(createdPlaylist.title);
      expect(updated.items.length).toBe(createdPlaylist.items.length);
      expect(updated.items[0].id).toBe(createdPlaylist.items[0].id);
    });

    it('PUT /playlists/:id with invalid data returns 400', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      // Try to update with invalid JSON
      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PUT',
        headers: validAuth,
        body: 'invalid json',
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('invalid_json');
    });

    it('PATCH /playlists/:id with invalid data returns 400', async () => {
      // First create a playlist
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      // Try to update with invalid JSON
      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PATCH',
        headers: validAuth,
        body: 'invalid json',
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('invalid_json');
    });

    it('PUT /playlists/:id with invalid playlist ID returns 400', async () => {
      const updateReq = new Request('http://localhost/api/v1/playlists/invalid@playlist!id', {
        method: 'PUT',
        headers: validAuth,
        body: JSON.stringify({
          items: [
            {
              title: 'Test Artwork',
              source: 'https://example.com/artwork.html',
              duration: 300,
              license: 'open' as const,
            },
          ],
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('invalid_id');
      expect(data.message).toBe(
        'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)'
      );
    });

    it('PATCH /playlists/:id with invalid playlist ID returns 400', async () => {
      const updateReq = new Request('http://localhost/api/v1/playlists/invalid@playlist!id', {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify({
          items: [
            {
              title: 'Test Artwork',
              source: 'https://example.com/artwork.html',
              duration: 300,
              license: 'open' as const,
            },
          ],
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('invalid_id');
      expect(data.message).toBe(
        'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)'
      );
    });

    it('PUT /playlists/:id with non-existent playlist ID returns 400', async () => {
      const updateReq = new Request('http://localhost/api/v1/playlists/test-playlist-abcwer', {
        method: 'PUT',
        headers: validAuth,
        body: JSON.stringify({
          dpVersion: '1.0.0',
          title: 'Test Playlist',
          items: [
            {
              title: 'Test Artwork',
              source: 'https://example.com/artwork.html',
              duration: 300,
              license: 'open' as const,
            },
          ],
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(404);

      const data = await updateResponse.json();
      expect(data.error).toBe('not_found');
      expect(data.message).toBe('Playlist not found');
    });

    it('PATCH /playlists/:id with non-existent playlist ID returns 400', async () => {
      const updateReq = new Request('http://localhost/api/v1/playlists/test-playlist-abcwer', {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify({
          dpVersion: '1.0.0',
          title: 'Test Playlist',
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(404);

      const data = await updateResponse.json();
      expect(data.error).toBe('not_found');
      expect(data.message).toBe('Playlist not found');
    });

    it('PATCH /playlists/:id with invalid dpVersion returns 400', async () => {
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PATCH',
        headers: validAuth,
        body: JSON.stringify({
          dpVersion: 'invalid',
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('validation_error');
      expect(data.message).toBe(
        'Invalid playlist update data: dpVersion: Invalid semantic version format: invalid'
      );
    });

    it('PUT /playlists/:id with invalid dpVersion returns 400', async () => {
      const createReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const createResponse = await app.fetch(createReq, testEnv);
      const createdPlaylist = await createResponse.json();

      const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
        method: 'PUT',
        headers: validAuth,
        body: JSON.stringify({
          dpVersion: 'invalid',
          title: 'Updated Playlist',
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated.html',
              duration: 400,
              license: 'subscription' as const,
            },
          ],
        }),
      });
      const updateResponse = await app.fetch(updateReq, testEnv);
      expect(updateResponse.status).toBe(400);

      const data = await updateResponse.json();
      expect(data.error).toBe('validation_error');
      expect(data.message).toBe(
        'Invalid playlist data: dpVersion: Invalid semantic version format: invalid'
      );
    });

    it('GET /playlists with limit below minimum returns 400', async () => {
      const req = new Request('http://localhost/api/v1/playlists?limit=0');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('invalid_limit');
      expect(data.message).toBe('Limit must be between 1 and 100');
    });

    it('GET /playlists with limit above maximum returns 400', async () => {
      const req = new Request('http://localhost/api/v1/playlists?limit=101');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('invalid_limit');
      expect(data.message).toBe('Limit must be between 1 and 100');
    });

    describe('Queue Error Handling', () => {
      it('should handle queue errors gracefully for playlist creation', async () => {
        // Mock queueWriteOperation to fail
        vi.mocked(queueWriteOperation).mockRejectedValueOnce(new Error('Queue failure'));

        const req = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const data = await response.json();
        expect(data.error).toBe('queue_error');
        expect(data.message).toBe('Failed to queue playlist for processing');
      });

      it('should handle queue errors gracefully for playlist updates (PATCH)', async () => {
        // First create a playlist
        const createReq = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const createResponse = await app.fetch(createReq, testEnv);
        const createdPlaylist = await createResponse.json();

        // Mock queueWriteOperation to fail for the update
        vi.mocked(queueWriteOperation).mockRejectedValueOnce(new Error('Queue failure'));

        const updateData = {
          title: 'Updated Playlist',
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated.html',
              duration: 400,
              license: 'subscription' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
          method: 'PATCH',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(500);

        const data = await updateResponse.json();
        expect(data.error).toBe('queue_error');
        expect(data.message).toBe('Failed to queue playlist for processing');
      });

      it('should handle queue errors gracefully for playlist updates (PUT)', async () => {
        // First create a playlist
        const createReq = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const createResponse = await app.fetch(createReq, testEnv);
        const createdPlaylist = await createResponse.json();

        // Mock queueWriteOperation to fail for the update
        vi.mocked(queueWriteOperation).mockRejectedValueOnce(new Error('Queue failure'));

        const updateData = {
          dpVersion: '1.0.1',
          title: 'Updated Playlist',
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated.html',
              duration: 400,
              license: 'subscription' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
          method: 'PUT',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(500);

        const data = await updateResponse.json();
        expect(data.error).toBe('queue_error');
        expect(data.message).toBe('Failed to queue playlist for processing');
      });
    });

    describe('Unexpected Errors', () => {
      it('should return internal_error for unexpected failure during playlist update (PATCH)', async () => {
        // Create a playlist first
        const createReq = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const createResponse = await app.fetch(createReq, testEnv);
        const createdPlaylist = await createResponse.json();

        // Simulate unexpected error (e.g., ID generation)
        vi.mocked(generateMessageId).mockImplementationOnce(() => {
          throw new Error('Unexpected failure');
        });

        const updateData = {
          title: 'Updated Playlist',
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated.html',
              duration: 400,
              license: 'subscription' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
          method: 'PATCH',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(500);

        const data = await updateResponse.json();
        expect(data.error).toBe('internal_error');
        expect(data.message).toBe('Failed to update playlist');
      });

      it('should return internal_error for unexpected failure during playlist update (PUT)', async () => {
        // Create a playlist first
        const createReq = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const createResponse = await app.fetch(createReq, testEnv);
        const createdPlaylist = await createResponse.json();

        // Simulate unexpected error (e.g., ID generation)
        vi.mocked(generateMessageId).mockImplementationOnce(() => {
          throw new Error('Unexpected failure');
        });

        const updateData = {
          dpVersion: '1.0.1',
          title: 'Updated Playlist',
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated.html',
              duration: 400,
              license: 'subscription' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
          method: 'PUT',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(500);

        const data = await updateResponse.json();
        expect(data.error).toBe('internal_error');
        expect(data.message).toBe('Failed to update playlist');
      });
    });

    describe('Queue Message Structure', () => {
      it('should generate proper queue messages for playlist creation', async () => {
        const req = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        await app.fetch(req, testEnv);

        expect(queueWriteOperation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.any(String),
            timestamp: expect.any(String),
            operation: 'create_playlist',
            data: expect.objectContaining({
              playlist: expect.objectContaining({
                dpVersion: '1.0.0',
                id: expect.any(String),
                slug: expect.any(String),
                title: 'Test Playlist',
                created: expect.any(String),
                signature: expect.any(String),
                items: expect.arrayContaining([
                  expect.objectContaining({
                    id: expect.any(String),
                    title: 'Test Artwork',
                    source: 'https://example.com/artwork.html',
                    duration: 300,
                    license: 'open',
                  }),
                ]),
              }),
            }),
          }),
          testEnv
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const req = new Request('http://localhost/api/v1/unknown-route');
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('not_found');
    });

    it('should reject non-JSON content type for POST requests', async () => {
      const req = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-secret-key',
          'Content-Type': 'text/plain',
        },
        body: 'not json',
      });
      const response = await app.fetch(req, testEnv);
      expect(response.status).toBe(500);
    });
  });

  describe('Enhanced Functionality', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    describe('Pagination', () => {
      it('should paginate playlists with limit and cursor', async () => {
        // Create multiple playlists first
        for (let i = 0; i < 5; i++) {
          const playlist = {
            ...validPlaylist,
            items: [
              {
                ...validPlaylist.items[0],
                title: `Test Artwork ${i}`,
              },
            ],
          };

          const req = new Request('http://localhost/api/v1/playlists', {
            method: 'POST',
            headers: validAuth,
            body: JSON.stringify(playlist),
          });
          await app.fetch(req, testEnv);
        }

        // Test pagination
        const req1 = new Request('http://localhost/api/v1/playlists?limit=3');
        const response1 = await app.fetch(req1, testEnv);
        expect(response1.status).toBe(200);

        const data1 = await response1.json();
        expect(data1.items).toHaveLength(3);
        expect(data1.hasMore).toBe(true);
        expect(data1.cursor).toBeDefined();

        // Test next page
        const req2 = new Request(
          `http://localhost/api/v1/playlists?limit=3&cursor=${encodeURIComponent(data1.cursor)}`
        );
        const response2 = await app.fetch(req2, testEnv);
        expect(response2.status).toBe(200);

        const data2 = await response2.json();
        expect(data2.items).toHaveLength(2);
        expect(data2.hasMore).toBe(false);
        expect(data2.cursor).toBeUndefined();
      });
    });

    describe('Slug-based Access', () => {
      it('should retrieve playlist by slug', async () => {
        // Create a playlist
        const req = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const response = await app.fetch(req, testEnv);
        const playlist = await response.json();

        // Retrieve by slug
        const getReq = new Request(`http://localhost/api/v1/playlists/${playlist.slug}`);
        const getResponse = await app.fetch(getReq, testEnv);
        expect(getResponse.status).toBe(200);

        const retrieved = await getResponse.json();
        expect(retrieved.id).toBe(playlist.id);
        expect(retrieved.slug).toBe(playlist.slug);
      });

      it('should update playlist by slug (PATCH)', async () => {
        // Create a playlist
        const req = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(validPlaylist),
        });
        const response = await app.fetch(req, testEnv);
        const playlist = await response.json();

        // Update by slug
        const updateData = {
          items: [
            {
              title: 'Updated by Slug',
              source: 'https://example.com/updated.html',
              duration: 500,
              license: 'open' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${playlist.slug}`, {
          method: 'PATCH',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(200);

        const updated = await updateResponse.json();
        expect(updated.items[0].title).toBe('Updated by Slug');
      });
    });

    describe('Sorting via API', () => {
      it('GET /playlists supports sort=asc|desc', async () => {
        // Create several playlists
        const p1 = { ...validPlaylist, title: 'P1' };
        const p2 = { ...validPlaylist, title: 'P2' };
        const p3 = { ...validPlaylist, title: 'P3' };
        await app.fetch(
          new Request('http://localhost/api/v1/playlists', {
            method: 'POST',
            headers: validAuth,
            body: JSON.stringify(p1),
          }),
          testEnv
        );
        await app.fetch(
          new Request('http://localhost/api/v1/playlists', {
            method: 'POST',
            headers: validAuth,
            body: JSON.stringify(p2),
          }),
          testEnv
        );
        await app.fetch(
          new Request('http://localhost/api/v1/playlists', {
            method: 'POST',
            headers: validAuth,
            body: JSON.stringify(p3),
          }),
          testEnv
        );

        const ascRes = await app.fetch(
          new Request('http://localhost/api/v1/playlists?sort=asc&limit=5'),
          testEnv
        );
        expect(ascRes.status).toBe(200);
        const asc = await ascRes.json();
        expect(Array.isArray(asc.items)).toBe(true);
        // Ascending order should have non-decreasing created timestamps
        for (let i = 1; i < asc.items.length; i++) {
          expect(Date.parse(asc.items[i - 1].created) <= Date.parse(asc.items[i].created)).toBe(
            true
          );
        }

        const descRes = await app.fetch(
          new Request('http://localhost/api/v1/playlists?sort=desc&limit=5'),
          testEnv
        );
        expect(descRes.status).toBe(200);
        const desc = await descRes.json();
        // Descending order should have non-increasing created timestamps
        for (let i = 1; i < desc.items.length; i++) {
          expect(Date.parse(desc.items[i - 1].created) >= Date.parse(desc.items[i].created)).toBe(
            true
          );
        }

        // The two lists should be reverse-ordered sequences with the same set if using same limit
        const ascCreated = asc.items.map((p: any) => p.created).join('|');
        const descCreated = desc.items
          .map((p: any) => p.created)
          .reverse()
          .join('|');
        expect(ascCreated).toBe(descCreated);
      });
    });
  });

  describe('Playlist Items API', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    let createdPlaylist: any;

    beforeEach(async () => {
      // Create a playlist first
      const playlistReq = new Request('http://localhost/api/v1/playlists', {
        method: 'POST',
        headers: validAuth,
        body: JSON.stringify(validPlaylist),
      });
      const playlistResponse = await app.fetch(playlistReq, testEnv);
      createdPlaylist = await playlistResponse.json();

      // Mock fetch for playlist validation to return the created playlist
      global.fetch = vi.fn((url: string) => {
        if (url.includes(createdPlaylist.id)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(createdPlaylist),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }) as any;
    });

    describe('GET /playlist-items', () => {
      it('should list all playlist items with default limit', async () => {
        const req = new Request('http://localhost/api/v1/playlist-items');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result).toHaveProperty('items');
        expect(result.cursor).toBeUndefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toEqual(2);
      });

      it('should list playlist items with specific limit', async () => {
        const limit = 1;
        const req = new Request(`http://localhost/api/v1/playlist-items?limit=${limit}`);
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('cursor');
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeLessThanOrEqual(limit);
      });

      it('should return 500 for internal error', async () => {
        // Create a spy on the listAllPlaylistItems function to mock it for this test
        const listAllPlaylistItemsSpy = vi
          .spyOn(await import('./storage'), 'listAllPlaylistItems')
          .mockRejectedValueOnce(new Error('Internal error'));

        const req = new Request('http://localhost/api/v1/playlist-items');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const data = await response.json();
        expect(data.error).toBe('internal_error');
        expect(data.message).toBe('Failed to retrieve playlist items');

        // Restore the original function
        listAllPlaylistItemsSpy.mockRestore();
      });

      it('should return 400 for limit too low', async () => {
        const req = new Request('http://localhost/api/v1/playlist-items?limit=0');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error).toBe('invalid_limit');
        expect(data.message).toBe('Limit must be between 1 and 100');
      });

      it('should return 400 for limit too high', async () => {
        const req = new Request('http://localhost/api/v1/playlist-items?limit=101');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error).toBe('invalid_limit');
        expect(data.message).toBe('Limit must be between 1 and 100');
      });

      it('should support sorting in ascending order', async () => {
        const req = new Request('http://localhost/api/v1/playlist-items?sort=asc&limit=10');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result).toHaveProperty('items');
        expect(Array.isArray(result.items)).toBe(true);

        // Verify ascending sort order (by created time)
        if (result.items.length > 1) {
          const firstItem = result.items[0];
          const secondItem = result.items[1];
          // In ascending order, first item should have earlier or equal created time
          expect(new Date(firstItem.created).getTime()).toBeLessThanOrEqual(
            new Date(secondItem.created).getTime()
          );
        }
      });

      it('should support sorting in descending order', async () => {
        const req = new Request('http://localhost/api/v1/playlist-items?sort=desc&limit=10');
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result).toHaveProperty('items');
        expect(Array.isArray(result.items)).toBe(true);

        // Verify descending sort order (by created time)
        if (result.items.length > 1) {
          const firstItem = result.items[0];
          const secondItem = result.items[1];
          // In descending order, first item should have later or equal created time
          expect(new Date(firstItem.created).getTime()).toBeGreaterThanOrEqual(
            new Date(secondItem.created).getTime()
          );
        }
      });
    });

    describe('GET /playlist-items/:id', () => {
      it('should get playlist item by ID', async () => {
        const playlistItemId = createdPlaylist.items[0].id;

        const req = new Request(`http://localhost/api/v1/playlist-items/${playlistItemId}`);
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const playlistItem = await response.json();
        expect(playlistItem.id).toBe(playlistItemId);
        expect(playlistItem.title).toBe('Test Artwork');
        expect(playlistItem.source).toBe('https://example.com/artwork.html');
        expect(playlistItem.duration).toBe(300);
        expect(playlistItem.license).toBe('open');
      });

      it('should return 404 for non-existent playlist item', async () => {
        const req = new Request(
          `http://localhost/api/v1/playlist-items/550e8400-e29b-41d4-a716-446655440999`
        );
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(404);

        const data = await response.json();
        expect(data.error).toBe('not_found');
        expect(data.message).toBe('Playlist item not found');
      });

      it('should return 400 for invalid playlist item ID format', async () => {
        const req = new Request(`http://localhost/api/v1/playlist-items/invalid-id`);
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error).toBe('invalid_id');
        expect(data.message).toBe('Playlist item ID must be a valid UUID');
      });

      it('should return 500 for internal error', async () => {
        const getPlaylistItemByIdSpy = vi
          .spyOn(await import('./storage'), 'getPlaylistItemById')
          .mockRejectedValueOnce(new Error('Internal error'));

        const req = new Request(
          `http://localhost/api/v1/playlist-items/550e8400-e29b-41d4-a716-446655440999`
        );
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const data = await response.json();
        expect(data.error).toBe('internal_error');
        expect(data.message).toBe('Failed to retrieve playlist item');

        // Restore the original function
        getPlaylistItemByIdSpy.mockRestore();
      });
    });

    describe('Playlist Item Updates (via Playlist Updates)', () => {
      it('should update playlist items when updating playlist', async () => {
        const originalItemId = createdPlaylist.items[0].id;

        // Update the playlist with new items (should erase old playlist items and create new ones)
        const updateData = {
          items: [
            {
              title: 'Updated Artwork',
              source: 'https://example.com/updated-artwork.html',
              duration: 600,
              license: 'token' as const,
            },
          ],
        };

        const updateReq = new Request(`http://localhost/api/v1/playlists/${createdPlaylist.id}`, {
          method: 'PATCH',
          headers: validAuth,
          body: JSON.stringify(updateData),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(200);

        const updatedPlaylist = await updateResponse.json();
        const newItemId = updatedPlaylist.items[0].id;

        // The new item should have a different ID
        expect(newItemId).not.toBe(originalItemId);

        // The old playlist item should no longer be accessible
        const oldItemReq = new Request(`http://localhost/api/v1/playlist-items/${originalItemId}`);
        const oldItemResponse = await app.fetch(oldItemReq, testEnv);
        expect(oldItemResponse.status).toBe(404);

        // The new playlist item should be accessible
        const newItemReq = new Request(`http://localhost/api/v1/playlist-items/${newItemId}`);
        const newItemResponse = await app.fetch(newItemReq, testEnv);
        expect(newItemResponse.status).toBe(200);

        const newItem = await newItemResponse.json();
        expect(newItem.title).toBe('Updated Artwork');
        expect(newItem.license).toBe('token');
      });

      it('should not allow passing playlist item IDs in playlist input', async () => {
        // Try to create a playlist with playlist item IDs (should be ignored/stripped)
        const playlistWithItemIds = {
          dpVersion: '1.0.0',
          title: 'Test Playlist with Item IDs',
          items: [
            {
              id: '550e8400-e29b-41d4-a716-446655440123', // This should be ignored
              title: 'Test Artwork',
              source: 'https://example.com/artwork.html',
              duration: 300,
              license: 'open' as const,
            },
          ],
        };

        const req = new Request('http://localhost/api/v1/playlists', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(playlistWithItemIds),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(201);

        const playlist = await response.json();
        // The playlist item should have a server-generated ID, not the one we provided
        expect(playlist.items[0].id).not.toBe('550e8400-e29b-41d4-a716-446655440123');
        expect(playlist.items[0].id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      });
    });
  });

  describe('Queue Processing API', () => {
    const validAuth = {
      Authorization: 'Bearer test-secret-key',
      'Content-Type': 'application/json',
    };

    // Helper function to create a valid write operation message
    const createValidMessage = (operation: string, data: any) => ({
      id: 'test-message-id',
      timestamp: new Date().toISOString(),
      operation,
      data,
    });

    describe('POST /queues/process-message', () => {
      it('should process a valid create_playlist message', async () => {
        const message = createValidMessage('create_playlist', {
          playlist: {
            dpVersion: '1.0.0',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Test Playlist',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [
              {
                id: '550e8400-e29b-41d4-a716-446655440001',
                title: 'Test Artwork',
                source: 'https://example.com/artwork.html',
                duration: 300,
                license: 'open',
                created: '2024-01-01T00:00:00.001Z',
              },
            ],
          },
        });

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(message),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('test-message-id');
        expect(result.operation).toBe('create_playlist');
        expect(result.processedCount).toBe(1);
        expect(result.errors).toBeUndefined();
      });

      it('should process a valid update_playlist message', async () => {
        const message = createValidMessage('update_playlist', {
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          playlist: {
            dpVersion: '1.0.1',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Updated Test Playlist',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [
              {
                id: '550e8400-e29b-41d4-a716-446655440001',
                title: 'Updated Artwork',
                source: 'https://example.com/updated-artwork.html',
                duration: 400,
                license: 'token',
                created: '2024-01-01T00:00:00.001Z',
              },
            ],
          },
        });

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(message),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('test-message-id');
        expect(result.operation).toBe('update_playlist');
        expect(result.processedCount).toBe(1);
        expect(result.errors).toBeUndefined();
      });

      it('should return 400 for message missing operation field', async () => {
        const invalidMessage = {
          id: 'test-message-id',
          timestamp: new Date().toISOString(),
          // Missing operation field
          data: { playlist: {} },
        };

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(invalidMessage),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe('Message must contain operation, id, and timestamp fields');
      });

      it('should return 400 for message missing id field', async () => {
        const invalidMessage = {
          // Missing id field
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: {} },
        };

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(invalidMessage),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe('Message must contain operation, id, and timestamp fields');
      });

      it('should return 400 for message missing timestamp field', async () => {
        const invalidMessage = {
          id: 'test-message-id',
          // Missing timestamp field
          operation: 'create_playlist',
          data: { playlist: {} },
        };

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(invalidMessage),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe('Message must contain operation, id, and timestamp fields');
      });

      it('should return 400 for invalid JSON', async () => {
        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: 'invalid json',
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const result = await response.json();
        expect(result.error).toBe('processing_failed');
        expect(result.message).toBe('Failed to process the message');
      });

      it('should handle processing errors gracefully', async () => {
        // Mock processWriteOperations to throw an error
        vi.mocked(processWriteOperations).mockRejectedValueOnce(new Error('Processing failed'));

        const message = createValidMessage('create_playlist', {
          playlist: {
            dpVersion: '1.0.0',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Test Playlist',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [],
          },
        });

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(message),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const result = await response.json();
        expect(result.error).toBe('processing_failed');
        expect(result.message).toBe('Failed to process the message');
        expect(result.details).toBe('Processing failed');
      });

      it('should handle retry count in message', async () => {
        const message = {
          ...createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
          retryCount: 3,
        };

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(message),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(1);
      });
    });

    describe('POST /queues/process-batch', () => {
      it('should process a valid batch of messages', async () => {
        const messages = [
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist 1',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440001',
              slug: 'test-playlist-5678',
              title: 'Test Playlist 2',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
        expect(result.messageIds).toEqual(['test-message-id', 'test-message-id']);
        expect(result.errors).toBeUndefined();
      });

      it('should return 400 for empty messages array', async () => {
        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages: [] }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_batch');
        expect(result.message).toBe('Request must contain a non-empty array of messages');
      });

      it('should return 400 for non-array messages', async () => {
        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages: 'not an array' }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_batch');
        expect(result.message).toBe('Request must contain a non-empty array of messages');
      });

      it('should return 400 for batch with invalid message (missing operation)', async () => {
        const messages = [
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
          {
            id: 'test-message-id-2',
            timestamp: new Date().toISOString(),
            // Missing operation field
            data: { playlist: {} },
          },
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe(
          'All messages must contain operation, id, and timestamp fields'
        );
      });

      it('should return 400 for batch with invalid message (missing id)', async () => {
        const messages = [
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
          {
            // Missing id field
            timestamp: new Date().toISOString(),
            operation: 'create_playlist',
            data: { playlist: {} },
          },
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe(
          'All messages must contain operation, id, and timestamp fields'
        );
      });

      it('should return 400 for batch with invalid message (missing timestamp)', async () => {
        const messages = [
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
          {
            id: 'test-message-id-2',
            // Missing timestamp field
            operation: 'create_playlist',
            data: { playlist: {} },
          },
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(400);

        const result = await response.json();
        expect(result.error).toBe('invalid_message');
        expect(result.message).toBe(
          'All messages must contain operation, id, and timestamp fields'
        );
      });

      it('should return 400 for invalid JSON', async () => {
        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: 'invalid json',
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const result = await response.json();
        expect(result.error).toBe('batch_processing_failed');
        expect(result.message).toBe('Failed to process the message batch');
      });

      it('should handle batch processing errors gracefully', async () => {
        // Mock processWriteOperations to throw an error
        vi.mocked(processWriteOperations).mockRejectedValueOnce(
          new Error('Batch processing failed')
        );

        const messages = [
          createValidMessage('create_playlist', {
            playlist: {
              dpVersion: '1.0.0',
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: 'test-playlist-1234',
              title: 'Test Playlist',
              created: '2024-01-01T00:00:00Z',
              signature: 'ed25519:0x1234567890abcdef',
              items: [],
            },
          }),
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(500);

        const result = await response.json();
        expect(result.error).toBe('batch_processing_failed');
        expect(result.message).toBe('Failed to process the message batch');
        expect(result.details).toBe('Batch processing failed');
      });

      it('should handle retry counts in batch messages', async () => {
        const messages = [
          {
            ...createValidMessage('create_playlist', {
              playlist: {
                dpVersion: '1.0.0',
                id: '550e8400-e29b-41d4-a716-446655440000',
                slug: 'test-playlist-1234',
                title: 'Test Playlist 1',
                created: '2024-01-01T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [],
              },
            }),
            retryCount: 1,
          },
          {
            ...createValidMessage('create_playlist', {
              playlist: {
                dpVersion: '1.0.0',
                id: '550e8400-e29b-41d4-a716-446655440001',
                slug: 'test-playlist-5678',
                title: 'Test Playlist 2',
                created: '2024-01-01T00:00:00Z',
                signature: 'ed25519:0x1234567890abcdef',
                items: [],
              },
            }),
            retryCount: 2,
          },
        ];

        const req = new Request('http://localhost/queues/process-batch', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify({ messages }),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
        expect(result.messageIds).toEqual(['test-message-id', 'test-message-id']);
      });
    });

    describe('Queue Processing Integration', () => {
      it('should actually store data when processing create_playlist message', async () => {
        // Temporarily override the mock to actually process the data
        vi.mocked(processWriteOperations).mockImplementationOnce(
          async (messageBatch: any, env: any) => {
            const { savePlaylist } = await import('./storage');
            for (const message of messageBatch.messages) {
              const body = message.body;
              if (body.operation === 'create_playlist') {
                await savePlaylist(body.data.playlist, env, false);
              }
            }
            return {
              success: true,
              processedCount: messageBatch.messages.length,
              errors: undefined,
            };
          }
        );

        const message = createValidMessage('create_playlist', {
          playlist: {
            dpVersion: '1.0.0',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Test Playlist',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [
              {
                id: '550e8400-e29b-41d4-a716-446655440001',
                title: 'Test Artwork',
                source: 'https://example.com/artwork.html',
                duration: 300,
                license: 'open',
                created: '2024-01-01T00:00:00.001Z',
              },
            ],
          },
        });

        const req = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(message),
        });
        const response = await app.fetch(req, testEnv);
        expect(response.status).toBe(200);

        // Verify the playlist was actually stored
        const getReq = new Request(
          'http://localhost/api/v1/playlists/550e8400-e29b-41d4-a716-446655440000'
        );
        const getResponse = await app.fetch(getReq, testEnv);
        expect(getResponse.status).toBe(200);

        const playlist = await getResponse.json();
        expect(playlist.id).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(playlist.title).toBe('Test Playlist');
        expect(playlist.items).toHaveLength(1);
        expect(playlist.items[0].title).toBe('Test Artwork');
      });

      it('should actually update data when processing update_playlist message', async () => {
        // Temporarily override the mock to actually process the data
        vi.mocked(processWriteOperations).mockImplementation(
          async (messageBatch: any, env: any) => {
            const { savePlaylist } = await import('./storage');
            for (const message of messageBatch.messages) {
              const body = message.body;
              if (body.operation === 'create_playlist') {
                await savePlaylist(body.data.playlist, env, false);
              } else if (body.operation === 'update_playlist') {
                await savePlaylist(body.data.playlist, env, true);
              }
            }
            return {
              success: true,
              processedCount: messageBatch.messages.length,
              errors: undefined,
            };
          }
        );

        // First create a playlist via queue
        const createMessage = createValidMessage('create_playlist', {
          playlist: {
            dpVersion: '1.0.0',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Original Title',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [],
          },
        });

        await app.fetch(
          new Request('http://localhost/queues/process-message', {
            method: 'POST',
            headers: validAuth,
            body: JSON.stringify(createMessage),
          }),
          testEnv
        );

        // Then update it via queue
        const updateMessage = createValidMessage('update_playlist', {
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          playlist: {
            dpVersion: '1.0.1',
            id: '550e8400-e29b-41d4-a716-446655440000',
            slug: 'test-playlist-1234',
            title: 'Updated Title',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [],
          },
        });

        const updateReq = new Request('http://localhost/queues/process-message', {
          method: 'POST',
          headers: validAuth,
          body: JSON.stringify(updateMessage),
        });
        const updateResponse = await app.fetch(updateReq, testEnv);
        expect(updateResponse.status).toBe(200);

        // Verify the playlist was actually updated
        const getReq = new Request(
          'http://localhost/api/v1/playlists/550e8400-e29b-41d4-a716-446655440000'
        );
        const getResponse = await app.fetch(getReq, testEnv);
        expect(getResponse.status).toBe(200);

        const playlist = await getResponse.json();
        expect(playlist.title).toBe('Updated Title');
        expect(playlist.dpVersion).toBe('1.0.1');
      });
    });
  });
});
