/** Safe, data-only model diagnostics. Raw provider payloads never cross this boundary. */
export type ModelFailureProvider = 'glm' | 'kimi' | 'other';
export type ModelFailureCategory = 'quota' | 'balance' | 'subscription' | 'account_restricted' | 'authentication'
  | 'permission' | 'key_scope' | 'model_not_found' | 'context_length' | 'content_filter' | 'request'
  | 'rate_limit' | 'server' | 'timeout' | 'network' | 'incomplete_response' | 'protocol' | 'internal' | 'aborted' | 'unknown';
export interface ModelFailureDiagnostic {
  source: 'provider' | 'connection' | 'xiaok' | 'unknown';
  provider: ModelFailureProvider;
  category: ModelFailureCategory;
  retryable: boolean;
  status?: number;
  providerCode?: string;
  transportCode?: string;
  internalCode?: string;
  resetAt?: string;
  retryAfterMs?: number;
  retryAfterTooLong?: true;
}
const owned = new WeakMap<object, Readonly<ModelFailureDiagnostic>>();
const GLM_CODES: Readonly<Record<string, ModelFailureCategory>> = {
  '1000': 'authentication', '1001': 'authentication', '1003': 'authentication', '1005': 'authentication',
  '1113': 'balance', '1210': 'request', '1211': 'model_not_found', '1212': 'request', '1213': 'request',
  '1214': 'request', '1215': 'request', '1220': 'permission', '1221': 'request', '1222': 'request',
  '1230': 'server', '1234': 'network', '1261': 'context_length', '1301': 'content_filter',
  '1302': 'rate_limit', '1305': 'server', '1308': 'quota', '1309': 'subscription', '1310': 'quota',
  '1311': 'permission', '1313': 'account_restricted', '1314': 'subscription', '1315': 'key_scope',
  '1316': 'quota', '1317': 'quota', '1318': 'quota', '1319': 'quota', '1320': 'quota', '1321': 'quota',
};
const COMMON_CODES: Readonly<Record<string, ModelFailureCategory>> = {
  insufficient_quota: 'quota', exceeded_current_quota_error: 'quota', invalid_api_key: 'authentication',
  authentication_error: 'authentication', permission_denied: 'permission', invalid_request_error: 'request',
  model_not_found: 'model_not_found', context_length_exceeded: 'context_length',
  content_filter: 'content_filter', rate_limit_exceeded: 'rate_limit', rate_limit_error: 'rate_limit', server_error: 'server',
};
const TRANSPORT = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
  'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const INTERNAL = new Set(['KIMI_REASONING_ADMISSION_REQUIRED', 'KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED',
  'MODEL_TEXT_REPETITION_DETECTED', 'OPENAI_STREAM_TEXT_LIMIT_EXCEEDED', 'OPENAI_STREAM_TOOL_ARGUMENT_LIMIT_EXCEEDED',
  'TypeError', 'RangeError', 'SyntaxError', 'Error']);
const SOURCES = new Set(['provider', 'connection', 'xiaok', 'unknown']);
const CATEGORIES = new Set<ModelFailureCategory>(['quota', 'balance', 'subscription', 'account_restricted', 'authentication',
  'permission', 'key_scope', 'model_not_found', 'context_length', 'content_filter', 'request', 'rate_limit', 'server',
  'timeout', 'network', 'incomplete_response', 'protocol', 'internal', 'aborted', 'unknown']);
