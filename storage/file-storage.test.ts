import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalFileStorage, R2FileStorage } from './file-storage';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
  },
  constants: {
    F_OK: 0,
  },
}));

describe('LocalFileStorage', () => {
  let storage: LocalFileStorage;
  const testBasePath = './test-data';

  beforeEach(() => {
    storage = new LocalFileStorage(testBasePath);
    vi.clearAllMocks();
  });

  describe('read', () => {
    it('should read file successfully', async () => {
      const mockContent = '{"test": "data"}';
      (fs.readFile as any).mockResolvedValue(mockContent);

      const result = await storage.read('test.json');

      expect(result).toBe(mockContent);
      expect(fs.readFile).toHaveBeenCalledWith(path.join(testBasePath, 'test.json'), 'utf-8');
    });

    it('should return null if file does not exist', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      (fs.readFile as any).mockRejectedValue(error);

      const result = await storage.read('missing.json');

      expect(result).toBeNull();
    });

    it('should throw error for other read errors', async () => {
      const error = new Error('Permission denied');
      (fs.readFile as any).mockRejectedValue(error);

      await expect(storage.read('test.json')).rejects.toThrow('Permission denied');
    });
  });

  describe('write', () => {
    it('should write file successfully', async () => {
      (fs.mkdir as any).mockResolvedValue(undefined);
      (fs.writeFile as any).mockResolvedValue(undefined);

      await storage.write('test.json', 'content');

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(testBasePath, 'test.json'),
        'content',
        'utf-8'
      );
    });

    it('should create backup when requested', async () => {
      (fs.mkdir as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue('old content');
      (fs.writeFile as any).mockResolvedValue(undefined);

      await storage.write('test.json', 'new content', { backup: true });

      expect(fs.readFile).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(2); // backup + new file
    });

    it('should handle missing file when creating backup', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      (fs.mkdir as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockRejectedValue(error);
      (fs.writeFile as any).mockResolvedValue(undefined);

      await storage.write('test.json', 'content', { backup: true });

      expect(fs.writeFile).toHaveBeenCalledTimes(1); // Only new file, no backup
    });
  });

  describe('exists', () => {
    it('should return true if file exists', async () => {
      (fs.access as any).mockResolvedValue(undefined);

      const result = await storage.exists('test.json');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(
        expect.stringContaining('test.json'),
        expect.any(Number)
      );
    });

    it('should return false if file does not exist', async () => {
      (fs.access as any).mockRejectedValue(new Error('Not found'));

      const result = await storage.exists('missing.json');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete file successfully', async () => {
      (fs.unlink as any).mockResolvedValue(undefined);

      await storage.delete('test.json');

      expect(fs.unlink).toHaveBeenCalledWith(path.join(testBasePath, 'test.json'));
    });

    it('should handle missing file gracefully', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      (fs.unlink as any).mockRejectedValue(error);

      await expect(storage.delete('missing.json')).resolves.not.toThrow();
    });
  });

  describe('listBackups', () => {
    it('should list backup files', async () => {
      (fs.readdir as any).mockResolvedValue([
        'test.json.backup.2026-03-18T10-00-00-000Z',
        'test.json.backup.2026-03-18T09-00-00-000Z',
        'other.json',
      ]);

      const result = await storage.listBackups('test.json');

      expect(result).toEqual([
        'test.json.backup.2026-03-18T10-00-00-000Z',
        'test.json.backup.2026-03-18T09-00-00-000Z',
      ]);
    });

    it('should return empty array if directory does not exist', async () => {
      const error: any = new Error('Directory not found');
      error.code = 'ENOENT';
      (fs.readdir as any).mockRejectedValue(error);

      const result = await storage.listBackups('test.json');

      expect(result).toEqual([]);
    });
  });
});

describe('R2FileStorage', () => {
  let storage: R2FileStorage;
  let mockBucket: any;

  beforeEach(() => {
    mockBucket = {
      get: vi.fn(),
      put: vi.fn(),
      head: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };
    storage = new R2FileStorage(mockBucket);
  });

  describe('read', () => {
    it('should read file successfully', async () => {
      const mockObject = {
        text: vi.fn().mockResolvedValue('{"test": "data"}'),
      };
      mockBucket.get.mockResolvedValue(mockObject);

      const result = await storage.read('test.json');

      expect(result).toBe('{"test": "data"}');
      expect(mockBucket.get).toHaveBeenCalledWith('test.json');
    });

    it('should return null if file does not exist', async () => {
      mockBucket.get.mockResolvedValue(null);

      const result = await storage.read('missing.json');

      expect(result).toBeNull();
    });
  });

  describe('write', () => {
    it('should write file successfully', async () => {
      mockBucket.put.mockResolvedValue(undefined);

      await storage.write('test.json', 'content');

      expect(mockBucket.put).toHaveBeenCalledWith('test.json', 'content', {
        httpMetadata: {
          contentType: 'application/json',
        },
      });
    });

    it('should create backup when requested', async () => {
      const mockObject = {
        text: vi.fn().mockResolvedValue('old content'),
      };
      mockBucket.get.mockResolvedValue(mockObject);
      mockBucket.put.mockResolvedValue(undefined);

      await storage.write('test.json', 'new content', { backup: true });

      expect(mockBucket.get).toHaveBeenCalledWith('test.json');
      expect(mockBucket.put).toHaveBeenCalledTimes(2); // backup + new file
    });
  });

  describe('exists', () => {
    it('should return true if file exists', async () => {
      mockBucket.head.mockResolvedValue({ key: 'test.json' });

      const result = await storage.exists('test.json');

      expect(result).toBe(true);
    });

    it('should return false if file does not exist', async () => {
      mockBucket.head.mockResolvedValue(null);

      const result = await storage.exists('missing.json');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete file successfully', async () => {
      mockBucket.delete.mockResolvedValue(undefined);

      await storage.delete('test.json');

      expect(mockBucket.delete).toHaveBeenCalledWith('test.json');
    });
  });

  describe('listBackups', () => {
    it('should list backup files', async () => {
      mockBucket.list.mockResolvedValue({
        objects: [
          { key: 'test.json.backup.2026-03-18T10-00-00-000Z' },
          { key: 'test.json.backup.2026-03-18T09-00-00-000Z' },
        ],
      });

      const result = await storage.listBackups('test.json');

      expect(result).toEqual([
        'test.json.backup.2026-03-18T10-00-00-000Z',
        'test.json.backup.2026-03-18T09-00-00-000Z',
      ]);
    });
  });
});
