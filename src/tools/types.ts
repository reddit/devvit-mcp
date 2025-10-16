import { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { ImageContent } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';
import { Context } from '../utils/context';

export type ToolResult = {
  content: (ImageContent | TextContent)[];
  isError?: boolean;
};

export type Tool<T extends z.AnyZodObject = z.AnyZodObject> = {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: { params: z.infer<T>; context: Context }) => Promise<ToolResult>;
};

// Needed for automatic type inference
export const createTool = <T extends z.AnyZodObject>(args: {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: { params: z.infer<T>; context: Context }) => Promise<ToolResult>;
}): Tool<T> => args;
