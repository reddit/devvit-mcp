import { describe, expect, it, vi, beforeEach } from 'vitest';

// 1. Create the mock extractor function using vi.hoisted to ensure it is initialized before imports
const { mockExtractor } = vi.hoisted(() => ({
  mockExtractor: vi.fn().mockImplementation((input: string | string[]) => {
    const count = Array.isArray(input) ? input.length : 1;
    const vectors = Array.from({ length: count }, (_, i) => [
      Math.round((0.1 + i * 0.1) * 10) / 10,
      Math.round((0.2 + i * 0.1) * 10) / 10,
      Math.round((0.3 + i * 0.1) * 10) / 10,
    ]);
    return Promise.resolve({
      tolist: () => vectors,
    });
  }),
}));

// 2. Mock @xenova/transformers pipeline
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockExtractor),
}));

// 3. Import functions after the mock has been configured
import { embedDocument, embedDocuments } from './embeddings';

describe('embeddings utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed a single document using Xenova feature extraction', async () => {
    const result = await embedDocument('test query');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockExtractor).toHaveBeenCalledTimes(1);
    expect(mockExtractor).toHaveBeenCalledWith('test query', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('should embed an empty string successfully', async () => {
    const result = await embedDocument('');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockExtractor).toHaveBeenCalledTimes(1);
    expect(mockExtractor).toHaveBeenCalledWith('', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('should embed multiple documents and return a 2D array of the same length', async () => {
    const result = await embedDocuments(['doc1', 'doc2']);

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.2, 0.3, 0.4],
    ]);
    expect(mockExtractor).toHaveBeenCalledTimes(1);
    expect(mockExtractor).toHaveBeenCalledWith(['doc1', 'doc2'], {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('should return an empty array without calling the extractor if empty array is passed', async () => {
    const result = await embedDocuments([]);

    expect(result).toEqual([]);
    expect(mockExtractor).not.toHaveBeenCalled();
  });
});
