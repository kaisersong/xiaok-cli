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
    expect(requests[2].body).toEqual({ result: { summary: '完成' }, terminal: null });
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
      role: 'collector',
      trustLevel: 'untrusted',
      inputRefs: ['project.snapshot'],
      sourceRefs: ['ticket:1'],
      permissions: { toolCategories: ['read_project_state'] },
      stableKey: 'ticket-1',
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
      role: 'collector',
      trustLevel: 'untrusted',
      inputRefs: ['project.snapshot'],
      sourceRefs: ['ticket:1'],
      permissions: { toolCategories: ['read_project_state'] },
      stableKey: 'ticket-1',
    });
  });

  it('creates KSwarm parallel groups and attaches branch metadata to dynamic nodes', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        ok: true,
        parallelGroup: { id: 'script-parallel-1' },
        workflowRun: { id: 'run-1', parallelGroups: [{ id: 'script-parallel-1' }] },
      }, 201),
      jsonResponse({
        ok: true,
        nodeId: 'script-agent-1',
        workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-1', status: 'running' }] },
      }, 201),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          nodes: [{ id: 'script-agent-1', status: 'completed', output: { summary: '事实复核完成' } }],
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

    const group = await controller.beginParallelGroup?.({
      label: '两路复核',
      phaseTitle: '交叉复核',
      primitiveId: 'parallel-1',
      kind: 'parallel',
      totalCount: 2,
      limit: 2,
      failurePolicy: 'required_all',
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    });
    const result = await controller.createAgentNode({
      prompt: '事实复核',
      label: '事实复核',
      phaseTitle: '交叉复核',
      options: null,
      sequence: 1,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
      parallelGroupId: group?.parallelGroupId || null,
      fanoutItemKey: 'branch-1',
      fanoutItemLabel: '事实复核',
      required: true,
      outputSchema: { type: 'object' },
      evidenceRequired: true,
    });

    expect(group).toEqual({ parallelGroupId: 'script-parallel-1' });
    expect(result).toEqual({ summary: '事实复核完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/run-1/script/parallel-groups'],
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes'],
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
    expect(requests[0].body).toMatchObject({
      label: '两路复核',
      phaseTitle: '交叉复核',
      primitiveId: 'parallel-1',
      totalCount: 2,
      limit: 2,
      failurePolicy: 'required_all',
    });
    expect(requests[1].body).toMatchObject({
      parallelGroupId: 'script-parallel-1',
      fanoutItemKey: 'branch-1',
      fanoutItemLabel: '事实复核',
      required: true,
      outputSchema: { type: 'object' },
      evidenceRequired: true,
    });
  });

  it('reuses completed primitive state when resuming the same workflow run', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [{
            id: 'script-parallel-1',
            primitiveId: 'parallel-1',
            kind: 'parallel',
            label: '两路复核',
            totalCount: 2,
            status: 'completed',
          }],
          nodes: [],
        },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [],
          nodes: [{
            id: 'script-agent-1',
            kind: 'agent_task',
            status: 'completed',
            parallelGroupId: 'script-parallel-1',
            fanoutItemKey: 'branch-1',
            fanoutItemLabel: '事实复核',
            pipelineStageIndex: null,
            input: {
              prompt: '事实复核',
              label: '事实复核',
              options: { b: 2, a: 1 },
              script: { phaseTitle: '交叉复核' },
            },
            output: { summary: '事实复核已完成' },
          }],
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
      reuseCompletedPrimitives: true,
    });

    const group = await controller.beginParallelGroup?.({
      label: '两路复核',
      phaseTitle: '交叉复核',
      primitiveId: 'parallel-1',
      kind: 'parallel',
      totalCount: 2,
      limit: 2,
      failurePolicy: 'required_all',
      quorum: null,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    });
    const result = await controller.createAgentNode({
      prompt: '事实复核',
      label: '事实复核',
      phaseTitle: '交叉复核',
      options: { a: 1, b: 2 },
      sequence: 1,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
      parallelGroupId: group?.parallelGroupId || null,
      fanoutItemKey: 'branch-1',
      fanoutItemLabel: '事实复核',
      required: true,
      outputSchema: null,
      evidenceRequired: true,
    });

    expect(group).toEqual({ parallelGroupId: 'script-parallel-1' });
    expect(result).toEqual({ summary: '事实复核已完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
  });

  it('uses budget, evidence, intervention, and branch action KSwarm APIs', async () => {
    const { service, requests } = createMockService([
      jsonResponse({ ok: true, reserved: true, attemptId: 'node-run-1-1-attempt-1' }, 200),
      jsonResponse({ ok: true, budget: { total: 100, reserved: 20, consumed: 0, overrun: 0, remaining: 80 } }, 200),
      jsonResponse({ ok: true }, 202),
      jsonResponse({ ok: true }, 202),
      jsonResponse({ ok: true, verdict: { ok: false, failures: ['missing summary'], warnings: [] } }, 200),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1' } }, 200),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1' } }, 200),
    ]);
    const controller = createKSwarmWorkflowScriptController({
      kswarmService: service,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
    });

    await expect(controller.reserveBudget({ runId: 'run-1', nodeId: 'node-run-1-1', tokens: 20 })).resolves.toEqual({
      reserved: true,
      attemptId: 'node-run-1-1-attempt-1',
    });
    await expect(controller.checkRemainingBudget('run-1')).resolves.toBe(80);
    await controller.consumeBudget({
      runId: 'run-1',
      nodeId: 'node-run-1-1',
      attemptId: 'node-run-1-1-attempt-1',
      reserved: 20,
      actual: 17,
      usageSource: 'provider',
    });
    await controller.releaseBudget({
      runId: 'run-1',
      nodeId: 'node-run-1-2',
      attemptId: 'node-run-1-2-attempt-1',
      tokens: 20,
    });
    await expect(controller.verifyEvidence({
      runId: 'run-1',
      nodeId: 'node-run-1-1',
      result: { text: 'bad' },
      workspaceRoot: '/tmp/work',
      checks: [{ kind: 'output_schema', requiredKeys: ['summary'] }],
    })).resolves.toEqual({ ok: false, failures: ['missing summary'], warnings: [] });
    await controller.markNodeIntervention({ runId: 'run-1', nodeId: 'node-run-1-1', failures: ['missing summary'] });
    await controller.markBranchSkipped({ runId: 'run-1', nodeId: 'node-run-1-2', label: '分支 2' });

    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/run-1/budget/reserve'],
      ['GET', '/projects/proj-1/workflows/run-1/budget/remaining'],
      ['POST', '/projects/proj-1/workflows/run-1/budget/events'],
      ['POST', '/projects/proj-1/workflows/run-1/budget/events'],
      ['POST', '/projects/proj-1/workflows/run-1/nodes/node-run-1-1/verify-evidence'],
      ['POST', '/projects/proj-1/workflows/run-1/nodes/node-run-1-1/action'],
      ['POST', '/projects/proj-1/workflows/run-1/nodes/node-run-1-2/action'],
    ]);
    expect(requests[2].body).toEqual({
      type: 'budget_consumed',
      nodeId: 'node-run-1-1',
      attemptId: 'node-run-1-1-attempt-1',
      reserved: 20,
      actual: 17,
      usageSource: 'provider',
    });
    expect(requests[6].body).toEqual({ action: 'skip', label: '分支 2', reason: 'budget_skipped' });
  });

  it('reuses completed stable node results through the node result API and treats null phaseTitle as wildcard', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        ok: true,
        node: {
          id: 'node-run-1-1',
          kind: 'agent_task',
          status: 'completed',
          result: { summary: 'cached' },
          input: {
            prompt: '扫描',
            label: '扫描',
            options: null,
            script: { phaseTitle: '任意阶段' },
          },
        },
      }),
    ]);
    const controller = createKSwarmWorkflowScriptController({
      kswarmService: service,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      reuseCompletedPrimitives: true,
    });

    const result = await controller.createAgentNode({
      nodeId: 'node-run-1-1',
      attemptId: 'node-run-1-1-attempt-1',
      prompt: '扫描',
      label: '扫描',
      phaseTitle: null,
      options: null,
      sequence: 1,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    } as any);

    expect(result).toEqual({ summary: 'cached' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1/nodes/node-run-1-1'],
    ]);
  });

  it('reuses completed parallel groups whose durable total count includes retry nodes', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [{
            id: 'script-parallel-1',
            primitiveId: 'parallel-1',
            kind: 'parallel',
            label: '两路复核',
            totalCount: 4,
            status: 'completed',
          }],
          nodes: [],
        },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [],
          nodes: [{
            id: 'script-agent-1',
            kind: 'agent_task',
            status: 'completed',
            parallelGroupId: 'script-parallel-1',
            fanoutItemKey: 'branch-1',
            fanoutItemLabel: '事实复核',
            pipelineStageIndex: null,
            input: {
              prompt: '事实复核',
              label: '事实复核',
              options: null,
              script: { phaseTitle: '交叉复核' },
            },
            output: { summary: '事实复核已完成' },
          }],
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
      reuseCompletedPrimitives: true,
    });

    const group = await controller.beginParallelGroup?.({
      label: '两路复核',
      phaseTitle: '交叉复核',
      primitiveId: 'parallel-1',
      kind: 'parallel',
      totalCount: 2,
      limit: 2,
      failurePolicy: 'required_all',
      quorum: null,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    });
    const result = await controller.createAgentNode({
      prompt: '事实复核',
      label: '事实复核',
      phaseTitle: '交叉复核',
      options: null,
      sequence: 1,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
      parallelGroupId: group?.parallelGroupId || null,
      fanoutItemKey: 'branch-1',
      fanoutItemLabel: '事实复核',
      required: true,
      outputSchema: null,
      evidenceRequired: true,
    });

    expect(group).toEqual({ parallelGroupId: 'script-parallel-1' });
    expect(result).toEqual({ summary: '事实复核已完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
  });

  it('reuses completed sequential script agent nodes persisted with default pipeline stage zero', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          nodes: [{
            id: 'script-agent-11',
            kind: 'agent_task',
            status: 'completed',
            parallelGroupId: null,
            fanoutItemKey: '',
            fanoutItemLabel: '',
            pipelineStageIndex: 0,
            input: {
              prompt: '综合分析',
              label: '综合分析与趋势提炼',
              options: { label: '综合分析与趋势提炼', evidenceRequired: true },
              script: { phaseTitle: '综合分析趋势提炼' },
            },
            output: { summary: '综合分析已完成' },
          }],
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
      reuseCompletedPrimitives: true,
    });

    const result = await controller.createAgentNode({
      prompt: '综合分析',
      label: '综合分析与趋势提炼',
      phaseTitle: '综合分析趋势提炼',
      options: { label: '综合分析与趋势提炼', evidenceRequired: true },
      sequence: 5,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
      parallelGroupId: null,
      fanoutItemKey: null,
      fanoutItemLabel: null,
      required: true,
      outputSchema: null,
      evidenceRequired: true,
    });

    expect(result).toEqual({ summary: '综合分析已完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
  });

  it('reuses failed parallel group state and retries a blocked matching script node during resume', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [{
            id: 'script-parallel-1',
            primitiveId: 'parallel-1',
            kind: 'parallel',
            label: '两路复核',
            totalCount: 2,
            status: 'failed',
          }],
          nodes: [],
        },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          parallelGroups: [],
          nodes: [{
            id: 'script-agent-2',
            kind: 'agent_task',
            status: 'blocked',
            parallelGroupId: 'script-parallel-1',
            fanoutItemKey: 'branch-2',
            fanoutItemLabel: '证据复核',
            // KSwarm persisted old parallel branch nodes with 0 here even
            // though runtime resume passes null for non-pipeline branches.
            pipelineStageIndex: 0,
            input: {
              prompt: '证据复核',
              label: '证据复核',
              options: { label: '证据复核', evidenceRequired: true },
              script: { phaseTitle: '交叉复核' },
            },
            output: null,
          }],
        },
      }),
      jsonResponse({
        ok: true,
        nodeId: 'script-agent-2',
        workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-2', status: 'running' }] },
        dispatches: [{ nodeId: 'script-agent-2', attempt: 2 }],
      }, 200),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          nodes: [{ id: 'script-agent-2', status: 'completed', output: { summary: '证据复核已完成' } }],
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
      reuseCompletedPrimitives: true,
    });

    const group = await controller.beginParallelGroup?.({
      label: '两路复核',
      phaseTitle: '交叉复核',
      primitiveId: 'parallel-1',
      kind: 'parallel',
      totalCount: 2,
      limit: 2,
      failurePolicy: 'required_all',
      quorum: null,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
    });
    const result = await controller.createAgentNode({
      prompt: '证据复核',
      label: '证据复核',
      phaseTitle: '交叉复核',
      options: { label: '证据复核', evidenceRequired: true },
      sequence: 2,
      scriptHash: 'a'.repeat(64),
      workflowId: 'report_review',
      parallelGroupId: group?.parallelGroupId || null,
      fanoutItemKey: 'branch-2',
      fanoutItemLabel: '证据复核',
      required: true,
      outputSchema: null,
      evidenceRequired: true,
    });

    expect(group).toEqual({ parallelGroupId: 'script-parallel-1' });
    expect(result).toEqual({ summary: '证据复核已完成' });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes/script-agent-2/retry'],
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
  });
});
