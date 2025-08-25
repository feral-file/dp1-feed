import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  StringCodec,
  DeliverPolicy,
  AckPolicy,
  ReplayPolicy,
} from 'nats';
import fetch from 'node-fetch';

/**
 * API response interfaces for type safety
 */
interface ProcessingResult {
  success: boolean;
  processedCount: number;
  errors?: Array<{ messageId: string; error: string }>;
}

interface SingleMessageResponse extends ProcessingResult {
  messageId?: string;
  operation?: string;
}

interface BatchMessageResponse extends ProcessingResult {
  messageIds?: string[];
}

/**
 * Configuration interface for the NATS consumer
 */
interface ConsumerConfig {
  natsUrl: string;
  username?: string;
  password?: string;
  token?: string;
  streamName: string;
  subjectName: string;
  consumerName: string;
  serverUrl: string;
  apiSecret?: string;
  maxMessages?: number;
  batchSize?: number;
  ackWait?: number; // seconds
}

/**
 * Environment configuration from environment variables
 */
const config: ConsumerConfig = {
  natsUrl: process.env.NATS_URL || 'nats://localhost:4222',
  username: process.env.NATS_USERNAME,
  password: process.env.NATS_PASSWORD,
  token: process.env.NATS_TOKEN,
  streamName: process.env.NATS_STREAM_NAME || 'DP1_WRITE_OPERATIONS',
  subjectName: process.env.NATS_SUBJECT_NAME || 'dp1.write.operations',
  consumerName: process.env.NATS_CONSUMER_NAME || 'dp1-consumer',
  serverUrl: process.env.SERVER_URL || 'http://localhost:8787',
  apiSecret: process.env.API_SECRET,
  maxMessages: parseInt(process.env.NATS_MAX_MESSAGES || '100'),
  batchSize: parseInt(process.env.NATS_BATCH_SIZE || '1'),
  ackWait: parseInt(process.env.NATS_ACK_WAIT || '30'),
};

/**
 * NATS JetStream Consumer for DP-1 Write Operations
 * This service consumes messages from NATS JetStream and forwards them to the worker's internal API
 */
class NatsConsumer {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private running = false;
  private readonly sc = StringCodec();

  constructor(private config: ConsumerConfig) {}

  /**
   * Connect to NATS server
   */
  async connect(): Promise<void> {
    try {
      console.log(`Connecting to NATS server: ${this.config.natsUrl}`);

      const connectionOptions: any = {
        servers: [this.config.natsUrl],
        name: 'dp1-feed-consumer',
        reconnect: true,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 5000,
      };

      // Add authentication if provided
      if (this.config.token) {
        connectionOptions.token = this.config.token;
      } else if (this.config.username && this.config.password) {
        connectionOptions.user = this.config.username;
        connectionOptions.pass = this.config.password;
      }

      this.nc = await connect(connectionOptions);
      this.js = this.nc.jetstream();

      console.log('Connected to NATS server successfully');

      // Setup connection event handlers
      this.nc.closed().then(err => {
        if (err) {
          console.error('NATS connection closed with error:', err);
        } else {
          console.log('NATS connection closed');
        }
      });
    } catch (error) {
      console.error('Failed to connect to NATS server:', error);
      throw error;
    }
  }

  /**
   * Ensure the consumer exists on the stream
   */
  async ensureConsumer(): Promise<void> {
    if (!this.js || !this.nc) {
      throw new Error('NATS connection or JetStream client not initialized');
    }

    try {
      // Check if consumer already exists using JetStream Manager
      const jsm = await this.nc.jetstreamManager();

      try {
        await jsm.consumers.info(this.config.streamName, this.config.consumerName);
        console.log(`Consumer ${this.config.consumerName} already exists`);
        return;
      } catch {
        // Consumer doesn't exist, create it
        console.log(`Creating consumer ${this.config.consumerName}`);
      }

      // Create consumer using JetStream Manager
      await jsm.consumers.add(this.config.streamName, {
        durable_name: this.config.consumerName,
        filter_subject: this.config.subjectName,
        deliver_policy: DeliverPolicy.New,
        ack_policy: AckPolicy.Explicit,
        ack_wait: (this.config.ackWait || 30) * 1000000000, // Convert to nanoseconds
        max_deliver: 3,
        replay_policy: ReplayPolicy.Instant,
      });

      console.log(`Consumer ${this.config.consumerName} created successfully`);
    } catch (error) {
      console.error('Failed to ensure consumer:', error);
      throw error;
    }
  }

