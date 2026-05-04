import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdapter } from '../../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../../src/ai/providers/registry.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRole, TaskUnderstanding } from '../../src/runtime/task-host/types.js';
import type { Config, Message, MessageBlock, StreamChunk, ToolCall } from '../../src/types.js';
import { buildToolList, ToolRegistry } from '../../src/ai/tools/index.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, findSkillByCommandName } from '../../src/ai/skills/loader.js';
import { createSkillTool } from '../../src/ai/skills/tool.js';
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
      mkdirSync(options.dataRoot, { recursive: true });
      const record = await materialRegistry.importMaterial({
        taskId: input.taskId,
        sourcePath: input.filePath,
        role: input.role,
        roleSource: 'user',
      });
      return materialRegistry.toView(record);
    },
    async listSkills() {
      const catalog = createSkillCatalog(undefined, process.cwd());
      const skills = await catalog.reload();
      return skills.map(s => ({
        name: s.name,
        aliases: s.aliases ?? [],
        description: s.description,
        source: s.source,
        tier: s.tier,
      }));
    },
    async createTaskWithFiles(input: {
      prompt: string;
      filePaths: string[];
    }): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
      mkdirSync(options.dataRoot, { recursive: true });
      const taskId = `task_${Date.now().toString(36)}`;
      const materials: Array<{ materialId: string; role?: MaterialRole }> = [];
      for (const filePath of input.filePaths) {
        const record = await materialRegistry.importMaterial({
          taskId,
          sourcePath: filePath,
          role: 'customer_material',
          roleSource: 'user',
        });
        materials.push({ materialId: record.materialId, role: record.role });
      }
      return host.createTask({ prompt: input.prompt, materials });
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
    async testProviderConnection(input: { providerId: string; modelId?: string }): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
      const config = await loadConfig();
      const provider = config.providers[input.providerId];
      if (!provider?.apiKey) {
        return { success: false, error: 'API key not configured' };
      }
      try {
        const adapter = createAdapter(config);
        const start = Date.now();
        // Simple test: create a minimal request to verify connection
        const testMessages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }];
        // Use a minimal tools array to reduce overhead
        const testTools = [{ name: 'ping', description: 'Test tool', inputSchema: {} }];
        const systemPrompt = 'Reply with "ok" to verify connection.';
        // Stream just one chunk then cancel
        for await (const _chunk of adapter.stream(testMessages, testTools, systemPrompt)) {
          break; // Just verify first chunk works
        }
        return { success: true, latencyMs: Date.now() - start };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    async listAvailableModelsForProvider(providerId: string) {
      const profile = getProviderProfile(providerId);
      if (profile?.availableModels) {
        return profile.availableModels.map(m => ({
          modelId: m.modelId,
          model: m.model,
          label: m.label,
          capabilities: m.capabilities,
        }));
      }
      return [];
    },
    async deleteProvider(providerId: string): Promise<void> {
      const config = await loadConfig();
      delete config.providers[providerId];
      // Delete associated models
      for (const [modelId, model] of Object.entries(config.models)) {
        if (model.provider === providerId) {
          delete config.models[modelId];
        }
      }
      if (config.defaultProvider === providerId) {
        const remaining = Object.keys(config.providers);
        config.defaultProvider = remaining[0] ?? 'anthropic';
        if (remaining.length === 0) {
          // Ensure at least one provider exists
          const profile = getProviderProfile('anthropic')!;
          config.providers['anthropic'] = {
            type: 'first_party',
            protocol: profile.protocol,
            baseUrl: profile.baseUrl,
            apiKey: undefined,
          };
        }
      }
      if (config.defaultModelId && config.models[config.defaultModelId]?.provider === providerId) {
        // Reset to default model of new default provider
        const profile = getProviderProfile(config.defaultProvider);
        config.defaultModelId = profile?.defaultModel.modelId ?? `${config.defaultProvider}-default`;
      }
      await saveConfig(config);
    },
    async deleteModel(modelId: string): Promise<void> {
      const config = await loadConfig();
      delete config.models[modelId];
      if (config.defaultModelId === modelId) {
        // Reset to provider default
        const profile = getProviderProfile(config.defaultProvider);
        config.defaultModelId = profile?.defaultModel.modelId ?? `${config.defaultProvider}-default`;
      }
      await saveConfig(config);
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

    // ---- Channel API ----
    async listChannels(): Promise<Array<{ id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number }>> {
      const path = join(options.dataRoot, 'channels.json');
      try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return []; }
    },
    async createChannel(input: { type: string; name: string; webhookUrl?: string }): Promise<{ id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number }> {
      const path = join(options.dataRoot, 'channels.json');
      const channels = await loadJsonFile<ChannelRecord[]>(path, []);
      const channel: ChannelRecord = {
        id: crypto.randomUUID(),
        type: input.type as ChannelRecord['type'],
        name: input.name,
        webhookUrl: input.webhookUrl,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      channels.push(channel);
      await saveJsonFile(path, channels);
      return toChannelView(channel);
    },
    async updateChannel(id: string, input: { type?: string; name?: string; webhookUrl?: string; enabled?: boolean }) {
      const path = join(options.dataRoot, 'channels.json');
      const channels = await loadJsonFile<ChannelRecord[]>(path, []);
      const idx = channels.findIndex(c => c.id === id);
      if (idx < 0) throw new Error('Channel not found');
      if (input.type !== undefined) channels[idx].type = input.type as ChannelRecord['type'];
      if (input.name !== undefined) channels[idx].name = input.name;
      if (input.webhookUrl !== undefined) channels[idx].webhookUrl = input.webhookUrl;
      if (input.enabled !== undefined) channels[idx].enabled = input.enabled;
      channels[idx].updatedAt = Date.now();
      await saveJsonFile(path, channels);
      return toChannelView(channels[idx]);
    },
    async deleteChannel(id: string) {
      const path = join(options.dataRoot, 'channels.json');
      const channels = await loadJsonFile<ChannelRecord[]>(path, []);
      await saveJsonFile(path, channels.filter(c => c.id !== id));
    },

    // ---- MCP API ----
    async listMCPInstalls(): Promise<Array<{ id: string; name: string; source: string; command: string; args?: string[]; enabled: boolean; createdAt: number }>> {
      const path = join(options.dataRoot, 'mcp-installs.json');
      try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return []; }
    },
    async createMCPInstall(input: { name: string; source: 'npm' | 'github' | 'local'; command: string; args?: string[] }) {
      const path = join(options.dataRoot, 'mcp-installs.json');
      const installs = await loadJsonFile<MCPRecord[]>(path, []);
      const record: MCPRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        source: input.source,
        command: input.command,
        args: input.args,
        enabled: true,
        createdAt: Date.now(),
      };
      installs.push(record);
      await saveJsonFile(path, installs);
      return toMCPView(record);
    },
    async updateMCPInstall(id: string, input: { name?: string; source?: 'npm' | 'github' | 'local'; command?: string; enabled?: boolean }) {
      const path = join(options.dataRoot, 'mcp-installs.json');
      const installs = await loadJsonFile<MCPRecord[]>(path, []);
      const idx = installs.findIndex(c => c.id === id);
      if (idx < 0) throw new Error('MCP install not found');
      if (input.name !== undefined) installs[idx].name = input.name;
      if (input.source !== undefined) installs[idx].source = input.source;
      if (input.command !== undefined) installs[idx].command = input.command;
      if (input.enabled !== undefined) installs[idx].enabled = input.enabled;
      await saveJsonFile(path, installs);
      return toMCPView(installs[idx]);
    },
    async deleteMCPInstall(id: string) {
      const path = join(options.dataRoot, 'mcp-installs.json');
      const installs = await loadJsonFile<MCPRecord[]>(path, []);
      await saveJsonFile(path, installs.filter(c => c.id !== id));
    },
  };
}

