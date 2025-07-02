# Scripts

This directory contains scripts for generating and managing Devvit documentation embeddings.

## Scripts Overview

### `generateChunks.ts`
Generates chunks and embeddings from the Devvit documentation repository.

### `generateSqliteDb.ts`
Creates a SQLite database from the generated chunks and embeddings.

### `hashAndCompare.ts` (NEW)
Calculates content hashes and compares with the latest release to determine if a new release is needed.

## Content Hash Comparison

The `hashAndCompare.ts` script implements a content-aware release system that:

1. **Calculates Hash**: Creates a SHA256 hash of the generated `fixtures.tar.gz` and `db/devvit-docs.db` files
2. **Downloads Previous**: Downloads the latest release assets from GitHub and calculates their hashes
3. **Compares Content**: Compares the current content hash with the previous release hash
4. **Decides on Release**: Only proceeds with release creation if content has changed

### How it works

1. The script calculates a combined SHA256 hash of:
   - The `fixtures.tar.gz` archive
   - The `db/devvit-docs.db` file
2. It downloads the latest release assets from GitHub's API
3. It calculates hashes of the downloaded assets
4. If hashes match, it exits with code 1 (no release needed)
5. If hashes differ or no previous release exists, it exits with code 0 (proceed with release)

### Usage

```bash
npm run scripts:hash-and-compare
```

### Exit Codes

- `0`: Content has changed, proceed with release
- `1`: Content unchanged, no release needed
- Other: Error occurred during processing

### Requirements

- `GITHUB_TOKEN`: GitHub API token with repository access
- `GITHUB_REPOSITORY`: Repository name (automatically set in GitHub Actions)

## GitHub Workflow Integration

The GitHub workflow (`.github/workflows/generate-db.yml`) has been updated to:

1. Generate chunks and SQLite DB separately
2. Run `hashAndCompare.ts` to check if content has changed
3. Only create tags and releases when content has actually changed
4. Use GitHub's built-in SHA256 hashing for release assets

This prevents unnecessary releases when the documentation content hasn't changed, saving storage and bandwidth. 
