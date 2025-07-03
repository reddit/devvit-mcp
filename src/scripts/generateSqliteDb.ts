import { DocumentManagementService } from '../docs/store/DocumentManagementService';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const PROJECT_ROOT = path.resolve(currentDir, '..', '..');
export const FIXTURES_DIR = path.join(PROJECT_ROOT, 'fixtures');

async function main(): Promise<void> {
  const outputDir = path.join(process.cwd(), 'db');
  const dbFileName = 'devvit-docs.db';
  const dbPath = path.join(outputDir, dbFileName);

  logger.info(`Starting script to generate SQLite DB at ${dbPath}`);

  // Ensure the output directory exists
  if (!fs.existsSync(outputDir)) {
    logger.info(`Output directory ${outputDir} does not exist. Creating...`);
    fs.mkdirSync(outputDir, { recursive: true });
    logger.info(`Output directory ${outputDir} created.`);
  } else {
    logger.info(`Output directory ${outputDir} already exists.`);
  }

  // Delete existing DB file to ensure a fresh build
  if (fs.existsSync(dbPath)) {
    logger.info(`Existing database file ${dbPath} found. Deleting...`);
    fs.unlinkSync(dbPath);
    logger.info(`Existing database file ${dbPath} deleted.`);
  }

  logger.info(`Creating new SQLite DB at: ${dbPath}`);
  const docManager = new DocumentManagementService(dbPath, FIXTURES_DIR);

  try {
    logger.info('Initializing database schema...');
    await docManager.initialize();
    logger.info('Database schema initialized successfully.');

    logger.info('Loading fixture documents (from ~/fixtures)...');
    // This assumes DocumentLoaderService is configured to find 'fixtures' at the project root
    await docManager.loadFixtureDocuments();
    logger.info('Fixture documents loaded successfully.');

    logger.info(`SQLite DB generation complete. Database available at: ${dbPath}`);
  } catch (error) {
    logger.error('An error occurred during database generation:', error);
    // process.exit(1); // Consider if a script error should halt CI/build processes
    throw error; // Re-throw to allow higher-level error handling or process exit
  } finally {
    logger.info('Shutting down DocumentManagementService...');
    await docManager.shutdown();
    logger.info('DocumentManagementService shut down successfully.');
  }
}

main()
  .then(() => {
    logger.info('Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Unhandled error in main execution:', error);
    process.exit(1);
  });
