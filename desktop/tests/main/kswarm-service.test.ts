import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendKSwarmServiceLogLine,
  buildKSwarmHealthDiagnosticInput,
  buildBackgroundNodeSpawnOptions,
  buildIntentBrokerServiceEnv,
  checkKSwarmHealthServiceIdentity,
  classifyKSwarmExit,
  createKSwarmService,
  KSWARM_EXIT_LOAD_UNRECOVERABLE,
  KSWARM_EXIT_SAVE_FAILED,
  loadOrCreateRoomSecrets,
  shouldStopAfterPersistenceFailStops,
  transitionKSwarmTerminalDegraded,
  doesKSwarmHealthMatchExpectedService,
  findPidOnPort,
  hasDynamicWorkflowSupport,
  hasWorkflowPatternCapabilities,
  killStaleServiceOnPort,
  KSwarmUnavailableError,
  nextHealthFailureCount,
  requestWithFallbackBaseUrls,
  resolveBackgroundNodeRuntime,
  resolveKSwarmServiceLogRoot,
  resolveIntentBrokerRuntimeRoot,
  shouldAdoptExistingKSwarmService,
  shouldRestartAfterHealthFailures,
  uniqueServiceUrls,
} from '../../electron/kswarm-service.js';

const spawnMock = vi.hoisted(() => vi.fn());

class FakeKSwarmChild extends EventEmitter {
  pid: number;
  alive = true;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill: ReturnType<typeof vi.fn>;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.kill = vi.fn((signal?: NodeJS.Signals) => {
      queueMicrotask(() => {
        this.alive = false;
        this.emit('exit', 0, signal ?? null);
      });
      return true;
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
});

// We can't actually spawn kswarm in unit tests, so request() behavior is tested
// with a mock that mirrors the service gateway contract.
interface MockKSwarmService {
  running: boolean;
  startCalls: number;
  start(): Promise<void>;
  getStatus(): { running: boolean };
  request(path: string, init?: RequestInit): Promise<Response>;
}

function createMockKSwarmService(handlers: {
  onStart?: () => Promise<void>;
  onFetch?: (path: string, init?: RequestInit) => Response | Promise<Response>;
  shouldRunAfterStart?: boolean;
}): MockKSwarmService {
  let running = false;
  let startCalls = 0;
  let startingPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (running) return;
    await start();
  }

  async function start(): Promise<void> {
    if (running) return;
    if (startingPromise) {
      await startingPromise;
      return;
    }
    startingPromise = (async () => {
      if (running) return;
      startCalls++;
      if (handlers.onStart) await handlers.onStart();
      running = handlers.shouldRunAfterStart ?? true;
    })().finally(() => {
      startingPromise = null;
    });
    await startingPromise;
  }

  async function request(path: string, init?: RequestInit): Promise<Response> {
    await ensureReady();
    if (!running) {
      throw new KSwarmUnavailableError('service failed to start');
    }
    if (handlers.onFetch) {
      return await handlers.onFetch(path, init);
    }
    return new Response('ok');
  }

  function getStatus() {
    return { running };
  }

  return {
    get running() { return running; },
    get startCalls() { return startCalls; },
    start,
    getStatus,
    request,
  };
}

