import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type {
  MobileDesktopHello,
  MobileDesktopIdentity,
  MobileEvent,
  MobileSnapshot,
  MobileApprovalDecision,
  MobileArtifactPreview,
} from './mobile-gateway.js';

const PROTOCOL_VERSION = '1';
const DEFAULT_RELAY_URL = 'wss://relay.kaihub.space/ws';
const DEFAULT_MAX_SNAPSHOT_BYTES = 48 * 1024;
const DEFAULT_REQUEST_MAX_AGE_MS = 60_000;
const DEFAULT_REPLAY_TTL_MS = 10 * 60_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DESKTOP_NODE_ID = 'desk';

export interface MobileRelayConfig {
  relayUrl: string;
  relayJwt: string;
  source: 'env' | 'credentials';
}

export interface MobileRelayRequest {
  kind: 'mobile.request';
  requestId: string;
  desktopId: string;
  mobileNodeId: string;
  sentAt: string;
  route: 'hello' | 'snapshot' | 'chat.send' | 'approval.respond' | 'artifact.preview';
  body?: Record<string, unknown>;
  signature: string;
}

export interface UnsignedMobileRelayRequest extends Omit<MobileRelayRequest, 'signature'> {}

export interface MobileRelayResponse {
  kind: 'mobile.response';
  requestId: string;
  desktopId: string;
  sentAt: string;
  status: number;
  body: Record<string, unknown>;
  signature: string;
}

interface UnsignedMobileRelayResponse extends Omit<MobileRelayResponse, 'signature'> {}

export interface MobileRelayReplayGuard {
  accept(requestId: string, nowMs?: number): boolean;
}

/**
 * Why this is typed rather than a bare `lastError` string: the relay JWT lives for
 * 7 days (`intent-broker-relay/src/auth/jwt.js` signs with `setExpirationTime('7d')`)
 * and the credentials file carries a `refreshToken` that neither side implements,
 * so expiry is a *routine* state that only the user can clear by logging in again.
 * Reporting it as `Unexpected server response: 401` every 30 seconds told nobody
 * anything and kept a doomed reconnect loop alive.
 */
export type MobileRelayCredentialState =
  | 'ok'
  | 'missing'
  | 'expired'
  | 'rejected'
  | 'unparseable';

export interface MobileRelayStatus {
  running: boolean;
  connected: boolean;
  relayUrl: string;
  roomId: string;
  lastError: string | null;
  credentialState: MobileRelayCredentialState;
  /** Present when the local JWT carries a decodable `exp`. */
  credentialExpiresAt?: string;
  /** True when only an explicit user re-login can change the outcome. */
  requiresUserReauth: boolean;
}

export interface MobileRelayBridge {
  start(): void;
  stop(): void;
  getStatus(): MobileRelayStatus;
}

interface RelayWebSocketLike {
  readyState: number;
  on(event: 'open' | 'message' | 'close' | 'error', handler: (...args: any[]) => void): unknown;
  send(value: string): void;
  close(): void;
}

type RelayWebSocketConstructor = new (
  url: string,
  options: { headers: Record<string, string> },
) => RelayWebSocketLike;

export interface MobileRelayBridgeOptions {
  identity: MobileDesktopIdentity;
  desktopName: string;
  relayUrl: string;
  relayJwt: string;
  getHello?: () => MobileDesktopHello | Promise<MobileDesktopHello>;
  getSnapshot?: () => MobileSnapshot | Promise<MobileSnapshot>;
  sendMessage?: (text: string) => MobileEvent[] | Promise<MobileEvent[]>;
  respondToApproval?: (input: { id: string; decision: MobileApprovalDecision }) => unknown | Promise<unknown>;
  getArtifactPreview?: (artifactId: string) => MobileArtifactPreview | null | Promise<MobileArtifactPreview | null>;
  WebSocketImpl?: RelayWebSocketConstructor;
  maxSnapshotBytes?: number;
  reconnectBaseDelayMs?: number;
  now?: () => number;
  onStatus?: (status: MobileRelayStatus) => void;
}