const TRANSIENT = new Set<ModelFailureCategory>(['rate_limit', 'server', 'timeout', 'network', 'incomplete_response']);
/** Data descriptors only: diagnostics must not execute arbitrary error getters. */
function data(value: unknown, key: string): unknown {
  try {
    let current = value;
    for (let n = 0; current && (typeof current === 'object' || typeof current === 'function') && n < 4; n++, current = Object.getPrototypeOf(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    }
  } catch { /* Proxies are not diagnostic evidence. */ }
  return undefined;
}
function errorName(value: unknown): string {
  try {
    if (value instanceof DOMException) return Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!.call(value) as string;
  } catch { return ''; }
  const constructorName = text(data(data(value, 'constructor'), 'name'));
  if (['APIConnectionTimeoutError', 'APIConnectionError', 'APIUserAbortError'].includes(constructorName)) return constructorName;
  return text(data(value, 'name'));
}
function text(value: unknown): string { return typeof value === 'string' ? value.slice(0, 8192) : ''; }
function status(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}
function code(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isInteger(value) ? String(value) : '';
}
function knownCode(value: unknown, provider: ModelFailureProvider): string | undefined {
  const key = code(value);
  return Object.hasOwn(COMMON_CODES, key) || provider === 'glm' && Object.hasOwn(GLM_CODES, key) ? key : undefined;
}
function validReset(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return undefined;
  const time = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 19).replace('T', ' ') === value ? value : undefined;
}
function resetTime(message: string): string | undefined {
  return validReset(message.match(/(?:限额将在\s*|额度将在\s*|重置时间[:：]?\s*)(20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s*重置)?/)?.[1]);
}
function retryAfter(headers: unknown, now: number): number | undefined {
  let raw: unknown;
  try { raw = headers instanceof Headers ? Headers.prototype.get.call(headers, 'retry-after') : data(headers, 'retry-after') ?? data(headers, 'Retry-After'); } catch { return undefined; }
  if (typeof raw !== 'string' || raw.length > 80) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : undefined;
  const parsed = seconds ?? (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw) ? Date.parse(raw) - now : NaN);
  if (parsed > 86400000) return 86400001; // Sentinel only; no oversized delay is retained.
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : undefined;
}
function kimiCategory(message: string): ModelFailureCategory | undefined {
  if (/you've reached your concurrent request limit/i.test(message)) return 'account_restricted';
  if (/your credit balance is insufficient|your organization's extra usage balance has run out/i.test(message)) return 'balance';
  if (/you've reached your (?:5-hour|weekly \(7-day\)|monthly) usage limit|you've reached the extra usage limit set for your account/i.test(message)) return 'quota';
  if (/we're receiving too many requests/i.test(message)) return 'rate_limit';
  if (/the engine is currently overloaded/i.test(message)) return 'server';
  return undefined;
}
function permanent(category: ModelFailureCategory): boolean {
  return !TRANSIENT.has(category) && !['internal', 'unknown'].includes(category);
}
/** Revalidate at event/log/UI sinks; never spread a caller-supplied object. */
export function sanitizeModelFailure(value: unknown): ModelFailureDiagnostic | undefined {
  const category = data(value, 'category') as ModelFailureCategory;
  if (!CATEGORIES.has(category)) return undefined;
  const provider = data(value, 'provider') === 'glm' ? 'glm' : data(value, 'provider') === 'kimi' ? 'kimi' : 'other';
  const source = data(value, 'source');
  const failure: ModelFailureDiagnostic = {
    source: SOURCES.has(source as string) ? source as ModelFailureDiagnostic['source'] : 'unknown', provider, category,
    retryable: data(value, 'retryable') === true && !permanent(category),
  };
  const http = status(data(value, 'status')); if (http !== undefined) failure.status = http;
  const providerCode = knownCode(data(value, 'providerCode'), provider); if (providerCode) failure.providerCode = providerCode;
  const transport = data(value, 'transportCode'); if (typeof transport === 'string' && TRANSPORT.has(transport)) failure.transportCode = transport;
  const internal = data(value, 'internalCode'); if (typeof internal === 'string' && INTERNAL.has(internal)) failure.internalCode = internal;
  const reset = validReset(data(value, 'resetAt')); if (reset) failure.resetAt = reset;
  const after = data(value, 'retryAfterMs');
  if (typeof after === 'number' && Number.isInteger(after) && after >= 0 && after <= 86400000) failure.retryAfterMs = after;
  if (data(value, 'retryAfterTooLong') === true) failure.retryAfterTooLong = true;
  if (http && http < 500 && http !== 408 && http !== 429) failure.retryable = false;
  return failure;
}
export function associateModelFailure(error: unknown, failure: ModelFailureDiagnostic): void {
  if (error && typeof error === 'object') {
    const safe = sanitizeModelFailure(failure); if (safe) owned.set(error, Object.freeze(safe));
  }
}
export function getModelFailure(error: unknown): ModelFailureDiagnostic | undefined {
  const failure = error && typeof error === 'object' ? sanitizeModelFailure(owned.get(error)) : undefined;
  if (failure && data(error, 'retryable') === false) failure.retryable = false;
  return failure;
}
export function classifyModelFailure(raw: unknown, provider: ModelFailureProvider = 'other', now = Date.now()): ModelFailureDiagnostic {
  const previous = getModelFailure(raw); if (previous) return previous;
  let best: ModelFailureDiagnostic = { source: 'xiaok', provider, category: 'internal', retryable: false };
  let rank = -1, forcedStop = false, aborted = false, after: number | undefined, sdkTimeoutCause = false;
  const seen = new Set<object>(); let current = raw;
  while (current && typeof current === 'object' && !seen.has(current) && seen.size < 16) {
    seen.add(current);
    const inherited = getModelFailure(current);
    const http = status(data(current, 'status'));
    const body = data(current, 'error');
    const candidates = [data(current, 'code'), data(body, 'code'), data(current, 'providerCode'), data(current, 'type'), data(body, 'type'), data(current, 'providerType')];
    const codes = candidates.map(value => knownCode(value, provider)).filter((value): value is string => value !== undefined);
    const definitivePermanent = codes.find(key => key !== 'exceeded_current_quota_error' && permanent(GLM_CODES[key] ?? COMMON_CODES[key]));
    const providerCode = definitivePermanent ?? codes[0];
    const message = text(data(body, 'message')) || text(data(current, 'message'));
    const name = errorName(current);
    const rawCode = code(data(current, 'code'));
    const transportCode = TRANSPORT.has(rawCode) ? rawCode : undefined;
    let category = providerCode ? (provider === 'glm' ? GLM_CODES[providerCode] : undefined) ?? COMMON_CODES[providerCode] : undefined;
    // Kimi's quota type is also used for risk/concurrency and transient limits: the official reason is more specific.
    if (provider === 'kimi' && !definitivePermanent && (http === 429 || codes.includes('exceeded_current_quota_error'))) category = kimiCategory(message) ?? 'rate_limit';
    category ??= http === 401 ? 'authentication' : http === 403 ? 'permission' : http === 408 ? 'timeout'
      : http === 429 ? 'rate_limit' : http && http >= 500 ? 'server' : http ? 'request' : undefined;
    const protocol = INTERNAL.has(rawCode) && rawCode.startsWith('KIMI_');
    if (protocol) category = rawCode === 'KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED' && data(current, 'boundaryKind') === 'missing_finish' && data(current, 'retryable') === true ? 'incomplete_response' : 'protocol';
    if (!category && (name === 'TimeoutError' || name === 'APIConnectionTimeoutError')) category = 'timeout';
    if (!category && (transportCode || name === 'APIConnectionError' || /ECONNRESET|ETIMEDOUT|EPIPE|terminated|socket hang up|fetch failed|network|premature close|connection reset|timed?\s*out/i.test(message))) category = 'network';
    category ??= data(current, 'retryable') === true ? 'unknown' : 'internal';
    const candidate: ModelFailureDiagnostic = inherited ?? { provider: protocol ? 'kimi' : provider, category,
      source: http || providerCode || protocol ? 'provider' : ['network', 'timeout'].includes(category) ? 'connection' : category === 'unknown' ? 'unknown' : 'xiaok',
      retryable: TRANSIENT.has(category) || data(current, 'retryable') === true,
      ...(http ? { status: http } : {}), ...(providerCode ? { providerCode } : {}), ...(transportCode ? { transportCode } : {}),
      ...(protocol ? { internalCode: rawCode } : category === 'internal' && INTERNAL.has(name) ? { internalCode: name } : {}),
      ...(provider === 'glm' && ['quota', 'balance'].includes(category) && resetTime(message) ? { resetAt: resetTime(message) } : {}),
    };
    const candidateRank = permanent(candidate.category) ? 100 + (candidate.providerCode ? 10 : 0)
      : candidate.category === 'internal' || candidate.category === 'unknown' ? 0 : 20 + (candidate.providerCode ? 10 : 0);
    if (candidateRank > rank) { rank = candidateRank; best = candidate; }
    forcedStop ||= data(current, 'retryable') === false || candidate.retryable === false && permanent(candidate.category);
    aborted ||= !sdkTimeoutCause && (name === 'AbortError' || name === 'APIUserAbortError' || /^Request was aborted\.?$/i.test(message));
    // The SDK's timeout aborts its own fetch; this is not a user cancellation.
    sdkTimeoutCause = name === 'APIConnectionTimeoutError';
    const wait = retryAfter(data(current, 'headers'), now); if (wait !== undefined) after = Math.max(after ?? 0, wait);
    current = data(current, 'cause');
  }
  if (aborted) best = { source: 'connection', provider, category: 'aborted', retryable: false };
  if (forcedStop) best.retryable = false;
  if (after !== undefined) { if (after > 86400000) best.retryAfterTooLong = true; else best.retryAfterMs = after; }
  return sanitizeModelFailure(best)!;
}
export function markModelReadFailure(error: unknown): ModelFailureDiagnostic {
  const failure = classifyModelFailure(error); associateModelFailure(error, failure); return failure;
}
export function createModelProviderError(raw: unknown, provider: ModelFailureProvider): Error {
  const failure = classifyModelFailure(raw, provider);
  if (failure.category === 'internal') { failure.source = 'provider'; failure.category = 'unknown'; }
  const error = Object.assign(new Error(formatModelFailure(failure)), { name: failure.category === 'aborted' ? 'AbortError' : 'ModelProviderRequestError',
    code: 'MODEL_PROVIDER_REQUEST_FAILED', retryable: failure.retryable, ...(failure.status ? { status: failure.status } : {}) });
  associateModelFailure(error, failure); return error;
}
const LABELS: Record<ModelFailureCategory, string> = {
  quota: '套餐额度已用尽', balance: '可用余额不足', subscription: '订阅套餐已失效', account_restricted: '账户受到风控限制，需联系供应商',
  authentication: 'API key 验证失败', permission: '账户或模型权限不足', key_scope: 'API key 不适用于当前接口', model_not_found: '模型不存在或不可用',
  context_length: '输入超过模型上下文限制', content_filter: '供应商内容安全策略拦截了请求', request: '请求被供应商拒绝',
  rate_limit: '请求频率受限', server: '供应商服务繁忙或异常', timeout: '模型请求超时', network: '模型网络连接中断',
  incomplete_response: '供应商响应提前结束', protocol: '模型响应未通过协议校验', internal: '模型调用内部异常', aborted: '模型请求已取消', unknown: '模型调用失败，供应商未提供可识别原因',
};
export function formatModelFailure(value: ModelFailureDiagnostic): string {
  const failure = sanitizeModelFailure(value);
  if (!failure) return '模型调用失败，原因未识别';
  const provider = failure.provider === 'glm' ? 'GLM' : failure.provider === 'kimi' ? 'Kimi' : failure.source === 'provider' ? '模型供应商' : '';
  const fields: string[] = [];
  if (failure.status) fields.push(`HTTP ${failure.status}`);
  if (failure.providerCode) fields.push(`业务码 ${failure.providerCode}`);
  if (failure.transportCode) fields.push(failure.transportCode);
  if (failure.internalCode) fields.push(failure.internalCode);
  if (failure.resetAt) fields.push(`供应商重置时间 ${failure.resetAt}`);
  return `${failure.source === 'xiaok' ? 'xiaok ' : provider ? provider + ' ' : ''}${LABELS[failure.category]}${fields.length ? `（${fields.join('，')}）` : ''}`;
}

export function formatModelRecoveryExhaustion(failure?: ModelFailureDiagnostic): string {
  return `${failure ? formatModelFailure(failure) + '；' : ''}自动恢复窗口不足或已耗尽，已停止自动续接；已完成的工作保留，可稍后继续。`;
}

export { data as readModelFailureField };
