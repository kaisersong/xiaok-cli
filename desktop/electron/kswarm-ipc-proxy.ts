import type { IpcMain } from 'electron';
import type { KSwarmService } from './kswarm-service.js';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { registerKSwarmProxyTypedIpc } from './kswarm-proxy-typed-ipc.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { proxyRouteOutputIsValid, PROXY_STATUS_RESULT_SCHEMA, type ProxyFactData } from '../shared/kswarm-proxy-ipc-contract.js';
const defineData = Object.defineProperty;

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

// Paths are normalized segment-by-segment before this read-only allowlist.
const PROJECT_ARTIFACT_READ_PATTERN = /^\/projects\/[^/]+\/artifacts\/[^/]+(?:\/[^/]+)*$/;

const SAFE_GET_PATTERNS = [
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  PROJECT_ARTIFACT_READ_PATTERN,
  // design §9.1/§9.3：getProjectGateSnapshot 只读 DTO 端点，返回值本身在
  // hub.js 层面已经是 allowlist（不含绝对路径/raw evidence body），这里
  // 只需要放行路径本身，不需要额外的响应字段过滤。
  /^\/projects\/[^/]+\/gate-snapshot$/,
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
  // design §9.1/§9.3：submitUserGateAction 的第一个真实映射——用户批准候选
  // FinalDeliverable。已经用 resolveDesktopMutationContext 鉴权
  // （server/index.js 第 3127 行附近），只接受 Desktop mutation token，
  // 符合"user-only final approval/supersede 只接受 Desktop mutation token"。
  /^\/projects\/[^/]+\/final-deliverables\/[^/]+\/approve$/,
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
  workspace?:{dispatchProject(projectId:string,body:unknown):Promise<Record<string,unknown>|null>;authorize(event:unknown):boolean},
): void {
  const authorize = workspace?.authorize, dispatch = workspace?.dispatchProject;
  const boundWorkspace = workspace && authorize && dispatch ? Object.freeze({
    authorize: (event: unknown) => authorize.call(workspace, event),
    dispatchProject: (id: string, body: unknown) => dispatch.call(workspace, id, body),
  }) : undefined;
  registerKSwarmProxyTypedIpc(ipcMain, {
    bridge, service: kswarmService, workspace,
    isDispatch(path) {
      const normalized = normalizeKSwarmProxyPath(path);
      return !!normalized && /^\/projects\/[^/]+\/dispatch$/.test(normalized.pathname);
    },
    eligible(method, rawPath) {
      if (typeof rawPath !== 'string') return false;
      const normalized = normalizeKSwarmProxyPath(rawPath);
      const verb = method === 'postJson' ? 'POST' : method === 'getText' ? 'GET' : method.toUpperCase();
      const kind = method === 'getText' ? 'text' : method === 'delete' ? 'boolean' : 'json';
      return !!normalized && isKSwarmProxyRequestAllowed(verb, normalized.pathname, kind);
    },
    execute(method, event, args) {
      const path = args[0] as string, body = args[1];
      if (method === 'subscribe' || method === 'unsubscribe') {
        if (method === 'subscribe') bridge.subscribe(event as Parameters<KSwarmStreamBridge['subscribe']>[0]);
        else bridge.unsubscribe(event as Parameters<KSwarmStreamBridge['unsubscribe']>[0]);
        return { ok: true };
      }
      if (method === 'status') {
        const status = bridge.getConnectionStatus();
        try {
          const snapshot = captureIpcData({ status }, 'proxy_operation_unknown');
          if (PROXY_STATUS_RESULT_SCHEMA.safeParse(snapshot).success) return snapshot;
        } catch { /* The caller boundary cannot undo any producer effect. */ }
        return { status: 'disconnected', code: 'proxy_operation_unknown' };
      }
      if (method === 'healthz' || method === 'health') return executeConnectionHealth(path, method);
      if (method === 'postJson') return (async () => {
        const result = await executeProxyRequest(kswarmService, 'POST', path, 'json', body, true, boundWorkspace, event);
        if (!isRecord(result) || result.data === null || result.data === undefined) return null;
        return captureIpcData({ ...result.data as Record<string, unknown>, status: readStatus(result) });
      })();
      return executeProxyRequest(kswarmService, method === 'getText' ? 'GET' : method.toUpperCase(), path,
        method === 'getText' ? 'text' : method === 'delete' ? 'boolean' : 'json', body, false, boundWorkspace, event);
    },
  });
}

