import type { FeishuClient } from "../client.js";

export interface GetAttendeesInput {
  event_id: string;
  /**
   * Optional. If omitted, the tool resolves the primary calendar id of the
   * caller and uses that. Pass this when the event came from a non-primary
   * calendar (e.g. a shared team calendar).
   */
  calendar_id?: string;
}

export interface Attendee {
  open_id?: string;
  name: string;
  email?: string;
  rsvp_status?: "needs_action" | "accept" | "decline" | "tentative" | string;
  type: "user" | "chat" | "resource" | "third_party" | string;
}

export interface GetAttendeesResult {
  attendees: Attendee[];
  /** Open IDs of human attendees — convenient for feeding into user_recent_work. */
  human_open_ids: string[];
}

/**
 * Get attendees of a calendar event, enriched with user profile.
 *
 * Strategy:
 *  - Resolve calendar id (use primary if not supplied).
 *  - Fetch attendee list from /calendar/v4/calendars/:cal/events/:id/attendees.
 *  - For each attendee.type === "user" with user_id, enrich via getUser().
 *  - Order: users first, sorted by name; then chats; then resources.
 *  - Also surface a flat `human_open_ids` list — the typical next step
 *    is to fan-out user_recent_work(open_id) for each, so the LLM
 *    can grab this directly without re-extracting.
 */
export async function getAttendees(
  client: FeishuClient,
  input: GetAttendeesInput
): Promise<GetAttendeesResult> {
  const calendarId = input.calendar_id ?? (await client.getPrimaryCalendarId());

  const raw = await client.listEventAttendees(calendarId, input.event_id);

  const enriched: Attendee[] = await Promise.all(
    raw.map(async (a) => {
      let name = a.display_name ?? "";
      let email: string | undefined;
      let open_id = a.user_id;
      if (a.type === "user" && a.user_id) {
        try {
          const user = await client.getUser(a.user_id);
          name = user.name || name;
          email = user.email;
          open_id = user.open_id || a.user_id;
        } catch {
          // Enrichment is best-effort — if it fails, fall back to display_name.
        }
      }
      return {
        open_id,
        name: name || "(unknown)",
        email,
        rsvp_status: a.rsvp_status,
        type: a.type ?? "user",
      };
    })
  );

  enriched.sort((x, y) => {
    const rank = (t: string) =>
      t === "user" ? 0 : t === "chat" ? 1 : t === "resource" ? 2 : 3;
    const r = rank(x.type) - rank(y.type);
    if (r !== 0) return r;
    return x.name.localeCompare(y.name);
  });

  const human_open_ids = enriched
    .filter((a) => a.type === "user" && a.open_id)
    .map((a) => a.open_id as string);

  return { attendees: enriched, human_open_ids };
}
