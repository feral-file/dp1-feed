// Types imported via interfaces
import type {
  MessageBatch,
  QueueProcessor,
  Queue,
  WriteOperationMessage,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
  CreatePlaylistGroupMessage,
  UpdatePlaylistGroupMessage,
} from './interfaces';
import { StorageService } from '../storage/service';

/**
 * Queue processor service that handles write operations using storage abstractions
 */
export class QueueProcessorService implements QueueProcessor<WriteOperationMessage> {
  constructor(private storageService: StorageService) {}

  /**
   * Process a batch of write operation messages
   */
  async processBatch(batch: MessageBatch<WriteOperationMessage>, env?: any): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} write operations`);

    const promises = batch.messages.map(async message => {
      try {
        await this.processMessage(message.body, env);
        console.log(`Processed message ${message.id} successfully`);
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
        throw error;
      }
    });

    await Promise.all(promises);
    batch.ackAll();
  }

  /**
   * Process a single write operation message
   */
  private async processMessage(message: WriteOperationMessage, env?: any): Promise<void> {
    switch (message.operation) {
      case 'create_playlist':
        await this.handleCreatePlaylist(message as CreatePlaylistMessage);
        break;
      case 'update_playlist':
        await this.handleUpdatePlaylist(message as UpdatePlaylistMessage);
        break;
      case 'create_playlist_group':
        await this.handleCreatePlaylistGroup(message as CreatePlaylistGroupMessage, env);
        break;
      case 'update_playlist_group':
        await this.handleUpdatePlaylistGroup(message as UpdatePlaylistGroupMessage, env);
        break;
      default:
        throw new Error(`Unknown message operation: ${(message as any).operation}`);
    }
  }

  private async handleCreatePlaylist(message: CreatePlaylistMessage): Promise<void> {
    console.log(`Creating playlist ${message.data.playlist.id}`);
    await this.storageService.savePlaylist(message.data.playlist, false);
  }

  private async handleUpdatePlaylist(message: UpdatePlaylistMessage): Promise<void> {
    console.log(`Updating playlist ${message.data.playlist.id}`);
    await this.storageService.savePlaylist(message.data.playlist, true);
  }

  private async handleCreatePlaylistGroup(
    message: CreatePlaylistGroupMessage,
    env: any
  ): Promise<void> {
    console.log(`Creating playlist group ${message.data.playlistGroup.id}`);
    await this.storageService.savePlaylistGroup(message.data.playlistGroup, env, false);
  }

  private async handleUpdatePlaylistGroup(
    message: UpdatePlaylistGroupMessage,
    env: any
  ): Promise<void> {
    console.log(`Updating playlist group ${message.data.playlistGroup.id}`);
    await this.storageService.savePlaylistGroup(message.data.playlistGroup, env, true);
  }
}

/**
 * Queue service that provides high-level queue operations
 */
export class QueueService {
  constructor(private queue: Queue) {}

  /**
   * Generate a unique message ID for a write operation
   */
  generateMessageId(operation: string, resourceId: string): string {
    const timestamp = Date.now();
    return `${operation}:${resourceId}:${timestamp}`;
  }

  /**
   * Queue a write operation message
   */
  async queueWriteOperation(message: WriteOperationMessage): Promise<void> {
    const messageId = this.generateMessageId(message.operation, this.getResourceId(message));
    console.log(`Queueing write operation: ${messageId}`);

    try {
      await this.queue.send(message);
      console.log(`Queued ${message.operation} operation with id ${messageId}`);
    } catch (error) {
      console.error('Failed to queue write operation:', error);
      throw new Error('Failed to queue write operation');
    }
  }

  private getResourceId(message: WriteOperationMessage): string {
    switch (message.operation) {
      case 'create_playlist':
        return (message as CreatePlaylistMessage).data.playlist.id;
      case 'update_playlist':
        return (message as UpdatePlaylistMessage).data.playlist.id;
      case 'create_playlist_group':
        return (message as CreatePlaylistGroupMessage).data.playlistGroup.id;
      case 'update_playlist_group':
        return (message as UpdatePlaylistGroupMessage).data.playlistGroup.id;
      default:
        return 'unknown';
    }
  }
}
