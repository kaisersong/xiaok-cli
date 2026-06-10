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
  scriptSource?: string | null;
  scriptHash?: string | null;
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
  reuseCompletedPrimitives?: boolean;
}

export async function createKSwarmScriptWorkflowRun({
  kswarmService,
  projectId,
  preview,
  requestedBy = 'human',
  scriptSource = null,
  scriptHash = null,
}: KSwarmScriptWorkflowRunInput): Promise<KSwarmScriptWorkflowRunResult> {
  const proposal = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/script-generated/proposal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preview, requestedBy, scriptSource, scriptHash }),
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
  reuseCompletedPrimitives = false,
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
      if (reuseCompletedPrimitives) {
        const existingGroupId = await findReusableParallelGroupId({
          kswarmService,
          projectId,
          workflowRunId,
          input,
        });
        if (existingGroupId) return { parallelGroupId: existingGroupId };
      }

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
    async reserveBudget(input: { runId: string; nodeId: string; tokens: number }): Promise<{ reserved: boolean; attemptId: string }> {
      const reserved = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/reserve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: input.nodeId, tokens: input.tokens }),
      });
      const body = readRecord(reserved);
      return {
        reserved: body.reserved === true,
        attemptId: readString(body.attemptId),
      };
    },
    async consumeBudget(input: { runId: string; nodeId: string; attemptId: string; reserved: number; actual: number; usageSource: 'provider' | 'estimate' }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'budget_consumed',
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          reserved: input.reserved,
          actual: input.actual,
          usageSource: input.usageSource,
        }),
      });
    },
    async releaseBudget(input: { runId: string; nodeId: string; attemptId: string; tokens: number }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'budget_released',
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          tokens: input.tokens,
        }),
      });
    },
    async checkRemainingBudget(runId: string): Promise<number> {
      const remaining = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/budget/remaining`);
      return Math.max(0, Number(readRecord(readRecord(remaining).budget).remaining || 0));
    },
    async verifyEvidence(input): Promise<{ ok: boolean; failures: string[]; warnings: string[] }> {
      const verified = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/verify-evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          result: input.result,
          workspaceRoot: input.workspaceRoot,
          checks: input.checks,
        }),
      });
      const verdict = readRecord(readRecord(verified).verdict);
      return {
        ok: verdict.ok === true,
        failures: readStringArray(verdict.failures),
        warnings: readStringArray(verdict.warnings),
      };
    },
    async markNodeIntervention(input: { runId: string; nodeId: string; failures: string[] }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'needs_manual_intervention', failures: input.failures }),
      });
    },
    async markBranchSkipped(input: { runId: string; nodeId: string; label: string }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'skip', label: input.label, reason: 'budget_skipped' }),
      });
    },
    async createAgentNode(input: WorkflowScriptAgentInput): Promise<unknown> {
      if (reuseCompletedPrimitives && input.nodeId && !input.forceRetry) {
        const reusableById = await findReusableAgentNodeById({
          kswarmService,
          projectId,
          workflowRunId,
          input,
        });
        if (reusableById.found) return reusableById.output;
      }
      if (reuseCompletedPrimitives && !input.forceRetry) {
        const reusable = await findReusableAgentNode({
          kswarmService,
          projectId,
          workflowRunId,
          input,
        });
        if (reusable.found) return reusable.output;
        if (reusable.retryableNodeId) {
          const retried = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/nodes/${encodeURIComponent(reusable.retryableNodeId)}/retry`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignedAgent }),
          });
          const nodeId = readString(readRecord(retried).nodeId) || reusable.retryableNodeId;
          return waitForWorkflowNodeOutput({
            kswarmService,
            projectId,
            workflowRunId,
            nodeId,
            pollIntervalMs,
            timeoutMs,
          });
        }
      }

      const created = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeId: input.nodeId,
          attemptId: input.attemptId,
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
          modelCapability: input.modelCapability,
          role: input.role,
          trustLevel: input.trustLevel,
          inputRefs: input.inputRefs,
          sourceRefs: input.sourceRefs,
          permissions: input.permissions,
          stableKey: input.stableKey,
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

