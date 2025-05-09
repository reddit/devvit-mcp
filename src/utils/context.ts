import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { DocumentManagementService } from '../docs/store/DocumentManagementService';
import { logger } from './logger';

export class Context {
  private _dbPath!: string;
  _docsService!: DocumentManagementService;

  constructor() {}

  private async _downloadAndCacheDb(): Promise<string> {
    const dbUrl = 'https://raw.githubusercontent.com/reddit/devvit-mcp/main/db/devvit-docs.db';
    const tempDir = os.tmpdir();
    const tempDbPath = path.join(tempDir, 'devvit-docs.db');

    try {
      const response = await fetch(dbUrl);
      if (!response.ok) {
        throw new Error(`Failed to download DB: ${response.statusText}`);
      }
      const dbBuffer = await response.arrayBuffer();
      await fs.writeFile(tempDbPath, Buffer.from(dbBuffer));
      return tempDbPath;
    } catch (error) {
      logger.error('Error downloading or caching database:', error);
      throw error;
    }
  }

  async initialize() {
    this._dbPath = await this._downloadAndCacheDb();
    this._docsService = new DocumentManagementService(this._dbPath);
    await this._docsService.initialize();
  }

  async shutdown() {
    await this._docsService.shutdown();
    if (this._dbPath) {
      try {
        await fs.unlink(this._dbPath);
        logger.log(`Temporary database deleted: ${this._dbPath}`);
      } catch (error) {
        logger.error(`Error deleting temporary database ${this._dbPath}:`, error);
      }
    }
  }
}
