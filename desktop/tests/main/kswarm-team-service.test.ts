import { describe, expect, it, vi } from 'vitest';

import {
  createKSwarmTeamService,
  type ProjectCapabilityNeedsProposalPort,
} from '../../electron/kswarm-team-service.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('kswarm team service', () => {
  it('uses a no-tool proposal port and sends only validated capability needs to KSwarm', async () => {
    const propose = vi.fn<ProjectCapabilityNeedsProposalPort['propose']>(async (input) => {
      expect(input.tools).toEqual([]);
      expect(input.project).toMatchObject({ id: 'project-1', projectRevision: 7 });
      expect(input.catalog.catalogVersion).toBe('catalog-v1');
      return {
        needs: [{
          needKey: 'reviewer',
          requiredCapabilities: ['review'],
          responsibilities: ['independent review'],
          requiresIndependentReviewer: true,
        }],
      };
    });
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/agents/capability-catalog') {
        return jsonResponse({
          schemaVersion: 1,
          catalogVersion: 'catalog-v1',
          definitions: [{ key: 'review' }],
        });
      }
      if (path === '/projects/project-1') {
        return jsonResponse({ id: 'project-1', projectRevision: 7, goal: 'Ship safely' });
      }
      if (path === '/agents') {
        return jsonResponse({ agents: [{ id: 'xiaok-worker', capabilities: ['writing'] }] });
      }
      if (path === '/projects/project-1/team/plan') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          'x-kswarm-mutation-token': 'desktop-token',
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          requestSource: 'user',
          expectedProjectRevision: 7,
          catalogVersion: 'catalog-v1',
          needs: [{
            needKey: 'reviewer',
            requiredCapabilities: ['review'],
            responsibilities: ['independent review'],
            requiresIndependentReviewer: true,
          }],
        });
        return jsonResponse({ ok: true, plan: { planDigest: 'plan-1' } });
      }
      return jsonResponse({ error: 'unexpected_path' }, 404);
    });
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: { propose },
    });

    await expect(service.planProjectTeam({ projectId: 'project-1' })).resolves.toEqual({
      ok: true,
      plan: { planDigest: 'plan-1' },
    });
    expect(propose).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/agents/capability-catalog',
      '/projects/project-1',
      '/agents',
      '/projects/project-1/team/plan',
    ]);
  });

  it('fails closed before mutation when the proposal contains unknown or duplicate capabilities', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/agents/capability-catalog') {
        return jsonResponse({
          schemaVersion: 1,
          catalogVersion: 'catalog-v1',
          definitions: [{ key: 'research' }],
        });
      }
      if (path === '/projects/project-1') {
        return jsonResponse({ id: 'project-1', projectRevision: 2 });
      }
      if (path === '/agents') return jsonResponse({ agents: [] });
      return jsonResponse({ ok: true });
    });
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: {
        propose: vi.fn(async () => ({
          needs: [
            { needKey: 'same', requiredCapabilities: ['unknown'], responsibilities: [] },
            { needKey: 'same', requiredCapabilities: ['research'], responsibilities: [] },
          ],
        })),
      },
    });

    await expect(service.planProjectTeam({ projectId: 'project-1' }))
      .rejects.toThrow('invalid_capability_needs');
    expect(request).not.toHaveBeenCalledWith('/projects/project-1/team/plan', expect.anything());
  });

  it('rejects an empty needs proposal instead of treating missing analysis as no-change', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/agents/capability-catalog') {
        return jsonResponse({ schemaVersion: 1, catalogVersion: 'catalog-v1', definitions: [{ key: 'research' }] });
      }
      if (path === '/projects/project-1') return jsonResponse({ id: 'project-1', projectRevision: 2 });
      if (path === '/agents') return jsonResponse({ agents: [] });
      return jsonResponse({ ok: true });
    });
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: { propose: vi.fn(async () => ({ needs: [] })) },
    });

    await expect(service.planProjectTeam({ projectId: 'project-1' }))
      .rejects.toThrow('invalid_capability_needs');
    expect(request).not.toHaveBeenCalledWith('/projects/project-1/team/plan', expect.anything());
  });

  it('reconciles with user authority and recovers an applying operation by replaying its stable request', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/projects/project-1/team/operations/operation-1') {
        return jsonResponse({
          ok: true,
          operation: {
            id: 'operation-1',
            projectId: 'project-1',
            status: 'applying',
            planDigest: 'plan-1',
            expectedProjectRevision: 4,
            clientRequestKey: 'request-1',
          },
        });
      }
      if (path === '/projects/project-1/team/reconcile') {
        expect(init?.headers).toMatchObject({ 'x-kswarm-mutation-token': 'desktop-token' });
        expect(JSON.parse(String(init?.body))).toEqual({
          requestSource: 'user',
          planDigest: 'plan-1',
          expectedProjectRevision: 4,
          clientRequestKey: 'request-1',
        });
        return jsonResponse({ ok: true, operation: { id: 'operation-1', status: 'applied' } });
      }
      return jsonResponse({ error: 'unexpected_path' }, 404);
    });
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: { propose: vi.fn() },
    });

    await expect(service.recoverProjectTeamOperation({
      projectId: 'project-1',
      operationId: 'operation-1',
    })).resolves.toEqual({ ok: true, operation: { id: 'operation-1', status: 'applied' } });
  });

  it('returns an already terminal operation without replaying reconcile', async () => {
    const request = vi.fn(async () => jsonResponse({
      ok: true,
      operation: { id: 'operation-1', projectId: 'project-1', status: 'applied' },
    }));
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: { propose: vi.fn() },
    });

    await expect(service.recoverProjectTeamOperation({
      projectId: 'project-1',
      operationId: 'operation-1',
    })).resolves.toEqual({
      ok: true,
      operation: { id: 'operation-1', projectId: 'project-1', status: 'applied' },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('loads the latest durable project operation for renderer restart recovery', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/projects/project-1/team/operations/latest');
      return jsonResponse({ ok: true, operation: { id: 'operation-2', status: 'applied' } });
    });
    const service = createKSwarmTeamService({
      kswarmService: { request, getDesktopMutationToken: () => 'desktop-token' },
      needsProposal: { propose: vi.fn() },
    });

    await expect(service.getLatestProjectTeamOperation({ projectId: 'project-1' })).resolves.toEqual({
      ok: true,
      operation: { id: 'operation-2', status: 'applied' },
    });
  });
});
