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

    registerKSwarmProxy(ipcMain as never, { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never, { request, getDesktopMutationToken: () => 'desktop-token' });

    const handler = handlers.get('desktop:kswarm:proxy:post');
    expect(handler).toBeDefined();
    const result = await handler?.({}, '/projects/proj-1/tasks', { tasks: [{ title: 'Review' }] });

    expect(request).toHaveBeenCalledWith('/projects/proj-1/tasks', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-kswarm-mutation-token': 'desktop-token' }),
      body: JSON.stringify({ tasks: [{ title: 'Review' }] }),
    }));
    expect(result).toEqual({ ok: true, project: { id: 'proj-1' } });
  });

  it('applies one default-deny gate to all seven generic proxy channels', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    const attempts: Array<[string, unknown[]]> = [
      ['desktop:kswarm:proxy:get', [{}, '/agents/secret-agent']],
      ['desktop:kswarm:proxy:getText', [{}, '/agents/secret-agent']],
      ['desktop:kswarm:proxy:post', [{}, '/agents', { name: 'unsafe' }]],
      ['desktop:kswarm:proxy:postJson', [{}, '/agents/secret-agent/archive', {}]],
      ['desktop:kswarm:proxy:put', [{}, '/agents/secret-agent', { apiKey: 'secret' }]],
      ['desktop:kswarm:proxy:patch', [{}, '/projects/project-1/execution-mode', { executionMode: 'auto' }]],
      ['desktop:kswarm:proxy:delete', [{}, '/agents/secret-agent']],
    ];

    for (const [channel, args] of attempts) {
      await handlers.get(channel)?.(...args);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    '/agents/agent-1/',
    '/agents/agent-1?allowed=true',
    '/agents/%2fsecret',
    '/agents/%2Fsecret',
    '/agents%2fagent-1',
    '/agents/agent-1/../liveness',
    '/agents//liveness',
    '//agents/agent-1',
  ])('rejects normalized-path bypass attempt %s', async (path) => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response('{}', { status: 200 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    expect(await handlers.get('desktop:kswarm:proxy:get')?.({}, path)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('redacts agent credentials from JSON and JSON-shaped text responses', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const secretAgent = {
      id: 'agent-1',
      apiKey: 'secret',
      baseUrl: 'https://secret.example',
      customEnv: { TOKEN: 'secret' },
      runtimePath: '/secret/runtime',
      execution: { credential: 'secret' },
      nested: { providerSecret: 'secret', safe: true },
    };
    const request = vi.fn(async (path: string) => {
      if (path === '/agents') {
        return new Response(JSON.stringify({ agents: [secretAgent] }), { status: 200 });
      }
      return new Response(JSON.stringify(secretAgent), { status: 200 });
    });
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    const json = await handlers.get('desktop:kswarm:proxy:get')?.({}, '/agents');
    const text = await handlers.get('desktop:kswarm:proxy:getText')?.({}, '/projects/project-1/artifacts/agent.json');

    expect(JSON.stringify(json)).not.toContain('secret');
    expect(JSON.stringify(json)).not.toContain('runtimePath');
    expect(String(text)).not.toContain('secret');
    expect(String(text)).not.toContain('runtimePath');
    expect(json).toEqual({ agents: [{ id: 'agent-1', nested: { safe: true } }] });
  });

  it('preserves non-sensitive project execution facts while removing credential-bearing execution blocks', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response(JSON.stringify({
      project: {
        id: 'project-1',
        execution: { status: 'running', attempts: 2 },
        agent: { id: 'agent-1', execution: { credential: 'secret' } },
      },
    }), { status: 200 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    expect(await handlers.get('desktop:kswarm:proxy:get')?.({}, '/projects/project-1')).toEqual({
      project: {
        id: 'project-1',
        execution: { status: 'running', attempts: 2 },
        agent: { id: 'agent-1' },
      },
    });
  });

  it('keeps postJson null semantics for an empty successful response', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    expect(await handlers.get('desktop:kswarm:proxy:postJson')?.(
      {},
      '/projects/project-1/continue',
      {},
    )).toBeNull();
  });

  it('rejects secret-bearing bodies even on an otherwise allowed write route', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response('{}', { status: 200 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    expect(await handlers.get('desktop:kswarm:proxy:post')?.(
      {},
      '/projects/project-1/tasks',
      { tasks: [{ title: 'Review', provider: 'openai', apiKey: 'secret' }] },
    )).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('denies unknown routes by default while preserving query parameters on allowed reads', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const request = vi.fn(async () => new Response(JSON.stringify({ models: ['safe'] }), { status: 200 }));
    registerKSwarmProxy(
      ipcMain as never,
      { subscribe: vi.fn(), unsubscribe: vi.fn(), getConnectionStatus: vi.fn(() => 'connected') } as never,
      { request, getDesktopMutationToken: () => 'desktop-token' },
    );

    expect(await handlers.get('desktop:kswarm:proxy:get')?.({}, '/future/admin/export')).toBeNull();
    expect(await handlers.get('desktop:kswarm:proxy:get')?.({}, '/llm/models?provider=openai')).toEqual({ models: ['safe'] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/llm/models?provider=openai', expect.objectContaining({ method: 'GET' }));
  });
});
