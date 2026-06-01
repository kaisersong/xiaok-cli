import { describe, expect, it } from 'vitest';

import { createKSwarmRunDynamicWorkflowScriptTool } from '../../electron/kswarm-dynamic-workflow-script-tool.js';
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
    expect(tool.definition.description).toContain('不要使用 agents');
    expect(tool.definition.inputSchema.properties.script.description).toContain('export const meta');
    expect(tool.definition.inputSchema.properties.script.description).toContain('example');
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
});
