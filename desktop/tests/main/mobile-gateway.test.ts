import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMobilePairingPayload,
  buildMobileGatewayReachableUrls,
  createMobileBonjourAdvertiser,
  createMobileGateway,
  loadOrCreateMobileIdentity,
  type MobileGateway,
} from '../../electron/mobile-gateway.js';

const openGateways: MobileGateway[] = [];

afterEach(async () => {
  await Promise.all(openGateways.splice(0).map((gateway) => gateway.stop()));
});

describe('mobile gateway', () => {
  it('serves a bounded mobile snapshot on the v0 mobile route', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
      getSnapshot: () => ({
        desktopName: 'Test Desktop',
        health: 'online',
        lastSyncSequence: 1,
        runningTurn: null,
        messages: [],
        projects: [],
        approvals: [],
        loops: [],
        artifacts: [],
      }),
    });
    openGateways.push(gateway);

    await gateway.start();
    const response = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/snapshot`, {
      headers: { authorization: 'Bearer token-test' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      desktopName: 'Test Desktop',
      health: 'online',
      messages: [],
    });
  });

  it('serves public hello metadata without exposing a secret', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
      getHello: () => ({
        desktopId: 'desktop-test',
        desktopName: 'Test Desktop',
        protocol: 'mobile-v1',
        health: 'online',
        reachableURLs: ['http://192.168.1.23:47891'],
      }),
    });
    openGateways.push(gateway);

    await gateway.start();
    const response = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/hello`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      desktopId: 'desktop-test',
      desktopName: 'Test Desktop',
      protocol: 'mobile-v1',
      health: 'online',
      reachableURLs: ['http://192.168.1.23:47891'],
    });
  });

  it('fails closed for snapshot and action routes without a matching mobile token', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
    });
    openGateways.push(gateway);

    await gateway.start();
    const baseURL = gateway.getStatus().baseURL;

    expect((await fetch(`${baseURL}/v0/mobile/snapshot`)).status).toBe(401);
    expect((await fetch(`${baseURL}/v0/mobile/snapshot`, {
      headers: { authorization: 'Bearer wrong-token' },
    })).status).toBe(401);
    expect((await fetch(`${baseURL}/v0/mobile/actions/chat.send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ping' }),
    })).status).toBe(401);
    expect((await fetch(`${baseURL}/v0/mobile/actions/approval.respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'approval-1', decision: 'approve' }),
    })).status).toBe(401);
    expect((await fetch(`${baseURL}/v0/mobile/artifacts/artifact-1/preview`)).status).toBe(401);
  });

  it('fails closed for snapshot and action routes when no mobile token is configured', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
    });
    openGateways.push(gateway);

    await gateway.start();
    const baseURL = gateway.getStatus().baseURL;

    expect((await fetch(`${baseURL}/v0/mobile/snapshot`)).status).toBe(401);
    expect((await fetch(`${baseURL}/v0/mobile/actions/chat.send`, {
      method: 'POST',
      headers: { authorization: 'Bearer anything', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ping' }),
    })).status).toBe(401);
  });

  it('uses a closed router instead of proxying unknown paths', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
      getSnapshot: () => ({
        desktopName: 'Test Desktop',
        health: 'online',
        lastSyncSequence: 1,
        runningTurn: null,
        messages: [],
        projects: [],
        approvals: [],
        loops: [],
        artifacts: [],
      }),
    });
    openGateways.push(gateway);

    await gateway.start();
    const response = await fetch(`${gateway.getStatus().baseURL}/proxy?url=http://127.0.0.1:4400/health`);

    expect(response.status).toBe(404);
  });

  it('reports incoming mobile requests for desktop-side connection evidence', async () => {
    const requests: Array<{ method: string; pathname: string; remoteAddress: string | undefined }> = [];
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
      onRequest: (event) => {
        requests.push({
          method: event.method,
          pathname: event.pathname,
          remoteAddress: event.remoteAddress,
        });
      },
    });
    openGateways.push(gateway);

    await gateway.start();
    const response = await fetch(`${gateway.getStatus().baseURL}/v0/mobile/snapshot`, {
      headers: { authorization: 'Bearer token-test' },
    });

    expect(response.status).toBe(200);
    expect(requests).toContainEqual({
      method: 'GET',
      pathname: '/v0/mobile/snapshot',
      remoteAddress: '127.0.0.1',
    });
  });

  it('serves authorized artifact previews by artifact id', async () => {
    const gateway = createMobileGateway({
      host: '127.0.0.1',
      port: 0,
      desktopName: 'Test Desktop',
      mobileAccessToken: 'token-test',
      getArtifactPreview: async (artifactId: string) => {
        if (artifactId !== 'artifact-report') return null;
        return {
          artifact: {
            id: 'artifact-report',
            name: 'report.md',
            kind: 'markdown',
            source: 'task-rich',
            status: 'ready',
            previewAvailable: true,
            mimeType: 'text/markdown',
            sizeBytes: 32,
          },
          contentType: 'text/markdown',
          text: '# Report\n\nReady',
        };
      },
    } as any);
    openGateways.push(gateway);

    await gateway.start();
    const baseURL = gateway.getStatus().baseURL;

    expect((await fetch(`${baseURL}/v0/mobile/artifacts/artifact-report/preview`)).status).toBe(401);

    const response = await fetch(`${baseURL}/v0/mobile/artifacts/artifact-report/preview`, {
      headers: { authorization: 'Bearer token-test' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      artifact: {
        id: 'artifact-report',
        name: 'report.md',
        kind: 'markdown',
        source: 'task-rich',
        status: 'ready',
        previewAvailable: true,
        mimeType: 'text/markdown',
        sizeBytes: 32,
      },
      contentType: 'text/markdown',
      text: '# Report\n\nReady',
    });
    expect((await fetch(`${baseURL}/v0/mobile/artifacts/missing/preview`, {
      headers: { authorization: 'Bearer token-test' },
    })).status).toBe(404);
  });

  it('advertises LAN URLs for phones and excludes loopback addresses', () => {
    const urls = buildMobileGatewayReachableUrls({
      port: 47891,
      interfaces: {
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
        utun: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
      },
    });

    expect(urls).toEqual(['http://192.168.1.23:47891']);
  });

  it('advertises Bonjour on macOS without leaking the desktop id', () => {
    const started: string[][] = [];
    const killed: string[] = [];
    const advertiser = createMobileBonjourAdvertiser({
      platform: 'darwin',
      spawnProcess: (command, args) => {
        started.push([command, ...args]);
        return {
          kill: () => {
            killed.push(command);
            return true;
          },
        };
      },
    });

    advertiser.start({
      name: 'Xiaok Desktop',
      port: 47891,
      txt: { protocol: 'mobile-v1' },
    });
    advertiser.stop();

    expect(started).toHaveLength(1);
    expect(started[0]).toContain('/usr/bin/dns-sd');
    expect(started[0]).toContain('_xiaok-desktop._tcp');
    expect(started[0]).toContain('47891');
    expect(started[0].join(' ')).toContain('protocol=mobile-v1');
    expect(started[0].join(' ')).not.toContain('desktop-test');
    expect(killed).toEqual(['/usr/bin/dns-sd']);
  });

  it('does not spawn Bonjour advertiser outside macOS', () => {
    const started: string[][] = [];
    const advertiser = createMobileBonjourAdvertiser({
      platform: 'win32',
      spawnProcess: (command, args) => {
        started.push([command, ...args]);
        return { kill: () => true };
      },
    });

    advertiser.start({
      name: 'Xiaok Desktop',
      port: 47891,
      txt: { protocol: 'mobile-v1' },
    });

    expect(started).toEqual([]);
    expect(advertiser.getStatus()).toEqual({ running: false, supported: false });
  });

  it('creates and migrates the mobile relay room secret without rotating the mobile token', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'xiaok-mobile-identity-'));
    try {
      const identity = loadOrCreateMobileIdentity(dataRoot);
      expect(identity.mobileRelayRoomSecret).toMatch(/^[a-f0-9]{64}$/);

      const identityPath = join(dataRoot, 'mobile-identity.json');
      const legacy = {
        desktopId: identity.desktopId,
        mobileAccessToken: identity.mobileAccessToken,
        createdAt: identity.createdAt,
      };
      rmSync(identityPath);
      writeFileSync(identityPath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });

      const migrated = loadOrCreateMobileIdentity(dataRoot);
      expect(migrated.desktopId).toBe(identity.desktopId);
      expect(migrated.mobileAccessToken).toBe(identity.mobileAccessToken);
      expect(migrated.mobileRelayRoomSecret).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(readFileSync(identityPath, 'utf8')).mobileRelayRoomSecret).toBe(migrated.mobileRelayRoomSecret);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('builds a mobile QR pairing payload with LAN first and relay fallback credentials', () => {
    const pairing = buildMobilePairingPayload({
      desktopName: 'Test Desktop',
      identity: {
        desktopId: 'desktop-test',
        mobileAccessToken: 'token-test',
        mobileRelayRoomSecret: 'room-secret-test',
        createdAt: '2026-06-28T00:00:00.000Z',
      },
      gatewayStatus: {
        running: true,
        host: '0.0.0.0',
        port: 47891,
        baseURL: 'http://127.0.0.1:47891',
        reachableURLs: ['http://10.0.0.17:47891', 'http://192.168.1.23:47891'],
      },
      relayUrl: 'wss://relay.example/ws',
      relayJwt: 'relay-jwt-test',
    });

    expect(pairing.desktopId).toBe('desktop-test');
    expect(pairing.gatewayURL).toBe('http://10.0.0.17:47891');
    expect(pairing.reachableURLs).toEqual(['http://10.0.0.17:47891', 'http://192.168.1.23:47891']);
    expect(pairing.relayUrl).toBe('wss://relay.example/ws');
    expect(pairing.relayJwt).toBe('relay-jwt-test');
    expect(pairing.relayRoomSecret).toBe('room-secret-test');
    expect(pairing.deepLink).toContain('xiaok://mobile/pair?');
    expect(pairing.deepLink).toContain('gateway=http%3A%2F%2F10.0.0.17%3A47891');
    expect(pairing.deepLink).toContain('desktopId=desktop-test');
    expect(pairing.deepLink).toContain('token=token-test');
    expect(pairing.deepLink).toContain('relayUrl=wss%3A%2F%2Frelay.example%2Fws');
    expect(pairing.deepLink).toContain('relayJWT=relay-jwt-test');
    expect(pairing.deepLink).toContain('relayRoomSecret=room-secret-test');
    expect(pairing.deepLink).not.toContain('127.0.0.1');
  });
});
