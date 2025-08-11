import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MessageBatch, Message } from '@cloudflare/workers-types';
import { processWriteOperations, queueWriteOperation, generateMessageId } from './processor';
import type {
  Env,
  Playlist,
  PlaylistGroup,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
  CreatePlaylistGroupMessage,
  UpdatePlaylistGroupMessage,
} from '../types';

// Mock the storage module
vi.mock('../storage', () => ({
  savePlaylist: vi.fn(),
  savePlaylistGroup: vi.fn(),
}));

import { savePlaylist, savePlaylistGroup } from '../storage';

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

const mockPlaylistGroup: PlaylistGroup = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  slug: 'test-exhibition-5678',
  title: 'Test Exhibition',
  curator: 'Test Curator',
  playlists: ['https://example.com/playlists/test-playlist-1'],
  created: '2024-01-01T00:00:00Z',
};

// Mock KV implementation for testing
const createMockKV = () => {
  const storage = new Map<string, string>();
  return {
    storage,
    get: async (key: string) => storage.get(key) || null,
    put: async (key: string, value: string) => {
      storage.set(key, value);
    },
    delete: async (key: string) => {
      storage.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true }),
  };
};

// Mock Queue implementation for testing
const createMockQueue = () => {
  const messages: any[] = [];
  return {
    messages, // Expose for testing
    send: vi.fn(async (message: any) => {
      messages.push(message);
      return { id: `msg-${Date.now()}` };
    }),
  };
};

// Test environment setup
const createTestEnv = (): Env => {
  const mockQueue = createMockQueue();
  return {
    API_SECRET: 'test-secret-key',
    ED25519_PRIVATE_KEY: 'test-private-key',
    ENVIRONMENT: 'test',
    DP1_PLAYLISTS: createMockKV() as any,
    DP1_PLAYLIST_GROUPS: createMockKV() as any,
    DP1_PLAYLIST_ITEMS: createMockKV() as any,
    DP1_WRITE_QUEUE: mockQueue as any,
  };
};

// Helper to create mock message batch
const createMockMessageBatch = (messages: any[]): MessageBatch<unknown> => ({
  messages: messages.map((body, index) => ({
    id: `message-${index}`,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  })),
  queue: 'test-queue',
  retryAll: vi.fn(),
  ackAll: vi.fn(),
});

