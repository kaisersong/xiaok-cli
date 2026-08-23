import type { IpcMain } from 'electron';
import type { KSwarmService } from './kswarm-service.js';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';

type ProxyResponseKind = 'json' | 'text' | 'boolean';
type ProxyService = Pick<KSwarmService, 'request'>
  & Partial<Pick<KSwarmService, 'getDesktopMutationToken'>>;

interface NormalizedProxyPath {
  pathname: string;
  requestPath: string;
}

const SENSITIVE_RESPONSE_KEYS = new Set([
  'apikey',
  'baseurl',
  'credential',
  'credentials',
  'customenv',
  'providersecret',
  'runtimecredential',
  'runtimepath',
]);

const SENSITIVE_REQUEST_KEYS = new Set([
  ...SENSITIVE_RESPONSE_KEYS,
  'execution',
  'model',
  'provider',
  'secret',
]);

const SAFE_GET_PATTERNS = [
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/artifacts\/[^/]+$/,
  /^\/agents$/,
  /^\/agents\/liveness$/,
  /^\/agents\/capability-catalog$/,
  /^\/participants$/,
  /^\/runtimes$/,
  /^\/llm\/providers$/,
  /^\/llm\/models$/,
  /^\/quality\/knowledge$/,
  /^\/channels\/[^/]+\/bindings$/,
  /^\/channel-personas$/,
  /^\/channel-identities\/mine$/,
];

const SAFE_POST_PATTERNS = [
  /^\/projects\/[^/]+\/(approve|retry-plan|continue|close|deliver|dispatch)$/,
  /^\/projects\/[^/]+\/tasks$/,
  /^\/projects\/[^/]+\/tasks\/[^/]+\/(done|cancel|fail)$/,
  /^\/projects\/[^/]+\/workflows\/[^/]+$/,
  /^\/projects\/[^/]+\/workflows\/[^/]+\/(proposal|runs|cancel)$/,
  /^\/agents\/heartbeat$/,
  /^\/quality\/(patches\/apply|rules\/extract)$/,
  /^\/channel-bind-codes$/,
  /^\/channels\/[^/]+\/verify$/,
];

const SAFE_PUT_PATTERNS = [
  /^\/projects\/[^/]+\/artifacts\/[^/]+$/,
];

const SAFE_PATCH_PATTERNS = [
  /^\/channels\/[^/]+\/bindings\/[^/]+$/,
];

const SAFE_DELETE_PATTERNS = [
  /^\/channels\/[^/]+\/bindings\/[^/]+$/,
  /^\/channel-identities\/[^/]+$/,
];

