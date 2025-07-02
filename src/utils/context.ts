import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { DocumentManagementService } from '../docs/store/DocumentManagementService';
import { logger } from './logger';
import { extract } from 'tar';

interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

export class Context {
  private _latestRelease!: GitHubRelease;
  private _dbPath!: string;
  private _fixturesPath!: string;
  _docsService!: DocumentManagementService;

  constructor() {}

  private async _getLatestRelease(): Promise<GitHubRelease> {
    const response = await fetch('https://api.github.com/repos/reddit/devvit-mcp/releases/latest');
    if (!response.ok) {
      throw new Error(`Failed to fetch latest release: ${response.statusText}`);
    }
    const release = await response.json();
    logger.log(`Using release: ${release.tag_name}`);
    return release;
  }

  private async _downloadAndCacheDb(release: GitHubRelease): Promise<string> {
    const tempDir = os.tmpdir();
    const tempDbPath = path.join(tempDir, 'devvit-docs.db');

    try {
      // Find the database file in the release assets
      const dbAsset = release.assets.find((asset) => asset.name === 'devvit-docs.db');
      if (!dbAsset) {
        throw new Error(`Database file not found in release ${release.tag_name}`);
      }

      // Download the database from the release
      const response = await fetch(dbAsset.browser_download_url);
      if (!response.ok) {
        throw new Error(`Failed to download DB from release: ${response.statusText}`);
      }

      const dbBuffer = await response.arrayBuffer();
      await fs.writeFile(tempDbPath, new Uint8Array(dbBuffer));
      logger.log(`Database downloaded from release ${release.tag_name} to: ${tempDbPath}`);
      return tempDbPath;
    } catch (error) {
      logger.error('Error downloading or caching database:', error);
      throw error;
    }
  }

  private async _downloadFixtures(release: GitHubRelease): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFixturesPath = path.join(tempDir, 'fixtures');

    try {
      // Find the fixtures archive in the release assets
      const fixturesAsset = release.assets.find((asset) => asset.name === 'fixtures.tar.gz');
      if (!fixturesAsset) {
        throw new Error(`Fixtures archive not found in release ${release.tag_name}`);
      }

      // Download the fixtures archive
      const response = await fetch(fixturesAsset.browser_download_url);
      if (!response.ok) {
        throw new Error(`Failed to download fixtures from release: ${response.statusText}`);
      }

      const archiveBuffer = await response.arrayBuffer();
      const archivePath = path.join(tempDir, fixturesAsset.name);
      await fs.writeFile(archivePath, new Uint8Array(archiveBuffer));

      // Extract the archive
      await this._extractTarGz(archivePath, tempFixturesPath);

      // Clean up the downloaded archive
      await fs.unlink(archivePath);

      logger.log(
        `Fixtures downloaded and extracted from release ${release.tag_name} to: ${tempFixturesPath}`
      );
      return tempFixturesPath;
    } catch (error) {
      logger.error('Error downloading or extracting fixtures:', error);
      throw error;
    }
  }

  private async _extractTarGz(archivePath: string, extractPath: string): Promise<void> {
    try {
      // Create the extraction directory if it doesn't exist
      await fs.mkdir(extractPath, { recursive: true });
      await extract({
        file: archivePath,
        cwd: extractPath,
      });
      logger.log(`Successfully extracted archive to: ${extractPath}`);
    } catch (error) {
      logger.error('Error extracting tar.gz:', error);
      throw error;
    }
  }

  async initialize() {
    this._latestRelease = await this._getLatestRelease();
    this._dbPath = await this._downloadAndCacheDb(this._latestRelease);
    this._fixturesPath = await this._downloadFixtures(this._latestRelease);
    this._docsService = new DocumentManagementService(this._dbPath, this._fixturesPath);
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
    if (this._fixturesPath) {
      try {
        await fs.rm(this._fixturesPath, { recursive: true });
        logger.log(`Temporary fixtures deleted: ${this._fixturesPath}`);
      } catch (error) {
        logger.error(`Error deleting temporary fixtures ${this._fixturesPath}:`, error);
      }
    }
  }
}
