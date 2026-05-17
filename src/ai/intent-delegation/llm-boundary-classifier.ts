import type { Message, ModelAdapter } from '../../types.js';
import type { IntentBoundaryConfig, LlmBoundaryDecision } from './boundary-types.js';
import type { IntentType } from './types.js';

const INTENT_TYPES = new Set(['generate', 'revise', 'summarize', 'analyze']);

export interface LlmBoundaryPromptInput {
  input: string;
  sessionId: string;
  instanceId: string;
  cwd: string;
  providedSourcePaths: string[];
  ruleDecision: {
    kind: 'ambiguous';
    ambiguityType: string;
    reason: string;
  };
}

export interface LlmBoundaryInvoker {
  invoke(prompt: string): Promise<string>;
  timeoutMs: number;
}

export function createAdapterBoundaryInvoker(
  adapter: ModelAdapter,
  config: IntentBoundaryConfig,
): LlmBoundaryInvoker {
  return {
    timeoutMs: config.timeoutMs,
    async invoke(prompt: string): Promise<string> {
      const messages: Message[] = [{
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      }];
      let text = '';
      for await (const chunk of adapter.stream(messages, [], 'Return JSON only. Do not call tools.')) {
        if (chunk.type === 'text') text += chunk.delta;
        if (chunk.type === 'done') break;
      }
      return text.trim();
    },
  };
}

export async function classifyBoundaryWithLlm(
  input: LlmBoundaryPromptInput,
  invoker: LlmBoundaryInvoker,
): Promise<LlmBoundaryDecision> {
  try {
    const raw = await withTimeout(invoker.invoke(buildPrompt(input)), invoker.timeoutMs);
    return parseDecision(raw);
  } catch {
    return { kind: 'answer_directly', confidence: 0, reason: 'timeout_or_invoke_error' };
  }
}

function parseDecision(raw: string): LlmBoundaryDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'answer_directly', confidence: 0, reason: 'invalid_json' };
  }

  if (!isRecord(value) || 'stages' in value) {
    return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
  }

  const kind = value.kind;
  const confidence = typeof value.confidence === 'number' ? value.confidence : -1;
  const reason = typeof value.reason === 'string' ? value.reason : '';
  if (confidence < 0 || confidence > 1 || !reason) {
    return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
  }

  if (kind === 'answer_directly') return { kind, confidence, reason };
  if (kind === 'ask_clarification' && typeof value.question === 'string' && value.question.trim()) {
    return { kind, confidence, question: value.question.trim(), reason };
  }
  if (
    kind === 'create_intent'
    && typeof value.intentType === 'string'
    && INTENT_TYPES.has(value.intentType)
    && Array.isArray(value.deliverables)
    && value.deliverables.every((item) => typeof item === 'string')
    && Array.isArray(value.constraints)
    && value.constraints.every((item) => typeof item === 'string')
  ) {
    return {
      kind,
      confidence,
      intentType: value.intentType as IntentType,
      deliverables: value.deliverables,
      constraints: value.constraints,
      reason,
    };
  }

  return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
}

function buildPrompt(input: LlmBoundaryPromptInput): string {
  return [
    'Return JSON only.',
    'Decide whether this ambiguous user input should be answered directly, clarified, or turned into a workflow intent.',
    'Do not create stages. Do not include fields outside the schema.',
    `ambiguityType=${input.ruleDecision.ambiguityType}`,
    `input=${input.input}`,
  ].join('\n');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