  /**
   * Process a single message by sending it to the worker's internal API
   */
  async processMessage(messageData: any): Promise<SingleMessageResponse> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiSecret) {
        headers['Authorization'] = `Bearer ${this.config.apiSecret}`;
      }

      const response = await fetch(`${this.config.serverUrl}/queues/process-message`, {
        method: 'POST',
        headers,
        body: JSON.stringify(messageData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Worker API error: ${response.status} ${response.statusText} - ${errorText}`);
        return {
          success: false,
          processedCount: 0,
          errors: [
            {
              messageId: messageData.id,
              error: `API error: ${response.status} ${response.statusText}`,
            },
          ],
        };
      }

      const result = (await response.json()) as SingleMessageResponse;
      console.log(`Message processed successfully:`, result);

      return result;
    } catch (error) {
      console.error('Error calling worker API:', error);
      return {
        success: false,
        processedCount: 0,
        errors: [
          {
            messageId: messageData.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ],
      };
    }
  }

  /**
   * Process multiple messages in batch
   */
  async processBatch(messages: any[]): Promise<BatchMessageResponse> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiSecret) {
        headers['Authorization'] = `Bearer ${this.config.apiSecret}`;
      }

      const response = await fetch(`${this.config.serverUrl}/queues/process-batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Worker API batch error: ${response.status} ${response.statusText} - ${errorText}`
        );
        return {
          success: false,
          processedCount: 0,
          errors: messages.map(msg => ({
            messageId: msg.id,
            error: `API error: ${response.status} ${response.statusText}`,
          })),
        };
      }

      const result = (await response.json()) as BatchMessageResponse;
      console.log(`Batch processed successfully:`, result);

      return result;
    } catch (error) {
      console.error('Error calling worker API for batch:', error);
      return {
        success: false,
        processedCount: 0,
        errors: messages.map(msg => ({
          messageId: msg.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
      };
    }
  }

  /**
   * Start consuming messages from the stream
   */
  async startConsuming(): Promise<void> {
    if (!this.js) {
      throw new Error('JetStream client not initialized');
    }

    this.running = true;
    console.log(`Starting to consume messages from stream: ${this.config.streamName}`);

    try {
      const consumer = await this.js.consumers.get(
        this.config.streamName,
        this.config.consumerName
      );

      while (this.running) {
        try {
          // Fetch messages in batches
          const messages = await consumer.fetch({
            max_messages: this.config.batchSize,
            expires: 5000, // 5 seconds timeout
          });

          const messageData: any[] = [];
          const messageRefs: any[] = [];

          // Collect messages for batch processing
          for await (const message of messages) {
            try {
              const data = this.sc.decode(message.data);
              const parsedData = JSON.parse(data);

              // Ensure the message follows the WriteOperationMessage format
              if (!parsedData.operation || !parsedData.id || !parsedData.timestamp) {
                console.error('Invalid message format, missing required fields:', parsedData);
                message.nak();
                continue;
              }

              messageData.push(parsedData);
              messageRefs.push(message);
            } catch (parseError) {
              console.error('Error parsing message data:', parseError);
              message.nak(); // Negative acknowledgment
            }
          }

          // Process messages
          if (messageData.length > 0) {
            let success = false;
            let allErrors: Array<{ messageId: string; error: string }> = [];

            if (messageData.length === 1) {
              // Process single message
              const result = await this.processMessage(messageData[0]);
              success = result.success;
              allErrors = result.errors || [];
            } else {
              // Process batch
              const result = await this.processBatch(messageData);
              success = result.success;
              allErrors = result.errors || [];
            }

            // Acknowledge or reject messages based on processing result
            for (const messageRef of messageRefs) {
              if (success) {
                messageRef.ack();
              } else {
                messageRef.nak();
              }
            }

            console.log(
              `Processed ${messageData.length} message(s), success: ${success}, errors: ${allErrors.length}`
            );
            if (allErrors.length > 0) {
              console.error('Batch processing errors:', allErrors);
            }
          }
        } catch (fetchError) {
          if (!this.running) break; // Expected when stopping
          console.error('Error fetching messages:', fetchError);
          await new Promise(resolve => globalThis.setTimeout(resolve, 1000)); // Wait before retrying
        }
      }
    } catch (error) {
      console.error('Error in message consumption loop:', error);
      throw error;
    }
  }

  /**
   * Stop consuming messages
   */
  async stop(): Promise<void> {
    console.log('Stopping NATS consumer...');
    this.running = false;

    if (this.nc) {
      await this.nc.close();
      this.nc = null;
      this.js = null;
    }

    console.log('NATS consumer stopped');
  }

  /**
   * Get consumer info for monitoring
   */
  async getConsumerInfo(): Promise<any> {
    if (!this.nc) {
      throw new Error('NATS connection not initialized');
    }

    try {
      const jsm = await this.nc.jetstreamManager();
      return await jsm.consumers.info(this.config.streamName, this.config.consumerName);
    } catch (error) {
      console.error('Error getting consumer info:', error);
      throw error;
    }
  }
}

/**
 * Main function to start the consumer
 */
async function main() {
  console.log('DP-1 Feed NATS Consumer starting...');
  console.log('Configuration:', {
    natsUrl: config.natsUrl,
    streamName: config.streamName,
    subjectName: config.subjectName,
    consumerName: config.consumerName,
    workerUrl: config.serverUrl,
    batchSize: config.batchSize,
  });

  const consumer = new NatsConsumer(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await consumer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await consumer.stop();
    process.exit(0);
  });

  try {
    // Initialize consumer
    await consumer.connect();
    await consumer.ensureConsumer();

    // Start consuming messages
    await consumer.startConsuming();
  } catch (error) {
    console.error('Fatal error in consumer:', error);
    process.exit(1);
  }
}

// Start the consumer if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { NatsConsumer, type ConsumerConfig };
