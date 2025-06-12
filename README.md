## devvit-mcp

A companion MCP server for writing applications on Reddit's developer platform.

## Installation

Add the following to your `mcp.json` for the editor or LLM of choice.

```json
{
  "mcpServers": {
    "devvit-mcp": {
      "command": "npx",
      "args": ["-y", "@devvit/mcp"]
    }
  }
}
```

## Opting Out Of Telemetry

```json
{
  "mcpServers": {
    "devvit-mcp": {
      "command": "npx",
      "args": ["-y", "@devvit/mcp"],
      "env": {
        "DEVVIT_DISABLE_METRICS": "true"
      }
    }
  }
}
```

## Developing on the MCP Server

```sh
git clone git@github.com:reddit/devvit-mcp.git

cd devvit-mcp

nvm use

npm install

npm run dev
```

If you want to test your MCP server inside of other projects. Pass in the entire path to your node runtime and the location of `/dist/index.js` on your machine.

- Node path: `which node`
- Dist: `pwd` from the root of your `devvit-mcp` + `/dist/index.js`

```ts
{
  "mcpServers": {
    "devvit-mcp": {
      "command": "/Users/marcus.wood/.nvm/versions/node/v22.13.0/bin/node",
      "args": ["/Users/marcus.wood/open-source/devvit-mcp/dist/index.js"]
    }
  }
}
```

## MCP Gotchas

- Never put a `console.log` in the hot path of your app if you're trying to debug. You'll see weird error messages like `Unexpected token 'a', " at Anthrop"... is not valid JSON`. We've shimmed `logger` to automatically handle this conversion for you.
- Only log console.error in your MCP when running through MCP.

### Debugging

- Using `npm run dev`, going to tools, listing them out, and triggering is the best experience.
- To test this live with logs, use [Claude desktop](https://modelcontextprotocol.io/quickstart/user) and connecting the MCP there. They have log files that report errors on your machine. You can view them by opening in VSCode or running `tail` commands.

- If you see something like this:

```
Error: Server does not support logging (required for notifications/message)
    at Server.assertNotificationCapability
```

You need to add the capability to your `new MCPServer`. [Use this permalink](https://github.com/modelcontextprotocol/typescript-sdk/blob/1909bbcc671b00431579ea15c7713082406b1005/src/server/index.ts#L146) to know what key you should add.

## Credits

Huge thanks to Arabold for open sourcing [docs-mcp-server](https://github.com/arabold/docs-mcp-server). Portions of this code is heavily inspired by this library. Please use it if you need other docs servers!
