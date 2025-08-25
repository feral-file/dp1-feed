import { type CloudFlareBindings, initializeCloudFlareEnv } from './env/cloudflare';
import { cloudflareEnvMiddleware } from './middleware/env-cloudflare';
import { createApp, createTestApp } from './app';
import { processWriteOperations } from './queue/processor';
import { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';

/**
 * DP-1 Feed Operator API Server - Cloudflare Worker Entry Point
 *
 * This is the entry point for Cloudflare Worker deployment.
 * It uses the shared app definition with CloudFlare-specific environment middleware.
 */

// Check if we're in test environment (vitest sets this global)
const isTest = typeof globalThis !== 'undefined' && 'vitest' in globalThis;

// Create appropriate app based on environment
const app = isTest
  ? createTestApp() // For tests, use test env middleware
  : createApp<CloudFlareBindings>(cloudflareEnvMiddleware); // For CF Worker

// Queue consumer for async write operations
async function queue(
  batch: MessageBatch,
  bindings: CloudFlareBindings,
  _ctx: ExecutionContext
): Promise<void> {
  const env = initializeCloudFlareEnv(bindings);

  try {
    const result = await processWriteOperations(batch, env);

    if (result.success) {
      // All messages processed successfully, acknowledge them
      batch.ackAll();
      console.log(`Successfully processed ${result.processedCount} messages`);
    } else {
      // Some messages failed, log errors and retry the batch
      console.error(
        `Batch processing failed: ${result.processedCount}/${batch.messages.length} messages processed`
      );
      if (result.errors) {
        result.errors.forEach(error => {
          console.error(`Message ${error.messageId} failed: ${error.error}`);
        });
      }
      // Retry the entire batch - CloudFlare will handle individual message retry logic
      batch.retryAll();
    }
  } catch (error) {
    console.error('Unexpected error processing queue batch:', error);
    // Retry on unexpected errors
    batch.retryAll();
  }
}

// Export for Cloudflare Workers/Tests
export default isTest ? app : { fetch: app.fetch, queue };
