import type {
  Env,
  WriteOperationMessage,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
  CreatePlaylistGroupMessage,
  UpdatePlaylistGroupMessage,
} from '../types';
import { savePlaylist, savePlaylistGroup } from '../storage';
import { MessageBatch } from '@cloudflare/workers-types';

/**
 * Process write operations from the queue
 */
export async function processWriteOperations(batch: MessageBatch, env: Env): Promise<void> {
  console.log(`Processing ${batch.messages.length} write operations`);

  for (const message of batch.messages) {
    try {
      const queueMessage = message.body as WriteOperationMessage;
      console.log(`Processing ${queueMessage.operation} operation with id ${queueMessage.id}`);

      switch (queueMessage.operation) {
        case 'create_playlist':
          await handleCreatePlaylist(queueMessage as CreatePlaylistMessage, env);
          break;
        case 'update_playlist':
          await handleUpdatePlaylist(queueMessage as UpdatePlaylistMessage, env);
          break;
        case 'create_playlist_group':
          await handleCreatePlaylistGroup(queueMessage as CreatePlaylistGroupMessage, env);
          break;
        case 'update_playlist_group':
          await handleUpdatePlaylistGroup(queueMessage as UpdatePlaylistGroupMessage, env);
          break;
        default:
          console.error(`Unknown operation: ${(queueMessage as any).operation}`);
          throw new Error(`Unknown operation: ${(queueMessage as any).operation}`);
      }

      // Acknowledge successful processing
      message.ack();
      console.log(
        `Successfully processed ${queueMessage.operation} operation with id ${queueMessage.id}`
      );
    } catch (error) {
      console.error('Error processing queue message:', error);

      // Retry logic - let Cloudflare Queue handle retries automatically
      // The message will be retried automatically based on queue configuration
      message.retry();
    }
  }
}

/**
 * Handle playlist creation
 */
async function handleCreatePlaylist(message: CreatePlaylistMessage, env: Env): Promise<void> {
  const { playlist } = message.data;

  const saved = await savePlaylist(playlist, env);
  if (!saved) {
    throw new Error(`Failed to save playlist ${playlist.id}`);
  }

  console.log(`Successfully saved playlist ${playlist.id} (${playlist.title})`);
}

/**
 * Handle playlist update
 */
async function handleUpdatePlaylist(message: UpdatePlaylistMessage, env: Env): Promise<void> {
  const { playlist } = message.data;

  const saved = await savePlaylist(playlist, env, true); // true for update
  if (!saved) {
    throw new Error(`Failed to update playlist ${playlist.id}`);
  }

  console.log(`Successfully updated playlist ${playlist.id} (${playlist.title})`);
}

/**
 * Handle playlist group creation
 */
async function handleCreatePlaylistGroup(
  message: CreatePlaylistGroupMessage,
  env: Env
): Promise<void> {
  const { playlistGroup } = message.data;

  const saved = await savePlaylistGroup(playlistGroup, env);
  if (!saved) {
    throw new Error(`Failed to save playlist group ${playlistGroup.id}`);
  }

  console.log(`Successfully saved playlist group ${playlistGroup.id} (${playlistGroup.title})`);
}

/**
 * Handle playlist group update
 */
async function handleUpdatePlaylistGroup(
  message: UpdatePlaylistGroupMessage,
  env: Env
): Promise<void> {
  const { playlistGroup } = message.data;

  const saved = await savePlaylistGroup(playlistGroup, env, true); // true for update
  if (!saved) {
    throw new Error(`Failed to update playlist group ${playlistGroup.id}`);
  }

  console.log(`Successfully updated playlist group ${playlistGroup.id} (${playlistGroup.title})`);
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
  try {
    await env.DP1_WRITE_QUEUE.send(message);
    console.log(`Queued ${message.operation} operation with id ${message.id}`);
  } catch (error) {
    console.error('Failed to queue write operation:', error);
    throw new Error('Failed to queue write operation');
  }
}
