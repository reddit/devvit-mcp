import type { Document } from '@langchain/core/documents';
import semver from 'semver';
import { GreedySplitter, SemanticMarkdownSplitter } from '../splitter';
import type { ContentChunk, DocumentSplitter } from '../splitter/types';
import { VersionNotFoundError } from '../../tools/errors';
import { logger } from '../../utils/logger';
import { DocumentRetrieverService } from './DocumentRetrieverService';
import { DocumentStore } from './DocumentStore';
import { StoreError } from './errors';
import type { FindVersionResult, LibraryVersion, StoreSearchResult } from './types';
import { DocumentLoaderService } from './DocumentLoaderService';
import { embedDocuments } from '../../utils/embeddings';

/**
 * Provides semantic search capabilities across different versions of library documentation.
 */
export class DocumentManagementService {
  private readonly store: DocumentStore;
  private readonly documentRetriever: DocumentRetrieverService;
  private readonly splitter: DocumentSplitter;
  private readonly documentLoader: DocumentLoaderService;

  /**
   * Normalizes a version string, converting null or undefined to an empty string
   * and converting to lowercase.
   */
  private normalizeVersion(version?: string | null): string {
    return (version ?? '').toLowerCase();
  }

  constructor(dbPath: string, fixturesPath: string) {
    this.store = new DocumentStore(dbPath);
    this.documentRetriever = new DocumentRetrieverService(this.store);
    this.documentLoader = new DocumentLoaderService(this.store, fixturesPath);
    const minChunkSize = 500;
    const maxChunkSize = 1500;
    const semanticSplitter = new SemanticMarkdownSplitter(maxChunkSize);
    const greedySplitter = new GreedySplitter(semanticSplitter, minChunkSize, maxChunkSize);

    this.splitter = greedySplitter;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async loadFixtureDocuments(): Promise<void> {
    await this.documentLoader.loadFixtureDocuments();
  }

  async shutdown(): Promise<void> {
    logger.info('🔌 Shutting down store manager');
    await this.store.shutdown();
  }

  /**
   * Returns a list of all available versions for a library.
   * Only returns versions that follow semver format.
   */
  async listVersions(library: string): Promise<LibraryVersion[]> {
    const versions = await this.store.queryUniqueVersions(library);
    return versions
      .filter((v) => semver.valid(v))
      .map((version) => ({
        version,
        indexed: true,
      }));
  }

  /**
   * Checks if documents exist for a given library and optional version.
   * If version is omitted, checks for documents without a specific version.
   */
  async exists(library: string, version?: string | null): Promise<boolean> {
    const normalizedVersion = this.normalizeVersion(version);
    return this.store.checkDocumentExists(library, normalizedVersion);
  }

  /**
   * Finds the most appropriate version of documentation based on the requested version.
   * When no target version is specified, returns the latest version.
   *
   * Version matching behavior:
   * - Exact versions (e.g., "18.0.0"): Matches that version or any earlier version
   * - X-Range patterns (e.g., "5.x", "5.2.x"): Matches within the specified range
   * - "latest" or no version: Returns the latest available version
   *
   * For documentation, we prefer matching older versions over no match at all,
   * since older docs are often still relevant and useful.
   * Also checks if unversioned documents exist for the library.
   */
  async findBestVersion(library: string, targetVersion?: string): Promise<FindVersionResult> {
    logger.info(
      `🔍 Finding best version for ${library}${targetVersion ? `@${targetVersion}` : ''}`
    );

    // Check if unversioned documents exist *before* filtering for valid semver
    const hasUnversioned = await this.store.checkDocumentExists(library, '');

    const validSemverVersions = (await this.listVersions(library)).filter((v) => v.indexed); // listVersions already filters for semver

    if (validSemverVersions.length === 0) {
      if (hasUnversioned) {
        logger.info(`ℹ️ Unversioned documents exist for ${library}`);
        return { bestMatch: null, hasUnversioned: true };
      }
      // Throw error only if NO versions (semver or unversioned) exist
      logger.warn(`⚠️ No valid versions found for ${library}`);
      throw new VersionNotFoundError(library, targetVersion ?? '', []);
    }

    const versionStrings = validSemverVersions.map((v) => v.version);
    let bestMatch: string | null = null;

    if (!targetVersion || targetVersion === 'latest') {
      bestMatch = semver.maxSatisfying(versionStrings, '*');
    } else {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (!versionRegex.test(targetVersion)) {
        logger.warn(`⚠️ Invalid target version format: ${targetVersion}`);
        // Don't throw yet, maybe unversioned exists
      } else {
        // Restore the previous logic with fallback
        let range = targetVersion;
        if (!semver.validRange(targetVersion)) {
          // If it's not a valid range (like '1.2' or '1'), treat it like a tilde range
          range = `~${targetVersion}`;
        } else if (semver.valid(targetVersion)) {
          // If it's an exact version, allow matching it OR any older version
          range = `${range} || <=${targetVersion}`;
        }
        // If it was already a valid range (like '1.x'), use it directly
        bestMatch = semver.maxSatisfying(versionStrings, range);
      }
    }

    if (bestMatch) {
      logger.info(`✅ Found best match version ${bestMatch} for ${library}@${targetVersion}`);
    } else {
      logger.warn(`⚠️ No matching semver version found for ${library}@${targetVersion}`);
    }

    // If no semver match found, but unversioned exists, return that info.
    // If a semver match was found, return it along with unversioned status.
    // If no semver match AND no unversioned, throw error.
    if (!bestMatch && !hasUnversioned) {
      throw new VersionNotFoundError(library, targetVersion ?? '', validSemverVersions);
    }

    return { bestMatch, hasUnversioned };
  }

  /**
   * Deletes all documents for a specific library and optional version.
   * If version is omitted, deletes documents without a specific version.
   * @deprecated Use removeAllDocuments instead.
   */
  async deleteStore(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    logger.info(`🗑️ Deleting store for ${library}@${normalizedVersion || '[no version]'}`);
    const count = await this.store.deleteDocuments(library, normalizedVersion);
    logger.info(`📊 Deleted ${count} documents`);
  }

  /**
   * Removes all documents for a specific library and optional version.
   * If version is omitted, removes documents without a specific version.
   */
  async removeAllDocuments(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    logger.info(
      `🗑️ Removing all documents from ${library}@${normalizedVersion || '[no version]'} store`
    );
    const count = await this.store.deleteDocuments(library, normalizedVersion);
    logger.info(`📊 Deleted ${count} documents`);
  }

  /**
   * Adds a document to the store, splitting it into smaller chunks for better search results.
   * Uses SemanticMarkdownSplitter to maintain markdown structure and content types during splitting.
   * Preserves hierarchical structure of documents and distinguishes between text and code segments.
   * If version is omitted, the document is added without a specific version.
   */
  async addDocument(
    library: string,
    version: string | null | undefined,
    document: Document
  ): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    const url = document.metadata.url as string;
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new StoreError('Document metadata must include a valid URL');
    }

