#!/usr/bin/env node
/**
 * Feishu Bridge — CLI surface.
 *
 * Exposes the same Feishu capabilities as Bash-callable commands.
 * Designed for AI agents that spawn shell processes (Claude Code,
 * Cursor's terminal mode), CI/CD pipelines, and scripting.
 *
 * Output mode: machine-readable JSON by default; `--pretty` switches
 * to human-friendly formatting (Mon TODO).
 */
import { Command } from "commander";
import { FeishuClient } from "../core/client.js";

const program = new Command()
  .name("feishu-bridge")
  .description(
    "CLI surface for Feishu Bridge — exposing Feishu capabilities to AI agents and scripts."
  )
  .version("0.1.0");

program
  .command("ping")
  .description("Verify the CLI is wired up correctly.")
  .action(() => {
    console.log(
      JSON.stringify({
        ok: true,
        message: "feishu-bridge CLI is alive",
        version: "0.1.0",
      })
    );
  });

program
  .command("whoami")
  .description(
    "Fetch the configured bot's own profile via /contact/v3/users — also a smoke test for FEISHU_APP_ID / FEISHU_APP_SECRET."
  )
  .requiredOption("--open-id <id>", "open_id to look up")
  .action(async (opts) => {
    try {
      const client = FeishuClient.fromEnv();
      const user = await client.getUser(opts.openId);
      console.log(JSON.stringify({ ok: true, user }, null, 2));
    } catch (err) {
      console.log(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      process.exit(1);
    }
  });

// TODO (Mon): add `search-events`, `user-recent-work`, `get-attendees` subcommands.

program.parseAsync(process.argv);
