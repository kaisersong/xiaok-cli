import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
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
}

export interface WorkflowScriptRuntimeOptions {
  controller: WorkflowScriptController;
  concurrency?: number;
  policy?: WorkflowScriptValidationPolicy;
  syncTimeoutMs?: number;
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
  const workflowId = meta.name;
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
    const label = normalizeOptionalString(normalizedOptions?.label) || `动态任务 ${agentSequence}`;
    const phaseTitle = normalizeOptionalString(normalizedOptions?.phaseTitle)
      || normalizeOptionalString(normalizedOptions?.phase)
      || currentPhaseTitle;
    const activeBranch = branchContext.getStore();
    const input: WorkflowScriptAgentInput = {
      prompt: normalizedPrompt,
      label,
      phaseTitle,
      options: normalizedOptions,
      sequence: agentSequence,
      scriptHash,
      workflowId,
      parallelGroupId: activeBranch?.parallelGroupId || null,
      fanoutItemKey: activeBranch?.fanoutItemKey || null,
      fanoutItemLabel: activeBranch?.fanoutItemLabel || null,
      pipelineStageIndex: activeBranch?.pipelineStageIndex ?? null,
      required: normalizedOptions?.required !== false,
      outputSchema: normalizeSchema(normalizedOptions?.schema),
      evidenceRequired: normalizedOptions?.evidenceRequired === true,
    };
    return limit(() => controller.createAgentNode(input));
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
