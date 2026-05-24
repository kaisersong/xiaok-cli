import { describe, expect, it } from 'vitest';

import {
  buildBackgroundNodeSpawnOptions,
  KSwarmUnavailableError,
  shouldAdoptExistingKSwarmService,
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
});

describe('kswarm service external adoption', () => {
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

  it('does not treat a desktop-owned child as an external service', () => {
    expect(shouldAdoptExistingKSwarmService({ hasOwnedChild: true, healthOk: true })).toBe(false);
    expect(shouldAdoptExistingKSwarmService({ hasOwnedChild: false, healthOk: false })).toBe(false);
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
});
