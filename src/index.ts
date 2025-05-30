#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';
import { logger } from './utils/logger';

const server = createServer();

await server.connect(new StdioServerTransport()).catch(logger.error);
