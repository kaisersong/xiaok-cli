// @vitest-environment node
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { createMobileGateway, type MobileSnapshot } from '../../electron/mobile-gateway.js';
import { createMobileRelayBridge, signMobileRelayRequest, verifyMobileRelayResponse, type MobileRelayRequest } from '../../electron/mobile-relay.js';
import { contextDerivative } from '../fixtures/context-derivative.js';

it('checks actual current Task policy after the last HTTP snapshot await and before writing private response bytes', async () => {
  const f = await contextDerivative(); let withdraw = false;
  const config = { host: '127.0.0.1', port: 0, desktopName: 'fixture', mobileAccessToken: 'fixture-mobile-token',
    requireDisclosurePolicy: true, assertOutputCurrent: () => f.assertCurrent(),
    getSnapshot: async (): Promise<MobileSnapshot> => {
      const { snapshot } = await f.read();
      const result: MobileSnapshot = { desktopName: 'fixture', health: 'online', lastSyncSequence: 1, runningTurn: null,
        messages: [{ id: 'derived', conversationId: f.taskId, role: 'assistant', text: snapshot.result!.summary, createdAt: new Date(0).toISOString() }],
        conversations: [], projects: [], approvals: [], loops: [], artifacts: [] };
      if (withdraw) queueMicrotask(() => f.revoke());
      return result;
    },
  };
  const gateway = createMobileGateway(config);
  try {
    await gateway.start(); const url = `${gateway.getStatus().baseURL}/v0/mobile/snapshot`, headers = { authorization: 'Bearer fixture-mobile-token' };
    const before = await fetch(url, { headers }); expect(before.status).toBe(200); expect(await before.text()).toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    withdraw = true; const after = await fetch(url, { headers }), wire = await after.text();
    expect(after.status).toBe(403); expect(wire).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    await expect(f.read()).rejects.toThrow('not_readable');
  } finally { await gateway.stop(); await f.close(); }
});

it('refuses a protected mobile gateway without its main disclosure policy before opening a socket', () => {
  const config = { host: '127.0.0.1', port: 0, desktopName: 'fixture', requireDisclosurePolicy: true };
  expect(() => createMobileGateway(config)).toThrow('mobile_disclosure_policy_unavailable');
});

