import type { FeishuClient } from "../client.js";

export interface SearchEventsInput {
  /** Natural language query (e.g. "下周一团队周会"). */
  query: string;
  /** open_id of the user whose calendar to search. Defaults to caller. */
  user_id?: string;
  /** How many days forward to look. Default: 7. */
  time_range_days?: number;
}

export interface CalendarEvent {
  event_id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
}

export interface SearchEventsResult {
  events: CalendarEvent[];
  /**
   * Present when more than one event matches the query — signals the LLM
   * to ask the user for disambiguation rather than picking one.
   */
  disambiguation_hint?: string;
}

/**
 * Find calendar events matching a natural language query.
 *
 * TODO (Mon coding session):
 *  - call /calendar/v4/calendars/:cal_id/events with time window
 *  - semantic match `query` against event.summary / description
 *  - parse relative time expressions ("下周一", "明天下午") to anchor window
 *  - when matches > 1, set `disambiguation_hint`
 */
export async function searchEvents(
  _client: FeishuClient,
  _input: SearchEventsInput
): Promise<SearchEventsResult> {
  throw new Error(
    "searchEvents: not implemented. See TODO in src/core/tools/search-events.ts"
  );
}
