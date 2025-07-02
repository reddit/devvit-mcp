import { DocumentStore } from './DocumentStore';
import { join } from 'path';
import { readFile, readdir } from 'fs/promises';
import { access } from 'fs/promises';
import type { Document } from '@langchain/core/documents';
import { logger } from '../../utils/logger';

type EmbeddingData = number[][];

export class DocumentLoaderService {
  private readonly store: DocumentStore;
  private readonly fixturesPath: string;

  constructor(store: DocumentStore, fixturesPath: string) {
    this.store = store;
    this.fixturesPath = fixturesPath;
  }

  private async readJsonFile<T>(path: string): Promise<T> {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async findChunkFiles(
    dir: string
  ): Promise<Array<{ chunks: string; embeddings: string; version: string }>> {
    const results: Array<{ chunks: string; embeddings: string; version: string }> = [];

    const walk = async (currentDir: string): Promise<void> => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.chunks.json')) {
          const baseName = entry.name.replace('.chunks.json', '');
          const embeddingsFile = join(currentDir, `${baseName}.chunks.embeddings.json`);

          if (await this.fileExists(embeddingsFile)) {
            const relativePath = fullPath.startsWith(this.fixturesPath + '/')
              ? fullPath.substring(this.fixturesPath.length + 1)
              : fullPath;

            let version = '';
            const versionMatch = relativePath.match(/^versioned_docs\/version-([\d.]+)\//);
            if (versionMatch && versionMatch[1]) {
              const versionParts = versionMatch[1].split('.');
              if (versionParts.length === 1 && versionParts[0]) {
                version = `${versionParts[0]}.0.0`;
              } else if (versionParts.length >= 2 && versionParts[0] && versionParts[1]) {
                version = `${versionParts[0]}.${versionParts[1]}.0`;
              } else {
                logger.warn(
                  `Could not parse version from '${versionMatch[1]}' in path '${fullPath}'`
                );
              }
            }

            results.push({
              chunks: fullPath,
              embeddings: embeddingsFile,
              version: version,
            });
          } else {
            logger.warn(`Warning: No embeddings file found for ${fullPath}`);
          }
        }
      }
    };

    await walk(dir);
    return results;
  }

  async loadFixtureDocuments(): Promise<void> {
    const library = 'devvit';

    logger.info(`Loading fixture documents for library: ${library}`);
    logger.info(`Fixtures directory: ${this.fixturesPath}`);

    const filePairs = await this.findChunkFiles(this.fixturesPath);
    logger.info(`Found ${filePairs.length} file pairs to load`);

    for (const { chunks: chunksPath, embeddings: embeddingsPath, version } of filePairs) {
      logger.verbose(`Loading document: ${chunksPath} with version: '${version || 'unversioned'}'`);
      const documents = await this.readJsonFile<Document[]>(chunksPath);
      const embeddingsData = await this.readJsonFile<EmbeddingData>(embeddingsPath);

      if (documents.length !== embeddingsData.length) {
        throw new Error(
          `Mismatch between chunks (${documents.length}) and embeddings (${embeddingsData.length}) in ${chunksPath}`
        );
      }

      const relativeChunksPath = chunksPath.startsWith(this.fixturesPath + '/')
        ? chunksPath.substring(this.fixturesPath.length + 1)
        : chunksPath;
      const slug = relativeChunksPath.replace(/\.chunks\.json$/, '');

      const documentsWithMetadata = documents.map((document) => ({
        ...document,
        metadata: {
          ...document.metadata,
          url: `https://developers.reddit.com/docs/${slug}`,
        },
      }));

      await this.store.addDocuments(library, version, documentsWithMetadata, embeddingsData);
    }
  }
}
