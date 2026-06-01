import { describe, expect, it } from 'vitest';

import {
  completeKSwarmScriptWorkflowRun,
  createKSwarmScriptWorkflowRun,
  createKSwarmWorkflowScriptController,
} from '../../electron/workflow-script-kswarm-controller.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createMockService(responses: Response[]): { service: KSwarmService; requests: Array<{ path: string; body: unknown; method: string }> } {
  const requests: Array<{ path: string; body: unknown; method: string }> = [];
  const service = {
    async request(path: string, init?: RequestInit): Promise<Response> {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ path, body, method: init?.method || 'GET' });
      const response = responses.shift();
      if (!response) throw new Error(`unexpected request: ${path}`);
      return response;
    },
  } as KSwarmService;
  return { service, requests };
}

describe('workflow script KSwarm controller', () => {
  it('creates, starts, and completes a script-generated workflow run through KSwarm HTTP', async () => {
    const { service, requests } = createMockService([
      jsonResponse({ ok: true, workflowProposal: { id: 'proposal-1' } }, 201),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1' } }, 201),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1', status: 'completed' } }, 200),
    ]);
    const preview = {
      ok: true,
      workflowId: 'report_review',
      source: 'script_generated',
      strategy: 'workflow',
      status: 'pending_confirmation',
      projectId: 'proj-1',
      scope: { projectId: 'proj-1' },
      requestedBy: 'human',
      createdAt: 1780000000000,
      title: '报告复核',
      description: '报告复核',
      meta: { name: 'report_review', description: '报告复核' },
      phases: [{ id: 'phase-1', title: '检查产物', detail: null }],
      scriptHash: 'a'.repeat(64),
      analysis: { agentCallCount: 1 },
    };

    const started = await createKSwarmScriptWorkflowRun({
      kswarmService: service,
      projectId: 'proj-1',
      preview,
      requestedBy: 'human',
    });
    const completed = await completeKSwarmScriptWorkflowRun({
      kswarmService: service,
      projectId: 'proj-1',
      workflowRunId: started.workflowRun.id,
      result: { summary: '完成' },
    });

    expect(started.workflowProposal).toEqual({ id: 'proposal-1' });
    expect(completed.workflowRun).toEqual({ id: 'run-1', status: 'completed' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/script-generated/proposal'],
      ['POST', '/projects/proj-1/workflows/script-generated/runs'],
      ['POST', '/projects/proj-1/workflows/run-1/script/complete'],
    ]);
    expect(requests[0].body).toMatchObject({ preview, requestedBy: 'human' });
    expect(requests[1].body).toMatchObject({ proposalId: 'proposal-1', approvedBy: 'human' });
    expect(requests[2].body).toEqual({ result: { summary: '完成' } });
  });

  it('maps agent calls to dynamic KSwarm nodes and returns the completed node output', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        ok: true,
        nodeId: 'script-agent-1',
        workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-1', status: 'running' }] },
      }, 201),
      jsonResponse({
        workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-1', status: 'running' }] },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          nodes: [{ id: 'script-agent-1', status: 'completed', output: { summary: '检查完成' } }],
        },
      }),
    ]);
    const controller = createKSwarmWorkflowScriptController({
      kswarmService: service,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      assignedAgent: 'xiaok-worker',
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    const result = await controller.createAgentNode({
      prompt: '检查报告产物。',
      label: '产物检查',
      phaseTitle: '检查产物',
      options: { model: 'default' },
      sequence: 1,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    });

    expect(result).toEqual({ summary: '检查完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
    expect(requests[0].body).toMatchObject({
      phaseTitle: '检查产物',
      label: '产物检查',
      prompt: '检查报告产物。',
      assignedAgent: 'xiaok-worker',
      options: { model: 'default' },
    });
  });
});
