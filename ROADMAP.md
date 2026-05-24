# Roadmap

> What this PoC is planned to cover, what it is intentionally leaving out, and the order of operations. This is exploration material, not a product roadmap with deadlines.

## Goal

Demonstrate that a single capability set, exposed through both a CLI and an MCP server, can share one design discipline and produce a smooth experience for an AI assistant — using Feishu's open platform as the concrete substrate.

The PoC is "done" when:

1. Three capabilities work end-to-end on a real Feishu sandbox tenant.
2. Both surfaces (CLI + MCP) invoke the same core code and emit the same error structure.
3. Claude Desktop / Cursor / Claude Code can use the MCP surface to complete the demo scenario in `README.md` (preparing a weekly meeting brief) with zero hand-holding.

## Stage 1 — Core + CLI

Goal: get the foundation right.

- `src/core/feishu/` — Feishu OpenAPI client. Tenant access token acquisition with caching. Domain allowlist enforced (`*.feishu.cn`, `*.larksuite.com`). HTTPS-only.
- `src/core/capabilities/` — three capability functions:
  - `findCalendarEvent(query)` — find an upcoming meeting by natural-language description
  - `gatherAttendeeContext(eventId)` — for each attendee, pull recent Bitable rows + recent Docs they own
  - `composeBriefDocument(context)` — write a Markdown brief to a new Docs document
- `src/core/errors.ts` — typed error envelope: `{ error_code, message, recovery_hint, is_retryable, fallback_tool? }`
- `src/cli/` — commander-based CLI surface:
  - `feishu-bridge meeting find <query>`
  - `feishu-bridge meeting context <event-id>`
  - `feishu-bridge meeting brief <event-id>`
  - Auto-detect TTY → emit colored tables for humans, JSON for pipes
  - Respect `--json` override

Stage 1 exit: the three commands work against a real sandbox, and `meeting brief` produces a Docs document a human would actually use.

## Stage 2 — MCP surface

Goal: expose the same core through MCP without duplicating logic.

- `src/mcp/server.ts` — `@modelcontextprotocol/sdk`, stdio transport (HTTP later).
- **Tools** (mutating):
  - `feishu_meeting_brief` — composes the brief document. The MCP-side description follows the discipline in `DESIGN_PHILOSOPHY.md` principle #1 (LLM-targeted).
- **Resources** (read-only):
  - `feishu://users/me` — current authenticated user
  - `feishu://meetings/upcoming` — next 7 days of calendar events
  - `feishu://meetings/{eventId}/context` — pre-gathered attendee context
- Error responses use the same envelope as the CLI.
- Claude Desktop config snippet shipped in the README.

Stage 2 exit: a fresh user can install via `npm i -g`, add a single block to `claude_desktop_config.json`, and complete the demo scenario by typing one sentence to Claude.

## Stage 3 — Instrumentation and evals

Goal: stop guessing about whether the AI Friendly choices are working.

- `evals/` — a small harness that runs a fixed set of natural-language prompts through Claude (or any MCP-capable client) and records:
  - Did the task complete?
  - How many tool calls did it take?
  - Did the model retry? Why?
  - Did it hallucinate any parameters?
- The interesting outputs are the *failure modes*. They are the input to iterating on tool descriptions and error envelopes.

Stage 3 exit: I can change a tool description, re-run the evals, and see a measurable shift in task-completion rate or retry count.

## Stage 4 (exploratory) — Streamable HTTP + OAuth 2.1

Goal: get a feel for the remote, multi-user shape that the spec is moving toward.

- Replace stdio with the spec's Streamable HTTP transport.
- Implement OAuth 2.1 with PKCE + Protected Resource Metadata + Resource Indicators.
- Run the MCP server behind a small hosted endpoint (Cloudflare Workers or similar).
- Re-run Stage 3 evals to see what changes.

This stage is exploratory because it is genuinely non-trivial — the peer ecosystem (Notion, Linear, Atlassian) has converged on hosted remote MCP, but the implementation details are still evolving and there are real edge cases (token refresh, session resumption, multi-tenant isolation).

## Explicitly out of scope

- **Coverage** of Feishu's full OpenAPI surface. The official `larksuite/cli` and `larksuite/lark-openapi-mcp` do that. This PoC keeps the scope to three capabilities so the design discipline is the variable being studied.
- **File upload / download** flows. The official MCP server does not support these in Beta either; the PoC inherits that limitation.
- **In-place editing of cloud documents.** Same reason.
- **Multi-tenant deployments.** Single-tenant sandbox is enough to study the design questions.
- **A web UI / control panel.** CLI + MCP only.

## How this maps to the design principles

Each principle from `DESIGN_PHILOSOPHY.md` has a Stage where it gets exercised:

| Principle | First exercised in |
|---|---|
| 1. Tool descriptions written for the LLM | Stage 2 (MCP descriptions) |
| 2. Errors carry recovery hints | Stage 1 (error envelope) |
| 3. Read uses Resource, write uses Tool | Stage 2 (Resource/Tool split) |
| 4. Composite operations over fine-grained APIs | Stage 1 (`meeting brief` composes three operations) |
| 5. Tools collaborate, descriptions say so | Stage 2 (each tool description names its prerequisites) |

## A note on what would change for a real product

This is a PoC. If I were designing this for production, the things I would treat very differently:

- Token storage would not be on the filesystem; it would be in OS keychain / DPAPI / libsecret with explicit consent prompts.
- Error envelopes would carry `trace_id` and route into a real observability backend, not just a log file.
- The OAuth implementation would be reviewed by someone who has shipped one before (Resource Indicators are easy to misconfigure, and the consequences are real — token confusion across services).
- Tool composition would be evaluated against a much larger eval set, not the dozen prompts Stage 3 ships with.

This list is here so that the PoC's simplifications are deliberate, not blind spots.
