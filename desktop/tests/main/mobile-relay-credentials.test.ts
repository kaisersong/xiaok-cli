import { describe, expect, it, vi } from 'vitest';
import {
  createMobileRelayBridge,
  inspectRelayJwt,
  type MobileRelayStatus,
} from '../../electron/mobile-relay.js';

/**
 * Regression for the endless `Unexpected server response: 401` in the relay bridge.
 *
 * The relay signs its JWT with a 7-day lifetime
 * (`intent-broker-relay/src/auth/jwt.js` → `setExpirationTime('7d')`) and exposes
 * no refresh grant, while `~/.intent-broker/credentials` carries a `refreshToken`
 * that neither side implements. So an expired token is a terminal state that only a
 * user re-login can clear — retrying it every 30 seconds produced noise and hid the
 * real instruction from the user.
 */
function jwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user@example.com', iss: 'intent-broker-relay', iat: 1, exp: expSeconds,
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

const NOW_MS = 1_800_000_000_000; // fixed clock

function bridgeWith(jwt: string, socketFactory?: () => unknown) {
  const statuses: MobileRelayStatus[] = [];
  const construct = vi.fn(() => (socketFactory ? socketFactory() : {
    on: () => {},
    send: () => {},
    close: () => {},
  }));
  const bridge = createMobileRelayBridge({
    identity: {
      desktopId: 'desk-1',
      mobileAccessToken: 'token',
      mobileRelayRoomSecret: 'secret',
    } as never,
    desktopName: 'Xiaok Desktop',
    relayUrl: 'wss://relay.example.com/ws',
    relayJwt: jwt,
    getHello: () => ({}) as never,
    getSnapshot: async () => ({}) as never,
    sendMessage: async () => ({}) as never,
    respondToApproval: async () => ({}) as never,
    getArtifactPreview: async () => ({}) as never,
    now: () => NOW_MS,
    onStatus: (status) => statuses.push(status),
    WebSocketImpl: construct as never,
  });
  return { bridge, statuses, construct };
}

describe('inspectRelayJwt', () => {
  it('classifies a live token, an expired token and garbage', () => {
    expect(inspectRelayJwt(jwtWithExp(NOW_MS / 1000 + 3600), NOW_MS).state).toBe('ok');
    expect(inspectRelayJwt(jwtWithExp(NOW_MS / 1000 - 3600), NOW_MS).state).toBe('expired');
    expect(inspectRelayJwt('not-a-jwt', NOW_MS).state).toBe('unparseable');
    expect(inspectRelayJwt('a.b.c', NOW_MS).state).toBe('unparseable');
  });

  it('leaves an unparseable token to the server instead of blocking the handshake', () => {
    // A token we cannot decode locally may still be one the relay accepts, so we
    // must not pre-emptively refuse it; only a real 401 makes it terminal.
    const { bridge, construct } = bridgeWith('opaque-token');
    bridge.start();
    expect(construct).toHaveBeenCalledTimes(1);
    bridge.stop();
  });

  it('reports the expiry instant so the UI can show it', () => {
    const exp = Math.floor(NOW_MS / 1000) - 52 * 86_400;
    const result = inspectRelayJwt(jwtWithExp(exp), NOW_MS);
    expect(result.state).toBe('expired');
    expect(result.expiresAt).toBe(new Date(exp * 1000).toISOString());
  });
});

describe('relay bridge credential handling', () => {
  it('never opens a socket for an already-expired token', () => {
    const { bridge, statuses, construct } = bridgeWith(jwtWithExp(NOW_MS / 1000 - 3600));

    bridge.start();

    expect(construct).not.toHaveBeenCalled();
    const last = statuses.at(-1)!;
    expect(last.credentialState).toBe('expired');
    expect(last.requiresUserReauth).toBe(true);
    expect(last.connected).toBe(false);
    expect(last.lastError).toMatch(/expired/);
    expect(last.credentialExpiresAt).toBeTruthy();
    bridge.stop();
  });

  it('does not schedule a reconnect for an expired token', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, construct } = bridgeWith(jwtWithExp(NOW_MS / 1000 - 3600));
      bridge.start();

      await vi.advanceTimersByTimeAsync(120_000);

      // Previously this produced a 401 log line roughly every 30 seconds forever.
      expect(construct).not.toHaveBeenCalled();
      bridge.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a handshake 401 as rejected credentials, not a transient error', () => {
    const handlers = new Map<string, (arg?: unknown) => void>();
    const { bridge, statuses } = bridgeWith(jwtWithExp(NOW_MS / 1000 + 3600), () => ({
      on: (event: string, handler: (arg?: unknown) => void) => { handlers.set(event, handler); },
      send: () => {},
      close: () => {},
    }));

    bridge.start();
    handlers.get('error')?.(new Error('Unexpected server response: 401'));

    const last = statuses.at(-1)!;
    expect(last.credentialState).toBe('rejected');
    expect(last.requiresUserReauth).toBe(true);
    expect(last.lastError).toMatch(/sign in again/);
    bridge.stop();
  });

  it('keeps a genuine network error retryable', async () => {
    vi.useFakeTimers();
    try {
      const handlers = new Map<string, (arg?: unknown) => void>();
      const { bridge, statuses, construct } = bridgeWith(jwtWithExp(NOW_MS / 1000 + 3600), () => ({
        on: (event: string, handler: (arg?: unknown) => void) => { handlers.set(event, handler); },
        send: () => {},
        close: () => {},
      }));

      bridge.start();
      expect(construct).toHaveBeenCalledTimes(1);
      handlers.get('error')?.(new Error('ECONNREFUSED'));
      handlers.get('close')?.();

      const afterError = statuses.at(-1)!;
      expect(afterError.credentialState).toBe('ok');
      expect(afterError.requiresUserReauth).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(construct.mock.calls.length).toBeGreaterThan(1);
      bridge.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
