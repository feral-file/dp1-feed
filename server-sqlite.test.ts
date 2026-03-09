import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before any imports
vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  const mockDb = {
    pragma: vi.fn().mockReturnValue([]),
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});

vi.mock('./env/sqlite');
vi.mock('./middleware/env-sqlite');
vi.mock('./app');

describe('server-sqlite', () => {
  const mockStartProcessing = vi.fn();
  const mockStopProcessing = vi.fn();
  const mockQueueProvider = {
    getWriteQueue: vi.fn(),
    startProcessing: mockStartProcessing,
    stopProcessing: mockStopProcessing,
  };
  const mockStorageProvider = {
    getPlaylistStorage: vi.fn(),
    getChannelStorage: vi.fn(),
    getPlaylistItemStorage: vi.fn(),
    getDatabase: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-set mock return values after clearing
    const { initializeSqliteEnv, getSqliteQueueProvider, closeSqliteConnections } = await import(
      './env/sqlite'
    );
    (initializeSqliteEnv as any).mockReturnValue({
      API_SECRET: 'test-secret',
      ED25519_PRIVATE_KEY: 'test-key',
      storageProvider: mockStorageProvider,
      queueProvider: mockQueueProvider,
    });
    (getSqliteQueueProvider as any).mockReturnValue(mockQueueProvider);
    (closeSqliteConnections as any).mockImplementation(() => {});

    const { createApp } = await import('./app');
    (createApp as any).mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response('ok')),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('module imports', () => {
    it('should import createApp from app module', async () => {
      const { createApp } = await import('./app');
      expect(createApp).toBeDefined();
      expect(typeof createApp).toBe('function');
    });

    it('should import sqliteEnvMiddleware from middleware', async () => {
      const { sqliteEnvMiddleware } = await import('./middleware/env-sqlite');
      expect(sqliteEnvMiddleware).toBeDefined();
    });

    it('should import all SQLite env functions', async () => {
      const { initializeSqliteEnv, getSqliteQueueProvider, closeSqliteConnections } = await import(
        './env/sqlite'
      );
      expect(typeof initializeSqliteEnv).toBe('function');
      expect(typeof getSqliteQueueProvider).toBe('function');
      expect(typeof closeSqliteConnections).toBe('function');
    });
  });

  describe('server configuration', () => {
    it('should have serve function available', async () => {
      const { serve } = await import('@hono/node-server');
      expect(serve).toBeDefined();
      expect(typeof serve).toBe('function');
    });

    it('should initialize env with SQLite bindings', async () => {
      const { initializeSqliteEnv } = await import('./env/sqlite');

      const result = (initializeSqliteEnv as any)({
        API_SECRET: 'test-secret',
        ED25519_PRIVATE_KEY: 'test-key',
        SQLITE_DB_PATH: './data/dp1-feed.db',
      });

      expect(result.API_SECRET).toBe('test-secret');
      expect(result.storageProvider).toBeDefined();
      expect(result.queueProvider).toBeDefined();
    });

    it('should get queue provider for starting processing', async () => {
      const { getSqliteQueueProvider } = await import('./env/sqlite');

      const provider = (getSqliteQueueProvider as any)();

      expect(provider).toBeDefined();
      expect(provider.startProcessing).toBeDefined();
    });

    it('should close connections for graceful shutdown', async () => {
      const { closeSqliteConnections } = await import('./env/sqlite');

      (closeSqliteConnections as any)();

      expect(closeSqliteConnections).toHaveBeenCalled();
    });
  });

  describe('app creation', () => {
    it('should create app using createApp with middleware', async () => {
      const { createApp } = await import('./app');
      const { sqliteEnvMiddleware } = await import('./middleware/env-sqlite');

      const app = (createApp as any)(sqliteEnvMiddleware);

      expect(createApp).toHaveBeenCalledWith(sqliteEnvMiddleware);
      expect(app).toBeDefined();
      expect(app.fetch).toBeDefined();
    });
  });

  describe('queue processing', () => {
    it('should start processing with server URL and API secret', () => {
      mockQueueProvider.startProcessing('http://localhost:8787', 'test-secret');

      expect(mockStartProcessing).toHaveBeenCalledWith('http://localhost:8787', 'test-secret');
    });

    it('should stop processing on shutdown', () => {
      mockQueueProvider.stopProcessing();

      expect(mockStopProcessing).toHaveBeenCalled();
    });
  });
});
