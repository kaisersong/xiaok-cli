import { describe, expect, it } from 'vitest';

import {
  createKSwarmGetDynamicWorkflowStatusTool,
  REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE,
  createKSwarmRunDynamicWorkflowScriptTool,
} from '../../electron/kswarm-dynamic-workflow-script-tool.js';
import { createWorkflowScriptPreview } from '../../electron/workflow-script-contract.js';
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
      requests.push({
        path,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      const response = responses.shift();
      if (!response) throw new Error(`unexpected request: ${path}`);
      return response;
    },
  } as KSwarmService;
  return { service, requests };
}

const workflowScript = `export const meta = {
  name: 'project_snapshot_review',
  description: '检查项目当前状态并输出下一步建议',
  phases: [{ title: '检查项目' }, { title: '归纳建议' }],
}

phase('检查项目')
const snapshot = await agent('检查项目状态。', { label: '项目检查' })

phase('归纳建议')
return await agent(\`基于 \${snapshot.summary} 输出下一步建议。\`, { label: '建议归纳' })
`;

describe('KSwarm dynamic workflow script tool', () => {
  it('documents the executable script DSL in the tool schema for conversational agents', () => {
    const { service } = createMockService([]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    expect(tool.definition.description).toContain('await agent');
    expect(tool.definition.description).toContain("phase('");
    expect(tool.definition.description).toContain('previewOnly');
    expect(tool.definition.description).toContain('resumeWorkflowRunId');
    expect(tool.definition.description).toContain('报告三路并行复核');
    expect(tool.definition.description).toContain('不要使用 agents');
    expect(tool.definition.inputSchema.properties.script.description).toContain('export const meta');
    expect(tool.definition.inputSchema.properties.script.description).toContain('example');
  });

  it('ships a professional report final review workflow script template with real parallel branches', () => {
    const preview = createWorkflowScriptPreview(REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE, {
      projectId: 'proj-1',
      requestedBy: 'assistant',
    });

    expect(preview).toMatchObject({
      ok: true,
      workflowId: 'report_final_review',
      analysis: {
        parallelCallCount: 1,
        agentCallCount: 5,
      },
    });
    expect(REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE).toContain('事实复核');
    expect(REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE).toContain('证据复核');
    expect(REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE).toContain('格式与合同复核');
    expect(REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE).toContain('最终 gate 建议');
  });

  it('previews a generated workflow script without creating a KSwarm run for conversational confirmation', async () => {
    const { service, requests } = createMockService([]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      script: workflowScript,
      requestedBy: 'assistant',
      previewOnly: true,
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: true,
      projectId: 'proj-1',
      workflowId: 'project_snapshot_review',
      status: 'pending_confirmation',
      preview: {
        source: 'script_generated',
        strategy: 'workflow',
        title: '检查项目当前状态并输出下一步建议',
      },
    });
    expect(requests).toEqual([]);
  });

  it('runs a generated workflow script through KSwarm and completes the workflow run', async () => {
    const { service, requests } = createMockService([
      jsonResponse({ ok: true, workflowProposal: { id: 'proposal-1' } }, 201),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1' } }, 201),
      jsonResponse({ ok: true, nodeId: 'script-agent-1', workflowRun: { id: 'run-1' } }, 201),
      jsonResponse({ workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-1', status: 'completed', output: { summary: '项目可推进' } }] } }),
      jsonResponse({ ok: true, nodeId: 'script-agent-2', workflowRun: { id: 'run-1' } }, 201),
      jsonResponse({ workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-2', status: 'completed', output: { summary: '继续执行核心任务' } }] } }),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1', status: 'completed' } }, 200),
    ]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      script: workflowScript,
      requestedBy: 'assistant',
      assignedAgent: 'xiaok-worker',
      waitForCompletion: true,
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: true,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      status: 'completed',
      result: { summary: '继续执行核心任务' },
    });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/script-generated/proposal'],
      ['POST', '/projects/proj-1/workflows/script-generated/runs'],
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['POST', '/projects/proj-1/workflows/run-1/script/complete'],
    ]);
    expect(requests[0].body).toMatchObject({
      requestedBy: 'assistant',
      preview: {
        workflowId: 'project_snapshot_review',
        source: 'script_generated',
        projectId: 'proj-1',
      },
    });
    expect(requests[2].body).toMatchObject({
      phaseTitle: '检查项目',
      label: '项目检查',
      prompt: '检查项目状态。',
      assignedAgent: 'xiaok-worker',
    });
    expect(requests[4].body).toMatchObject({
      phaseTitle: '归纳建议',
      label: '建议归纳',
      prompt: '基于 项目可推进 输出下一步建议。',
      assignedAgent: 'xiaok-worker',
    });
  });

  it('starts a background script job and returns the workflow run id without waiting by default', async () => {
    const { service, requests } = createMockService([
      jsonResponse({ ok: true, workflowProposal: { id: 'proposal-1' } }, 201),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1', status: 'running' } }, 201),
    ]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      script: workflowScript,
      requestedBy: 'assistant',
      assignedAgent: 'xiaok-worker',
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: true,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      status: 'running',
      backgroundJob: {
        status: 'running',
      },
    });
    expect('result' in output).toBe(false);
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/projects/proj-1/workflows/script-generated/proposal'],
      ['POST', '/projects/proj-1/workflows/script-generated/runs'],
    ]);
  });

  it('resumes an existing workflow run without creating a duplicate proposal or rerunning completed agent nodes', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          status: 'running',
          workflowId: 'project_snapshot_review',
          nodes: [{
            id: 'script-agent-1',
            kind: 'agent_task',
            status: 'completed',
            input: {
              prompt: '检查项目状态。',
              label: '项目检查',
              options: { label: '项目检查' },
              script: { phaseTitle: '检查项目' },
            },
            output: { summary: '项目可推进' },
          }],
        },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          status: 'running',
          nodes: [{
            id: 'script-agent-1',
            kind: 'agent_task',
            status: 'completed',
            input: {
              prompt: '检查项目状态。',
              label: '项目检查',
              options: { label: '项目检查' },
              script: { phaseTitle: '检查项目' },
            },
            output: { summary: '项目可推进' },
          }],
        },
      }),
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          status: 'running',
          nodes: [{
            id: 'script-agent-1',
            kind: 'agent_task',
            status: 'completed',
            input: {
              prompt: '检查项目状态。',
              label: '项目检查',
              options: { label: '项目检查' },
              script: { phaseTitle: '检查项目' },
            },
            output: { summary: '项目可推进' },
          }],
        },
      }),
      jsonResponse({ ok: true, nodeId: 'script-agent-2', workflowRun: { id: 'run-1' } }, 201),
      jsonResponse({ workflowRun: { id: 'run-1', nodes: [{ id: 'script-agent-2', status: 'completed', output: { summary: '继续执行核心任务' } }] } }),
      jsonResponse({ ok: true, workflowRun: { id: 'run-1', status: 'completed' } }, 200),
    ]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      script: workflowScript,
      requestedBy: 'assistant',
      assignedAgent: 'xiaok-worker',
      waitForCompletion: true,
      resumeWorkflowRunId: 'run-1',
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: true,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      status: 'completed',
      result: { summary: '继续执行核心任务' },
    });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['POST', '/projects/proj-1/workflows/run-1/script/nodes'],
      ['GET', '/projects/proj-1/workflows/run-1'],
      ['POST', '/projects/proj-1/workflows/run-1/script/complete'],
    ]);
    expect(requests[3].body).toMatchObject({
      phaseTitle: '归纳建议',
      label: '建议归纳',
      prompt: '基于 项目可推进 输出下一步建议。',
    });
  });

  it('returns validation errors without calling KSwarm when the script is unsafe', async () => {
    const { service, requests } = createMockService([]);
    const tool = createKSwarmRunDynamicWorkflowScriptTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      script: `export const meta = { name: 'unsafe_demo', description: 'desc' }
process.env.OPENAI_API_KEY
await agent('x')`,
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: false,
      error: 'workflow_script_forbidden_api',
      usage: {
        requiredShape: expect.stringContaining('export const meta'),
        exampleScript: expect.stringContaining('await agent'),
      },
    });
    expect(requests).toEqual([]);
  });

  it('reports dynamic workflow status for conversational follow-up', async () => {
    const { service, requests } = createMockService([
      jsonResponse({
        workflowRun: {
          id: 'run-1',
          workflowId: 'report_final_review',
          source: 'script_generated',
          status: 'running',
          nodes: [
            { id: 'script-runtime', status: 'running', input: { label: '脚本运行时' } },
            { id: 'script-agent-1', status: 'completed', input: { label: '交付物盘点' } },
            { id: 'script-agent-2', status: 'running', assignedAgent: 'xiaok-worker', input: { label: '事实复核' }, parallelGroupId: 'script-parallel-1' },
          ],
          parallelGroups: [{
            id: 'script-parallel-1',
            label: '报告三路并行复核',
            status: 'waiting_for_children',
            completedCount: 1,
            failedCount: 0,
            totalCount: 3,
          }],
          scriptCheckpoints: [
            { id: 'script-checkpoint-1', status: 'completed' },
            { id: 'script-checkpoint-2', status: 'waiting' },
          ],
          gateDecision: { status: 'pending' },
        },
      }),
    ]);
    const tool = createKSwarmGetDynamicWorkflowStatusTool(service);

    const output = JSON.parse(await tool.execute({
      projectId: 'proj-1',
      workflowRunId: 'run-1',
    })) as Record<string, unknown>;

    expect(output).toMatchObject({
      ok: true,
      projectId: 'proj-1',
      workflowRunId: 'run-1',
      status: 'running',
      workflowId: 'report_final_review',
      summary: {
        nodes: { running: 2, completed: 1 },
        parallelGroups: { waiting_for_children: 1 },
        checkpoints: { completed: 1, waiting: 1 },
        nextAction: 'wait_for_active_nodes',
        activeNodes: [
          { id: 'script-runtime', status: 'running', label: '脚本运行时' },
          { id: 'script-agent-2', status: 'running', label: '事实复核', assignedAgent: 'xiaok-worker', parallelGroupId: 'script-parallel-1' },
        ],
        latestParallelGroups: [{
          id: 'script-parallel-1',
          label: '报告三路并行复核',
          status: 'waiting_for_children',
          completedCount: 1,
          failedCount: 0,
          totalCount: 3,
        }],
      },
      gateDecision: { status: 'pending' },
    });
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/projects/proj-1/workflows/run-1'],
    ]);
  });
});
