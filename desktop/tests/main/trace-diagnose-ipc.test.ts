import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

function kswarmWithProjectDetail(detail: unknown): KSwarmService {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {},
    request: async (path: string) => {
      if (path === '/projects/proj-1/full') return Response.json(detail);
      return new Response('{"error":"not found"}', { status: 404 });
    },
  };
}

describe('desktop trace/diagnose IPC', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-trace-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('exposes semantic preload APIs for trace export and diagnosis', async () => {
    const ipcRenderer = { invoke: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/trace.json' }), on: vi.fn(), off: vi.fn() };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.exportTraceBundle({ kind: 'project', id: 'proj-1' })).resolves.toEqual({ ok: true, path: '/tmp/trace.json' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:trace:export', { kind: 'project', id: 'proj-1' });
  });

  it('registers IPC handlers that export and diagnose a KSwarm project trace', async () => {
    const detail = {
      project: { id: 'proj-1', name: '技术大会演讲报告', status: 'active' },
      tasks: [{ id: 'item-6', title: '结构评审', status: 'blocked', blockedReason: '结构评审缺少证据' }],
      agents: [{ id: 'agent-1', name: 'Worker', status: 'idle' }],
      projectHealth: { status: 'blocked', primaryBlockedTaskId: 'item-6', message: '结构评审缺少证据' },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: kswarmWithProjectDetail(detail),
      now: () => 300,
    });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };

    await registerDesktopIpc(ipcMain as never, window as never, services);

    const exportResult = await handlers.get('desktop:trace:export')?.({}, { kind: 'project', id: 'proj-1' }) as { ok: boolean; path: string };
    expect(exportResult).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(exportResult.path, 'utf8'))).toMatchObject({
      scope: { kind: 'project', projectId: 'proj-1' },
    });

    const report = await handlers.get('desktop:diagnose')?.({}, { kind: 'project', id: 'proj-1' });
    expect(report).toMatchObject({
      primaryFinding: { category: 'blocked_task', evidenceIds: ['task:item-6'] },
    });
  });
});
