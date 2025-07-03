import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger';

// GitHub API types
interface GitHubRelease {
  id: number;
  tag_name: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
  created_at: string;
  updated_at: string;
  download_count: number;
  digest: string;
}

// Get current file's directory in ESM
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const PROJECT_ROOT = path.resolve(currentDir, '..', '..');

interface ContentHashInfo {
  fixturesHash: string;
  dbHash: string;
}

/**
 * Calculate SHA256 hash of a file
 */
async function calculateFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

/**
 * Get the latest release information from GitHub API
 */
async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const repo = process.env.GITHUB_REPOSITORY || 'reddit/devvit-mcp';

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable not set');
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'devvit-mcp-release-checker',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.info('No releases found in repository');
        return null;
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const release: GitHubRelease = await response.json();
    logger.info(`Latest release: ${release.tag_name} with ${release.assets.length} assets`);
    return release;
  } catch (error) {
    logger.warn('Could not get latest release from GitHub API:', error);
    return null;
  }
}

/**
 * Get the content hash from the latest release assets
 */
async function getLatestReleaseContentHash(): Promise<ContentHashInfo | null> {
  try {
    const latestRelease = await getLatestRelease();
    if (!latestRelease) {
      return null;
    }

    // Find the fixtures.tar.gz and devvit-docs.db assets
    const fixturesAsset = latestRelease.assets.find((asset) => asset.name === 'fixtures.tar.gz');
    const dbAsset = latestRelease.assets.find((asset) => asset.name === 'devvit-docs.db');

    if (!fixturesAsset || !dbAsset) {
      logger.warn('Required assets not found in latest release');
      return null;
    }

    // Grab hashes and remove the "sha256:" prefix
    const fixturesHash = fixturesAsset.digest.replace('sha256:', '');
    const dbHash = dbAsset.digest.replace('sha256:', '');

    return {
      fixturesHash,
      dbHash,
    };
  } catch (error) {
    logger.warn('Could not get latest release content hash:', error);
    return null;
  }
}

/**
 * Calculate hash of generated content
 */
async function calculateGeneratedContentHash(): Promise<ContentHashInfo> {
  try {
    const fixturesPath = path.join(PROJECT_ROOT, 'fixtures.tar.gz');
    const dbPath = path.join(PROJECT_ROOT, 'db', 'devvit-docs.db');

    // Check if files exist
    if (!fsSync.existsSync(fixturesPath)) {
      throw new Error('Fixtures archive does not exist');
    }
    if (!fsSync.existsSync(dbPath)) {
      throw new Error('SQLite database does not exist');
    }

    const fixturesHash = await calculateFileHash(fixturesPath);
    const dbHash = await calculateFileHash(dbPath);

    return {
      fixturesHash,
      dbHash,
    };
  } catch (error) {
    logger.error('Failed to calculate content hash:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Calculate hash of generated artifacts
    const generatedHashInfo = await calculateGeneratedContentHash();

    // Get the latest release content hash
    const latestHashInfo = await getLatestReleaseContentHash();

    if (latestHashInfo === null) {
      logger.info('No previous release found. Proceeding with new release.');
      process.exit(0); // Continue with release
    }

    if (
      generatedHashInfo.fixturesHash === latestHashInfo.fixturesHash &&
      generatedHashInfo.dbHash === latestHashInfo.dbHash
    ) {
      logger.info('Hashes match latest release. No new release needed.');
      process.exit(1); // Exit with error code to indicate no release needed
    } else {
      logger.info('Content hash differs from latest release. Proceeding with new release.');
      logger.info(`Generated Fixtures hash: ${generatedHashInfo.fixturesHash}`);
      logger.info(`Latest Fixtures hash   : ${latestHashInfo.fixturesHash}`);
      logger.info(`Generated DB hash      : ${generatedHashInfo.dbHash}`);
      logger.info(`Latest DB hash         : ${latestHashInfo.dbHash}`);

      // Identify which file(s) changed
      const changedFiles: string[] = [];
      if (generatedHashInfo.fixturesHash !== latestHashInfo.fixturesHash) {
        changedFiles.push('fixtures.tar.gz');
      }
      if (generatedHashInfo.dbHash !== latestHashInfo.dbHash) {
        changedFiles.push('db/devvit-docs.db');
      }
      if (changedFiles.length > 0) {
        logger.info(`Changed file(s) detected: ${changedFiles.join(', ')}`);
      } else {
        logger.info(
          'Unable to determine which file changed (hash mismatch but file hashes match).'
        );
      }

      process.exit(0); // Continue with release
    }
  } catch (error) {
    logger.error('Error in hashAndCompare:', error);
    process.exit(1);
  }
}

// Run the script
void main();
