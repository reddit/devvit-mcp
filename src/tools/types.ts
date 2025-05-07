import { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { ImageContent } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';

export type ToolResult = {
  content: (ImageContent | TextContent)[];
  isError?: boolean;
};

export type Tool<T extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: { params: z.infer<T> }) => Promise<ToolResult>;
};

// Needed for automatic type inference
export const createTool = <T extends z.ZodObject>(args: {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: { params: z.infer<T> }) => Promise<ToolResult>;
}): Tool<T> => args;
