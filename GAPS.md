# Feishu OpenAPI — AI Friendly Gaps Observed in This PoC

> Companion to `OBSERVATIONS.md`. While `OBSERVATIONS.md` analyzes the **ecosystem** (lark-cli backlog, lark-openapi-mcp Beta, peer MCP servers, MCP spec evolution), this file records the **concrete OpenAPI-level gaps** I hit while building the three capabilities in `src/core/tools/`.
>
> Format for each gap: what I observed → why it matters for an LLM consumer → how the PoC works around it → what a production fix would look like.

---

## 1. App identity vs user identity — semantic conflation

**Observed.** `tenant_access_token` authenticates as the application; `user_access_token` (via OAuth) authenticates as a user. Both can call the same calendar / messaging / bitable endpoints, but the *visible scope* differs dramatically — and the OpenAPI documentation describes endpoints with one identity model implicit, leaving the other to footnotes.

**Why it matters for LLMs.** When the LLM calls `feishu_search_events` with a `user_id`, it (and the dev who wrote the description) reasonably expects to read that user's events. With `tenant_access_token` only the bot's own primary calendar is visible. The LLM gets `events: []`, which is technically correct but semantically misleading — a recipe for hallucinated event titles.

**PoC workaround.** In `src/core/tools/search-events.ts`, the result envelope carries a `source_diagnostics.root_cause` label set to the literal string `"app_identity_vs_user_identity"`. The companion `recovery_hints[]` array surfaces two paths: `id: "use_busy_windows"` (actor: `mcp-caller`) to ground answers on the freebusy fallback, and `id: "switch_to_user_access_token"` (actor: `app-developer`) to fix the root cause.

**Production fix.** OpenAPI metadata should declare per-endpoint which identity model is supported, and *what each identity model can actually see*. A `visibility_under: ["tenant_access_token", "user_access_token"]` field per endpoint would let MCP servers degrade or escalate transparently.

---

## 2. `tenant_access_token` cannot read other users' calendar event details

**Observed.** `/calendar/v4/calendars/{calendar_id}/events/search` returns only the events the calling identity can see. With `tenant_access_token`, that's the bot's own primary calendar (typically empty) unless the bot is explicitly invited as an attendee or the calendar is shared with the bot via ACL.

**Why it matters for LLMs.** This is the trigger condition for #1 above. The LLM has no way to know from the endpoint signature alone that a `user_id` parameter does not grant cross-user visibility.

**PoC workaround.** When events come back empty, fall back to `/calendar/v4/freebusy/list` for the same user — which `tenant_access_token` *can* read — and return both arrays in one composite response.

**Production fix.** A first-class "read user calendar as bot" pattern, either through (a) automatic OAuth elevation when the bot has been granted the scope, or (b) an explicit `as_user: open_id` parameter that returns a structured permission error if the bot lacks the right.

---

## 3. Freebusy protocol intentionally omits event titles

**Observed.** `/calendar/v4/freebusy/list` returns `{start, end}` pairs without `summary`, `description`, `attendees`, or `event_id`. This is by design — the freebusy primitive is intended for "is this person available?" queries, not content disclosure.

**Why it matters for LLMs.** An LLM that's grounded only on busy windows can easily slip into inventing titles ("you have a *team standup* at 14:00"). The protocol limit is correct; the LLM-side guidance is the missing piece.

**PoC workaround.** The MCP tool description for `feishu_search_events` carries an explicit behavior contract: *"DO NOT invent event titles — say 'the user has a 30-min block at 周三 14:00'."* Combined with `human_label` on each busy window (e.g. `"周三 14:00-14:30"`), the LLM has a phrasing template it can copy.

**Production fix.** This is more of an MCP-side discipline than a Feishu-side fix. But it would help if the Feishu MCP server emitted freebusy results with a top-level `_disclaimer: "no_titles_by_protocol"` flag so naive LLM consumers cannot miss it.

---

## 4. Bitable `person` fields encoded as nested `[{name, email}]` arrays

**Observed.** A Bitable cell representing an assigned person is encoded as `[{name: "...", email: "..."}]` — array even when single-valued, no `open_id` in the cell payload. To match a Bitable row to a `user_id` (open_id), the consumer has to either (a) carry the user's display name and string-match against `name`, or (b) call `/contact/v3/users/{open_id}` to resolve the email and match against `email`.

