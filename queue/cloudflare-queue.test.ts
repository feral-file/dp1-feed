import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudFlareQueue, CloudFlareQueueProvider } from './cloudflare-queue';
import type { QueueSendOptions } from './interfaces';

describe('CloudFlareQueue', () => {
  let queue: CloudFlareQueue;
  let mockCloudFlareQueue: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CloudFlare queue
    mockCloudFlareQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    queue = new CloudFlareQueue(mockCloudFlareQueue, 'test-queue');
  });

  describe('constructor', () => {
    it('should create a CloudFlare queue with the provided queue and name', () => {
      expect(queue).toBeInstanceOf(CloudFlareQueue);
      expect(queue.getName()).toBe('test-queue');
    });
  });

  describe('send', () => {
    it('should send a message successfully', async () => {
      const message = { id: 'test-message', data: 'test-data' };
      const options: QueueSendOptions = {
        contentType: 'application/json',
        delaySeconds: 10,
      };

      await queue.send(message, options);

      expect(mockCloudFlareQueue.send).toHaveBeenCalledWith(message, options);
    });

    it('should send a message without options', async () => {
      const message = { id: 'test-message', data: 'test-data' };

      await queue.send(message);

      expect(mockCloudFlareQueue.send).toHaveBeenCalledWith(message, undefined);
    });

    it('should handle send errors', async () => {
      const message = { id: 'test-message', data: 'test-data' };
      const error = new Error('Send failed');
      mockCloudFlareQueue.send.mockRejectedValue(error);

      await expect(queue.send(message)).rejects.toThrow('Send failed');
    });

    it('should handle string messages', async () => {
      const message = 'test-string-message';

      await queue.send(message);

      expect(mockCloudFlareQueue.send).toHaveBeenCalledWith(message, undefined);
    });

    it('should handle complex object messages', async () => {
      const message = {
        id: 'test-message',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {
          playlist: {
            id: 'playlist-1',
            title: 'Test Playlist',
          },
        },
      };

      await queue.send(message);

      expect(mockCloudFlareQueue.send).toHaveBeenCalledWith(message, undefined);
    });
  });

  describe('getName', () => {
    it('should return the queue name', () => {
      expect(queue.getName()).toBe('test-queue');
    });

    it('should return different name for different queue', () => {
      const anotherQueue = new CloudFlareQueue(mockCloudFlareQueue, 'another-queue');
      expect(anotherQueue.getName()).toBe('another-queue');
    });
  });
});

describe('CloudFlareQueueProvider', () => {
  let provider: CloudFlareQueueProvider;
  let mockWriteQueue: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CloudFlare queue
    mockWriteQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    provider = new CloudFlareQueueProvider(mockWriteQueue, 'DP1_WRITE_QUEUE');
  });

  describe('constructor', () => {
    it('should create a provider with default queue name', () => {
      const defaultProvider = new CloudFlareQueueProvider(mockWriteQueue);
      const queue = defaultProvider.getWriteQueue();

      expect(queue).toBeInstanceOf(CloudFlareQueue);
      expect(queue.getName()).toBe('DP1_WRITE_QUEUE');
    });

    it('should create a provider with custom queue name', () => {
      const customProvider = new CloudFlareQueueProvider(mockWriteQueue, 'CUSTOM_QUEUE');
      const queue = customProvider.getWriteQueue();

      expect(queue).toBeInstanceOf(CloudFlareQueue);
      expect(queue.getName()).toBe('CUSTOM_QUEUE');
    });
  });

  describe('getWriteQueue', () => {
    it('should return a CloudFlareQueue instance', () => {
      const queue = provider.getWriteQueue();

      expect(queue).toBeInstanceOf(CloudFlareQueue);
      expect(queue.getName()).toBe('DP1_WRITE_QUEUE');
    });

    it('should return the same queue instance on multiple calls', () => {
      const queue1 = provider.getWriteQueue();
      const queue2 = provider.getWriteQueue();

      expect(queue1).toBe(queue2);
    });

    it('should allow sending messages through the returned queue', async () => {
      const queue = provider.getWriteQueue();
      const message = { id: 'test-message', data: 'test-data' };

      await queue.send(message);

      expect(mockWriteQueue.send).toHaveBeenCalledWith(message, undefined);
    });
  });

  describe('integration tests', () => {
    it('should work with the complete flow', async () => {
      const queue = provider.getWriteQueue();
      const message = {
        id: 'test-message',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: { test: 'data' },
      };
      const options: QueueSendOptions = {
        contentType: 'application/json',
        delaySeconds: 5,
      };

      await queue.send(message, options);

      expect(mockWriteQueue.send).toHaveBeenCalledWith(message, options);
    });

    it('should handle multiple messages', async () => {
      const queue = provider.getWriteQueue();
      const messages = [
        { id: 'msg-1', data: 'data-1' },
        { id: 'msg-2', data: 'data-2' },
        { id: 'msg-3', data: 'data-3' },
      ];

      for (const message of messages) {
        await queue.send(message);
      }

      expect(mockWriteQueue.send).toHaveBeenCalledTimes(3);
      expect(mockWriteQueue.send).toHaveBeenNthCalledWith(1, messages[0], undefined);
      expect(mockWriteQueue.send).toHaveBeenNthCalledWith(2, messages[1], undefined);
      expect(mockWriteQueue.send).toHaveBeenNthCalledWith(3, messages[2], undefined);
    });

    it('should handle queue send errors', async () => {
      const queue = provider.getWriteQueue();
      const message = { id: 'test-message', data: 'test-data' };
      const error = new Error('Queue send failed');

      mockWriteQueue.send.mockRejectedValue(error);

      await expect(queue.send(message)).rejects.toThrow('Queue send failed');
    });
  });
});
