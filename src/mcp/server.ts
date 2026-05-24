#!/usr/bin/env node
/**
 * Feishu Bridge — MCP server surface.
 *
 * Exposes Feishu capabilities as MCP tools / resources, callable by
 * Claude Desktop, Cursor, Claude Code, and any MCP-compatible client.
 *
 * Tonight: boilerplate that compiles, registers, and connects on stdio.
 * Monday:  fill in tool definitions for search_events / user_recent_work /
 *          get_attendees, each with AI Friendly descriptions and error
 *          recovery hints.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "feishu-bridge",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// TODO (Mon): register feishu_search_events, feishu_user_recent_work,
//             feishu_get_attendees here. See src/core/tools/*.ts for signatures.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "feishu_ping",
      description:
        "Sanity-check tool. Returns a fixed payload to verify the server is reachable.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "feishu_ping") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            server: "feishu-bridge",
            version: "0.1.0",
            message:
              "MCP server is reachable. Real tools land in v0.2 (see TODOs).",
          }),
        },
      ],
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "tool_not_implemented",
          tool: req.params.name,
          hint: "This tool is planned but not yet implemented. See TODO in src/mcp/server.ts.",
        }),
      },
    ],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[feishu-bridge] MCP server connected on stdio");
}

main().catch((err) => {
  console.error("[feishu-bridge] fatal:", err);
  process.exit(1);
});
