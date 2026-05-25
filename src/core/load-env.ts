/**
 * Tiny zero-dep .env loader.
 *
 * Why not `dotenv`? Keeping the runtime dependency footprint small —
 * this is a PoC and the .env format we need is trivial (KEY=VALUE,
 * optional quoting, optional comments). Adding a dep for ~30 lines of
 * code costs more than it saves.
 *
 * Search order: walks up from cwd to root looking for `.env`. This
 * makes `node dist/cli/index.js` work whether invoked from the project
 * root or from `dist/`.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function loadEnv(): { loaded: string | null } {
  let dir = process.cwd();
  const seen = new Set<string>();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf8");
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq < 0) continue;
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (key && !(key in process.env)) {
            process.env[key] = val;
          }
        }
        return { loaded: candidate };
      } catch {
        // Best effort — ignore malformed .env
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { loaded: null };
}
