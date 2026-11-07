// API layer for api-node. All calls go to the real API only.
//
// Base URL resolution (Vite env is baked in at build time):
// - VITE_API_URL set (e.g. http://localhost:3000 when running the
//   dashboard outside compose) -> calls go there directly.
// - VITE_API_URL empty/unset (the compose default) -> relative paths
//   (/api/..., /ws), which nginx proxies to api-node:3000 and which
//   the Vite dev server also proxies (see vite.config.ts).
// VITE_WS_URL, when set, overrides the derived WebSocket URL.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined ?? '').trim();

export function wsUrl(token: string): string {
  const override = (import.meta.env.VITE_WS_URL as string | undefined ?? '').trim();
  if (override) return `${override}?token=${encodeURIComponent(token)}`;
  if (API_URL) {
    const base = API_URL.replace(/^http/, 'ws');
    return `${base.replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

function apiPath(path: string): string {
  return API_URL ? `${API_URL.replace(/\/$/, '')}${path}` : path;
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiPath(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // fetch itself failed: API unreachable (server down, DNS, CORS...).
    throw new ApiError(0, 'network_error', 'Không kết nối được tới API. Kiểm tra api-node có đang chạy không.');
  }
  if (res.status === 401) {
    throw new ApiError(401, 'invalid_token', 'Phiên đăng nhập đã hết hạn hoặc token không hợp lệ. Đăng nhập lại.');
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) code = body.error;
    } catch {
      // Non-JSON error body: keep the HTTP status as the code.
    }
    throw new ApiError(res.status, code, `API trả lỗi ${res.status}: ${code}`);
  }
  return res.json() as Promise<T>;
}

export interface AlertsQuery extends Record<string, string | number | undefined> {
  limit: number;
  offset: number;
  type?: string;
  severity?: string;
  status?: string;
  ip?: string;
}

/** Build the exact query string the API expects (limit 1-100, offset >= 0). */
export function buildAlertsQuery(query: AlertsQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  params.set('offset', String(query.offset));
  if (query.type) params.set('type', query.type);
  if (query.severity) params.set('severity', query.severity);
  if (query.status) params.set('status', query.status);
  if (query.ip) params.set('ip', query.ip);
  return params.toString();
}

export async function login(username: string, password: string): Promise<{ token: string; expires_in: string }> {
  let res: Response;
  try {
    res = await fetch(apiPath('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Không kết nối được tới API. Kiểm tra api-node có đang chạy không.');
  }
  if (res.status === 401) {
    throw new ApiError(401, 'invalid_credentials', 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  if (res.status === 503) {
    throw new ApiError(503, 'login_disabled', 'Đăng nhập đang tắt trên server (chưa cấu hình API_ADMIN_USER/API_ADMIN_PASSWORD hoặc JWT_SECRET).');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `http_${res.status}`, `Đăng nhập thất bại (${res.status}).`);
  }
  return res.json() as Promise<{ token: string; expires_in: string }>;
}

export async function fetchAlerts(token: string, query: AlertsQuery): Promise<import('./types').AlertsList> {
  return request<import('./types').AlertsList>(`/api/alerts?${buildAlertsQuery(query)}`, token);
}

export async function fetchAlert(token: string, id: number): Promise<import('./types').Alert> {
  return request<import('./types').Alert>(`/api/alerts/${id}`, token);
}

export async function patchAlertStatus(
  token: string,
  id: number,
  status: import('./types').AlertStatus,
): Promise<import('./types').Alert> {
  return request<import('./types').Alert>(`/api/alerts/${id}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchStats(token: string): Promise<import('./types').Stats> {
  return request<import('./types').Stats>('/api/stats', token);
}
