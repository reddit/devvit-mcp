/**
 * Base error class for all splitter-related errors
 */
export class SplitterError extends Error {}

/**
 * Thrown when content cannot be split further while maintaining its validity
 * (e.g., markdown tables require headers, code blocks require language and backticks)
 */
export class MinimumChunkSizeError extends SplitterError {
  constructor(size: number, maxSize: number) {
    super(
      `Cannot split content any further. Content requires minimum chunk size of ${size} bytes, but maximum allowed is ${maxSize} bytes.`
    );
  }
}

/**
 * Generic error for content splitting failures
 */
export class ContentSplitterError extends SplitterError {}
