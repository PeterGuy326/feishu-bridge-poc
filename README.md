# Feishu Bridge

> A PoC exploring how collaboration tools should be redesigned for the **AI Agent era**.

[![status](https://img.shields.io/badge/status-WIP-yellow)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()

## What is this

A small TypeScript library that lets AI tools (Claude Desktop, Cursor, Claude Code...) use Feishu in a natural way.

Same business core, **two surfaces**:

- **CLI form** — `feishu-bridge ...`, callable from any AI that can spawn a shell
- **MCP form** — exposes the same capabilities as MCP tools / resources

Both share the same AI Friendly design philosophy.

## Why two forms

I was using Claude Code and noticed something: even when GitHub MCP exists, Claude often falls back to invoking `gh` CLI for GitHub tasks. CLI was already installed, already authenticated, zero config.

That reframed my mental model of AI Friendly:

> **AI Friendly is not about which protocol you pick. It's about whether AI can use your product smoothly — through whatever surface is available.**

So this PoC implements the same capabilities twice — as a CLI and as an MCP server — to prove the underlying design philosophy is what matters, not the protocol.

## Demo scenario

Tell Claude:

> "Help me prepare for next Monday's team weekly meeting."

The Bridge lets Claude:

1. Find the meeting in your Feishu calendar
2. Look up each attendee's recent work — across Bitable (project tracker) and Docx (recent documents)
3. Generate a complete pre-read Markdown brief

A task that takes a human ~1 hour. AI does it in ~10 seconds.

## Five AI Friendly principles this PoC tries to embody

1. **Tool descriptions are written for the LLM**, not for human developers
2. **Errors carry recovery hints**, so the LLM can self-correct instead of asking the human
3. **Read uses Resource, write uses Tool** — leveraging MCP's built-in risk classification
4. **Composite operations over fine-grained APIs** — fewer, more semantic tools beat many granular ones
5. **Tools collaborate** — the description of each tool explicitly says which other tools it pairs with

## Repository layout

```
src/
  core/                  # shared business logic
    client.ts            # Feishu API client (token cache + request helper)
    types.ts             # shared interfaces
    tools/               # the 3 capability functions
      search-events.ts
      user-recent-work.ts
      get-attendees.ts
  cli/index.ts           # CLI surface — commander
  mcp/server.ts          # MCP surface — @modelcontextprotocol/sdk
```

## Quick start

```bash
# 1. install
npm install

# 2. configure (one-time)
cp .env.example .env
# fill in FEISHU_APP_ID and FEISHU_APP_SECRET

# 3. build
npm run build

# 4. try the CLI
node dist/cli/index.js ping
# => {"ok":true,"message":"feishu-bridge CLI is alive","version":"0.1.0"}

node dist/cli/index.js whoami --open-id ou_xxxxxxxxxxxxxxxx
# => fetches the user profile (proves your APP_ID/SECRET work)
```

### Wire up to Claude Desktop (MCP)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "feishu-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-bridge-poc/dist/mcp/server.js"],
      "env": {
        "FEISHU_APP_ID": "cli_xxxxxxxxxxxxxxxx",
        "FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a `feishu_ping` tool available.

## Status

| Surface | What works today | What lands next |
|---------|------------------|-----------------|
| Core client | token cache + `getUser` + `getDocRawContent` + `listBitableRecords` (all verified against real Feishu OpenAPI) | richer error mapping with recovery hints |
| CLI | `ping`, `whoami --open-id <id>`, `--version`, `--help` | `search-events`, `user-recent-work`, `get-attendees` subcommands |
| MCP | initialize handshake + `tools/list` + `feishu_ping` tool | register the 3 real tools with AI-Friendly descriptions and disambiguation hints |

## License

MIT
