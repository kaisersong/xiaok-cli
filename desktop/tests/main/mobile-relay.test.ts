import { describe, expect, it } from 'vitest';
import {
  createMobileRelayBridge,
  createMobileRelayReplayGuard,
  deriveMobileRelayRoomId,
  signMobileRelayRequest,
  verifyMobileRelayResponse,
  type MobileRelayRequest,
} from '../../electron/mobile-relay.js';
import type { MobileDesktopIdentity } from '../../electron/mobile-gateway.js';

const identity: MobileDesktopIdentity = {
  desktopId: 'desktop-test',
  mobileAccessToken: 'mobile-token-secret',
  mobileRelayRoomSecret: 'relay-room-secret',
  createdAt: '2026-06-28T00:00:00.000Z',
};

describe('mobile relay bridge', () => {
  it('derives a stable non-secret room id from the mobile relay room secret', () => {
    const roomId = deriveMobileRelayRoomId('room-secret');

    expect(roomId).toMatch(/^[a-f0-9]{32}$/);
    expect(roomId).toBe(deriveMobileRelayRoomId('room-secret'));
    expect(roomId).not.toContain('room-secret');
  });

  it('signs relay requests without putting the mobile token in the payload', () => {
    const signed = signMobileRelayRequest({
      kind: 'mobile.request',
      requestId: 'req-1',
      desktopId: identity.desktopId,
      mobileNodeId: 'mob1',
      sentAt: '2026-06-28T00:00:00.000Z',
      route: 'snapshot',
      body: {},
    }, identity.mobileAccessToken);

    expect(JSON.stringify(signed)).not.toContain(identity.mobileAccessToken);
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('serves a signed snapshot response over relay', async () => {
    const FakeWebSocket = createFakeRelayWebSocket();
    const bridge = createMobileRelayBridge({
      identity,
      desktopName: 'Test Desktop',
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt',
      now: () => Date.parse('2026-06-28T00:00:10.000Z'),
      WebSocketImpl: FakeWebSocket,
      getSnapshot: () => ({
        desktopName: 'Test Desktop',
        health: 'online',
        lastSyncSequence: 42,
        runningTurn: null,
        messages: [],
        projects: [],
        approvals: [],
        loops: [],
        artifacts: [],
      }),
    });

    bridge.start();
    await nextTick();
    const socket = FakeWebSocket.instances[0];
    socket.emitMessage({ type: 'relay:hello' });
    socket.emitMessage({
      type: 'relay:event',
      payload: signedRequest('req-1', 'snapshot', {}),
    });
    await nextTick();

    const sent = socket.sent.at(-1);
    expect(sent?.type).toBe('relay:event');
    expect(sent?.payload.kind).toBe('mobile.response');
    expect(sent?.payload.status).toBe(200);
    expect(sent?.payload.body.lastSyncSequence).toBe(42);
    expect(verifyMobileRelayResponse(sent!.payload, identity.mobileAccessToken).ok).toBe(true);
    expect(JSON.stringify(sent)).not.toContain(identity.mobileAccessToken);

    bridge.stop();
  });

  it('serves artifact previews over signed relay requests', async () => {
    const FakeWebSocket = createFakeRelayWebSocket();
    const bridge = createMobileRelayBridge({
      identity,
      desktopName: 'Test Desktop',
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt',
      now: () => Date.parse('2026-06-28T00:00:10.000Z'),
      WebSocketImpl: FakeWebSocket,
      getArtifactPreview: async (artifactId: string) => artifactId === 'artifact-report'
        ? {
          artifact: {
            id: 'artifact-report',
            name: 'report.md',
            kind: 'markdown',
            source: 'task-rich',
            status: 'ready',
            previewAvailable: true,
            mimeType: 'text/markdown',
          },
          contentType: 'text/markdown',
          text: '# Report\n\nReady',
        }
        : null,
    });

    bridge.start();
    await nextTick();
    const socket = FakeWebSocket.instances[0];
    socket.emitMessage({
      type: 'relay:event',
      payload: signedRequest('req-artifact', 'artifact.preview', { id: 'artifact-report' }),
    });
    await nextTick();

    const sent = socket.sent.at(-1);
    expect(sent?.payload.status).toBe(200);
    expect(sent?.payload.body.artifact.name).toBe('report.md');
    expect(sent?.payload.body.text).toBe('# Report\n\nReady');
    expect(verifyMobileRelayResponse(sent!.payload, identity.mobileAccessToken).ok).toBe(true);

    bridge.stop();
  });

  it('rejects duplicate relay request ids after the first accepted request', async () => {
    const FakeWebSocket = createFakeRelayWebSocket();
    const bridge = createMobileRelayBridge({
      identity,
      desktopName: 'Test Desktop',
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt',
      now: () => Date.parse('2026-06-28T00:00:10.000Z'),
      WebSocketImpl: FakeWebSocket,
    });
    const request = signedRequest('req-duplicate', 'hello', {});

    bridge.start();
    await nextTick();
    const socket = FakeWebSocket.instances[0];
    socket.emitMessage({ type: 'relay:event', payload: request });
    await nextTick();
    expect(socket.sent.at(-1)?.payload.status).toBe(200);

    socket.emitMessage({ type: 'relay:event', payload: request });
    await nextTick();

    expect(socket.sent.at(-1)?.payload.status).toBe(409);

    bridge.stop();
  });

  it('caps snapshot responses before sending them through relay', async () => {
    const FakeWebSocket = createFakeRelayWebSocket();
    const bridge = createMobileRelayBridge({
      identity,
      desktopName: 'Test Desktop',
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt',
      now: () => Date.parse('2026-06-28T00:00:10.000Z'),
      WebSocketImpl: FakeWebSocket,
      maxSnapshotBytes: 80,
      getSnapshot: () => ({
        desktopName: 'Test Desktop',
        health: 'online',
        lastSyncSequence: 42,
        runningTurn: null,
        messages: [{ id: 'm1', role: 'assistant', text: 'x'.repeat(500), createdAt: '2026-06-28T00:00:00.000Z' }],
        projects: [],
        approvals: [],
        loops: [],
        artifacts: [],
      }),
    });

    bridge.start();
    await nextTick();
    const socket = FakeWebSocket.instances[0];
    socket.emitMessage({ type: 'relay:event', payload: signedRequest('req-large', 'snapshot', {}) });
    await nextTick();

    const sent = socket.sent.at(-1);
    expect(sent?.payload.status).toBe(413);
    expect(sent?.payload.body.error).toBe('snapshot_too_large');

    bridge.stop();
  });

  it('keeps approval responses blocked behind desktop confirmation over relay', async () => {
    const FakeWebSocket = createFakeRelayWebSocket();
    const bridge = createMobileRelayBridge({
      identity,
      desktopName: 'Test Desktop',
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt',
      now: () => Date.parse('2026-06-28T00:00:10.000Z'),
      WebSocketImpl: FakeWebSocket,
    });

    bridge.start();
    await nextTick();
    const socket = FakeWebSocket.instances[0];
    socket.emitMessage({ type: 'relay:event', payload: signedRequest('req-approval', 'approval.respond', { id: 'a1', decision: 'approve' }) });
    await nextTick();

    const sent = socket.sent.at(-1);
    expect(sent?.payload.status).toBe(403);
    expect(sent?.payload.body.error).toBe('desktop_confirmation_required');

    bridge.stop();
  });

  it('tracks replay ids with ttl', () => {
    const guard = createMobileRelayReplayGuard(1000);

    expect(guard.accept('req-1', 1000)).toBe(true);
    expect(guard.accept('req-1', 1200)).toBe(false);
    expect(guard.accept('req-1', 2201)).toBe(true);
  });
});

function signedRequest(
  requestId: string,
  route: MobileRelayRequest['route'],
  body: Record<string, unknown>,
): MobileRelayRequest {
  return signMobileRelayRequest({
    kind: 'mobile.request',
    requestId,
    desktopId: identity.desktopId,
    mobileNodeId: 'mob1',
    sentAt: '2026-06-28T00:00:00.000Z',
    route,
    body,
  }, identity.mobileAccessToken);
}

function createFakeRelayWebSocket() {
  return class FakeRelayWebSocket {
    static instances: FakeRelayWebSocket[] = [];
    static OPEN = 1;
    url: string;
    options: unknown;
    readyState = 1;
    sent: Array<{ type: string; payload?: any }> = [];
    handlers = new Map<string, Array<(...args: any[]) => void>>();

    constructor(url: string, options: unknown) {
      this.url = url;
      this.options = options;
      FakeRelayWebSocket.instances.push(this);
      setTimeout(() => this.emit('open'), 0);
    }

    on(event: string, handler: (...args: any[]) => void) {
      const current = this.handlers.get(event) ?? [];
      current.push(handler);
      this.handlers.set(event, current);
      return this;
    }

    send(value: string) {
      this.sent.push(JSON.parse(value));
    }

    emitMessage(message: unknown) {
      this.emit('message', JSON.stringify(message));
    }

    close() {
      this.readyState = 3;
      this.emit('close');
    }

    private emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
  };
}

function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
