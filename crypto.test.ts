import { describe, it, expect, beforeEach } from 'vitest';
import { getServerKeyPair } from './crypto';
import type { Env } from './types';

describe('Crypto Functions', () => {
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
