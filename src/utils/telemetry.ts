/** Lifted from: https://github.snooguts.net/reddit/reddit-devplatform-monorepo/tree/main/packages/cli/src */
import os from 'os';
import { version } from '../../package.json';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { logger } from './logger';

export async function isFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** @type {boolean} See envvar.md. */
export const MY_PORTAL_ENABLED = !!process.env.MY_PORTAL && process.env.MY_PORTAL !== '0';

export const STAGE_USER_NAME =
  // Not every username is `first-last`, if `MY_PORTAL` looks like a username use that directly
  MY_PORTAL_ENABLED && process.env.MY_PORTAL?.includes('-')
    ? process.env.MY_PORTAL.toLowerCase()
    : os.userInfo().username.replace(/\./g, '-');

export const DEVVIT_PORTAL_URL = (() => {
  if (MY_PORTAL_ENABLED) {
    return `https://reddit-service-devvit-dev-portal.${STAGE_USER_NAME}.snoo.dev` as const;
  }

  return 'https://developers.reddit.com' as const;
})();

export const DEVVIT_PORTAL_API = `${DEVVIT_PORTAL_URL}/api` as const;

export type HeaderTuple = readonly [key: string, val: string];

export const HEADER_USER_AGENT = (): HeaderTuple => [
  'user-agent',
  `Devvit/MCP/${version} Node/${process.version.replace(/^v/, '')}`,
];

export const HEADER_DEVVIT_MCP = (): HeaderTuple => ['x-devvit-mcp', 'true'];

export const HEADER_DEVVIT_CANARY = (val: string): HeaderTuple => {
  return ['devvit-canary', val];
};

const DIR_SUFFIX = MY_PORTAL_ENABLED ? `-${STAGE_USER_NAME}` : '';

/** @type {string} Relative Devvit CLI configuration directory filename. */
const DEVVIT_DIR_NAME = `${process.env.DEVVIT_DIR_NAME || '.devvit'}${DIR_SUFFIX}`;

/**
 * @type {string} Absolute filename of the Devvit CLI configuration directory.
 */
export const DOT_DEVVIT_DIR_FILENAME = process.env.DEVVIT_ROOT_DIR
  ? path.join(process.env.DEVVIT_ROOT_DIR, DEVVIT_DIR_NAME)
  : path.join(os.homedir(), DEVVIT_DIR_NAME);

function getHeaders(): Headers {
  const headers = new Headers();
  headers.set(...HEADER_USER_AGENT());
  headers.set(...HEADER_DEVVIT_MCP());

  if (process.env.DEVVIT_CANARY) {
    logger.warn(`Warning: setting devvit-canary to "${process.env.DEVVIT_CANARY}"`);
    headers.set(...HEADER_DEVVIT_CANARY(process.env.DEVVIT_CANARY));
  }

  return headers;
}

export function getTelemetrySessionIdFilename(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'session-id');
}

export function getTokenFilename(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'token');
}

export function getMetricsOptOutFile(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'opt-out-metrics');
}

export async function isMetricsEnabled(): Promise<boolean> {
  if (process.env.DEVVIT_DISABLE_METRICS) {
    return false;
  }

  const optOutFile = getMetricsOptOutFile();
  return !(await isFile(optOutFile));
}

export async function getTelemetrySessionId(): Promise<string> {
  const sessionIdFilename = getTelemetrySessionIdFilename();
  const isSessionIdFileCreated = await isFile(sessionIdFilename);

  if (isSessionIdFileCreated) {
    return await fs.readFile(sessionIdFilename, 'utf-8');
  }

  const sessionId = crypto.randomUUID();
  await fs.mkdir(DOT_DEVVIT_DIR_FILENAME, { recursive: true });
  await fs.writeFile(sessionIdFilename, sessionId, 'utf-8');
  return sessionId;
}

async function getToken(): Promise<string | undefined> {
  const tokenFilename = getTokenFilename();
  const isTokenFileCreated = await isFile(tokenFilename);

  if (!isTokenFileCreated) return;

  try {
    const contents = await fs.readFile(tokenFilename, 'utf-8');
    return JSON.parse(contents).token;
  } catch (error) {
    return undefined;
  }
}

export const sendEvent = async (
  args: {
    mcp_name: string;
    mcp_args?: Record<string, unknown> | undefined;
    mcp_step?: number | undefined;
    /** The query from devvit search */
    mcp_args_query?: string | undefined;
  },
  force: boolean = false
) => {
  const shouldTrack = force || (await isMetricsEnabled());
  if (!shouldTrack) return;

  const sessionId = await getTelemetrySessionId();
  const eventWithSession = {
    structValue: {
      source: 'devplatform_mcp',
      action: 'call',
      noun: 'tool',
      devplatform: args,
      session: {
        id: sessionId,
      },
    },
  };

  const headers = getHeaders();

  headers.set('content-type', 'application/json');

  const token = await getToken();
  if (token) {
    headers.set('authorization', `bearer ${token}`);
  }

  try {
    await fetch(`${DEVVIT_PORTAL_API}/events/devvit.dev_portal.Events/SendEvent`, {
      method: 'POST',
      headers,
      body: JSON.stringify(eventWithSession),
    });
  } catch (error) {
    // We don't care if it fails!
  }
};
