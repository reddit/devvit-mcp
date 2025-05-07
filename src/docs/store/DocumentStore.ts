import type { Document } from '@langchain/core/documents';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { DocumentMetadata } from '../../types';
import { ConnectionError, StoreError } from './errors';
import { createTablesSQL } from './schema';
import { type DbDocument, type DbQueryResult, mapDbDocumentToDocument } from './types';
import { embedDocument } from '../../utils/embeddings';

interface RawSearchResult extends DbDocument {
  vec_score?: number;
  fts_score?: number;
}

interface RankedResult extends RawSearchResult {
  vec_rank?: number;
  fts_rank?: number;
  rrf_score: number;
}

/**
 * Manages document storage and retrieval using SQLite with vector and full-text search capabilities.
 * Provides direct access to SQLite with prepared statements to store and query document
 * embeddings along with their metadata. Supports versioned storage of documents for different
 * libraries, enabling version-specific document retrieval and searches.
 */
export class DocumentStore {
  private readonly db: DatabaseType;
  private statements!: {
    getById: Database.Statement;
    insertDocument: Database.Statement;
    insertEmbedding: Database.Statement;
    deleteDocuments: Database.Statement;
    queryVersions: Database.Statement;
    checkExists: Database.Statement;
    queryLibraryVersions: Database.Statement;
    getChildChunks: Database.Statement;
    getPrecedingSiblings: Database.Statement;
    getSubsequentSiblings: Database.Statement;
    getParentChunk: Database.Statement;
  };

  /**
   * Calculates Reciprocal Rank Fusion score for a result
   */
  private calculateRRF(vecRank?: number, ftsRank?: number, k = 60): number {
    let rrf = 0;
    if (vecRank !== undefined) {
      rrf += 1 / (k + vecRank);
    }
    if (ftsRank !== undefined) {
      rrf += 1 / (k + ftsRank);
    }
    return rrf;
  }

  /**
   * Assigns ranks to search results based on their scores
   */
  private assignRanks(results: RawSearchResult[]): RankedResult[] {
    // Create maps to store ranks
    const vecRanks = new Map<number, number>();
    const ftsRanks = new Map<number, number>();

    // Sort by vector scores and assign ranks
    results
      .filter((r) => r.vec_score !== undefined)
      .sort((a, b) => (a.vec_score ?? 0) - (b.vec_score ?? 0))
      .forEach((result, index) => {
        vecRanks.set(Number(result.id), index + 1);
      });

    // Sort by BM25 scores and assign ranks
    results
      .filter((r) => r.fts_score !== undefined)
      .sort((a, b) => (a.fts_score ?? 0) - (b.fts_score ?? 0))
      .forEach((result, index) => {
        ftsRanks.set(Number(result.id), index + 1);
      });

    // Combine results with ranks and calculate RRF
    return results.map((result) => ({
      ...result,
      vec_rank: vecRanks.get(Number(result.id))!,
      fts_rank: ftsRanks.get(Number(result.id))!,
      rrf_score: this.calculateRRF(
        vecRanks.get(Number(result.id))!,
        ftsRanks.get(Number(result.id))!
      ),
    }));
  }

  constructor(dbPath: string) {
    if (!dbPath) {
      throw new StoreError('Missing required database path');
    }

    // Only establish database connection in constructor
    this.db = new Database(dbPath);
  }

