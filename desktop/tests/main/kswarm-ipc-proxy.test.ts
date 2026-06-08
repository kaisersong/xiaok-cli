import { describe, expect, it, vi } from 'vitest';

import { registerKSwarmProxy } from '../../electron/kswarm-ipc-proxy.js';

function createIpcMainMock() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    },
  };
}

describe('kswarm ipc proxy', () => {
  it('routes write requests through the managed kswarm service gateway', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response(JSON.stringify({ ok: true, project: { id: 'proj-1' } }), { status: 200 }));

    registerKSwarmProxy(ipcMain as never, { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never, { request });

    const handler = handlers.get('desktop:kswarm:proxy:post');
    expect(handler).toBeDefined();
    const result = await handler?.({}, '/projects', { name: 'Demo' });

    expect(request).toHaveBeenCalledWith('/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Demo' }),
    }));
    expect(result).toEqual({ ok: true, project: { id: 'proj-1' } });
  });
});
