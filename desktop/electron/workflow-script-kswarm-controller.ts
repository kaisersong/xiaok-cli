import type { KSwarmService } from './kswarm-service.js';
import type {
  WorkflowScriptAgentInput,
  WorkflowScriptController,
  WorkflowScriptLogInput,
  WorkflowScriptParallelGroupInput,
  WorkflowScriptPhaseInput,
  WorkflowScriptTerminalResult,
} from './workflow-script-runtime.js';

export interface KSwarmScriptWorkflowRunInput {
  kswarmService: KSwarmService;
  projectId: string;
  preview: unknown;
  requestedBy?: string;
}

export interface KSwarmScriptWorkflowRunResult {
  workflowProposal: Record<string, unknown>;
  workflowRun: Record<string, unknown>;
}

export interface KSwarmWorkflowScriptControllerOptions {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  assignedAgent?: string | null;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export async function createKSwarmScriptWorkflowRun({
  kswarmService,
  projectId,
  preview,
  requestedBy = 'human',
}: KSwarmScriptWorkflowRunInput): Promise<KSwarmScriptWorkflowRunResult> {
  const proposal = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/script-generated/proposal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preview, requestedBy }),
  });
  const proposalId = readString(readRecord(proposal).workflowProposal && readRecord(readRecord(proposal).workflowProposal).id);
  if (!proposalId) throw workflowScriptKSwarmError('workflow_script_proposal_missing', 'KSwarm did not return a workflow proposal id');

  const started = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/script-generated/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalId, approvedBy: requestedBy }),
  });
  const workflowProposal = readRecord(readRecord(proposal).workflowProposal);
  const workflowRun = readRecord(readRecord(started).workflowRun);
  if (!readString(workflowRun.id)) throw workflowScriptKSwarmError('workflow_script_run_missing', 'KSwarm did not return a workflow run id');
  return { workflowProposal, workflowRun };
}

export async function completeKSwarmScriptWorkflowRun({
  kswarmService,
  projectId,
  workflowRunId,
  result,
  terminal = null,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  result: unknown;
  terminal?: WorkflowScriptTerminalResult | null;
}): Promise<{ workflowRun: Record<string, unknown> }> {
  const completed = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result, terminal }),
  });
  const workflowRun = readRecord(readRecord(completed).workflowRun);
  if (!readString(workflowRun.id)) throw workflowScriptKSwarmError('workflow_script_completion_missing', 'KSwarm did not return a completed workflow run');
  return { workflowRun };
}

export function createKSwarmWorkflowScriptController({
  kswarmService,
  projectId,
  workflowRunId,
  assignedAgent = null,
  pollIntervalMs = 1_000,
  timeoutMs = 10 * 60_000,
}: KSwarmWorkflowScriptControllerOptions): WorkflowScriptController {
  return {
    async emitPhase(_input: WorkflowScriptPhaseInput): Promise<void> {
      // KSwarm materializes phases when dynamic nodes are created. Phase-only
      // events remain local to avoid empty durable phases during exploratory scripts.
    },
    async emitLog(_input: WorkflowScriptLogInput): Promise<void> {
      // Reserved for workflow progress batching; current MVP keeps logs local.
    },
    async beginParallelGroup(input: WorkflowScriptParallelGroupInput): Promise<{ parallelGroupId: string }> {
      const created = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/parallel-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phaseTitle: input.phaseTitle || '动态执行',
          label: input.label,
          primitiveId: input.primitiveId,
          kind: input.kind,
          totalCount: input.totalCount,
          limit: input.limit,
          failurePolicy: input.failurePolicy,
          quorum: input.quorum,
        }),
      });
      const parallelGroupId = readString(readRecord(readRecord(created).parallelGroup).id);
      if (!parallelGroupId) throw workflowScriptKSwarmError('workflow_script_parallel_group_missing', 'KSwarm did not return a workflow parallel group id');
      return { parallelGroupId };
    },
    async createAgentNode(input: WorkflowScriptAgentInput): Promise<unknown> {
      const created = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phaseTitle: input.phaseTitle || '动态执行',
          label: input.label,
          prompt: input.prompt,
          assignedAgent,
          options: input.options,
          parallelGroupId: input.parallelGroupId,
          fanoutItemKey: input.fanoutItemKey,
          fanoutItemLabel: input.fanoutItemLabel,
          pipelineStageIndex: input.pipelineStageIndex,
          required: input.required,
          outputSchema: input.outputSchema,
          evidenceRequired: input.evidenceRequired,
        }),
      });
      const nodeId = readString(readRecord(created).nodeId) || inferLatestScriptNodeId(readRecord(readRecord(created).workflowRun));
      if (!nodeId) throw workflowScriptKSwarmError('workflow_script_node_missing', 'KSwarm did not return a workflow node id');
      return waitForWorkflowNodeOutput({
        kswarmService,
        projectId,
        workflowRunId,
        nodeId,
        pollIntervalMs,
        timeoutMs,
      });
    },
  };
}

async function waitForWorkflowNodeOutput({
  kswarmService,
  projectId,
  workflowRunId,
  nodeId,
  pollIntervalMs,
  timeoutMs,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  nodeId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const detail = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`);
    const workflowRun = readRecord(readRecord(detail).workflowRun);
    const node = readWorkflowNode(workflowRun, nodeId);
    const status = readString(node.status);
    if (status === 'completed') return node.output ?? null;
    if (['failed', 'blocked', 'cancelled'].includes(status)) {
      throw workflowScriptKSwarmError('workflow_script_node_terminal', `workflow node ${nodeId} ended with status ${status}`, { nodeId, status });
    }
    await sleep(pollIntervalMs);
  }
  throw workflowScriptKSwarmError('workflow_script_node_timeout', `workflow node ${nodeId} did not complete before timeout`, { nodeId });
}

async function requestKSwarmJson(kswarmService: KSwarmService, path: string, init?: RequestInit): Promise<unknown> {
  if (!kswarmService) throw workflowScriptKSwarmError('kswarm_service_missing', 'KSwarm service is missing');
  const response = await kswarmService.request(path, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw workflowScriptKSwarmError(`kswarm_http_${response.status}`, `KSwarm request failed with HTTP ${response.status}`);
  }
  if (isRecord(body) && body.ok === false) {
    throw workflowScriptKSwarmError(readString(body.error) || 'kswarm_request_failed', readString(body.error) || 'KSwarm request failed');
  }
  return body;
}

function readWorkflowNode(workflowRun: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes : [];
  const node = nodes.find(item => isRecord(item) && item.id === nodeId);
  if (!isRecord(node)) throw workflowScriptKSwarmError('workflow_script_node_not_found', `workflow node ${nodeId} was not found`, { nodeId });
  return node;
}

function inferLatestScriptNodeId(workflowRun: Record<string, unknown>): string | null {
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes : [];
  const scriptNodes = nodes
    .filter(item => isRecord(item) && readString(item.id).startsWith('script-agent-'))
    .map(item => readString(readRecord(item).id))
    .filter(Boolean);
  return scriptNodes.at(-1) || null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function workflowScriptKSwarmError(code: string, message: string, details: Record<string, unknown> = {}): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  Object.assign(error, details);
  return error;
}
