import { vi } from 'vitest';
import type { StorageProvider, KeyValueStorage } from './storage/interfaces';
import type { QueueProvider, Queue } from './queue/interfaces';
import type { Env } from './types';

// Mock KV Namespace for testing
export class MockKVNamespace {
  public storage = new Map<string, string>();

  async get(key: string | string[], options?: any): Promise<string | null | Map<string, any>> {
    if (Array.isArray(key)) {
      // Batch get operation
      const result = new Map<string, any>();
      for (const k of key) {
        const value = this.storage.get(k);
        if (value !== undefined) {
          if (options?.type === 'json') {
            try {
              result.set(k, JSON.parse(value));
            } catch {
              result.set(k, value);
            }
          } else {
            result.set(k, value);
          }
        }
      }
      return result;
    } else {
      // Single get operation
      const value = this.storage.get(key);
      if (value === undefined) return null;

      if (options?.type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }
  }

  async put(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const allKeys = Array.from(this.storage.keys())
      .filter(key => !options?.prefix || key.startsWith(options.prefix))
      .sort();

    let startIndex = 0;
    if (options?.cursor) {
      const cursorIndex = allKeys.findIndex(key => key > options.cursor!);
      startIndex = cursorIndex >= 0 ? cursorIndex : allKeys.length;
    }

    const limit = options?.limit || 1000;
    const keys = allKeys.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < allKeys.length;

    const result: any = {
      keys: keys.map(name => ({ name })),
      list_complete: !hasMore,
    };

    if (hasMore) {
      result.cursor = keys[keys.length - 1];
    }

    return result;
  }

  async getWithMetadata(
    key: string,
    options?: any
  ): Promise<{ value: string | null; metadata: any }> {
    const value = await this.get(key, options);
    return {
      value: value as string | null,
      metadata: null, // Mock metadata as null for simplicity
    };
  }
}

// Mock KeyValueStorage implementation that wraps MockKVNamespace
export class MockKeyValueStorage implements KeyValueStorage {
  private kv: MockKVNamespace;

  constructor() {
    this.kv = new MockKVNamespace();
  }

  get storage() {
    return this.kv.storage;
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) as Promise<string | null>;
  }

  async getMultiple(keys: string[]): Promise<Map<string, any>> {
    return this.kv.get(keys, { type: 'json' }) as Promise<Map<string, any>>;
  }

  async put(key: string, value: string): Promise<void> {
    return this.kv.put(key, value);
  }

  async delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    return this.kv.list(options);
  }
}

// Mock Queue implementation
export class MockQueue implements Queue {
  public messages: any[] = [];
  public sendMock = vi.fn();

  constructor() {
    this.sendMock.mockImplementation(async (message: any, _options?: any) => {
      this.messages.push(message);
      return { id: `msg-${Date.now()}` };
    });
  }

  async send(message: any, options?: any): Promise<void> {
    return this.sendMock(message, options);
  }

  async sendBatch(messages: any[], options?: any): Promise<void> {
    for (const message of messages) {
      await this.send(message, options);
    }
  }

  getName(): string {
    return 'test-queue';
  }
}

// Mock StorageProvider that uses our mock storage
export class MockStorageProvider implements StorageProvider {
  private playlistStorage: MockKeyValueStorage;
  private channelStorage: MockKeyValueStorage;
  private playlistItemStorage: MockKeyValueStorage;

  constructor() {
    this.playlistStorage = new MockKeyValueStorage();
    this.channelStorage = new MockKeyValueStorage();
    this.playlistItemStorage = new MockKeyValueStorage();
  }

  getPlaylistStorage(): KeyValueStorage {
    return this.playlistStorage;
  }

  getChannelStorage(): KeyValueStorage {
    return this.channelStorage;
  }

  getPlaylistItemStorage(): KeyValueStorage {
    return this.playlistItemStorage;
  }

  // Expose the underlying storage for test assertions
  getMockStorages() {
    return {
      playlist: this.playlistStorage,
      group: this.channelStorage,
      item: this.playlistItemStorage,
    };
  }
}

// Mock QueueProvider that uses our mock queue
export class MockQueueProvider implements QueueProvider {
  private writeQueue: MockQueue;

  constructor() {
    this.writeQueue = new MockQueue();
  }

  getWriteQueue(): Queue {
    return this.writeQueue;
  }

  // Expose the underlying queue for test assertions
  getMockQueue() {
    return this.writeQueue;
  }
}

// Test environment setup using pure mock providers
export const createTestEnv = (options?: {
  selfHostedDomains?: string;
}): {
  env: Env;
  mockStorages: {
    playlist: MockKeyValueStorage;
    group: MockKeyValueStorage;
    item: MockKeyValueStorage;
  };
  mockQueue: MockQueue;
} => {
  const mockStorageProvider = new MockStorageProvider();
  const mockQueueProvider = new MockQueueProvider();

  const env: Env = {
    API_SECRET: 'test-secret-key',
    ED25519_PRIVATE_KEY: 'test-private-key',
    ENVIRONMENT: 'test',
    storageProvider: mockStorageProvider,
    queueProvider: mockQueueProvider,
    SELF_HOSTED_DOMAINS: options?.selfHostedDomains,
  };

  return {
    env,
    mockStorages: mockStorageProvider.getMockStorages(),
    mockQueue: mockQueueProvider.getMockQueue(),
  };
};

// Helper to create mock message batch for queue tests
export const createMockMessageBatch = (messages: any[]): any => ({
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

// Helper to set up standard fetch mocks for playlist operations
export const setupStandardPlaylistFetch = () => {
  global.fetch = vi.fn((url: string) => {
    if (url.includes('test-playlist-1')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            dpVersion: '1.0.0',
            id: 'test-playlist-id-1',
            slug: 'test-playlist-1',
            title: 'Test Playlist 1',
            created: '2024-01-01T00:00:00Z',
            signature: 'ed25519:0x1234567890abcdef',
            items: [
              {
                id: 'test-item-id-1',
                title: 'Test Item 1',
                source: 'https://example.com/item1.html',
                duration: 300,
                license: 'open',
                created: '2024-01-01T00:00:00.001Z',
              },
            ],
          }),
      } as Response);
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  }) as any;
};
