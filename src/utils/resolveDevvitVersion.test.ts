import { tmpdir } from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, afterEach } from 'vitest';
import { resolveDevvitVersion } from './resolveDevvitVersion';

/**
 * Helper to create an isolated temporary directory for a test case.
 */
async function makeTempDir(prefix = 'devvit-version-') {
  return fs.mkdtemp(path.join(tmpdir(), prefix));
}

describe('resolveDevvitVersion', () => {
  const ORIGINAL_ENV = { ...process.env };

  // Reset environment variables after each test so tests remain isolated.
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('returns null if no workspace directory environment variables are set', async () => {
    delete process.env.DEVVIT_WORKSPACE_ROOT;
    delete process.env.WORKSPACE_FOLDER_PATHS;

    const result = await resolveDevvitVersion();
    expect(result).toBeNull();
  });

  test('returns null when no package.json can be found while walking up', async () => {
    const workspace = await makeTempDir();
    const nested = path.join(workspace, 'packages', 'nested');
    await fs.mkdir(nested, { recursive: true });

    process.env.DEVVIT_WORKSPACE_ROOT = nested;

    const result = await resolveDevvitVersion();
    expect(result).toBeNull();
  });

  test('detects a single Devvit dependency version in package.json', async () => {
    const workspace = await makeTempDir();
    // Create a package.json with a single devvit dependency using a caret range
    await fs.writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        dependencies: {
          devvit: '^0.9.1',
        },
      }),
      'utf8'
    );

    // Start search from a nested directory to exercise directory walking
    const nested = path.join(workspace, 'src', 'app');
    await fs.mkdir(nested, { recursive: true });
    process.env.DEVVIT_WORKSPACE_ROOT = nested;

    const result = await resolveDevvitVersion();
    expect(result).toBe('0.9.1');
  });

  test('picks the highest version across multiple Devvit-related packages', async () => {
    const workspace = await makeTempDir();
    await fs.writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        dependencies: {
          devvit: '^0.9.1',
          '@devvit/public-api': '~0.10.0',
        },
        devDependencies: {
          '@devvit/server': '0.11.1',
          '@devvit/client': '0.12.2',
        },
      }),
      'utf8'
    );

    process.env.DEVVIT_WORKSPACE_ROOT = workspace;

    const result = await resolveDevvitVersion();
    expect(result).toBe('0.12.2'); // highest semver
  });

  test('reflects updated package.json on subsequent calls (no caching)', async () => {
    const workspace = await makeTempDir();

    // Initial package.json with version 1.0.0
    const pkgPath = path.join(workspace, 'package.json');
    await fs.writeFile(pkgPath, JSON.stringify({ dependencies: { devvit: '^1.0.0' } }), 'utf8');

    process.env.DEVVIT_WORKSPACE_ROOT = workspace;

    const firstCall = await resolveDevvitVersion();
    expect(firstCall).toBe('1.0.0');

    // Overwrite package.json with a higher version – should NOT be picked up
    await fs.writeFile(pkgPath, JSON.stringify({ dependencies: { devvit: '^2.0.0' } }), 'utf8');

    const secondCall = await resolveDevvitVersion();
    expect(secondCall).toBe('2.0.0'); // updated version is now detected
  });
});