describe('kswarm service spawn options', () => {
  it('hides Windows console windows for desktop-managed background services', () => {
    const options = buildBackgroundNodeSpawnOptions({
      platform: 'win32',
      cwd: 'D:\\projects\\intent-broker',
      env: { PORT: '4318' },
    });

    expect(options).toMatchObject({
      cwd: 'D:\\projects\\intent-broker',
      env: { PORT: '4318' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  });

  it('keeps the same stdio contract on non-Windows platforms without forcing windowsHide', () => {
    const options = buildBackgroundNodeSpawnOptions({
      platform: 'darwin',
      env: { PORT: '4400' },
    });

    expect(options).toMatchObject({
      env: { PORT: '4400' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(options.windowsHide).toBeUndefined();
  });

  it('uses the current Node executable instead of PATH lookup for background services', () => {
    const runtime = resolveBackgroundNodeRuntime({
      env: { PATH: '' },
      execPath: '/usr/local/bin/node',
    });

    expect(runtime.command).toBe('/usr/local/bin/node');
    expect(runtime.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('runs packaged Electron as Node for background services', () => {
    const runtime = resolveBackgroundNodeRuntime({
      env: { PATH: '' },
      execPath: '/Applications/xiaok.app/Contents/MacOS/xiaok',
      electronVersion: '39.0.0',
    });

    expect(runtime.command).toBe('/Applications/xiaok.app/Contents/MacOS/xiaok');
    expect(runtime.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('honors XIAOK_NODE_CMD for background services', () => {
    const runtime = resolveBackgroundNodeRuntime({
      env: { XIAOK_NODE_CMD: '/opt/homebrew/bin/node' },
      execPath: '/Applications/xiaok.app/Contents/MacOS/xiaok',
      electronVersion: '39.0.0',
    });

    expect(runtime.command).toBe('/opt/homebrew/bin/node');
    expect(runtime.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('keeps packaged intent-broker runtime state outside the signed app bundle', () => {
    const userData = '/Users/song/Library/Application Support/xiaok';
    const runtimeRoot = resolveIntentBrokerRuntimeRoot(userData);
    const repoRoot = '/Applications/xiaok.app/Contents/Resources/services/intent-broker';
    const env = buildIntentBrokerServiceEnv({
      baseEnv: {},
      cwd: runtimeRoot,
      port: 4318,
      repoRoot,
    });

    expect(runtimeRoot).toBe('/Users/song/Library/Application Support/xiaok/services/intent-broker');
    expect(env.PORT).toBe('4318');
    expect(env.INTENT_BROKER_REPO_ROOT).toBe(repoRoot);
    expect(env.INTENT_BROKER_CONFIG).toBe(`${repoRoot}/intent-broker.config.json`);
    expect(env.INTENT_BROKER_LOCAL_CONFIG).toBe(`${runtimeRoot}/intent-broker.local.json`);
    expect(env.INTENT_BROKER_DB).toBe(`${runtimeRoot}/.tmp/intent-broker.db`);
    expect(env.INTENT_BROKER_HEARTBEAT_PATH).toBe(`${runtimeRoot}/.tmp/broker.heartbeat.json`);
  });
});

describe('kswarm service external adoption', () => {
  it('allows same-entry services when source hash matches or is missing from remote', () => {
    const entryPath = '/tmp/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js';

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath, sourceHash: 'hash-new' },
    }, entryPath, 'hash-new')).toBe(true);

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath, sourceHash: 'hash-old' },
    }, entryPath, 'hash-new')).toBe(false);

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath },
    }, entryPath, 'hash-new')).toBe(true);
  });

  it('treats source hash mismatch as incompatible when the service entry path matches', () => {
    const entryPath = '/tmp/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js';
    const result = checkKSwarmHealthServiceIdentity({
      service: { entryPath, sourceHash: 'hash-old' },
    }, entryPath, 'hash-new');

    expect(result).toMatchObject({
      compatible: false,
      reason: 'source_hash_mismatch',
      warning: null,
      actualEntryPath: entryPath,
      expectedEntryPath: entryPath,
      actualSourceHash: 'hash-old',
      expectedSourceHash: 'hash-new',
    });
  });

  it('reports missing source hashes as warnings when the service entry path matches', () => {
    const entryPath = '/tmp/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js';
    const result = checkKSwarmHealthServiceIdentity({
      service: { entryPath },
    }, entryPath, 'hash-new');

    expect(result).toMatchObject({
      compatible: true,
      reason: null,
      warning: 'source_hash_missing',
      actualEntryPath: entryPath,
      expectedEntryPath: entryPath,
      actualSourceHash: null,
      expectedSourceHash: 'hash-new',
    });
  });

  it('keeps a different service entry path as an adoption blocker', () => {
    const expectedEntryPath = '/Applications/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js';
    const actualEntryPath = '/Users/song/projects/kswarm/src/server/index.js';
    const result = checkKSwarmHealthServiceIdentity({
      service: { entryPath: actualEntryPath, sourceHash: 'hash-new' },
    }, expectedEntryPath, 'hash-new');

    expect(result).toMatchObject({
      compatible: false,
      reason: 'entry_path_mismatch',
      warning: null,
      actualEntryPath,
      expectedEntryPath,
    });
    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath: actualEntryPath, sourceHash: 'hash-new' },
    }, expectedEntryPath, 'hash-new')).toBe(false);
  });

  it('adopts an already healthy service when desktop does not own a child process', () => {
    expect(shouldAdoptExistingKSwarmService({ hasOwnedChild: false, healthOk: true })).toBe(true);
  });

  it('does not fully adopt an external service as healthy when its broker is disconnected', () => {
    expect(shouldAdoptExistingKSwarmService({
      hasOwnedChild: false,
      healthOk: true,
      brokerReady: false,
    })).toBe(false);
  });

  it('does not adopt a service that lacks dynamic workflow support', () => {
    expect(shouldAdoptExistingKSwarmService({
      hasOwnedChild: false,
      healthOk: true,
      brokerReady: true,
      dynamicWorkflowReady: false,
    })).toBe(false);
  });

  it('requires workflow pattern schema capabilities before treating KSwarm as dynamic-workflow ready', () => {
    expect(hasDynamicWorkflowSupport({
      features: ['dynamic_workflows'],
      workflowCapabilities: {
        schemaVersion: 'kswarm_workflow_patterns_v1',
        compiledContract: true,
        patternPublicView: true,
      },
    })).toBe(true);

    expect(hasDynamicWorkflowSupport({
      features: ['dynamic_workflows'],
    })).toBe(false);

    expect(hasWorkflowPatternCapabilities({
      workflowCapabilities: {
        schemaVersion: 'kswarm_workflow_patterns_v0',
        compiledContract: true,
        patternPublicView: true,
      },
    })).toBe(false);
  });

  it('does not adopt a healthy dynamic-workflow service with a mismatched service identity', () => {
    expect(shouldAdoptExistingKSwarmService({
      hasOwnedChild: false,
      healthOk: true,
      brokerReady: true,
      dynamicWorkflowReady: true,
      serviceIdentityMatches: false,
    })).toBe(false);
  });

  it('does not treat a desktop-owned child as an external service', () => {
    expect(shouldAdoptExistingKSwarmService({ hasOwnedChild: true, healthOk: true })).toBe(false);
    expect(shouldAdoptExistingKSwarmService({ hasOwnedChild: false, healthOk: false })).toBe(false);
  });
});

