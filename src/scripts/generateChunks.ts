import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';
import { minimatch } from 'minimatch';
import PQueue from 'p-queue';
import archiver from 'archiver';
import { GreedySplitter } from '../docs/splitter/GreedySplitter';
import { SemanticMarkdownSplitter } from '../docs/splitter/SemanticMarkdownSplitter';
import { logger } from '../utils/logger';
import type { ContentChunk } from '../docs/splitter/types';
import { Document } from 'langchain/document';
import { embedDocuments } from '../utils/embeddings';

const execPromise = promisify(exec);

// Get current file's directory in ESM
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const PROJECT_ROOT = path.resolve(currentDir, '..', '..');
export const FIXTURES_DIR = path.join(PROJECT_ROOT, 'fixtures');

const queue = new PQueue({
  concurrency: 10,
});

/**
 * Configuration for the GitHub repository processing
 *
 * The file matching logic uses both include and exclude patterns with the following priority rules:
 * - Exclude patterns are checked first and take priority over include patterns
 * - Files matching ANY exclude pattern will be excluded, regardless of include patterns
 * - If a file is not excluded, it must match AT LEAST ONE include pattern to be processed
 * - Empty include patterns will result in no files being processed
 */
interface Config {
  /** GitHub repository URL (without https://github.com/ prefix) */
  repoUrl: string;
  /** Branch or commit to clone */
  branch: string;
  /** Path within the repository to process */
  pathInRepo: string;
  /**
   * Glob patterns to include (e.g., ["**\/*.md", "**\/*.mdx"])
   * Files must match at least one of these patterns to be processed
   */
  includePatterns: string[];
  /**
   * Glob patterns to exclude (e.g., ["**\/node_modules/**"])
   * Files matching any of these patterns will be excluded, regardless of include patterns
   */
  excludePatterns: string[];
  /** Whether to keep the temporary directory after processing */
  keepTempDir: boolean;
}

/** Configuration object for easy editing */
const config: Config = {
  repoUrl: 'reddit/devvit',
  branch: 'main',
  pathInRepo: 'devvit-docs',
  includePatterns: [
    '**/docs/**/*.md',
    '**/docs/**/*.mdx',
    '**/versioned_docs/**/*.md',
    '**/versioned_docs/**/*.mdx',
  ],
  excludePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    // I've found that these muddy up the search results
    '**/README.md',
    // May contain out of date information
    '**/docs/changelog.md',
  ],
  keepTempDir: false,
};

/**
 * Clone a GitHub repository to a temporary directory
 * @param repoUrl - The GitHub repository URL without the https://github.com/ prefix
 * @param branch - The branch or commit to clone
 * @returns A promise that resolves to the path of the temporary directory
 */
async function cloneRepo(repoUrl: string, branch: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-repo-'));
  logger.info(`Cloning repository ${repoUrl} on branch ${branch} to tmp...`);
  logger.verbose(`Cloning repository to ${tempDir}...`);

  try {
    await execPromise(
      `git clone --depth 1 --branch ${branch} https://github.com/${repoUrl}.git ${tempDir}`
    );
    return tempDir;
  } catch (error) {
    logger.error('Error cloning repository:', error);
    // Clean up temp directory on failure
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn('Error cleaning up temp directory:', cleanupError);
    }
    throw error;
  }
}

/**
 * Check if a file should be processed based on include and exclude patterns
 * @param filePath - The path of the file to check
 * @param includePatterns - Array of glob patterns to include
 * @param excludePatterns - Array of glob patterns to exclude
 * @returns True if the file should be processed, false otherwise
 *
 * @remarks
 * Priority rules:
 * 1. Exclude patterns take priority over include patterns
 * 2. If a file matches ANY exclude pattern, it will be excluded regardless of include patterns
 * 3. If a file is not excluded, it must match AT LEAST ONE include pattern to be processed
 * 4. If includePatterns is empty, no files will be processed
 * 5. If excludePatterns is empty, only the include patterns are considered
 */
