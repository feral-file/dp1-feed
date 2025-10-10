// Generic queue message format (borrowed from CloudFlare but without dependency)
export interface QueueMessage {
  id: string;
  timestamp: string;
  operation: string;
  retryCount?: number;
}

export interface MessageBatch<T = unknown> {
  readonly queue: string;
  readonly messages: ReadonlyArray<{
    id: string;
    timestamp: Date;
    body: T;
    attempts: number;
    ack(): void;
    retry(): void;
  }>;
  retryAll(options?: { delaySeconds?: number }): void;
  ackAll(): void;
}

export interface QueueSendOptions {
  delaySeconds?: number;
  contentType?: string;
}

/**
 * Result of processing a batch of messages
 */
export interface ProcessingResult {
  success: boolean;
  processedCount: number;
  errors?: Array<{ messageId: string; error: string }>;
}

/**
 * Generic queue interface that abstracts the underlying queue implementation
 */
export interface Queue {
  /**
   * Send a message to the queue
   */
  send(message: any, options?: QueueSendOptions): Promise<void>;

  /**
   * Get the queue name/identifier
   */
  getName(): string;
}

/**
 * Queue provider interface that provides access to different queues
 */
export interface QueueProvider {
  /**
   * Get the write operations queue
   */
  getWriteQueue(): Queue;
}

/**
 * Queue processor interface for handling message batches
 */
export interface QueueProcessor<T = unknown> {
  /**
   * Process a batch of messages
   */
  processBatch(batch: MessageBatch<T>, env?: any): Promise<ProcessingResult>;
}

import { Playlist } from 'dp1-js';

// Write operation message types (borrowing CloudFlare format but generic)
export interface CreatePlaylistMessage extends QueueMessage {
  operation: 'create_playlist';
  data: {
    playlist: Playlist;
  };
}

export interface UpdatePlaylistMessage extends QueueMessage {
  operation: 'update_playlist';
  data: {
    playlistId: string;
    playlist: Playlist;
  };
}

export type WriteOperationMessage = CreatePlaylistMessage | UpdatePlaylistMessage;
