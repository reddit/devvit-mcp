import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { resolveRepoRoot } from './resolveRepoRoot';

// Packages whose versions should be examined to determine the effective Devvit SDK version
const DEVVIT_DEP_PACKAGES = [
  'devvit',
  '@devvit/public-api',
  '@devvit/server',
  '@devvit/client',
] as const;

/**
 * THIS IS A TOTAL YOLO, NEED TO TEST THIS!!
 *
 * Recursively walks up the directory tree from the provided directory (or process.cwd())
 * looking for a package.json. When found, returns the highest semver version among the
 * recognized Devvit-related packages (dependencies & devDependencies). If no suitable
 * version is found, `null` is returned.
 */
export async function resolveDevvitVersion(): Promise<string | null> {
  const startDir = resolveRepoRoot();

  if (!startDir) {
    return null;
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
        return versions.sort(semver.rcompare)[0] ?? null;
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

  return null;
}
