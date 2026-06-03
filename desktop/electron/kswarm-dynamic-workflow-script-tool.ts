import type { Tool } from '../../src/types.js';
import type { KSwarmService } from './kswarm-service.js';
import { createWorkflowScriptPreview, hashWorkflowScript, normalizeWorkflowScript } from './workflow-script-contract.js';
import {
  completeKSwarmScriptWorkflowRun,
  createKSwarmScriptWorkflowRun,
  createKSwarmWorkflowScriptController,
} from './workflow-script-kswarm-controller.js';
import { runWorkflowScript } from './workflow-script-runtime.js';

type WorkflowScriptBackgroundJobStatus = 'running' | 'completed' | 'failed';

interface WorkflowScriptBackgroundJob {
  id: string;
  projectId: string;
  workflowRunId: string;
  workflowId: string;
  scriptHash: string;
  status: WorkflowScriptBackgroundJobStatus;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

const backgroundJobs = new Map<string, WorkflowScriptBackgroundJob>();
const DEFAULT_DESKTOP_WORKFLOW_AGENT_ID = 'xiaok-worker';

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

export const REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE = `export const meta = {
  name: 'report_final_review',
  description: '并行复核报告事实、证据、格式和交付要求，并输出最终 gate 建议',
  phases: [{ title: '读取交付物' }, { title: '并行复核' }, { title: '归约结论' }],
}

phase('读取交付物')
const inventory = await agent('读取报告、产物清单和用户要求，列出需要复核的事实、证据、格式和交付合同。', { label: '交付物盘点', evidenceRequired: true })

phase('并行复核')
const reviews = await parallel([
  () => agent(\`基于 \${inventory.summary} 做事实准确性复核，指出事实风险和证据缺口。\`, { label: '事实复核', evidenceRequired: true }),
  () => agent('从引用、来源、日期和可追溯性角度复核证据链。', { label: '证据复核', evidenceRequired: true }),
  () => agent('从结构、格式、目标文件类型和交付合同角度复核最终产物。', { label: '格式与合同复核', evidenceRequired: true }),
], { label: '报告三路并行复核', limit: 3, failurePolicy: 'required_all' })

phase('归约结论')
return await agent(\`综合三路复核结论：\${reviews.map((item) => item.summary).join('；')}。输出是否可交付、必须修复项、证据引用和下一步动作。\`, { label: '最终 gate 建议', schema: { type: 'object' }, evidenceRequired: true })
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
    professionalExampleScript: REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE,
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
        '对话确认场景先传 previewOnly: true，只返回 workflow 预览；用户确认后再调用一次启动。',
        '断线或后台任务丢失后的恢复场景传 resumeWorkflowRunId，会在同一个 workflowRun 上复用已完成 primitive 并继续执行。',
        '脚本是命令式 JavaScript DSL，不是 JSON schema。不要使用 agents/nodes/steps/tasks 声明式字段。',
        "必须以 export const meta = {...} 开头；然后用 phase('阶段名')、await agent('任务提示', { label: '节点名' })、parallel/pipeline 编排。",
        '专业报告复核类任务优先使用三路并行复核：事实、证据、格式/交付合同，最后用 reducer agent 归约 gate 建议。',
        '报告/分析报告/研究报告的最终交付必须生成 report renderer HTML artifact；只产出 .report.md 或普通 markdown 会被项目交付合同判定为未完成。',
        '如果脚本负责生成报告，最终 agent prompt 必须明确要求调用 report renderer / kai-report-creator 渲染 HTML，并在 output.artifacts 返回 .html 路径。',
        `最小可用 example:\n${WORKFLOW_SCRIPT_EXAMPLE}`,
        `专业报告复核 example:\n${REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE}`,
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
              '报告类最终节点必须生成 report renderer HTML artifact；不要只要求 .report.md。',
              `example:\n${WORKFLOW_SCRIPT_EXAMPLE}`,
              `professional report review example:\n${REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE}`,
            ].join('\n'),
          },
          requestedBy: { type: 'string', description: '发起者，默认 assistant' },
          assignedAgent: { type: 'string', description: `动态 agent 节点默认派发给哪个 KSwarm agent，默认 ${DEFAULT_DESKTOP_WORKFLOW_AGENT_ID}` },
          waitForCompletion: {
            type: 'boolean',
            description: '测试或短任务可设为 true 等待完成。默认 false：后台启动后立即返回 workflowRunId。',
          },
          previewOnly: {
            type: 'boolean',
            description: '设为 true 时只校验脚本并返回 workflow 预览，不创建 KSwarm proposal/run；用于对话中先请用户确认。',
          },
          resumeWorkflowRunId: {
            type: 'string',
            description: '已有 workflowRunId。用于后台任务中断后恢复，同一个脚本会复用已完成的 parallel/agent primitive，不新建 proposal/run。恢复时可省略 script：系统会自动从已持久化的 workflowRun.scriptSource 取回脚本源续跑，无需重新粘贴脚本。',
          },
        },
        required: [],
      },
    },
    async execute(input) {
      const script = typeof input.script === 'string' ? input.script : '';
      const requestedBy = typeof input.requestedBy === 'string' && input.requestedBy.trim() ? input.requestedBy.trim() : 'assistant';
      const assignedAgent = typeof input.assignedAgent === 'string' && input.assignedAgent.trim()
        ? input.assignedAgent.trim()
        : DEFAULT_DESKTOP_WORKFLOW_AGENT_ID;
      const waitForCompletion = input.waitForCompletion === true;
      const previewOnly = input.previewOnly === true;
      const resumeWorkflowRunId = typeof input.resumeWorkflowRunId === 'string' && input.resumeWorkflowRunId.trim()
        ? input.resumeWorkflowRunId.trim()
        : '';

      try {
        const projectId = await resolveProjectId(kswarmService, input);
        if (!projectId) return validationFailure({ error: 'projectId_or_projectName_required' });

        // For resume, fetch the durable run first so we can recover the persisted
        // script source (when no script was supplied) and bind the script hash.
        let workflowRunId = resumeWorkflowRunId;
        let workflowRun: Record<string, unknown> | null = null;
        if (resumeWorkflowRunId) {
          workflowRun = await fetchKSwarmWorkflowRunSnapshot(kswarmService, projectId, resumeWorkflowRunId);
          const status = readString(workflowRun.status);
          if (status === 'completed') {
            return JSON.stringify({
              ok: true,
              projectId,
              workflowRunId: resumeWorkflowRunId,
              workflowId: readString(workflowRun.workflowId) || 'script_workflow',
              scriptHash: readString(workflowRun.scriptHash),
              status: 'completed',
              workflowRun,
            });
          }
          if (status && !isResumableWorkflowRunStatus(workflowRun)) {
            return validationFailure({
              error: 'workflow_script_run_not_resumable',
              message: `workflow run ${resumeWorkflowRunId} is ${status}`,
              workflowRunId: resumeWorkflowRunId,
              status,
            });
          }
        }

        // Resolve the effective script: supplied input wins; otherwise (resume only)
        // recover the persisted source from the durable run.
        let effectiveScript = script;
        if (!effectiveScript && resumeWorkflowRunId && workflowRun) {
          const persistedSource = readString(workflowRun.scriptSource);
          if (!persistedSource) {
            return validationFailure({
              error: 'workflow_script_source_unavailable',
              message: `workflow run ${resumeWorkflowRunId} has no persisted script source to resume from`,
              workflowRunId: resumeWorkflowRunId,
            });
          }
          effectiveScript = persistedSource;
        }

        const preview = createWorkflowScriptPreview(effectiveScript, {
          projectId,
          requestedBy,
        });
        if (!preview.ok) return validationFailure(preview);
        if (previewOnly) {
          return JSON.stringify({
            ok: true,
            projectId,
            workflowId: readString(preview.workflowId),
            scriptHash: readString(preview.scriptHash),
            status: 'pending_confirmation',
            preview,
          });
        }

        if (resumeWorkflowRunId && workflowRun) {
          const runScriptHash = readString(workflowRun.scriptHash);
          if (runScriptHash && readString(preview.scriptHash) !== runScriptHash) {
            return validationFailure({
              error: 'workflow_script_source_hash_mismatch',
              message: `resume script hash ${readString(preview.scriptHash)} does not match run ${runScriptHash}`,
              workflowRunId: resumeWorkflowRunId,
            });
          }
        } else {
          const normalizedSource = normalizeWorkflowScript(effectiveScript);
          const started = await createKSwarmScriptWorkflowRun({
            kswarmService,
            projectId,
            preview,
            requestedBy,
            scriptSource: normalizedSource,
            scriptHash: hashWorkflowScript(normalizedSource),
          });
          workflowRunId = readString(started.workflowRun.id);
          workflowRun = started.workflowRun;
        }
        if (!workflowRun) {
          return validationFailure({ error: 'workflow_script_run_missing' });
        }
        const controller = createKSwarmWorkflowScriptController({
          kswarmService,
          projectId,
          workflowRunId,
          assignedAgent,
          reuseCompletedPrimitives: Boolean(resumeWorkflowRunId),
        });
        if (!waitForCompletion) {
          const job = startWorkflowScriptBackgroundJob({
            kswarmService,
            projectId,
            workflowRunId,
            workflowId: readString(preview.workflowId) || readString(workflowRun.workflowId) || 'script_workflow',
            scriptHash: readString(preview.scriptHash),
            script: effectiveScript,
            controller,
          });
          return JSON.stringify({
            ok: true,
            projectId,
            workflowRunId,
            workflowId: job.workflowId,
            scriptHash: job.scriptHash,
            status: resumeWorkflowRunId ? 'resuming' : (readString(workflowRun.status) || 'running'),
            workflowRun,
            backgroundJob: {
              id: job.id,
              status: job.status,
              startedAt: job.startedAt,
              resumed: Boolean(resumeWorkflowRunId),
            },
          });
        }

        const completed = await runAndCompleteWorkflowScript({
          kswarmService,
          projectId,
          workflowRunId,
          script: effectiveScript,
          controller,
        });

        return JSON.stringify({
          ok: true,
          projectId,
          workflowRunId,
          workflowId: completed.workflowId,
          scriptHash: completed.scriptHash,
          status: readString(completed.workflowRun.status) || 'completed',
          result: completed.result,
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

export function createKSwarmGetDynamicWorkflowStatusTool(kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'get_dynamic_workflow_status',
      description: [
        '查询 KSwarm dynamic workflow run 的当前状态，用于对话层回答 workflow 是否已完成、卡在哪个 primitive、并行分支是否完成、产物/gate 是否可交付。',
        '不会创建、恢复或修改 workflow，只读取 KSwarm 里的 workflowRun 快照和当前桌面后台 job 状态。',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID，例如 proj-1779090338840' },
          projectName: { type: 'string', description: '没有 projectId 时用项目名称匹配' },
          workflowRunId: { type: 'string', description: '要查询的 dynamic workflowRunId' },
        },
        required: ['workflowRunId'],
      },
    },
    async execute(input) {
      try {
        const projectId = await resolveProjectId(kswarmService, input);
        if (!projectId) return validationFailure({ error: 'projectId_or_projectName_required' });
        const workflowRunId = typeof input.workflowRunId === 'string' && input.workflowRunId.trim()
          ? input.workflowRunId.trim()
          : '';
        if (!workflowRunId) return validationFailure({ error: 'workflowRunId_required' });
        const workflowRun = await fetchKSwarmWorkflowRunSnapshot(kswarmService, projectId, workflowRunId);
        const backgroundJob = backgroundJobs.get(`wf-script-job-${workflowRunId}`) || null;
        return JSON.stringify({
          ok: true,
          projectId,
          workflowRunId,
          status: readString(workflowRun.status) || 'unknown',
          workflowId: readString(workflowRun.workflowId),
          source: readString(workflowRun.source),
          summary: summarizeWorkflowRun(workflowRun),
          gateDecision: readRecord(workflowRun.gateDecision),
          projectDelivery: readRecord(workflowRun.projectDelivery),
          scriptResult: workflowRun.scriptResult ?? null,
          terminal: workflowRun.terminal ?? null,
          backgroundJob: backgroundJob ? {
            id: backgroundJob.id,
            status: backgroundJob.status,
            startedAt: backgroundJob.startedAt,
            completedAt: backgroundJob.completedAt,
            error: backgroundJob.error,
          } : null,
          workflowRun,
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

function startWorkflowScriptBackgroundJob({
  kswarmService,
  projectId,
  workflowRunId,
  workflowId,
  scriptHash,
  script,
  controller,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  workflowId: string;
  scriptHash: string;
  script: string;
  controller: ReturnType<typeof createKSwarmWorkflowScriptController>;
}): WorkflowScriptBackgroundJob {
  const now = Date.now();
  const job: WorkflowScriptBackgroundJob = {
    id: `wf-script-job-${workflowRunId}`,
    projectId,
    workflowRunId,
    workflowId,
    scriptHash,
    status: 'running',
    startedAt: now,
    completedAt: null,
    error: null,
  };
  backgroundJobs.set(job.id, job);

  setTimeout(() => {
    void runAndCompleteWorkflowScript({
      kswarmService,
      projectId,
      workflowRunId,
      script,
      controller,
    }).then(() => {
      job.status = 'completed';
      job.completedAt = Date.now();
    }).catch((error) => {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = readErrorCode(error);
    });
  }, 0);

  return job;
}

export function restoreWorkflowScriptBackgroundJob({
  kswarmService,
  projectId,
  workflowRunId,
  scriptSource,
  scriptHash,
  assignedAgent = DEFAULT_DESKTOP_WORKFLOW_AGENT_ID,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  scriptSource: string;
  scriptHash?: string | null;
  assignedAgent?: string;
}): { restored: boolean; reason?: string; jobId?: string } {
  const jobId = `wf-script-job-${workflowRunId}`;
  // Idempotency: never run a second job for the same run. The has/set pair stays
  // synchronous (no await between them) so concurrent restore calls cannot race.
  if (backgroundJobs.has(jobId)) {
    return { restored: false, reason: 'already_running' };
  }
  if (!readString(scriptSource)) {
    return { restored: false, reason: 'no_script_source' };
  }
  const normalizedSource = normalizeWorkflowScript(scriptSource);
  const actualHash = hashWorkflowScript(normalizedSource);
  if (scriptHash && actualHash !== scriptHash) {
    return { restored: false, reason: 'hash_mismatch' };
  }
  const controller = createKSwarmWorkflowScriptController({
    kswarmService,
    projectId,
    workflowRunId,
    assignedAgent,
    reuseCompletedPrimitives: true,
  });
  const job = startWorkflowScriptBackgroundJob({
    kswarmService,
    projectId,
    workflowRunId,
    workflowId: 'script_workflow',
    scriptHash: actualHash,
    script: normalizedSource,
    controller,
  });
  return { restored: true, jobId: job.id };
}

async function fetchKSwarmWorkflowRunSnapshot(
  kswarmService: KSwarmService,
  projectId: string,
  workflowRunId: string,
): Promise<Record<string, unknown>> {
  const response = await kswarmService.request(`/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw workflowScriptToolError(`kswarm_http_${response.status}`, `KSwarm request failed with HTTP ${response.status}`);
  }
  const workflowRun = readRecord(readRecord(payload).workflowRun);
  if (!readString(workflowRun.id)) {
    throw workflowScriptToolError('workflow_script_run_missing', 'KSwarm did not return a workflow run');
  }
  return workflowRun;
}

