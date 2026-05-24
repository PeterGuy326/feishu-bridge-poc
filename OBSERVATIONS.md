# Observations on the Feishu AI Friendly Ecosystem

> Analytical notes compiled while researching the Feishu open-platform AI Friendly landscape in May 2026. Sources are linked at the end. This is observation, not critique — the intent is to capture where the ecosystem is right now so the PoC can be designed in context.

## Feishu's AI Friendly trajectory

Feishu has been moving on AI integration for over a year:

- **2025-04-17** — `larksuite/lark-openapi-mcp` repository goes public. TypeScript MCP server wrapping the open-platform OpenAPI. Latest published version at time of writing: v0.5.1 (2025-08-06).
- **2025-07-09** — Public launch of Knowledge Q&A and several other AI products. Public framing: "choosing Feishu is choosing an enterprise AI partner you can trust long-term."
- **2025-11** — Open-platform documentation site adds the `/mcp_integration/` section, positioning traditional OpenAPI as upgrading into "LLM-tailored tool-based capabilities", with remote invocation as the recommended mode and local deployment as fallback.
- **2026-03-19** — Enterprise Agent suite announced; the `aily` agent platform upgrade lands the same week as DingTalk's Wukong announcement.
- **2026-04-23** — "AI Friendly" strategy formally announced as an open-platform direction. Public metric quoted: daily OpenAPI call volume grew from 5M to 23M.

The pattern is consistent: invest in the protocol layer first (MCP server, documentation rework), then in the runtime layer (aily, enterprise Agent suite), then make the AI Friendly framing explicit as a public strategy.

## State of `larksuite/cli`

The official Feishu CLI is a substantial product:

- ~12.5k stars, ~830 forks, ~150 open issues (May 2026 snapshot)
- Latest release v1.0.39, active maintenance
- 200+ commands across Messenger, Docs, Base, Sheets, Calendar, Mail, Tasks, Meetings
- 26 built-in Agent Skills, distributable globally or per-project (per-project still in flux per open issues)
- Three-layer architecture: high-level Shortcuts (LLM-friendly) → API Commands → raw API
- Go core distributed via npm (`@larksuite/cli`)

The open-issue list reveals where the team's backlog is concentrated. Several recurring themes I noted (paraphrased so as not to misquote individual issues):

- **Bitable metadata vs UI configuration gap** — some configurations available through the Feishu UI are not retrievable through the metadata API. This is the kind of fragmentation that hits agentic workflows hardest because the agent ends up working with incomplete state.
- **Lark (international) vs Feishu (domestic) feature parity** — Mail and a few other modules behave differently across the two SKUs. A genuine challenge for any global enterprise SaaS CLI.
- **Skill scoping** — installation is global today; project-level isolation is a recurring request. Important for multi-tenant developer workflows.
- **Card callbacks** — some interaction events on the messaging side are not yet consumable.

None of these are surprising for a product of this scope — they are the natural backlog of any large CLI surface. The interesting thing is that addressing them is high-leverage *for AI Friendly* specifically, because each one is exactly the kind of capability hole an autonomous agent stumbles into.

## State of `larksuite/lark-openapi-mcp`

The official MCP server is a smaller, more focused codebase:

- ~700 stars, active TypeScript codebase
- Wraps the OpenAPI surface as MCP tools
- Designed to be opted-in selectively: a `preset.calendar.default`-style preset gets you a sensible default toolset; `-t im.v1.message.create` lets you cherry-pick a specific endpoint
- One-click install paths for Claude / Cursor / Trae

Documented Beta limitations (per the README) include:

- No file upload/download
- No direct editing of cloud documents (read and import work; in-place editing does not)

The authentication model today is App ID / App Secret — a bot-style credential rather than a user-level OAuth flow. Deployment is local Node, not hosted.

## How Feishu compares to peer MCP servers

Looking at the broader MCP server landscape (rough state, May 2026):

