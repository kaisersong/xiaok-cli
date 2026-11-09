import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Hoisted before service imports: CI skips Electron's binary install script.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import {
  configureDefaultRemoteDebugging,
  DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS,
  DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT,
} from '../../electron/remote-debugging.js';

const repoRoot = join(__dirname, '..', '..', '..');

function fakeCommandLine(existingSwitches: string[] = []) {
  const appended: Array<{ name: string; value?: string }> = [];
  return {
    appended,
    commandLine: {
      hasSwitch(name: string) {
        return existingSwitches.includes(name);
      },
      appendSwitch(name: string, value?: string) {
        appended.push({ name, value });
      },
    },
  };
}

describe('desktop release remote debugging', () => {
  it('enables loopback-only remote debugging by default in development', () => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], { isPackaged: false, env: {} });

    expect(result).toEqual({
      enabled: true,
      port: DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT,
      address: DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS,
    });
    expect(fake.appended).toEqual([
      { name: 'remote-debugging-port', value: '9222' },
      { name: 'remote-debugging-address', value: '127.0.0.1' },
    ]);
  });

  it.each([undefined, '', '0', 'true', '01', '1 ', ' 1'])('disables packaged defaults for env=%j', (value) => {
    const fake = fakeCommandLine();
    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], {
      isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: value, XIAOK_REMOTE_DEBUGGING: '1' },
    });
    expect(result).toEqual({ enabled: false, reason: 'packaged_default_disabled' });
    expect(fake.appended).toEqual([]);
  });

  it('disables packaged defaults with omitted env and no hasSwitch implementation', () => {
    const fake = fakeCommandLine();
    const result = configureDefaultRemoteDebugging({ appendSwitch: fake.commandLine.appendSwitch }, [], { isPackaged: true });
    expect(result).toEqual({ enabled: false, reason: 'packaged_default_disabled' });
    expect(fake.appended).toEqual([]);
  });

  it('allows packaged defaults only with explicit env opt-in', () => {
    const fake = fakeCommandLine();
    expect(configureDefaultRemoteDebugging(fake.commandLine, [], {
      isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: '1' },
    })).toEqual({ enabled: true, port: '9222', address: '127.0.0.1' });
    expect(fake.appended).toEqual([
      { name: 'remote-debugging-port', value: '9222' },
      { name: 'remote-debugging-address', value: '127.0.0.1' },
    ]);
  });

  it('preserves an explicit remote debugging port', () => {
    const fake = fakeCommandLine(['remote-debugging-port']);

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], { isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: '1' } });

    expect(result).toEqual({ enabled: false, reason: 'explicit_remote_debugging_port' });
    expect(fake.appended).toEqual([]);
  });

  it.each([['--remote-debugging-port=9333'], ['--remote-debugging-port', '9333'], ['--remote-debugging-port=0']])('preserves explicit argv port %j', (...args) => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, [
      'xiaok',
      ...args,
    ], { isPackaged: true, env: {} });

    expect(result).toEqual({ enabled: false, reason: 'explicit_remote_debugging_port' });
    expect(fake.appended).toEqual([]);
  });

  it('configures remote debugging before the single-instance lock', () => {
    const main = readFileSync(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    const configureIndex = main.indexOf('configureDefaultRemoteDebugging(app.commandLine');
    const lockIndex = main.indexOf('app.requestSingleInstanceLock()');

    expect(configureIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(configureIndex).toBeLessThan(lockIndex);
    expect(main.slice(configureIndex, lockIndex)).toMatch(/process\.argv,\s*\{\s*isPackaged: app\.isPackaged,\s*env: process\.env/);
    const helper = readFileSync(join(repoRoot, 'desktop/electron/remote-debugging.ts'), 'utf8');
    expect(helper).toMatch(/if\s*\(options\.isPackaged\s*&&/);
  });
});


describe('packaged upgrade smoke contract', () => {
  it('opts old app into CDP and checks the OS relaunched app without CDP', () => {
    const script = readFileSync(join(repoRoot, 'scripts/qa/macos-real-upgrade.mjs'), 'utf8');
    expect(script).toContain("spawn(appExecutable, ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1']");
    expect(script).toContain("'packaged_default_cdp_must_not_listen'");
    expect(script).toContain("'-sTCP:LISTEN'");
    expect(script).toContain('CGWindowListCopyWindowInfo');
    expect(script).toContain('kCGWindowOwnerPID');
    expect(script).not.toContain('const newCDP');
    expect(script).toContain("signature(app, NEW.tag.slice(9), 'actually-upgraded')");
    expect(script).toContain("assert.deepEqual(actualTree, newTree");
  });
});

// Kept in this explicitly selected cross-platform CI file (#168).
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { configuredDesktopServicePorts, prepareDesktopServicePorts, readDesktopServicePorts, desktopServiceUrl } from '../../electron/desktop-service-discovery.js';
import { createCollaborationRoomBrokerClient } from '../../electron/collaboration-room-broker-client.js';

describe('Desktop service port discovery (#168)', () => {
  it.each(['desktop', 'broker-alias', 'desktop-precedence'] as const)(
    'honors configured service ports from environment (%s)', async (source) => {
      const names = ['XIAOK_DESKTOP_PORT', 'INTENT_BROKER_PORT', 'KSWARM_PORT'] as const;
      const original = names.map(name => process.env[name]);
      const probes = [createServer(), createServer()];
      try {
        for (const server of probes) {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
          });
        }
        const [a, b] = probes.map(server => (server.address() as { port: number }).port);
        for (const name of names) delete process.env[name];
        process.env.KSWARM_PORT = String(b);
        if (source === 'broker-alias') process.env.INTENT_BROKER_PORT = String(a);
        else {
          process.env.XIAOK_DESKTOP_PORT = String(a);
          if (source === 'desktop-precedence') process.env.INTENT_BROKER_PORT = String(b);
        }
        expect(configuredDesktopServicePorts()).toEqual({ broker: a, kswarm: b });
      } finally {
        names.forEach((name, i) => {
          if (original[i] === undefined) delete process.env[name];
          else process.env[name] = original[i];
        });
        await Promise.all(probes.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
      }
    },
  );

  it('keeps free default ports and publishes them', async (context) => {
    const probes = [createServer(), createServer()];
    try {
      for (const [i, server] of probes.entries()) await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen([4318, 4400][i], '127.0.0.1', resolve); });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      context.skip();
    } finally { await Promise.all(probes.map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ports-'));
    try {
      const file = join(root, 'services.json');
      const ports = await prepareDesktopServicePorts(file, {});
      expect(ports).toMatchObject({ broker: 4318, kswarm: 4400 });
      expect(readDesktopServicePorts(file)).toEqual(ports);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('moves occupied defaults and the real broker client reads the published port', async (context) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ports-'));
    const servers = [createServer(), createServer()];
    try {
      try {
        for (const [i, server] of servers.entries()) await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen([4318, 4400][i], '127.0.0.1', resolve); });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        context.skip();
      }
      const occupied = servers.map(server => (server.address() as { port: number }).port);
      const file = join(root, 'services.json');
      const ports = await prepareDesktopServicePorts(file, {});
      expect(occupied).not.toContain(ports.broker);
      expect(occupied).not.toContain(ports.kswarm);
      expect(ports.broker).not.toBe(ports.kswarm);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(ports);
      const fetchImpl = vi.fn(async () => new Response('{}'));
      await createCollaborationRoomBrokerClient({ token: 'fixture', discoveryFile: file, fetchImpl }).listRooms();
      expect((fetchImpl.mock.calls as unknown[][])[0]?.[0]).toBe(`${desktopServiceUrl('broker', file)}/rooms`);
    } finally {
      await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('reports discovery write failure and releases its port probes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ports-'));
    try {
      const blocker = join(root, 'blocker'); writeFileSync(blocker, 'file');
      await expect(prepareDesktopServicePorts(join(blocker, 'services.json'), {})).rejects.toThrow('Desktop service port setup failed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects invalid configuration and unreadable discovery instead of connecting elsewhere', async () => {
    await expect(prepareDesktopServicePorts(join(tmpdir(), 'unused-ports.json'), { KSWARM_PORT: 'invalid' })).rejects.toThrow('KSWARM_PORT');
    expect(() => readDesktopServicePorts(join(tmpdir(), 'missing-xiaok-discovery.json'))).toThrow();
  });
});

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { activeOwnerServicePorts } from '../../electron/active-owner-service-ports.js';
import { activityOwnerAddress, createActivityOwnerCredentials, ACTIVITY_OWNER_GENERATION, ACTIVITY_OWNER_PROTOCOL } from '../../../src/runtime/conversation-activity/owner-protocol.js';
import { activityOwnerConfigDigest, type ActivityOwnerConfig } from '../../../src/runtime/conversation-activity/owner-runtime.js';
import { ACTIVITY_STORAGE_NAMES } from '../../../src/runtime/conversation-activity/storage-permissions.js';

it('reuses only authenticated owner endpoints with a matching persisted digest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-port-owner-'));
  const address = activityOwnerAddress(root);
  const credentials = createActivityOwnerCredentials(address);
  const config: ActivityOwnerConfig = {
    schemaVersion: 1, dataRoot: address.dataRoot, profileId: createHash('sha256').update(resolve(root)).digest('hex'), actorId: 'fixture',
    identity: { kind: 'desktop', path: join(root, 'groups.sqlite') },
    kswarm: { url: 'http://127.0.0.1:45001', brokerUrl: 'http://127.0.0.1:45002', mutationToken: 'fixture', roomToken: 'fixture' },
    managedSources: [
      { name: 'kswarm', executable: process.execPath, entryPath: join(root, 'ks.js'), healthUrl: 'http://127.0.0.1:45001/health' },
      { name: 'broker', executable: process.execPath, entryPath: join(root, 'broker.js'), healthUrl: 'http://127.0.0.1:45002/health' },
    ],
  };
  writeFileSync(join(root, ACTIVITY_STORAGE_NAMES.config), JSON.stringify(config));
  let mismatch = false;
  const server = createServer(socket => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message.type === 'hello') {
          if (message.token !== credentials.producer) { socket.destroy(); return; }
          socket.write(JSON.stringify({ type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: address.rootHash, ownerEpoch: 'fixture' }) + '\n');
        } else socket.write(JSON.stringify({ type: 'result', id: message.id, result: { profileId: config.profileId, generation: ACTIVITY_OWNER_GENERATION,
          configDigest: mismatch ? 'invalid' : activityOwnerConfigDigest(config) } }) + '\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(address.socketPath, resolve); });
    expect(await activeOwnerServicePorts(root)).toEqual({ kswarm: 45001, broker: 45002 });
    mismatch = true;
    await expect(activeOwnerServicePorts(root)).rejects.toThrow('activity_owner_discovery_mismatch');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

import { startDesktopKSwarmService } from '../../electron/kswarm-service-lifetime.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { createDesktopServiceReadiness } from '../../electron/desktop-service-readiness.js';
import { KSwarmStreamBridge, startKSwarmStreamWhenReady } from '../../electron/kswarm-stream-bridge.js';

it('refuses duplicate services when another owner appears after endpoint preparation', async () => {
  const start = vi.fn(), release = vi.fn();
  const service = { activityOwnerConfig: async () => ({}), start, releaseActivityOwnerDelegation: release };
  await expect(startDesktopKSwarmService(new DesktopShutdownGate(), service as never,
    async () => { throw new Error('activity_owner_config_mismatch'); }, vi.fn())).rejects.toThrow('activity_owner_config_mismatch');
  expect(start).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
});

it('blocks consumers after bootstrap failure and starts streaming only on recovery', async () => {
  let current = { running: false, lastError: 'startup failed' as string | null };
  const ready = createDesktopServiceReadiness(async () => {}, () => current);
  const consumer = vi.fn();
  await expect(ready().then(consumer)).rejects.toThrow('startup failed');
  expect(consumer).not.toHaveBeenCalled();
  let report!: (status: typeof current) => void;
  const sockets: string[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    constructor(url: string) { sockets.push(url); }
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  let actualUrl = 'ws://127.0.0.1:4400/ws';
  const bridge = new KSwarmStreamBridge(() => actualUrl);
  const stop = startKSwarmStreamWhenReady({ getStatus: () => current, onStatusChange: cb => { report = cb; return () => {}; } }, bridge);
  try {
    expect(sockets).toEqual([]);
    actualUrl = 'ws://127.0.0.1:45003/ws';
    current = { running: true, lastError: null }; report(current); report(current);
    await ready().then(consumer);
    expect(consumer).toHaveBeenCalledTimes(1);
    expect(sockets).toEqual([actualUrl]);
  } finally { stop(); bridge.dispose(); vi.unstubAllGlobals(); }
});

import './runtime-bridge-readiness.cases.js';

// Keep the existing explicitly selected CI entry and all its port cases.
import './desktop-child-service-ports.cases.js';
