import { describe, expect, it } from 'vitest';

import {
  buildBackgroundNodeSpawnOptions,
  buildIntentBrokerServiceEnv,
  doesKSwarmHealthMatchExpectedService,
  KSwarmUnavailableError,
  nextHealthFailureCount,
  requestWithFallbackBaseUrls,
  resolveBackgroundNodeRuntime,
  resolveIntentBrokerRuntimeRoot,
  shouldAdoptExistingKSwarmService,
  shouldRestartAfterHealthFailures,
  uniqueServiceUrls,
} from '../../electron/kswarm-service.js';

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
    if (startingPromise) {
      await startingPromise;
      return;
    }
    startingPromise = start().finally(() => {
      startingPromise = null;
    });
    await startingPromise;
  }

  async function start(): Promise<void> {
    startCalls++;
    if (handlers.onStart) await handlers.onStart();
    running = handlers.shouldRunAfterStart ?? true;
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
  it('requires service source identity to match when an expected source hash is available', () => {
    const entryPath = '/tmp/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js';

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath, sourceHash: 'hash-new' },
    }, entryPath, 'hash-new')).toBe(true);

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath, sourceHash: 'hash-old' },
    }, entryPath, 'hash-new')).toBe(false);

    expect(doesKSwarmHealthMatchExpectedService({
      service: { entryPath },
    }, entryPath, 'hash-new')).toBe(false);
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
