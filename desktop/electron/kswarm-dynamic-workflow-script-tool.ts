import type { Tool } from '../../src/types.js';
import type { KSwarmService } from './kswarm-service.js';
import { createWorkflowScriptPreview } from './workflow-script-contract.js';
import {
  completeKSwarmScriptWorkflowRun,
  createKSwarmScriptWorkflowRun,
  createKSwarmWorkflowScriptController,
} from './workflow-script-kswarm-controller.js';
import { runWorkflowScript } from './workflow-script-runtime.js';

const WORKFLOW_SCRIPT_EXAMPLE = `export const meta = {
  name: 'project_snapshot_review',
  description: '检查项目状态并输出下一步建议',
  phases: [{ title: '检查项目' }, { title: '归纳建议' }],
}

phase('检查项目')
const snapshot = await agent('检查项目状态。', { label: '项目检查' })

phase('归纳建议')
return await agent(\`基于 \${snapshot.summary} 输出下一步建议。\`, { label: '建议归纳' })
`;

function workflowScriptUsage() {
  return {
    requiredShape: '脚本必须以 export const meta = {...} 开头；meta.name 只能使用小写字母、数字和下划线；meta.description 必填；真正执行写在 meta 之后。',
    primitives: [
      "phase('阶段名') 用于记录当前阶段。",
      "await agent('任务提示', { label: '节点名称' }) 用于创建并等待一个 KSwarm agent 节点。",
      'await parallel([() => agent(...), () => agent(...)]) 用于并行 fan-out。',
      'return 一个 JSON 可序列化对象作为 workflow 结果。',
    ],
    forbiddenShape: '不要使用 agents、nodes、steps、tasks 等声明式 schema；不要把 phase 写成对象执行。phase 是函数调用，agent 也是函数调用。',
    exampleScript: WORKFLOW_SCRIPT_EXAMPLE,
  };
}

function validationFailure(payload: Record<string, unknown>): string {
  return JSON.stringify({
    ok: false,
    ...payload,
    usage: workflowScriptUsage(),
  });
}

export function createKSwarmRunDynamicWorkflowScriptTool(kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'run_dynamic_workflow_script',
      description: [
        '为一个 KSwarm 项目运行动态 workflow 脚本。适用于用户要求通过对话创建并启动 workflow，而不是只做普通 direct/swarm 执行。',
        '脚本是命令式 JavaScript DSL，不是 JSON schema。不要使用 agents/nodes/steps/tasks 声明式字段。',
        "必须以 export const meta = {...} 开头；然后用 phase('阶段名')、await agent('任务提示', { label: '节点名' })、parallel/pipeline 编排。",
        `最小可用 example:\n${WORKFLOW_SCRIPT_EXAMPLE}`,
      ].join('\n\n'),
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID，例如 proj-1779090338840' },
          projectName: { type: 'string', description: '没有 projectId 时用项目名称匹配' },
          script: {
            type: 'string',
            description: [
              '动态 workflow JavaScript 脚本。必须以 export const meta = {...} 开头，meta.name 使用 snake_case 小写标识符，meta.description 必填。',
              "meta 后面直接写命令式执行逻辑：phase('阶段名'); const r = await agent('任务提示', { label: '节点名称' }); return {...}。",
              '不要提交 agents/nodes/steps/tasks 声明式 schema。',
              `example:\n${WORKFLOW_SCRIPT_EXAMPLE}`,
            ].join('\n'),
          },
          requestedBy: { type: 'string', description: '发起者，默认 assistant' },
          assignedAgent: { type: 'string', description: '动态 agent 节点默认派发给哪个 KSwarm agent，默认由 KSwarm 选择' },
        },
        required: ['script'],
      },
    },
    async execute(input) {
      const script = typeof input.script === 'string' ? input.script : '';
      const requestedBy = typeof input.requestedBy === 'string' && input.requestedBy.trim() ? input.requestedBy.trim() : 'assistant';
      const assignedAgent = typeof input.assignedAgent === 'string' && input.assignedAgent.trim() ? input.assignedAgent.trim() : null;

      try {
        const projectId = await resolveProjectId(kswarmService, input);
        if (!projectId) return validationFailure({ error: 'projectId_or_projectName_required' });

        const preview = createWorkflowScriptPreview(script, {
          projectId,
          requestedBy,
        });
        if (!preview.ok) return validationFailure(preview);

        const started = await createKSwarmScriptWorkflowRun({
          kswarmService,
          projectId,
          preview,
          requestedBy,
        });
        const workflowRunId = readString(started.workflowRun.id);
        const controller = createKSwarmWorkflowScriptController({
          kswarmService,
          projectId,
          workflowRunId,
          assignedAgent,
        });
        const run = await runWorkflowScript(script, { controller });
        const completed = await completeKSwarmScriptWorkflowRun({
          kswarmService,
          projectId,
          workflowRunId,
          result: run.result,
        });

        return JSON.stringify({
          ok: true,
          projectId,
          workflowRunId,
          workflowId: run.meta.name,
          scriptHash: run.scriptHash,
          status: readString(completed.workflowRun.status) || 'completed',
          result: run.result,
          workflowRun: completed.workflowRun,
        });
      } catch (error) {
        return validationFailure({
          error: readErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

async function resolveProjectId(kswarmService: KSwarmService, input: Record<string, unknown>): Promise<string | null> {
  const projectId = typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : '';
  if (projectId) return projectId;
  const projectName = typeof input.projectName === 'string' && input.projectName.trim() ? input.projectName.trim() : '';
  if (!projectName) return null;

  const response = await kswarmService.request('/projects');
  const payload = await response.json().catch(() => ({})) as { projects?: unknown[] };
  if (!response.ok || !Array.isArray(payload.projects)) return null;
  const normalized = normalizeName(projectName);
  const projects = payload.projects.filter(isRecord);
  const exact = projects.find(project => normalizeName(project.name) === normalized);
  const fuzzy = exact || projects.find(project => normalizeName(project.name).includes(normalized));
  return readString(fuzzy?.id) || null;
}

function normalizeName(value: unknown): string {
  return readString(value).toLowerCase().replace(/\s+/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readErrorCode(error: unknown): string {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
    ? String((error as Error & { code: string }).code)
    : 'workflow_script_run_failed';
}
