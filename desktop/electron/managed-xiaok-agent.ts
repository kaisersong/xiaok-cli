import { existsSync } from 'node:fs';

import { resolveConfiguredModelBinding } from '../../src/ai/providers/model-binding.js';
import type { Config } from '../../src/types.js';

const DEFAULT_CAPABILITIES = [
  'coding',
  'testing',
  'qa',
  'design',
  'planning',
  'research',
  'analysis',
  'source_research',
  'web_research',
  'writing',
  'documentation',
  'review',
  'product',
  'requirements',
  'architecture',
  'system-design',
  'engineering',
  'devops',
  'deployment',
  'data_analysis',
  'report_generation',
  'presentation_generation',
  'presentation_content',
  'slide_generation',
];
const DEFAULT_OUTPUT_CAPABILITIES = ['markdown', 'html', 'report_html'];

export interface ManagedXiaokAgentInput {
  id?: string;
  name: string;
  description?: string;
  instructions?: string;
  roles?: string[];
  capabilities?: string[];
  maxConcurrentTasks?: number;
}

export interface ManagedXiaokAgentPayload {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  runtimeType: 'xiaok';
  runtimeSource: 'desktop-agent-runtime';
  runtimePath: string | null;
  runtimeModel: string;
  provider: null;
  model: null;
  baseUrl: null;
  apiKey: null;
  roles: string[];
  capabilities: string[];
  taskCapabilities: string[];
  outputCapabilities: string[];
  runtimeHealth: {
    state: 'unknown';
    source: 'desktop-agent-runtime';
    taskCapabilities: string[];
    outputCapabilities: string[];
  };
  maxConcurrentTasks: number;
}

export interface ResolveLocalXiaokRuntimePathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
}

export function resolveLocalXiaokRuntimePath(
  options: ResolveLocalXiaokRuntimePathOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const pathExists = options.exists ?? existsSync;

  // Default desktop-managed xiaok agents must not depend on a separately
  // installed xiaok CLI. Only an explicit native override is honored.
  const hinted = env.KSWARM_XIAOK_PATH?.trim();
  if (hinted && pathExists(hinted)) {
    return hinted;
  }

  return null;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

export function buildManagedXiaokAgentPayload(
  input: ManagedXiaokAgentInput,
  config: Config,
  options: { runtimePath?: string | null; modelId?: string } = {},
): ManagedXiaokAgentPayload {
  const binding = resolveConfiguredModelBinding(config, options.modelId ?? config.defaultModelId);
  const runtimePath = options.runtimePath === undefined ? null : options.runtimePath;
  const taskCapabilities = input.capabilities ?? [...DEFAULT_CAPABILITIES];
  const outputCapabilities = [...DEFAULT_OUTPUT_CAPABILITIES];

  return {
    id: input.id,
    name: input.name,
    description: input.description ?? `xiaok desktop 智能体 (${binding.providerId}/${binding.modelEntry.model})`,
    instructions: input.instructions ?? '',
    runtimeType: 'xiaok',
    runtimeSource: 'desktop-agent-runtime',
    runtimePath,
    runtimeModel: binding.modelEntry.model,
    provider: null,
    model: null,
    baseUrl: null,
    apiKey: null,
    roles: input.roles ?? ['worker'],
    capabilities: taskCapabilities,
    taskCapabilities,
    outputCapabilities,
    runtimeHealth: {
      state: 'unknown',
      source: 'desktop-agent-runtime',
      taskCapabilities,
      outputCapabilities,
    },
    maxConcurrentTasks: input.maxConcurrentTasks ?? 6,
  };
}

export function diffManagedXiaokAgentPatch(
  current: Record<string, unknown>,
  desired: ManagedXiaokAgentPayload,
): Partial<ManagedXiaokAgentPayload> | null {
  const patch: Partial<ManagedXiaokAgentPayload> = {};

  const scalarFields: Array<keyof ManagedXiaokAgentPayload> = [
    'name',
    'description',
    'instructions',
    'runtimeType',
    'runtimeSource',
    'runtimePath',
    'runtimeModel',
    'provider',
    'model',
    'baseUrl',
    'apiKey',
    'maxConcurrentTasks',
  ];

  for (const field of scalarFields) {
    if ((current as Record<string, unknown>)[field] !== desired[field]) {
      (patch as Record<string, unknown>)[field] = desired[field];
    }
  }

  if (!arraysEqual(current.roles as string[] | undefined, desired.roles)) {
    patch.roles = desired.roles;
  }
  if (!arraysEqual(current.capabilities as string[] | undefined, desired.capabilities)) {
    patch.capabilities = desired.capabilities;
  }
  if (!arraysEqual(current.taskCapabilities as string[] | undefined, desired.taskCapabilities)) {
    patch.taskCapabilities = desired.taskCapabilities;
  }
  if (!arraysEqual(current.outputCapabilities as string[] | undefined, desired.outputCapabilities)) {
    patch.outputCapabilities = desired.outputCapabilities;
  }
  if (JSON.stringify(current.runtimeHealth ?? null) !== JSON.stringify(desired.runtimeHealth)) {
    patch.runtimeHealth = desired.runtimeHealth;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
