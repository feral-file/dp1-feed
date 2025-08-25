import { Hono } from 'hono';
import type { Env } from '../types';
import type { WriteOperationMessage } from '../queue/interfaces';
import { processWriteOperations } from '../queue/processor';

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