describe('Queue Processor', () => {
  let testEnv: Env;

  beforeEach(() => {
    testEnv = createTestEnv();
    vi.clearAllMocks();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
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
      const operation = 'update_playlist_group';
      const resourceId = mockPlaylistGroup.id;

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

      expect(testEnv.DP1_WRITE_QUEUE.send).toHaveBeenCalledWith(message);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Queued ${message.operation} operation with id ${message.id}`
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
      vi.mocked(testEnv.DP1_WRITE_QUEUE.send).mockRejectedValueOnce(new Error('Queue error'));

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
        vi.mocked(savePlaylist).mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalledWith(mockPlaylist, testEnv);
        expect(batch.messages[0].ack).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `Successfully processed ${message.operation} operation with id ${message.id}`
        );
      });

      it('should handle playlist creation failure', async () => {
        const message: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const batch = createMockMessageBatch([message]);
        vi.mocked(savePlaylist).mockResolvedValueOnce(false);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalledWith(mockPlaylist, testEnv);
        expect(batch.messages[0].retry).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error processing queue message:',
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
        vi.mocked(savePlaylist).mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalledWith(mockPlaylist, testEnv, true);
        expect(batch.messages[0].ack).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `Successfully processed ${message.operation} operation with id ${message.id}`
        );
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
        vi.mocked(savePlaylist).mockResolvedValueOnce(false);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalledWith(mockPlaylist, testEnv, true);
        expect(batch.messages[0].retry).toHaveBeenCalled();
      });
    });

    describe('create_playlist_group operations', () => {
      it('should successfully process playlist group creation', async () => {
        const message: CreatePlaylistGroupMessage = {
          id: generateMessageId('create_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist_group',
          data: { playlistGroup: mockPlaylistGroup },
        };

        const batch = createMockMessageBatch([message]);
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylistGroup).toHaveBeenCalledWith(mockPlaylistGroup, testEnv);
        expect(batch.messages[0].ack).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `Successfully saved playlist group ${mockPlaylistGroup.id} (${mockPlaylistGroup.title})`
        );
      });

      it('should handle playlist group creation failure', async () => {
        const message: CreatePlaylistGroupMessage = {
          id: generateMessageId('create_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist_group',
          data: { playlistGroup: mockPlaylistGroup },
        };

        const batch = createMockMessageBatch([message]);
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(false);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylistGroup).toHaveBeenCalledWith(mockPlaylistGroup, testEnv);
        expect(batch.messages[0].retry).toHaveBeenCalled();
      });
    });

    describe('update_playlist_group operations', () => {
      it('should successfully process playlist group update', async () => {
        const message: UpdatePlaylistGroupMessage = {
          id: generateMessageId('update_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'update_playlist_group',
          data: {
            groupId: mockPlaylistGroup.id,
            playlistGroup: mockPlaylistGroup,
          },
        };

        const batch = createMockMessageBatch([message]);
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylistGroup).toHaveBeenCalledWith(mockPlaylistGroup, testEnv, true);
        expect(batch.messages[0].ack).toHaveBeenCalled();
      });

      it('should handle playlist group update failure', async () => {
        const message: UpdatePlaylistGroupMessage = {
          id: generateMessageId('update_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'update_playlist_group',
          data: {
            groupId: mockPlaylistGroup.id,
            playlistGroup: mockPlaylistGroup,
          },
        };

        const batch = createMockMessageBatch([message]);
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(false);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylistGroup).toHaveBeenCalledWith(mockPlaylistGroup, testEnv, true);
        expect(batch.messages[0].retry).toHaveBeenCalled();
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

        const groupMessage: CreatePlaylistGroupMessage = {
          id: generateMessageId('create_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist_group',
          data: { playlistGroup: mockPlaylistGroup },
        };

        const batch = createMockMessageBatch([playlistMessage, groupMessage]);
        vi.mocked(savePlaylist).mockResolvedValueOnce(true);
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(true);

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalledWith(mockPlaylist, testEnv);
        expect(savePlaylistGroup).toHaveBeenCalledWith(mockPlaylistGroup, testEnv);
        expect(batch.messages[0].ack).toHaveBeenCalled();
        expect(batch.messages[1].ack).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith('Processing 2 write operations');
      });

      it('should continue processing other messages if one fails', async () => {
        const message1: CreatePlaylistMessage = {
          id: generateMessageId('create_playlist', mockPlaylist.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist',
          data: { playlist: mockPlaylist },
        };

        const message2: CreatePlaylistGroupMessage = {
          id: generateMessageId('create_playlist_group', mockPlaylistGroup.id),
          timestamp: new Date().toISOString(),
          operation: 'create_playlist_group',
          data: { playlistGroup: mockPlaylistGroup },
        };

        const batch = createMockMessageBatch([message1, message2]);
        vi.mocked(savePlaylist).mockResolvedValueOnce(false); // First fails
        vi.mocked(savePlaylistGroup).mockResolvedValueOnce(true); // Second succeeds

        await processWriteOperations(batch, testEnv);

        expect(savePlaylist).toHaveBeenCalled();
        expect(savePlaylistGroup).toHaveBeenCalled();
        expect(batch.messages[0].retry).toHaveBeenCalled(); // First message retried
        expect(batch.messages[1].ack).toHaveBeenCalled(); // Second message acked
      });
    });

    describe('error handling', () => {
      it('should handle unknown operations', async () => {
        const invalidMessage = {
          id: 'test-id',
          timestamp: new Date().toISOString(),
          operation: 'unknown_operation' as any,
          data: {},
        };

        const batch = createMockMessageBatch([invalidMessage]);

        await processWriteOperations(batch, testEnv);

        expect(batch.messages[0].retry).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error processing queue message:',
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
        vi.mocked(savePlaylist).mockRejectedValueOnce(new Error('Storage error'));

        await processWriteOperations(batch, testEnv);

        expect(batch.messages[0].retry).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error processing queue message:',
          expect.any(Error)
        );
      });
    });
  });
});
