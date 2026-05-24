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
}
