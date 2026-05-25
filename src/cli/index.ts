#!/usr/bin/env node
/**
 * Feishu Bridge — CLI surface.
 *
 * Exposes the same Feishu capabilities as Bash-callable commands.
 * Designed for AI agents that spawn shell processes (Claude Code,
 * Cursor's terminal mode), CI/CD pipelines, and scripting.
 *
 * Output: structured JSON only. AI agents parse JSON reliably; humans
 * can pipe through `jq` when they want pretty output.
 */
import { loadEnv } from "../core/load-env.js";
loadEnv();
import { Command } from "commander";
import { FeishuClient } from "../core/client.js";
import { searchEvents } from "../core/tools/search-events.js";
import { getAttendees } from "../core/tools/get-attendees.js";
import { userRecentWork } from "../core/tools/user-recent-work.js";

function emitOk(payload: unknown): void {
  console.log(JSON.stringify({ ok: true, ...((payload as object) ?? {}) }, null, 2));
}

function mapHint(msg: string, fallback: string): string {
  if (msg.includes("FEISHU_APP_ID") || msg.includes("FEISHU_APP_SECRET")) {
    return "Create .env in the project root (copy from .env.example) with FEISHU_APP_ID and FEISHU_APP_SECRET. The CLI auto-loads .env from cwd upward.";
  }
  if (msg.includes("FEISHU_PROJECT_BITABLE")) {
    return "Add FEISHU_PROJECT_BITABLE_APP_TOKEN and FEISHU_PROJECT_BITABLE_TABLE_ID to .env (get them from the Bitable URL).";
  }
  if (msg.includes("No calendars accessible")) {
    return "The bot has no calendar access. Either share a calendar with the bot, or invite the bot as an attendee on the events you want it to see.";
  }
  if (msg.includes("99991672")) {
    return "Missing scope. The error message contains the required scope name and an approval URL — apply it in the Feishu Developer Console.";
  }
  if (msg.includes("190007")) {
    return "App has no bot capability enabled. Feishu Developer Console → your app → Add Capability → Bot.";
  }
  return fallback;
}

function emitErr(err: unknown, fallbackHint?: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: msg,
        recovery_hint: mapHint(msg, fallbackHint ?? "See error message for details."),
      },
      null,
      2
    )
  );
  process.exit(1);
}

const program = new Command()
  .name("feishu-bridge")
  .description(
    "CLI surface for Feishu Bridge — exposing Feishu capabilities to AI agents and scripts."
  )
  .version("0.2.0");

program
  .command("ping")
  .description("Verify the CLI is wired up correctly.")
  .action(() => {
    console.log(
      JSON.stringify({
        ok: true,
        message: "feishu-bridge CLI is alive",
        version: "0.2.0",
      })
    );
  });

program
  .command("whoami")
  .description(
    "Fetch a user profile via /contact/v3/users — also a smoke test for FEISHU_APP_ID / FEISHU_APP_SECRET."
  )
  .requiredOption("--open-id <id>", "open_id to look up")
  .action(async (opts) => {
    try {
      const client = FeishuClient.fromEnv();
      const user = await client.getUser(opts.openId);
      emitOk({ user });
    } catch (err) {
      emitErr(
        err,
        "Verify FEISHU_APP_ID/FEISHU_APP_SECRET in .env, and that the bot has contact:user.base:readonly scope."
      );
    }
  });

program
  .command("search-events")
  .description(
    "Find calendar events in the next N days matching a natural-language query. " +
      "Returns {events, busy_windows, source_diagnostics, recovery_hints}. " +
      "Even when the bot can't see event titles (tenant_access_token can't read " +
      "another user's calendar), busy_windows surfaces the user's freebusy slots " +
      "and recovery_hints tells an LLM exactly how to proceed."
  )
  .requiredOption("--query <q>", "natural language query, e.g. \"周一周会\"")
  .option("--days <n>", "look-ahead window in days", "7")
  .option(
    "--user-id <open_id>",
    "open_id of the user whose calendar to probe (freebusy). Falls back to FEISHU_USER_OPEN_ID env."
  )
  .action(async (opts) => {
    try {
      const client = FeishuClient.fromEnv();
      const result = await searchEvents(client, {
        query: opts.query,
        time_range_days: Number(opts.days),
        user_id: opts.userId,
      });
      emitOk(result);
    } catch (err) {
      emitErr(
        err,
        "If 'No calendars accessible', the bot has no primary calendar. " +
          "Otherwise inspect source_diagnostics.root_cause in the response."
      );
    }
  });

program
  .command("get-attendees")
  .description(
    "List attendees of a specific calendar event, enriched with user profile. " +
      "Pair with search-events: take event_id from its output, feed it here."
  )
  .requiredOption("--event-id <id>", "event_id from search-events output")
  .option(
    "--calendar-id <id>",
    "calendar_id; defaults to primary calendar of the caller"
  )
  .action(async (opts) => {
    try {
      const client = FeishuClient.fromEnv();
      const result = await getAttendees(client, {
        event_id: opts.eventId,
        calendar_id: opts.calendarId,
      });
      emitOk(result);
    } catch (err) {
      emitErr(
        err,
        "Verify event_id is valid (from search-events output) and the bot has access to the calendar."
      );
    }
  });

program
  .command("user-recent-work")
  .description(
    "Aggregate a user's recent work across Feishu products (Bitable today, Docx pending). " +
      "Pair with get-attendees: fan-out over human_open_ids to build a meeting brief."
  )
  .requiredOption("--user-id <open_id>", "open_id of the user")
  .option("--user-name <name>", "optional display name to skip a lookup")
  .option("--days <n>", "look-back window in days", "7")
  .option(
    "--sources <list>",
    "comma-separated: bitable,docx",
    "bitable"
  )
  .action(async (opts) => {
    try {
      const client = FeishuClient.fromEnv();
      const sources = String(opts.sources)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as Array<"bitable" | "docx">;
      const result = await userRecentWork(client, {
        user_id: opts.userId,
        user_name: opts.userName,
        days: Number(opts.days),
        sources,
      });
      emitOk(result);
    } catch (err) {
      emitErr(
        err,
        "Verify FEISHU_PROJECT_BITABLE_APP_TOKEN and FEISHU_PROJECT_BITABLE_TABLE_ID in .env."
      );
    }
  });

program.parseAsync(process.argv);
