import type {
  ModelReasoningEffort,
  ModelRuntimeConstraints,
  ModelRuntimeOptions,
  ProtocolId,
} from './types.js';

const KIMI_K3_OPENAI_ENDPOINT = 'https://api.kimi.com/coding/v1';
const KIMI_K3_RUNTIME_OPTIONS: ModelRuntimeOptions = {
  contextLimit: 262_144,
  reasoningEffort: 'high',
};
const KIMI_K3_RUNTIME_CONSTRAINTS: ModelRuntimeConstraints = {
  maxContextLimit: 1_048_576,
  reasoningEfforts: ['low', 'high', 'max'],
};
const MODEL_REASONING_EFFORTS: ModelReasoningEffort[] = ['low', 'high', 'max'];

interface ResolveModelRuntimeOptionsInput {
  protocol: ProtocolId;
  baseUrl?: string;
  wireModel: string;
  catalogOptions?: ModelRuntimeOptions;
  catalogConstraints?: ModelRuntimeConstraints;
  configuredOptions?: ModelRuntimeOptions;
}

interface ResolvedModelRuntimeOptions {
  runtimeOptions?: ModelRuntimeOptions;
  runtimeConstraints?: ModelRuntimeConstraints;
}

export function isOfficialKimiK3OpenAIEndpoint(baseUrl?: string): boolean {
  return baseUrl === KIMI_K3_OPENAI_ENDPOINT || baseUrl === `${KIMI_K3_OPENAI_ENDPOINT}/`;
}

function cloneConstraints(constraints: ModelRuntimeConstraints): ModelRuntimeConstraints {
  return {
    ...constraints,
    ...(constraints.reasoningEfforts
      ? { reasoningEfforts: [...constraints.reasoningEfforts] }
      : {}),
  };
}

function validateRuntimeOptions(
  options: ModelRuntimeOptions,
  constraints?: ModelRuntimeConstraints,
): void {
  if (options.contextLimit !== undefined) {
    if (!Number.isInteger(options.contextLimit) || options.contextLimit <= 0) {
      throw new Error('contextLimit must be a positive integer');
    }
    if (
      constraints?.maxContextLimit !== undefined
      && options.contextLimit > constraints.maxContextLimit
    ) {
      throw new Error(`contextLimit must not exceed ${constraints.maxContextLimit}`);
    }
  }

  if (options.reasoningEffort !== undefined) {
    if (!MODEL_REASONING_EFFORTS.includes(options.reasoningEffort)) {
      throw new Error(`reasoningEffort is invalid: ${options.reasoningEffort}`);
    }
    if (
      constraints?.reasoningEfforts
      && !constraints.reasoningEfforts.includes(options.reasoningEffort)
    ) {
      throw new Error(`reasoningEffort is not allowed: ${options.reasoningEffort}`);
    }
  }
}

export function resolveModelRuntimeOptions(
  input: ResolveModelRuntimeOptionsInput,
): ResolvedModelRuntimeOptions {
  const useKimiK3Fallback = input.protocol === 'openai_legacy'
    && input.wireModel === 'k3'
    && isOfficialKimiK3OpenAIEndpoint(input.baseUrl);
  const fallbackOptions = useKimiK3Fallback ? KIMI_K3_RUNTIME_OPTIONS : undefined;
  const fallbackConstraints = useKimiK3Fallback ? KIMI_K3_RUNTIME_CONSTRAINTS : undefined;

  const runtimeOptions = fallbackOptions || input.catalogOptions || input.configuredOptions
    ? {
        ...fallbackOptions,
        ...input.catalogOptions,
        ...input.configuredOptions,
      }
    : undefined;

  const mergedConstraints = fallbackConstraints || input.catalogConstraints
    ? {
        ...fallbackConstraints,
        ...input.catalogConstraints,
      }
    : undefined;
  const runtimeConstraints = mergedConstraints
    ? cloneConstraints(mergedConstraints)
    : undefined;

  if (runtimeOptions) {
    validateRuntimeOptions(runtimeOptions, runtimeConstraints);
  }

  return {
    ...(runtimeOptions ? { runtimeOptions } : {}),
    ...(runtimeConstraints ? { runtimeConstraints } : {}),
  };
}
