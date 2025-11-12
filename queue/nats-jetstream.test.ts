import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NatsJetStreamQueue, NatsJetStreamQueueProvider, type NatsConfig } from './nats-jetstream';
import type { QueueSendOptions } from './interfaces';

// Mock NATS
vi.mock('nats', () => ({
  connect: vi.fn(),
  headers: vi.fn(() => ({
    set: vi.fn(),
  })),
  RetentionPolicy: {
    Limits: 'limits',
  },
  StorageType: {
    File: 'file',
  },
  DiscardPolicy: {
    Old: 'old',
  },
}));

describe('NatsJetStreamQueue', () => {
  let queue: NatsJetStreamQueue;
  let mockConfig: NatsConfig;
  let mockConnection: any;
  let mockJetStream: any;
  let mockJetStreamManager: any;
  let mockHeaders: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockConfig = {
      endpoint: 'nats://localhost:4222',
      stream: 'DP1_WRITE_OPERATIONS',
      subject: 'dp1.write.operations',
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
      publish: vi.fn(),
    };

    // Mock JetStream Manager
    mockJetStreamManager = {
      streams: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    // Mock headers
    mockHeaders = {
      set: vi.fn(),
    };

    // Get the mocked functions from the module
    const { connect, headers } = await import('nats');
    const mockConnect = connect as any;
    const mockHeadersFunc = headers as any;

    // Setup mocks
    mockConnect.mockResolvedValue(mockConnection);
    mockHeadersFunc.mockReturnValue(mockHeaders);
    mockConnection.jetstream.mockReturnValue(mockJetStream);
    mockConnection.jetstreamManager.mockResolvedValue(mockJetStreamManager);

    queue = new NatsJetStreamQueue(mockConfig, 'test-queue');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a NATS JetStream queue with the provided config and name', () => {
      expect(queue).toBeInstanceOf(NatsJetStreamQueue);
      expect(queue.getName()).toBe('test-queue');
    });
  });

  describe('connect', () => {
    it('should connect to NATS server successfully', async () => {
      await queue.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledWith({
        servers: [mockConfig.endpoint],
        name: 'dp1-feed-queue',
        reconnect: true,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 5000,
      });
    });

    it('should connect with token authentication', async () => {
      const configWithToken = { ...mockConfig, token: 'test-token' };
      const queueWithToken = new NatsJetStreamQueue(configWithToken, 'test-queue');

      await queueWithToken.connect();

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
      const queueWithAuth = new NatsJetStreamQueue(configWithAuth, 'test-queue');

      await queueWithAuth.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'test-user',
          pass: 'test-pass',
        })
      );
    });

    it('should reuse existing connection if already connected', async () => {
      // First connection
      await queue.connect();

      // Second connection should reuse the existing one
      await queue.connect();

      const { connect } = vi.mocked(await import('nats'));
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors', async () => {
      const { connect } = vi.mocked(await import('nats'));
      connect.mockRejectedValue(new Error('Connection failed'));

      await expect(queue.connect()).rejects.toThrow('Connection failed');
    });

    it('should set up connection event handlers', async () => {
      await queue.connect();

      expect(mockConnection.closed).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await queue.connect();
    });

    it('should send a message successfully', async () => {
      const message = { id: 'test-message', data: 'test-data' };
      const publishAck = { stream: 'test-stream', seq: 123 };

      mockJetStream.publish.mockResolvedValue(publishAck);

      await queue.send(message);

      expect(mockJetStream.publish).toHaveBeenCalledWith(
        mockConfig.subject,
        new TextEncoder().encode(JSON.stringify(message)),
        { headers: mockHeaders }
      );
    });

    it('should send a string message', async () => {
      const message = 'test-string-message';
      const publishAck = { stream: 'test-stream', seq: 123 };

      mockJetStream.publish.mockResolvedValue(publishAck);

      await queue.send(message);

      expect(mockJetStream.publish).toHaveBeenCalledWith(
        mockConfig.subject,
        new TextEncoder().encode(message),
        { headers: mockHeaders }
      );
    });

    it('should send a message with options', async () => {
      const message = { id: 'test-message', data: 'test-data' };
      const options: QueueSendOptions = {
        contentType: 'application/json',
        delaySeconds: 10,
      };
      const publishAck = { stream: 'test-stream', seq: 123 };

      mockJetStream.publish.mockResolvedValue(publishAck);

      await queue.send(message, options);

      expect(mockHeaders.set).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockHeaders.set).toHaveBeenCalledWith('Nats-Delay-Seconds', '10');
    });

    it('should handle send errors', async () => {
      const message = { id: 'test-message', data: 'test-data' };
      const error = new Error('Publish failed');

      mockJetStream.publish.mockRejectedValue(error);

      await expect(queue.send(message)).rejects.toThrow('Publish failed');
    });

    it('should handle missing JetStream client', async () => {
      // Create a new queue and mock connect to not initialize JetStream
      queue = new NatsJetStreamQueue(mockConfig, 'test-queue');

      // Mock connect to not set up JetStream client
      const { connect } = vi.mocked(await import('nats'));
      connect.mockResolvedValue({
        ...mockConnection,
        jetstream: () => null, // Return null to simulate missing JetStream
      });

      const message = { id: 'test-message', data: 'test-data' };

      await expect(queue.send(message)).rejects.toThrow('JetStream client not initialized');
    });
  });

  describe('ensureStream', () => {
    beforeEach(async () => {
      await queue.connect();
    });

    it('should create stream if it does not exist', async () => {
      mockJetStreamManager.streams.info.mockRejectedValue(new Error('stream not found'));

      await queue.ensureStream();

      expect(mockJetStreamManager.streams.add).toHaveBeenCalledWith({
        name: mockConfig.stream,
        subjects: [mockConfig.subject],
        storage: 'file',
        retention: 'limits',
        max_msgs: 1000000,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
        discard: 'old',
      });
    });

    it('should skip creation if stream already exists', async () => {
      mockJetStreamManager.streams.info.mockResolvedValue({ name: mockConfig.stream });

      await queue.ensureStream();

      expect(mockJetStreamManager.streams.add).not.toHaveBeenCalled();
    });

    it('should handle stream creation errors', async () => {
      mockJetStreamManager.streams.info.mockRejectedValue(new Error('stream not found'));
      mockJetStreamManager.streams.add.mockRejectedValue(new Error('Creation failed'));

      await expect(queue.ensureStream()).rejects.toThrow('Creation failed');
    });

    it('should handle other stream info errors', async () => {
      mockJetStreamManager.streams.info.mockRejectedValue(new Error('Other error'));

      await expect(queue.ensureStream()).rejects.toThrow('Other error');
    });
  });

  describe('close', () => {
    it('should close the connection', async () => {
      await queue.connect();

      // Ensure connection is established and jetstream is initialized
      expect((queue as any).nc).toBeDefined();
      expect((queue as any).js).toBeDefined();

      // Close the connection
      await queue.close();

      // Check that the connection is closed
      expect(mockConnection.close).toHaveBeenCalled();
      expect((queue as any).nc).toBeNull();
      expect((queue as any).js).toBeNull();
    });

    it('should handle closing when not connected', async () => {
      await queue.close();

      // Check that the connection is closed
      expect(mockConnection.close).not.toHaveBeenCalled();
      expect((queue as any).nc).toBeNull();
      expect((queue as any).js).toBeNull();
    });

    it('should handle closing when connection is already closed', async () => {
      await queue.connect();
      mockConnection.isClosed.mockReturnValue(true);

      await queue.close();

      expect(mockConnection.close).not.toHaveBeenCalled();
    });
  });

  describe('getName', () => {
    it('should return the queue name', () => {
      expect(queue.getName()).toBe('test-queue');
    });
  });
});

