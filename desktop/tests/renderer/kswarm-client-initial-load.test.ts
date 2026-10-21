import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';
import { KSwarmStreamBridge } from '../../electron/kswarm-stream-bridge';

import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';

describe('useKSwarmClient initial load', () => {
  let kswarmProxyGetMock: ReturnType<typeof vi.fn>;
  let connectionHandler: ((payload: { status: string }) => void) | null;

  beforeEach(() => {
    connectionHandler = null;
    kswarmProxyGetMock = vi.fn(async (path: string) => {
      if (path === '/projects') {
        return { projects: [{ id: 'proj-live', name: 'Live project', status: 'active' }] };
      }
      if (path === '/agents') {
        return { agents: [{ id: 'xiaok-worker', name: 'Worker', status: 'idle' }] };
      }
      if (path === '/participants') {
        return { participants: [] };
      }
      return null;
    });

    (globalThis as any).window.xiaokDesktop = {
      kswarmProxyGet: kswarmProxyGetMock,
      kswarmStreamSubscribe: vi.fn(() => {
        connectionHandler?.({ status: 'connected' });
        return Promise.resolve({ ok: true });
      }),
      kswarmStreamGetStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
      kswarmStreamUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
      onKSwarmConnectionStatus: vi.fn((handler: (payload: { status: string }) => void) => {
        connectionHandler = handler;
        return () => {
          connectionHandler = null;
        };
      }),
      onKSwarmWsEvent: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).window.xiaokDesktop;
  });

  it('loads projects when subscribe synchronously reports an already-connected stream', async () => {
    const { result } = renderHook(() => useKSwarmClient());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projectsLoaded).toBe(true);
    });

    expect(kswarmProxyGetMock).toHaveBeenCalledWith('/projects');
    expect(result.current.projects[0]).toMatchObject({ id: 'proj-live', name: 'Live project' });
  });

  it('keeps projects marked unloaded while connection arrives before the first snapshot', async () => {
    let resolveProjects: ((value: { projects: Array<{ id: string; name: string; status: string }> }) => void) | null = null;
    kswarmProxyGetMock.mockImplementation(async (path: string) => {
      if (path === '/projects') {
        return await new Promise(resolve => {
          resolveProjects = resolve;
        });
      }
      if (path === '/agents') return { agents: [] };
      if (path === '/participants') return { participants: [] };
      return null;
    });

    const { result } = renderHook(() => useKSwarmClient());

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.projectsLoaded).toBe(false);

    await act(async () => {
      resolveProjects?.({ projects: [] });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.projectsLoaded).toBe(true));
  });

  it('loads the initial REST snapshot even when the stream is disconnected', async () => {
    const api = (globalThis as any).window.xiaokDesktop;
    api.kswarmStreamSubscribe.mockResolvedValue({ ok: true });
    api.kswarmStreamGetStatus.mockResolvedValue({ status: 'disconnected' });

    const { result } = renderHook(() => useKSwarmClient());

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1);
    });

    expect(result.current.connected).toBe(false);
    expect(kswarmProxyGetMock).toHaveBeenCalledWith('/projects');
  });

  it('retries the initial project snapshot when KSwarm is restarting during mount', async () => {
    vi.useFakeTimers();
    const api = (globalThis as any).window.xiaokDesktop;
    api.kswarmStreamSubscribe.mockResolvedValue({ ok: true });
    api.kswarmStreamGetStatus.mockResolvedValue({ status: 'disconnected' });
    kswarmProxyGetMock.mockImplementation(async (path: string) => {
      if (path === '/projects') {
        const projectCalls = kswarmProxyGetMock.mock.calls.filter(([calledPath]) => calledPath === '/projects').length;
        if (projectCalls === 1) return null;
        return { projects: [{ id: 'proj-recovered', name: 'Recovered project', status: 'active' }] };
      }
      if (path === '/agents') {
        return { agents: [{ id: 'xiaok-worker', name: 'Worker', status: 'idle' }] };
      }
      if (path === '/participants') {
        return { participants: [] };
      }
      return null;
    });

    const { result } = renderHook(() => useKSwarmClient());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(kswarmProxyGetMock).toHaveBeenCalledWith('/projects');
    expect(result.current.projects).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0]).toMatchObject({ id: 'proj-recovered' });
  });

  it('preserves existing projects when a later refresh fails', async () => {
    const { result } = renderHook(() => useKSwarmClient());

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1);
    });

    kswarmProxyGetMock.mockImplementation(async (path: string) => {
      if (path === '/projects') return null;
      if (path === '/agents') return { agents: [] };
      if (path === '/participants') return { participants: [] };
      return null;
    });

    await act(async () => {
      await result.current.fetchProjects();
    });

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0]).toMatchObject({ id: 'proj-live' });
  });
  it('keeps subscription outcome unavailable without retry when the bridge returns unknown', async () => {
    const api = (globalThis as any).window.xiaokDesktop;
    api.kswarmStreamSubscribe.mockResolvedValue({ ok: false, code: 'proxy_operation_unknown' });
    const { result } = renderHook(() => useKSwarmClient());
    await waitFor(() => expect(result.current.projectsLoaded).toBe(true));
    await waitFor(() => expect(result.current.connected).toBe(false));
    act(() => connectionHandler?.({ status: 'connected' }));
    expect(result.current.connected).toBe(false);
    expect(result.current.projects[0].id).toBe('proj-live');
    expect(api.kswarmStreamSubscribe).toHaveBeenCalledTimes(1);
  });

  it('handles the actual partial bridge subscription rejection without unhandled failure or retry', async () => {
    const api = (globalThis as any).window.xiaokDesktop;
    const bridge = new KSwarmStreamBridge('ws://127.0.0.1:1');
    const marker = Error('actual sender transport failure');
    const sender = Object.assign(new EventEmitter(), { id: 97, isDestroyed: () => false, send: () => { throw marker; } });
    api.kswarmStreamSubscribe.mockImplementation(async () => {
      bridge.subscribe({ sender } as never);
      return { ok: true };
    });
    const { result } = renderHook(() => useKSwarmClient());
    try {
      await waitFor(() => expect(result.current.projectsLoaded).toBe(true));
      await waitFor(() => expect(result.current.connected).toBe(false));
      expect(sender.listenerCount('destroyed')).toBe(1);
      expect(api.kswarmStreamSubscribe).toHaveBeenCalledTimes(1);
      expect(result.current.projects[0].id).toBe('proj-live');
    } finally { bridge.dispose(); }
  });

});
