import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {MobileRelayRequest,UnsignedMobileRelayRequest,MobileRelayResponse,UnsignedMobileRelayResponse,MobileRelayReplayGuard} from './mobile-relay.js';
const DEFAULT_REQUEST_MAX_AGE_MS = 60_000;
const DEFAULT_REPLAY_TTL_MS = 10 * 60_000;


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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
