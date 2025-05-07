import { MinimumChunkSizeError } from '../errors';
import type { ContentSplitter, ContentSplitterOptions } from './types';

/**
 * Splits code content while preserving language information and formatting.
 * Uses line boundaries for splitting and ensures each chunk is properly
 * wrapped with language-specific code block markers.
 */
export class CodeContentSplitter implements ContentSplitter {
  private options: ContentSplitterOptions;

  constructor(options: ContentSplitterOptions) {
    this.options = options;
  }

  async split(content: string): Promise<string[]> {
    // Determine language and strip triple backticks from content
    const language = content.match(/^```(\w+)\n/)?.[1];
    const strippedContent = content.replace(/^```(\w*)\n/, '').replace(/```\s*$/, '');

    const lines = strippedContent.split('\n');
    const chunks: string[] = [];
    let currentChunkLines: string[] = [];

    for (const line of lines) {
      // Check if a single line with code block markers exceeds maxChunkSize
      const singleLineSize = this.wrap(line, language).length;
      if (singleLineSize > this.options.maxChunkSize) {
        throw new MinimumChunkSizeError(singleLineSize, this.options.maxChunkSize);
      }

      currentChunkLines.push(line);
      const newChunkContent = this.wrap(currentChunkLines.join('\n'), language);
      const newChunkSize = newChunkContent.length;

      if (newChunkSize > this.options.maxChunkSize && currentChunkLines.length > 1) {
        // remove last item
        const lastLine = currentChunkLines.pop();
        // wrap content and create chunk
        chunks.push(this.wrap(currentChunkLines.join('\n'), language));
        currentChunkLines = [lastLine as string];
      }
    }

    if (currentChunkLines.length > 0) {
      chunks.push(this.wrap(currentChunkLines.join('\n'), language));
    }

    return chunks;
  }

  protected wrap(content: string, language?: string | null): string {
    return `\`\`\`${language || ''}\n${content.replace(/\n+$/, '')}\n\`\`\``;
  }
}