export function deriveMobileRelayRoomId(roomSecret: string): string {
  return createHash('sha256').update(roomSecret).digest('hex').slice(0, 32);
}

export function signMobileRelayRequest(
  request: UnsignedMobileRelayRequest,
  mobileAccessToken: string,
): MobileRelayRequest {
  return {
    ...request,
    signature: signCanonical(request, mobileAccessToken),
  };
}

export function signMobileRelayResponse(
  response: UnsignedMobileRelayResponse,
  mobileAccessToken: string,
): MobileRelayResponse {
  return {
    ...response,
    signature: signCanonical(response, mobileAccessToken),
  };
}

export function verifyMobileRelayRequest(
  input: unknown,
  mobileAccessToken: string,
  options: {
    desktopId?: string;
    nowMs?: number;
    maxAgeMs?: number;
    replayGuard?: MobileRelayReplayGuard;
  } = {},
): { ok: true; request: MobileRelayRequest } | { ok: false; reason: string; request?: MobileRelayRequest } {
  const request = parseRelayRequest(input);
  if (!request) return { ok: false, reason: 'invalid_request' };
  if (options.desktopId && request.desktopId !== options.desktopId) {
    return { ok: false, reason: 'desktop_mismatch', request };
  }

  const { signature: _signature, ...unsigned } = request;
  if (!verifyCanonical(unsigned, mobileAccessToken, request.signature)) {
    return { ok: false, reason: 'bad_signature', request };
  }

  const sentAtMs = Date.parse(request.sentAt);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_REQUEST_MAX_AGE_MS;
  if (!Number.isFinite(sentAtMs) || Math.abs(nowMs - sentAtMs) > maxAgeMs) {
    return { ok: false, reason: 'stale_request', request };
  }

  if (options.replayGuard && !options.replayGuard.accept(request.requestId, nowMs)) {
    return { ok: false, reason: 'duplicate_request', request };
  }

  return { ok: true, request };
}

export function verifyMobileRelayResponse(
  input: unknown,
  mobileAccessToken: string,
): { ok: true; response: MobileRelayResponse } | { ok: false; reason: string } {
  const response = parseRelayResponse(input);
  if (!response) return { ok: false, reason: 'invalid_response' };
  const { signature: _signature, ...unsigned } = response;
  if (!verifyCanonical(unsigned, mobileAccessToken, response.signature)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, response };
}

export function createMobileRelayReplayGuard(ttlMs = DEFAULT_REPLAY_TTL_MS): MobileRelayReplayGuard {
  const seen = new Map<string, number>();
  return {
    accept(requestId: string, nowMs = Date.now()) {
      for (const [id, expiresAt] of seen) {
        if (expiresAt <= nowMs) seen.delete(id);
      }
      if (seen.has(requestId)) return false;
      seen.set(requestId, nowMs + ttlMs);
      return true;
    },
  };
}

/**
 * Reads the `exp` claim without verifying the signature: we only need to know
 * whether a handshake is worth attempting. Verification stays server-side.
 */
