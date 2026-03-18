import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';

/**
 * File storage interface for static JSON files
 * Supports both Cloudflare R2 and local filesystem
 */
export interface FileStorage {
  /**
   * Read a file as string
   */
  read(filepath: string): Promise<string | null>;

  /**
   * Write a file with optional backup of existing file
   */
  write(filepath: string, content: string, options?: { backup?: boolean }): Promise<void>;

  /**
   * Check if a file exists
   */
  exists(filepath: string): Promise<boolean>;

  /**
   * Delete a file
   */
  delete(filepath: string): Promise<void>;

  /**
   * List backup files for a given filepath
   */
  listBackups(filepath: string): Promise<string[]>;
}

/**
 * Local filesystem implementation of FileStorage
 * For self-hosted deployments
 */
export class LocalFileStorage implements FileStorage {
  private basePath: string;

  constructor(basePath: string = './data/files') {
    this.basePath = basePath;
  }

  private resolvePath(filepath: string): string {
    // Remove leading slash if present
    const cleanPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;
    return path.join(this.basePath, cleanPath);
  }

  private async ensureDirectory(filepath: string): Promise<void> {
    const dir = path.dirname(filepath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async read(filepath: string): Promise<string | null> {
    try {
      const fullPath = this.resolvePath(filepath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(filepath: string, content: string, options?: { backup?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(filepath);
    await this.ensureDirectory(fullPath);

    // Create backup if requested and file exists
    if (options?.backup) {
      try {
        const existing = await fs.readFile(fullPath, 'utf-8');
        if (existing) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupPath = `${fullPath}.backup.${timestamp}`;
          await fs.writeFile(backupPath, existing, 'utf-8');
        }
      } catch (error: any) {
        // Ignore if file doesn't exist
        if (error.code !== 'ENOENT') {
          console.error('Failed to create backup:', error);
        }
      }
    }

    // Write the new content
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async exists(filepath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filepath);
      // Check if file exists using F_OK
      await fs.access(fullPath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(filepath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(filepath);
      await fs.unlink(fullPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async listBackups(filepath: string): Promise<string[]> {
    try {
      const fullPath = this.resolvePath(filepath);
      const dir = path.dirname(fullPath);
      const filename = path.basename(fullPath);

      const files = await fs.readdir(dir);
      return files
        .filter(f => f.startsWith(`${filename}.backup.`))
        .sort()
        .reverse(); // Most recent first
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

/**
 * Cloudflare R2 implementation of FileStorage
 * For serverless deployments
 */
export class R2FileStorage implements FileStorage {
  private bucket: any; // Using 'any' to avoid type conflicts between @cloudflare/workers-types versions

  constructor(bucket: any) {
    this.bucket = bucket;
  }

  private normalizeKey(filepath: string): string {
    // Remove leading slash if present
    return filepath.startsWith('/') ? filepath.slice(1) : filepath;
  }

  async read(filepath: string): Promise<string | null> {
    const key = this.normalizeKey(filepath);
    const object = await this.bucket.get(key);

    if (!object) {
      return null;
    }

    return await object.text();
  }

  async write(filepath: string, content: string, options?: { backup?: boolean }): Promise<void> {
    const key = this.normalizeKey(filepath);

    // Create backup if requested and file exists
    if (options?.backup) {
      const existing = await this.bucket.get(key);
      if (existing) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupKey = `${key}.backup.${timestamp}`;
        const existingContent = await existing.text();
        await this.bucket.put(backupKey, existingContent);
      }
    }

    // Write the new content
    await this.bucket.put(key, content, {
      httpMetadata: {
        contentType: 'application/json',
      },
    });
  }

  async exists(filepath: string): Promise<boolean> {
    const key = this.normalizeKey(filepath);
    const object = await this.bucket.head(key);
    return object !== null;
  }

  async delete(filepath: string): Promise<void> {
    const key = this.normalizeKey(filepath);
    await this.bucket.delete(key);
  }

  async listBackups(filepath: string): Promise<string[]> {
    const key = this.normalizeKey(filepath);
    const prefix = `${key}.backup.`;

    const listed = await this.bucket.list({ prefix });

    return listed.objects
      .map((obj: any) => obj.key)
      .sort()
      .reverse(); // Most recent first
  }
}
