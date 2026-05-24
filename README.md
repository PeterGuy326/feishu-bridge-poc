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

## Repository layout (planned)

```
src/
  core/          # shared business logic (Feishu API client + 3 capability functions)
  cli/           # CLI surface — commander-based
  mcp/           # MCP surface — @modelcontextprotocol/sdk
```

## Status

Work in progress. Built over a weekend as exploration material.

## License

MIT
