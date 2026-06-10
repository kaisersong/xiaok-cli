import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  type EvidenceCheck,
  parseWorkflowScript,
  validateWorkflowScript,
  type WorkflowScriptAnalysis,
  type WorkflowScriptMeta,
  type WorkflowScriptValidationPolicy,
} from './workflow-script-contract.js';

export interface WorkflowScriptAgentInput {
  prompt: string;
  label: string;
  phaseTitle: string | null;
  options: Record<string, unknown> | null;
  sequence: number;
  scriptHash: string;
  workflowId: string;
  parallelGroupId?: string | null;
  fanoutItemKey?: string | null;
  fanoutItemLabel?: string | null;
  pipelineStageIndex?: number | null;
  required?: boolean;
  outputSchema?: Record<string, unknown> | null;
  evidenceRequired?: boolean;
  nodeId?: string;
  attemptId?: string;
  forceRetry?: boolean;
  workflowRunId?: string;
  workspaceRoot?: string;
  modelCapability?: string;
  role?: string;
  trustLevel?: string;
  inputRefs?: string[];
  sourceRefs?: string[];
  permissions?: Record<string, unknown> | null;
  stableKey?: string;
}

export interface WorkflowScriptPhaseInput {
  title: string;
  sequence: number;
  scriptHash: string;
  workflowId: string;
}

export interface WorkflowScriptLogInput {
  message: string;
  scriptHash: string;
  workflowId: string;
}

export interface WorkflowScriptUserInputRequest {
  question: string;
  options: Record<string, unknown> | null;
  scriptHash: string;
  workflowId: string;
}

export interface WorkflowScriptParallelGroupInput {
  label: string;
  phaseTitle: string | null;
  primitiveId: string;
  kind: 'parallel' | 'pipeline';
  totalCount: number;
  limit: number;
  failurePolicy: 'required_all' | 'collect_errors' | 'fail_fast' | 'quorum';
  quorum: number | null;
  scriptHash: string;
  workflowId: string;
}

export interface WorkflowScriptParallelGroupResult {
  parallelGroupId: string;
}

export interface WorkflowScriptController {
  createAgentNode(input: WorkflowScriptAgentInput): Promise<unknown>;
  emitPhase?(input: WorkflowScriptPhaseInput): Promise<void> | void;
  emitLog?(input: WorkflowScriptLogInput): Promise<void> | void;
  requestUserInput?(input: WorkflowScriptUserInputRequest): Promise<unknown>;
  beginParallelGroup?(input: WorkflowScriptParallelGroupInput): Promise<WorkflowScriptParallelGroupResult> | WorkflowScriptParallelGroupResult;
  reserveBudget?(input: { runId: string; nodeId: string; tokens: number }): Promise<{ reserved: boolean; attemptId: string }>;
  consumeBudget?(input: { runId: string; nodeId: string; attemptId: string; reserved: number; actual: number; usageSource: 'provider' | 'estimate' }): Promise<void>;
  releaseBudget?(input: { runId: string; nodeId: string; attemptId: string; tokens: number }): Promise<void>;
  checkRemainingBudget?(runId: string): Promise<number>;
  verifyEvidence?(input: { runId: string; nodeId: string; result: unknown; workspaceRoot: string; checks: EvidenceCheck[] }): Promise<{ ok: boolean; failures: string[]; warnings: string[] }>;
  markNodeIntervention?(input: { runId: string; nodeId: string; failures: string[] }): Promise<void>;
  markBranchSkipped?(input: { runId: string; nodeId: string; label: string }): Promise<void>;
}

export interface WorkflowScriptRuntimeOptions {
  controller: WorkflowScriptController;
  concurrency?: number;
  policy?: WorkflowScriptValidationPolicy;
  syncTimeoutMs?: number;
  workflowRunId?: string;
  workspaceRoot?: string;
}

export interface WorkflowScriptRunResult {
  ok: true;
  result: unknown;
  terminal?: WorkflowScriptTerminalResult | null;
  meta: WorkflowScriptMeta;
  scriptHash: string;
  analysis: WorkflowScriptAnalysis;
}

export interface WorkflowScriptTerminalResult {
  status: 'finished' | 'blocked' | 'needs_replanning' | 'needs_rubric_clarification';
  reason?: string;
  evidenceRefs?: string[];
  result?: unknown;
}

