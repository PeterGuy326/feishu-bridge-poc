import type { FeishuClient } from "../client.js";

export interface SearchEventsInput {
  /** Natural language query (e.g. "下周一团队周会", "周会", "1:1"). */
  query: string;
  /**
   * open_id of the user whose calendar to search.
   * If omitted, falls back to env FEISHU_USER_OPEN_ID, then to bot-only mode.
   */
  user_id?: string;
  /** How many days forward from now to look. Default: 7. */
  time_range_days?: number;
}

export interface CalendarEvent {
  event_id: string;
  calendar_id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  start_ms: number;
  end_ms: number;
}

export interface BusyWindow {
  start: string;
  end: string;
  start_ms: number;
  end_ms: number;
  duration_minutes: number;
  /** Optional weekday/time human label for LLM convenience: e.g. "周三 14:00–14:30". */
  human_label: string;
}

export interface RecoveryHint {
  /** Stable id so an LLM can pick one by name without parsing prose. */
  id: string;
  /** One-sentence summary for the LLM to read aloud. */
  title: string;
  /** Which side has to act: app-developer | end-user | mcp-caller. */
  actor: "app-developer" | "end-user" | "mcp-caller";
  /** Concrete next step the actor takes. */
  action: string;
  /** Optional URL the LLM can surface. */
  url?: string;
}

export interface SourceDiagnostics {
  /** What did the bot see when it tried to read its OWN calendar? */
  bot_calendar: {
    calendar_id: string | null;
    summary: string | null;
    bot_open_id: string | null;
    events_visible_in_window: number;
  };
  /** Did we query the user's freebusy? */
  user_freebusy: {
    requested_user_id: string | null;
    source: "arg" | "env" | "none";
    busy_windows_count: number;
    detail_visible: false;
    detail_reason: string;
  };
  /** Root cause label — what's blocking the bot from seeing summaries. */
  root_cause: string;
}

export interface SearchEventsResult {
  /**
   * Events the bot can fully see (summary + time + ids). Empty when the bot
   * is not a viewer/attendee on the queried calendar — see busy_windows for
   * what the bot CAN observe and source_diagnostics for why.
   */
  events: CalendarEvent[];
  /**
   * Coarse-grained busy windows on the target user's calendar, fetched via
   * `/calendar/v4/freebusy/list`. Times only — no summary, no event_id —
   * that's a Feishu protocol limit, not a missing scope. Use these to ground
   * an answer like "you're busy 14:00–14:30 on Wed, likely the meeting you
   * asked about" without pretending to know the title.
   */
  busy_windows: BusyWindow[];
  /**
   * Present when both events and busy_windows produce more than one plausible
   * match — signals the LLM to ask the user for disambiguation rather than
   * pick one.
   */
  disambiguation_hint?: string;
  /**
   * Why the result looks the way it does. Always populated, even on success,
   * so an LLM consumer can decide whether to surface a hint to the user.
   */
  source_diagnostics: SourceDiagnostics;
  /**
   * Concrete next actions for the LLM. Each item names an actor (developer,
   * end-user, or the MCP caller itself) and a single concrete step. Empty
   * when nothing to recommend (e.g. detailed events were returned).
   */
  recovery_hints: RecoveryHint[];
}

