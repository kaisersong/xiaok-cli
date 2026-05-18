import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import type { KSwarmService, KSwarmServiceStatus } from '../../electron/kswarm-service.js';

function createRestartableKSwarm(detail: unknown): KSwarmService & { restartCountSeen(): number } {
  let restartCount = 0;
  let status: KSwarmServiceStatus = { running: true, port: 4400, pid: 1, restartCount: 0, lastError: null };
  const listeners = new Set<(status: KSwarmServiceStatus) => void>();
  return {
    start: async () => {
      status = { ...status, running: true };
    },
    stop: async () => {
      status = { ...status, running: false };
    },
    restart: async () => {
      restartCount += 1;
      status = { ...status, running: true, restartCount };
      for (const listener of listeners) listener(status);
    },
    getStatus: () => status,
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: async (path: string) => {
      if (path === '/projects/proj-1/full') return Response.json(detail);
      return new Response('{"error":"not found"}', { status: 404 });
    },
    restartCountSeen: () => restartCount,
  };
}

describe('AHE-lite live IPC smoke', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-ahe-live-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('covers Desktop trace/diagnose IPC plus KSwarm restart continuity in one release-gate smoke', async () => {
    const detail = {
      project: { id: 'proj-1', name: 'AHE smoke', status: 'active' },
      tasks: [{ id: 'item-6', title: 'Evidence review', status: 'blocked', blockedReason: 'missing artifact evidence' }],
      agents: [{ id: 'agent-1', name: 'Worker', status: 'idle' }],
      projectHealth: { status: 'blocked', primaryBlockedTaskId: 'item-6', message: 'missing artifact evidence' },
    };
    const kswarm = createRestartableKSwarm(detail);
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: kswarm,
      now: () => 300,
    });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };

    await registerDesktopIpc(ipcMain as never, window as never, services);
    const ipcRenderer = {
      invoke: vi.fn(async (channel: string, input?: unknown) => handlers.get(channel)?.({}, input)),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.exportTraceBundle({ kind: 'project', id: 'proj-1' })).resolves.toMatchObject({ ok: true });
    await expect(api.diagnose({ kind: 'project', id: 'proj-1' })).resolves.toMatchObject({
      primaryFinding: { category: 'blocked_task', evidenceIds: ['task:item-6'] },
    });
    await expect(kswarm.restart()).resolves.toBeUndefined();

    expect(kswarm.restartCountSeen()).toBe(1);
    expect(window.webContents.send).not.toHaveBeenCalledWith(expect.stringContaining('error'), expect.anything());
  });
});
