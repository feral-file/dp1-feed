import { Hono } from 'hono';
import type { Env } from '../types';
import type { WriteOperationMessage } from '../queue/interfaces';
import { processWriteOperations } from '../queue/processor';
import { processFactsBatch } from '../queue/facts-processor';
import type { RegistryWebhookPayload } from './registry-webhook';

/**
 * Queue processing API routes for self-hosted deployment
 * These endpoints are called by the NATS consumer to process messages
 * They mimic the CloudFlare queue handler functionality
 */

const queues = new Hono<{ Variables: { env: Env } }>();

/**
 * Process a single write operation message
 * Called by the NATS consumer when a message is received
 */
queues.post('/process-message', async c => {
  try {
    const body = await c.req.json();
    const message = body as WriteOperationMessage;

    // Validate message structure
    if (!message.operation || !message.id || !message.timestamp) {
      return c.json(
        {
          error: 'invalid_message',
          message: 'Message must contain operation, id, and timestamp fields',
        },
        400
      );
    }

    // Process the message using the existing queue processor
    // Create a simple message batch with single message
    const messageBatch = {
      queue: 'dp1-write-operations',
      messages: [
        {
          id: message.id,
          timestamp: new Date(message.timestamp),
          body: message,
          attempts: message.retryCount || 0,
          ack: () => {}, // No-op for REST API
          retry: () => {}, // No-op for REST API
        },
      ],
      retryAll: () => {},
      ackAll: () => {},
    };

    const result = await processWriteOperations(messageBatch, c.var.env);

    return c.json({
      success: result.success,
      messageId: message.id,
      operation: message.operation,
      processedCount: result.processedCount,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error processing queue message:', error);
    return c.json(
      {
        error: 'processing_failed',
        message: 'Failed to process the message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Process multiple write operation messages in batch
 * Called by the NATS consumer when multiple messages are received
 */
queues.post('/process-batch', async c => {
  try {
    const body = await c.req.json();
    const messages = body.messages as WriteOperationMessage[];

    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json(
        {
          error: 'invalid_batch',
          message: 'Request must contain a non-empty array of messages',
        },
        400
      );
    }

    // Validate all messages
    for (const message of messages) {
      if (!message.operation || !message.id || !message.timestamp) {
        return c.json(
          {
            error: 'invalid_message',
            message: 'All messages must contain operation, id, and timestamp fields',
          },
          400
        );
      }
    }

    // Process the batch using the existing queue processor
    const messageBatch = {
      queue: 'dp1-write-operations',
      messages: messages.map(message => ({
        id: message.id,
        timestamp: new Date(message.timestamp),
        body: message,
        attempts: message.retryCount || 0,
        ack: () => {}, // No-op for REST API
        retry: () => {}, // No-op for REST API
      })),
      retryAll: () => {},
      ackAll: () => {},
    };

    const result = await processWriteOperations(messageBatch, c.var.env);

    return c.json({
      success: result.success,
      processedCount: result.processedCount,
      messageIds: messages.map(m => m.id),
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error processing queue batch:', error);
    return c.json(
      {
        error: 'batch_processing_failed',
        message: 'Failed to process the message batch',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { queues };

/**
 * Self-hosted endpoints for processing facts-ingest via HTTP
 */

// Process a single fact message
queues.post('/process-fact-message', async c => {
  try {
    const body = await c.req.json();
    // Expect shape: { id, timestamp, payload }
    const { id, timestamp, payload } = body as {
      id: string;
      timestamp: string;
      payload: RegistryWebhookPayload;
    };

    if (!id || !timestamp || !payload) {
      return c.json(
        {
          error: 'invalid_message',
          message: 'Message must contain id, timestamp and payload',
        },
        400
      );
    }

    const messageBatch = {
      queue: 'dp1-facts-ingest',
      messages: [
        {
          id,
          timestamp: new Date(timestamp),
          body: { payload },
          attempts: 0,
          ack: () => {},
          retry: () => {},
        },
      ],
      retryAll: () => {},
      ackAll: () => {},
    };

    const result = await processFactsBatch(messageBatch as any, c.var.env);

    return c.json({ success: result.success, processedCount: result.processedCount });
  } catch (error) {
    console.error('Error processing fact message:', error);
    return c.json(
      {
        error: 'processing_failed',
        message: 'Failed to process the fact message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Process multiple fact messages in batch
queues.post('/process-facts-batch', async c => {
  try {
    const body = await c.req.json();
    // Expect shape: { messages: Array<{ id, timestamp, payload }> }
    const { messages } = body as {
      messages: Array<{ id: string; timestamp: string; payload: RegistryWebhookPayload }>;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json(
        { error: 'invalid_batch', message: 'Request must contain a non-empty array of messages' },
        400
      );
    }

    for (const m of messages) {
      if (!m.id || !m.timestamp || !m.payload) {
        return c.json(
          { error: 'invalid_message', message: 'Each message must contain id, timestamp, payload' },
          400
        );
      }
    }

    const messageBatch = {
      queue: 'dp1-facts-ingest',
      messages: messages.map(m => ({
        id: m.id,
        timestamp: new Date(m.timestamp),
        body: { payload: m.payload },
        attempts: 0,
        ack: () => {},
        retry: () => {},
      })),
      retryAll: () => {},
      ackAll: () => {},
    };

    const result = await processFactsBatch(messageBatch as any, c.var.env);

    return c.json({ success: result.success, processedCount: result.processedCount });
  } catch (error) {
    console.error('Error processing facts batch:', error);
    return c.json(
      {
        error: 'batch_processing_failed',
        message: 'Failed to process the facts batch',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});
