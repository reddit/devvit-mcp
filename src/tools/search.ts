import z from 'zod';
import { createTool } from './types';
import { logger } from '../utils/logger';
import { VersionNotFoundError } from './errors';
import { resolveDevvitVersion } from '../utils/resolveDevvitVersion';

export const searchTool = createTool({
  name: 'devvit_search',
  description: `Search indexed documentation for the latest version of devvit. 

For redis docs, use redis.{my_command}

Examples:
- {query: "how do hooks work"}
- {query: "redis.bitfield"}
- {query: "useState"}
- {query: "working with useState", limit: 10}
- {query: "scheduler"}`,
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(2).describe('Maximum number of results'),
    exactMatch: z.boolean().optional().default(false).describe('Only use exact version match'),
  }),
  handler: async ({ params, context }) => {
    const LIBRARY = 'devvit';

    // Dynamically determine the Devvit SDK version used by the host project
    const detectedVersion = await resolveDevvitVersion();

    // Fallback to "latest" when no version can be detected (e.g., no package.json or none of the
    // target dependencies present)
    const REQUESTED_VERSION = detectedVersion ?? 'latest';

    const { query, limit = 5, exactMatch = false } = params;

    const docService = context._docsService;

    logger.info(
      `🔍 Searching ${LIBRARY}@${REQUESTED_VERSION} for: ${query}${exactMatch ? ' (exact match)' : ''}`
    );

    try {
      let versionToSearch: string | null | undefined = REQUESTED_VERSION;

      if (!exactMatch) {
        // Try to find the best version match (may return null for un-versioned docs)
        const versionResult = await docService.findBestVersion(LIBRARY, REQUESTED_VERSION);
        versionToSearch = versionResult.bestMatch;
      }

      const results = await docService.searchStore(LIBRARY, versionToSearch, query, limit);

      logger.info(`✅ Found ${results.length} matching results`);

      const formattedResults = results.map(
        (r, i) =>
          `\n------------------------------------------------------------\nResult ${i + 1}: ${r.url}\n\n${r.content}\n`
      );

      return {
        content: [
          {
            type: 'text',
            text: `Search results for '${query}':${formattedResults.join('')}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      if (error instanceof VersionNotFoundError) {
        logger.info(`ℹ️ Version not found: ${error.message}`);
        return {
          content: [
            {
              type: 'text',
              text: error.message,
            },
          ],
          isError: true,
        };
      }

      logger.error(`❌ Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return {
        content: [
          {
            type: 'text',
            text: `Failed to search documentation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});
