import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    });

    expect(kswarmProxyGetMock).toHaveBeenCalledWith('/projects');
    expect(result.current.projects[0]).toMatchObject({ id: 'proj-live', name: 'Live project' });
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
});