function toMsFromTimestampField(
  ts?: { timestamp?: string; date?: string }
): number {
  if (!ts) return 0;
  if (ts.timestamp) {
    const n = Number(ts.timestamp);
    return n > 10_000_000_000 ? n : n * 1000;
  }
  if (ts.date) return new Date(ts.date).getTime();
  return 0;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function humanLabelFor(startMs: number, endMs: number): string {
  if (!startMs) return "";
  const start = new Date(startMs);
  const end = new Date(endMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const day = WEEKDAY_ZH[start.getDay()];
  const same =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const s = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const e = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return same ? `${day} ${s}-${e}` : `${day} ${s} → +1d ${e}`;
}

/**
 * Find calendar events matching a natural language query, with AI-Friendly
 * graceful degradation when the bot lacks visibility into the user's
 * calendar.
 *
 * Strategy (three concurrent reads, then composed):
 *
 *  1. Bot's own primary calendar — full event detail when the bot is a
 *     viewer/attendee. This is the "happy path" pre-existing behaviour.
 *  2. Bot identity probe — captures `bot_open_id` so diagnostics can spell
 *     out the application-vs-user identity mismatch in plain language.
 *  3. User freebusy — coarse busy windows on the target user's primary
 *     calendar, callable with tenant_access_token alone (no calendar share
 *     required). Always returns time-only — that's a Feishu protocol limit,
 *     not a scope gap.
 *
 * The result is composed so that an LLM consumer never sees `events: []`
 * with no explanation. If detailed events are missing, busy windows fill
 * the gap; if both are missing, source_diagnostics + recovery_hints give
 * the LLM something to either act on or surface to the user.
 *
 * Disambiguation: if `query` matches multiple events OR multiple busy
 * windows overlap typical meeting hours, `disambiguation_hint` is set so
 * the LLM asks the user instead of guessing.
 */
export async function searchEvents(
  client: FeishuClient,
  input: SearchEventsInput
): Promise<SearchEventsResult> {
  const days = input.time_range_days ?? 7;
  const now = Date.now();
  const endMs = now + days * 24 * 60 * 60 * 1000;

  // Resolve user_id from: explicit arg → env → none.
  const envUserId =
    typeof process.env.FEISHU_USER_OPEN_ID === "string" &&
    process.env.FEISHU_USER_OPEN_ID.length > 0
      ? process.env.FEISHU_USER_OPEN_ID
      : null;
  const userIdArg = input.user_id?.trim() || null;
  const userId = userIdArg ?? envUserId;
  const userIdSource: "arg" | "env" | "none" = userIdArg
    ? "arg"
    : envUserId
    ? "env"
    : "none";

  // Fire all reads in parallel; each is independently resilient to failure.
  const [botEventsResult, botIdentityResult, freebusyResult] = await Promise.all([
    (async () => {
      try {
        const calendarId = await client.getPrimaryCalendarId();
        const { items } = await client.listCalendarEvents(calendarId, now, endMs);
        return { calendarId, items, error: null as string | null };
      } catch (e) {
        return {
          calendarId: null as string | null,
          items: [] as Array<{
            event_id: string;
            summary?: string;
            description?: string;
            start_time?: { timestamp?: string; date?: string };
            end_time?: { timestamp?: string; date?: string };
          }>,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })(),
    client.getBotIdentity().catch(() => null),
    (async () => {
      if (!userId) {
        return { windows: [] as Array<{ start_time: string; end_time: string }>, error: null as string | null };
      }
      try {
        const windows = await client.getUserFreeBusy(userId, now, endMs);
        return { windows, error: null as string | null };
      } catch (e) {
        return { windows: [], error: e instanceof Error ? e.message : String(e) };
      }
    })(),
  ]);

  const q = (input.query || "").trim();
  const qLower = q.toLowerCase();
  const qTokens = tokenize(q);

  // --- Score bot-visible events (unchanged scoring logic) ---
  const scored = botEventsResult.items.map((ev) => {
    const summary = ev.summary ?? "";
    const description = ev.description ?? "";
    const hay = `${summary}\n${description}`.toLowerCase();

    let score = 0;
    if (q && hay.includes(qLower)) score += 10;
    for (const t of qTokens) {
      if (t.length === 0) continue;
      if (hay.includes(t)) score += 2;
    }
    return {
      score,
      event: {
        event_id: ev.event_id,
        calendar_id: botEventsResult.calendarId ?? "",
        summary,
        description: description || undefined,
        start_ms: toMsFromTimestampField(ev.start_time),
        end_ms: toMsFromTimestampField(ev.end_time),
        start: formatTime(toMsFromTimestampField(ev.start_time)),
        end: formatTime(toMsFromTimestampField(ev.end_time)),
      } as CalendarEvent,
    };
  });

  const hasQuery = q.length > 0;
  const matches = hasQuery ? scored.filter((s) => s.score > 0) : scored;
  matches.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.event.start_ms - b.event.start_ms
  );
  const topEvents = matches.slice(0, 5).map((m) => m.event);

  // --- Build busy_windows (sorted, capped, with human labels) ---
  const allWindows = freebusyResult.windows
    .map((w) => {
      const startMs = new Date(w.start_time).getTime();
      const endMsW = new Date(w.end_time).getTime();
      const dur = Math.max(0, Math.round((endMsW - startMs) / 60_000));
      return {
        start: w.start_time,
        end: w.end_time,
        start_ms: startMs,
        end_ms: endMsW,
        duration_minutes: dur,
        human_label: humanLabelFor(startMs, endMsW),
      } as BusyWindow;
    })
    .sort((a, b) => a.start_ms - b.start_ms);
  const busyWindows = allWindows.slice(0, 20);

  // --- Disambiguation: events first, then fall back to busy windows ---
  let disambiguation_hint: string | undefined;
  if (hasQuery && matches.length > 1) {
    const summaries = topEvents
      .map((e) => `"${e.summary}" (${e.start})`)
      .join(", ");
    disambiguation_hint = `Found ${matches.length} events matching "${q}". Ask the user which one: ${summaries}`;
  } else if (
    hasQuery &&
    topEvents.length === 0 &&
    busyWindows.length > 1
  ) {
    const labels = busyWindows
      .slice(0, 5)
      .map((w) => w.human_label)
      .filter(Boolean)
      .join(", ");
    disambiguation_hint = `Could not see event titles, but the user has ${busyWindows.length} busy windows in the next ${days} days. Likely candidates by time: ${labels}. Ask the user which one matches "${q}".`;
  }

  // --- Source diagnostics (always populated) ---
  const detail_reason = userId
    ? "Feishu's /calendar/v4/freebusy/list returns start/end only by design — it never includes summary, regardless of scopes granted."
    : "No user_id was supplied (neither arg nor FEISHU_USER_OPEN_ID env). Pass user_id to fetch the target user's busy windows.";

  const source_diagnostics: SourceDiagnostics = {
    bot_calendar: {
      calendar_id: botIdentityResult?.bot_primary_calendar_id ?? botEventsResult.calendarId,
      summary: botIdentityResult?.bot_primary_calendar_summary ?? null,
      bot_open_id: botIdentityResult?.bot_open_id ?? null,
      events_visible_in_window: botEventsResult.items.length,
    },
    user_freebusy: {
      requested_user_id: userId,
      source: userIdSource,
      busy_windows_count: allWindows.length,
      detail_visible: false,
      detail_reason,
    },
    root_cause: composeRootCause({
      botOpenId: botIdentityResult?.bot_open_id ?? null,
      userId,
      botEventsCount: botEventsResult.items.length,
      busyCount: allWindows.length,
    }),
  };

  // --- Recovery hints (LLM-actionable) ---
  const recovery_hints = composeRecoveryHints({
    topEventsCount: topEvents.length,
    busyCount: allWindows.length,
    userIdSource,
    botOpenId: botIdentityResult?.bot_open_id ?? null,
    appId: process.env.FEISHU_APP_ID ?? "<your-app-id>",
  });

  return {
    events: topEvents,
    busy_windows: busyWindows,
    disambiguation_hint,
    source_diagnostics,
    recovery_hints,
  };
}

function composeRootCause(args: {
  botOpenId: string | null;
  userId: string | null;
  botEventsCount: number;
  busyCount: number;
}): string {
  if (args.botEventsCount > 0) {
    return "ok: bot has direct visibility into the queried calendar.";
  }
  if (!args.userId) {
    return "no_user_id: cannot probe a specific user's calendar without user_id. Bot only sees its own (empty) primary calendar.";
  }
  if (args.busyCount === 0) {
    return `user_has_no_events_or_blocked: the target user (${args.userId}) appears to have no events in the requested window — or the bot's tenant lacks visibility into this user entirely.`;
  }
  return `app_identity_vs_user_identity: bot is authenticated as application identity ${
    args.botOpenId ?? "<unknown>"
  } and sees only its OWN primary calendar via tenant_access_token. The user (${args.userId}) has ${args.busyCount} busy windows visible via /freebusy/list, but Feishu's freebusy protocol intentionally omits summaries. Detailed event read requires either (a) the bot is added as an attendee on the event, (b) the user shares their calendar with the bot via ACL, or (c) the app uses user_access_token (OAuth) instead of tenant_access_token.`;
}

function composeRecoveryHints(args: {
  topEventsCount: number;
  busyCount: number;
  userIdSource: "arg" | "env" | "none";
  botOpenId: string | null;
  appId: string;
}): RecoveryHint[] {
  // Happy path: nothing to recommend.
  if (args.topEventsCount > 0) return [];

  const hints: RecoveryHint[] = [];

  if (args.userIdSource === "none") {
    hints.push({
      id: "supply_user_id",
      title: "Re-call with an explicit user_id so the bot can probe freebusy.",
      actor: "mcp-caller",
      action:
        "Add user_id (open_id) to the next feishu_search_events call. Even when the bot can't read event titles, freebusy returns reliable busy windows.",
    });
  }

  if (args.busyCount > 0) {
    hints.push({
      id: "use_busy_windows",
      title: "Use busy_windows as the authoritative signal; do not fabricate titles.",
      actor: "mcp-caller",
      action:
        "Surface the busy windows in busy_windows[] to the user with their human_label. Phrase answers as 'you have a 30-min block at 周三 14:00' rather than guessing the event name.",
    });
  }

  // Scope upgrade — gives the LLM a real URL it can show the developer.
  hints.push({
    id: "request_calendar_subscribe_scope",
    title:
      "Application-developer fix: grant the app calendar:calendar:subscribe so the bot can subscribe to user calendars without UI sharing.",
    actor: "app-developer",
    action:
      "Open the Feishu Developer Console and apply for the calendar:calendar:subscribe scope, then call /calendar/v4/calendars/{calendar_id}/subscribe. This is a one-time tenant-level operation.",
    url: `https://open.feishu.cn/app/${args.appId}/auth?q=calendar:calendar,calendar:calendar:subscribe&op_from=openapi&token_type=tenant`,
  });

  // Long-term proper fix
  hints.push({
    id: "switch_to_user_access_token",
    title:
      "Long-term proper fix: switch from tenant_access_token to user_access_token (OAuth) so the bot acts ON BEHALF OF the user.",
    actor: "app-developer",
    action:
      "Implement the Feishu OAuth 2.0 flow (authorization_code → user_access_token). With a user token, /calendar/v4/calendars returns the user's actual primary calendar — events, summaries, attendees all become visible. This resolves the application-vs-user identity mismatch at the root.",
    url: "https://open.feishu.cn/document/server-docs/authentication-management/access-token/get-user-access-token",
  });

  return hints;
}
