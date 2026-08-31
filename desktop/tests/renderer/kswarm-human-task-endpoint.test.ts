import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';

describe('useKSwarmClient human task endpoint', () => {
  const proxyPost = vi.fn();

  beforeEach(() => {
    proxyPost.mockReset().mockResolvedValue({ ok: true });
    (globalThis as any).window.xiaokDesktop = {
      kswarmProxyGet: vi.fn(async (path: string) => {
        if (path === '/projects') return { projects: [] };
        if (path === '/agents') return { agents: [] };
        if (path === '/participants') return { participants: [] };
        return null;
      }),
      kswarmProxyPost: proxyPost,
      kswarmProxyPut: vi.fn(),
      kswarmProxyDelete: vi.fn(),
      kswarmStreamSubscribe: vi.fn().mockResolvedValue({ ok: true }),
      kswarmStreamGetStatus: vi.fn().mockResolvedValue({ status: 'disconnected' }),
      kswarmStreamUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
      onKSwarmConnectionStatus: vi.fn().mockReturnValue(() => {}),
      onKSwarmWsEvent: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as any).window.xiaokDesktop;
  });

  it('uses the human task endpoint and preserves the selected assignee', async () => {
    const { result } = renderHook(() => useKSwarmClient());
    let ok = false;

    await act(async () => {
      ok = await result.current.humanAddTasks('project-1', [{
        title: '来源核验',
        description: '读取来源',
        assignedAgent: 'xiaok-worker',
      }]);
    });

    expect(ok).toBe(true);
    expect(proxyPost).toHaveBeenCalledWith('/projects/project-1/tasks/human', {
      tasks: [{ title: '来源核验', description: '读取来源', assignedAgent: 'xiaok-worker' }],
    });
  });
});
