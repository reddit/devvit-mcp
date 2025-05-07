import { Document } from '@langchain/core/documents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentRetrieverService } from './DocumentRetrieverService';
import { DocumentStore } from './DocumentStore';

vi.mock('./DocumentStore');
vi.mock('../utils/logger');

describe('DocumentRetrieverService', () => {
  let retrieverService: DocumentRetrieverService;
  let mockDocumentStore: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocumentStore = new DocumentStore('mock_connection_string'); // The constructor argument won't matter
    retrieverService = new DocumentRetrieverService(mockDocumentStore);
  });

  afterEach(() => {
    // Cleanup if needed
  });

  it('should return an empty array when no documents are found', async () => {
    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([]);

    const results = await retrieverService.search('test-lib', '1.0.0', 'query');
    expect(results).toEqual([]);
  });

  it('should retrieve and aggregate document content', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const parent = new Document({
      id: 'parent1',
      pageContent: 'Parent content',
      metadata: { url: 'url' },
    });
    const precedingSibling1 = new Document({
      id: 'sibling1',
      pageContent: 'Preceding sibling 1',
      metadata: { url: 'url' },
    });
    const child1 = new Document({
      id: 'child1',
      pageContent: 'Child 1 content',
      metadata: { url: 'url' },
    });
    const subsequentSibling1 = new Document({
      id: 'sibling2',
      pageContent: 'Subsequent sibling 1',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([
      precedingSibling1,
    ]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([child1]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([
      subsequentSibling1,
    ]);

    const results = await retrieverService.search(library, version, query);

    expect(mockDocumentStore.findByContent).toHaveBeenCalledWith(library, version, query, 10);
    expect(mockDocumentStore.findParentChunk).toHaveBeenCalledWith(library, version, 'doc1');
    expect(mockDocumentStore.findPrecedingSiblingChunks).toHaveBeenCalledWith(
      library,
      version,
      'doc1',
      2
    );
    expect(mockDocumentStore.findChildChunks).toHaveBeenCalledWith(library, version, 'doc1', 5);
    expect(mockDocumentStore.findSubsequentSiblingChunks).toHaveBeenCalledWith(
      library,
      version,
      'doc1',
      2
    );

    expect(results).toEqual([
      {
        content:
          'Parent content\n\nPreceding sibling 1\n\nInitial content\n\nChild 1 content\n\nSubsequent sibling 1',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should handle missing parent chunk', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const precedingSibling1 = new Document({
      id: 'sibling1',
      pageContent: 'Preceding sibling 1',
      metadata: { url: 'url' },
    });
    const child1 = new Document({
      id: 'child1',
      pageContent: 'Child 1 content',
      metadata: { url: 'url' },
    });
    const subsequentSibling1 = new Document({
      id: 'sibling2',
      pageContent: 'Subsequent sibling 1',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(null); // Mock missing parent
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([
      precedingSibling1,
    ]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([child1]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([
      subsequentSibling1,
    ]);

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content:
          'Preceding sibling 1\n\nInitial content\n\nChild 1 content\n\nSubsequent sibling 1',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should handle missing preceding siblings', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const parent = new Document({
      id: 'parent1',
      pageContent: 'Parent content',
      metadata: { url: 'url' },
    });
    const child1 = new Document({
      id: 'child1',
      pageContent: 'Child 1 content',
      metadata: { url: 'url' },
    });
    const subsequentSibling1 = new Document({
      id: 'sibling2',
      pageContent: 'Subsequent sibling 1',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([]); // Mock missing preceding siblings
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([child1]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([
      subsequentSibling1,
    ]);

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content: 'Parent content\n\nInitial content\n\nChild 1 content\n\nSubsequent sibling 1',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should handle missing child chunks', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const parent = new Document({
      id: 'parent1',
      pageContent: 'Parent content',
      metadata: { url: 'url' },
    });
    const precedingSibling1 = new Document({
      id: 'sibling1',
      pageContent: 'Preceding sibling 1',
      metadata: { url: 'url' },
    });
    const subsequentSibling1 = new Document({
      id: 'sibling2',
      pageContent: 'Subsequent sibling 1',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([
      precedingSibling1,
    ]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([]); // Mock missing children
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([
      subsequentSibling1,
    ]);

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content: 'Parent content\n\nPreceding sibling 1\n\nInitial content\n\nSubsequent sibling 1',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should handle missing subsequent siblings', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const parent = new Document({
      id: 'parent1',
      pageContent: 'Parent content',
      metadata: { url: 'url' },
    });
    const precedingSibling1 = new Document({
      id: 'sibling1',
      pageContent: 'Preceding sibling 1',
      metadata: { url: 'url' },
    });
    const child1 = new Document({
      id: 'child1',
      pageContent: 'Child 1 content',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([
      precedingSibling1,
    ]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([child1]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([]); // Mock missing subsequent siblings

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content: 'Parent content\n\nPreceding sibling 1\n\nInitial content\n\nChild 1 content',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should handle multiple initial results', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const initialResult1 = new Document({
      id: 'doc1',
      pageContent: 'Initial content 1',
      metadata: { url: 'url' },
    });
    const initialResult2 = new Document({
      id: 'doc2',
      pageContent: 'Initial content 2',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([
      initialResult1,
      initialResult2,
    ]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([]);

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content: 'Initial content 1',
        url: 'url',
        score: undefined,
      },
      {
        content: 'Initial content 2',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  it('should use the provided limit', async () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const query = 'test query';
    const limit = 5;
    const initialResult = new Document({
      id: 'doc1',
      pageContent: 'Initial content',
      metadata: { url: 'url' },
    });

    const parent = new Document({
      id: 'parent1',
      pageContent: 'Parent content',
      metadata: { url: 'url' },
    });
    const precedingSibling1 = new Document({
      id: 'sibling1',
      pageContent: 'Preceding sibling 1',
      metadata: { url: 'url' },
    });
    const child1 = new Document({
      id: 'child1',
      pageContent: 'Child 1 content',
      metadata: { url: 'url' },
    });
    const subsequentSibling1 = new Document({
      id: 'sibling2',
      pageContent: 'Subsequent sibling 1',
      metadata: { url: 'url' },
    });

    vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, 'findParentChunk').mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks').mockResolvedValue([
      precedingSibling1,
    ]);
    vi.spyOn(mockDocumentStore, 'findChildChunks').mockResolvedValue([child1]);
    vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks').mockResolvedValue([
      subsequentSibling1,
    ]);

    const results = await retrieverService.search(library, version, query, limit);

    expect(mockDocumentStore.findByContent).toHaveBeenCalledWith(library, version, query, limit); // Verify limit is passed to findByContent
    expect(results).toEqual([
      {
        content:
          'Parent content\n\nPreceding sibling 1\n\nInitial content\n\nChild 1 content\n\nSubsequent sibling 1',
        url: 'url',
        score: undefined,
      },
    ]);
  });

  // Test for optional version handling
  describe('Optional Version Handling', () => {
    const library = 'opt-lib';
    const query = 'optional query';
    const limit = 7;

    it('search should normalize null/undefined/empty version to empty string for store calls', async () => {
      // Mock store methods to prevent errors and allow checking calls
      const findByContentSpy = vi.spyOn(mockDocumentStore, 'findByContent').mockResolvedValue([]); // Return empty to simplify test
      vi.spyOn(mockDocumentStore, 'findParentChunk');
      vi.spyOn(mockDocumentStore, 'findPrecedingSiblingChunks');
      vi.spyOn(mockDocumentStore, 'findChildChunks');
      vi.spyOn(mockDocumentStore, 'findSubsequentSiblingChunks');

      // Test with null version
      await retrieverService.search(library, null, query, limit);
      expect(findByContentSpy).toHaveBeenCalledWith(library, '', query, limit);
      // We don't need to check other methods if findByContent returns empty,
      // but if it returned results, we'd check those calls too, e.g.:
      // expect(findParentChunkSpy).toHaveBeenCalledWith(library, "", expect.any(String));

      // Test with undefined version
      await retrieverService.search(library, undefined, query, limit);
      expect(findByContentSpy).toHaveBeenCalledWith(library, '', query, limit);

      // Test with empty string version
      await retrieverService.search(library, '', query, limit);
      expect(findByContentSpy).toHaveBeenCalledWith(library, '', query, limit);

      // Restore mocks if necessary, though clearAllMocks in beforeEach handles it
    });
  });
});
