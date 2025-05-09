import z from 'zod';
import { createTool } from './types';

export const helloWorldTool = createTool({
  name: 'hello-world',
  description: 'A tool that says hello to the world',
  inputSchema: z.object({
    name: z.string(),
  }),
  handler: async ({ params }) => {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${params.name}!`,
        },
      ],
    };
  },
});
