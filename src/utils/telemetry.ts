import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { version } from '../../package.json';
import { logger } from './logger';

async function isFile(filename: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filename);
    return stat.isFile();
  } catch {
    return false;
  }
}

const DEVVIT_AUTH_TOKEN = 'DEVVIT_AUTH_TOKEN';

/** @type {boolean} See envvar.md. */
const MY_PORTAL_ENABLED = !!process.env.MY_PORTAL && process.env.MY_PORTAL !== '0';

const STAGE_USER_NAME =
  // Not every username is `first-last`, if `MY_PORTAL` looks like a username use that directly
  MY_PORTAL_ENABLED && process.env.MY_PORTAL?.includes('-')
    ? process.env.MY_PORTAL.toLowerCase()
    : os.userInfo().username.replace(/\./g, '-');

const DEVVIT_PORTAL_URL = (() => {
  if (MY_PORTAL_ENABLED) {
    return `https://reddit-service-devvit-dev-portal.${STAGE_USER_NAME}.snoo.dev` as const;
  }

  return 'https://developers.reddit.com' as const;
})();

const DEVVIT_PORTAL_API = `${DEVVIT_PORTAL_URL}/api` as const;

type HeaderTuple = readonly [key: string, val: string];

const HEADER_USER_AGENT = (): HeaderTuple => [
  'user-agent',
  `Devvit/MCP/${version} Node/${process.version.replace(/^v/, '')}`,
];

const HEADER_DEVVIT_MCP = (): HeaderTuple => ['x-devvit-mcp', 'true'];

const HEADER_DEVVIT_CANARY = (val: string): HeaderTuple => {
  return ['devvit-canary', val];
};

const DIR_SUFFIX = MY_PORTAL_ENABLED ? `-${STAGE_USER_NAME}` : '';

/** @type {string} Relative Devvit CLI configuration directory filename. */
const DEVVIT_DIR_NAME = `${process.env.DEVVIT_DIR_NAME || '.devvit'}${DIR_SUFFIX}`;

/**
 * @type {string} Absolute filename of the Devvit CLI configuration directory.
 */
const DOT_DEVVIT_DIR_FILENAME = process.env.DEVVIT_ROOT_DIR
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

function getTelemetrySessionIdFilename(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'session-id');
}

function getTokenFilename(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'token');
}

function getMetricsOptOutFile(): string {
  return path.join(DOT_DEVVIT_DIR_FILENAME, 'opt-out-metrics');
}

async function isMetricsEnabled(): Promise<boolean> {
  if (process.env.DEVVIT_DISABLE_METRICS) {
    return false;
  }

  const optOutFile = getMetricsOptOutFile();
  return !(await isFile(optOutFile));
}

async function getTelemetrySessionId(): Promise<string> {
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

type StoredTokenJSON = {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly scope: string;
  readonly tokenType: string;
};

/**
 * Copied from CLI: packages/cli/src/lib/auth/StoredToken.ts
 *
 * We only need the access token for telemetry.
 */
function storedTokenFromBase64(base64: string): StoredTokenJSON | undefined {
  let token: unknown;
  try {
    token = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }

  if (!token || typeof token !== 'object') {
    return undefined;
  }

  const candidate = token as Partial<StoredTokenJSON>;
  if (
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.expiresAt !== 'number' ||
    typeof candidate.refreshToken !== 'string' ||
    typeof candidate.scope !== 'string' ||
    candidate.tokenType !== 'bearer'
  ) {
    return undefined;
  }

  return candidate as StoredTokenJSON;
}

async function getAccessToken(): Promise<string | undefined> {
  let rawToken: string;

  if (process.env[DEVVIT_AUTH_TOKEN]) {
    rawToken = process.env[DEVVIT_AUTH_TOKEN];
  } else {
    const tokenFilename = getTokenFilename();
    if (!(await isFile(tokenFilename))) {
      return undefined;
    }

    rawToken = await fs.readFile(tokenFilename, { encoding: 'utf8' });
    if (rawToken == null || rawToken.length === 0) {
      return undefined;
    }
  }

  try {
    const jsonParse = JSON.parse(rawToken) as { token?: unknown };
    if (typeof jsonParse.token !== 'string') {
      return undefined;
    }

    const token = storedTokenFromBase64(jsonParse.token);
    return token?.accessToken;
  } catch {
    // Old format: file contents are base64(JSON(StoredToken))
    const token = storedTokenFromBase64(rawToken);
    return token?.accessToken;
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

  const token = await getAccessToken();
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