    logger.info(`📚 Adding document: ${document.metadata.title}`);

    if (!document.pageContent.trim()) {
      throw new Error('Document content cannot be empty');
    }

    // Split document into semantic chunks
    const chunks = await this.splitter.splitText(document.pageContent);

    // Convert semantic chunks to documents
    const splitDocs = chunks.map((chunk: ContentChunk) => ({
      pageContent: chunk.content,
      metadata: {
        ...document.metadata,
        level: chunk.section.level,
        path: chunk.section.path,
      },
    }));
    logger.info(`📄 Split document into ${splitDocs.length} chunks`);

    const embeddingsData = await embedDocuments(splitDocs.map((doc) => doc.pageContent));

    // Add split documents to store
    await this.store.addDocuments(library, normalizedVersion, splitDocs, embeddingsData);
  }

  /**
   * Searches for documentation content across versions.
   * Uses hybrid search (vector + FTS).
   * If version is omitted, searches documents without a specific version.
   */
  async searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit = 5
  ): Promise<StoreSearchResult[]> {
    const normalizedVersion = this.normalizeVersion(version);
    return this.documentRetriever.search(library, normalizedVersion, query, limit);
  }

  async listLibraries(): Promise<
    Array<{
      library: string;
      versions: Array<{ version: string; indexed: boolean }>;
    }>
  > {
    const libraryMap = await this.store.queryLibraryVersions();
    return Array.from(libraryMap.entries()).map(([library, versions]) => ({
      library,
      // Filter out the internal empty string version before mapping
      versions: Array.from(versions)
        .filter((v) => v !== '')
        .map((version) => ({
          version,
          indexed: true,
        })),
    }));
  }
}