// ---- Channel types ----

interface ChannelRecord {
  id: string;
  type: 'yunzhijia' | 'discord' | 'feishu' | 'qq' | 'qqbot' | 'weixin' | 'telegram';
  name: string;
  webhookUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function toChannelView(c: ChannelRecord): { id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number } {
  return { id: c.id, type: c.type, name: c.name, webhookUrl: c.webhookUrl, enabled: c.enabled, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

// ---- MCP types ----

interface MCPRecord {
  id: string;
  name: string;
  source: 'npm' | 'github' | 'local';
  command: string;
  args?: string[];
  enabled: boolean;
  createdAt: number;
}

function toMCPView(r: MCPRecord): { id: string; name: string; source: string; command: string; args?: string[]; enabled: boolean; createdAt: number } {
  return { id: r.id, name: r.name, source: r.source, command: r.command, args: r.args, enabled: r.enabled, createdAt: r.createdAt };
}

// ---- File helpers ----

async function loadJsonFile<T>(path: string, defaultVal: T): Promise<T> {
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T } catch { return defaultVal; }
}

async function saveJsonFile(path: string, data: unknown): Promise<void> {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// File helpers only

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

const BASE_SYSTEM_PROMPT = `你是 xiaok desktop 的助手。你可以使用工具来帮助用户完成各种任务。

你有以下工具可用：
- Read: 读取文件内容
- Write: 创建或覆盖文件
- Edit: 精确编辑文件中的特定内容
- Bash: 执行 shell 命令
- Grep: 搜索文件内容
- Glob: 按模式匹配查找文件
- skill: 调用已安装的 skill

当用户要求执行操作时，直接使用工具完成，不要说"我没有权限"。用户已经授权你使用所有工具。
保持简洁、准确。`;

function createDesktopModelRunner(): TaskRunner {
  const history: Message[] = [];
  const cwd = process.cwd();
  let skillCatalog = createSkillCatalog(undefined, cwd);
  let skillsLoaded = false;
  const tools = buildToolList();
  const registry = new ToolRegistry({ autoMode: true }, tools);
  return async ({ sessionId, prompt, signal, emitRuntimeEvent }) => {
    const turnId = `turn_${Date.now().toString(36)}`;
    const intentId = `intent_${Date.now().toString(36)}`;
    const stepId = `${intentId}:step:reply`;
    if (!skillsLoaded) {
      try {
        const skills = await skillCatalog.reload();
        if (skills.length > 0) {
          const skillTool = createSkillTool(skillCatalog);
          registry.registerTool(skillTool);
          tools.push(skillTool);
        }
        skillsLoaded = true;
      } catch {
        skillsLoaded = true;
      }
    }
    const currentSkills = skillCatalog.list();
    const skillsContext = currentSkills.length > 0 ? formatSkillsContext(currentSkills) : '';
    const slashMatch = parseSlashCommand(prompt);
    let effectivePrompt = prompt;
    if (slashMatch) {
      const skill = findSkillByCommandName(currentSkills, slashMatch.skillName);
      if (skill) {
        effectivePrompt = slashMatch.rest
          ? `Execute skill "${skill.name}": ${skill.description}\n\nUser input: ${slashMatch.rest}\n\nSkill content:\n${skill.content}`
          : `Execute skill "${skill.name}": ${skill.description}\n\nSkill content:\n${skill.content}`;
      }
    }
    const config = await loadConfig();
    const adapter = createAdapter(config);
    const systemPrompt = skillsContext
      ? `${BASE_SYSTEM_PROMPT}\n\nAvailable skills:\n${skillsContext}`
      : BASE_SYSTEM_PROMPT;
    const allToolDefs = registry.getToolDefinitions();
    const messages: Message[] = [...history, {
      role: 'user',
      content: [{ type: 'text', text: effectivePrompt }],
    }];
    let reply = '';
    let iteration = 0;
    const MAX_ITERATIONS = 20;
    while (iteration < MAX_ITERATIONS) {
      if (signal.aborted) throw new Error('task cancelled');
      iteration++;
      const assistantBlocks: MessageBlock[] = [];
      for await (const chunk of adapter.stream(messages, allToolDefs, systemPrompt)) {
        if (signal.aborted) throw new Error('task cancelled');
        if (chunk.type === 'text') {
          const lastBlock = assistantBlocks[assistantBlocks.length - 1];
          if (lastBlock?.type === 'text') {
            lastBlock.text += chunk.delta;
          } else {
            assistantBlocks.push({ type: 'text', text: chunk.delta });
          }
          reply += chunk.delta;
          emitRuntimeEvent({ type: 'assistant_delta', sessionId, turnId, intentId, stepId, delta: chunk.delta });
        } else if (chunk.type === 'tool_use') {
          assistantBlocks.push({ type: 'tool_use', id: chunk.id, name: chunk.name, input: chunk.input });
        } else if (chunk.type === 'thinking') {
          const lastBlock = assistantBlocks[assistantBlocks.length - 1];
          if (lastBlock?.type === 'thinking') {
            lastBlock.thinking += chunk.delta;
          } else {
            assistantBlocks.push({ type: 'thinking', thinking: chunk.delta });
          }
        }
      }
      messages.push({ role: 'assistant', content: assistantBlocks });
      const toolCalls = assistantBlocks.filter((b): b is ToolCall => b.type === 'tool_use');
      if (toolCalls.length === 0) break;
      const toolResults: MessageBlock[] = [];
      for (const toolCall of toolCalls) {
        if (signal.aborted) throw new Error('task cancelled');
        const result = await registry.executeTool(toolCall.name, toolCall.input);
        const ok = !result.startsWith('Error');
        toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: result.slice(0, 50000), is_error: !ok });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    const note = reply.trim() || '模型没有返回内容。';
    history.push(
      { role: 'user', content: [{ type: 'text', text: effectivePrompt }] },
      { role: 'assistant', content: [{ type: 'text', text: note }] },
    );
    emitRuntimeEvent({ type: 'receipt_emitted', sessionId, turnId, intentId, stepId, note });
  };
}