type AsyncThunk<T = unknown> = () => Promise<T> | T;
type BranchContext = {
  parallelGroupId: string | null;
  fanoutItemKey: string | null;
  fanoutItemLabel: string | null;
  pipelineStageIndex: number | null;
};

export async function runWorkflowScript(
  script: string,
  {
    controller,
    concurrency = 4,
    policy = {},
    syncTimeoutMs = 1_000,
    workflowRunId,
    workspaceRoot = process.cwd(),
  }: WorkflowScriptRuntimeOptions,
): Promise<WorkflowScriptRunResult> {
  if (!controller || typeof controller.createAgentNode !== 'function') {
    throw workflowScriptError('workflow_script_controller_required', 'workflow script controller is required');
  }

  const validation = validateWorkflowScript(script, { policy });
  if (!validation.ok) {
    throw workflowScriptError(validation.error, validation.message || validation.error, validation);
  }

  const parsed = parseWorkflowScript(script);
  const { meta, scriptHash, analysis } = validation.normalized;
  const activePolicy = validation.normalized.policy;
  const workflowId = meta.name;
  const runId = workflowRunId || workflowId;
  const limit = createConcurrencyLimiter(concurrency);
  let currentPhaseTitle: string | null = null;
  let phaseSequence = 0;
  let agentSequence = 0;
  let parallelSequence = 0;
  const branchContext = new AsyncLocalStorage<BranchContext>();

  async function phase(title: unknown): Promise<{ title: string; sequence: number }> {
    const normalizedTitle = normalizeRequiredString(title, 'workflow_script_phase_title_required');
    currentPhaseTitle = normalizedTitle;
    phaseSequence += 1;
    await controller.emitPhase?.({
      title: normalizedTitle,
      sequence: phaseSequence,
      scriptHash,
      workflowId,
    });
    return { title: normalizedTitle, sequence: phaseSequence };
  }

  async function agent(prompt: unknown, options: unknown = null): Promise<unknown> {
    const normalizedPrompt = normalizeRequiredString(prompt, 'workflow_script_agent_prompt_required');
    const normalizedOptions = normalizeOptions(options);
    agentSequence += 1;
    const nodeId = `node-${runId}-${agentSequence}`;
    const label = normalizeOptionalString(normalizedOptions?.label) || `动态任务 ${agentSequence}`;
    const phaseTitle = normalizeOptionalString(normalizedOptions?.phaseTitle)
      || normalizeOptionalString(normalizedOptions?.phase)
      || currentPhaseTitle;
    const model = normalizeOptionalString(normalizedOptions?.model);
    const modelCapability = normalizeOptionalString(normalizedOptions?.modelCapability);
    if (model && modelCapability) {
      throw workflowScriptError('model_and_capability_mutually_exclusive', 'cannot specify both model and modelCapability');
    }
    const activeBranch = branchContext.getStore();
    const input: WorkflowScriptAgentInput = {
      prompt: normalizedPrompt,
      label,
      phaseTitle,
      options: normalizedOptions,
      sequence: agentSequence,
      scriptHash,
      workflowId,
      workflowRunId: runId,
      nodeId,
      workspaceRoot,
      modelCapability: modelCapability || undefined,
      parallelGroupId: activeBranch?.parallelGroupId || null,
      fanoutItemKey: activeBranch?.fanoutItemKey || null,
      fanoutItemLabel: activeBranch?.fanoutItemLabel || null,
      pipelineStageIndex: activeBranch?.pipelineStageIndex ?? null,
      required: normalizedOptions?.required !== false,
      outputSchema: normalizeSchema(normalizedOptions?.schema),
      evidenceRequired: normalizedOptions?.evidenceRequired === true,
      role: normalizeOptionalString(normalizedOptions?.role) || undefined,
      trustLevel: normalizeOptionalString(normalizedOptions?.trustLevel) || undefined,
      inputRefs: normalizeStringArray(normalizedOptions?.inputRefs),
      sourceRefs: normalizeStringArray(normalizedOptions?.sourceRefs),
      permissions: normalizePermissionPolicy(normalizedOptions?.permissions),
      stableKey: normalizeOptionalString(normalizedOptions?.stableKey) || undefined,
    };
    return limit(() => runAgentAttempt(input, normalizedOptions));
  }

  async function runAgentAttempt(input: WorkflowScriptAgentInput, options: Record<string, unknown> | null): Promise<unknown> {
    const budgetPolicy = activePolicy.budget;
    const evidenceGate = activePolicy.evidenceGate;
    const estimate = estimateTokens(input.prompt, options, budgetPolicy?.defaultEstimateMultiplier || 1);
    let lastAttemptConsumed = false;
    let lastAttemptId: string | undefined;

    async function reserveAttempt(): Promise<string | undefined> {
      if (!budgetPolicy) return undefined;
      assertBudgetController();
      const reservation = await controller.reserveBudget!({ runId, nodeId: input.nodeId!, tokens: estimate });
      if (!reservation.reserved) {
        throw workflowScriptError('budget_exceeded', `node ${input.nodeId} exceeded workflow budget`);
      }
      lastAttemptConsumed = false;
      lastAttemptId = reservation.attemptId;
      return reservation.attemptId;
    }

    async function dispatchAndConsume(attemptId: string | undefined, forceRetry = false): Promise<unknown> {
      const result = await controller.createAgentNode({
        ...input,
        attemptId,
        forceRetry: forceRetry || undefined,
      });
      if (budgetPolicy && attemptId) {
        const usage = readUsage(result, estimate);
        await controller.consumeBudget!({
          runId,
          nodeId: input.nodeId!,
          attemptId,
          reserved: estimate,
          actual: usage.actual,
          usageSource: usage.source,
        });
        lastAttemptConsumed = true;
      }
      return result;
    }

    try {
      const firstAttemptId = await reserveAttempt();
      let currentResult = await dispatchAndConsume(firstAttemptId);
      if (!evidenceGate) return currentResult;
      assertEvidenceController();
      let retry = 0;
      while (retry < evidenceGate.maxRetry) {
        const verdict = await controller.verifyEvidence!({
          runId,
          nodeId: input.nodeId!,
          result: currentResult,
          workspaceRoot,
          checks: evidenceGate.checks,
        });
        if (verdict.ok) return currentResult;
        retry += 1;
        if (retry >= evidenceGate.maxRetry) {
          await controller.markNodeIntervention!({ runId, nodeId: input.nodeId!, failures: verdict.failures });
          throw workflowScriptError(
            'evidence_max_retry_exceeded',
            `node ${input.nodeId} failed evidence check after ${evidenceGate.maxRetry} retries`,
          );
        }
        const retryAttemptId = await reserveAttempt();
        currentResult = await dispatchAndConsume(retryAttemptId, true);
      }
      return currentResult;
    } catch (error) {
      if (budgetPolicy && !lastAttemptConsumed && lastAttemptId) {
        await controller.releaseBudget!({ runId, nodeId: input.nodeId!, attemptId: lastAttemptId, tokens: estimate });
      }
      throw error;
    }
  }

  function assertBudgetController(): void {
    for (const name of ['reserveBudget', 'consumeBudget', 'releaseBudget', 'checkRemainingBudget', 'markBranchSkipped'] as const) {
      if (typeof controller[name] !== 'function') {
        throw workflowScriptError('workflow_script_budget_controller_required', `budget policy requires controller.${name}`);
      }
    }
  }

  function assertEvidenceController(): void {
    for (const name of ['verifyEvidence', 'markNodeIntervention'] as const) {
      if (typeof controller[name] !== 'function') {
        throw workflowScriptError('workflow_script_evidence_controller_required', `evidence gate requires controller.${name}`);
      }
    }
  }

  async function parallel(items: unknown, options: unknown = null): Promise<unknown[]> {
    if (!Array.isArray(items)) {
      throw workflowScriptError('workflow_script_parallel_array_required', 'parallel() expects an array');
    }
    parallelSequence += 1;
    const normalizedOptions = normalizeOptions(options);
    const failurePolicy = normalizeFailurePolicy(normalizedOptions?.failurePolicy);
    const group = await controller.beginParallelGroup?.({
      label: normalizeOptionalString(normalizedOptions?.label) || `并行分组 ${parallelSequence}`,
      phaseTitle: normalizeOptionalString(normalizedOptions?.phaseTitle)
        || normalizeOptionalString(normalizedOptions?.phase)
        || currentPhaseTitle,
      primitiveId: normalizeOptionalString(normalizedOptions?.primitiveId) || `parallel-${parallelSequence}`,
      kind: 'parallel',
      totalCount: items.length,
      limit: Math.max(1, Math.floor(Number(normalizedOptions?.limit || concurrency || 1))),
      failurePolicy,
      quorum: Number.isFinite(Number(normalizedOptions?.quorum)) ? Number(normalizedOptions?.quorum) : null,
      scriptHash,
      workflowId,
    });
    const parallelGroupId = normalizeOptionalString(group?.parallelGroupId);
    const tasks = items.map((item, index) => {
      const label = inferBranchLabel(item, index);
      return {
        label,
        run: () => branchContext.run({
          parallelGroupId,
          fanoutItemKey: `branch-${index + 1}`,
          fanoutItemLabel: label,
          pipelineStageIndex: null,
        }, () => runParallelThunk(item)),
      };
    });
    if (activePolicy.budget) {
      assertBudgetController();
      const estimates = items.map(item => estimateFromThunk(item, activePolicy.budget?.defaultEstimateMultiplier || 1));
      const totalEstimate = estimates.reduce((total, estimate) => total + estimate, 0);
      const remaining = await controller.checkRemainingBudget!(runId);
      if (totalEstimate > remaining) {
        const results: unknown[] = [];
        let spent = 0;
        const baseSequence = agentSequence + 1;
        for (const [index, task] of tasks.entries()) {
          if (spent + estimates[index] <= remaining) {
            try {
              results.push(await task.run());
            } catch (error) {
              results.push(formatParallelBranchFailure(error, task.label));
            }
            spent += estimates[index];
            continue;
          }
          const branchLabel = `分支 ${index + 1}`;
          await controller.markBranchSkipped!({
            runId,
            nodeId: `node-${runId}-${baseSequence + index}`,
            label: branchLabel,
          });
          results.push({
            ok: false,
            error: 'budget_skipped',
            message: `branch ${index + 1} skipped: budget exceeded`,
            branch: branchLabel,
          });
        }
        return results;
      }
    }
    if (failurePolicy === 'collect_errors') {
      const settled = await Promise.allSettled(tasks.map(task => task.run()));
      return settled.map((item, index) => item.status === 'fulfilled'
        ? { ok: true, value: item.value }
        : formatParallelBranchFailure(item.reason, tasks[index].label));
    }
    if (failurePolicy === 'quorum') {
      const quorum = Math.max(1, Math.floor(Number(normalizedOptions?.quorum || items.length)));
      const settled = await Promise.allSettled(tasks.map(task => task.run()));
      const values = settled
        .filter((item): item is PromiseFulfilledResult<unknown> => item.status === 'fulfilled')
        .map(item => item.value);
      if (values.length >= quorum) return values;
      const failures = settled
        .map((item, index) => item.status === 'rejected' ? formatParallelBranchFailure(item.reason, tasks[index].label) : null)
        .filter(Boolean);
      throw workflowScriptError('workflow_script_parallel_quorum_not_met', 'parallel quorum was not met', {
        quorum,
        successCount: values.length,
        failures,
      });
    }
    return Promise.all(tasks.map(task => task.run()));
  }

  async function pipeline(initialValue: unknown, ...rawStages: unknown[]): Promise<unknown> {
    const stages = rawStages.length === 1 && Array.isArray(rawStages[0]) ? rawStages[0] : rawStages;
    if (!Array.isArray(stages) || stages.length === 0) {
      throw workflowScriptError('workflow_script_pipeline_stages_required', 'pipeline() expects an array of stages');
    }
    let value = initialValue;
    for (const stage of stages) {
      if (typeof stage !== 'function') {
        throw workflowScriptError('workflow_script_pipeline_stage_function_required', 'pipeline stages must be functions');
      }
      value = await (stage as (input: unknown) => unknown | Promise<unknown>)(value);
    }
    return value;
  }

  async function log(message: unknown): Promise<void> {
    await controller.emitLog?.({
      message: String(message ?? ''),
      scriptHash,
      workflowId,
    });
  }

  async function loopUntil(config: unknown): Promise<{ status: 'stopped'; reason: string; iterations: number; progressDelta: number }> {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw workflowScriptError('workflow_script_loop_until_config_required', 'workflow.loopUntil() requires an object');
    }
    const options = config as Record<string, unknown>;
    if (typeof options.iteration !== 'function') {
      throw workflowScriptError('workflow_script_loop_until_iteration_required', 'workflow.loopUntil() requires an iteration function');
    }
    const maxIterations = Math.max(1, Math.floor(Number(options.maxIterations || 0)));
    if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
      throw workflowScriptError('workflow_script_loop_until_max_iterations_required', 'workflow.loopUntil() requires maxIterations');
    }
    const dryRunStreakToStop = Math.max(1, Math.floor(Number(options.dryRunStreakToStop || 1)));
    let dryRunStreak = 0;
    let progressDelta = 0;
    let previous: unknown = null;
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const result = await (options.iteration as (input: { iteration: number; previous: unknown }) => unknown | Promise<unknown>)({ iteration, previous });
      previous = result;
      const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      const status = normalizeOptionalString(record.status) || (record.dry === true ? 'dry' : 'produced');
      const delta = Number(record.progressDelta || 0);
      if (Number.isFinite(delta) && delta > 0) progressDelta += delta;
      if (status === 'dry') {
        dryRunStreak += 1;
      } else {
        dryRunStreak = 0;
      }
      if (dryRunStreak >= dryRunStreakToStop) {
        return { status: 'stopped', reason: 'dry_run_streak', iterations: iteration, progressDelta };
      }
    }
    return { status: 'stopped', reason: 'max_iterations', iterations: maxIterations, progressDelta };
  }

  const workflow = Object.freeze({
    requestUserInput: async (question: unknown, options: unknown = null): Promise<unknown> => {
      if (typeof controller.requestUserInput !== 'function') {
        throw workflowScriptError('workflow_script_user_input_unavailable', 'requestUserInput is not available in this runtime');
      }
      return controller.requestUserInput({
        question: normalizeRequiredString(question, 'workflow_script_user_input_question_required'),
        options: normalizeOptions(options),
        scriptHash,
        workflowId,
      });
    },
    finish: (result: unknown = null): never => {
      throw new WorkflowScriptTerminalSignal({
        status: 'finished',
        result,
      });
    },
    block: (reason: unknown): never => {
      throw new WorkflowScriptTerminalSignal(normalizeTerminalResult('blocked', reason));
    },
    needsReplanning: (reason: unknown): never => {
      throw new WorkflowScriptTerminalSignal(normalizeTerminalResult('needs_replanning', reason));
    },
    needsRubricClarification: (reason: unknown): never => {
      throw new WorkflowScriptTerminalSignal(normalizeTerminalResult('needs_rubric_clarification', reason));
    },
    loopUntil,
  });

  const context = vm.createContext(
    {
      agent,
      phase,
      parallel,
      pipeline,
      log,
      workflow,
      JSON,
      Array,
      Boolean,
      Number,
      Object,
      Promise,
      Set,
      Map,
      String,
    },
    {
      name: `xiaok-workflow-script:${scriptHash}`,
      codeGeneration: { strings: false, wasm: false },
    },
  );
  const compiled = new vm.Script(`(async () => {\n${parsed.body}\n})()`, {
    filename: `workflow-script-${scriptHash}.js`,
  });

  let result: unknown;
  let terminal: WorkflowScriptTerminalResult | null = null;
  try {
    result = await compiled.runInContext(context, { timeout: syncTimeoutMs });
  } catch (error) {
    if (!(error instanceof WorkflowScriptTerminalSignal)) throw error;
    terminal = error.terminal;
    result = terminal.status === 'finished' ? terminal.result : terminal;
  }
  assertJsonSerializable(result, 'workflow_script_result_not_serializable');
  return {
    ok: true,
    result,
    terminal,
    meta,
    scriptHash,
    analysis,
  };

  async function runThunkOrValue(item: unknown): Promise<unknown> {
    if (typeof item === 'function') return (item as AsyncThunk)();
    return item;
  }

  async function runParallelThunk(item: unknown): Promise<unknown> {
    if (typeof item !== 'function') {
      throw workflowScriptError('workflow_script_parallel_thunk_required', 'parallel() branch items must be thunks');
    }
    return (item as AsyncThunk)();
  }
}