async function findReusableParallelGroupId({
  kswarmService,
  projectId,
  workflowRunId,
  input,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptParallelGroupInput;
}): Promise<string | null> {
  const workflowRun = await fetchWorkflowRunSnapshot({ kswarmService, projectId, workflowRunId });
  const groups = Array.isArray(workflowRun.parallelGroups) ? workflowRun.parallelGroups.filter(isRecord) : [];
  const match = groups.find(group => {
    const status = readString(group.status);
    const persistedTotalCount = Number(group.totalCount || 0);
    return readString(group.primitiveId) === input.primitiveId
      && readString(group.kind) === input.kind
      && readString(group.label) === input.label
      && persistedTotalCount >= input.totalCount
      && status !== 'cancelled';
  });
  return readString(match?.id) || null;
}

async function findReusableAgentNode({
  kswarmService,
  projectId,
  workflowRunId,
  input,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptAgentInput;
}): Promise<{ found: boolean; output: unknown; retryableNodeId: string | null }> {
  const workflowRun = await fetchWorkflowRunSnapshot({ kswarmService, projectId, workflowRunId });
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes.filter(isRecord) : [];
  const match = nodes.find(node => {
    if (!workflowScriptNodeMatchesInput(node, input)) return false;
    return readString(node.status) === 'completed';
  });
  if (match) return { found: true, output: match.output ?? null, retryableNodeId: null };
  const retryable = nodes.find(node => {
    if (!workflowScriptNodeMatchesInput(node, input)) return false;
    return ['blocked', 'failed'].includes(readString(node.status));
  });
  return { found: false, output: null, retryableNodeId: readString(retryable?.id) || null };
}

async function findReusableAgentNodeById({
  kswarmService,
  projectId,
  workflowRunId,
  input,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptAgentInput;
}): Promise<{ found: boolean; output: unknown }> {
  const detail = await requestKSwarmJson(
    kswarmService,
    `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/nodes/${encodeURIComponent(input.nodeId || '')}`,
  );
  const node = readRecord(readRecord(detail).node);
  if (!workflowScriptNodeMatchesInput(node, input)) return { found: false, output: null };
  if (readString(node.status) !== 'completed') return { found: false, output: null };
  return {
    found: true,
    output: node.result ?? node.output ?? null,
  };
}

function workflowScriptNodeMatchesInput(node: Record<string, unknown>, input: WorkflowScriptAgentInput): boolean {
    const nodeInput = readRecord(node.input);
    const script = readRecord(nodeInput.script);
    return readString(node.kind) === 'agent_task'
      && readString(nodeInput.prompt) === input.prompt
      && readString(nodeInput.label) === input.label
      && (input.phaseTitle == null || readString(script.phaseTitle) === input.phaseTitle)
      && nullableString(node.parallelGroupId) === nullableString(input.parallelGroupId)
      && nullableString(node.fanoutItemKey) === nullableString(input.fanoutItemKey)
      && nullableString(node.fanoutItemLabel) === nullableString(input.fanoutItemLabel)
      && workflowScriptPipelineStageMatches(node, input)
      && stableJson(nodeInput.options ?? null) === stableJson(input.options || null);
}

function workflowScriptPipelineStageMatches(node: Record<string, unknown>, input: WorkflowScriptAgentInput): boolean {
  const nodeStage = nullableNumber(node.pipelineStageIndex);
  const inputStage = nullableNumber(input.pipelineStageIndex);
  if (inputStage === null && nodeStage === 0) return true;
  return nodeStage === inputStage;
}

async function fetchWorkflowRunSnapshot({
  kswarmService,
  projectId,
  workflowRunId,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
}): Promise<Record<string, unknown>> {
  const detail = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`);
  return readRecord(readRecord(detail).workflowRun);
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function nullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value ?? null));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value ?? null;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
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
