import Database from 'better-sqlite3';
import type {
  KeyValueStorage,
  StorageProvider,
  KVListResult,
  KVListOptions,
  KVGetOptions,
} from './interfaces';

/**
 * Configuration for SQLite connection
 */
export interface SqliteConfig {
  dbPath: string; // Path to the SQLite database file (or ':memory:' for in-memory)
}

/**
 * SQLite implementation of the KeyValueStorage interface
 * Uses better-sqlite3 for synchronous, high-performance operations
 */
export class SqliteKVStorage implements KeyValueStorage {
  private db: Database.Database;
  private tableName: string;

  // Prepared statements for performance
  private stmtGet: Database.Statement;
  private stmtPut: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(db: Database.Database, tableName: string) {
    this.db = db;
    this.tableName = tableName;

    // Create table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Prepare frequently used statements
    this.stmtGet = this.db.prepare(`SELECT value FROM "${this.tableName}" WHERE key = ?`);
    this.stmtPut = this.db.prepare(
      `INSERT OR REPLACE INTO "${this.tableName}" (key, value) VALUES (?, ?)`
    );
    this.stmtDelete = this.db.prepare(`DELETE FROM "${this.tableName}" WHERE key = ?`);
  }

  async get(key: string, options?: KVGetOptions): Promise<string | null> {
    const row = this.stmtGet.get(key) as { value: string } | undefined;
    if (!row) return null;

    if (options?.type === 'json') {
      try {
        return JSON.parse(row.value);
      } catch (parseError) {
        console.error(`Error parsing JSON for key ${key}:`, parseError);
        throw parseError;
      }
    }

    return row.value;
  }

  async getMultiple(keys: string[], options?: KVGetOptions): Promise<Map<string, any>> {
    const resultMap = new Map<string, any>();
    if (keys.length === 0) return resultMap;

    // Use a single query with IN clause for efficiency
    const placeholders = keys.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT key, value FROM "${this.tableName}" WHERE key IN (${placeholders})`
    );
    const rows = stmt.all(...keys) as Array<{ key: string; value: string }>;

    for (const row of rows) {
      if (options?.type === 'json') {
        try {
          resultMap.set(row.key, JSON.parse(row.value));
        } catch (parseError) {
          console.error(`Error parsing JSON for ${row.key}:`, parseError);
          throw parseError;
        }
      } else {
        resultMap.set(row.key, row.value);
      }
    }

    return resultMap;
  }

  async put(key: string, value: string): Promise<void> {
    this.stmtPut.run(key, value);
  }

  /**
   * Bulk write using a SQLite transaction (atomic, very fast)
   * Returns empty array on success (SQLite transactions are all-or-nothing)
   */
  async putMultiple(entries: Array<{ key: string; value: string }>): Promise<string[]> {
    if (entries.length === 0) return [];

    if (entries.length === 1) {
      await this.put(entries[0]!.key, entries[0]!.value);
      return [];
    }

    const transaction = this.db.transaction((items: Array<{ key: string; value: string }>) => {
      for (const item of items) {
        this.stmtPut.run(item.key, item.value);
      }
    });

    try {
      transaction(entries);
      return [];
    } catch (error) {
      console.error('SQLite bulk put failed:', error);
      // SQLite transactions are atomic - all fail together
      return entries.map(e => e.key);
    }
  }

  async delete(key: string): Promise<void> {
    this.stmtDelete.run(key);
  }

  /**
   * Bulk delete using a SQLite transaction (atomic, very fast)
   * Returns empty array on success
   */
  async deleteMultiple(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    if (keys.length === 1) {
      await this.delete(keys[0]!);
      return [];
    }

    const transaction = this.db.transaction((deleteKeys: string[]) => {
      for (const key of deleteKeys) {
        this.stmtDelete.run(key);
      }
    });

    try {
      transaction(keys);
      return [];
    } catch (error) {
      console.error('SQLite bulk delete failed:', error);
      return keys;
    }
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix || '';
    const limit = options?.limit || 1000;

    let sql: string;
    let params: any[];

    if (options?.cursor) {
      // Cursor is the last key from the previous page; fetch keys after it
      sql = `SELECT key FROM "${this.tableName}" WHERE key LIKE ? AND key > ? ORDER BY key ASC LIMIT ?`;
      params = [`${prefix}%`, options.cursor, limit];
    } else {
      sql = `SELECT key FROM "${this.tableName}" WHERE key LIKE ? ORDER BY key ASC LIMIT ?`;
      params = [`${prefix}%`, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{ key: string }>;

    const keys = rows.map(row => {
      // Remove the prefix to match the KV interface behavior
      // (etcd does this too — the caller expects unprefixed keys when using prefix filter)
      return { name: row.key };
    });

    // Check if there are more results
    const hasMore = rows.length === limit;
    let cursor: string | undefined;

    if (hasMore && rows.length > 0) {
      cursor = rows[rows.length - 1]!.key;
    }

    return {
      keys,
      list_complete: !hasMore,
      cursor,
    };
  }
}

/**
 * SQLite storage provider that provides access to different namespaces as separate tables
 */
export class SqliteStorageProvider implements StorageProvider {
  private db: Database.Database;
  private playlistStorage: SqliteKVStorage;
  private channelStorage: SqliteKVStorage;
  private playlistItemStorage: SqliteKVStorage;

  constructor(config: SqliteConfig) {
    this.db = new Database(config.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    // Ensure foreign keys are enforced
    this.db.pragma('foreign_keys = ON');

    this.playlistStorage = new SqliteKVStorage(this.db, 'playlists');
    this.channelStorage = new SqliteKVStorage(this.db, 'channels');
    this.playlistItemStorage = new SqliteKVStorage(this.db, 'playlist_items');
  }

  getPlaylistStorage(): KeyValueStorage {
    return this.playlistStorage;
  }

  getChannelStorage(): KeyValueStorage {
    return this.channelStorage;
  }

  getPlaylistItemStorage(): KeyValueStorage {
    return this.playlistItemStorage;
  }

  /**
   * Get the underlying database instance (for queue provider to share)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
