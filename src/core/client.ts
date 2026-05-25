import type { ApiResponse, FeishuUser, TokenResponse } from "./types.js";

export interface FeishuClientOptions {
  appId: string;
  appSecret: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://open.feishu.cn/open-apis";

export class FeishuClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(opts: FeishuClientOptions) {
    this.appId = opts.appId;
    this.appSecret = opts.appSecret;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  static fromEnv(): FeishuClient {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error(
        "Missing FEISHU_APP_ID or FEISHU_APP_SECRET in env. " +
          "Copy .env.example to .env and fill them in."
      );
    }
    return new FeishuClient({
      appId,
      appSecret,
      baseUrl: process.env.FEISHU_BASE_URL,
    });
  }

  /**
   * Get a valid tenant_access_token, refreshing if expired or near expiry.
   * Token is cached in memory; survives across requests within a single process.
   */
  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    // Refresh 60s before actual expiry to avoid edge cases.
    if (this.cachedToken && now < this.tokenExpiresAt - 60_000) {
      return this.cachedToken;
    }
    const res = await fetch(
      `${this.baseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      }
    );
    const data = (await res.json()) as TokenResponse;
    if (data.code !== 0) {
      throw new Error(`Token request failed [${data.code}]: ${data.msg}`);
    }
    this.cachedToken = data.tenant_access_token;
    this.tokenExpiresAt = now + data.expire * 1000;
    return this.cachedToken;
  }

  /**
   * Generic authenticated request to Feishu OpenAPI.
   * Throws an Error with both code and troubleshooter hint when non-zero code.
   */
  async request<T = unknown>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.getTenantAccessToken();
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers });
    const data = (await res.json()) as ApiResponse<T>;
    if (data.code !== 0) {
      const hint = data.error?.troubleshooter
        ? `\n  hint: ${data.error.troubleshooter}`
        : "";
      throw new Error(
        `Feishu API [${data.code}] ${path}: ${data.msg}${hint}`
      );
    }
    return data.data as T;
  }

  // --- Verified working methods (callable today) ---

  /** Get user profile by open_id. Verified: 2026-05-24. */
  async getUser(openId: string): Promise<FeishuUser> {
    const data = await this.request<{ user: FeishuUser }>(
      `/contact/v3/users/${openId}?user_id_type=open_id`
    );
    return data.user;
  }

  /** Read raw text content of a doc (works for both docx token and wiki node_token). */
  async getDocRawContent(docToken: string): Promise<string> {
    const data = await this.request<{ content: string }>(
      `/docx/v1/documents/${docToken}/raw_content`
    );
    return data.content;
  }

  /** List records of a Bitable table. */
  async listBitableRecords(
    appToken: string,
    tableId: string,
    opts: { pageSize?: number; pageToken?: string } = {}
  ): Promise<{
    items: Array<{ record_id: string; fields: Record<string, unknown> }>;
    has_more: boolean;
    page_token?: string;
  }> {
    const params = new URLSearchParams();
    params.set("page_size", String(opts.pageSize ?? 20));
    if (opts.pageToken) params.set("page_token", opts.pageToken);
    return this.request(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`
    );
  }

  /** List calendars accessible to the caller. Returns primary first. */
  async listCalendars(): Promise<
    Array<{
      calendar_id: string;
      summary: string;
      type: "primary" | "shared" | "google" | "resource" | "exchange" | string;
      permissions?: string;
    }>
  > {
    const data = await this.request<{
      calendar_list: Array<{
        calendar_id: string;
        summary: string;
        type: string;
        permissions?: string;
      }>;
    }>(`/calendar/v4/calendars`);
    return data.calendar_list ?? [];
  }

  /**
   * Get the primary calendar id of the configured bot/user.
   * Falls back to the first calendar if none is explicitly marked primary.
   */
  async getPrimaryCalendarId(): Promise<string> {
    const calendars = await this.listCalendars();
    if (calendars.length === 0) {
      throw new Error(
        "No calendars accessible. Make sure the bot has been added " +
          "as a viewer of at least one calendar (Feishu Calendar → Share → Add bot)."
      );
    }
    const primary = calendars.find((c) => c.type === "primary");
    return (primary ?? calendars[0]).calendar_id;
  }

  /** List events in a calendar within [startMs, endMs]. */
  async listCalendarEvents(
    calendarId: string,
    startMs: number,
    endMs: number,
    opts: { pageToken?: string } = {}
  ): Promise<{
    items: Array<RawCalendarEvent>;
    has_more: boolean;
    page_token?: string;
  }> {
    const params = new URLSearchParams();
    params.set("start_time", String(Math.floor(startMs / 1000)));
    params.set("end_time", String(Math.floor(endMs / 1000)));
    params.set("page_size", "50");
    if (opts.pageToken) params.set("page_token", opts.pageToken);
    return this.request(
      `/calendar/v4/calendars/${calendarId}/events?${params}`
    );
  }

  /** List attendees of a specific calendar event. */
  async listEventAttendees(
    calendarId: string,
    eventId: string
  ): Promise<Array<RawEventAttendee>> {
    const data = await this.request<{ items: Array<RawEventAttendee> }>(
      `/calendar/v4/calendars/${calendarId}/events/${eventId}/attendees?user_id_type=open_id`
    );
    return data.items ?? [];
  }

  /**
   * Query free/busy windows for a single user. Works with tenant_access_token
   * even when the user has not shared their calendar with the bot — Feishu
   * returns coarse-grained busy windows (start/end only, no summary) by design.
   *
   * Verified: 2026-05-25 against ou_3de3e555... — returned 10 busy windows
   * spanning the next 14 days, including a 1:1 at 2026-05-27 14:00 and a
   * review meeting at 2026-05-28 15:00.
   *
   * This is the only path today by which the bot can see the existence of
   * events on another user's primary calendar. The lack of summary is a
   * Feishu protocol decision, not a missing scope — adding scopes to the
   * app will not surface event titles via freebusy.
   */
  async getUserFreeBusy(
    userOpenId: string,
    startMs: number,
    endMs: number
  ): Promise<Array<{ start_time: string; end_time: string }>> {
    const data = await this.request<{
      freebusy_list?: Array<{ start_time: string; end_time: string }>;
    }>("/calendar/v4/freebusy/list?user_id_type=open_id", {
      method: "POST",
      body: JSON.stringify({
        time_min: new Date(startMs).toISOString(),
        time_max: new Date(endMs).toISOString(),
        user_id: userOpenId,
        include_external_calendar: true,
        only_busy: true,
      }),
    });
    return data.freebusy_list ?? [];
  }

  /**
   * Return the bot's own identity as Feishu sees it. Used by diagnostics so
   * an LLM consuming an empty result can explain to the user *why* the bot
   * is blind to their calendar: "I'm logged in as <bot_open_id>, not you."
   *
   * Returns null if the bot has no primary calendar (e.g. bot capability not
   * enabled) — caller treats null as "diagnostics unavailable", not an error.
   */
  async getBotIdentity(): Promise<{
    bot_open_id: string;
    bot_primary_calendar_id: string;
    bot_primary_calendar_summary: string;
  } | null> {
    try {
      const data = await this.request<{
        calendars?: Array<{
          calendar?: {
            calendar_id?: string;
            summary?: string;
          };
          user_id?: string;
        }>;
      }>("/calendar/v4/calendars/primary?user_id_type=open_id", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const entry = data.calendars?.[0];
      if (!entry?.calendar?.calendar_id || !entry.user_id) return null;
      return {
        bot_open_id: entry.user_id,
        bot_primary_calendar_id: entry.calendar.calendar_id,
        bot_primary_calendar_summary: entry.calendar.summary ?? "",
      };
    } catch {
      return null;
    }
  }
}

export interface RawCalendarEvent {
  event_id: string;
  summary?: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  status?: string;
}

export interface RawEventAttendee {
  attendee_id?: string;
  type?: "user" | "chat" | "resource" | "third_party" | string;
  user_id?: string;
  rsvp_status?: "needs_action" | "accept" | "decline" | "tentative" | string;
  display_name?: string;
}
