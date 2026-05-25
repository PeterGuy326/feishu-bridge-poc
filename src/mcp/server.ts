#!/usr/bin/env node
/**
 * Feishu Bridge — MCP server surface.
 *
 * Exposes Feishu capabilities as MCP tools, callable by Claude Desktop,
 * Cursor, Claude Code, and any MCP-compatible client.
 *
 * Design discipline (from DESIGN_PHILOSOPHY.md):
 *   1. Tool descriptions are written for the LLM, not for human developers.
 *   2. Errors carry recovery_hint so the LLM can self-correct.
 *   3. Composite operations > fine-grained APIs.
 *   4. Tools collaborate — each description names what to call next.
 */
import { loadEnv } from "../core/load-env.js";
loadEnv();
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FeishuClient } from "../core/client.js";
import { searchEvents } from "../core/tools/search-events.js";
import { getAttendees } from "../core/tools/get-attendees.js";
import { userRecentWork } from "../core/tools/user-recent-work.js";

const server = new Server(
  { name: "feishu-bridge", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

const TOOL_DEFINITIONS = [
  {
    name: "feishu_ping",
    description:
      "Sanity-check tool. Returns a fixed payload to verify the server is reachable. Call this first when debugging connection issues.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "feishu_search_events",
    description:
      "Find calendar events in a Feishu user's primary calendar matching a natural-language query " +
      '(e.g. "下周一周会", "1:1", "评审"). Looks ahead up to `time_range_days` from now (default 7).\n\n' +
      "Returns a composite result, NOT just events:\n" +
      "  • `events`: full event detail (event_id, summary, start, end) — populated when the bot is a " +
      "viewer/attendee of the calendar.\n" +
      "  • `busy_windows`: coarse-grained freebusy slots on the target user's calendar — time-only " +
      "(no summary) by Feishu protocol, but ALWAYS readable with tenant_access_token + user_id.\n" +
      "  • `source_diagnostics`: bot identity vs requested user identity, plus a root_cause label.\n" +
      "  • `recovery_hints`: ordered, actor-tagged next steps when events is empty — read these " +
      "and either retry with different args or surface the dev-side fix to the user.\n\n" +
      "Behavior contract:\n" +
      "  • If `events` is non-empty, treat as authoritative.\n" +
      "  • If `events` is empty but `busy_windows` is non-empty, ground answers on busy windows. " +
      "DO NOT invent event titles — say 'the user has a 30-min block at 周三 14:00'.\n" +
      "  • If `disambiguation_hint` is present, ASK THE USER which one rather than guessing.\n\n" +
      "Typical next step: pass the chosen `event_id` (when present) to `feishu_get_attendees`.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Free-text search, matched against event summary and description (case-insensitive). Examples: "周会", "1:1", "评审", "OKR".',
        },
        time_range_days: {
          type: "number",
          description: "How many days forward from now to search. Default: 7.",
          default: 7,
        },
        user_id: {
          type: "string",
          description:
            "open_id of the user whose calendar to probe for busy_windows. " +
            "Optional — falls back to FEISHU_USER_OPEN_ID env. " +
            "Required when the bot is not a viewer of the target calendar and you want freebusy fallback.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "feishu_get_attendees",
    description:
      "List attendees of a specific calendar event, enriched with each person's name and email.\n\n" +
      "Returns `attendees` (full structured list) plus `human_open_ids` — a flat array of " +
      "open_ids for human attendees. **Fan out `human_open_ids` into `feishu_user_recent_work` " +
      "to build a meeting brief.**\n\n" +
      "Typical chain: feishu_search_events → feishu_get_attendees → feishu_user_recent_work (per attendee).",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "event_id from `feishu_search_events` output.",
        },
        calendar_id: {
          type: "string",
          description:
            "Optional. Defaults to the caller's primary calendar. Provide only when the event is on a shared/team calendar.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "feishu_user_recent_work",
    description:
      "Aggregate a user's recent work across Feishu products. **One composite call > five fine-grained API calls.**\n\n" +
      "Today: returns Bitable project-tracker rows where the user is the responsible person, " +
      "updated within `days` (default 7). Each row carries `title`, `status`, `updated_at_human`, " +
      "and the raw `fields` for any custom interpretation.\n\n" +
      "Inspect `source_diagnostics` — if a data source was skipped (e.g. drive scope missing), " +
      "it will be explained there. Use it to either fall back gracefully or surface a fix-up " +
      "message to the user.\n\n" +
      "Pair with `feishu_get_attendees.human_open_ids` to compose a weekly-meeting pre-read.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "open_id of the user. Usually from `feishu_get_attendees.human_open_ids`.",
        },
        user_name: {
          type: "string",
          description:
            "Optional. The user's display name — speeds up bitable owner-field matching by skipping a profile lookup.",
        },
        days: {
          type: "number",
          description: "Look-back window in days. Default: 7.",
          default: 7,
        },
        sources: {
          type: "array",
          items: { type: "string", enum: ["bitable", "docx"] },
          description:
            'Which data sources to query. Default: ["bitable"]. "docx" is currently skipped with a diagnostic — see source_diagnostics.',
        },
      },
      required: ["user_id"],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS as unknown as typeof TOOL_DEFINITIONS,
}));

