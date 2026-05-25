import type { FeishuClient } from "../client.js";

export interface UserRecentWorkInput {
  /** open_id of the user to query. */
  user_id: string;
  /**
   * The user's display name. Used to match against bitable "owner" / "assignee"
   * fields, which typically store the name (text) rather than open_id.
   * If omitted, the tool calls getUser() to resolve it.
   */
  user_name?: string;
  /** Look-back window in days. Default: 7. */
  days?: number;
  /** Which data sources to aggregate. Default: ["bitable"]. */
  sources?: Array<"bitable" | "docx">;
}

export interface BitableUpdate {
  table_id: string;
  record_id: string;
  title: string;
  status?: string;
  owner?: string;
  updated_at_ms?: number;
  updated_at_human?: string;
  fields: Record<string, unknown>;
}

export interface UserRecentWorkResult {
  user: { open_id: string; name: string };
  bitable_updates: BitableUpdate[];
  /**
   * Reasons certain sources were skipped — surfaces config gaps to the LLM
   * so it can either fall back gracefully or prompt the user to fix env.
   */
  source_diagnostics: Record<string, string>;
}

const FIELD_OWNER_CANDIDATES = [
  "责任人",
  "负责人",
  "owner",
  "assignee",
  "Owner",
  "Assignee",
  "执行人",
];
const FIELD_STATUS_CANDIDATES = [
  "状态",
  "Status",
  "status",
  "进度",
  "stage",
  "Stage",
];
const FIELD_TITLE_CANDIDATES = [
  "项目名",
  "标题",
  "名称",
  "title",
  "Title",
  "name",
  "Name",
  "Subject",
  "subject",
];
const FIELD_UPDATED_CANDIDATES = [
  "更新时间",
  "updated_at",
  "Updated",
  "Last updated",
  "最后更新",
];

function firstFieldValue(
  fields: Record<string, unknown>,
  keys: string[]
): { key?: string; value?: unknown } {
  for (const k of keys) {
    if (k in fields && fields[k] != null && fields[k] !== "") {
      return { key: k, value: fields[k] };
    }
  }
  return {};
}

/**
 * Stringify a Bitable field value into something an LLM can read. Bitable
 * returns text fields as `[{type:"text", text:"..."}]`, person fields as
 * `[{name:"...", email:"..."}]`, single-select as `"已完成"`, etc. We unify.
 */
function fieldToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "object") {
          const o = v as Record<string, unknown>;
          return (
            (o.text as string) ??
            (o.name as string) ??
            (o.value as string) ??
            JSON.stringify(o)
          );
        }
        return String(v);
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return (
      (o.text as string) ??
      (o.name as string) ??
      (o.value as string) ??
      JSON.stringify(o)
    );
  }
  return String(value);
}

function toMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function humanDate(ms?: number): string | undefined {
  if (!ms) return undefined;
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Aggregate a user's recent activity across Feishu products.
 *
 * Today: Bitable project tracker (configurable via env).
 * Stage 2: Docx — currently skipped with diagnostic, awaiting drive scope.
 *
 * Design rationale (AI Friendly):
 *   One composite tool > 5 fine-grained tools. LLMs are far more reliable
 *   calling one well-named function than chaining five raw APIs themselves.
 */
export async function userRecentWork(
  client: FeishuClient,
  input: UserRecentWorkInput
): Promise<UserRecentWorkResult> {
  const days = input.days ?? 7;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sources = input.sources ?? ["bitable"];

  // Resolve user name (used for bitable owner-field matching).
  let userName = input.user_name;
  let openId = input.user_id;
  if (!userName) {
    try {
      const u = await client.getUser(input.user_id);
      userName = u.name;
      openId = u.open_id || input.user_id;
    } catch {
      userName = "";
    }
  }

  const diagnostics: Record<string, string> = {};
  const bitable_updates: BitableUpdate[] = [];

  if (sources.includes("bitable")) {
    const appToken = process.env.FEISHU_PROJECT_BITABLE_APP_TOKEN;
    const tableId = process.env.FEISHU_PROJECT_BITABLE_TABLE_ID;
    if (!appToken || !tableId) {
      diagnostics.bitable =
        "Skipped: FEISHU_PROJECT_BITABLE_APP_TOKEN and FEISHU_PROJECT_BITABLE_TABLE_ID must be set in env. " +
        "Get them from the Bitable URL: https://my.feishu.cn/base/<app_token> and the table tab.";
    } else {
      try {
        const { items } = await client.listBitableRecords(appToken, tableId, {
          pageSize: 100,
        });

        for (const rec of items) {
          const ownerInfo = firstFieldValue(rec.fields, FIELD_OWNER_CANDIDATES);
          const ownerStr = fieldToString(ownerInfo.value);

          // Match: owner field contains the user's name (loose match —
          // covers bitable's array-of-person shape and free-text shape).
          if (userName && ownerStr && !ownerStr.includes(userName)) continue;
          if (!userName) {
            // No name resolved — skip filter, return everything (best-effort).
          }

          const titleInfo = firstFieldValue(rec.fields, FIELD_TITLE_CANDIDATES);
          // Fallback: many Feishu Bitables encode the project name as a
          // bracketed prefix inside a "描述" / "details" field instead of
          // a dedicated title column. Extract `[xxx]` if present.
          let derivedTitle = fieldToString(titleInfo.value);
          if (!derivedTitle) {
            for (const k of ["描述", "details", "Description", "description"]) {
              const desc = fieldToString(rec.fields[k]);
              const m = desc.match(/^\s*\[([^\]]+)\]/);
              if (m) {
                derivedTitle = m[1].trim();
                break;
              }
              if (desc) {
                derivedTitle = desc.slice(0, 40);
                break;
              }
            }
          }
          const statusInfo = firstFieldValue(
            rec.fields,
            FIELD_STATUS_CANDIDATES
          );
          const updatedInfo = firstFieldValue(
            rec.fields,
            FIELD_UPDATED_CANDIDATES
          );
          const updatedMs = toMs(updatedInfo.value);

          // Time window filter — only apply if the table actually has an
          // updated-time field; otherwise keep the record (don't silently drop).
          if (updatedMs && updatedMs < cutoffMs) continue;

          bitable_updates.push({
            table_id: tableId,
            record_id: rec.record_id,
            title: derivedTitle || "(untitled)",
            status: fieldToString(statusInfo.value) || undefined,
            owner: ownerStr || undefined,
            updated_at_ms: updatedMs,
            updated_at_human: humanDate(updatedMs),
            fields: rec.fields,
          });
        }

        bitable_updates.sort(
          (a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0)
        );
      } catch (err) {
        diagnostics.bitable = `Bitable query failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }
  }

  if (sources.includes("docx")) {
    diagnostics.docx =
      "Skipped: drive search requires `drive:drive` scope which this PoC app " +
      "does not yet hold. This is one of the AI Friendly observations — see OBSERVATIONS.md.";
  }

  return {
    user: { open_id: openId, name: userName || "(unknown)" },
    bitable_updates,
    source_diagnostics: diagnostics,
  };
}