export function inspectRelayJwt(jwt: string, nowMs: number): {
  state: 'ok' | 'expired' | 'unparseable';
  expiresAt?: string;
} {
  const segments = jwt.split('.');
  if (segments.length !== 3) return { state: 'unparseable' };
  try {
    const padded = segments[1] + '='.repeat((4 - (segments[1].length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as { exp?: unknown };
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return { state: 'unparseable' };
    const expiresAt = new Date(claims.exp * 1000).toISOString();
    return { state: claims.exp * 1000 <= nowMs ? 'expired' : 'ok', expiresAt };
  } catch {
    return { state: 'unparseable' };
  }
}

export function loadMobileRelayConfig(input: {
  env?: NodeJS.ProcessEnv;
  credentialsPath?: string;
} = {}): MobileRelayConfig | null {
  const env = input.env ?? process.env;
  if (env.XIAOK_MOBILE_RELAY_DISABLED === '1') return null;

  const relayUrl = normalizeRelayWebSocketUrl(env.XIAOK_MOBILE_RELAY_URL ?? DEFAULT_RELAY_URL);
  const envJwt = env.XIAOK_MOBILE_RELAY_JWT?.trim();
  if (envJwt) return { relayUrl, relayJwt: envJwt, source: 'env' };

  const credentialsPath = input.credentialsPath ?? join(homedir(), '.intent-broker', 'credentials');
  if (!existsSync(credentialsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8')) as { jwt?: string };
    if (parsed.jwt?.trim()) return { relayUrl, relayJwt: parsed.jwt.trim(), source: 'credentials' };
  } catch {
    return null;
  }
  return null;
}

export function createMobileRelayBridge(options: MobileRelayBridgeOptions): MobileRelayBridge {
  const roomId = deriveMobileRelayRoomId(options.identity.mobileRelayRoomSecret);
  const WebSocketImpl = options.WebSocketImpl ?? (WebSocket as unknown as RelayWebSocketConstructor);
  const replayGuard = createMobileRelayReplayGuard();
  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
  const now = options.now ?? Date.now;
  let socket: RelayWebSocketLike | null = null;
  let running = false;
  let connected = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let lastError: string | null = null;
  let credentialState: MobileRelayCredentialState = 'ok';
  let credentialExpiresAt: string | undefined;

  const status = (): MobileRelayStatus => ({
    running,
    connected,
    relayUrl: options.relayUrl,
    roomId,
    lastError,
    credentialState,
    ...(credentialExpiresAt ? { credentialExpiresAt } : {}),
    requiresUserReauth: credentialState === 'expired' || credentialState === 'rejected',
  });

  function emitStatus(): void {
    options.onStatus?.(status());
  }

  function connect(): void {
    if (!running) return;

    // Fail closed before the handshake when the local token is already dead: a
    // 7-day JWT that expired 52 days ago cannot be fixed by retrying, and there
    // is no refresh grant on the relay to fall back to.
    // Only *proven* expiry blocks the handshake. A token we cannot parse locally
    // may still be one the relay accepts (e.g. an opaque token supplied through
    // XIAOK_MOBILE_RELAY_JWT), so that case is left to the server, which answers
    // 401 and is then classified as `rejected` below.
    const inspected = inspectRelayJwt(options.relayJwt, now());
    credentialExpiresAt = inspected.expiresAt;
    if (inspected.state === 'expired') {
      credentialState = 'expired';
      lastError = `relay credentials expired at ${inspected.expiresAt ?? 'unknown'}; sign in again to reconnect`;
      connected = false;
      emitStatus();
      return; // no reconnect scheduled: only a user action can change this
    }

    const ws = new WebSocketImpl(options.relayUrl, {
      headers: {
        Authorization: `Bearer ${options.relayJwt}`,
        'X-Room-Id': roomId,
        'X-Broker-Id': options.identity.desktopId,
        'X-Node-Id': DESKTOP_NODE_ID,
        'X-Protocol-Version': PROTOCOL_VERSION,
      },
    });
    socket = ws;

    ws.on('open', () => {
      connected = true;
      reconnectAttempt = 0;
      lastError = null;
      credentialState = 'ok';
      emitStatus();
    });
    ws.on('message', (data) => {
      void handleSocketMessage(data);
    });
    ws.on('close', () => {
      if (socket === ws) socket = null;
      connected = false;
      emitStatus();
      scheduleReconnect();
    });
    ws.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      // The relay answers an invalid/expired token with a 401 handshake response.
      // Treat it as a terminal credential state, not a transient network error.
      if (/\b401\b/.test(message)) {
        credentialState = 'rejected';
        lastError = `relay rejected the credentials (401); sign in again to reconnect`;
      } else {
        lastError = message;
      }
      emitStatus();
    });
  }

  function scheduleReconnect(): void {
    if (!running || reconnectTimer) return;
    // A credential problem is not retryable; stop instead of logging a 401 every
    // 30 seconds forever.
    if (credentialState === 'expired' || credentialState === 'rejected') {
      return;
    }
    const delay = Math.min(30_000, reconnectBaseDelayMs * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  async function handleSocketMessage(data: unknown): Promise<void> {
    const message = parseRelayEnvelope(data);
    if (!message) return;
    if (message.type === 'relay:hello') {
      connected = true;
      emitStatus();
      return;
    }
    if (message.type === 'relay:pong') return;
    if (message.type !== 'relay:event') return;

    const verification = verifyMobileRelayRequest(message.payload, options.identity.mobileAccessToken, {
      desktopId: options.identity.desktopId,
      nowMs: now(),
      replayGuard,
    });
    if (!verification.ok) {
      if (verification.reason === 'bad_signature' || verification.reason === 'desktop_mismatch' || !verification.request) return;
      sendRelayResponse(buildErrorResponse(verification.request, verification.reason, now()));
      return;
    }

    sendRelayResponse(await handleMobileRequest(verification.request));
  }

  async function handleMobileRequest(request: MobileRelayRequest): Promise<MobileRelayResponse> {
    const body = await routeMobileRequest(request);
    return signMobileRelayResponse({
      kind: 'mobile.response',
      requestId: request.requestId,
      desktopId: options.identity.desktopId,
      sentAt: new Date(now()).toISOString(),
      status: body.status,
      body: body.body,
    }, options.identity.mobileAccessToken);
  }

  async function routeMobileRequest(request: MobileRelayRequest): Promise<{ status: number; body: Record<string, unknown> }> {
    if (request.route === 'hello') {
      const hello = options.getHello
        ? await options.getHello()
        : defaultHello(options.identity.desktopId, options.desktopName);
      return { status: 200, body: hello as unknown as Record<string, unknown> };
    }

    if (request.route === 'snapshot') {
      const snapshot = options.getSnapshot
        ? await options.getSnapshot()
        : defaultSnapshot(options.desktopName);
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > maxSnapshotBytes) {
        return { status: 413, body: { error: 'snapshot_too_large' } };
      }
      return { status: 200, body: snapshot as unknown as Record<string, unknown> };
    }

    if (request.route === 'chat.send') {
      const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
      if (!text) return { status: 400, body: { error: 'message_text_required' } };
      const events = options.sendMessage ? await options.sendMessage(text) : defaultChatEvents(text);
      return { status: 200, body: { events } };
    }

    if (request.route === 'approval.respond') {
      if (options.respondToApproval) {
        const id = typeof request.body?.id === 'string' ? request.body.id.trim() : '';
        const decision = request.body?.decision === 'approve' || request.body?.decision === 'reject'
          ? request.body.decision
          : null;
        if (!id || !decision) return { status: 400, body: { error: 'approval_decision_required' } };
        const approval = await options.respondToApproval({ id, decision });
        return { status: 200, body: { approval: approval as Record<string, unknown> } };
      }
      return { status: 403, body: { error: 'desktop_confirmation_required' } };
    }

    if (request.route === 'artifact.preview') {
      const artifactId = typeof request.body?.id === 'string' ? request.body.id.trim() : '';
      if (!artifactId) return { status: 400, body: { error: 'artifact_id_required' } };
      if (!options.getArtifactPreview) return { status: 404, body: { error: 'artifact_preview_not_found' } };
      const preview = await options.getArtifactPreview(artifactId);
      if (!preview) return { status: 404, body: { error: 'artifact_preview_not_found' } };
      return { status: 200, body: preview as unknown as Record<string, unknown> };
    }

    return { status: 404, body: { error: 'not_found' } };
  }

  function buildErrorResponse(request: MobileRelayRequest, reason: string, nowMs: number): MobileRelayResponse {
    const statusByReason: Record<string, number> = {
      stale_request: 408,
      duplicate_request: 409,
      invalid_request: 400,
    };
    return signMobileRelayResponse({
      kind: 'mobile.response',
      requestId: request.requestId,
      desktopId: options.identity.desktopId,
      sentAt: new Date(nowMs).toISOString(),
      status: statusByReason[reason] ?? 400,
      body: { error: reason },
    }, options.identity.mobileAccessToken);
  }

  function sendRelayResponse(payload: MobileRelayResponse): void {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: 'relay:event', payload }));
  }

  return {
    start() {
      if (running) return;
      running = true;
      connect();
      emitStatus();
    },

    stop() {
      running = false;
      connected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = socket;
      socket = null;
      current?.close();
      emitStatus();
    },

    getStatus() {
      return status();
    },
  };
}