async function executeConnectionHealth(url: string, method: 'health' | 'healthz'): Promise<{ ok: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), method === 'healthz' ? 5000 : 3000);
    const response = await fetch(`${url}/${method}`, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: response.ok };
  } catch { return { ok: false }; }
}
function captureProxyFacts(pathname: string, value: unknown, method: string): ProxyFactData {
  const snapshot = captureIpcData(value, 'proxy_operation_unknown') as ProxyFactData;
  if (!proxyRouteOutputIsValid(pathname, snapshot, method)) throw Error('proxy_operation_unknown');
  return snapshot;
}

async function executeProxyRequest(
  service: ProxyService | null,
  method: string,
  rawPath: string,
  responseKind: ProxyResponseKind,
  body?: unknown,
  includeStatus = false,
  workspace?:{dispatchProject(projectId:string,body:unknown):Promise<Record<string,unknown>|null>;authorize(event:unknown):boolean},
  event?:unknown,
): Promise<unknown> {
  const normalized = normalizeKSwarmProxyPath(rawPath);
  if (!service
    || !normalized
    || !isKSwarmProxyRequestAllowed(method, normalized.pathname, responseKind)
    || (body !== undefined && containsSensitiveRequestData(body))) {
    return responseKind === 'boolean' ? false : null;
  }

  try {
    const dispatch=method==='POST'?normalized.pathname.match(/^\/projects\/([^/]+)\/dispatch$/):null;
    if(dispatch&&workspace){
      let result:Record<string,unknown>|null;
      if(!workspace.authorize(event))result={ok:false,code:'workspace_ipc_forbidden'};
      else try{result=await workspace.dispatchProject(decodeURIComponent(dispatch[1]),body);}
      catch(error){result={ok:false,code:error instanceof Error?error.message:'workspace_dispatch_failed'};}
      result=captureIpcData(result,'proxy_operation_unknown');
      if(result!==null){const data=captureProxyFacts(normalized.pathname,redactKSwarmPayload(result),method);return includeStatus?{data,status:result.ok===false?409:200}:data;}
    }
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
    const redacted = captureProxyFacts(normalized.pathname, redactKSwarmPayload(data), method);
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
      return PROJECT_ARTIFACT_READ_PATTERN.test(pathname);
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

/**
 * Semantic guard used by contract tests (design §9.3, §16.3): every proxy
 * method must keep denying Room/link routes — room mutations are only
 * reachable through the semantic collaboration-room channels.
 */
export function isSafeKswarmProxyPath(method: string, path: string): boolean {
  const normalized = normalizeKSwarmProxyPath(path);
  if (!normalized) return false;
  const responseKind: ProxyResponseKind =
    method.toLowerCase() === 'gettext' ? 'text' : 'json';
  const normalizedMethod = method.toLowerCase() === 'gettext' ? 'GET' : method;
  return isKSwarmProxyRequestAllowed(normalizedMethod, normalized.pathname, responseKind);
}

export function redactKSwarmPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactKSwarmPayload(item));
  if (!isRecord(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_RESPONSE_KEYS.has(normalizedKey)) continue;
    if (normalizedKey === 'execution' && containsSensitiveResponseData(child)) continue;
    defineData(redacted, key, { __proto__: null, value: redactKSwarmPayload(child), enumerable: true, writable: true, configurable: true } as PropertyDescriptor);
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
