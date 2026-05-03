import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createAdapter } from '../../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../../src/ai/providers/registry.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRole } from '../../src/runtime/task-host/types.js';
import type { Config, Message } from '../../src/types.js';
import { getConfigPath, loadConfig, saveConfig } from '../../src/utils/config.js';

export interface DesktopServicesOptions {
  dataRoot: string;
  now?: () => number;
  runner?: TaskRunner;
}

export interface DesktopModelProviderView {
  id: string;
  label: string;
  type: 'first_party' | 'custom';
  protocol: ProtocolId;
  baseUrl?: string;
  apiKeyConfigured: boolean;
}

export interface DesktopModelEntryView {
  id: string;
  provider: string;
  model: string;
  label: string;
  capabilities?: string[];
  isDefault: boolean;
}

export interface DesktopProviderProfileView {
  id: string;
  label: string;
  protocol: ProtocolId;
  baseUrl?: string;
  defaultModelId: string;
  defaultModel: string;
  defaultModelLabel: string;
  capabilities?: string[];
}

export interface DesktopModelConfigSnapshot {
  configPath: string;
  defaultProvider: string;
  defaultModelId: string;
  providers: DesktopModelProviderView[];
  models: DesktopModelEntryView[];
  providerProfiles: DesktopProviderProfileView[];
}

export interface DesktopSaveModelConfigInput {
  providerId: string;
  modelId?: string;
  modelName?: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  protocol?: ProtocolId;
}

export function createDesktopServices(options: DesktopServicesOptions) {
  const materialRegistry = new MaterialRegistry({
    workspaceRoot: join(options.dataRoot, 'workspace'),
    maxBytes: 50 * 1024 * 1024,
    now: options.now,
  });
  const snapshotStore = new FileTaskSnapshotStore(join(options.dataRoot, 'tasks'));
  const host = new InProcessTaskRuntimeHost({
    materialRegistry,
    snapshotStore,
    runner: options.runner ?? createDesktopModelRunner(),
    now: options.now,
  });

  return {
    async importMaterial(input: { taskId: string; filePath: string; role: MaterialRole }) {
      await mkdir(options.dataRoot, { recursive: true });
      const record = await materialRegistry.importMaterial({
        taskId: input.taskId,
        sourcePath: input.filePath,
        role: input.role,
        roleSource: 'user',
      });
      return materialRegistry.toView(record);
    },
    async getModelConfig() {
      return createModelConfigSnapshot(await loadConfig());
    },
    async saveModelConfig(input: DesktopSaveModelConfigInput) {
      const config = await loadConfig();
      const providerId = normalizeProviderId(input.providerId);
      ensureProvider(config, providerId, input);

      if (input.modelId && config.models[input.modelId]) {
        config.defaultModelId = input.modelId;
        config.defaultProvider = config.models[input.modelId].provider;
      } else if (input.modelName?.trim()) {
        const modelName = input.modelName.trim();
        const modelId = `${providerId}-${sanitizeModelIdPart(modelName)}`;
        config.models[modelId] = {
          provider: providerId,
          model: modelName,
          label: input.label?.trim() || modelName,
          capabilities: getProviderProfile(providerId)?.defaultModel.capabilities,
        };
        config.defaultProvider = providerId;
        config.defaultModelId = modelId;
      } else {
        const modelId = ensureDefaultModel(config, providerId);
        config.defaultProvider = providerId;
        config.defaultModelId = modelId;
      }

      await saveConfig(config);
      return createModelConfigSnapshot(config);
    },
    createTask: host.createTask.bind(host),
    subscribeTask: host.subscribeTask.bind(host),
    answerQuestion: host.answerQuestion.bind(host),
    cancelTask: host.cancelTask.bind(host),
    getActiveTask: host.getActiveTask.bind(host),
    recoverTask: host.recoverTask.bind(host),
    async openArtifact(_artifactId: string): Promise<void> {
      // Artifact opening stays behind the semantic API even before rich preview exists.
    },
  };
}

function normalizeProviderId(value: string): string {
  const providerId = value.trim().toLowerCase();
  if (providerId === 'claude') return 'anthropic';
  if (providerId === 'custom') return 'custom-default';
  return providerId || 'anthropic';
}

function sanitizeModelIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function ensureProvider(config: Config, providerId: string, input: DesktopSaveModelConfigInput): void {
  const profile = getProviderProfile(providerId);
  const existing = config.providers[providerId];
  const baseUrl = input.baseUrl?.trim();
  const apiKey = input.apiKey?.trim();

  if (profile) {
    config.providers[providerId] = {
      type: 'first_party',
      protocol: input.protocol ?? existing?.protocol ?? profile.protocol,
      baseUrl: baseUrl || existing?.baseUrl || profile.baseUrl,
      apiKey: apiKey || existing?.apiKey,
      headers: existing?.headers ?? profile.defaultHeaders,
    };
    return;
  }

  const customBaseUrl = baseUrl || existing?.baseUrl;
  if (!customBaseUrl) {
    throw new Error('Custom provider requires a base URL.');
  }
  config.providers[providerId] = {
    type: 'custom',
    protocol: input.protocol ?? existing?.protocol ?? 'openai_legacy',
    baseUrl: customBaseUrl,
    apiKey: apiKey || existing?.apiKey,
    headers: existing?.headers,
  };
}

function ensureDefaultModel(config: Config, providerId: string): string {
  const profile = getProviderProfile(providerId);
  if (profile) {
    const modelId = profile.defaultModel.modelId;
    config.models[modelId] = config.models[modelId] ?? {
      provider: providerId,
      model: profile.defaultModel.model,
      label: profile.defaultModel.label,
      capabilities: profile.defaultModel.capabilities,
    };
    return modelId;
  }

  const existingModel = Object.entries(config.models).find(([, model]) => model.provider === providerId);
  if (existingModel) {
    return existingModel[0];
  }

  const modelId = `${providerId}-default`;
  config.models[modelId] = {
    provider: providerId,
    model: 'default',
    label: `${providerId} Default`,
  };
  return modelId;
}

function createModelConfigSnapshot(config: Config): DesktopModelConfigSnapshot {
  return {
    configPath: getConfigPath(),
    defaultProvider: config.defaultProvider,
    defaultModelId: config.defaultModelId,
    providers: Object.entries(config.providers).map(([id, provider]) => ({
      id,
      label: getProviderProfile(id)?.label ?? id,
      type: provider.type,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKeyConfigured: Boolean(provider.apiKey),
    })),
    models: Object.entries(config.models).map(([id, model]) => ({
      id,
      provider: model.provider,
      model: model.model,
      label: model.label,
      capabilities: model.capabilities,
      isDefault: id === config.defaultModelId,
    })),
    providerProfiles: listProviderProfiles().map((profile) => ({
      id: profile.id,
      label: profile.label,
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      defaultModelId: profile.defaultModel.modelId,
      defaultModel: profile.defaultModel.model,
      defaultModelLabel: profile.defaultModel.label,
      capabilities: profile.defaultModel.capabilities,
    })),
  };
}

function createDesktopModelRunner(): TaskRunner {
  const history: Message[] = [];
  return async ({ sessionId, prompt, signal, emitRuntimeEvent }) => {
    const turnId = `turn_${Date.now().toString(36)}`;
    const intentId = `intent_${Date.now().toString(36)}`;
    const stepId = `${intentId}:step:reply`;
    const config = await loadConfig();
    const adapter = createAdapter(config);
    const messages: Message[] = [...history, {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    }];
    let reply = '';
    for await (const chunk of adapter.stream(messages, [], '你是 xiaok desktop 的助手。直接回答用户问题，保持简洁、准确，不输出内部执行步骤。')) {
      if (signal.aborted) {
        throw new Error('task cancelled');
      }
      if (chunk.type === 'text') {
        reply += chunk.delta;
        emitRuntimeEvent({
          type: 'assistant_delta',
          sessionId,
          turnId,
          intentId,
          stepId,
          delta: chunk.delta,
        });
      }
    }
    const note = reply.trim() || '模型没有返回内容。';
    history.push(
      { role: 'user', content: [{ type: 'text', text: prompt }] },
      { role: 'assistant', content: [{ type: 'text', text: note }] },
    );
    emitRuntimeEvent({
      type: 'receipt_emitted',
      sessionId,
      turnId,
      intentId,
      stepId,
      note,
    });
  };
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new Error('task cancelled');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('task cancelled'));
    }, { once: true });
  });
}
