import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import packageJSON from '../package.json' assert { type: 'json' };
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Tool } from './tools/types';
import { helloWorldTool } from './tools/hello-world';
import z from 'zod';
import { logger } from './utils/logger';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Context } from './utils/context';
import { searchTool } from './tools/search';
import { logsTool } from './tools/logs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: Tool<any>[] = [helloWorldTool, searchTool, logsTool];

export const createServer = (): Server => {
  const server = new Server(
    { name: 'devvit-mcp', version: packageJSON.version },
    {
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
      },
    }
  );
  const context = new Context();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map(({ handler: _handler, inputSchema, ...rest }) => ({
        ...rest,
        inputSchema: z.toJSONSchema(inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool "${request.params.name}" not found` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler({ params: request.params.arguments, context });
      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: String(error) }],
        isError: true,
      };
    }
  });

  // We wrap these to allow logging to work without needing to send MCP style
  // logging messages everywhere in the code
  const oldConnect = server.connect.bind(server);
  const oldClose = server.close.bind(server);

  server.connect = async (transport: StdioServerTransport) => {
    await oldConnect(transport);
    /**
     * Custom reporter to pipe logs through MCP so we can see
     * them in the inspector and in the console for apps
     */
    logger.setReporters([
      {
        log: async (logObj, _ctx) => {
          const marshallConsolaLevelToMCPLevel = (
            level: number
          ): Parameters<typeof server.sendLoggingMessage>[0]['level'] => {
            // https://github.com/unjs/consola?tab=readme-ov-file#log-level
            switch (level) {
              case 0:
                return 'critical';
              case 1:
                return 'warning';
              default:
                return 'info';
            }
          };

          await server.sendLoggingMessage({
            level: marshallConsolaLevelToMCPLevel(logObj.level),
            data: {
              time: logObj.date,
              message: logObj.args,
              context: logObj.context,
            },
          });
        },
      },
    ]);

    await context.initialize();
  };

  server.close = async () => {
    await oldClose();
    await context.shutdown();
  };

  return server;
};
