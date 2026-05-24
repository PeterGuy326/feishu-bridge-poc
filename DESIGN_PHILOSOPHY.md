# Design Philosophy

> Notes on the design choices behind this PoC. The goal here is to make explicit *why* the same business core is exposed through both a CLI and an MCP server, and what "AI Friendly" actually means in practice.

## The thesis in one paragraph

AI Friendly is not "which protocol you pick". It is whether an AI can use your product smoothly through *whatever* surface happens to be available — installed CLI, MCP server, raw HTTP, a Python SDK. A SaaS product that bets on a single protocol is brittle; one that designs the same capabilities to be usable across surfaces is robust. This PoC implements one capability set across two surfaces (CLI + MCP) to prove that the underlying design discipline is what carries.

## The piece of evidence that started this

Using Claude Code on real GitHub tasks, I noticed something I had not expected:

> Even when an MCP server exists for a service, the assistant often falls back to spawning the official CLI.

For GitHub specifically, in environments that do not have GitHub MCP configured, Claude Code will reach for `gh` directly. `gh` is already installed, already authenticated, has zero configuration cost. The CLI is not the "old form being replaced by MCP" — it is the most universally available form of a service, and assistants treat it as a first-class capability source.

The conclusion I drew: a SaaS product should not ask "should we do CLI or MCP?". It should ask "can an AI reach this capability through *any* of the surfaces we ship, without surprises?". Both surfaces matter, and both should share the same design discipline.

## Five principles this PoC tries to embody

### 1. Tool descriptions are written for the LLM, not for human developers

Traditional API doc: "Update a record."
LLM-targeted description: "Use when the user asks to modify an existing item *and* you already have its `record_id`. Requires `record_id` from `search_records`. Has side effects (mutates remote state); the host will typically ask the user to confirm. Returns the updated record with a `last_modified_at` you can show as confirmation."

The difference is not stylistic. The LLM does not have the implicit context a human developer has. Every assumption a human reader would fill in needs to be either stated, or the tool needs to be designed so the assumption does not exist.

### 2. Errors carry recovery hints

Traditional error response:

```
HTTP 404: user not found
```

LLM-recoverable error response:

```json
{
  "error_code": "user_not_found",
  "message": "No user matches the provided identifier.",
  "recovery_hint": "If you only have a name, call `search_user` first to resolve a user_id.",
  "is_retryable": false,
  "fallback_tool": "search_user"
}
```

The first form tells the LLM "something is wrong". The second form tells the LLM "here is what to do next". The difference is the difference between a tool that requires a human in the loop on every failure and a tool an autonomous agent can actually use.

### 3. Read uses Resource, write uses Tool

MCP separates `Resources` from `Tools` from `Prompts`. This split is not for tidiness — it is a decision-risk classification for the LLM:

- **Resources** are read-only and URI-addressable. The host can attach them to context without prompting the user.
- **Tools** have side effects. The host typically asks the user to confirm before invocation.
- **Prompts** are user-driven templates, not model-driven.

A lot of MCP servers expose everything as Tools because Tools are what most clients support. That works, but it taxes the user (constant confirmation prompts) and the model (must reason about side effects on every call). Where a capability is genuinely read-only, expressing it as a Resource is the right shape.

### 4. Composite operations over fine-grained APIs

A REST API is often designed for maximum composability — one resource, one endpoint, atomic operations. Clients then orchestrate workflows by chaining calls.

For an LLM, that orchestration cost is real. Each additional tool call is another round trip, another opportunity to hallucinate a parameter, another chance for a transient failure to derail the task. There is now enough public evidence (e.g. published numbers on tool-selection accuracy degrading past roughly 20–30 tools) that the tool count itself becomes a design liability.

The shape that works better for LLM consumption: fewer, more semantic tools. `create_document` that internally creates → writes initial content → sets default permission, exposed as one tool, with the composition documented in the description. The LLM picks one tool, the server does the orchestration.

### 5. Tools collaborate — and the description says so

If `send_message` requires a `user_id` and `search_user` is the way to get one, the description of `send_message` should say so explicitly:

> Use when sending a Feishu message to a known user or group. Requires `user_id` (from `search_user`) or `chat_id` (from `search_chat`).

This is how the LLM learns the call graph without needing to call `list_tools` and reason from names. The graph is encoded in the descriptions themselves.

## What the CLI and the MCP share

In this PoC, both surfaces are built on top of a single core:

```
src/core/    -- Feishu API client + 3 capability functions (pure logic)
src/cli/     -- commander-based CLI surface (human + shell + fallback agent)
src/mcp/     -- @modelcontextprotocol/sdk surface (native AI tool integration)
```

Both surfaces:

- Use the same capability functions (no duplication of business logic)
- Emit the same error envelope structure (`error_code` + `recovery_hint`)
- Document the same call graph
- Are tested against the same Feishu sandbox

Both surfaces *differ* in their idiomatic concerns:

- The CLI ships colored, table-formatted output by default for human readers; emits JSON when `--json` is set or stdout is not a TTY (so scripts and assistants get structured data automatically).
- The MCP server exposes the read-only capabilities as Resources (`feishu://users/me`, `feishu://contacts/recent`) and the mutating capabilities as Tools.

## What this PoC is deliberately *not* trying to be

- **Not** an exhaustive Feishu API wrapper. Feishu has hundreds of endpoints. Three carefully designed capabilities make the design point. Coverage is a separate axis.
- **Not** a replacement for the official `larksuite/cli` or `larksuite/lark-openapi-mcp`. Those are real, mature, well-maintained products. This PoC explores design discipline; the official products carry the production load.
- **Not** opinionated about transport beyond what the spec recommends. stdio for now, HTTP later, with the same capability surface across either.

## Further reading

- The MCP specification: <https://modelcontextprotocol.io/>
- Anthropic on writing effective tools for AI agents: <https://www.anthropic.com/engineering/writing-tools-for-agents>
- See `OBSERVATIONS.md` in this repo for analytical notes on the Feishu open-platform AI Friendly ecosystem.
- See `ROADMAP.md` in this repo for the PoC's planned scope.