  /**
   * Sets up prepared statements for database queries
   */
  private prepareStatements(): void {
    const statements = {
      getById: this.db.prepare('SELECT * FROM documents WHERE id = ?'),
      insertDocument: this.db.prepare(
        'INSERT INTO documents (library, version, url, content, metadata, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      ),
      insertEmbedding: this.db.prepare<[number, string]>(
        'INSERT INTO documents_vec (rowid, library, version, embedding) VALUES (?, ?, ?, ?)'
      ),
      deleteDocuments: this.db.prepare('DELETE FROM documents WHERE library = ? AND version = ?'),
      queryVersions: this.db.prepare(
        'SELECT DISTINCT version FROM documents WHERE library = ? ORDER BY version'
      ),
      checkExists: this.db.prepare(
        'SELECT id FROM documents WHERE library = ? AND version = ? LIMIT 1'
      ),
      queryLibraryVersions: this.db.prepare(
        'SELECT DISTINCT library, version FROM documents ORDER BY library, version'
      ),
      getChildChunks: this.db.prepare(`
        SELECT * FROM documents 
        WHERE library = ? 
        AND version = ? 
        AND url = ?
        AND json_array_length(json_extract(metadata, '$.path')) = ?
        AND json_extract(metadata, '$.path') LIKE ? || '%'
        ORDER BY sort_order
        LIMIT ?
      `),
      getPrecedingSiblings: this.db.prepare(`
        SELECT * FROM documents 
        WHERE library = ? 
        AND version = ? 
        AND url = ?
        AND sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(metadata, '$.path') = ?
        ORDER BY sort_order DESC
        LIMIT ?
      `),
      getSubsequentSiblings: this.db.prepare(`
        SELECT * FROM documents 
        WHERE library = ? 
        AND version = ? 
        AND url = ?
        AND sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(metadata, '$.path') = ?
        ORDER BY sort_order
        LIMIT ?
      `),
      getParentChunk: this.db.prepare(`
        SELECT * FROM documents 
        WHERE library = ? 
        AND version = ? 
        AND url = ?
        AND json_extract(metadata, '$.path') = ?
        LIMIT 1
      `),
    };
    this.statements = statements;
  }

  /**
   * Escapes a query string for use with SQLite FTS5 MATCH operator.
   * Wraps the query in double quotes and escapes internal double quotes.
   */
  private escapeFtsQuery(query: string): string {
    // Escape internal double quotes by doubling them
    const escapedQuotes = query.replace(/"/g, '""');
    // Wrap the entire string in double quotes
    return `"${escapedQuotes}"`;
  }

  /**
   * Initializes database connection and ensures readiness
   */
  async initialize(): Promise<void> {
    try {
      // 1. Load extensions
      sqliteVec.load(this.db);

      // 2. Create schema
      this.db.exec(createTablesSQL);

      // 3. Initialize prepared statements
      this.prepareStatements();
    } catch (error) {
      throw new ConnectionError('Failed to initialize database connection', error);
    }
  }

  /**
   * Gracefully closes database connections
   */
  async shutdown(): Promise<void> {
    this.db.close();
  }

  /**
   * Retrieves all unique versions for a specific library
   */
  async queryUniqueVersions(library: string): Promise<string[]> {
    try {
      const rows = this.statements.queryVersions.all(library.toLowerCase()) as Array<
        Pick<DbDocument, 'version'>
      >;
      return rows.map((row) => row.version);
    } catch (error) {
      throw new ConnectionError('Failed to query versions', error);
    }
  }

  /**
   * Verifies existence of documents for a specific library version
   */
  async checkDocumentExists(library: string, version: string): Promise<boolean> {
    try {
      const result = this.statements.checkExists.get(library.toLowerCase(), version.toLowerCase());
      return result !== undefined;
    } catch (error) {
      throw new ConnectionError('Failed to check document existence', error);
    }
  }

  /**
   * Retrieves a mapping of all libraries to their available versions
   */
  async queryLibraryVersions(): Promise<Map<string, Set<string>>> {
    try {
      const rows = this.statements.queryLibraryVersions.all();
      const libraryMap = new Map<string, Set<string>>();
      for (const row of rows as { library: string; version: string }[]) {
        const library = row.library;
        const version = row.version;
        if (!libraryMap.has(library)) {
          libraryMap.set(library, new Set());
        }
        libraryMap.get(library)?.add(version);
      }
      return libraryMap;
    } catch (error) {
      throw new ConnectionError('Failed to query library versions', error);
    }
  }

  /**
   * Stores documents with library and version metadata, generating embeddings
   * for vector similarity search
   */
  async addDocuments(
    library: string,
    version: string,
    documents: Document[],
    embeddings: number[][]
  ): Promise<void> {
    try {
      // Insert documents in a transaction
      const transaction = this.db.transaction((docs: typeof documents) => {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const url = doc!.metadata.url as string;
          if (!url || typeof url !== 'string' || !url.trim()) {
            throw new StoreError('Document metadata must include a valid URL');
          }

          // Insert into main documents table
          const result = this.statements.insertDocument.run(
            library.toLowerCase(),
            version.toLowerCase(),
            url,
            doc!.pageContent,
            JSON.stringify(doc!.metadata),
            i
          );
          const rowId = result.lastInsertRowid;

          // Insert into vector table
          this.statements.insertEmbedding.run(
            BigInt(rowId),
            library.toLowerCase(),
            version.toLowerCase(),
            JSON.stringify(embeddings[i])
          );
        }
      });

      transaction(documents);
    } catch (error) {
      throw new ConnectionError('Failed to add documents to store', error);
    }
  }

  /**
   * Removes documents matching specified library and version
   * @returns Number of documents deleted
   */
  async deleteDocuments(library: string, version: string): Promise<number> {
    try {
      const result = this.statements.deleteDocuments.run(
        library.toLowerCase(),
        version.toLowerCase()
      );
      return result.changes;
    } catch (error) {
      throw new ConnectionError('Failed to delete documents', error);
    }
  }

  /**
   * Retrieves a document by its ID.
   * @param id The ID of the document.
   * @returns The document, or null if not found.
   */
  async getById(id: string): Promise<Document | null> {
    try {
      const row = this.statements.getById.get(id) as DbQueryResult<DbDocument>;
      if (!row) {
        return null;
      }

      return mapDbDocumentToDocument(row);
    } catch (error) {
      throw new ConnectionError(`Failed to get document by ID ${id}`, error);
    }
  }

  /**
   * Finds documents matching a text query using hybrid search.
   * Combines vector similarity search with full-text search using Reciprocal Rank Fusion.
   */
  async findByContent(
    library: string,
    version: string,
    query: string,
    limit: number
  ): Promise<Document[]> {
    try {
      const embedding = await embedDocument(query);
      const ftsQuery = this.escapeFtsQuery(query); // Escape the query for FTS

      const stmt = this.db.prepare(`
        WITH vec_scores AS (
          SELECT
            rowid as id,
            distance as vec_score
          FROM documents_vec
          WHERE library = ?
            AND version = ?
            AND embedding MATCH ?
          ORDER BY vec_score
          LIMIT ?
        ),
        fts_scores AS (
          SELECT
            f.rowid as id,
            bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as fts_score
          FROM documents_fts f
          JOIN documents d ON f.rowid = d.rowid
          WHERE d.library = ?
            AND d.version = ?
            AND documents_fts MATCH ?
          ORDER BY fts_score
          LIMIT ?
        )
        SELECT
          d.id,
          d.content,
          d.metadata,
          COALESCE(1 / (1 + v.vec_score), 0) as vec_score,
          COALESCE(1 / (1 + f.fts_score), 0) as fts_score
        FROM documents d
        LEFT JOIN vec_scores v ON d.id = v.id
        LEFT JOIN fts_scores f ON d.id = f.id
        WHERE v.id IS NOT NULL OR f.id IS NOT NULL
      `);

      const rawResults = stmt.all(
        library.toLowerCase(),
        version.toLowerCase(),
        JSON.stringify(embedding),
        limit,
        library.toLowerCase(),
        version.toLowerCase(),
        ftsQuery, // Use the escaped query
        limit
      ) as RawSearchResult[];

      // Apply RRF ranking
      const rankedResults = this.assignRanks(rawResults);

      // Sort by RRF score and take top results
      const topResults = rankedResults.sort((a, b) => b.rrf_score - a.rrf_score).slice(0, limit);

      return topResults.map((row) => ({
        ...mapDbDocumentToDocument(row),
        metadata: {
          ...JSON.parse(row.metadata),
          score: row.rrf_score,
          vec_rank: row.vec_rank,
          fts_rank: row.fts_rank,
        },
      }));
    } catch (error) {
      throw new ConnectionError(`Failed to find documents by content with query "${query}"`, error);
    }
  }

  /**
   * Finds child chunks of a given document based on path hierarchy.
   */
  async findChildChunks(
    library: string,
    version: string,
    id: string,
    limit: number
  ): Promise<Document[]> {
    try {
      const parent = await this.getById(id);
      if (!parent) {
        return [];
      }

      const parentPath = (parent.metadata as DocumentMetadata).path ?? [];
      const parentUrl = (parent.metadata as DocumentMetadata).url;

      const result = this.statements.getChildChunks.all(
        library.toLowerCase(),
        version.toLowerCase(),
        parentUrl,
        parentPath.length + 1,
        JSON.stringify(parentPath),
        limit
      ) as Array<DbDocument>;

      return result.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(`Failed to find child chunks for ID ${id}`, error);
    }
  }

  /**
   * Finds preceding sibling chunks of a given document.
   */
  async findPrecedingSiblingChunks(
    library: string,
    version: string,
    id: string,
    limit: number
  ): Promise<Document[]> {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }

      const refMetadata = reference.metadata as DocumentMetadata;

      const result = this.statements.getPrecedingSiblings.all(
        library.toLowerCase(),
        version.toLowerCase(),
        refMetadata.url,
        id,
        JSON.stringify(refMetadata.path),
        limit
      ) as Array<DbDocument>;

      return result.reverse().map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(`Failed to find preceding sibling chunks for ID ${id}`, error);
    }
  }

  /**
   * Finds subsequent sibling chunks of a given document.
   */
  async findSubsequentSiblingChunks(
    library: string,
    version: string,
    id: string,
    limit: number
  ): Promise<Document[]> {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }

      const refMetadata = reference.metadata;

      const result = this.statements.getSubsequentSiblings.all(
        library.toLowerCase(),
        version.toLowerCase(),
        refMetadata.url,
        id,
        JSON.stringify(refMetadata.path),
        limit
      ) as Array<DbDocument>;

      return result.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(`Failed to find subsequent sibling chunks for ID ${id}`, error);
    }
  }

  /**
   * Finds the parent chunk of a given document.
   */
  async findParentChunk(library: string, version: string, id: string): Promise<Document | null> {
    try {
      const child = await this.getById(id);
      if (!child) {
        return null;
      }

      const childMetadata = child.metadata as DocumentMetadata;
      const path = childMetadata.path ?? [];
      const parentPath = path.slice(0, -1);

      if (parentPath.length === 0) {
        return null;
      }

      const result = this.statements.getParentChunk.get(
        library.toLowerCase(),
        version.toLowerCase(),
        childMetadata.url,
        JSON.stringify(parentPath)
      ) as DbQueryResult<DbDocument>;

      if (!result) {
        return null;
      }

      return mapDbDocumentToDocument(result);
    } catch (error) {
      throw new ConnectionError(`Failed to find parent chunk for ID ${id}`, error);
    }
  }
}
