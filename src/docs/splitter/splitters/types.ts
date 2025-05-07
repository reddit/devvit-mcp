/**
 * Common configuration options for content splitters
 */
export interface ContentSplitterOptions {
  /** Maximum characters per chunk */
  maxChunkSize: number;
}

/**
 * Core interface for content splitters
 */
export interface ContentSplitter {
  /** Split content into chunks respecting size constraints */
  split(content: string): Promise<string[]>;
}
