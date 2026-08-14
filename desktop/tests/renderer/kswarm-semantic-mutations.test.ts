import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';

describe('useKSwarmClient semantic mutations', () => {
  const semantic = {
    createKSwarmAgent: vi.fn(),
    updateKSwarmAgent: vi.fn(),
    archiveKSwarmAgent: vi.fn(),
    startKSwarmAgent: vi.fn(),
    stopKSwarmAgent: vi.fn(),
    probeKSwarmAgent: vi.fn(),
    updateKSwarmProjectExecutionMode: vi.fn(),
    deleteKSwarmProject: vi.fn(),
    planProjectTeam: vi.fn(),
    applyProjectTeamPlan: vi.fn(),
    getProjectTeamOperation: vi.fn(),
  };
  const proxyPost = vi.fn();
  const proxyPut = vi.fn();
  const proxyDelete = vi.fn();

  beforeEach(() => {
    for (const mock of Object.values(semantic)) mock.mockReset();
    proxyPost.mockReset();
    proxyPut.mockReset();
    proxyDelete.mockReset();
    semantic.createKSwarmAgent.mockResolvedValue({ id: 'agent-1', name: 'Agent', status: 'idle' });
    semantic.updateKSwarmAgent.mockResolvedValue({ id: 'agent-1', name: 'Updated', status: 'idle' });
    semantic.archiveKSwarmAgent.mockResolvedValue({ ok: true });
    semantic.startKSwarmAgent.mockResolvedValue({ ok: true });
    semantic.stopKSwarmAgent.mockResolvedValue({ ok: true });
    semantic.probeKSwarmAgent.mockResolvedValue({ ok: true, status: 'ready' });
    semantic.updateKSwarmProjectExecutionMode.mockResolvedValue({ ok: true, project: { id: 'project-1', status: 'active', executionMode: 'auto' } });
    semantic.deleteKSwarmProject.mockResolvedValue({ ok: true });
    semantic.planProjectTeam.mockResolvedValue({ planId: 'plan-1', projectId: 'project-1', projectRevision: 2, outcome: 'no_change', summary: 'ready', items: [] });
    semantic.applyProjectTeamPlan.mockResolvedValue({ operationId: 'operation-1', status: 'completed' });
    semantic.getProjectTeamOperation.mockResolvedValue(null);
    (globalThis as any).window.xiaokDesktop = {
      ...semantic,
      kswarmProxyGet: vi.fn(async (path: string) => {
        if (path === '/projects') return { projects: [] };
        if (path === '/agents') return { agents: [] };
        if (path === '/participants') return { participants: [] };
        return null;
      }),
      kswarmProxyPost: proxyPost,
      kswarmProxyPut: proxyPut,
      kswarmProxyDelete: proxyDelete,
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

  it('uses semantic agent CRUD instead of generic proxy writes', async () => {
    const { result } = renderHook(() => useKSwarmClient());
    await act(async () => {
      await result.current.createAgent({ name: 'Agent', provider: 'openai', apiKey: 'secret' });
      await result.current.updateAgent('agent-1', { name: 'Updated', model: 'hidden' });
      await result.current.archiveAgent('agent-1');
      await result.current.startAgent('agent-1');
      await result.current.stopAgent('agent-1');
      await result.current.probeAgent('agent-1');
    });

    expect(semantic.createKSwarmAgent).toHaveBeenCalledWith({ name: 'Agent' });
    expect(semantic.updateKSwarmAgent).toHaveBeenCalledWith({ agentId: 'agent-1', patch: { name: 'Updated' } });
    expect(semantic.archiveKSwarmAgent).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(semantic.startKSwarmAgent).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(semantic.stopKSwarmAgent).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(semantic.probeKSwarmAgent).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(proxyPost).not.toHaveBeenCalledWith('/agents', expect.anything());
    expect(proxyPut).not.toHaveBeenCalled();
    expect(proxyDelete).not.toHaveBeenCalledWith('/agents/agent-1');
  });

  it('uses semantic project lifecycle mutations instead of denied generic proxy paths', async () => {
    const { result } = renderHook(() => useKSwarmClient());
    await act(async () => {
      await result.current.updateProjectExecutionMode('project-1', 'auto');
      await result.current.deleteProject('project-1');
    });

    expect(semantic.updateKSwarmProjectExecutionMode).toHaveBeenCalledWith({ projectId: 'project-1', executionMode: 'auto' });
    expect(semantic.deleteKSwarmProject).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(proxyDelete).not.toHaveBeenCalledWith('/projects/project-1');
  });

  it('exposes the smart-team client contract through semantic APIs', async () => {
    const { result } = renderHook(() => useKSwarmClient());
    await act(async () => {
      await result.current.planProjectTeam({ projectId: 'project-1' });
      await result.current.applyProjectTeamPlan({ projectId: 'project-1', planId: 'plan-1', projectRevision: 2 });
      await result.current.getProjectTeamOperation({ projectId: 'project-1' });
    });

    expect(semantic.planProjectTeam).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(semantic.applyProjectTeamPlan).toHaveBeenCalledWith({ projectId: 'project-1', planId: 'plan-1', projectRevision: 2 });
    expect(semantic.getProjectTeamOperation).toHaveBeenCalledWith({ projectId: 'project-1' });
  });
});
