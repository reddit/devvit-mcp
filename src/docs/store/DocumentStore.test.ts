import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocking Setup ---

// Mock OpenAIEmbeddings
const mockEmbedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockEmbedDocuments = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]); // Keep this if addDocuments is tested elsewhere

// Mock the module to export a mock function for the class constructor
vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi.fn(), // Mock the class export as a vi.fn()
}));

// Mock better-sqlite3
const mockStatementAll = vi.fn().mockReturnValue([]);
// Ensure the mock statement object covers methods used by *all* statements prepared in DocumentStore
const mockStatement = {
  all: mockStatementAll,
  run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 1 }), // Mock run for insert/delete
  get: vi.fn().mockReturnValue(undefined), // Mock get for getById/checkExists etc.
};
const mockPrepare = vi.fn().mockReturnValue(mockStatement);
const mockDb = {
  prepare: mockPrepare,
  exec: vi.fn(),
  transaction: vi.fn((fn) => fn()),
  close: vi.fn(),
};
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => mockDb), // Mock the default export (constructor)
}));

// Mock sqlite-vec
vi.mock('sqlite-vec', () => ({
  load: vi.fn(),
}));

// --- Test Suite ---

// Import the mocked constructor function
import { OpenAIEmbeddings } from '@langchain/openai';
// Import DocumentStore AFTER mocks are defined
import { DocumentStore } from './DocumentStore';

// Cast OpenAIEmbeddings to the correct Vitest mock type for configuration
const MockedOpenAIEmbeddingsConstructor = OpenAIEmbeddings as ReturnType<typeof vi.fn>;

describe('DocumentStore', () => {
  let documentStore: DocumentStore;

  beforeEach(async () => {
    vi.clearAllMocks(); // Clear call history etc.

    // Configure the mock constructor's implementation for THIS test run
    MockedOpenAIEmbeddingsConstructor.mockImplementation(() => ({
      embedQuery: mockEmbedQuery,
      embedDocuments: mockEmbedDocuments,
    }));
    mockPrepare.mockReturnValue(mockStatement); // <-- Re-configure prepare mock return value

    // Now create the store and initialize.
    // initialize() will call 'new OpenAIEmbeddings()', which uses our fresh mock implementation.
    documentStore = new DocumentStore(':memory:');
    await documentStore.initialize();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('findByContent', () => {
    const library = 'test-lib';
    const version = '1.0.0';
    const limit = 10;

    it('should call embedQuery and prepare/all with escaped FTS query for double quotes', async () => {
      const query = 'find "quotes"';
      const expectedFtsQuery = '"find ""quotes"""'; // Escaped and wrapped

      await documentStore.findByContent(library, version, query, limit);

      // 1. Check if embedQuery was called
      expect(mockEmbedQuery).toHaveBeenCalledWith(query);
      expect(mockEmbedQuery).toHaveBeenCalledTimes(1);

      // 2. Check if db.prepare was called correctly during findByContent
      // It's called multiple times during initialize, so check the specific call
      const prepareCall = mockPrepare.mock.calls.find((call) =>
        call[0].includes('WITH vec_scores AS')
      );
      expect(prepareCall).toBeDefined();

      // 3. Check the arguments passed to the statement's 'all' method
      expect(mockStatementAll).toHaveBeenCalledTimes(1); // Only the findByContent call should use 'all'
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs).toEqual([
        library.toLowerCase(),
        version.toLowerCase(),
        expect.any(String), // Embedding JSON
        limit,
        library.toLowerCase(),
        version.toLowerCase(),
        expectedFtsQuery, // Check the escaped query string
        limit,
      ]);
    });

    it('should correctly escape FTS operators', async () => {
      const query = 'search AND this OR that';
      const expectedFtsQuery = '"search AND this OR that"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery); // Check only the FTS query argument
    });

    it('should correctly escape parentheses', async () => {
      const query = 'function(arg)';
      const expectedFtsQuery = '"function(arg)"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it('should correctly escape asterisks', async () => {
      const query = 'wildcard*';
      const expectedFtsQuery = '"wildcard*"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it('should correctly escape already quoted strings', async () => {
      const query = '"already quoted"';
      const expectedFtsQuery = '"""already quoted"""';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it('should correctly handle empty string', async () => {
      const query = '';
      const expectedFtsQuery = '""';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });
  });
});
