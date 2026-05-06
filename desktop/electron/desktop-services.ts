import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform, arch, type } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createAdapter } from '../../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../../src/ai/providers/registry.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRecord, MaterialRole, TaskUnderstanding } from '../../src/runtime/task-host/types.js';
import type { Config, Message, MessageBlock, StreamChunk, ToolCall } from '../../src/types.js';
import { buildToolList, ToolRegistry } from '../../src/ai/tools/index.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, findSkillByCommandName } from '../../src/ai/skills/loader.js';
import { createSkillTool } from '../../src/ai/skills/tool.js';
import { getConfigPath, loadConfig, saveConfig } from '../../src/utils/config.js';
import { createIntentDelegationTools } from '../../src/ai/tools/intent-delegation.js';
import { analyzeIntent as analyzeStageIntent } from '../../src/runtime/stage/executor.js';
import { createEmptySessionIntentLedger, cloneSessionIntentLedger, createIntentLedgerRecord, type SessionIntentLedger, type IntentPlanDraft, type IntentLedgerRecord } from '../../src/runtime/intent-delegation/types.js';
import { DELEGATION_TEMPLATES } from '../../src/ai/intent-delegation/templates.js';

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
    async getSkillDebugConfig() {
      const config = await loadConfig();
      return { enabled: config.skillDebug ?? false };
    },
    async saveSkillDebugConfig(input: { enabled: boolean }) {
      const config = await loadConfig();
      config.skillDebug = input.enabled;
      await saveConfig(config);
      return { enabled: config.skillDebug };
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
        const testTools = [{ name: 'ping', description: 'Test tool', inputSchema: { type: 'object' } }];
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

    // ---- Channel API (shared config.json) ----
    async listChannels(): Promise<Array<{ id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number }>> {
      const config = await loadConfig();
      const channels = (config as unknown as Record<string, unknown>).channels ?? {};
      return Object.entries(channels).map(([key, ch]) => {
        const c = ch as { sendMsgUrl?: string; webhookUrl?: string; inboundMode?: string; enabled?: boolean; name?: string };
        return {
          id: key,
          type: key,
          name: c.name || key,
          webhookUrl: c.webhookUrl || c.sendMsgUrl,
          enabled: c.enabled !== false,
          createdAt: 0,
          updatedAt: 0,
        };
      });
    },
    async createChannel(input: { type: string; name: string; webhookUrl?: string }): Promise<{ id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number }> {
      const config = await loadConfig();
      const raw = config as unknown as Record<string, unknown>;
      if (!raw.channels) raw.channels = {};
      (raw.channels as Record<string, unknown>)[input.type] = {
        name: input.name,
        sendMsgUrl: input.webhookUrl || '',
        inboundMode: 'webhook',
        enabled: true,
      };
      await saveConfig(config);
      return {
        id: input.type,
        type: input.type,
        name: input.name,
        webhookUrl: input.webhookUrl,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },
    async updateChannel(id: string, input: { type?: string; name?: string; webhookUrl?: string; enabled?: boolean }): Promise<{ id: string; type: string; name: string; webhookUrl?: string; enabled: boolean; createdAt: number; updatedAt: number }> {
      const config = await loadConfig();
      const raw = config as unknown as Record<string, unknown>;
      const channels = (raw.channels as Record<string, unknown>) || {};
      const ch = channels[id] as Record<string, unknown> | undefined;
      if (!ch) throw new Error('Channel not found');
      if (input.name !== undefined) ch.name = input.name;
      if (input.webhookUrl !== undefined) ch.sendMsgUrl = input.webhookUrl;
      if (input.enabled !== undefined) ch.enabled = input.enabled;
      await saveConfig(config);
      return {
        id, type: id, name: (ch.name as string) || id,
        webhookUrl: ch.sendMsgUrl as string | undefined,
        enabled: ch.enabled !== false, createdAt: 0, updatedAt: Date.now(),
      };
    },
    async deleteChannel(id: string) {
      const config = await loadConfig();
      const raw = config as unknown as Record<string, unknown>;
      const channels = raw.channels as Record<string, unknown> | undefined;
      if (channels) delete channels[id];
      await saveConfig(config);
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

// Simplified in-memory intent ledger store for Desktop
class InMemoryIntentLedgerStore {
  private ledgers = new Map<string, SessionIntentLedger>();

  async load(sessionId: string): Promise<SessionIntentLedger | null> {
    return this.ledgers.get(sessionId) ?? null;
  }

  async appendIntent(sessionId: string, plan: IntentPlanDraft): Promise<SessionIntentLedger> {
    const intent = createIntentLedgerRecord(plan);
    const ledger: SessionIntentLedger = {
      sessionId,
      instanceId: 'desktop-instance',
      activeIntentId: intent.intentId,
      intents: [intent],
      latestPlan: intent,
      breadcrumbs: [],
      receipt: null,
      salvage: null,
      ownership: { state: 'owned', ownerInstanceId: 'desktop-instance', updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    this.ledgers.set(sessionId, ledger);
    return cloneSessionIntentLedger(ledger);
  }

  async updateIntent(sessionId: string, intentId: string, patch: Record<string, unknown>): Promise<SessionIntentLedger> {
    const ledger = this.ledgers.get(sessionId);
    if (!ledger) throw new Error(`session not found: ${sessionId}`);
    const intent = ledger.intents.find(i => i.intentId === intentId);
    if (!intent) throw new Error(`intent not found: ${intentId}`);
    Object.assign(intent, patch, { updatedAt: Date.now() });
    ledger.updatedAt = Date.now();
    return cloneSessionIntentLedger(ledger);
  }

  async recordBreadcrumb(sessionId: string, input: { intentId: string; stepId: string; status: string; message: string }): Promise<SessionIntentLedger> {
    const ledger = this.ledgers.get(sessionId);
    if (!ledger) throw new Error(`session not found: ${sessionId}`);
    ledger.breadcrumbs.push({
      intentId: input.intentId,
      stepId: input.stepId,
      status: input.status as 'running' | 'blocked' | 'completed' | 'failed',
      message: input.message,
      createdAt: Date.now(),
    });
    ledger.updatedAt = Date.now();
    return cloneSessionIntentLedger(ledger);
  }

  async recordReceipt(sessionId: string, input: { intentId: string; stepId: string; note: string }): Promise<SessionIntentLedger> {
    const ledger = this.ledgers.get(sessionId);
    if (!ledger) throw new Error(`session not found: ${sessionId}`);
    ledger.receipt = { ...input, createdAt: Date.now() };
    ledger.updatedAt = Date.now();
    return cloneSessionIntentLedger(ledger);
  }

  async recordSalvage(sessionId: string, input: { intentId: string; summary: string[]; reason?: string }): Promise<SessionIntentLedger> {
    const ledger = this.ledgers.get(sessionId);
    if (!ledger) throw new Error(`session not found: ${sessionId}`);
    ledger.salvage = { ...input, createdAt: Date.now() };
    ledger.updatedAt = Date.now();
    return cloneSessionIntentLedger(ledger);
  }

  async saveDispatchedIntent(sessionId: string, intent: IntentLedgerRecord): Promise<SessionIntentLedger> {
    const ledger = this.ledgers.get(sessionId);
    if (!ledger) throw new Error(`session not found: ${sessionId}`);
    const idx = ledger.intents.findIndex(i => i.intentId === intent.intentId);
    if (idx >= 0) ledger.intents[idx] = intent;
    ledger.updatedAt = Date.now();
    return cloneSessionIntentLedger(ledger);
  }
}

function buildSystemPrompt(): string {
  const home = homedir();
  const cwd = process.cwd();
  const plat = platform();
  const archStr = arch();
  const ostype = type();
  const defaultDownloads = join(home, 'Downloads');

  return `你是 xiaok desktop 的助手。你可以使用工具来帮助用户完成各种任务。

## 系统信息

- 操作系统: ${ostype} (${plat} ${archStr})
- 用户主目录: ${home}
- 默认下载目录: ${defaultDownloads}
- 当前工作目录: ${cwd}

**重要**: 写入文件时使用上述路径，不要猜测用户名或路径。

你有以下工具可用：
- Read: 读取文件内容
- Write: 创建或覆盖文件
- Edit: 精确编辑文件中的特定内容
- Bash: 执行 shell 命令
- Grep: 搜索文件内容
- Glob: 按模式匹配查找文件
- skill: 调用已安装的 skill
- intent_create: 分析用户意图，生成有序的执行计划
- intent_step_update: 更新当前执行步骤的状态

## 关于用户上传的附件

当用户消息提到"附件"、"文档"、"上传的文档"、"上传的文件"时，指的是用户通过 Plus 按钮上传的文件。
这些文件会被自动导入到工作目录，你可以通过以下方式访问：
1. 先用 Glob 工具查找工作目录下的文件（如 materials 目录）
2. 用 Read 工具读取具体文件内容
3. 如果是图片文件（.png/.jpg），可以用 Bash 打开查看

用户上传文件后，消息中会显示"附件: 文件名"的提示。你应该：
1. 确认收到附件
2. 读取附件内容进行分析
3. 基于附件内容回答问题或执行任务

## 意图识别规则

收到用户请求时，先用 intent_create 工具分析意图：
- raw_intent: 用户原始请求
- normalized_intent: 规范化后的意图描述
- intent_type: generate(生成新内容) / revise(修改已有内容) / summarize(总结) / analyze(分析)
- deliverable: 期望交付物描述
- risk_tier: low/medium/high
- template_id: generate_v1 / revise_v1 / summarize_v1 / analyze_v1

然后用 intent_step_update 跟踪执行进度。

当用户要求执行操作时，直接使用工具完成，不要说"我没有权限"。用户已经授权你使用所有工具。
保持简洁、准确。`;
}

const BASE_SYSTEM_PROMPT = buildSystemPrompt();

function createDesktopModelRunner(): TaskRunner {
  const history: Message[] = [];
  const cwd = process.cwd();
  let skillCatalog = createSkillCatalog(undefined, cwd);
  let skillsLoaded = false;
  const tools = buildToolList();
  const registry = new ToolRegistry({ autoMode: true }, tools);
  const intentStore = new InMemoryIntentLedgerStore();

  // Register intent delegation tools
  const intentTools = createIntentDelegationTools({
    ledgerStore: intentStore as never,
    sessionId: 'desktop-session',
    instanceId: 'desktop-instance',
  });
  for (const tool of intentTools) {
    registry.registerTool(tool);
  }

  return async ({ sessionId, prompt, materials, signal, emitRuntimeEvent }) => {
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

    // Build prompt with materials context
    let materialsContext = '';
    if (materials && materials.length > 0) {
      materialsContext = '\n\n## 用户上传的文件\n\n用户上传了以下文件，你需要读取并处理它们：\n';
      for (const m of materials) {
        // MaterialRecord contains originalName and workspacePath
        materialsContext += `- 文件: ${m.originalName}\n  路径: ${m.workspacePath}\n  类型: ${m.mimeType || '未知'}\n`;
      }
      materialsContext += '\n请先使用 Read 工具读取这些文件的内容，然后根据内容回答用户的问题。\n';
    }

    const config = await loadConfig();
    const adapter = createAdapter(config);
    const skillDebugEnabled = config.skillDebug ?? false;

    // Stage analysis for debug mode
    if (skillDebugEnabled && currentSkills.length > 0) {
      try {
        const stages = analyzeStageIntent(prompt, currentSkills, process.cwd());
        const stageSummary = stages.map(s => `  ${s.id}. ${s.title} (${s.skill})`).join('\n');
        const debugText = `[stage:plan] Detected ${stages.length} stages:\n${stageSummary}`;
        emitRuntimeEvent({ type: 'assistant_delta', sessionId, turnId, intentId, stepId, delta: `${debugText}\n\n` });
      } catch {
        // Stage analysis is optional, don't block execution
      }
    }

    const systemPrompt = skillsContext
      ? `${BASE_SYSTEM_PROMPT}\n\nAvailable skills:\n${skillsContext}`
      : BASE_SYSTEM_PROMPT;
    const userText = materialsContext
      ? `${effectivePrompt}${materialsContext}`
      : effectivePrompt;
    const allToolDefs = registry.getToolDefinitions();
    const messages: Message[] = [...history, {
      role: 'user',
      content: [{ type: 'text', text: userText }],
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
        emitRuntimeEvent({ type: 'pre_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id });
        const result = await registry.executeTool(toolCall.name, toolCall.input);
        const ok = !result.startsWith('Error');
        if (ok) {
          emitRuntimeEvent({ type: 'post_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolResponse: result.slice(0, 10000), toolUseId: toolCall.id });
        } else {
          emitRuntimeEvent({ type: 'post_tool_use_failure', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id, error: result.slice(0, 10000) });
        }
        // Emit file_changed for Write tool so canvas can track generated files
        if (ok && toolCall.name === 'Write' && toolCall.input?.file_path) {
          const filePath = toolCall.input.file_path as string;
          emitRuntimeEvent({ type: 'file_changed', sessionId, filePath, event: 'add' });
          // Emit artifact_recorded so result.artifacts is populated
          const extMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
          const kind = extMatch ? extMatch[1].toLowerCase() : 'other';
          const fileName = filePath.split('/').pop() || filePath;
          emitRuntimeEvent({
            type: 'artifact_recorded',
            sessionId,
            turnId,
            intentId,
            stageId: stepId,
            artifactId: `artifact_${toolCall.id}`,
            label: fileName,
            kind,
            path: filePath,
            creator: 'agent',
          });
        }
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

