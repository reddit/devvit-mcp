#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';
import { logger } from './utils/logger';

const server = createServer();

// Handle graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
const gracefulShutdown = async (signal: string) => {
  logger.log(`Received ${signal}, shutting down gracefully...`);
  try {
    await server.close();
    logger.log('Server shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

await server.connect(new StdioServerTransport()).catch(logger.error);
