import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

import { resolveConfiguredModelBinding } from '../../src/ai/providers/model-binding.js';
import type { Config } from '../../src/types.js';

const DEFAULT_CAPABILITIES = ['coding', 'testing', 'design', 'planning'];

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
  runtimePath: string | null;
  runtimeModel: string;
  provider: 'openai' | 'anthropic';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  roles: string[];
  capabilities: string[];
  maxConcurrentTasks: number;
}

export interface ResolveLocalXiaokRuntimePathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
}

function resolveWindowsXiaokRuntimePath(
  env: NodeJS.ProcessEnv,
  pathExists: (candidate: string) => boolean,
): string | null {
  const candidates = [
    env.KSWARM_XIAOK_PS1_PATH?.trim(),
    env.APPDATA ? win32.join(env.APPDATA, 'npm', 'xiaok.ps1') : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => pathExists(candidate)) ?? null;
}

export function resolveLocalXiaokRuntimePath(
  options: ResolveLocalXiaokRuntimePathOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.exists ?? existsSync;

  const hinted = env.KSWARM_XIAOK_PATH?.trim();
  if (hinted && pathExists(hinted)) {
    return hinted;
  }

  if (platform === 'win32') {
    // Windows desktop agents run through the PowerShell wrapper in
    // windows-xiaok-launch.js, so a global npm xiaok.ps1 launcher is valid.
    return resolveWindowsXiaokRuntimePath(env, pathExists);
  }

  const candidates = [
    env.XIAOK_PATH?.trim(),
    join(homedir(), '.local', 'bin', 'xiaok'),
    '/usr/local/bin/xiaok',
    '/opt/homebrew/bin/xiaok',
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => pathExists(candidate)) ?? null;
}

function toKswarmProvider(protocol: string): 'openai' | 'anthropic' {
  return protocol === 'anthropic' ? 'anthropic' : 'openai';
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
  const provider = toKswarmProvider(binding.providerConfig.protocol);
  const runtimePath = options.runtimePath === undefined ? null : options.runtimePath;

  return {
    id: input.id,
    name: input.name,
    description: input.description ?? `xiaok 智能体 (${binding.providerId}/${binding.modelEntry.model})`,
    instructions: input.instructions ?? '',
    runtimeType: 'xiaok',
    runtimePath,
    runtimeModel: binding.modelEntry.model,
    provider,
    model: binding.modelEntry.model,
    baseUrl: binding.providerConfig.baseUrl,
    apiKey: binding.providerConfig.apiKey,
    roles: input.roles ?? ['worker'],
    capabilities: input.capabilities ?? [...DEFAULT_CAPABILITIES],
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

  return Object.keys(patch).length > 0 ? patch : null;
}
