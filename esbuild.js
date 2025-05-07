#!/usr/bin/env node

import esbuild from 'esbuild';
import { readFile } from 'fs/promises';
import { copy } from 'esbuild-plugin-copy';

async function getExternalDeps() {
  const pkg = JSON.parse(await readFile('package.json', 'utf-8'));
  return [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ];
}

async function getBaseConfig() {
  const externalDeps = await getExternalDeps();
  return {
    entryPoints: ['src/index.ts'],
    bundle: true,
    splitting: true,
    treeShaking: true,
    outdir: 'dist',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: externalDeps,
    plugins: [
      copy({
        // this is equal to process.cwd(), which means we use cwd path as base path to resolve `to` path
        // if not specified, this plugin uses ESBuild.build outdir/outfile options as base path.
        resolveFrom: 'cwd',
        assets: {
          from: ['./src/fixtures/**/*'],
          to: ['./dist/fixtures'],
        },
        watch: true,
      }),
    ],
  };
}

async function watch() {
  try {
    const config = await getBaseConfig();
    const context = await esbuild.context({
      ...config,
      plugins: [
        {
          name: 'rebuild-logger',
          setup(build) {
            build.onEnd((result) => {
              const timestamp = new Date().toLocaleTimeString();
              if (result.errors.length > 0) {
                console.error(`[${timestamp}] Rebuild failed:`, result.errors);
              } else {
                console.log(`[${timestamp}] Rebuild complete`);
                if (result.warnings.length > 0) {
                  console.warn(`[${timestamp}] Warnings:`, result.warnings);
                }
              }
            });
          },
        },
      ],
    });

    await context.watch();
    console.log('Watching for changes...');
  } catch (error) {
    console.error('Watch mode failed:', error);
    process.exit(1);
  }
}

async function build() {
  try {
    const config = await getBaseConfig();
    const result = await esbuild.build(config);

    if (result.errors.length > 0) {
      console.error('Build failed:', result.errors);
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.warn('Build warnings:', result.warnings);
    }

    console.log('Build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// Check if watch mode is requested
const isWatchMode = process.argv.includes('--watch') || process.argv.includes('-w');
if (isWatchMode) {
  watch();
} else {
  build();
}
