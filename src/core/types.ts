export interface TokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

export interface FeishuError {
  log_id?: string;
  troubleshooter?: string;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
  error?: FeishuError;
}

export interface FeishuUser {
  open_id: string;
  name: string;
  email?: string;
  mobile?: string;
  department_ids?: string[];
}
