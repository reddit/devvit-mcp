import z from 'zod';
import { createTool } from './types';
import { logger } from '../utils/logger';
import { VersionNotFoundError } from './errors';
import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';

// Packages whose versions should be examined to determine the effective Devvit SDK version
const DEVVIT_DEP_PACKAGES = [
  'devvit',
  '@devvit/public-api',
  '@devvit/server',
  '@devvit/client',
] as const;

// Cache to avoid walking the filesystem for every search invocation
let cachedDevvitVersion: string | null | undefined;

/**
 * THIS IS A TOTAL YOLO, NEED TO TEST THIS!!
 *
 * Recursively walks up the directory tree from the provided directory (or process.cwd())
 * looking for a package.json. When found, returns the highest semver version among the
 * recognized Devvit-related packages (dependencies & devDependencies). If no suitable
 * version is found, `null` is returned.
 */
async function resolveDevvitVersion(startDir: string = process.cwd()): Promise<string | null> {
  // Serve the cached value if we have already resolved it in this process lifetime
  if (cachedDevvitVersion !== undefined) {
    return cachedDevvitVersion;
  }

  let currentDir = path.resolve(startDir);
  const { root } = path.parse(currentDir);

  while (true) {
    const pkgJsonPath = path.join(currentDir, 'package.json');
    try {
      const pkgJsonRaw = await fs.readFile(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(pkgJsonRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const versions: string[] = [];

      for (const depName of DEVVIT_DEP_PACKAGES) {
        const versionRange = pkg.dependencies?.[depName] ?? pkg.devDependencies?.[depName] ?? null;
        if (versionRange) {
          // Strip npm range specifiers (^, ~, >, etc.) and coerce to a semver string
          const clean = semver.coerce(versionRange)?.version ?? null;
          if (clean) {
            versions.push(clean);
          }
        }
      }

      if (versions.length > 0) {
        // Pick highest semver among collected versions
        cachedDevvitVersion = versions.sort(semver.rcompare)[0] ?? null;
        return cachedDevvitVersion;
      }
    } catch (err) {
      // If the file is not found, ignore and keep walking up. For any JSON parse
      // or read error other than ENOENT, break and treat as unresolved.
      if ((err as { code?: string }).code !== 'ENOENT') {
        break;
      }
    }

    if (currentDir === root) {
      break; // reached filesystem root
    }

    currentDir = path.dirname(currentDir);
  }

  cachedDevvitVersion = null;
  return null;
}

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
    limit: z.number().optional().default(5).describe('Maximum number of results'),
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
