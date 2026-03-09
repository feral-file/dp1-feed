import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteQueue, SqliteQueueProvider } from './sqlite-queue';

// Mock fetch globally
global.fetch = vi.fn();

describe('SqliteQueue', () => {
  let db: Database.Database;
  let queue: SqliteQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    queue = new SqliteQueue(db, 'test-queue');
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a SqliteQueue instance', () => {
      expect(queue).toBeInstanceOf(SqliteQueue);
    });

    it('should create the write_queue table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='write_queue'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should create the pending index', () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_write_queue_pending'"
        )
        .all();
      expect(indexes).toHaveLength(1);
    });

    it('should not fail if table already exists', () => {
      const queue2 = new SqliteQueue(db, 'test-queue');
      expect(queue2).toBeInstanceOf(SqliteQueue);
    });
  });

  describe('getName', () => {
    it('should return the queue name', () => {
      expect(queue.getName()).toBe('test-queue');
    });
  });

  describe('send', () => {
    it('should send an object message successfully', async () => {
      const message = { id: 'test-1', operation: 'create', timestamp: '2024-01-01T00:00:00Z' };

      await queue.send(message);

      const rows = db.prepare('SELECT * FROM write_queue').all() as Array<{
        id: number;
        queue_name: string;
        message: string;
        processed: number;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].queue_name).toBe('test-queue');
      expect(JSON.parse(rows[0].message)).toEqual(message);
      expect(rows[0].processed).toBe(0);
    });

    it('should send a string message successfully', async () => {
      const message = 'test-string-message';

      await queue.send(message);

      const rows = db.prepare('SELECT * FROM write_queue').all() as Array<{ message: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(message);
    });

    it('should send multiple messages', async () => {
      await queue.send({ id: '1', data: 'first' });
      await queue.send({ id: '2', data: 'second' });
      await queue.send({ id: '3', data: 'third' });

      const rows = db.prepare('SELECT * FROM write_queue').all();
      expect(rows).toHaveLength(3);
    });

    it('should set default values for new messages', async () => {
      await queue.send({ id: 'test' });

      const rows = db.prepare('SELECT * FROM write_queue').all() as Array<{
        processed: number;
        attempts: number;
        max_attempts: number;
      }>;
      expect(rows[0].processed).toBe(0);
      expect(rows[0].attempts).toBe(0);
      expect(rows[0].max_attempts).toBe(3);
    });

    it('should handle complex JSON messages', async () => {
      const message = {
        id: 'complex-1',
        operation: 'create_playlist',
        timestamp: '2024-01-01T00:00:00Z',
        data: {
          playlist: {
            title: 'Test Playlist 🎵',
            items: [{ source: 'https://example.com', duration: 30 }],
          },
        },
      };

      await queue.send(message);

      const rows = db.prepare('SELECT message FROM write_queue').all() as Array<{
        message: string;
      }>;
      expect(JSON.parse(rows[0].message)).toEqual(message);
    });
  });

  describe('fetchPending', () => {
    it('should fetch pending messages', async () => {
      await queue.send({ id: '1', data: 'first' });
      await queue.send({ id: '2', data: 'second' });

      const pending = queue.fetchPending(10);

      expect(pending).toHaveLength(2);
      expect(JSON.parse(pending[0].message)).toEqual({ id: '1', data: 'first' });
      expect(JSON.parse(pending[1].message)).toEqual({ id: '2', data: 'second' });
    });

    it('should respect the limit parameter', async () => {
      await queue.send({ id: '1' });
      await queue.send({ id: '2' });
      await queue.send({ id: '3' });

      const pending = queue.fetchPending(2);

      expect(pending).toHaveLength(2);
    });

    it('should return empty array when no pending messages', () => {
      const pending = queue.fetchPending(10);

      expect(pending).toHaveLength(0);
    });

    it('should not return processed messages', async () => {
      await queue.send({ id: '1' });
      await queue.send({ id: '2' });

      const pending1 = queue.fetchPending(10);
      queue.markProcessed(pending1[0].id);

      const pending2 = queue.fetchPending(10);
      expect(pending2).toHaveLength(1);
      expect(JSON.parse(pending2[0].message)).toEqual({ id: '2' });
    });

    it('should only return messages for this queue name', async () => {
      const otherQueue = new SqliteQueue(db, 'other-queue');

      await queue.send({ id: '1', queue: 'test' });
      await otherQueue.send({ id: '2', queue: 'other' });

      const testPending = queue.fetchPending(10);
      const otherPending = otherQueue.fetchPending(10);

      expect(testPending).toHaveLength(1);
      expect(otherPending).toHaveLength(1);
      expect(JSON.parse(testPending[0].message).queue).toBe('test');
      expect(JSON.parse(otherPending[0].message).queue).toBe('other');
    });

    it('should use default limit of 10', () => {
      // Insert 15 messages synchronously
      for (let i = 0; i < 15; i++) {
        db.prepare('INSERT INTO write_queue (queue_name, message) VALUES (?, ?)').run(
          'test-queue',
          JSON.stringify({ id: `${i}` })
        );
      }

      const pending = queue.fetchPending();

      expect(pending).toHaveLength(10);
    });

    it('should return messages in order by id', async () => {
      await queue.send({ id: '1' });
      await queue.send({ id: '2' });
      await queue.send({ id: '3' });

      const pending = queue.fetchPending(10);

      expect(pending[0].id).toBeLessThan(pending[1].id);
      expect(pending[1].id).toBeLessThan(pending[2].id);
    });
  });

  describe('markProcessed', () => {
    it('should mark a message as processed', async () => {
      await queue.send({ id: '1' });
      const pending = queue.fetchPending(10);

      queue.markProcessed(pending[0].id);

      const remaining = queue.fetchPending(10);
      expect(remaining).toHaveLength(0);
    });

    it('should only mark the specified message', async () => {
      await queue.send({ id: '1' });
      await queue.send({ id: '2' });

      const pending = queue.fetchPending(10);
      queue.markProcessed(pending[0].id);

      const remaining = queue.fetchPending(10);
      expect(remaining).toHaveLength(1);
    });
  });

  describe('markFailed', () => {
    it('should increment attempts on failure', async () => {
      await queue.send({ id: '1' });
      const pending = queue.fetchPending(10);

      queue.markFailed(pending[0].id, 'Test error');

      const rows = db
        .prepare('SELECT attempts, last_error FROM write_queue WHERE id = ?')
        .all(pending[0].id) as Array<{ attempts: number; last_error: string }>;
      expect(rows[0].attempts).toBe(1);
      expect(rows[0].last_error).toBe('Test error');
    });

    it('should keep message pending when under max attempts', async () => {
      await queue.send({ id: '1' });
      const pending = queue.fetchPending(10);

      queue.markFailed(pending[0].id, 'Error 1');

      const remaining = queue.fetchPending(10);
      expect(remaining).toHaveLength(1);
    });

    it('should mark as dead letter after max attempts', async () => {
      await queue.send({ id: '1' });
      const pending = queue.fetchPending(10);
      const msgId = pending[0].id;

      // Fail 3 times (max_attempts = 3)
      queue.markFailed(msgId, 'Error 1');
      queue.markFailed(msgId, 'Error 2');
      queue.markFailed(msgId, 'Error 3');

      // Should no longer appear in pending
      const remaining = queue.fetchPending(10);
      expect(remaining).toHaveLength(0);

      // Verify it's marked as dead letter (processed = -1)
      const rows = db
        .prepare('SELECT processed, attempts FROM write_queue WHERE id = ?')
        .all(msgId) as Array<{ processed: number; attempts: number }>;
      expect(rows[0].processed).toBe(-1);
      expect(rows[0].attempts).toBe(3);
    });

    it('should store the last error message', async () => {
      await queue.send({ id: '1' });
      const pending = queue.fetchPending(10);
      const msgId = pending[0].id;

      queue.markFailed(msgId, 'First error');
      queue.markFailed(msgId, 'Second error');

      const rows = db
        .prepare('SELECT last_error FROM write_queue WHERE id = ?')
        .all(msgId) as Array<{ last_error: string }>;
      expect(rows[0].last_error).toBe('Second error');
    });
  });
});

