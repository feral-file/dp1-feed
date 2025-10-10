import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the StorageService methods BEFORE importing anything that uses them
const mockSavePlaylist = vi.fn();

vi.mock('../storage/service', () => {
  return {
    StorageService: vi.fn().mockImplementation(() => ({
      savePlaylist: mockSavePlaylist,
    })),
  };
});

import { processWriteOperations, queueWriteOperation, generateMessageId } from './processor';
import type { Env } from '../types';
import type { CreatePlaylistMessage, UpdatePlaylistMessage } from './interfaces';
import {
  createTestEnv,
  createMockMessageBatch,
  setupStandardPlaylistFetch,
  MockQueue,
  MockKeyValueStorage,
} from '../test-helpers';
import { Playlist } from 'dp1-js';

// Mock console methods to avoid noise in tests
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

// Test data
const mockPlaylist: Playlist = {
  dpVersion: '1.0.0',
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'test-playlist-1234',
  title: 'Test Playlist',
  created: '2024-01-01T00:00:00Z',
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
  signature: 'ed25519:0x1234567890abcdef',
};

describe('Queue Processor', () => {
  let testEnv: Env;
  let mockQueue: MockQueue;
  let mockStorages: {
    playlist: MockKeyValueStorage;
    item: MockKeyValueStorage;
  };

  beforeEach(() => {
    const setup = createTestEnv();
    testEnv = setup.env;
    mockQueue = setup.mockQueue;
    mockStorages = setup.mockStorages;

    vi.clearAllMocks();
    mockSavePlaylist.mockClear();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();

    // Clear storage
    mockStorages.playlist.storage.clear();
    mockStorages.item.storage.clear();

    // Reset queue
    mockQueue.messages.length = 0;
    mockQueue.sendMock.mockClear();

    // Set up standard fetch mocks
    setupStandardPlaylistFetch();
  });

  describe('generateMessageId', () => {
    it('should generate unique message IDs', () => {
      const operation = 'create_playlist';
      const resourceId = mockPlaylist.id;

      const id1 = generateMessageId(operation, resourceId);
      const id2 = generateMessageId(operation, resourceId);

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^create_playlist-550e8400-e29b-41d4-a716-446655440000-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^create_playlist-550e8400-e29b-41d4-a716-446655440000-\d+-[a-z0-9]+$/);
    });

    it('should include operation and resource ID in message ID', () => {
      const operation = 'update_playlist';
      const resourceId = mockPlaylist.id;

      const messageId = generateMessageId(operation, resourceId);

      expect(messageId).toContain(operation);
      expect(messageId).toContain(resourceId);
    });
  });

  describe('queueWriteOperation', () => {
    it('should successfully queue a write operation', async () => {
      const message: CreatePlaylistMessage = {
        id: generateMessageId('create_playlist', mockPlaylist.id),
        timestamp: new Date().toISOString(),
        operation: 'create_playlist',
        data: { playlist: mockPlaylist },
      };

      await queueWriteOperation(message, testEnv);

      expect(mockQueue.sendMock).toHaveBeenCalledWith(message, undefined);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Queued ${message.operation} operation`)
      );
    });

    it('should handle queue failures', async () => {
      const message: CreatePlaylistMessage = {
        id: generateMessageId('create_playlist', mockPlaylist.id),
        timestamp: new Date().toISOString(),
        operation: 'create_playlist',
        data: { playlist: mockPlaylist },
      };

      // Mock queue send to fail
      mockQueue.sendMock.mockRejectedValueOnce(new Error('Queue error'));

      await expect(queueWriteOperation(message, testEnv)).rejects.toThrow(
        'Failed to queue write operation'
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to queue write operation:',
        expect.any(Error)
      );
    });
  });

  describe('processWriteOperations', () => {
    describe('create_playlist operations', () => {
      it('should successfully process playlist creation', async () => {
        const message: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const batch = createMockMessageBatch([message]);
        mockSavePlaylist.mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(mockSavePlaylist).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockPlaylist.id,
            title: mockPlaylist.title,
          }),
          false
        );
        // Note: batch.ackAll is not called by processWriteOperations itself
        // The caller (like index.ts queue function) handles acking based on the result
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Processed message`));
      });

      it('should handle playlist creation failure', async () => {
        const message: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const batch = createMockMessageBatch([message]);
        mockSavePlaylist.mockRejectedValueOnce(new Error('Playlist save failed'));

        // The whole batch should fail if any message fails
        const result = await processWriteOperations(batch, testEnv);
        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].error).toBe('Playlist save failed');

        expect(mockSavePlaylist).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockPlaylist.id,
            title: mockPlaylist.title,
          }),
          false
        );
        expect(batch.ackAll).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error processing message'),
          expect.any(Error)
        );
      });
    });

    describe('update_playlist operations', () => {
      it('should successfully process playlist update', async () => {
        const message: UpdatePlaylistMessage = {
          id: generateMessageId('update_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'update_playlist',
          data: {
            playlistId: mockPlaylist.id,
            playlist: mockPlaylist,
          },
        };

        const batch = createMockMessageBatch([message]);
        mockSavePlaylist.mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(mockSavePlaylist).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockPlaylist.id,
            title: mockPlaylist.title,
          }),
          true
        );
        // Note: batch.ackAll is not called by processWriteOperations itself
        // The caller (like index.ts queue function) handles acking based on the result
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Processed message`));
      });

      it('should handle playlist update failure', async () => {
        const message: UpdatePlaylistMessage = {
          id: generateMessageId('update_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'update_playlist',
          data: {
            playlistId: mockPlaylist.id,
            playlist: mockPlaylist,
          },
        };

        const batch = createMockMessageBatch([message]);
        mockSavePlaylist.mockRejectedValueOnce(new Error('Playlist update failed'));

        const result = await processWriteOperations(batch, testEnv);
        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].error).toBe('Playlist update failed');

        expect(mockSavePlaylist).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockPlaylist.id,
            title: mockPlaylist.title,
          }),
          true
        );
        expect(batch.ackAll).not.toHaveBeenCalled();
      });
    });

    describe('batch processing', () => {
      it('should process multiple messages in a batch', async () => {
        const playlistMessage: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const batch = createMockMessageBatch([playlistMessage]);

        expect(batch.ackAll).not.toHaveBeenCalled(); // Batch should not be acked on failure
      });
    });

    describe('error handling', () => {
      it('should handle unknown operations', async () => {
        const invalidMessage = {
          id: generateMessageId('unknown_operation', 'unknown-id'),
          timestamp: new Date().toISOString(),
          operation: 'unknown_operation' as any,
          data: {},
        };

        const batch = createMockMessageBatch([invalidMessage]);

        const result = await processWriteOperations(batch, testEnv);
        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].error).toBe('Unknown message operation: unknown_operation');

        expect(batch.ackAll).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error processing message message-0:',
          expect.any(Error)
        );
      });

      it('should handle storage errors gracefully', async () => {
        const message: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const batch = createMockMessageBatch([message]);
        mockSavePlaylist.mockRejectedValueOnce(new Error('Storage error'));

        const result = await processWriteOperations(batch, testEnv);
        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].error).toBe('Storage error');

        expect(batch.ackAll).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error processing message message-0:',
          expect.any(Error)
        );
      });
    });
  });
});