function errorEnvelope(
  toolName: string,
  err: unknown,
  recovery_hint: string
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error_code: "tool_execution_failed",
            tool: toolName,
            message: err instanceof Error ? err.message : String(err),
            recovery_hint,
            is_retryable: false,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function okEnvelope(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  if (name === "feishu_ping") {
    return okEnvelope({
      ok: true,
      server: "feishu-bridge",
      version: "0.2.0",
      tools_available: TOOL_DEFINITIONS.map((t) => t.name).filter(
        (n) => n !== "feishu_ping"
      ),
      message: "MCP server is reachable. Call feishu_search_events to start.",
    });
  }

  let client: FeishuClient;
  try {
    client = FeishuClient.fromEnv();
  } catch (err) {
    return errorEnvelope(
      name,
      err,
      "Set FEISHU_APP_ID and FEISHU_APP_SECRET in the env block of your MCP client config. " +
        "See README.md → 'Wire up to Claude Desktop'."
    );
  }

  try {
    if (name === "feishu_search_events") {
      const result = await searchEvents(client, {
        query: String(args.query ?? ""),
        time_range_days:
          typeof args.time_range_days === "number"
            ? args.time_range_days
            : undefined,
        user_id:
          typeof args.user_id === "string" && args.user_id.length > 0
            ? args.user_id
            : undefined,
      });
      return okEnvelope(result);
    }
    if (name === "feishu_get_attendees") {
      const result = await getAttendees(client, {
        event_id: String(args.event_id ?? ""),
        calendar_id:
          typeof args.calendar_id === "string" ? args.calendar_id : undefined,
      });
      return okEnvelope(result);
    }
    if (name === "feishu_user_recent_work") {
      const result = await userRecentWork(client, {
        user_id: String(args.user_id ?? ""),
        user_name:
          typeof args.user_name === "string" ? args.user_name : undefined,
        days: typeof args.days === "number" ? args.days : undefined,
        sources: Array.isArray(args.sources)
          ? (args.sources as Array<"bitable" | "docx">)
          : undefined,
      });
      return okEnvelope(result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint =
      "Inspect the error message — Feishu API errors include the failing endpoint and code.";
    if (msg.includes("No calendars accessible")) {
      hint =
        "The bot has no calendar access. In Feishu Calendar → Settings → Share, add the bot as a viewer.";
    } else if (msg.includes("99991672")) {
      hint =
        "Missing scope. The error message contains the required scope name and a request-approval URL — apply it in the Feishu Developer Console.";
    } else if (msg.includes("190007")) {
      hint =
        "App has no bot capability enabled. Go to Feishu Developer Console → your app → Add Capability → Bot.";
    } else if (msg.includes("FEISHU_PROJECT_BITABLE")) {
      hint =
        "Bitable not configured. Set FEISHU_PROJECT_BITABLE_APP_TOKEN and FEISHU_PROJECT_BITABLE_TABLE_ID in your MCP client env block.";
    }
    return errorEnvelope(name, err, hint);
  }

  return errorEnvelope(
    name,
    new Error(`Unknown tool: ${name}`),
    `Known tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}`
  );
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[feishu-bridge] MCP server v0.2.0 connected on stdio");
}

main().catch((err) => {
  console.error("[feishu-bridge] fatal:", err);
  process.exit(1);
});