**Why it matters for LLMs.** Adds 1-2 round trips per row just to filter "rows where this person is the owner". With 5-10 candidate rows, that's 10-20 extra LLM-driven calls, each a hallucination opportunity.

**PoC workaround.** `src/core/tools/user-recent-work.ts` takes an optional `user_name` argument to skip the profile lookup, and does the name/email matching server-side before returning. The LLM gets a clean `bitable_updates: [...]` of already-filtered rows.

**Production fix.** Bitable cells with person fields should include `open_id` directly. Server-side filtering on `assignee_open_id` should be a first-class query option.

---

## 5. Bitable date fields are millisecond timestamps

**Observed.** Date cells return integers like `1716365400000`. The LLM either has to do the conversion in-prompt (token-expensive, error-prone) or the consumer normalizes server-side.

**Why it matters for LLMs.** A response field named `updated_at: 1716365400000` is opaque to a model trying to summarize "recent work this week". The model will likely just echo the number or skip the field.

**PoC workaround.** `user-recent-work.ts` adds `updated_at_human: "2026-05-23"` alongside the raw timestamp, so the LLM has both a machine-stable field and a directly-readable one.

**Production fix.** Bitable APIs should optionally return both: `updated_at_ms` (machine) + `updated_at_iso` (LLM-readable). The cost is a few extra bytes; the savings in LLM token budget add up across thousands of rows.

---

## 6. `lark-openapi-mcp` Beta limitations (cross-reference)

**Observed.** Per the official README of `larksuite/lark-openapi-mcp`, the Beta does not yet support:
- File upload / download
- In-place editing of cloud documents (read / import work; edit-in-place does not)

**Why it matters for LLMs.** Two of the most natural Agent workflows — "summarize this PDF" and "edit this doc to add a section" — are not currently expressible through the official MCP. Consumers have to fall back to the raw HTTP API + manual token handling.

**PoC workaround.** This PoC does not attempt either flow; it inherits the same limitation. `ROADMAP.md` lists both as out-of-scope.

**Production fix.** Already on the official roadmap (per public framing). Worth tracking because once these land, several of the highest-value LLM use cases unlock.

---

## 7. Error codes lack inline `recovery_hint`

**Observed.** Feishu error responses follow the form `{code: 99991672, msg: "..."}`. The `msg` is human-readable but unstructured: it sometimes includes the missing scope name, sometimes a console URL, sometimes neither. Codes like `190007` (bot capability not enabled), `403` (permission denied), and the `99991672` family (scope missing) all require external lookup to recover from.

**Why it matters for LLMs.** Without a structured recovery path, every error becomes a dead end where the LLM either hallucinates a fix or surfaces a raw error to the user. The information needed to recover is *known to Feishu*; it's just not in the response.

**PoC workaround.** Both `src/cli/index.ts` and `src/mcp/server.ts` maintain a `mapHint(msg)` function that catches the common codes and emits a `recovery_hint` field on the way out. This is a band-aid — it duplicates knowledge that should live in the Feishu API response itself.

**Production fix.** Feishu OpenAPI error envelopes should include a `recovery_hint` (or equivalent) field at the source. Standardizing this across endpoints removes a per-consumer maintenance burden and ensures every MCP/CLI/SDK consumer recovers consistently.

---

## What this list is *not*

- **Not a critique.** Each gap is a normal byproduct of an API designed for human developers being repurposed for LLM consumption. The list exists so the design decisions in this PoC are reproducible and reviewable, not to score points.
- **Not exhaustive.** Three capabilities is a small sample. I would expect a fuller PoC (10+ capabilities across IM, Approval, Docs) to surface 20-30 gaps of similar shape.
- **Not in priority order.** #1 and #7 are the highest-leverage to fix because they affect every endpoint. #4 and #5 are the highest-frequency annoyances in any Bitable-heavy workflow.

## Cross-references

- `DESIGN_PHILOSOPHY.md` — the principles that drove each workaround
- `OBSERVATIONS.md` — ecosystem-level context (lark-cli / lark-openapi-mcp / peer MCP servers / MCP spec)
- `ROADMAP.md` — which of these gaps each PoC stage addresses
- `src/core/tools/search-events.ts` — concrete `RecoveryHint` interface and `source_diagnostics` shape that emerged from gaps #1, #2, #3
- `src/core/tools/user-recent-work.ts` — Bitable normalization for gaps #4, #5
- `src/cli/index.ts` + `src/mcp/server.ts` — `mapHint()` workaround for gap #7