function formatParallelBranchFailure(error: unknown, branch: string): { ok: false; error: string; message: string; branch: string } {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  return {
    ok: false,
    error: normalizeOptionalString(record.code) || 'workflow_script_parallel_branch_failed',
    message: normalizeOptionalString(record.message) || String(error || 'parallel branch failed'),
    branch,
  };
}

class WorkflowScriptTerminalSignal extends Error {
  public constructor(public readonly terminal: WorkflowScriptTerminalResult) {
    super(`workflow terminal: ${terminal.status}`);
  }
}

function normalizeTerminalResult(
  status: WorkflowScriptTerminalResult['status'],
  value: unknown,
): WorkflowScriptTerminalResult {
  if (typeof value === 'string') return { status, reason: value };
  const options = normalizeOptions(value) || {};
  return {
    status,
    reason: normalizeOptionalString(options.reason) || status,
    evidenceRefs: normalizeStringArray(options.evidenceRefs),
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function createConcurrencyLimiter(rawLimit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 1));
  let active = 0;
  const queue: Array<() => void> = [];

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

function normalizeRequiredString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw workflowScriptError(code, code);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOptions(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw workflowScriptError('workflow_script_options_object_required', 'workflow script options must be an object');
  }
  assertJsonSerializable(value, 'workflow_script_options_not_serializable');
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeSchema(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw workflowScriptError('workflow_script_schema_object_required', 'workflow script schema must be an object');
  }
  assertJsonSerializable(value, 'workflow_script_schema_not_serializable');
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizePermissionPolicy(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw workflowScriptError('workflow_script_permissions_object_required', 'workflow script permissions must be an object');
  }
  assertJsonSerializable(value, 'workflow_script_permissions_not_serializable');
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function estimateTokens(prompt: string, options: Record<string, unknown> | null, multiplier: number): number {
  const explicit = Number(options?.estimatedTokens);
  if (Number.isFinite(explicit) && explicit > 0) return Math.ceil(explicit);
  const base = Math.max(1, Math.ceil(prompt.length / 4));
  return Math.ceil(base * Math.max(1, multiplier));
}

function estimateFromThunk(item: unknown, multiplier: number): number {
  if (typeof item !== 'function') return Math.ceil(Math.max(1, multiplier));
  const source = Function.prototype.toString.call(item);
  const match = source.match(/\bestimatedTokens\s*:\s*(\d+(?:\.\d+)?)/);
  if (match) return Math.ceil(Number(match[1]));
  return Math.ceil(Math.max(1, multiplier));
}

function readUsage(result: unknown, estimate: number): { actual: number; source: 'provider' | 'estimate' } {
  const record = result && typeof result === 'object' ? result as { usage?: { totalTokens?: unknown } } : {};
  const totalTokens = Number(record.usage?.totalTokens);
  if (Number.isFinite(totalTokens) && totalTokens >= 0) {
    return { actual: Math.ceil(totalTokens), source: 'provider' };
  }
  return { actual: estimate, source: 'estimate' };
}

function normalizeFailurePolicy(value: unknown): 'required_all' | 'collect_errors' | 'fail_fast' | 'quorum' {
  return value === 'collect_errors' || value === 'fail_fast' || value === 'quorum'
    ? value
    : 'required_all';
}

function inferBranchLabel(item: unknown, index: number): string {
  if (typeof item !== 'function') return `分支 ${index + 1}`;
  const source = Function.prototype.toString.call(item);
  const labelMatch = source.match(/\blabel\s*:\s*(['"`])((?:\\.|(?!\1).)*?)\1/);
  return labelMatch?.[2]?.trim() || `分支 ${index + 1}`;
}

function assertJsonSerializable(value: unknown, code: string): void {
  try {
    JSON.stringify(value ?? null);
  } catch {
    throw workflowScriptError(code, code);
  }
}

function workflowScriptError(code: string, message: string, details: Record<string, unknown> = {}): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  Object.assign(error, details);
  return error;
}
