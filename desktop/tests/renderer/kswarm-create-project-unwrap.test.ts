import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';

describe('useKSwarmClient.createProject envelope unwrap', () => {
  let kswarmProxyPostMock: ReturnType<typeof vi.fn>;
  let kswarmProxyGetMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kswarmProxyGetMock = vi.fn().mockResolvedValue({ projects: [] });
    kswarmProxyPostMock = vi.fn().mockResolvedValue({ projects: [] });
    enqueueMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).window.xiaokDesktop = {
      listPrinciples: vi.fn().mockResolvedValue([]),
      kswarmStartProjectPlanning: enqueueMock,
      kswarmProxyGet: kswarmProxyGetMock,
      kswarmProxyPost: kswarmProxyPostMock,
      kswarmProxyDelete: vi.fn().mockResolvedValue(true),
      kswarmStreamSubscribe: vi.fn().mockResolvedValue({ ok: true }),
      kswarmStreamUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
      onKSwarmConnectionStatus: vi.fn().mockReturnValue(() => {}),
      onKSwarmWsEvent: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (globalThis as any).window.xiaokDesktop;
  });

  it('unwraps response.project and enqueues planning bootstrap with the project id', async () => {
    kswarmProxyPostMock.mockImplementation(async (path: string) => {
      if (path === '/projects') {
        return {
          ok: true,
          project: { id: 'proj-xyz', name: 'Demo', status: 'created', createdAt: 1 },
          preparation: {},
          planningStart: {},
        };
      }
      return { projects: [] };
    });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown;
    await act(async () => {
      created = await result.current.createProject({
        name: 'Demo',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: ['xiaok-worker'],
      } as any);
    });

    expect(created).toMatchObject({ id: 'proj-xyz', name: 'Demo' });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-xyz',
      projectName: 'Demo',
      poAgent: 'xiaok-po',
    }));
  });

  it('returns null and does not enqueue planning when the project id is missing', async () => {
    kswarmProxyPostMock.mockImplementation(async (path: string) => {
      if (path === '/projects') {
        return { ok: true, project: { name: 'NoId', status: 'created' } };
      }
      return { projects: [] };
    });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown = 'sentinel';
    await act(async () => {
      created = await result.current.createProject({
        name: 'NoId',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: [],
      } as any);
    });

    expect(created).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('still returns the project but logs when planning enqueue is rejected', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    enqueueMock.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    kswarmProxyPostMock.mockImplementation(async (path: string) => {
      if (path === '/projects') {
        return {
          ok: true,
          project: { id: 'proj-rej', name: 'Rej', status: 'created', createdAt: 1 },
        };
      }
      return { projects: [] };
    });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown;
    await act(async () => {
      created = await result.current.createProject({
        name: 'Rej',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: [],
      } as any);
    });

    expect(created).toMatchObject({ id: 'proj-rej' });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[createProject] Planning bootstrap enqueue rejected',
        expect.objectContaining({ ok: false }),
      );
    });
  });
});
