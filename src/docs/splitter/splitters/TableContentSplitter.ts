import { MinimumChunkSizeError } from '../errors';
import type { ContentSplitter, ContentSplitterOptions } from './types';

/**
 * Interface representing the structure of a parsed markdown table
 */
interface ParsedTable {
  headers: string[];
  separator: string;
  rows: string[];
}

/**
 * Splits table content while preserving headers and table formatting.
 * Each chunk maintains the table structure with headers and separator row.
 */
export class TableContentSplitter implements ContentSplitter {
  private options: ContentSplitterOptions;

  constructor(options: ContentSplitterOptions) {
    this.options = options;
  }

  /**
   * Splits table content into chunks while preserving table structure
   */
  async split(content: string): Promise<string[]> {
    const parsedTable = this.parseTable(content);
    if (!parsedTable) {
      return [content];
    }

    const { headers, rows } = parsedTable;

    const chunks: string[] = [];
    let currentRows: string[] = [];

    for (const row of rows) {
      // Check if a single row with headers exceeds maxChunkSize
      const singleRowSize = this.wrap(row, headers).length;
      if (singleRowSize > this.options.maxChunkSize) {
        throw new MinimumChunkSizeError(singleRowSize, this.options.maxChunkSize);
      }

      const newChunkContent = this.wrap([...currentRows, row].join('\n'), headers);
      const newChunkSize = newChunkContent.length;
      if (newChunkSize > this.options.maxChunkSize && currentRows.length > 0) {
        // Add current chunk, start new
        chunks.push(this.wrap(currentRows.join('\n'), headers));
        currentRows = [row];
      } else {
        currentRows.push(row);
      }
    }

    if (currentRows.length > 0) {
      chunks.push(this.wrap(currentRows.join('\n'), headers));
    }

    // No merging of table chunks
    return chunks;
  }

  protected wrap(content: string, headers: string[]): string {
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `|${headers.map(() => '---').join('|')}|`;
    return [headerRow, separatorRow, content].join('\n');
  }

  private parseTable(content: string): ParsedTable | null {
    const lines = content.trim().split('\n');
    if (lines.length < 3) return null; // Need at least headers, separator, and one data row

    const headers = this.parseRow(lines[0]!);
    if (!headers) return null;

    const separator = lines[1];
    if (!this.isValidSeparator(separator!)) return null;

    const rows = lines.slice(2).filter((row) => row.trim() !== '');

    return { headers, separator: separator!, rows };
  }

  /**
   * Parses a table row into cells
   */
  private parseRow(row: string): string[] | null {
    if (!row.includes('|')) return null;
    return row
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '');
  }

  /**
   * Validates the separator row of the table
   */
  private isValidSeparator(separator: string): boolean {
    return separator.includes('|') && /^\|?[\s-|]+\|?$/.test(separator);
  }
}
