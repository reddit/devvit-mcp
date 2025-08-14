import z from 'zod';
import { spawn } from 'child_process';
import { createTool } from './types';
import { logger } from '../utils/logger';
import { resolveRepoRoot } from '../utils/resolveRepoRoot';

export const logsTool = createTool({
  name: 'devvit_logs',
  description: `Streams logs for an installation within a specified subreddit.

This is a convenience wrapper around the \`devvit logs\` CLI command. Supply a subreddit, and optionally an app name, as well as any CLI flags you would normally pass to \`devvit logs\`. The tool will execute the command in a child process and return the resulting output (up to a reasonable size limit) or an error message if the command fails.

Examples:
  { subreddit: "mySubreddit" }
  { subreddit: "r/myTestSubreddit", app: "my-app", since: "15m" }`,
  inputSchema: z.object({
    subreddit: z.string().describe('Provide the subreddit name. The "r/" prefix is optional'),
    since: z.string().describe('Start time for logs (e.g. "15s", "2w1d", "30m").'),
    app: z.string().optional().describe('Provide the app name'),
    config: z.string().optional().describe('Path to devvit config file (default: devvit.json)'),
  }),
  handler: async ({ params }) => {
    const { subreddit, app, config, since } = params;

    const args: string[] = ['devvit', 'logs', subreddit];
    const repoRoot = resolveRepoRoot();

    if (!repoRoot && !params.app) {
      return {
        content: [
          {
            type: 'text',
            text: 'App name is required when running outside of a Devvit workspace',
          },
        ],
        isError: true,
      };
    }
    // Positional argument – app name
    if (app) args.push(app);

    // Flags ---------------------------------------------------------------
    if (config) args.push('--config', config);
    args.push('--since', since);

    logger.info(`🚀 Executing: devvit ${args.join(' ')}`);

    return await new Promise((resolve) => {
      const child = spawn('npx', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        cwd: repoRoot,
      });

      let stdoutData = '';
      let stderrData = '';

      // Capture stdout
      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      // Capture stderr
      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (error) => {
        logger.error(
          `❌ Failed to spawn devvit logs: ${error instanceof Error ? error.message : String(error)}`
        );
        resolve({
          content: [
            {
              type: 'text',
              text: `Failed to execute devvit logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        });
      });

      const KILL_TIMEOUT_MS = 4_000; // Prevent indefinite hanging by killing process after 4s

      const timeout = setTimeout(() => {
        logger.error(
          `⌛ Reached timeout (${KILL_TIMEOUT_MS}ms) – terminating devvit logs process…`
        );
        child.kill('SIGINT');
      }, KILL_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);
        const succeeded = code === 0;

        // Truncate extremely large outputs to avoid blowing up the chat
        const MAX_LENGTH = 2_000;
        const truncate = (str: string) =>
          str.length > MAX_LENGTH ? `…${str.slice(-MAX_LENGTH)}` : str;

        if (succeeded) {
          logger.info('✅ devvit logs completed');
          resolve({
            content: [
              {
                type: 'text',
                text: truncate(stdoutData) || 'No log output returned.',
              },
            ],
            isError: false,
          });
        } else {
          logger.warn(`⚠️ devvit logs exited with code ${code}`);
          resolve({
            content: [
              {
                type: 'text',
                text: truncate(stderrData || stdoutData || 'Unknown error'),
              },
            ],
            isError: true,
          });
        }
      });
    });
  },
});
