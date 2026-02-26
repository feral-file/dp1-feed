import type Database from 'better-sqlite3';
import type { Queue, QueueProvider, QueueSendOptions } from './interfaces';

/**
 * SQLite implementation of the Queue interface
 * Stores messages in a SQLite table and processes them in-process
 * Eliminates the need for NATS and a separate consumer process
 */
export class SqliteQueue implements Queue {
  private db: Database.Database;
  private name: string;
  private stmtInsert: Database.Statement;
  private stmtFetch: Database.Statement;
  private stmtMarkProcessed: Database.Statement;
  private stmtMarkFailed: Database.Statement;

  constructor(db: Database.Database, name: string) {
    this.db = db;
    this.name = name;

    // Create queue table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS write_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
        processed INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_error TEXT
      )
    `);

    // Create index for efficient polling
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_write_queue_pending
      ON write_queue (processed, queue_name, id)
      WHERE processed = 0
    `);

    this.stmtInsert = this.db.prepare(
      'INSERT INTO write_queue (queue_name, message) VALUES (?, ?)'
    );
    this.stmtFetch = this.db.prepare(
      'SELECT id, message, attempts FROM write_queue WHERE processed = 0 AND queue_name = ? ORDER BY id ASC LIMIT ?'
    );
    this.stmtMarkProcessed = this.db.prepare('UPDATE write_queue SET processed = 1 WHERE id = ?');
    this.stmtMarkFailed = this.db.prepare(
      'UPDATE write_queue SET attempts = attempts + 1, last_error = ?, processed = CASE WHEN attempts + 1 >= max_attempts THEN -1 ELSE 0 END WHERE id = ?'
    );
  }

  async send(message: any, _options?: QueueSendOptions): Promise<void> {
    const messageData = typeof message === 'string' ? message : JSON.stringify(message);
    this.stmtInsert.run(this.name, messageData);
  }

  getName(): string {
    return this.name;
  }

  /**
   * Fetch pending messages from the queue
   */
  fetchPending(limit: number = 10): Array<{ id: number; message: string; attempts: number }> {
    return this.stmtFetch.all(this.name, limit) as Array<{
      id: number;
      message: string;
      attempts: number;
    }>;
  }

  /**
   * Mark a message as successfully processed
   */
  markProcessed(id: number): void {
    this.stmtMarkProcessed.run(id);
  }

  /**
   * Mark a message as failed (increments attempts, marks dead after max)
   */
  markFailed(id: number, error: string): void {
    this.stmtMarkFailed.run(error, id);
  }
}

/**
 * SQLite queue provider with in-process message processing
 * Replaces both NATS JetStream and the separate consumer process
 */
export class SqliteQueueProvider implements QueueProvider {
  private writeQueue: SqliteQueue;
  private processingInterval: ReturnType<typeof globalThis.setInterval> | null = null;
  private processing = false;
  private serverUrl = '';
  private apiSecret = '';

  constructor(db: Database.Database) {
    this.writeQueue = new SqliteQueue(db, 'DP1_WRITE_QUEUE');
  }

  getWriteQueue(): Queue {
    return this.writeQueue;
  }

  /**
   * Start the in-process queue processor
   * Polls for pending messages and sends them to the server's queue processing endpoint
   */
  startProcessing(serverUrl: string, apiSecret: string, pollIntervalMs: number = 1000): void {
    this.serverUrl = serverUrl;
    this.apiSecret = apiSecret;

    console.log(`Starting SQLite queue processor (poll interval: ${pollIntervalMs}ms)`);

    this.processingInterval = globalThis.setInterval(async () => {
      if (this.processing) return; // Skip if still processing previous batch
      this.processing = true;

      try {
        await this.processPendingMessages();
      } catch (error) {
        console.error('Error in queue processing loop:', error);
      } finally {
        this.processing = false;
      }
    }, pollIntervalMs);
  }

  /**
   * Stop the queue processor
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      globalThis.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('SQLite queue processor stopped');
  }

  /**
   * Process all pending messages in the queue
   */
  private async processPendingMessages(): Promise<void> {
    const pending = this.writeQueue.fetchPending(10);
    if (pending.length === 0) return;

    for (const row of pending) {
      try {
        const messageData = JSON.parse(row.message);

        // Validate message structure
        if (!messageData.operation || !messageData.id || !messageData.timestamp) {
          console.error('Invalid message format, skipping:', row.id);
          this.writeQueue.markFailed(row.id, 'Invalid message format');
          continue;
        }

        // Call the server's queue processing endpoint (same as NATS consumer does)
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiSecret) {
          headers['Authorization'] = `Bearer ${this.apiSecret}`;
        }

        const response = await fetch(`${this.serverUrl}/queues/process-message`, {
          method: 'POST',
          headers,
          body: row.message,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Queue processing failed for message ${row.id}: ${response.status} - ${errorText}`
          );
          this.writeQueue.markFailed(row.id, `HTTP ${response.status}: ${errorText}`);
          continue;
        }

        const result = (await response.json()) as { success: boolean };
        if (result.success) {
          this.writeQueue.markProcessed(row.id);
        } else {
          this.writeQueue.markFailed(row.id, 'Processing returned success=false');
        }
      } catch (error) {
        console.error(`Error processing queue message ${row.id}:`, error);
        this.writeQueue.markFailed(
          row.id,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }
}
