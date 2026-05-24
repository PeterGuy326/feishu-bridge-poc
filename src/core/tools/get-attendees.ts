import type { FeishuClient } from "../client.js";

export interface GetAttendeesInput {
  event_id: string;
}

export interface Attendee {
  open_id: string;
  name: string;
  department?: string;
  title?: string;
  rsvp_status?: "needs_action" | "accepted" | "declined" | "tentative";
}

/**
 * Get attendees of a calendar event, enriched with user profile.
 *
 * TODO (Mon coding session):
 *  - call /calendar/v4/calendars/:cal_id/events/:event_id/attendees
 *  - for each attendee with user_id, enrich via FeishuClient.getUser()
 *  - return single composed list with stable ordering
 */
export async function getAttendees(
  _client: FeishuClient,
  _input: GetAttendeesInput
): Promise<Attendee[]> {
  throw new Error(
    "getAttendees: not implemented. See TODO in src/core/tools/get-attendees.ts"
  );
}
