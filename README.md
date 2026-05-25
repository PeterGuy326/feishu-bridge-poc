# Feishu Bridge

> A PoC exploring how collaboration tools should be redesigned for the **AI Agent era**.

![demo](./assets/demo.gif)

*One core. Two surfaces (CLI + MCP). Real Feishu data, real meeting brief — in 30 seconds.*

[![status](https://img.shields.io/badge/status-v0.2.0-green)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()

## What is this

A small TypeScript library that lets AI tools (Claude Desktop, Cursor, Claude Code...) use Feishu in a natural way.

Same business core, **two surfaces**:

- **CLI form** — `feishu-bridge ...`, callable from any AI that can spawn a shell
- **MCP form** — exposes the same capabilities as MCP tools

Both share the same AI Friendly design philosophy.

## Why two forms

I was using Claude Code and noticed something: even when GitHub MCP exists, Claude often falls back to invoking `gh` CLI for GitHub tasks. CLI was already installed, already authenticated, zero config.

That reframed my mental model of AI Friendly:

> **AI Friendly is not about which protocol you pick. It's about whether AI can use your product smoothly — through whatever surface is available.**

So this PoC implements the same capabilities twice — as a CLI and as an MCP server — to prove the underlying design philosophy is what matters, not the protocol.

## The full demo narrative

The user types into Claude Desktop:

> "Help me prepare for this week's team meeting."

Behind the scenes:

### Step 1 — `feishu_search_events(query="周会")`

Claude calls the search-events tool. The bot's `tenant_access_token` can only see the bot's own primary calendar (empty) — but **search-events gracefully degrades**: it queries `/calendar/v4/freebusy/list` for the user's busy windows (which `tenant_access_token` CAN read), and returns a composite payload:

```jsonc
{
  "events": [],                              // bot doesn't have detail access
  "busy_windows": [                          // …but it can see WHEN the user is busy
    { "human_label": "周三 14:00-14:30", "duration_minutes": 30, ... },
    { "human_label": "周四 15:00-16:00", "duration_minutes": 60, ... },
    { "human_label": "周五 16:00-17:00", "duration_minutes": 60, ... }
  ],
  "source_diagnostics": {
    "root_cause": "app_identity_vs_user_identity: bot is authenticated as
      application identity ou_6687… and sees only its OWN primary calendar
      via tenant_access_token. The user has 10 busy windows visible via
      /freebusy/list, but Feishu's freebusy protocol intentionally omits
      summaries. Detailed event read requires either (a) the bot is added
      as an attendee, (b) the user shares the calendar via ACL, or (c) the
      app uses user_access_token (OAuth) instead."
  },
  "recovery_hints": [
    { "id": "use_busy_windows",       "actor": "mcp-caller",    ... },
    { "id": "switch_to_user_access_token", "actor": "app-developer", ... }
  ]
}
```

Claude reads the description contract ("don't fabricate titles when only busy_windows are present") and responds:

> "I see you're busy 周三 14:00-14:30 and 周四 15:00-16:00. Which one did you mean?"

### Step 2 — `feishu_user_recent_work(user_id="ou_3de3...")`

Once the user confirms, Claude calls the recent-work aggregator. **One composite call** pulls all 5 project-tracker rows from a real Bitable, normalizes the schema (Feishu Bitable encodes person fields as arrays of `{name, email}`, dates as ms timestamps, etc.), and returns:

```jsonc
{
  "user": { "open_id": "ou_3de3…", "name": "胡奕舟" },
  "bitable_updates": [
    { "title": "权限模块设计",     "status": "进行中", "updated_at_human": "2026-05-23", ... },
    { "title": "登录组件重构",     "status": "已完成", "updated_at_human": "2026-05-22", ... },
    { "title": "移动端适配",       "status": "进行中", "updated_at_human": "2026-05-20", ... },
    { "title": "监控大盘搭建",     "status": "阻塞",   "updated_at_human": "2026-05-18", ... },
    { "title": "文档同步工具",     "status": "已完成", "updated_at_human": "2026-05-15", ... }
  ],
  "source_diagnostics": { "docx": "Skipped: drive scope not yet granted — see OBSERVATIONS.md" }
}
```

### Step 3 — Claude composes the brief

Claude reads the JSON and writes:

```markdown
# 前端团队周会 预读

## 本周完成 (2)
- ✅ 登录组件重构 (2026-05-22) — OAuth 2.1 改造,接入 Device Flow
- ✅ 文档同步工具 (2026-05-15) — 已上线 v1.0,日均同步 2000+ 文档

## 本周进行中 (2)
- 🔄 权限模块设计 (2026-05-23) — RBAC 方案评审中,本周完成 PRD
- 🔄 移动端适配  (2026-05-20) — iOS/Android/H5 三端兼容验证

## 风险项 (1)
- 🚧 监控大盘搭建 【阻塞】(2026-05-18) — 等运维资源
```

A task that takes a human ~1 hour. AI does it in ~10 seconds.

See `examples-meeting-brief.md` for the actual generated output.

## Five AI Friendly principles this PoC embodies

1. **Tool descriptions are written for the LLM**, not for human developers — see how `feishu_search_events`'s description explicitly says *"DO NOT invent event titles — say 'the user has a 30-min block at 周三 14:00'"* (`src/mcp/server.ts`)
2. **Errors carry structured recovery hints** (`error_code`, `recovery_hint`, `is_retryable`, plus actor-tagged `recovery_hints[]`) so the LLM can self-correct or surface the dev-side fix
3. **Composite operations over fine-grained APIs** — `feishu_user_recent_work` is one call that internally fans out across Bitable / (future) Docx / IM
4. **Tools collaborate** — each description explicitly names the next tool to chain into (`search_events → get_attendees → user_recent_work`)
5. **Graceful degradation with self-explanation** — when the bot lacks visibility, `source_diagnostics` and `recovery_hints` tell the LLM *exactly why* and *what to try next*, instead of returning `events: []`

## Repository layout

```
src/
  core/
    client.ts            # Feishu API client (token cache + freebusy + calendar + bitable)
    load-env.ts          # zero-dep .env loader (auto-loaded by CLI and MCP)
    types.ts
    tools/               # the 3 capability functions, single source of truth
      search-events.ts   # composite: bot events + user freebusy + diagnostics
      user-recent-work.ts# composite: bitable rows + (future) docx
      get-attendees.ts   # event attendees enriched with user profile
  cli/index.ts           # CLI surface (commander)
  mcp/server.ts          # MCP surface (@modelcontextprotocol/sdk)

assets/
  demo.gif               # the 30-second demo GIF
  demo.tape              # vhs source — `vhs assets/demo.tape` to re-record
```

## Quick start

```bash
# 1. install
npm install

# 2. configure (one-time) — auto-loaded by both CLI and MCP
cp .env.example .env
# Fill in:
#   FEISHU_APP_ID
#   FEISHU_APP_SECRET
#   FEISHU_PROJECT_BITABLE_APP_TOKEN  (required for user-recent-work)
#   FEISHU_PROJECT_BITABLE_TABLE_ID
#   FEISHU_USER_OPEN_ID               (optional — fallback for search-events)

# 3. build
npm run build

# 4. smoke test
node dist/cli/index.js ping
# => {"ok":true,"message":"feishu-bridge CLI is alive","version":"0.2.0"}

# 5. real query — composite call returns 5 bitable rows
node dist/cli/index.js user-recent-work --user-id ou_xxxxxxxxxxxxxxxx --days 14

# 6. search-events with freebusy fallback — see source_diagnostics
node dist/cli/index.js search-events --query 周会 --user-id ou_xxxxxxxxxxxxxxxx
```

## Wire up to Claude Desktop (MCP)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "feishu-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-bridge-poc/dist/mcp/server.js"],
      "env": {
        "FEISHU_APP_ID": "cli_xxxxxxxxxxxxxxxx",
        "FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "FEISHU_PROJECT_BITABLE_APP_TOKEN": "xxxxxxxxxxxxxxxxxx",
        "FEISHU_PROJECT_BITABLE_TABLE_ID": "tblxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart Claude Desktop. You should see `feishu_search_events`, `feishu_get_attendees`, `feishu_user_recent_work`, and `feishu_ping` available.

## Status (v0.2.0)

| Surface | What works today |
|---------|------------------|
| Core | token cache · 7 verified endpoints · zero-dep .env loader |
| CLI | `ping` · `whoami` · `search-events` · `get-attendees` · `user-recent-work` |
| MCP | `tools/list` · all 4 tools callable · structured error envelope with `recovery_hint` |
| End-to-end | Bitable: ✅ 5 real records · Calendar: ✅ 10 real freebusy windows via fallback |

## What this PoC is intentionally *not*

See `ROADMAP.md` → "Explicitly out of scope". Notably: docx writeback, full Feishu API surface coverage, OAuth/user_access_token (would unlock event titles — captured as a `recovery_hint`).

## Companion docs

- `DESIGN_PHILOSOPHY.md` — the five principles, expanded
- `OBSERVATIONS.md` — 7 AI Friendly gaps in the real Feishu OpenAPI I hit during this PoC
- `ROADMAP.md` — stages, exit criteria, out-of-scope list

## License

MIT