function shouldProcessFile(
  filePath: string,
  includePatterns: string[],
  excludePatterns: string[]
): boolean {
  // PRIORITY 1: Check exclusions first - if file matches ANY exclude pattern, skip it
  if (excludePatterns.some((pattern) => minimatch(filePath, pattern))) {
    return false;
  }

  // PRIORITY 2: If not excluded, file must match AT LEAST ONE include pattern
  return (
    includePatterns.length > 0 && includePatterns.some((pattern) => minimatch(filePath, pattern))
  );
}

interface OutputPaths {
  outputBasePath: string;
  outputFilePath: string;
  outputChunksPath: string;
  outputEmbeddingsPath: string;
}

function calculateOutputPaths(filePath: string, basePath: string): OutputPaths {
  const relativePath = path.relative(basePath, filePath);
  const outputBasePath = path.join(FIXTURES_DIR, path.dirname(relativePath));
  const outputFilePath = path.join(outputBasePath, path.basename(filePath));
  const outputChunksPath = `${outputFilePath.split('.md')[0]}.chunks.json`;
  const outputEmbeddingsPath = `${outputFilePath.split('.md')[0]}.chunks.embeddings.json`;

  return {
    outputBasePath,
    outputFilePath,
    outputChunksPath,
    outputEmbeddingsPath,
  };
}

async function generateChunks(content: string): Promise<ContentChunk[]> {
  const minChunkSize = 1000;
  const maxChunkSize = 2000;
  const semanticSplitter = new SemanticMarkdownSplitter(maxChunkSize);
  const greedySplitter = new GreedySplitter(semanticSplitter, minChunkSize, maxChunkSize);
  const chunks = await greedySplitter.splitText(content);
  logger.verbose(`Generated ${chunks.length} chunks successfully`);
  return chunks;
}

async function generateEmbeddings(chunks: Document[]): Promise<number[][]> {
  const chunkContents = chunks.map((chunk) => chunk.pageContent);

  try {
    const embeddingsArray = await embedDocuments(chunkContents);
    if (embeddingsArray.length !== chunks.length) {
      throw new Error(
        `Embedding count mismatch: got ${embeddingsArray.length} embeddings for ${chunks.length} chunks`
      );
    }
    logger.verbose(`Generated ${embeddingsArray.length} embeddings successfully`);
    return embeddingsArray;
  } catch (error: unknown) {
    const embeddingError = error as Error;
    logger.error(`Error generating embeddings: ${embeddingError.message}`);
    // Create placeholder embeddings (empty arrays) to maintain the file structure
    return chunks.map(() => []);
  }
}

async function ensureParentDirExists(filePath: string): Promise<void> {
  const parentDir = path.dirname(filePath);
  await fs.mkdir(parentDir, { recursive: true });
}

async function saveOutputs(
  content: string,
  chunks: Document[],
  embeddingsArray: number[][],
  paths: OutputPaths
): Promise<void> {
  if (chunks.length !== embeddingsArray.length) {
    throw new Error(
      `Alignment error: ${chunks.length} chunks but ${embeddingsArray.length} embeddings`
    );
  }

  // Create base output directory
  await fs.mkdir(paths.outputBasePath, { recursive: true });

  // Ensure parent directories exist and write files
  await ensureParentDirExists(paths.outputFilePath);
  await fs.writeFile(paths.outputFilePath, content);
  logger.verbose(`Original file saved to: ${paths.outputFilePath}`);

  await ensureParentDirExists(paths.outputChunksPath);
  await fs.writeFile(paths.outputChunksPath, JSON.stringify(chunks, null, 2));
  logger.verbose(`Chunks saved to: ${paths.outputChunksPath}`);

  await ensureParentDirExists(paths.outputEmbeddingsPath);
  await fs.writeFile(paths.outputEmbeddingsPath, JSON.stringify(embeddingsArray, null, 2));
  logger.verbose(`Embeddings saved to: ${paths.outputEmbeddingsPath}`);
}

/**
 * Process a single file
 */
