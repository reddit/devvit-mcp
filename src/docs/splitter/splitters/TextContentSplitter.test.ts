import { describe, expect, it, vi } from 'vitest';
import { TextContentSplitter } from './TextContentSplitter';
import type { ContentSplitterOptions } from './types';

vi.mock('../../utils/logger');

describe('TextContentSplitter', () => {
  const options = {
    maxChunkSize: 100,
  } satisfies ContentSplitterOptions;
  const splitter = new TextContentSplitter(options);

  it('should split on paragraph boundaries when possible', async () => {
    const text = `First paragraph with some content.

Second paragraph that continues the text.

Third paragraph to complete the example.`;

    const chunks = await splitter.split(text);

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe('First paragraph with some content.');
    expect(chunks[1]).toBe('Second paragraph that continues the text.');
    expect(chunks[2]).toBe('Third paragraph to complete the example.');
  });

  it('should fall back to line breaks when paragraphs too large', async () => {
    // Create a paragraph larger than maxChunkSize
    const longParagraph = Array(5)
      .fill('This is a very long line of text that should be split.')
      .join(' ');

    const text = `${longParagraph}
Line two of the text.
Line three continues here.
And line four finishes it.`;

    const chunks = await splitter.split(text);

    // Should split into multiple chunks at line boundaries
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.maxChunkSize);
    }
  });

  it('should merge small chunks when possible', async () => {
    const text = 'Short line 1.\nShort line 2.\nShort line 3.\n\nAnother short one.\nAnd another.';

    const chunks = await splitter.split(text);

    // Small consecutive lines should be merged
    expect(chunks.length).toBeLessThan(6); // Less than total number of lines
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.maxChunkSize);
    }
  });

  it('should handle empty content gracefully', async () => {
    const emptyChunks = await splitter.split('');
    expect(emptyChunks.length).toBe(1);
    expect(emptyChunks[0]).toBe('');

    const whitespaceChunks = await splitter.split('   \n  \n  ');
    expect(whitespaceChunks.length).toBe(1);
    expect(whitespaceChunks[0]).toBe('');
  });

  it('should split words as last resort', async () => {
    const splitter = new TextContentSplitter({
      maxChunkSize: 20, // Very small for testing word splitting
    });

    const text = 'This is a very long sentence that needs to be split into smaller chunks';

    const chunks = await splitter.split(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });
});
