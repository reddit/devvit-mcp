import { Document } from '@langchain/core/documents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionNotFoundError } from '../../tools/errors';
import { DocumentManagementService } from './DocumentManagementService';
import { StoreError } from './errors';

vi.mock('../utils/logger');

vi.mock('../../utils/embeddings', () => ({
  embedDocuments: vi
    .fn()
    .mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))),
  embedDocument: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// Mock document store and retriever
const mockStore = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  queryUniqueVersions: vi.fn(),
  checkDocumentExists: vi.fn(),
  queryLibraryVersions: vi.fn(),
  addDocuments: vi.fn(),
  deleteDocuments: vi.fn(),
};

const mockRetriever = {
  search: vi.fn(),
};

vi.mock('./DocumentStore', () => ({
  DocumentStore: vi.fn().mockImplementation(() => mockStore),
}));

vi.mock('./DocumentRetrieverService', () => ({
  DocumentRetrieverService: vi.fn().mockImplementation(() => mockRetriever),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DocumentManagementService', () => {
  let docService: DocumentManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    docService = new DocumentManagementService('db/devvit-docs.db', 'fixtures');
  });

  afterEach(async () => {
    await docService.shutdown();
  });

  it('should initialize correctly', async () => {
    await docService.initialize();
    expect(mockStore.initialize).toHaveBeenCalled();
  });

  it('should handle empty store existence check', async () => {
    mockStore.checkDocumentExists.mockImplementation((_lib, _ver) => Promise.resolve(false));
    const exists = await docService.exists('test-lib', '1.0.0');
    expect(exists).toBe(false);
  });

  describe('document processing', () => {
    it('should add and search documents with basic metadata', async () => {
      const library = 'test-lib';
      const version = '1.0.0';
      const validDocument = new Document({
        pageContent: 'Test document content about testing',
        metadata: {
          url: 'http://example.com',
          title: 'Test Doc',
        },
      });

      const documentNoUrl = new Document({
        pageContent: 'Test document without URL',
        metadata: {
          title: 'Test Doc',
        },
      });

      // Should fail when URL is missing
      await expect(docService.addDocument(library, version, documentNoUrl)).rejects.toThrow(
        StoreError
      );

      await expect(docService.addDocument(library, version, documentNoUrl)).rejects.toHaveProperty(
        'message',
        'Document metadata must include a valid URL'
      );

      // Should succeed with valid URL
      mockRetriever.search.mockResolvedValue(['Mocked search result']);

      await docService.addDocument(library, version, validDocument);

      const results = await docService.searchStore(library, version, 'testing');
      expect(mockStore.addDocuments).toHaveBeenCalledWith(
        library,
        version,
        expect.arrayContaining([
          expect.objectContaining({ pageContent: validDocument.pageContent }),
        ]),
        expect.any(Array)
      );
      expect(results).toEqual(['Mocked search result']); // Expect mocked result
    });

    it('should preserve semantic metadata when processing markdown documents', async () => {
      const library = 'test-lib';
      const version = '1.0.0';
      const document = new Document({
        pageContent: '# Chapter 1\nTest content\n## Section 1.1\nMore testing content',
        metadata: {
          url: 'http://example.com/docs',
          title: 'Root Doc',
        },
      });

      // Mock the search result to match what would actually be stored after processing
      mockRetriever.search.mockResolvedValue(['Mocked search result']);

      await docService.addDocument(library, version, document);

      // Verify the documents were stored with semantic metadata
      expect(mockStore.addDocuments).toHaveBeenCalledWith(
        library,
        version,
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              level: 1,
              path: expect.arrayContaining(['Chapter 1', 'Section 1.1']),
            }),
          }),
        ]),
        expect.any(Array)
      );

      // Verify search results preserve metadata
      const results = await docService.searchStore(library, version, 'testing');
      expect(results).toEqual(['Mocked search result']);
    });
  });

  it('should remove all documents for a specific library and version', async () => {
    const library = 'test-lib';
    const version = '1.0.0';

    await docService.removeAllDocuments(library, version);
    expect(mockStore.deleteDocuments).toHaveBeenCalledWith(library, version);
  });

  it('should handle removing documents with null/undefined/empty version', async () => {
    const library = 'test-lib';
    await docService.removeAllDocuments(library, null);
    expect(mockStore.deleteDocuments).toHaveBeenCalledWith(library, '');
    await docService.removeAllDocuments(library, undefined);
    expect(mockStore.deleteDocuments).toHaveBeenCalledWith(library, '');
    await docService.removeAllDocuments(library, '');
    expect(mockStore.deleteDocuments).toHaveBeenCalledWith(library, '');
  });

  describe('listVersions', () => {
    it('should return an empty array if the library has no documents', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue([]);
      const versions = await docService.listVersions('nonexistent-lib');
      expect(versions).toEqual([]);
    });

    it('should return an array of indexed versions', async () => {
      const library = 'test-lib';
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '1.1.0', '1.2.0']);

      const versions = await docService.listVersions(library);
      expect(versions).toEqual([
        { version: '1.0.0', indexed: true },
        { version: '1.1.0', indexed: true },
        { version: '1.2.0', indexed: true },
      ]);
      expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library);
    });

    it('should filter out empty string and non-semver versions', async () => {
      const library = 'test-lib';
      mockStore.queryUniqueVersions.mockResolvedValue([
        '1.0.0',
        '',
        'invalid-version',
        '2.0.0-beta', // Valid semver, should be included
        '2.0.0',
      ]);

      const versions = await docService.listVersions(library);
      expect(versions).toEqual([
        { version: '1.0.0', indexed: true },
        { version: '2.0.0-beta', indexed: true },
        { version: '2.0.0', indexed: true },
      ]);
      expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library);
    });
  });

  describe('findBestVersion', () => {
    const library = 'test-lib';

    beforeEach(() => {
      // Reset mocks for checkDocumentExists for each test
      mockStore.checkDocumentExists.mockResolvedValue(false);
    });

    it('should return best match and hasUnversioned=false when only semver exists', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);
      mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned

      const result = await docService.findBestVersion(library, '1.5.0');
      expect(result).toEqual({ bestMatch: '1.1.0', hasUnversioned: false });
      expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library);
      expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, '');
    });

    it("should return latest match and hasUnversioned=false for 'latest'", async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '2.0.0', '3.0.0']);
      mockStore.checkDocumentExists.mockResolvedValue(false);

      const latestResult = await docService.findBestVersion(library, 'latest');
      expect(latestResult).toEqual({ bestMatch: '3.0.0', hasUnversioned: false });

      const defaultResult = await docService.findBestVersion(library); // No target version
      expect(defaultResult).toEqual({ bestMatch: '3.0.0', hasUnversioned: false });
    });

    it('should return best match and hasUnversioned=true when both exist', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '1.1.0']);
      mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists

      const result = await docService.findBestVersion(library, '1.0.x');
      expect(result).toEqual({ bestMatch: '1.0.0', hasUnversioned: true });
    });

    it('should return latest match and hasUnversioned=true when both exist (latest)', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '2.0.0']);
      mockStore.checkDocumentExists.mockResolvedValue(true);

      const result = await docService.findBestVersion(library);
      expect(result).toEqual({ bestMatch: '2.0.0', hasUnversioned: true });
    });

    it('should return null bestMatch and hasUnversioned=true when only unversioned exists', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['']); // listVersions filters this out
      mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists

      const result = await docService.findBestVersion(library);
      expect(result).toEqual({ bestMatch: null, hasUnversioned: true });

      const resultSpecific = await docService.findBestVersion(library, '1.0.0');
      expect(resultSpecific).toEqual({ bestMatch: null, hasUnversioned: true });
    });

    it('should return fallback match and hasUnversioned=true when target is higher but unversioned exists', async () => {
      // Renamed test for clarity
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '1.1.0']);
      mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists

      const result = await docService.findBestVersion(library, '3.0.0'); // Target higher than available
      // Expect fallback to latest available (1.1.0) because a version was requested
      expect(result).toEqual({ bestMatch: '1.1.0', hasUnversioned: true }); // Corrected expectation
    });

    it('should return fallback match and hasUnversioned=false when target is higher and only semver exists', async () => {
      // New test for specific corner case
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0', '1.1.0']);
      mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned

      const result = await docService.findBestVersion(library, '3.0.0'); // Target higher than available
      // Expect fallback to latest available (1.1.0)
      expect(result).toEqual({ bestMatch: '1.1.0', hasUnversioned: false });
    });

    it('should throw VersionNotFoundError when no versions (semver or unversioned) exist', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue([]); // No semver
      mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned

      await expect(docService.findBestVersion(library, '1.0.0')).rejects.toThrow(
        VersionNotFoundError
      );
      await expect(docService.findBestVersion(library)).rejects.toThrow(VersionNotFoundError);

      // Check error details
      const error = await docService.findBestVersion(library).catch((e) => e);
      expect(error).toBeInstanceOf(VersionNotFoundError);
      expect(error.library).toBe(library);
      expect(error.requestedVersion).toBe(''); // Default requested version is empty
      expect(error.availableVersions).toEqual([]); // No valid semver versions found
    });

    it('should not throw for invalid target version format if unversioned exists', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0']); // Has semver
      mockStore.checkDocumentExists.mockResolvedValue(true); // Has unversioned

      // Invalid format, but unversioned exists, so should return null match
      const result = await docService.findBestVersion(library, 'invalid-format');
      expect(result).toEqual({ bestMatch: null, hasUnversioned: true });
    });

    it('should throw VersionNotFoundError for invalid target version format if only semver exists', async () => {
      mockStore.queryUniqueVersions.mockResolvedValue(['1.0.0']); // Has semver
      mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned

      // Invalid format, no unversioned fallback -> throw
      await expect(docService.findBestVersion(library, 'invalid-format')).rejects.toThrow(
        VersionNotFoundError
      );
    });
  });

  describe('listLibraries', () => {
    it('should list libraries and their versions', async () => {
      const mockLibraryMap = new Map([
        ['lib1', new Set(['1.0.0', '1.1.0'])],
        ['lib2', new Set(['2.0.0'])],
      ]);
      mockStore.queryLibraryVersions.mockResolvedValue(mockLibraryMap);

      const result = await docService.listLibraries();
      expect(result).toEqual([
        {
          library: 'lib1',
          versions: [
            { version: '1.0.0', indexed: true },
            { version: '1.1.0', indexed: true },
          ],
        },
        {
          library: 'lib2',
          versions: [{ version: '2.0.0', indexed: true }],
        },
      ]);
    });

    it('should return an empty array if there are no libraries', async () => {
      mockStore.queryLibraryVersions.mockResolvedValue(new Map());
      const result = await docService.listLibraries();
      expect(result).toEqual([]);
    });

    it('should filter out empty string versions from the list', async () => {
      const mockLibraryMap = new Map([
        ['lib1', new Set(['1.0.0', ''])], // Has empty version
        ['lib2', new Set(['2.0.0'])],
        ['lib3', new Set([''])], // Only has empty version
      ]);
      mockStore.queryLibraryVersions.mockResolvedValue(mockLibraryMap);

      const result = await docService.listLibraries();
      expect(result).toEqual([
        {
          library: 'lib1',
          versions: [{ version: '1.0.0', indexed: true }], // Empty version filtered out
        },
        {
          library: 'lib2',
          versions: [{ version: '2.0.0', indexed: true }],
        },
        {
          library: 'lib3',
          versions: [], // Empty version filtered out, resulting in empty array
        },
      ]);
    });
  });

  // Tests for handling optional version parameter (null/undefined/"")
  describe('Optional Version Handling', () => {
    const library = 'opt-lib';
    const doc = new Document({
      pageContent: 'Optional version test',
      metadata: { url: 'http://opt.com' },
    });
    const query = 'optional';

    it('exists should normalize version to empty string', async () => {
      await docService.exists(library, null);
      expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, '');
      await docService.exists(library, undefined);
      expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, '');
      await docService.exists(library, '');
      expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, '');
    });

    it('addDocument should normalize version to empty string', async () => {
      await docService.addDocument(library, null, doc);
      expect(mockStore.addDocuments).toHaveBeenCalledWith(
        library,
        '',
        expect.any(Array),
        expect.any(Array)
      );
      await docService.addDocument(library, undefined, doc);
      expect(mockStore.addDocuments).toHaveBeenCalledWith(
        library,
        '',
        expect.any(Array),
        expect.any(Array)
      );
      await docService.addDocument(library, '', doc);
      expect(mockStore.addDocuments).toHaveBeenCalledWith(
        library,
        '',
        expect.any(Array),
        expect.any(Array)
      );
    });

    it('searchStore should normalize version to empty string', async () => {
      // Call without explicit limit, should use default limit of 5
      await docService.searchStore(library, null, query);
      expect(mockRetriever.search).toHaveBeenCalledWith(library, '', query, 5); // Expect default limit 5

      // Call with explicit limit
      await docService.searchStore(library, undefined, query, 7);
      expect(mockRetriever.search).toHaveBeenCalledWith(library, '', query, 7);

      // Call with another explicit limit
      await docService.searchStore(library, '', query, 10);
      expect(mockRetriever.search).toHaveBeenCalledWith(library, '', query, 10);
    });
  });
});
