import type { FeishuClient } from "../client.js";

export interface UserRecentWorkInput {
  /** open_id of the user to query. */
  user_id: string;
  /** Look-back window in days. Default: 7. */
  days?: number;
  /** Which data sources to aggregate. Default: ["bitable", "docx"]. */
  sources?: Array<"bitable" | "docx">;
}

export interface BitableUpdate {
  table: string;
  record_title: string;
  status?: string;
  updated_at: string;
  updated_at_ms: number;
}

export interface DocCreated {
  title: string;
  url: string;
  created_at: string;
  created_at_ms: number;
}

export interface UserRecentWorkResult {
  user: { open_id: string; name: string };
  bitable_updates: BitableUpdate[];
  docs_created: DocCreated[];
}

/**
 * Aggregate a user's recent activity across multiple Feishu products
 * (Bitable + Docx today; extensible to IM, OKR, Minutes later).
 *
 * Design rationale (AI Friendly):
 *   One composite tool > 5 fine-grained tools. LLMs are far more reliable
 *   calling one well-named function than chaining five raw APIs themselves.
 *
 * TODO (Mon coding session):
 *  - bitable: query records where 责任人=user_id and 更新时间 within window
 *  - docx: list documents created by user_id within window (via drive search)
 *  - enrich each item with human-readable timestamps
 */
export async function userRecentWork(
  _client: FeishuClient,
  _input: UserRecentWorkInput
): Promise<UserRecentWorkResult> {
  throw new Error(
    "userRecentWork: not implemented. See TODO in src/core/tools/user-recent-work.ts"
  );
}
