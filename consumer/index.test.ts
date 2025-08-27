import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NatsConsumer, type ConsumerConfig } from './index';

// Mock NATS
vi.mock('nats', () => ({
  connect: vi.fn(),
  StringCodec: vi.fn(() => ({
    decode: vi.fn((data: string) => data),
  })),
  DeliverPolicy: {
    New: 'new',
  },
  AckPolicy: {
    Explicit: 'explicit',
  },
  ReplayPolicy: {
    Instant: 'instant',
  },
}));

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

describe('NatsConsumer', () => {
  let consumer: NatsConsumer;
  let mockConfig: ConsumerConfig;
  let mockConnection: any;
  let mockJetStream: any;
  let mockJetStreamManager: any;
  let mockConsumer: any;
  let mockFetch: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock configuration
    mockConfig = {
      natsUrl: 'nats://localhost:4222',
      streamName: 'DP1_WRITE_OPERATIONS',
      subjectName: 'dp1.write.operations',
      consumerName: 'dp1-consumer',
      serverUrl: 'http://localhost:8787',
      apiSecret: 'test-secret',
      maxMessages: 100,
      batchSize: 1,
      ackWait: 30,
    };

    // Mock NATS connection
    mockConnection = {
      jetstream: vi.fn(),
      jetstreamManager: vi.fn(),
      closed: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      isClosed: vi.fn(() => false),
    };

    // Mock JetStream
    mockJetStream = {
      consumers: {
        get: vi.fn(),
      },
    };

    // Mock JetStream Manager
    mockJetStreamManager = {
      consumers: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    // Mock Consumer
    mockConsumer = {
      fetch: vi.fn(),
    };

    // Mock fetch
    mockFetch = vi.fn();

    // Setup mocks
    const { connect } = vi.mocked(await import('nats'));
    connect.mockResolvedValue(mockConnection);
    mockConnection.jetstream.mockReturnValue(mockJetStream);
    mockConnection.jetstreamManager.mockResolvedValue(mockJetStreamManager);
    mockJetStream.consumers.get.mockResolvedValue(mockConsumer);

    const fetch = vi.mocked((await import('node-fetch')).default);
    fetch.mockImplementation(mockFetch);

    consumer = new NatsConsumer(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a consumer with the provided config', () => {
      expect(consumer).toBeInstanceOf(NatsConsumer);
    });
  });

  describe('connect', () => {
    it('should connect to NATS server successfully', async () => {
      await consumer.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledWith({
        servers: [mockConfig.natsUrl],
        name: 'dp1-feed-consumer',
        reconnect: true,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 5000,
      });
    });

    it('should connect with token authentication', async () => {
      const configWithToken = { ...mockConfig, token: 'test-token' };
      const consumerWithToken = new NatsConsumer(configWithToken);

      await consumerWithToken.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'test-token',
        })
      );
    });

    it('should connect with username/password authentication', async () => {
      const configWithAuth = {
        ...mockConfig,
        username: 'test-user',
        password: 'test-pass',
      };
      const consumerWithAuth = new NatsConsumer(configWithAuth);

      await consumerWithAuth.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'test-user',
          pass: 'test-pass',
        })
      );
    });

    it('should handle connection errors', async () => {
      const { connect } = vi.mocked(await import('nats'));
      connect.mockRejectedValue(new Error('Connection failed'));

      await expect(consumer.connect()).rejects.toThrow('Connection failed');
    });

    it('should setup connection event handlers', async () => {
      await consumer.connect();

      expect(mockConnection.closed).toHaveBeenCalled();
    });
  });

  describe('ensureConsumer', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should create consumer if it does not exist', async () => {
      mockJetStreamManager.consumers.info.mockRejectedValue(new Error('Consumer not found'));

      await consumer.ensureConsumer();

      expect(mockJetStreamManager.consumers.add).toHaveBeenCalledWith(
        mockConfig.streamName,
        expect.objectContaining({
          durable_name: mockConfig.consumerName,
          filter_subject: mockConfig.subjectName,
          deliver_policy: 'new',
          ack_policy: 'explicit',
          ack_wait: 30000000000, // 30 seconds in nanoseconds
          max_deliver: 3,
          replay_policy: 'instant',
        })
      );
    });

    it('should skip creation if consumer already exists', async () => {
      mockJetStreamManager.consumers.info.mockResolvedValue({ name: mockConfig.consumerName });

      await consumer.ensureConsumer();

      expect(mockJetStreamManager.consumers.add).not.toHaveBeenCalled();
    });

    it('should handle errors during consumer creation', async () => {
      mockJetStreamManager.consumers.info.mockRejectedValue(new Error('Consumer not found'));
      mockJetStreamManager.consumers.add.mockRejectedValue(new Error('Creation failed'));

      await expect(consumer.ensureConsumer()).rejects.toThrow('Creation failed');
    });

    it('should throw error when consumer is not initialized', async () => {
      // Create a new consumer instance without connecting
      const uninitializedConsumer = new NatsConsumer(mockConfig);

      // Try to call ensureConsumer without connecting first
      await expect(uninitializedConsumer.ensureConsumer()).rejects.toThrow(
        'NATS connection or JetStream client not initialized'
      );
    });
  });

  describe('processMessage', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should process a message successfully', async () => {
      const messageData = {
        id: 'test-message-id',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processedCount: 1 }),
      });

      const result = await consumer.processMessage(messageData);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockConfig.serverUrl}/queues/process-message`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockConfig.apiSecret}`,
          }),
          body: JSON.stringify(messageData),
        })
      );

      expect(result).toEqual({
        success: true,
        processedCount: 1,
      });
    });

    it('should handle API errors', async () => {
      const messageData = {
        id: 'test-message-id',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const result = await consumer.processMessage(messageData);

      expect(result).toEqual({
        success: false,
        processedCount: 0,
        errors: [
          {
            messageId: messageData.id,
            error: 'API error: 500 Internal Server Error',
          },
        ],
      });
    });

    it('should handle network errors', async () => {
      const messageData = {
        id: 'test-message-id',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await consumer.processMessage(messageData);

      expect(result).toEqual({
        success: false,
        processedCount: 0,
        errors: [
          {
            messageId: messageData.id,
            error: 'Network error',
          },
        ],
      });
    });
  });

  describe('processBatch', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should process a batch of messages successfully', async () => {
      const messages = [
        {
          id: 'test-message-1',
          operation: 'create',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          id: 'test-message-2',
          operation: 'update',
          timestamp: '2024-01-01T00:00:01Z',
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processedCount: 2 }),
      });

      const result = await consumer.processBatch(messages);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockConfig.serverUrl}/queues/process-batch`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockConfig.apiSecret}`,
          }),
          body: JSON.stringify({ messages }),
        })
      );

      expect(result).toEqual({
        success: true,
        processedCount: 2,
      });
    });

    it('should handle batch API errors', async () => {
      const messages = [
        {
          id: 'test-message-1',
          operation: 'create',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid batch'),
      });

      const result = await consumer.processBatch(messages);

      expect(result).toEqual({
        success: false,
        processedCount: 0,
        errors: [
          {
            messageId: 'test-message-1',
            error: 'API error: 400 Bad Request',
          },
        ],
      });
    });

    it('should handle batch network errors', async () => {
      const messages = [
        {
          id: 'test-message-1',
          operation: 'create',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await consumer.processBatch(messages);

      expect(result).toEqual({
        success: false,
        processedCount: 0,
        errors: [
          {
            messageId: 'test-message-1',
            error: 'Network error',
          },
        ],
      });
    });
  });

  describe('startConsuming', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should start consuming messages', async () => {
      const mockMessages = [
        {
          data: JSON.stringify({
            id: 'test-message-1',
            operation: 'create',
            timestamp: '2024-01-01T00:00:00Z',
          }),
          ack: vi.fn(),
          nak: vi.fn(),
        },
      ];

      // Mock fetch to return messages only once, then throw to break the loop
      mockConsumer.fetch
        .mockResolvedValueOnce({
          async *[Symbol.asyncIterator]() {
            for (const message of mockMessages) {
              yield message;
            }
          },
        })
        .mockRejectedValueOnce(new Error('Stop consuming'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processedCount: 1 }),
      });

      // Start consuming in background
      const consumePromise = consumer.startConsuming();

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Stop consuming
      await consumer.stop();

      // Wait for the consume promise to resolve
      await consumePromise;

      expect(mockConsumer.fetch).toHaveBeenCalledWith({
        max_messages: mockConfig.batchSize,
        expires: 5000,
      });
      expect(mockMessages[0]!.ack).toHaveBeenCalled();
    });

    it('should handle invalid message format', async () => {
      const mockMessages = [
        {
          data: JSON.stringify({
            // Missing required fields
            id: 'test-message-1',
          }),
          ack: vi.fn(),
          nak: vi.fn(),
        },
      ];

      // Mock fetch to return messages only once, then throw to break the loop
      mockConsumer.fetch
        .mockResolvedValueOnce({
          async *[Symbol.asyncIterator]() {
            for (const message of mockMessages) {
              yield message;
            }
          },
        })
        .mockRejectedValueOnce(new Error('Stop consuming'));

      // Start consuming in background
      const consumePromise = consumer.startConsuming();

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Stop consuming
      await consumer.stop();

      // Wait for the consume promise to resolve
      await consumePromise;

      // Should have called nak for invalid message
      expect(mockMessages[0]!.nak).toHaveBeenCalled();
    });

    it('should handle message parsing errors', async () => {
      const mockMessages = [
        {
          data: 'invalid-json',
          ack: vi.fn(),
          nak: vi.fn(),
        },
      ];

      // Mock fetch to return messages only once, then throw to break the loop
      mockConsumer.fetch
        .mockResolvedValueOnce({
          async *[Symbol.asyncIterator]() {
            for (const message of mockMessages) {
              yield message;
            }
          },
        })
        .mockRejectedValueOnce(new Error('Stop consuming'));

      // Start consuming in background
      const consumePromise = consumer.startConsuming();

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Stop consuming
      await consumer.stop();

      // Wait for the consume promise to resolve
      await consumePromise;

      // Should have called nak for parsing error
      expect(mockMessages[0]!.nak).toHaveBeenCalled();
    });

    it('should throw error when consumer is not initialized', async () => {
      // Create a new consumer instance without connecting
      const uninitializedConsumer = new NatsConsumer(mockConfig);

      // Try to call startConsuming without connecting first
      await expect(uninitializedConsumer.startConsuming()).rejects.toThrow(
        'JetStream client not initialized'
      );
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should stop the consumer and close connection', async () => {
      // First connect to initialize the consumer
      await consumer.connect();

      // Verify initial state
      expect((consumer as any).running).toBe(false);
      expect((consumer as any).nc).not.toBeNull();
      expect((consumer as any).js).not.toBeNull();

      await consumer.stop();

      // Verify connection was closed
      expect(mockConnection.close).toHaveBeenCalled();

      // Verify internal state variables were set
      expect((consumer as any).running).toBe(false);
      expect((consumer as any).nc).toBeNull();
      expect((consumer as any).js).toBeNull();
    });
  });

  describe('getConsumerInfo', () => {
    beforeEach(async () => {
      await consumer.connect();
    });

    it('should get consumer info successfully', async () => {
      const mockInfo = {
        name: mockConfig.consumerName,
        stream_name: mockConfig.streamName,
      };

      mockJetStreamManager.consumers.info.mockResolvedValue(mockInfo);

      const result = await consumer.getConsumerInfo();

      expect(mockJetStreamManager.consumers.info).toHaveBeenCalledWith(
        mockConfig.streamName,
        mockConfig.consumerName
      );
      expect(result).toEqual(mockInfo);
    });

    it('should handle errors when getting consumer info', async () => {
      mockJetStreamManager.consumers.info.mockRejectedValue(new Error('Info failed'));

      await expect(consumer.getConsumerInfo()).rejects.toThrow('Info failed');
    });
  });
});