describe('NatsJetStreamQueueProvider', () => {
  let provider: NatsJetStreamQueueProvider;
  let mockConfig: NatsConfig;
  let mockFactsConfig: NatsConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      endpoint: 'nats://localhost:4222',
      stream: 'DP1_WRITE_OPERATIONS',
      subject: 'dp1.write.operations',
    };

    mockFactsConfig = {
      endpoint: 'nats://localhost:4222',
      stream: 'DP1_FACTS_INGEST',
      subject: 'dp1.facts.ingest',
    };

    provider = new NatsJetStreamQueueProvider(mockConfig, mockFactsConfig);
  });

  describe('constructor', () => {
    it('should create a provider with the provided config', () => {
      expect(provider).toBeInstanceOf(NatsJetStreamQueueProvider);
    });
  });

  describe('getWriteQueue', () => {
    it('should return a NatsJetStreamQueue instance', () => {
      const queue = provider.getWriteQueue();

      expect(queue).toBeInstanceOf(NatsJetStreamQueue);
      expect(queue.getName()).toBe('DP1_WRITE_QUEUE');
    });

    it('should return the same queue instance on multiple calls', () => {
      const queue1 = provider.getWriteQueue();
      const queue2 = provider.getWriteQueue();

      expect(queue1).toBe(queue2);
    });
  });

  describe('initialize', () => {
    it('should initialize the queue provider by connecting and ensuring streams exist', async () => {
      const writeQueue = provider.getWriteQueue() as NatsJetStreamQueue;
      const factsQueue = provider.getFactsQueue() as NatsJetStreamQueue;
      const writeConnectSpy = vi.spyOn(writeQueue, 'connect').mockResolvedValue(undefined);
      const writeEnsureStreamSpy = vi.spyOn(writeQueue, 'ensureStream').mockResolvedValue(undefined);
      const factsConnectSpy = vi.spyOn(factsQueue, 'connect').mockResolvedValue(undefined);
      const factsEnsureStreamSpy = vi.spyOn(factsQueue, 'ensureStream').mockResolvedValue(undefined);

      await provider.initialize();

      expect(writeConnectSpy).toHaveBeenCalled();
      expect(writeEnsureStreamSpy).toHaveBeenCalled();
      expect(factsConnectSpy).toHaveBeenCalled();
      expect(factsEnsureStreamSpy).toHaveBeenCalled();
    });

    it('should handle connection errors during initialization', async () => {
      const queue = provider.getWriteQueue() as NatsJetStreamQueue;
      const error = new Error('Connection failed');
      vi.spyOn(queue, 'connect').mockRejectedValue(error);

      await expect(provider.initialize()).rejects.toThrow('Connection failed');
    });

    it('should handle stream creation errors during initialization', async () => {
      const queue = provider.getWriteQueue() as NatsJetStreamQueue;
      const connectSpy = vi.spyOn(queue, 'connect').mockResolvedValue(undefined);
      const error = new Error('Stream creation failed');
      vi.spyOn(queue, 'ensureStream').mockRejectedValue(error);

      await expect(provider.initialize()).rejects.toThrow('Stream creation failed');
    });
  });

  describe('close', () => {
    it('should close the queue', async () => {
      const queue = provider.getWriteQueue();
      const closeSpy = vi.spyOn(queue as any, 'close').mockResolvedValue(undefined);

      await provider.close();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle close errors', async () => {
      const queue = provider.getWriteQueue();
      const error = new Error('Close failed');
      vi.spyOn(queue as any, 'close').mockRejectedValue(error);

      await expect(provider.close()).rejects.toThrow('Close failed');
    });
  });

  describe('integration tests', () => {
    it('should work with the complete flow', async () => {
      const queue = provider.getWriteQueue() as NatsJetStreamQueue;
      const message = {
        id: 'test-message',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: { test: 'data' },
      };

      // Initialize the provider to establish connection
      const connectSpy = vi.spyOn(queue, 'connect').mockResolvedValue(undefined);
      const ensureStreamSpy = vi.spyOn(queue, 'ensureStream').mockResolvedValue(undefined);

      await provider.initialize();

      // Set up the JetStream client for sending
      (queue as any).js = {
        publish: vi.fn().mockResolvedValue({ stream: 'test-stream', seq: 123 }),
      };

      await queue.send(message);

      expect(connectSpy).toHaveBeenCalled();
      expect(ensureStreamSpy).toHaveBeenCalled();
      expect((queue as any).js.publish).toHaveBeenCalled();
    });

    it('should handle authentication in the complete flow', async () => {
      const configWithAuth = {
        ...mockConfig,
        username: 'test-user',
        password: 'test-pass',
      };
      const factsConfigWithAuth = {
        ...mockFactsConfig,
        username: 'test-user',
        password: 'test-pass',
      };
      const authProvider = new NatsJetStreamQueueProvider(configWithAuth, factsConfigWithAuth);
      const queue = authProvider.getWriteQueue() as NatsJetStreamQueue;

      // Initialize the provider to establish connection
      const connectSpy = vi.spyOn(queue, 'connect').mockResolvedValue(undefined);
      const ensureStreamSpy = vi.spyOn(queue, 'ensureStream').mockResolvedValue(undefined);

      await authProvider.initialize();

      // Set up the JetStream client for sending
      (queue as any).js = {
        publish: vi.fn().mockResolvedValue({ stream: 'test-stream', seq: 123 }),
      };

      await queue.send({ id: 'test', data: 'test' });

      expect(connectSpy).toHaveBeenCalled();
      expect(ensureStreamSpy).toHaveBeenCalled();
      expect((queue as any).js.publish).toHaveBeenCalled();
    });
  });
});