export function registerKSwarmProxy(
  ipcMain: IpcHandleRegistrar,
  bridge: KSwarmStreamBridge,
  kswarmService: ProxyService | null = null,
): void {
  ipcMain.handle('desktop:kswarm:proxy:get', (_event, path: string) =>
    executeProxyRequest(kswarmService, 'GET', path, 'json'));

  ipcMain.handle('desktop:kswarm:proxy:getText', (_event, path: string) =>
    executeProxyRequest(kswarmService, 'GET', path, 'text'));

  ipcMain.handle('desktop:kswarm:proxy:post', (_event, path: string, body?: unknown) =>
    executeProxyRequest(kswarmService, 'POST', path, 'json', body));

  ipcMain.handle('desktop:kswarm:proxy:postJson', async (_event, path: string, body?: unknown) => {
    const result = await executeProxyRequest(kswarmService, 'POST', path, 'json', body, true);
    if (!isRecord(result) || result.data === null || result.data === undefined) return null;
    return { ...result.data as Record<string, unknown>, status: readStatus(result) };
  });

  ipcMain.handle('desktop:kswarm:proxy:put', (_event, path: string, body?: unknown) =>
    executeProxyRequest(kswarmService, 'PUT', path, 'json', body));

  ipcMain.handle('desktop:kswarm:proxy:patch', (_event, path: string, body?: unknown) =>
    executeProxyRequest(kswarmService, 'PATCH', path, 'json', body));

  ipcMain.handle('desktop:kswarm:proxy:delete', (_event, path: string) =>
    executeProxyRequest(kswarmService, 'DELETE', path, 'boolean'));

  ipcMain.handle('desktop:kswarm:stream:subscribe', (event) => {
    bridge.subscribe(event);
    return { ok: true };
  });

  ipcMain.handle('desktop:kswarm:stream:unsubscribe', (event) => {
    bridge.unsubscribe(event);
    return { ok: true };
  });

  ipcMain.handle('desktop:kswarm:stream:status', () => {
    return { status: bridge.getConnectionStatus() };
  });

  ipcMain.handle('desktop:connection:healthz', async (_event, url: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${url}/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('desktop:connection:health', async (_event, url: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });
}

async function executeProxyRequest(
  service: ProxyService | null,
  method: string,
  rawPath: string,
  responseKind: ProxyResponseKind,
  body?: unknown,
  includeStatus = false,
): Promise<unknown> {
  const normalized = normalizeKSwarmProxyPath(rawPath);
  if (!service
    || !normalized
    || !isKSwarmProxyRequestAllowed(method, normalized.pathname, responseKind)
    || (body !== undefined && containsSensitiveRequestData(body))) {
    return responseKind === 'boolean' ? false : null;
  }

  try {
    const options: RequestInit = {
      method,
      headers: buildKSwarmProxyHeaders(service, method),
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await service.request(normalized.requestPath, options);
    if (responseKind === 'boolean') return response.ok;

    const text = await response.text();
    if (responseKind === 'text') {
      if (!response.ok) return null;
      return redactKSwarmText(text);
    }

    const data = text ? parseJsonOrNull(text) : null;
    const redacted = redactKSwarmPayload(data);
    if (includeStatus) {
      return { data: redacted, status: response.status };
    }
    return response.ok ? redacted : null;
  } catch {
    return responseKind === 'boolean' ? false : null;
  }
}

export function normalizeKSwarmProxyPath(rawPath: string): NormalizedProxyPath | null {
  if (typeof rawPath !== 'string'
    || !rawPath.startsWith('/')
    || rawPath.startsWith('//')
    || rawPath.includes('\\')
    || /%(?:2f|5c)/i.test(rawPath)) {
    return null;
  }

  const queryIndex = rawPath.indexOf('?');
  const rawPathname = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath;
  const rawSearch = queryIndex >= 0 ? rawPath.slice(queryIndex) : '';
  const segments = rawPathname.split('/').slice(1);
  const decodedSegments: string[] = [];
  try {
    for (const [index, segment] of segments.entries()) {
      if (!segment && index < segments.length - 1) return null;
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return null;
      if (decoded) decodedSegments.push(decoded);
    }
  } catch {
    return null;
  }
  const pathname = decodedSegments.length > 0
    ? `/${decodedSegments.map((segment) => encodeURIComponent(segment)).join('/')}`
    : '/';

  try {
    const search = new URL(`http://kswarm.invalid/${rawSearch}`).search;
    return { pathname, requestPath: `${pathname}${search}` };
  } catch {
    return null;
  }
}

export function isKSwarmProxyRequestAllowed(
  method: string,
  pathname: string,
  responseKind: ProxyResponseKind,
): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET') {
    if (responseKind === 'text') {
      return /^\/projects\/[^/]+\/artifacts\/[^/]+$/.test(pathname);
    }
    return responseKind === 'json' && SAFE_GET_PATTERNS.some((pattern) => pattern.test(pathname));
  }
  if (responseKind === 'text') return false;
  if (normalizedMethod === 'POST') return SAFE_POST_PATTERNS.some((pattern) => pattern.test(pathname));
  if (normalizedMethod === 'PUT') return SAFE_PUT_PATTERNS.some((pattern) => pattern.test(pathname));
  if (normalizedMethod === 'PATCH') return SAFE_PATCH_PATTERNS.some((pattern) => pattern.test(pathname));
  if (normalizedMethod === 'DELETE') return SAFE_DELETE_PATTERNS.some((pattern) => pattern.test(pathname));
  return false;
}

export function redactKSwarmPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactKSwarmPayload(item));
  if (!isRecord(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_RESPONSE_KEYS.has(normalizedKey)) continue;
    if (normalizedKey === 'execution' && containsSensitiveResponseData(child)) continue;
    redacted[key] = redactKSwarmPayload(child);
  }
  return redacted;
}

function containsSensitiveResponseData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsSensitiveResponseData(item));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase()) || containsSensitiveResponseData(child));
}

function redactKSwarmText(text: string): string {
  const parsed = parseJsonOrNull(text);
  if (parsed !== null) return JSON.stringify(redactKSwarmPayload(parsed));
  return text;
}

function containsSensitiveRequestData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (Array.isArray(value)) {
    if (seen.has(value)) return true;
    seen.add(value);
    return value.some((item) => containsSensitiveRequestData(item, seen));
  }
  if (!isRecord(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.entries(value).some(([key, child]) =>
    SENSITIVE_REQUEST_KEYS.has(key.toLowerCase()) || containsSensitiveRequestData(child, seen));
}

function buildKSwarmProxyHeaders(
  service: Partial<Pick<KSwarmService, 'getDesktopMutationToken'>> | null,
  method: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    const token = service?.getDesktopMutationToken?.();
    if (token) headers['x-kswarm-mutation-token'] = token;
  }
  return headers;
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readStatus(result: Record<string, unknown>): number {
  const data = isRecord(result.data) ? result.data : null;
  return typeof data?.status === 'number' ? data.status : Number(result.status);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
