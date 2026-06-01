import vm from 'node:vm';

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

export interface WorkflowScriptController {
  createAgentNode(input: WorkflowScriptAgentInput): Promise<unknown>;
  emitPhase?(input: WorkflowScriptPhaseInput): Promise<void> | void;
  emitLog?(input: WorkflowScriptLogInput): Promise<void> | void;
  requestUserInput?(input: WorkflowScriptUserInputRequest): Promise<unknown>;
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
  meta: WorkflowScriptMeta;
  scriptHash: string;
  analysis: WorkflowScriptAnalysis;
}

type AsyncThunk<T = unknown> = () => Promise<T> | T;

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
    const input: WorkflowScriptAgentInput = {
      prompt: normalizedPrompt,
      label,
      phaseTitle,
      options: normalizedOptions,
      sequence: agentSequence,
      scriptHash,
      workflowId,
    };
    return limit(() => controller.createAgentNode(input));
  }

  async function parallel(items: unknown): Promise<unknown[]> {
    if (!Array.isArray(items)) {
      throw workflowScriptError('workflow_script_parallel_array_required', 'parallel() expects an array');
    }
    return Promise.all(items.map((item) => runThunkOrValue(item)));
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

  const result = await compiled.runInContext(context, { timeout: syncTimeoutMs });
  assertJsonSerializable(result, 'workflow_script_result_not_serializable');
  return {
    ok: true,
    result,
    meta,
    scriptHash,
    analysis,
  };

  async function runThunkOrValue(item: unknown): Promise<unknown> {
    if (typeof item === 'function') return (item as AsyncThunk)();
    return item;
  }
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
