export const TRACE_ID_HEADER = 'X-Trace-Id';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly traceId?: string;
  readonly details?: unknown;
  constructor(params: { status: number; message: string; code?: string; traceId?: string; details?: unknown }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.traceId = params.traceId;
    this.details = params.details;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function apiBaseUrl(): string {
  return 'http://localhost:2026';
}

export function buildUrl(path: string): string {
  return apiBaseUrl() + path;
}

export function readJsonSafely(response: Response): Promise<unknown | null> {
  return response.text().then(text => {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  });
}

export async function apiFetch<T>(url: string, options: { method?: string; accessToken?: string; body?: string | FormData; headers?: Record<string, string> } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}), ...(options.headers || {}) },
    body: options.body,
  } as RequestInit);
  if (!response.ok) {
    const error = await readJsonSafely(response);
    throw new ApiError({ status: response.status, message: String(error || response.statusText), traceId: response.headers.get(TRACE_ID_HEADER) || undefined });
  }
  return (await response.json()) as T;
}

export async function silentRefresh(): Promise<string> { return ''; }
export function setUnauthenticatedHandler() {}
export function setAccessTokenHandler() {}
export function setSessionExpiredHandler() {}
export async function refreshAccessToken(): Promise<string> { return ''; }
export async function restoreAccessSession(): Promise<{ access_token: string }> { return { access_token: 'local' }; }
