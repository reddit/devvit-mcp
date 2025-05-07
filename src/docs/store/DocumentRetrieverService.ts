import type { DocumentStore } from './DocumentStore';
import type { StoreSearchResult } from './types';

const CHILD_LIMIT = 5;
const SIBLING_LIMIT = 2;

export class DocumentRetrieverService {
  private documentStore: DocumentStore;

  constructor(documentStore: DocumentStore) {
    this.documentStore = documentStore;
  }

  /**
   * Searches for documents and expands the context around the matches.
   * @param library The library name.
   * @param version The library version.
   * @param query The search query.
   * @param version The library version (optional, defaults to searching documents without a version).
   * @param query The search query.
   * @param limit The optional limit for the initial search results.
   * @returns An array of strings representing the aggregated content of the retrieved chunks.
   */
  async search(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number
  ): Promise<StoreSearchResult[]> {
    // Normalize version: null/undefined becomes empty string, then lowercase
    const normalizedVersion = (version ?? '').toLowerCase();

    const initialResults = await this.documentStore.findByContent(
      library,
      normalizedVersion,
      query,
      limit ?? 10
    );

    const results: StoreSearchResult[] = [];

    for (const doc of initialResults) {
      const id = doc.id as string;
      let content = '';

      // Parent
      const parent = await this.documentStore.findParentChunk(library, normalizedVersion, id);
      if (parent) {
        content += `${parent.pageContent}\n\n`;
      }

      // Preceding Siblings
      const precedingSiblings = await this.documentStore.findPrecedingSiblingChunks(
        library,
        normalizedVersion,
        id,
        SIBLING_LIMIT
      );
      if (precedingSiblings.length > 0) {
        content += `${precedingSiblings.map((d) => d.pageContent).join('\n\n')}\n\n`;
      }

      // Initial Result
      content += `${doc.pageContent}`;

      // Child Chunks
      const childChunks = await this.documentStore.findChildChunks(
        library,
        normalizedVersion,
        id,
        CHILD_LIMIT
      );
      if (childChunks.length > 0) {
        content += `\n\n${childChunks.map((d) => d.pageContent).join('\n\n')}`;
      }

      // Subsequent Siblings
      const subsequentSiblings = await this.documentStore.findSubsequentSiblingChunks(
        library,
        normalizedVersion,
        id,
        SIBLING_LIMIT
      );
      if (subsequentSiblings.length > 0) {
        content += `\n\n${subsequentSiblings.map((d) => d.pageContent).join('\n\n')}`;
      }

      results.push({
        url: doc.metadata.url,
        content,
        score: doc.metadata.score,
      });
    }

    return results;
  }
}
