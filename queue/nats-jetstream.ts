import type { Queue, QueueProvider, QueueSendOptions } from './interfaces';
import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  headers,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
} from 'nats';

/**
 * Configuration for NATS JetStream connection
 */
export interface NatsConfig {
  endpoint: string;
  username?: string;
  password?: string;
  token?: string;
  stream: string;
  subject: string;
}

/**
 * NATS JetStream implementation of the Queue interface using native Node.js library
 * Compatible with Node.js runtime using the standard nats.js library
 */
export class NatsJetStreamQueue implements Queue {
  private config: NatsConfig;
  private name: string;
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;

  constructor(config: NatsConfig, name: string) {
    this.config = config;
    this.name = name;
  }

  /**
   * Establish native connection to NATS
   */
  public async connect(): Promise<void> {
    if (this.nc && !this.nc.isClosed()) {
      return; // Already connected
    }

    try {
      const connectionOptions: any = {
        servers: [this.config.endpoint],
        name: 'dp1-feed-queue',
        reconnect: true,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 5000,
      };

      // Add authentication
      if (this.config.token) {
        connectionOptions.token = this.config.token;
      } else if (this.config.username && this.config.password) {
        connectionOptions.user = this.config.username;
        connectionOptions.pass = this.config.password;
      }

      // Connect using native NATS connection
      this.nc = await connect(connectionOptions);

      // Initialize JetStream client
      this.js = this.nc.jetstream();

      console.log(`Connected to NATS: ${this.config.endpoint}`);

      // Setup connection event handlers
      this.nc.closed().then(err => {
        if (err) {
          console.error('NATS connection closed with error:', err);
        } else {
          console.log('NATS connection closed');
        }
      });
    } catch (error) {
      console.error('Failed to connect to NATS:', error);
      throw error;
    }
  }

  async send(message: any, options?: QueueSendOptions): Promise<void> {
    try {
      if (!this.js) {
        throw new Error('JetStream client not initialized');
      }

      // Prepare message data
      const messageData = typeof message === 'string' ? message : JSON.stringify(message);

      // Prepare headers
      const msgHeaders = headers();

      if (options?.contentType) {
        msgHeaders.set('Content-Type', options.contentType);
      }

      if (options?.delaySeconds) {
        msgHeaders.set('Nats-Delay-Seconds', options.delaySeconds.toString());
      }

      // Publish message to JetStream
      const publishAck = await this.js.publish(
        this.config.subject,
        new TextEncoder().encode(messageData),
        { headers: msgHeaders }
      );

      console.log(
        `Message published to NATS JetStream stream: ${publishAck.stream}, seq: ${publishAck.seq}`
      );
    } catch (error) {
      console.error('Error sending message to NATS JetStream:', error);
      throw error;
    }
  }

  getName(): string {
    return this.name;
  }

  /**
   * Create or update the stream if it doesn't exist
   * This should be called during initialization
   */
  async ensureStream(): Promise<void> {
    try {
      if (!this.nc) {
        throw new Error('NATS connection not established');
      }

      // Get JetStream manager
      const jsManager = await this.nc.jetstreamManager();

      // Check if stream exists
      try {
        await jsManager.streams.info(this.config.stream);
        console.log(`NATS JetStream stream ${this.config.stream} already exists`);
        return;
      } catch (error: any) {
        if (error.message?.includes('stream not found')) {
          // Stream doesn't exist, create it
          console.log(`Creating NATS JetStream stream: ${this.config.stream}`);
        } else {
          throw error;
        }
      }

      // Create stream configuration
      const streamConfig = {
        name: this.config.stream,
        subjects: [this.config.subject],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_msgs: 1000000,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
        discard: DiscardPolicy.Old,
      };

      await jsManager.streams.add(streamConfig);
      console.log(`NATS JetStream stream ${this.config.stream} created successfully`);
    } catch (error) {
      console.error('Error ensuring NATS JetStream stream:', error);
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.nc && !this.nc.isClosed()) {
      await this.nc.close();
      this.nc = null;
      this.js = null;
    }
  }
}

/**
 * NATS JetStream queue provider that provides access to NATS queues
 */
export class NatsJetStreamQueueProvider implements QueueProvider {
  private writeQueue: NatsJetStreamQueue;

  constructor(config: NatsConfig) {
    this.writeQueue = new NatsJetStreamQueue(config, 'DP1_WRITE_QUEUE');
  }

  getWriteQueue(): Queue {
    return this.writeQueue;
  }

  /**
   * Initialize the queue provider by ensuring streams exist
   */
  async initialize(): Promise<void> {
    await this.writeQueue.connect();
    await this.writeQueue.ensureStream();
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.writeQueue.close();
  }
}
