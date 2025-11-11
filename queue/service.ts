// Types imported via interfaces
import type {
  MessageBatch,
  QueueProcessor,
  Queue,
  WriteOperationMessage,
  CreatePlaylistMessage,
  UpdatePlaylistMessage,
  FactOperationMessage,
  EndorsementStarMessage,
  ProcessingResult,
} from './interfaces';
import { StorageService } from '../storage/service';

/**
 * Base queue processor that handles batch processing boilerplate
 */
abstract class BaseQueueProcessor<T> implements QueueProcessor<T> {
  constructor(private readonly processorName: string) {}

  async processBatch(batch: MessageBatch<T>): Promise<ProcessingResult> {
    console.log(`Processing batch of ${batch.messages.length} ${this.processorName}`);

    const errors: Array<{ messageId: string; error: string }> = [];

    const promises = batch.messages.map(async message => {
      try {
        await this.processMessage(message.body);
        console.log(`Processed message ${message.id} successfully`);
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
        errors.push({
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    await Promise.all(promises);

    const processedCount = batch.messages.length - errors.length;
    const success = errors.length === 0;

    console.log(
      `Batch processing completed: ${processedCount}/${batch.messages.length} messages processed successfully`
    );

    return {
      success,
      processedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  protected abstract processMessage(message: T): Promise<void>;
}

/**
 * Queue processor service that handles write operations using storage abstractions
 */
export class QueueProcessorService
  extends BaseQueueProcessor<WriteOperationMessage>
  implements QueueProcessor<WriteOperationMessage>
{
  constructor(private storageService: StorageService) {
    super('write operations');
  }

  /**
   * Process a single write operation message
   */
  protected async processMessage(message: WriteOperationMessage): Promise<void> {
    switch (message.operation) {
      case 'create_playlist':
        await this.handleCreatePlaylist(message as CreatePlaylistMessage);
        break;
      case 'update_playlist':
        await this.handleUpdatePlaylist(message as UpdatePlaylistMessage);
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
}

/**
 * Queue processor service that handles fact operations using storage abstractions
 */
export class FactQueueProcessorService
  extends BaseQueueProcessor<FactOperationMessage>
  implements QueueProcessor<FactOperationMessage>
{
  constructor(private storageService: StorageService) {
    super('fact operations');
  }

  /**
   * Process a single fact operation message
   */
  protected async processMessage(message: FactOperationMessage): Promise<void> {
    if (message.operation === 'endorsement_star') {
      await this.handleEndorsementStar(message);
    } else {
      throw new Error(`Unknown message operation: ${(message as any).operation}`);
    }
  }

  private async handleEndorsementStar(message: EndorsementStarMessage): Promise<void> {
    if (!message.data?.payload) {
      throw new Error('Missing data.payload in message');
    }

    const payload = message.data.payload;

    if (!payload.subject || !payload.subject.ref) {
      throw new Error('Invalid payload: missing subject.ref');
    }

    // Only handle endorsement.star on playlist subjects
    if (payload.kind !== 'endorsement.star') {
      console.log(`Ignoring fact kind: ${payload.kind}`);
      return; // ignore other kinds for now
    }
    if (payload.subject.type !== 'playlist') {
      console.log(`Ignoring subject type: ${payload.subject.type}`);
      return; // ignore non-playlist subjects
    }

    const playlistId = payload.subject.ref;
    console.log(`Processing endorsement_star for playlist ${playlistId}`);

    await this.storageService.updatePlaylistStarStatus(playlistId, payload.status);
    console.log(`Star ${payload.status} for playlist ${playlistId}`);
    return;
  }
}

/**
 * Queue service that provides high-level queue operations
 */
export class QueueService {
  constructor(
    private writeQueue: Queue,
    private factsQueue?: Queue
  ) {}

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
    const messageId = this.generateMessageId(message.operation, this.getWriteResourceId(message));
    console.log(`Queueing write operation: ${messageId}`);

    try {
      await this.writeQueue.send(message);
      console.log(`Queued ${message.operation} operation with id ${messageId}`);
    } catch (error) {
      console.error('Failed to queue write operation:', error);
      throw new Error('Failed to queue write operation');
    }
  }

  /**
   * Queue a fact operation message
   */
  async queueFactOperation(message: FactOperationMessage): Promise<void> {
    if (!this.factsQueue) {
      throw new Error('Facts queue not configured');
    }

    const messageId = this.generateMessageId(message.operation, this.getFactResourceId(message));
    console.log(`Queueing fact operation: ${messageId}`);

    try {
      await this.factsQueue.send(message);
      console.log(`Queued ${message.operation} operation with id ${messageId}`);
    } catch (error) {
      console.error('Failed to queue fact operation:', error);
      throw new Error('Failed to queue fact operation');
    }
  }

  private getWriteResourceId(message: WriteOperationMessage): string {
    switch (message.operation) {
      case 'create_playlist':
        return (message as CreatePlaylistMessage).data.playlist.id;
      case 'update_playlist':
        return (message as UpdatePlaylistMessage).data.playlist.id;
      default:
        return 'unknown';
    }
  }

  private getFactResourceId(message: FactOperationMessage): string {
    switch (message.operation) {
      case 'endorsement_star':
        return message.data.payload.id.toString();
      default:
        return 'unknown';
    }
  }
}
