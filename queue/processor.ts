import type { Env } from '../types';
import type { MessageBatch, WriteOperationMessage } from './interfaces';
import { QueueProcessorService, QueueService } from './service';
import { StorageService } from '../storage/service';

/**
 * Create and configure the queue processor service from environment
 */
function createQueueProcessorService(env: Env): QueueProcessorService {
  const storageService = new StorageService(env.storageProvider);
  return new QueueProcessorService(storageService);
}

/**
 * Create and configure the queue service from environment
 */
function createQueueService(env: Env): QueueService {
  return new QueueService(env.queueProvider.getWriteQueue());
}

/**
 * Process write operations from the queue
 */
export async function processWriteOperations(batch: MessageBatch, env: Env): Promise<void> {
  const processorService = createQueueProcessorService(env);
  await processorService.processBatch(batch as MessageBatch<WriteOperationMessage>, env);
}

/**
 * Generate a unique message ID for queue operations
 */
export function generateMessageId(operation: string, resourceId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${operation}-${resourceId}-${timestamp}-${random}`;
}

/**
 * Queue a write operation for async processing
 */
export async function queueWriteOperation(message: WriteOperationMessage, env: Env): Promise<void> {
  const queueService = createQueueService(env);
  await queueService.queueWriteOperation(message);
}