describe('kswarm service diagnostics logs', () => {
  it('resolves service logs under desktop userData logs', () => {
    expect(resolveKSwarmServiceLogRoot('/Users/song/Library/Application Support/xiaok'))
      .toBe('/Users/song/Library/Application Support/xiaok/logs');
  });

  it('writes service log lines under the provided log root', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-logs-'));
    try {
      appendKSwarmServiceLogLine({
        logRoot: root,
        serviceName: 'server',
        stream: 'stderr',
        message: 'startup failed',
        now: () => new Date('2026-06-10T12:00:00.000Z'),
      });

      const log = readFileSync(join(root, 'server.log'), 'utf8');
      expect(log).toContain('2026-06-10T12:00:00.000Z');
      expect(log).toContain('[stderr] startup failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not create a log file for empty messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-logs-empty-'));
    try {
      appendKSwarmServiceLogLine({
        logRoot: root,
        serviceName: 'server',
        stream: 'stdout',
        message: '   ',
      });

      expect(() => readFileSync(join(root, 'server.log'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('kswarm service health diagnostic input', () => {
  it('marks a missing service entry as spawn_path_missing classifier input', () => {
    const input = buildKSwarmHealthDiagnosticInput({
      expectedEntryPath: null,
      expectedSourceHash: null,
      health: { ok: false, body: null, error: 'connect ECONNREFUSED' },
      broker: { ok: true, body: { ok: true }, error: null },
      status: {
        running: false,
        port: 4400,
        pid: null,
        restartCount: 0,
        lastError: 'kswarm server entry not found',
      },
    });

    expect(input).toMatchObject({
      expectedEntryPath: null,
      spawnEntryExists: false,
      port: { listening: false, pid: null },
      health: { ok: false, error: 'connect ECONNREFUSED' },
      broker: { ok: true },
    });
  });

  it('keeps parsed health and broker state for classifier decisions', () => {
    const input = buildKSwarmHealthDiagnosticInput({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      expectedSourceHash: 'expected',
      health: {
        ok: true,
        body: {
          service: { entryPath: '/tmp/kswarm/src/server/index.js', sourceHash: 'actual' },
          brokerConnected: false,
        },
        error: null,
      },
      broker: { ok: false, body: null, error: 'broker refused connection' },
      status: {
        running: true,
        port: 4400,
        pid: 42,
        restartCount: 2,
        lastError: null,
      },
    });

    expect(input).toMatchObject({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      expectedSourceHash: 'expected',
      spawnEntryExists: true,
      port: { listening: true, pid: 42, command: 'desktop-owned kswarm service' },
      health: {
        ok: true,
        body: {
          service: { entryPath: '/tmp/kswarm/src/server/index.js', sourceHash: 'actual' },
          brokerConnected: false,
        },
      },
      broker: { ok: false, error: 'broker refused connection' },
    });
  });

  it('does not infer port listening from the desktop service manager running flag', () => {
    const input = buildKSwarmHealthDiagnosticInput({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      expectedSourceHash: 'expected',
      health: {
        ok: false,
        body: null,
        error: 'health check timed out (1000ms): http://127.0.0.1:4400/health',
      },
      broker: { ok: true, body: { ok: true }, error: null },
      status: {
        running: true,
        port: 4400,
        pid: 42,
        restartCount: 0,
        lastError: null,
      },
    });

    expect(input).toMatchObject({
      spawnEntryExists: true,
      port: {
        listening: false,
        pid: 42,
        command: 'desktop-owned kswarm service',
      },
      health: {
        ok: false,
        error: 'health check timed out (1000ms): http://127.0.0.1:4400/health',
      },
    });
  });

  it('marks HTTP health responses as port listeners without relying on manager state', () => {
    const input = buildKSwarmHealthDiagnosticInput({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      expectedSourceHash: 'expected',
      health: {
        ok: false,
        status: 404,
        body: null,
        error: 'HTTP 404',
      },
      broker: { ok: true, body: { ok: true }, error: null },
      status: {
        running: false,
        port: 4400,
        pid: null,
        restartCount: 0,
        lastError: null,
      },
    });

    expect(input).toMatchObject({
      port: { listening: true },
      health: { ok: false, status: 404, error: 'HTTP 404' },
    });
  });
});

describe('kswarm service health monitor resilience', () => {
  it('does not restart on the first transient health failure', () => {
    const firstFailureCount = nextHealthFailureCount(0, false);

    expect(firstFailureCount).toBe(1);
    expect(shouldRestartAfterHealthFailures(firstFailureCount)).toBe(false);
  });

  it('restarts only after the configured consecutive failure threshold', () => {
    const failure1 = nextHealthFailureCount(0, false);
    const failure2 = nextHealthFailureCount(failure1, false);
    const failure3 = nextHealthFailureCount(failure2, false);

    expect(shouldRestartAfterHealthFailures(failure2)).toBe(false);
    expect(shouldRestartAfterHealthFailures(failure3)).toBe(true);
  });

  it('resets consecutive health failures after a successful probe', () => {
    const afterFailures = nextHealthFailureCount(2, false);
    const afterSuccess = nextHealthFailureCount(afterFailures, true);

    expect(afterFailures).toBe(3);
    expect(afterSuccess).toBe(0);
  });

  it('preserves endpoint order while removing duplicate service URLs', () => {
    expect(uniqueServiceUrls([
      'http://localhost:4400',
      'http://127.0.0.1:4400',
      'http://localhost:4400',
    ])).toEqual([
      'http://localhost:4400',
      'http://127.0.0.1:4400',
    ]);
  });
});

describe('kswarm service request gateway', () => {
  it('auto-starts when not running', async () => {
    const svc = createMockKSwarmService({
      onStart: async () => { /* simulate async start */ },
    });
    expect(svc.running).toBe(false);
    await svc.request('/agents');
    expect(svc.running).toBe(true);
    expect(svc.startCalls).toBe(1);
  });

  it('does not re-start when already running', async () => {
    const svc = createMockKSwarmService({});
    await svc.start();
    expect(svc.startCalls).toBe(1);
    await svc.request('/agents');
    expect(svc.startCalls).toBe(1);
  });

  it('concurrent requests share the same start promise', async () => {
    let startComplete = false;
    const svc = createMockKSwarmService({
      onStart: async () => {
        await new Promise(r => setTimeout(r, 50));
        startComplete = true;
      },
    });

    const [r1, r2, r3] = await Promise.all([
      svc.request('/agents'),
      svc.request('/projects'),
      svc.request('/agents', { method: 'POST' }),
    ]);

    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();
    expect(r3).toBeTruthy();
    expect(svc.startCalls).toBe(1);
    expect(startComplete).toBe(true);
  });

  it('external start and auto-start request share the same start promise', async () => {
    const svc = createMockKSwarmService({
      onStart: async () => {
        await new Promise(r => setTimeout(r, 50));
      },
    });

    const [started, requested] = await Promise.all([
      svc.start(),
      svc.request('/agents'),
    ]);

    expect(started).toBeUndefined();
    expect(requested).toBeTruthy();
    expect(svc.startCalls).toBe(1);
  });

  it('throws KSwarmUnavailableError when start does not make the service running', async () => {
    const svc = createMockKSwarmService({
      shouldRunAfterStart: false,
    });

    await expect(svc.request('/agents')).rejects.toThrow(KSwarmUnavailableError);
  });

  it('passes path and init to fetch handler', async () => {
    let capturedPath = '';
    let capturedMethod = '';
    const svc = createMockKSwarmService({
      onFetch: async (path, init) => {
        capturedPath = path;
        capturedMethod = init?.method || 'GET';
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    const res = await svc.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(capturedPath).toBe('/projects');
    expect(capturedMethod).toBe('POST');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns response with correct status', async () => {
    const svc = createMockKSwarmService({
      onFetch: async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    });

    const res = await svc.request('/unknown');
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it('falls back to the next service URL when the first endpoint is unreachable', async () => {
    const attemptedUrls: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      attemptedUrls.push(url);
      if (url.startsWith('http://localhost:4400')) {
        throw new Error('connect ECONNREFUSED ::1:4400');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await requestWithFallbackBaseUrls({
      baseUrls: ['http://localhost:4400', 'http://127.0.0.1:4400'],
      path: '/health',
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(res.ok).toBe(true);
    expect(attemptedUrls).toEqual([
      'http://localhost:4400/health',
      'http://127.0.0.1:4400/health',
    ]);
  });

  it('returns HTTP responses without falling back on application-level failures', async () => {
    const attemptedUrls: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      attemptedUrls.push(String(input));
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    };

    const res = await requestWithFallbackBaseUrls({
      baseUrls: ['http://localhost:4400', 'http://127.0.0.1:4400'],
      path: '/unknown',
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(res.status).toBe(404);
    expect(attemptedUrls).toEqual(['http://localhost:4400/unknown']);
  });

  it('throws KSwarmUnavailableError only after all service URLs fail', async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      throw new Error(`cannot reach ${String(input)}`);
    };

    await expect(requestWithFallbackBaseUrls({
      baseUrls: ['http://localhost:4400', 'http://127.0.0.1:4400'],
      path: '/health',
      fetchImpl,
      timeoutMs: 1_000,
    })).rejects.toThrow(KSwarmUnavailableError);
  });
});

describe('killStaleServiceOnPort', () => {
  it('returns false when no process is listening on the port', async () => {
    const result = await killStaleServiceOnPort(19999);
    expect(result).toBe(false);
  });

  it('returns false when the port owner is the current process', async () => {
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const pid = await findPidOnPort(port);
    server.close();
    if (pid === process.pid) {
      expect(await killStaleServiceOnPort(port)).toBe(false);
    }
  });

  it('findPidOnPort returns null for an unused port', async () => {
    const pid = await findPidOnPort(19999);
    expect(pid).toBeNull();
  });
});

describe('kswarm durable-state fail-stop exit classification', () => {
  it('treats exit 78 as terminal degraded (no auto-restart)', () => {
    expect(KSWARM_EXIT_LOAD_UNRECOVERABLE).toBe(78);
    expect(classifyKSwarmExit(78)).toEqual({
      action: 'terminal_degraded',
      reason: 'persistence_unrecoverable',
    });
  });

  it('treats exit 75 as a limited restart from the last durable revision', () => {
    expect(KSWARM_EXIT_SAVE_FAILED).toBe(75);
    expect(classifyKSwarmExit(75)).toEqual({
      action: 'limited_restart',
      reason: 'persistence_commit_failed',
    });
  });

  it('treats normal crashes, signals, and clean exits as regular restarts', () => {
    expect(classifyKSwarmExit(0)).toEqual({ action: 'restart' });
    expect(classifyKSwarmExit(1)).toEqual({ action: 'restart' });
    expect(classifyKSwarmExit(null)).toEqual({ action: 'restart' });
    expect(classifyKSwarmExit(undefined)).toEqual({ action: 'restart' });
  });

  it('clears terminal degraded state after a successful manual recovery', () => {
    expect(transitionKSwarmTerminalDegraded(false, 'unrecoverable_exit')).toBe(true);
    expect(transitionKSwarmTerminalDegraded(true, 'ready')).toBe(false);
  });

  it('bounds repeated persistence fail-stop restarts independently of ready-state resets', () => {
    expect(shouldStopAfterPersistenceFailStops(2, 3)).toBe(false);
    expect(shouldStopAfterPersistenceFailStops(3, 3)).toBe(true);
  });

  it('wires exit 78 and repeated exit 75 into stable service-level recovery gates', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-service-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let nextPid = 41_000;
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(nextPid++);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes(':4400/health')) {
        return new Response(JSON.stringify(kswarmHealthy ? { ok: true } : { ok: false }), {
          status: kswarmHealthy ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents')) {
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const spawnProcess = spawnMock as unknown as typeof import('node:child_process').spawn;
    const findPortOwner = async () => null;
    const terminalService = createKSwarmService({ spawnProcess, findPortOwner });
    await terminalService.start();
    kswarmHealthy = false;
    children.at(-1)?.emit('exit', KSWARM_EXIT_LOAD_UNRECOVERABLE, null);
    expect(terminalService.getStatus()).toMatchObject({
      running: false,
      terminalDegraded: true,
      persistenceFailStopCount: 0,
      lastError: expect.stringContaining('terminal degraded'),
    });
    await expect(terminalService.start()).rejects.toThrow(/terminal degraded|manual recovery/i);
    await terminalService.restart();
    expect(terminalService.getStatus()).toMatchObject({
      running: true,
      terminalDegraded: false,
      persistenceFailStopCount: 0,
    });
    await terminalService.stop();

    kswarmHealthy = false;
    const failStopService = createKSwarmService({ spawnProcess, findPortOwner });
    await failStopService.start();
    vi.useFakeTimers();
    for (let failure = 1; failure <= 3; failure++) {
      kswarmHealthy = false;
      children.at(-1)?.emit('exit', KSWARM_EXIT_SAVE_FAILED, null);
      if (failure < 3) {
        await vi.advanceTimersByTimeAsync(2_000);
      }
    }

    expect(failStopService.getStatus()).toMatchObject({
      running: false,
      terminalDegraded: false,
      persistenceFailStopCount: 3,
    });
    const spawnCountAtCap = spawnMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawnMock).toHaveBeenCalledTimes(spawnCountAtCap);
    await expect(failStopService.start()).rejects.toThrow(/manual recovery|maximum limited restarts/i);
    await failStopService.restart();
    expect(failStopService.getStatus()).toMatchObject({
      running: true,
      terminalDegraded: false,
      persistenceFailStopCount: 0,
    });
    await failStopService.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  }, 20_000);

  it('reaps the owned child before restarting after repeated health failures', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-health-restart-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(42_000 + children.length);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) {
        return new Response('{}', { status: 200 });
      }
      if (url.includes(':4400/health')) {
        return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      }
      if (url.endsWith('/agents')) {
        return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));

    vi.useFakeTimers();
    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    await service.start();
    expect(children).toHaveLength(1);
    const originalChild = children[0];

    kswarmHealthy = false;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(originalChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(originalChild.alive).toBe(false);
    expect(children).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(children).toHaveLength(2);
    expect(children.filter((child) => child.alive)).toHaveLength(1);
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  }, 20_000);

  it('reclaims an unhealthy orphan port owner before spawning a new server', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-orphan-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    const findPortOwner = vi.fn(async () => 43_210);
    const killStalePortOwner = vi.fn(async () => true);
    spawnMock.mockImplementation(() => {
      kswarmHealthy = true;
      return new FakeKSwarmChild(43_211);
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner,
      killStalePortOwner,
    });
    await service.start();

    expect(findPortOwner).toHaveBeenCalledWith(4400);
    expect(killStalePortOwner).toHaveBeenCalledWith(4400);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('cancels a pending backoff restart when start already spawned a replacement', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-backoff-race-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(44_000 + children.length);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    vi.useFakeTimers();
    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    await service.start();
    children[0].alive = false;
    kswarmHealthy = false;
    children[0].emit('exit', 1, null);

    await service.start();
    expect(children).toHaveLength(2);
    expect(children.filter((child) => child.alive)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(children).toHaveLength(2);
    expect(children.filter((child) => child.alive)).toHaveLength(1);
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('shares one spawn when start races a backoff callback before child assignment', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-spawn-race-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let blockNextHealth = false;
    let releaseBlockedHealth: (() => void) | null = null;
    let signalBlockedHealth: (() => void) | null = null;
    const blockedHealth = new Promise<void>((resolve) => { signalBlockedHealth = resolve; });
    const releaseHealth = new Promise<void>((resolve) => { releaseBlockedHealth = resolve; });
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(45_000 + children.length);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) {
        if (blockNextHealth) {
          blockNextHealth = false;
          signalBlockedHealth?.();
          await releaseHealth;
          return new Response('{}', { status: 503 });
        }
        return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      }
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    vi.useFakeTimers();
    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    await service.start();
    children[0].alive = false;
    kswarmHealthy = false;
    children[0].emit('exit', 1, null);
    blockNextHealth = true;

    const backoffRestart = vi.advanceTimersByTimeAsync(2_000);
    await blockedHealth;
    const manualStart = service.start();
    releaseBlockedHealth?.();
    await Promise.all([backoffRestart, manualStart]);

    expect(children).toHaveLength(2);
    expect(children.filter((child) => child.alive)).toHaveLength(1);
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('does not spawn after stop wins while startup health probing is in flight', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-stop-race-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let releaseBlockedHealth: (() => void) | null = null;
    let signalBlockedHealth: (() => void) | null = null;
    const blockedHealth = new Promise<void>((resolve) => { signalBlockedHealth = resolve; });
    const releaseHealth = new Promise<void>((resolve) => { releaseBlockedHealth = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4400/health')) {
        signalBlockedHealth?.();
        await releaseHealth;
        return new Response('{}', { status: 503 });
      }
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await blockedHealth;
    releaseBlockedHealth?.();
    const stop = service.stop();
    await Promise.all([start, stop]);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ running: false, pid: null });
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('reaps a child that misses the startup deadline and schedules a fresh recovery', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-startup-timeout-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let allowReadyOnSpawn = false;
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(46_000 + children.length);
      children.push(child);
      if (allowReadyOnSpawn) kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    vi.useFakeTimers();
    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const firstStart = service.start();
    await vi.advanceTimersByTimeAsync(8_500);
    await firstStart;

    expect(children).toHaveLength(1);
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(children[0].alive).toBe(false);
    expect(service.getStatus()).toMatchObject({ running: false, pid: null });

    allowReadyOnSpawn = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(children).toHaveLength(2);
    expect(service.getStatus()).toMatchObject({ running: true, pid: children[1].pid });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  }, 20_000);

  it('restart waits for an in-flight start to stop and then launches a fresh server', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-restart-join-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let releaseBlockedHealth: (() => void) | null = null;
    let signalBlockedHealth: (() => void) | null = null;
    let blockFirstHealth = true;
    const blockedHealth = new Promise<void>((resolve) => { signalBlockedHealth = resolve; });
    const releaseHealth = new Promise<void>((resolve) => { releaseBlockedHealth = resolve; });
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(47_000 + children.length);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) {
        if (blockFirstHealth) {
          blockFirstHealth = false;
          signalBlockedHealth?.();
          await releaseHealth;
          return new Response('{}', { status: 503 });
        }
        return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      }
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await blockedHealth;
    releaseBlockedHealth?.();
    const restart = service.restart();
    await Promise.all([start, restart]);

    expect(children).toHaveLength(1);
    expect(service.getStatus()).toMatchObject({ running: true, pid: children[0].pid });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('start waits for an in-flight stop before launching a fresh server', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-stop-start-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let releaseFirstExit: (() => void) | null = null;
    let signalFirstKill: (() => void) | null = null;
    const firstKillStarted = new Promise<void>((resolve) => { signalFirstKill = resolve; });
    const releaseExit = new Promise<void>((resolve) => { releaseFirstExit = resolve; });
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(48_000 + children.length);
      if (children.length === 0) {
        child.kill = vi.fn((signal?: NodeJS.Signals) => {
          if (signal === 'SIGTERM') {
            signalFirstKill?.();
            void releaseExit.then(() => {
              child.alive = false;
              child.emit('exit', 0, signal);
            });
          }
          return true;
        });
      }
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    await service.start();
    const stop = service.stop();
    await firstKillStarted;
    kswarmHealthy = false;
    const start = service.start();
    releaseFirstExit?.();
    await Promise.all([stop, start]);

    expect(children).toHaveLength(2);
    expect(children.filter((child) => child.alive)).toHaveLength(1);
    expect(service.getStatus()).toMatchObject({ running: true, pid: children[1].pid });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('joins an owned startup before checking request availability', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-request-startup-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let signalChildSpawned: (() => void) | null = null;
    const childSpawned = new Promise<void>((resolve) => { signalChildSpawned = resolve; });
    const child = new FakeKSwarmChild(48_500);
    spawnMock.mockImplementation(() => {
      signalChildSpawned?.();
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await childSpawned;
    const request = service.request('/agents');
    kswarmHealthy = true;

    await expect(request).resolves.toMatchObject({ ok: true });
    await start;
    expect(service.getStatus()).toMatchObject({ running: true, pid: child.pid });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('does not publish an adopted service after stop wins seed reconciliation', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-adopt-stop-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let blockSeedReconciliation = true;
    let releaseSeedReconciliation: (() => void) | null = null;
    let signalSeedReconciliation: (() => void) | null = null;
    const seedReconciliationStarted = new Promise<void>((resolve) => { signalSeedReconciliation = resolve; });
    const releaseReconciliation = new Promise<void>((resolve) => { releaseSeedReconciliation = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) {
        return new Response(JSON.stringify({
          ok: true,
          features: ['dynamic_workflows'],
          workflowCapabilities: {
            schemaVersion: 'kswarm_workflow_patterns_v1',
            compiledContract: true,
            patternPublicView: true,
          },
          service: { entryPath: serverPath },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents')) {
        if (blockSeedReconciliation) {
          blockSeedReconciliation = false;
          signalSeedReconciliation?.();
          await releaseReconciliation;
        }
        return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await seedReconciliationStarted;
    await service.stop();
    releaseSeedReconciliation?.();
    await start;

    expect(service.getStatus()).toMatchObject({ running: false, pid: null });
    await service.start();
    expect(service.getStatus()).toMatchObject({ running: true, pid: null });
    expect(spawnMock).not.toHaveBeenCalled();
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('does not bootstrap a broker after stop wins external-service adoption', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-adopt-broker-stop-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let brokerHealthChecks = 0;
    let brokerAvailable = false;
    let releaseBrokerProbe: (() => void) | null = null;
    let signalBrokerProbe: (() => void) | null = null;
    const brokerProbeStarted = new Promise<void>((resolve) => { signalBrokerProbe = resolve; });
    const releaseProbe = new Promise<void>((resolve) => { releaseBrokerProbe = resolve; });
    spawnMock.mockImplementation(() => new FakeKSwarmChild(49_500));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) {
        brokerHealthChecks++;
        if (brokerHealthChecks === 1) {
          signalBrokerProbe?.();
          await releaseProbe;
        }
        return new Response('{}', { status: brokerAvailable || brokerHealthChecks > 4 ? 200 : 503 });
      }
      if (url.includes(':4400/health')) {
        return new Response(JSON.stringify({
          ok: true,
          features: ['dynamic_workflows'],
          workflowCapabilities: {
            schemaVersion: 'kswarm_workflow_patterns_v1',
            compiledContract: true,
            patternPublicView: true,
          },
          service: { entryPath: serverPath },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await brokerProbeStarted;
    await service.stop();
    releaseBrokerProbe?.();
    await start;

    expect(service.getStatus()).toMatchObject({ running: false, pid: null });
    expect(spawnMock).not.toHaveBeenCalled();
    brokerAvailable = true;
    await service.start();
    expect(service.getStatus()).toMatchObject({ running: true, pid: null });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('does not publish ready after stop wins an in-flight health probe', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-ready-stop-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    let blockReadyProbe = true;
    let releaseReadyProbe: (() => void) | null = null;
    let signalReadyProbe: (() => void) | null = null;
    const readyProbeStarted = new Promise<void>((resolve) => { signalReadyProbe = resolve; });
    const releaseProbe = new Promise<void>((resolve) => { releaseReadyProbe = resolve; });
    const children: FakeKSwarmChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeKSwarmChild(49_000 + children.length);
      children.push(child);
      kswarmHealthy = true;
      return child;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) {
        if (kswarmHealthy && blockReadyProbe) {
          blockReadyProbe = false;
          signalReadyProbe?.();
          await releaseProbe;
          return new Response('{}', { status: 200 });
        }
        return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      }
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    const start = service.start();
    await readyProbeStarted;
    await service.stop();
    kswarmHealthy = false;
    releaseReadyProbe?.();
    await start;

    expect(service.getStatus()).toMatchObject({ running: false, pid: null });
    await service.start();
    expect(children).toHaveLength(2);
    expect(service.getStatus()).toMatchObject({ running: true, pid: children[1].pid });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });

  it('contains backoff spawn failures and keeps the service recoverable', async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-restart-error-'));
    const serverPath = join(serviceRoot, 'server.js');
    writeFileSync(serverPath, '', 'utf8');
    vi.stubEnv('KSWARM_SERVER_PATH', serverPath);
    let kswarmHealthy = false;
    const firstChild = new FakeKSwarmChild(50_000);
    spawnMock
      .mockImplementationOnce(() => {
        kswarmHealthy = true;
        return firstChild;
      })
      .mockImplementationOnce(() => {
        throw new Error('spawn boom');
      });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}', { status: 200 });
      if (url.includes(':4400/health')) return new Response('{}', { status: kswarmHealthy ? 200 : 503 });
      if (url.endsWith('/agents')) return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    vi.useFakeTimers();
    const service = createKSwarmService({
      spawnProcess: spawnMock as unknown as typeof import('node:child_process').spawn,
      findPortOwner: async () => null,
    });
    await service.start();
    firstChild.alive = false;
    kswarmHealthy = false;
    firstChild.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getStatus()).toMatchObject({
      running: false,
      pid: null,
      lastError: expect.stringContaining('spawn boom'),
    });
    await service.stop();
    rmSync(serviceRoot, { recursive: true, force: true });
  });
});

describe('kswarm room auth secrets persistence', () => {
  it('persists stable room auth tokens across launches', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-secrets-'));
    try {
      const first = loadOrCreateRoomSecrets(root);
      const second = loadOrCreateRoomSecrets(root);

      // Tokens must be identical across "restarts" so a long-lived broker and a
      // freshly re-launched desktop always agree (the desync root cause).
      expect(second).toEqual({
        desktopRoomToken: first.desktopRoomToken,
        kswarmRoomToken: first.kswarmRoomToken,
        desktopMutationToken: first.desktopMutationToken,
      });

      // The secret file reflects the persisted values.
      const onDisk = JSON.parse(readFileSync(join(root, 'room-auth-secrets.json'), 'utf8')) as Record<string, string>;
      expect(onDisk.desktopRoomToken).toBe(first.desktopRoomToken);
      expect(onDisk.kswarmRoomToken).toBe(first.kswarmRoomToken);
      expect(onDisk.desktopMutationToken).toBe(first.desktopMutationToken);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('regenerates secrets after a corrupt secret file', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-kswarm-secrets-corrupt-'));
    try {
      writeFileSync(join(root, 'room-auth-secrets.json'), '{not-valid-json', 'utf8');
      const secrets = loadOrCreateRoomSecrets(root);
      expect(secrets.desktopRoomToken).toContain('xiaok-room-user-');
      expect(secrets.kswarmRoomToken).toContain('xiaok-room-system-');
      expect(secrets.desktopMutationToken).toContain('xiaok-desktop-');
      // And the regenerated values are written back.
      const onDisk = JSON.parse(readFileSync(join(root, 'room-auth-secrets.json'), 'utf8')) as Record<string, string>;
      expect(onDisk.desktopRoomToken).toBe(secrets.desktopRoomToken);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
