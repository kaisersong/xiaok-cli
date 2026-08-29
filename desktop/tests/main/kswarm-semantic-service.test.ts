import { describe, expect, it, vi } from 'vitest';

import {
  createKSwarmSemanticService,
  createProjectCapabilityNeedsProposalPort,
} from '../../electron/kswarm-semantic-service.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('KSwarm semantic service', () => {
  it('parses a no-tool capability proposal and rejects non-JSON model output', async () => {
    const complete = vi.fn(async () => ({ text: JSON.stringify({ needs: [{ needKey: 'reviewer' }] }) }));
    const port = createProjectCapabilityNeedsProposalPort({ complete });

    await expect(port.propose({ project: { id: 'p1' }, agents: [], catalog: { definitions: [] }, tools: [] }))
      .resolves.toEqual({ needs: [{ needKey: 'reviewer' }] });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'fast', temperature: 0 }));

    const invalid = createProjectCapabilityNeedsProposalPort({ complete: async () => ({ text: 'not-json' }) });
    await expect(invalid.propose({ project: {}, agents: [], catalog: {}, tools: [] }))
      .rejects.toThrow('invalid_capability_proposal');
  });

  it('maps plan/apply/latest recovery to renderer semantic views with a stable request key', async () => {
    const teamService = {
      planProjectTeam: vi.fn(async () => ({
        ok: true,
        plan: {
          planDigest: 'digest-1', projectId: 'p1', projectRevision: 4, outcome: 'proposal',
          roles: [{ roleKey: 'reviewer', decision: 'create', requiredCapabilities: ['review'], reasonCode: 'capability_gap' }],
        },
      })),
      reconcileProjectTeam: vi.fn(async () => ({ ok: true, operation: { id: 'op1', status: 'applied' } })),
      recoverProjectTeamOperation: vi.fn(async () => ({ ok: true, operation: { id: 'op2', status: 'applying' } })),
      getLatestProjectTeamOperation: vi.fn(async () => ({ ok: true, operation: { id: 'op2', status: 'applying' } })),
    };
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/latest')) return jsonResponse({ ok: true, operation: { id: 'op2', status: 'applying' } });
      return jsonResponse({ ok: true });
    });
    const service = createKSwarmSemanticService({
      kswarmService: { request, getDesktopMutationToken: () => 'token' },
      teamService,
    });

    await expect(service.planProjectTeam({ projectId: 'p1' })).resolves.toEqual(expect.objectContaining({
      planId: 'digest-1', projectId: 'p1', projectRevision: 4, outcome: 'proposal',
      items: [expect.objectContaining({ action: 'create', role: 'reviewer', capabilityLabels: ['review'] })],
    }));
    await expect(service.applyProjectTeamPlan({ projectId: 'p1', planId: 'digest-1', projectRevision: 4 }))
      .resolves.toEqual({ operationId: 'op1', status: 'completed' });
    expect(teamService.reconcileProjectTeam).toHaveBeenCalledWith({
      projectId: 'p1', planDigest: 'digest-1', expectedProjectRevision: 4,
      clientRequestKey: 'desktop-team:p1:digest-1',
    });
    await expect(service.getProjectTeamOperation({ projectId: 'p1' }))
      .resolves.toEqual({ operationId: 'op2', status: 'running' });
    expect(teamService.recoverProjectTeamOperation).toHaveBeenCalledWith({ projectId: 'p1', operationId: 'op2' });
  });

  it('keeps credentials in main and rejects secret-bearing semantic agent payloads', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-kswarm-mutation-token': 'token' });
      return jsonResponse({ ok: true, agent: { id: 'a1', name: 'Writer' } }, 201);
    });
    const service = createKSwarmSemanticService({
      kswarmService: { request, getDesktopMutationToken: () => 'token' },
      teamService: {} as never,
    });

    await expect(service.createKSwarmAgent({ name: 'Writer', description: 'Draft', instructions: 'Write', runtimeType: 'kimi' }))
      .resolves.toEqual({ id: 'a1', name: 'Writer' });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      name: 'Writer', description: 'Draft', instructions: 'Write', runtimeType: 'kimi', roles: ['worker'], capabilities: [], taskCapabilities: [],
    });
    await expect(service.createKSwarmAgent({ name: 'Writer', apiKey: 'secret' } as never))
      .rejects.toThrow('agent_payload_forbidden');
    await expect(service.createKSwarmAgent({ name: 'Writer', runtimePath: '/tmp/evil' } as never))
      .rejects.toThrow('agent_payload_forbidden');
    await expect(service.updateKSwarmAgent({ id: 'a1', changes: { fallbackToDesktopModel: true } }))
      .resolves.toEqual({ id: 'a1', name: 'Writer' });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ fallbackToDesktopModel: true });
  });

  it('routes project execution mode and delete through main-owned credentials', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-kswarm-mutation-token': 'token' });
      if (path.endsWith('/execution-mode')) return jsonResponse({ ok: true, project: { id: 'p1', executionMode: 'direct' } });
      return jsonResponse({ ok: true });
    });
    const service = createKSwarmSemanticService({
      kswarmService: { request, getDesktopMutationToken: () => 'token' }, teamService: {} as never,
    });

    await expect(service.updateKSwarmProjectExecutionMode({ projectId: 'p1', executionMode: 'direct' }))
      .resolves.toEqual({ ok: true, project: { id: 'p1', executionMode: 'direct' } });
    await expect(service.deleteKSwarmProject({ projectId: 'p1' })).resolves.toEqual({ ok: true });
    expect(request.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      ['/projects/p1/execution-mode', 'PATCH'],
      ['/projects/p1', 'DELETE'],
    ]);
  });
});
