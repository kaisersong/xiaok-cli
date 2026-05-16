import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KSwarmUnavailableError } from '../../electron/kswarm-service.js';

// We can't actually spawn kswarm in unit tests, so we test the
// request() logic by creating a mock KSwarmService that exposes
// the same interface.

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
}): MockKSwarmService {
  let running = false;
  let startCalls = 0;
  let startingPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (running) return;
    if (startingPromise) { await startingPromise; return; }
    startingPromise = start().catch(() => {});
    await startingPromise;
    startingPromise = null;
  }

  async function start(): Promise<void> {
    startCalls++;
    if (handlers.onStart) await handlers.onStart();
    running = true;
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

  // Expose for test assertions
  const service = {
    get running() { return running; },
    get startCalls() { return startCalls; },
    start,
    getStatus,
    request,
  };
  return service;
}

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
    expect(svc.startCalls).toBe(1); // no additional start call
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
    expect(svc.startCalls).toBe(1); // only one start call
    expect(startComplete).toBe(true);
  });

  it('throws KSwarmUnavailableError when start fails', async () => {
    const svc = createMockKSwarmService({
      onStart: async () => {
        // Simulate failure: don't set running=true
        throw new Error('spawn failed');
      },
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