async function runAndCompleteWorkflowScript({
  kswarmService,
  projectId,
  workflowRunId,
  script,
  controller,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  script: string;
  controller: ReturnType<typeof createKSwarmWorkflowScriptController>;
}): Promise<{
  workflowId: string;
  scriptHash: string;
  result: unknown;
  workflowRun: Record<string, unknown>;
}> {
  const run = await runWorkflowScript(script, { controller });
  const completed = await completeKSwarmScriptWorkflowRun({
    kswarmService,
    projectId,
    workflowRunId,
    result: run.result,
    terminal: run.terminal || null,
  });
  return {
    workflowId: run.meta.name,
    scriptHash: run.scriptHash,
    result: run.result,
    workflowRun: completed.workflowRun,
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

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readErrorCode(error: unknown): string {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
    ? String((error as Error & { code: string }).code)
    : 'workflow_script_run_failed';
}

function workflowScriptToolError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function summarizeWorkflowRun(workflowRun: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes.filter(isRecord) : [];
  const parallelGroups = Array.isArray(workflowRun.parallelGroups) ? workflowRun.parallelGroups.filter(isRecord) : [];
  const checkpoints = Array.isArray(workflowRun.scriptCheckpoints) ? workflowRun.scriptCheckpoints.filter(isRecord) : [];
  const counts = (items: Record<string, unknown>[]) => items.reduce<Record<string, number>>((acc, item) => {
    const status = readString(item.status) || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const activeNodes = nodes
    .filter(node => !['completed', 'cancelled'].includes(readString(node.status)))
    .map(node => ({
      id: readString(node.id),
      status: readString(node.status),
      label: readString(readRecord(node.input).label) || readString(node.label),
      assignedAgent: readString(node.assignedAgent),
      parallelGroupId: readString(node.parallelGroupId) || null,
    }));
  return {
    nodes: counts(nodes),
    parallelGroups: counts(parallelGroups),
    checkpoints: counts(checkpoints),
    activeNodes,
    latestParallelGroups: parallelGroups.slice(-5).map(group => ({
      id: readString(group.id),
      label: readString(group.label),
      status: readString(group.status),
      completedCount: Number(group.completedCount || 0),
      failedCount: Number(group.failedCount || 0),
      totalCount: Number(group.totalCount || 0),
    })),
    nextAction: inferWorkflowNextAction(workflowRun, activeNodes),
  };
}

function inferWorkflowNextAction(
  workflowRun: Record<string, unknown>,
  activeNodes: Array<Record<string, unknown>>,
): string {
  const status = readString(workflowRun.status);
  const projectDelivery = readRecord(workflowRun.projectDelivery);
  const gateDecision = readRecord(workflowRun.gateDecision);
  if (status === 'completed' && readString(projectDelivery.status) === 'delivered') return 'delivered';
  if (status === 'completed') return 'inspect_delivery_or_artifacts';
  if (status === 'blocked') return readString(gateDecision.status) || readString(projectDelivery.status) || 'blocked';
  if (activeNodes.length > 0) return 'wait_for_active_nodes';
  return status || 'unknown';
}

export function isResumableWorkflowRunStatus(workflowRun: Record<string, unknown>): boolean {
  const status = readString(workflowRun.status);
  if (status === 'running') return true;
  if (status !== 'blocked') return false;
  const recovery = readRecord(workflowRun.recovery);
  return readString(recovery.nextAction) === 'resume_workflow';
}