describe('SqliteQueueProvider', () => {
  let db: Database.Database;
  let provider: SqliteQueueProvider;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    db = new Database(':memory:');
    provider = new SqliteQueueProvider(db);
    mockFetch = global.fetch as any;
  });

  afterEach(() => {
    provider.stopProcessing();
    vi.useRealTimers();
    db.close();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a provider with the provided database', () => {
      expect(provider).toBeInstanceOf(SqliteQueueProvider);
    });
  });

  describe('getWriteQueue', () => {
    it('should return a SqliteQueue instance', () => {
      const queue = provider.getWriteQueue();

      expect(queue).toBeInstanceOf(SqliteQueue);
      expect(queue.getName()).toBe('DP1_WRITE_QUEUE');
    });

    it('should return the same queue instance on multiple calls', () => {
      const queue1 = provider.getWriteQueue();
      const queue2 = provider.getWriteQueue();

      expect(queue1).toBe(queue2);
    });
  });

  describe('startProcessing', () => {
    it('should start processing pending messages', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);

      // Advance timer to trigger processing
      await vi.advanceTimersByTimeAsync(150);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/queues/process-message',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-secret',
          }),
        })
      );
    });

    it('should mark messages as processed on success', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      // Verify message was processed
      const pending = (queue as SqliteQueue).fetchPending(10);
      expect(pending).toHaveLength(0);
    });

    it('should handle HTTP errors by marking message as failed', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      // Message should still be pending (retryable) but with incremented attempts
      const rows = db.prepare('SELECT attempts FROM write_queue').all() as Array<{
        attempts: number;
      }>;
      expect(rows[0].attempts).toBe(1);
    });

    it('should handle invalid message format', async () => {
      const queue = provider.getWriteQueue() as SqliteQueue;
      // Insert a message missing required fields directly
      await queue.send({ incomplete: true });

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      // Message should be marked failed for invalid format
      const rows = db.prepare('SELECT attempts, last_error FROM write_queue').all() as Array<{
        attempts: number;
        last_error: string;
      }>;
      expect(rows[0].last_error).toBe('Invalid message format');
    });

    it('should not process when already processing', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      // Make fetch slow to simulate in-progress processing
      mockFetch.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () => resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
              200
            )
          )
      );

      provider.startProcessing('http://localhost:8787', 'test-secret', 50);

      // First tick starts processing
      await vi.advanceTimersByTimeAsync(60);
      // Second tick should skip because still processing
      await vi.advanceTimersByTimeAsync(60);

      // Should only have been called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not call fetch when no pending messages', async () => {
      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle success=false response', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      const rows = db.prepare('SELECT attempts, last_error FROM write_queue').all() as Array<{
        attempts: number;
        last_error: string;
      }>;
      expect(rows[0].last_error).toBe('Processing returned success=false');
    });

    it('should handle fetch network errors', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockRejectedValue(new Error('Network error'));

      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      await vi.advanceTimersByTimeAsync(150);

      const rows = db.prepare('SELECT attempts, last_error FROM write_queue').all() as Array<{
        attempts: number;
        last_error: string;
      }>;
      expect(rows[0].last_error).toBe('Network error');
    });

    it('should send without Authorization header when apiSecret is empty', async () => {
      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      provider.startProcessing('http://localhost:8787', '', 100);
      await vi.advanceTimersByTimeAsync(150);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/queues/process-message',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('stopProcessing', () => {
    it('should stop the processing interval', async () => {
      provider.startProcessing('http://localhost:8787', 'test-secret', 100);
      provider.stopProcessing();

      const queue = provider.getWriteQueue();
      const validMessage = {
        id: 'test-1',
        operation: 'create',
        timestamp: '2024-01-01T00:00:00Z',
        data: {},
      };
      await queue.send(validMessage);

      await vi.advanceTimersByTimeAsync(500);

      // Should not have attempted to process after stopping
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle stopping when not started', () => {
      // Should not throw
      expect(() => provider.stopProcessing()).not.toThrow();
    });
  });
});