const identity = { desktopId: 'continuity-test', mobileAccessToken: 'fixture-token', mobileRelayRoomSecret: 'fixture-room', createdAt: new Date(0).toISOString() };
function snapshot(text: string): MobileSnapshot {
  return { desktopName: 'fixture', health: 'online', lastSyncSequence: 1, runningTurn: null,
    messages: [{ id: 'derived', role: 'assistant', text, createdAt: new Date(0).toISOString() }],
    conversations: [], projects: [], approvals: [], loops: [], artifacts: [] };
}
async function relayServer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('test_address_missing');
  return { server, url: `ws://127.0.0.1:${address.port}`, async close() {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
function sendRequest(ws: WebSocket, route: MobileRelayRequest['route'], id: string) {
  ws.send(JSON.stringify({ type: 'relay:event', payload: signMobileRelayRequest({ kind: 'mobile.request',
    requestId: id, desktopId: identity.desktopId, mobileNodeId: 'fixture-mobile', sentAt: new Date().toISOString(), route,
    body: { id: 'artifact-or-approval', text: 'continue', decision: 'approve' } }, identity.mobileAccessToken) }));
}
async function response(ws: WebSocket) {
  const [bytes] = await once(ws, 'message'); const wire = bytes.toString();
  const envelope = JSON.parse(wire), checked = verifyMobileRelayResponse(envelope.payload, identity.mobileAccessToken);
  expect(checked.ok).toBe(true); return { wire, payload: envelope.payload };
}

it.each(['snapshot', 'artifact.preview', 'chat.send', 'approval.respond'] as const)(
  'rechecks policy after response signing before actual WS send for %s', async route => {
    const f = await contextDerivative(), server = await relayServer(); let withdraw = false, resultReady = false;
    const read = async () => { const recovered = await f.read(); resultReady = true; return recovered.snapshot.result!.summary; };
    const bridge = createMobileRelayBridge({ identity, desktopName: 'fixture', relayUrl: server.url, relayJwt: 'test',
      requireDisclosurePolicy: true, assertOutputCurrent: () => f.assertCurrent(),
      now: () => { if (withdraw && resultReady) { withdraw = false; queueMicrotask(() => f.revoke()); } return Date.now(); },
      getSnapshot: async () => snapshot(await read()), getArtifactPreview: async () => ({ artifact: {}, contentType: 'text/plain', text: await read() }),
      sendMessage: async () => [{ type: 'chat.message_appended', sequence: 1,
        message: { id: 'derived', role: 'assistant', text: await read(), createdAt: new Date(0).toISOString() } }],
      respondToApproval: async () => ({ title: await read() }),
    });
    try {
      const connected = once(server.server, 'connection'); bridge.start(); const [ws] = await connected;
      const first = response(ws); sendRequest(ws, route, 'before');
      expect((await first).wire).toContain('DERIVED_PRIVATE_SOURCE_CANARY');
      resultReady = false; withdraw = true;
      const second = response(ws); sendRequest(ws, route, 'after'); const after = await second;
      expect(after.payload.status).toBe(403); expect(after.wire).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
      await expect(f.read()).rejects.toThrow('not_readable');
    } finally { bridge.stop(); await server.close(); await f.close(); }
  });

it('does not send a completed old-generation request on the replacement real WS connection', async () => {
  const f = await contextDerivative(), server = await relayServer(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  const bridge = createMobileRelayBridge({ identity, desktopName: 'fixture', relayUrl: server.url, relayJwt: 'test',
    requireDisclosurePolicy: true, assertOutputCurrent: () => f.assertCurrent(),
    getSnapshot: async () => { const value = snapshot((await f.read()).snapshot.result!.summary); started(); await held; return value; },
  });
  try {
    const first = once(server.server, 'connection'); bridge.start(); const [old] = await first;
    sendRequest(old, 'snapshot', 'old-request'); await requested;
    bridge.stop(); const next = once(server.server, 'connection'); bridge.start(); const [current] = await next;
    const bytes: string[] = []; current.on('message', data => bytes.push(data.toString()));
    const hello = response(current); sendRequest(current, 'hello', 'new-hello'); expect((await hello).payload.status).toBe(200);
    release(); await new Promise(resolve => setTimeout(resolve, 50));
    expect(bytes.join('')).not.toContain('old-request'); expect(bytes.join('')).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    expect(bridge.getStatus().connected).toBe(true);
  } finally { release(); bridge.stop(); await server.close(); await f.close(); }
});

it('refuses a protected relay without policy before connecting', () => {
  expect(() => createMobileRelayBridge({ identity, desktopName: 'fixture', relayUrl: 'ws://127.0.0.1:1', relayJwt: 'test',
    requireDisclosurePolicy: true })).toThrow('mobile_disclosure_policy_unavailable');
});

it.each(['toJSON', 'getter', 'proxy'] as const)('rejects %s output before user code can substitute wire content', async kind => {
  const f = await contextDerivative(); let invoked = 0;
  const gateway = createMobileGateway({ host: '127.0.0.1', port: 0, desktopName: 'fixture', mobileAccessToken: 'token',
    requireDisclosurePolicy: true, assertOutputCurrent: () => f.assertCurrent(), getSnapshot: async () => {
      const value = snapshot((await f.read()).snapshot.result!.summary);
      if (kind === 'toJSON') Object.defineProperty(value, 'toJSON', { value: () => { invoked++; return { leak: 'SUBSTITUTED_CANARY' }; } });
      else if (kind === 'getter') Object.defineProperty(value, 'projects', { enumerable: true, get: () => { invoked++; return ['SUBSTITUTED_CANARY']; } });
      else return new Proxy(value, { getPrototypeOf: target => { invoked++; return Object.getPrototypeOf(target); } });
      return value;
    },
  });
  try {
    await gateway.start(); const result = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/snapshot`, { headers: { authorization: 'Bearer token' } });
    expect(result.status).toBe(403); expect(await result.text()).not.toContain('SUBSTITUTED_CANARY'); expect(invoked).toBe(0);
  } finally { await gateway.stop(); await f.close(); }
});

it('refuses a relay value modified after signing instead of checking a different value from the fixed wire', async () => {
  const f = await contextDerivative(), server = await relayServer(); let value: MobileSnapshot | undefined;
  const bridge = createMobileRelayBridge({ identity, desktopName: 'fixture', relayUrl: server.url, relayJwt: 'test',
    requireDisclosurePolicy: true, assertOutputCurrent: () => f.assertCurrent(),
    now: () => { if (value) value.messages[0].text = 'DIFFERENT_VALUE_AFTER_SIGNING'; return Date.now(); },
    getSnapshot: async () => { value = snapshot((await f.read()).snapshot.result!.summary); return value; },
  });
  try {
    const connected = once(server.server, 'connection'); bridge.start(); const [ws] = await connected;
    const result = response(ws); sendRequest(ws, 'snapshot', 'mutated'); const after = await result;
    expect(after.payload.status).toBe(403); expect(after.wire).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    expect(after.wire).not.toContain('DIFFERENT_VALUE_AFTER_SIGNING'); f.assertCurrent();
  } finally { bridge.stop(); await server.close(); await f.close(); }
});

it.each(['http', 'ws'] as const)('rejects an asynchronous policy in %s without sending private bytes', async transport => {
  const f = await contextDerivative(); const policy = async () => { f.assertCurrent(); };
  if (transport === 'http') {
    const gateway = createMobileGateway({ host: '127.0.0.1', port: 0, desktopName: 'fixture', mobileAccessToken: 'token',
      requireDisclosurePolicy: true, assertOutputCurrent: policy, getSnapshot: async () => snapshot((await f.read()).snapshot.result!.summary) });
    try {
      await gateway.start(); const result = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/snapshot`, { headers: { authorization: 'Bearer token' } });
      expect(result.status).toBe(403); expect(await result.text()).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    } finally { await gateway.stop(); await f.close(); }
  } else {
    const server = await relayServer(), bridge = createMobileRelayBridge({ identity, desktopName: 'fixture', relayUrl: server.url, relayJwt: 'test',
      requireDisclosurePolicy: true, assertOutputCurrent: policy, getSnapshot: async () => snapshot((await f.read()).snapshot.result!.summary) });
    try {
      const connected = once(server.server, 'connection'); bridge.start(); const [ws] = await connected;
      const result = response(ws); sendRequest(ws, 'snapshot', 'async-policy'); const after = await result;
      expect(after.payload.status).toBe(403); expect(after.wire).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    } finally { bridge.stop(); await server.close(); await f.close(); }
  }
});

it('does not authorize HTTP bytes using a policy-mutated DTO', async () => {
  const f = await contextDerivative();
  const gateway = createMobileGateway({ host: '127.0.0.1', port: 0, desktopName: 'fixture', mobileAccessToken: 'token',
    requireDisclosurePolicy: true, assertOutputCurrent: (_route, value) => {
      f.assertCurrent(); (value as MobileSnapshot).messages[0].text = 'POLICY_MUTATED_VALUE';
    }, getSnapshot: async () => snapshot((await f.read()).snapshot.result!.summary),
  });
  try {
    await gateway.start(); const result = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/snapshot`, { headers: { authorization: 'Bearer token' } });
    expect(result.status).toBe(403); expect(await result.text()).not.toContain('DERIVED_PRIVATE_SOURCE_CANARY');
  } finally { await gateway.stop(); await f.close(); }
});
