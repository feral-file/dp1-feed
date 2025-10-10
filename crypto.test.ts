import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanonicalForm, getServerKeyPair } from './crypto';
import type { Playlist, Env } from './types';

describe('Crypto Functions', () => {
  describe('createCanonicalForm', () => {
    const basePlaylist: Omit<Playlist, 'signature'> = {
      dpVersion: '1.0.0',
      id: '385f79b6-a45f-4c1c-8080-e93a192adccc',
      slug: 'test-playlist',
      title: 'Test Playlist',
      created: '2025-06-03T17:01:00Z',
      items: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Test Artwork',
          source: 'https://example.com/artwork.html',
          duration: 300,
          license: 'open' as const,
          created: '2025-06-03T17:01:00.001Z',
        },
      ],
    };

    it('should produce deterministic output', () => {
      const canonical1 = createCanonicalForm(basePlaylist);
      const canonical2 = createCanonicalForm(basePlaylist);

      expect(canonical1).toBe(canonical2);
    });

    it('should produce the same output regardless of property order', () => {
      const playlist1: Omit<Playlist, 'signature'> = {
        dpVersion: basePlaylist.dpVersion,
        id: basePlaylist.id,
        slug: basePlaylist.slug,
        title: basePlaylist.title,
        created: basePlaylist.created,
        items: basePlaylist.items,
      };

      const playlist2: Omit<Playlist, 'signature'> = {
        items: basePlaylist.items,
        created: basePlaylist.created,
        id: basePlaylist.id,
        slug: basePlaylist.slug,
        title: basePlaylist.title,
        dpVersion: basePlaylist.dpVersion,
      };

      const canonical1 = createCanonicalForm(playlist1);
      const canonical2 = createCanonicalForm(playlist2);

      expect(canonical1).toBe(canonical2);
    });

    it('should always end with LF terminator', () => {
      const canonical = createCanonicalForm(basePlaylist);

      expect(canonical).toMatch(/\n$/);
      expect(canonical.endsWith('\n')).toBe(true);
    });

    it('should add LF terminator when not present', () => {
      const canonical = createCanonicalForm(basePlaylist);

      // The canonical form should end with exactly one LF
      expect(canonical.endsWith('\n')).toBe(true);
      expect(canonical.endsWith('\n\n')).toBe(false);
    });

    it('should not duplicate LF terminator if already present', () => {
      // Test that the function doesn't add duplicate LF characters
      // This tests the logic in createCanonicalForm that checks if LF is already present
      const canonical = createCanonicalForm(basePlaylist);

      // Should end with exactly one newline, not multiple
      expect(canonical.match(/\n+$/)?.[0]).toBe('\n');
    });

    it('should produce valid JSON that can be parsed', () => {
      const canonical = createCanonicalForm(basePlaylist);

      // Remove the LF terminator for JSON parsing
      const jsonContent = canonical.replace(/\n$/, '');

      // Should be valid JSON
      expect(() => JSON.parse(jsonContent)).not.toThrow();

      // Should contain all expected data
      const parsed = JSON.parse(jsonContent);
      expect(parsed.dpVersion).toBe(basePlaylist.dpVersion);
      expect(parsed.id).toBe(basePlaylist.id);
      expect(parsed.title).toBe(basePlaylist.title);
      expect(parsed.items).toHaveLength(1);
    });

    it('should handle complex playlist structures', () => {
      const complexPlaylist: Omit<Playlist, 'signature'> = {
        dpVersion: '1.0.0',
        id: 'test-id',
        slug: 'complex-test',
        title: 'Complex Test',
        created: '2025-01-01T00:00:00Z',
        defaults: {
          duration: 300,
          license: 'open' as const,
          display: {
            scaling: 'fit' as const,
            background: '#000000',
            margin: '5%',
          },
        },
        items: [
          {
            id: 'item-1',
            title: 'First Item',
            source: 'https://example.com/1',
            duration: 200,
            license: 'token' as const,
            created: '2025-06-03T17:01:00.001Z',
            display: {
              scaling: 'fill' as const,
              margin: 10,
            },
            repro: {
              engineVersion: { chromium: '123.0.6312.58' },
              seed: '0x123456789abcdef',
              assetsSHA256: ['hash1', 'hash2'],
              frameHash: {
                sha256: 'bf20f9a1b2c3d4e5f6789abcdef01234567890abcdef01234567890abcdef0123',
                phash: '0xaf39bc45',
              },
            },
            provenance: {
              type: 'onChain' as const,
              contract: {
                chain: 'evm' as const,
                standard: 'erc721' as const,
                address: '0x1234567890abcdef',
                tokenId: '42',
              },
            },
          },
          {
            id: 'item-2',
            title: 'Second Item',
            source: 'https://example.com/2',
            duration: 400,
            license: 'subscription' as const,
            created: '2025-06-03T17:01:00.002Z',
          },
        ],
      };

      const canonical = createCanonicalForm(complexPlaylist);

      // Should end with LF terminator
      expect(canonical.endsWith('\n')).toBe(true);

      // Remove LF terminator for JSON parsing
      const jsonContent = canonical.replace(/\n$/, '');

      // Should be valid JSON
      expect(() => JSON.parse(jsonContent)).not.toThrow();

      // Should be deterministic
      const canonical2 = createCanonicalForm(complexPlaylist);
      expect(canonical).toBe(canonical2);
    });

    it('should throw error for invalid input', () => {
      // Test with circular reference
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => createCanonicalForm(circular)).toThrow();
    });

    it('should handle edge cases in data types', () => {
      const edgeCasePlaylist: Omit<Playlist, 'signature'> = {
        dpVersion: '1.0.0',
        id: 'edge-case-test',
        slug: 'edge-cases',
        title: 'Edge Cases Test',
        created: '2025-01-01T00:00:00Z',
        items: [
          {
            id: 'edge-item',
            title: 'Edge Case Item',
            source: 'https://example.com/edge',
            duration: 0, // zero duration
            license: 'open' as const,
            created: '2025-01-01T00:00:00.001Z',
            // Test special characters
            display: {
              background: 'transparent',
              margin: '0%',
            },
          },
        ],
      };

      const canonical = createCanonicalForm(edgeCasePlaylist);

      // Should end with LF terminator
      expect(canonical.endsWith('\n')).toBe(true);

      // Remove LF terminator for JSON parsing
      const jsonContent = canonical.replace(/\n$/, '');

      // Should be valid JSON
      expect(() => JSON.parse(jsonContent)).not.toThrow();

      const parsed = JSON.parse(jsonContent);
      expect(parsed.items[0].duration).toBe(0);
    });
  });

  describe('getServerKeyPair', () => {
    const validPrivateKeyHex =
      '302e020100300506032b657004220420d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

    it('should throw error when ED25519_PRIVATE_KEY is not provided', async () => {
      const env: Env = {} as Env;

      await expect(getServerKeyPair(env)).rejects.toThrow(
        'ED25519_PRIVATE_KEY environment variable is required'
      );
    });

    it('should throw error when ED25519_PRIVATE_KEY is empty', async () => {
      const env: Env = { ED25519_PRIVATE_KEY: '' } as Env;

      await expect(getServerKeyPair(env)).rejects.toThrow(
        'ED25519_PRIVATE_KEY environment variable is required'
      );
    });

    it('should load valid PKCS#8 private key', async () => {
      const env: Env = { ED25519_PRIVATE_KEY: validPrivateKeyHex } as Env;

      const keyPair = await getServerKeyPair(env);

      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey.length).toBe(32);
    });

    it('should load valid private key with 0x prefix', async () => {
      const env: Env = { ED25519_PRIVATE_KEY: `0x${validPrivateKeyHex}` } as Env;

      const keyPair = await getServerKeyPair(env);

      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    });

    it('should handle 32-byte raw private key', async () => {
      // Generate a 32-byte hex string (64 characters)
      const rawPrivateKey = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
      const env: Env = { ED25519_PRIVATE_KEY: rawPrivateKey } as Env;

      const keyPair = await getServerKeyPair(env);

      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    });

    it('should throw error for invalid private key format', async () => {
      const env: Env = { ED25519_PRIVATE_KEY: 'invalid-key-format' } as Env;

      await expect(getServerKeyPair(env)).rejects.toThrow(
        'Failed to load ED25519 private key from environment'
      );
    });

    it('should throw error for wrong key length', async () => {
      const env: Env = { ED25519_PRIVATE_KEY: 'deadbeef' } as Env; // Too short

      await expect(getServerKeyPair(env)).rejects.toThrow(
        'Failed to load ED25519 private key from environment'
      );
    });
  });

  describe('hexToUint8Array (via integration testing)', () => {
    it('should handle hex strings with 0x prefix in getServerKeyPair', async () => {
      const hexWithPrefix =
        '0x302e020100300506032b657004220420d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
      const env: Env = { ED25519_PRIVATE_KEY: hexWithPrefix } as Env;

      const keyPair = await getServerKeyPair(env);
      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    });

    it('should handle hex strings without 0x prefix in getServerKeyPair', async () => {
      const hexWithoutPrefix =
        '302e020100300506032b657004220420d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
      const env: Env = { ED25519_PRIVATE_KEY: hexWithoutPrefix } as Env;

      const keyPair = await getServerKeyPair(env);
      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    });

    it('should handle hex parsing edge cases in getServerKeyPair', async () => {
      // Test with completely invalid hex that should fail at crypto operations
      const completelyInvalidHex = 'not-hex-at-all';
      const env1: Env = { ED25519_PRIVATE_KEY: completelyInvalidHex } as Env;

      await expect(getServerKeyPair(env1)).rejects.toThrow();

      // Test with mostly valid hex but wrong for crypto operations
      // This might pass hex parsing but fail at crypto key import
      const wrongFormatHex = 'deadbeefdeadbeefdeadbeefdeadbeef'; // Valid hex but wrong key format
      const env2: Env = { ED25519_PRIVATE_KEY: wrongFormatHex } as Env;

      await expect(getServerKeyPair(env2)).rejects.toThrow();
    });

    it('should reject odd-length hex strings in getServerKeyPair', async () => {
      const oddLengthHex = '302e020100300506032b657004220420d75a980182b10ab7d54bfed3c964073'; // Missing last character
      const env: Env = { ED25519_PRIVATE_KEY: oddLengthHex } as Env;

      await expect(getServerKeyPair(env)).rejects.toThrow();
    });
  });
});