async function processFile(filePath: string, basePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(basePath, filePath);

    const paths = calculateOutputPaths(filePath, basePath);
    const chunks = (await generateChunks(content)).map(
      (chunk): Document => ({
        pageContent: `<path>${chunk.section.path.join(', ')}</path>\n${chunk.content}`,
        metadata: {
          type: chunk.types,
          ...chunk.section,
        },
      })
    );

    const embeddingsArray = await generateEmbeddings(chunks);
    await saveOutputs(content, chunks, embeddingsArray, paths);
    logger.info(`Processed file: ${relativePath} - chunks: ${chunks.length}`);
  } catch (error) {
    logger.error(`Error processing file ${filePath}:`, error);
  }
}

/**
 * Recursively process files in a directory
 * @param dirPath - The path of the directory to process
 * @param includePatterns - Array of glob patterns to include
 * @param excludePatterns - Array of glob patterns to exclude
 * @param basePath - Base path for calculating relative paths for glob matching
 */
async function processDirectory(
  dirPath: string,
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const promises: Promise<void>[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    // Calculate path relative to the base path for glob matching
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      // Don't check directory against patterns, just recurse into it
      // This allows files within a directory to be included even if the directory itself doesn't match
      promises.push(processDirectory(fullPath, includePatterns, excludePatterns, basePath));
    } else if (entry.isFile()) {
      if (shouldProcessFile(relativePath, includePatterns, excludePatterns)) {
        promises.push(queue.add(() => processFile(fullPath, basePath)));
      }
    }
  }

  await Promise.all(promises);
}

async function clearFixturesDirectory(): Promise<void> {
  try {
    await fs.rm(FIXTURES_DIR, { recursive: true, force: true });
    await fs.rm(path.join(PROJECT_ROOT, 'fixtures.tar.gz'), { force: true });
    logger.info('Cleared existing fixtures directory and archive');
  } catch (error) {
    // Ignore errors if directory doesn't exist
  }
}

/**
 * Main function to orchestrate the process
 */
async function main(): Promise<void> {
  let tempDir: string | null = null;

  try {
    await clearFixturesDirectory();

    // Clone the repository
    tempDir = await cloneRepo(config.repoUrl, config.branch);

    // Get the full path to process
    const pathToProcess = path.join(tempDir, config.pathInRepo);

    // Check if the path exists
    if (!fsSync.existsSync(pathToProcess)) {
      throw new Error(`Path '${config.pathInRepo}' not found in the repository.`);
    }

    logger.info(`Starting to process files...`);

    // Process the directory recursively
    await processDirectory(
      pathToProcess,
      config.includePatterns,
      config.excludePatterns,
      pathToProcess // Pass the base path for relative glob matching
    );

    // Wait for all queued tasks to complete
    await queue.onIdle();

    // Create a tar.gz archive of the fixtures directory
    await createTarGzArchive(FIXTURES_DIR, path.join(PROJECT_ROOT, 'fixtures.tar.gz'));

    logger.info('Processing completed successfully.');
  } catch (error) {
    logger.error('Error:', error);
    process.exit(1);
  } finally {
    // Clean up temp directory if needed
    if (tempDir && !config.keepTempDir) {
      logger.verbose(`Cleaning up temporary directory ${tempDir}...`);
      await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        logger.error('Error cleaning up temporary directory:', err);
      });
    }
  }
}

/**
 * Create a tar.gz archive of the fixtures directory using Node.js native methods
 * @param sourceDir - The directory to archive
 * @param outputPath - The output path for the archive
 */
async function createTarGzArchive(sourceDir: string, outputPath: string): Promise<void> {
  try {
    const output = fsSync.createWriteStream(outputPath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: {
        level: 9, // Maximum compression
      },
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    await archive.finalize();
  } catch (error) {
    logger.error('Error creating tar.gz archive:', error);
    throw error;
  }
}

// Run the script
void main()
  .then(() => {
    logger.info('Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Unhandled error in main execution:', error);
    process.exit(1);
  });