| Vendor | Deployment | Tool count (approx) | Auth | Design notes |
|---|---|---|---|---|
| **Notion** | Hosted + open-source local | 18 hosted / 22 local | OAuth 2.1, explicitly rejects bearer tokens for headless agents | OpenAPI → Zod codegen; emphasizes "round-trip fidelity" so a `read_page` result can be fed back into `create_page` directly |
| **Linear** | Remote only (`mcp.linear.app/mcp`) | 22–25 | OAuth 2.1 via Cloudflare hosting | Public reference implementation of an authenticated remote MCP |
| **Atlassian (Rovo)** | Remote (`mcp.atlassian.com/v1/mcp`) | ~25 | OAuth 2.1, no caching, strict inheritance of user permissions | Jira + Confluence + Compass behind one endpoint |
| **Slack** | Official server | smaller surface | OAuth | Positioned as a context provider rather than a heavy-write surface |
| **Feishu** | Local Node | Comprehensive (preset-gated) | App ID / Secret | Strong API coverage; user-OAuth + hosted remote MCP appears to still be ahead on the roadmap |

The common direction the peer set is converging on:

1. Hosted remote MCP rather than user-installed local servers
2. OAuth 2.1 (with PKCE, Resource Indicators, Protected Resource Metadata) rather than long-lived bot tokens
3. Tool surfaces tuned for LLM consumption rather than 1:1 mirroring of REST endpoints

This is roughly the same direction Feishu's `lark-openapi-mcp` will plausibly need to head, and is genuinely interesting territory because the OAuth 2.1 + Resource Indicators piece in particular is non-trivial.

## State of the MCP spec itself

A few notes on the spec's evolution that are worth knowing if you are designing a server today:

- The **Streamable HTTP transport** (introduced in the 2025-03-26 spec) is now the recommended HTTP transport; the older HTTP+SSE pair is deprecated and several vendors (e.g. Atlassian) have already posted deprecation notices. The 2026-07-28 release candidate refines this further with stateless protocol semantics plus method/name headers that let HTTP gateways route without parsing the body.
- The **Authorization spec** has firmed up around OAuth 2.1 draft-13: PKCE is required, Protected Resource Metadata (RFC 9728) is used for discovery, and Resource Indicators (RFC 8707) help prevent the confused-deputy problem. Dynamic Client Registration is a SHOULD, not a MUST — which is where a lot of enterprise server implementations are independently inventing answers.
- **Sampling** (server-initiated `sampling/createMessage` calls) has been deprecated in DRAFT-2026-v1 with a one-year migration window. Most hosts never implemented it; the recommended replacement is **Elicitation**, where the server pauses a tool call and asks the user (through the host) to provide structured input.
- **Resource subscriptions** are spec-complete but client support remains uneven, and in practice most production servers fall back to client-driven polling.

If I am designing a new MCP server today, I would build assuming Streamable HTTP, OAuth 2.1 with Resource Indicators, Elicitation in place of Sampling, and treat Resource subscriptions as a nice-to-have rather than a load-bearing feature.

## Sources

- Feishu open-platform MCP overview — <https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction>
- `larksuite/cli` — <https://github.com/larksuite/cli>
- `larksuite/lark-openapi-mcp` — <https://github.com/larksuite/lark-openapi-mcp>
- Feishu enterprise Agent suite (2026-03) — <https://www.qbitai.com/2026/03/389311.html>
- Feishu AI Friendly strategy upgrade (2026-04) — <https://www.qbitai.com/2026/04/406026.html>
- MCP 2026-07-28 release candidate notes — <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- MCP authorization spec — <https://modelcontextprotocol.io/specification/draft/basic/authorization>
- MCP transports spec (2025-03-26) — <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Anthropic — Writing effective tools for AI agents — <https://www.anthropic.com/engineering/writing-tools-for-agents>
- Notion hosted MCP server, inside look — <https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look>
- Linear MCP changelog — <https://linear.app/changelog/2025-05-01-mcp>
- Atlassian remote MCP server — <https://www.atlassian.com/blog/announcements/remote-mcp-server>