function signCanonical(value: unknown, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(value)).digest('base64url');
}

function verifyCanonical(value: unknown, secret: string, signature: string): boolean {
  const expected = Buffer.from(signCanonical(value, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  const entries = Object.entries(object)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
}

function parseRelayRequest(input: unknown): MobileRelayRequest | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Partial<MobileRelayRequest>;
  if (candidate.kind !== 'mobile.request') return null;
  if (typeof candidate.requestId !== 'string' || candidate.requestId.length === 0) return null;
  if (typeof candidate.desktopId !== 'string' || candidate.desktopId.length === 0) return null;
  if (typeof candidate.mobileNodeId !== 'string' || candidate.mobileNodeId.length === 0) return null;
  if (typeof candidate.sentAt !== 'string' || candidate.sentAt.length === 0) return null;
  if (!['hello', 'snapshot', 'chat.send', 'approval.respond', 'artifact.preview'].includes(String(candidate.route))) return null;
  if (typeof candidate.signature !== 'string' || candidate.signature.length === 0) return null;
  return {
    kind: 'mobile.request',
    requestId: candidate.requestId,
    desktopId: candidate.desktopId,
    mobileNodeId: candidate.mobileNodeId,
    sentAt: candidate.sentAt,
    route: candidate.route as MobileRelayRequest['route'],
    body: isRecord(candidate.body) ? candidate.body : {},
    signature: candidate.signature,
  };
}

function parseRelayResponse(input: unknown): MobileRelayResponse | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Partial<MobileRelayResponse>;
  if (candidate.kind !== 'mobile.response') return null;
  if (typeof candidate.requestId !== 'string' || candidate.requestId.length === 0) return null;
  if (typeof candidate.desktopId !== 'string' || candidate.desktopId.length === 0) return null;
  if (typeof candidate.sentAt !== 'string' || candidate.sentAt.length === 0) return null;
  if (typeof candidate.status !== 'number') return null;
  if (!isRecord(candidate.body)) return null;
  if (typeof candidate.signature !== 'string' || candidate.signature.length === 0) return null;
  return {
    kind: 'mobile.response',
    requestId: candidate.requestId,
    desktopId: candidate.desktopId,
    sentAt: candidate.sentAt,
    status: candidate.status,
    body: candidate.body,
    signature: candidate.signature,
  };
}

function parseRelayEnvelope(data: unknown): { type: string; payload?: unknown } | null {
  const raw = typeof data === 'string'
    ? data
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : String(data);
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    if (typeof parsed.type !== 'string') return null;
    return { type: parsed.type, payload: parsed.payload };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRelayWebSocketUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws';
  return url.toString();
}

function defaultHello(desktopId: string, desktopName: string): MobileDesktopHello {
  return {
    desktopId,
    desktopName,
    protocol: 'mobile-v1',
    health: 'online',
    reachableURLs: [],
  };
}

function defaultSnapshot(desktopName: string): MobileSnapshot {
  return {
    desktopName,
    health: 'online',
    lastSyncSequence: Date.now(),
    runningTurn: null,
    messages: [],
    conversations: [],
    projects: [],
    approvals: [],
    loops: [],
    artifacts: [],
  };
}

function defaultChatEvents(text: string): MobileEvent[] {
  const sequence = Date.now();
  return [
    {
      type: 'chat.message_appended',
      sequence,
      message: {
        id: `mobile-user-${sequence}`,
        role: 'user',
        text,
        createdAt: new Date(sequence).toISOString(),
      },
    },
    { type: 'snapshot.required', sequence: sequence + 1 },
  ];
}
