import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { writeFile as writeFileAsync, readFile as readFileAsync } from 'node:fs/promises';
import { homedir, platform, arch, type } from 'node:os';
import { spawnSync, exec } from 'node:child_process';
import { createAdapter } from '../../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../../src/ai/providers/registry.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRecord, MaterialRole, TaskUnderstanding } from '../../src/runtime/task-host/types.js';
import type { Config, Message, MessageBlock, StreamChunk, ToolCall } from '../../src/types.js';
import { buildToolList, ToolRegistry } from '../../src/ai/tools/index.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, findSkillByCommandName, type SkillMeta } from '../../src/ai/skills/loader.js';
import { createSkillTool } from '../../src/ai/skills/tool.js';
import { getConfigPath, loadConfig, saveConfig } from '../../src/utils/config.js';
import { createIntentDelegationTools } from '../../src/ai/tools/intent-delegation.js';
import { analyzeIntent as analyzeStageIntent } from '../../src/runtime/stage/executor.js';
import { createEmptySessionIntentLedger, cloneSessionIntentLedger, createIntentLedgerRecord, type SessionIntentLedger, type IntentPlanDraft, type IntentLedgerRecord } from '../../src/runtime/intent-delegation/types.js';
import { DELEGATION_TEMPLATES } from '../../src/ai/intent-delegation/templates.js';
import { buildSkillInvocation, createSkillBundleRefsTool, checkBudget, appendTrace } from './skill-runtime.js';
import type { SkillInvocation } from './skill-runtime.js';
import type { ReminderScheduler } from './reminder-scheduler.js';
import type { Tool } from '../../src/types.js';
import { maybePersistToolResult, buildViewForAPI, shouldAutoCompact, compactConversation, getContextLimit } from './context-manager.js';
import { startMcpServerProcess, createStdioMcpTransport } from '../../src/ai/mcp/runtime/server-process.js';
import { createMcpRuntimeClient } from '../../src/ai/mcp/runtime/client.js';
import { buildMcpRuntimeTools } from '../../src/ai/mcp/runtime/tools.js';
import { loadPlugins } from '../../src/platform/plugins/loader.js';
import { UserMemoryStore } from './user-memory.js';

// ---- Skill stats types ----

interface SkillExecRecord {
  id: string;
  skillNames: string[];
  taskId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'success' | 'error' | 'cancelled';
  inputTokens: number;
  outputTokens: number;
  prompt: string;
  triggerType: 'slash_command' | 'tool_call' | 'auto';
}

export interface SkillStats {
  skillName: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastCalledAt: number;
  firstCalledAt: number;
}

const EXEC_FILE = 'skill-exec.json';
const MAX_EXEC_RECORDS = 500;

async function appendExecRecord(dataRoot: string, record: SkillExecRecord): Promise<void> {
  try {
    const filePath = join(dataRoot, EXEC_FILE);
    let records: SkillExecRecord[] = [];
    try {
      const raw = await readFileAsync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) records = parsed;
    } catch { /* file doesn't exist yet */ }
    records.push(record);
    if (records.length > MAX_EXEC_RECORDS) records.splice(0, records.length - MAX_EXEC_RECORDS);
    mkdirSync(dirname(filePath), { recursive: true });
    await writeFileAsync(filePath, JSON.stringify(records));
  } catch { /* silent */ }
}

async function loadExecRecords(dataRoot: string): Promise<SkillExecRecord[]> {
  try {
    const raw = await readFileAsync(join(dataRoot, EXEC_FILE), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch { return []; }
}

function aggregateStats(records: SkillExecRecord[]): SkillStats[] {
  const bySkill = new Map<string, { durations: number[]; successes: number; errors: number; calls: number; inputTokens: number; outputTokens: number; firstAt: number; lastAt: number }>();
  for (const r of records) {
    const names = r.skillNames.length > 0 ? r.skillNames : ['unknown'];
    for (const name of names) {
      const entry = bySkill.get(name) ?? { durations: [], successes: 0, errors: 0, calls: 0, inputTokens: 0, outputTokens: 0, firstAt: r.startTime, lastAt: r.endTime };
      entry.calls++;
      if (r.status === 'success') entry.successes++;
      if (r.status === 'error') entry.errors++;
      entry.durations.push(r.durationMs);
      entry.inputTokens += r.inputTokens;
      entry.outputTokens += r.outputTokens;
      if (r.startTime < entry.firstAt) entry.firstAt = r.startTime;
      if (r.endTime > entry.lastAt) entry.lastAt = r.endTime;
      bySkill.set(name, entry);
    }
  }
  return Array.from(bySkill.entries()).map(([skillName, e]) => {
    const sorted = [...e.durations].sort((a, b) => a - b);
    const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
    return {
      skillName,
      totalCalls: e.calls,
      successCount: e.successes,
      errorCount: e.errors,
      avgDurationMs: e.calls > 0 ? Math.round(e.durations.reduce((a, b) => a + b, 0) / e.calls) : 0,
      p95DurationMs: sorted[p95Idx] ?? 0,
      totalInputTokens: e.inputTokens,
      totalOutputTokens: e.outputTokens,
      lastCalledAt: e.lastAt,
      firstCalledAt: e.firstAt,
    };
  });
}

function extractSkillNames(input: Record<string, unknown>): string[] {
  const names: string[] = [];
  if (typeof input.name === 'string' && input.name.trim()) names.push(input.name.trim());
  if (Array.isArray(input.names)) {
    for (const n of input.names) {
      if (typeof n === 'string' && n.trim() && !names.includes(n.trim())) names.push(n.trim());
    }
  }
  return names.length > 0 ? names : ['unknown'];
}

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
  const tools = buildToolList();
  const registry = new ToolRegistry({ autoMode: true }, tools);
  // [2026-05-10] Intent delegation disabled — passive tracking only, no functional value.
  // See docs/2026-05-10-desktop-intent-delegation-removal.md
  // const intentStore = new InMemoryIntentLedgerStore();
  // intentStore.seedEmpty('desktop-session');
  // const intentTools = createIntentDelegationTools({
  //   ledgerStore: intentStore as never,
  //   sessionId: 'desktop-session',
  //   instanceId: 'desktop-instance',
  // });
  // registry.registerTool(intentTools[0]);

  // Track plugin MCP server runtime state for settings UI
  interface PluginMcpServerState {
    name: string;
    pluginName: string;
    toolCount: number;
    connected: boolean;
    enabled: boolean;
  }
  const pluginMcpServers: PluginMcpServerState[] = [];

  const host = new InProcessTaskRuntimeHost({
    materialRegistry,
    snapshotStore,
    runner: options.runner ?? createDesktopModelRunnerWithRegistry(registry, tools, options.dataRoot),
    now: options.now,
    // Use timestamp + random suffix to ensure unique taskId/sessionId across app restarts
    createTaskId: () => `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createSessionId: () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  });

  return {
    registerReminderScheduler(scheduler: ReminderScheduler) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const reminderTools: Tool[] = [
        {
          permission: 'safe',
          definition: {
            name: 'reminder_create',
            description: '创建一个定时提醒。当用户说"定时任务"、"提醒我"、"过X分钟提醒"等时使用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '提醒内容' },
                schedule_at: { type: 'number', description: '提醒时间戳（毫秒）' },
                timezone: { type: 'string', description: '时区，默认使用系统时区' },
              },
              required: ['content', 'schedule_at'],
            },
          },
          async execute(input) {
            const content = String(input.content ?? '').trim();
            const scheduleAt = Number(input.schedule_at ?? 0);
            if (!content || scheduleAt <= 0) {
              return 'Error: content 和 schedule_at 不能为空';
            }
            const tz = String(input.timezone ?? timezone);
            const record = scheduler.createReminder(content, scheduleAt, tz);
            return JSON.stringify({
              reminderId: record.reminderId,
              status: record.status,
              content: record.content,
              scheduleAt: record.scheduleAt,
              timezone: record.timezone,
              createdAt: record.createdAt,
            }, null, 2);
          },
        },
        {
          permission: 'safe',
          definition: {
            name: 'reminder_list',
            description: '列出所有活跃的提醒',
            inputSchema: { type: 'object', properties: {} },
          },
          async execute() {
            const reminders = scheduler.listReminders();
            return JSON.stringify(reminders.map(r => ({
              reminderId: r.reminderId,
              status: r.status,
              content: r.content,
              scheduleAt: r.scheduleAt,
              timezone: r.timezone,
              createdAt: r.createdAt,
            })), null, 2);
          },
        },
        {
          permission: 'safe',
          definition: {
            name: 'reminder_cancel',
            description: '取消一个提醒',
            inputSchema: {
              type: 'object',
              properties: {
                reminder_id: { type: 'string', description: '提醒 ID' },
              },
              required: ['reminder_id'],
            },
          },
          async execute(input) {
            const id = String(input.reminder_id ?? '').trim();
            if (!id) return 'Error: reminder_id 不能为空';
            const ok = scheduler.cancelReminder(id);
            return ok ? `已取消提醒 ${id}` : `未找到提醒 ${id}`;
          },
        },
      ];
      for (const tool of reminderTools) {
        registry.registerTool(tool);
      }
    },
    registerChannelTools() {
      const channelTools: Tool[] = [
        {
          permission: 'safe',
          definition: {
            name: 'channel_list',
            description: '列出所有配置的消息通道（云之家、Discord、飞书等）。当用户想知道有哪些通道可用时使用。',
            inputSchema: { type: 'object', properties: {} },
          },
          async execute() {
            const config = await loadConfig();
            const raw = config as unknown as Record<string, unknown>;
            const channels = (raw.channels ?? {}) as Record<string, unknown>;
            const list = Object.entries(channels).map(([key, ch]) => {
              const c = ch as { name?: string; sendMsgUrl?: string; webhookUrl?: string; enabled?: boolean };
              return {
                id: key,
                name: c.name || key,
                webhookUrl: c.webhookUrl || c.sendMsgUrl,
                enabled: c.enabled !== false,
              };
            });
            return JSON.stringify(list, null, 2);
          },
        },
        {
          permission: 'safe',
          definition: {
            name: 'channel_send',
            description: '向指定通道发送消息。当用户说"发消息到云之家"、"通知团队"、"发送到飞书"等时使用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                channel_id: { type: 'string', description: '通道 ID（如 yunzhijia、discord、feishu）' },
                message: { type: 'string', description: '要发送的消息内容' },
              },
              required: ['channel_id', 'message'],
            },
          },
          async execute(input) {
            const channelId = String(input.channel_id ?? '').trim();
            const message = String(input.message ?? '').trim();
            if (!channelId || !message) {
              return 'Error: channel_id 和 message 不能为空';
            }

            const config = await loadConfig();
            const raw = config as unknown as Record<string, unknown>;
            const channels = (raw.channels ?? {}) as Record<string, unknown>;
            const ch = channels[channelId] as { sendMsgUrl?: string; webhookUrl?: string } | undefined;
            const url = ch?.sendMsgUrl || ch?.webhookUrl;
            if (!url) {
              return `Error: 通道 ${channelId} 未配置 webhook URL`;
            }

            try {
              const start = Date.now();
              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ msgtype: 'text', text: { content: message } }),
              });
              const latencyMs = Date.now() - start;
              if (!response.ok) {
                return `Error: 发送失败，HTTP ${response.status}`;
              }
              return JSON.stringify({ success: true, latencyMs, channelId, messageLength: message.length }, null, 2);
            } catch (e) {
              return `Error: 发送失败 - ${(e as Error).message}`;
            }
          },
        },
      ];
      for (const tool of channelTools) {
        registry.registerTool(tool);
      }
    },
    registerSkillTools() {
      const skillTools: Tool[] = [
        {
          permission: 'safe',
          definition: {
            name: 'skill_install',
            description: '安装一个技能。当用户说"安装XX技能"、"添加XX功能"、"帮我安装 clawhub 上的技能"时使用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                skill_name: { type: 'string', description: '技能名称（clawhub 上的 slug）' },
              },
              required: ['skill_name'],
            },
          },
          async execute(input) {
            const skillName = String(input.skill_name ?? '').trim();
            if (!skillName) return 'Error: skill_name 不能为空';

            const result = spawnSync('clawhub', ['install', skillName], {
              encoding: 'utf-8',
              timeout: 60000,
              cwd: process.cwd(),
            });
            if (result.error) {
              return `Error: 执行失败 - ${result.error.message}`;
            }
            if (result.status !== 0) {
              const stderr = result.stderr?.trim() || result.stdout?.trim() || '未知错误';
              return `Error: ${stderr.slice(0, 500)}`;
            }
            return JSON.stringify({ success: true, skillName, message: `技能 ${skillName} 已安装` }, null, 2);
          },
        },
        {
          permission: 'safe',
          definition: {
            name: 'skill_uninstall',
            description: '卸载一个技能。当用户说"卸载XX技能"、"删除XX功能"时使用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                skill_name: { type: 'string', description: '技能名称' },
              },
              required: ['skill_name'],
            },
          },
          async execute(input) {
            const skillName = String(input.skill_name ?? '').trim();
            if (!skillName) return 'Error: skill_name 不能为空';

            const result = spawnSync('clawhub', ['uninstall', skillName], {
              encoding: 'utf-8',
              timeout: 30000,
              cwd: process.cwd(),
            });
            if (result.error) {
              return `Error: 执行失败 - ${result.error.message}`;
            }
            if (result.status !== 0) {
              const stderr = result.stderr?.trim() || result.stdout?.trim() || '未知错误';
              return `Error: ${stderr.slice(0, 500)}`;
            }
            return JSON.stringify({ success: true, skillName, message: `技能 ${skillName} 已卸载` }, null, 2);
          },
        },
        {
          permission: 'safe',
          definition: {
            name: 'skill_list',
            description: '列出已安装的技能。当用户问"有哪些技能"、"我安装了什么技能"时使用。',
            inputSchema: { type: 'object', properties: {} },
          },
          async execute() {
            const catalog = createSkillCatalog(undefined, process.cwd());
            const skills = await catalog.reload();
            return JSON.stringify(skills.map(s => ({
              name: s.name,
              aliases: s.aliases ?? [],
              description: s.description,
              source: s.source,
              tier: s.tier,
            })), null, 2);
          },
        },
      ];
      for (const tool of skillTools) {
        registry.registerTool(tool);
      }
    },
    async registerMcpTools(): Promise<{ dispose: () => void }> {
      const disposers: Array<() => void> = [];
      try {
        const pluginsDir = join(homedir(), '.xiaok', 'plugins');
        const plugins = await loadPlugins([pluginsDir]);
        for (const plugin of plugins) {
          if (!plugin.mcpServers?.length) continue;
          for (const server of plugin.mcpServers) {
            if (server.type !== 'stdio') continue;
            try {
              // Use managed venv python if available for Python MCP servers
              const command = (server.command === 'python3' || server.command === 'python')
                ? (process.env.XIAOK_PYTHON_CMD || server.command)
                : server.command;
              const proc = startMcpServerProcess(command, server.args ?? [], {
                cwd: plugin.rootDir,
                env: 'env' in server ? (server as { env?: Record<string, string> }).env : undefined,
              });
              const transport = createStdioMcpTransport(proc.child);
              const client = createMcpRuntimeClient(transport);
              await client.initialize();
              const schemas = await client.listTools();
              const mcpTools = buildMcpRuntimeTools(
                { name: server.name, command: server.command },
                { listTools: () => Promise.resolve(schemas), callTool: (name, input) => client.callTool(name, input), dispose: () => { transport.dispose(); proc.dispose(); } },
                schemas,
              );
              for (const tool of mcpTools) {
                registry.registerTool(tool);
              }
              disposers.push(() => { transport.dispose(); proc.dispose(); });
              pluginMcpServers.push({
                name: server.name,
                pluginName: plugin.name,
                toolCount: schemas.length,
                connected: true,
                enabled: true,
              });
            } catch (e) {
              // MCP server failed to start/connect — record as disconnected
              pluginMcpServers.push({
                name: server.name,
                pluginName: plugin.name,
                toolCount: 0,
                connected: false,
                enabled: true,
              });
            }
          }
        }
      } catch (e) {
        // Plugin loading failed — non-fatal
      }
      return { dispose: () => { for (const d of disposers) { try { d(); } catch {} } } };
    },
    listPluginMcpServers(): PluginMcpServerState[] {
      return pluginMcpServers;
    },
    setPluginMcpServerEnabled(input: { name: string; enabled: boolean }): PluginMcpServerState[] {
      const server = pluginMcpServers.find(s => s.name === input.name);
      if (server) server.enabled = input.enabled;
      return pluginMcpServers;
    },
    async installPlugin(name: string): Promise<{ success: boolean; error?: string }> {
      const xiaokPath = process.execPath.replace(/node$/, 'xiaok');
      // Fallback: use npx xiaok
      const cmd = `xiaok plugin install ${name}`;
      return new Promise((resolve) => {
        exec(cmd, { timeout: 120_000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
            return;
          }
          resolve({ success: true });
        });
      });
    },
    async listAvailablePlugins(): Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>> {
      const pluginsDir = join(homedir(), '.xiaok', 'plugins');
      try {
        const res = await fetch('https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry.json');
        if (!res.ok) return [];
        const data = await res.json() as { plugins: Array<{ name: string; display_name: string; description: string; version: string }> };
        return (data.plugins || []).map(p => ({
          ...p,
          installed: existsSync(join(pluginsDir, p.name, 'plugin.json')),
        }));
      } catch {
        return [];
      }
    },
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
    async installSkill(skillName: string): Promise<{ success: boolean; message: string }> {
      const result = spawnSync('clawhub', ['install', skillName], {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: process.cwd(),
      });
      if (result.error) {
        return { success: false, message: `执行失败: ${result.error.message}` };
      }
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || result.stdout?.trim() || '未知错误';
        return { success: false, message: stderr.slice(0, 500) };
      }
      return { success: true, message: `技能 ${skillName} 已安装` };
    },
    async uninstallSkill(skillName: string): Promise<{ success: boolean; message: string }> {
      const result = spawnSync('clawhub', ['uninstall', skillName], {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: process.cwd(),
      });
      if (result.error) {
        return { success: false, message: `执行失败: ${result.error.message}` };
      }
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || result.stdout?.trim() || '未知错误';
        return { success: false, message: stderr.slice(0, 500) };
      }
      return { success: true, message: `技能 ${skillName} 已卸载` };
    },
    async createTaskWithFiles(input: {
      prompt: string;
      filePaths: string[];
    }): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
      mkdirSync(options.dataRoot, { recursive: true });
      const taskId = `task_${Date.now().toString(36)}`;
      const materials: Array<{ materialId: string; role?: MaterialRole }> = [];
      for (const filePath of input.filePaths) {
        try {
          const record = await materialRegistry.importMaterial({
            taskId,
            sourcePath: filePath,
            role: 'customer_material',
            roleSource: 'user',
          });
          materials.push({ materialId: record.materialId, role: record.role });
        } catch (e) {
        }
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
    async getSkillStats(): Promise<SkillStats[]> {
      try {
        const records = await loadExecRecords(options.dataRoot);
        const stats = aggregateStats(records);
        const timeout = new Promise<SkillStats[]>(resolve => setTimeout(() => resolve([]), 2000));
        return await Promise.race([Promise.resolve(stats), timeout]);
      } catch { return []; }
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
    async testChannel(channelId: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
      const config = await loadConfig();
      const channels = (config as unknown as Record<string, unknown>).channels ?? {};
      const ch = (channels as Record<string, unknown>)[channelId] as { sendMsgUrl?: string; webhookUrl?: string } | undefined;
      const url = ch?.sendMsgUrl || ch?.webhookUrl;
      if (!url) {
        return { success: false, error: '未配置 webhook URL' };
      }
      try {
        const start = Date.now();
        // Send a test ping message
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: 'xiaok 测试连接 ✅' } }),
        });
        const latencyMs = Date.now() - start;
        if (!response.ok) {
          return { success: false, latencyMs, error: `HTTP ${response.status}` };
        }
        return { success: true, latencyMs };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
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

    // Test helpers for AI runner tool registration
    getToolDefinitions() {
      return registry.getToolDefinitions();
    },
    async executeTool(name: string, input: Record<string, unknown>) {
      return registry.executeTool(name, input);
    },
    getDataRoot() {
      return options.dataRoot;
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

  seedEmpty(sessionId: string): void {
    if (this.ledgers.has(sessionId)) return;
    this.ledgers.set(sessionId, createEmptySessionIntentLedger(sessionId));
  }

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
- 当前日期: <currentDate>${new Date().toISOString().slice(0, 10)}</currentDate>

**重要**: 写入文件时使用上述路径，不要猜测用户名或路径。

你有以下工具可用：
- Read: 读取文件内容
- Write: 创建或覆盖文件
- Edit: 精确编辑文件中的特定内容
- Bash: 执行 shell 命令
- Grep: 搜索文件内容
- Glob: 按模式匹配查找文件
- skill: 调用已安装的 skill
- reminder_create: 创建定时提醒（当用户说"定时任务"、"提醒我"、"过X分钟提醒"时使用）
- reminder_list: 列出所有活跃的提醒
- reminder_cancel: 取消一个提醒
- channel_list: 列出所有配置的消息通道（云之家、Discord、飞书等）
- channel_send: 向指定通道发送消息（当用户说"发消息到云之家"、"通知团队"时使用）
- skill_install: 安装一个技能（当用户说"安装XX技能"时使用）
- skill_uninstall: 卸载一个技能（当用户说"卸载XX技能"时使用）
- skill_list: 列出已安装的技能
- report_progress: 向用户报告任务执行计划和进度
- notebook_write: 将重要信息写入长期记忆（用户说"记住"、"帮我记一下"时使用）
- notebook_read: 读取长期记忆笔记本

## 定时提醒功能

xiaok desktop 内置了提醒系统。涉及"定时"、"提醒"、"每天"、"每周"、"定期"的需求，默认使用 reminder_create 工具，不需要写 shell 脚本、cron、launchd 等系统级定时机制。
如果用户明确要求写脚本或使用系统定时，则遵循用户要求。

示例：
- "30分钟后提醒我发日报" → reminder_create(content="发日报", schedule_at=<当前时间+30分钟>)
- "明天早上9点提醒我开会" → reminder_create(content="开会", schedule_at=<明天9点的时间戳>)
- "每天晚上11点同步代码" → reminder_create(content="同步代码到GitHub", schedule_at=<今天23:00的时间戳>)

时间戳使用毫秒级 UNIX timestamp。

## 消息通道功能

xiaok desktop 支持向外部消息通道发送消息。当用户说"发消息到云之家"、"通知飞书群"等时：

1. 先用 channel_list 查看可用的通道
2. 用 channel_send 发送消息到指定通道

示例：
- "发消息到云之家通知团队开会" → channel_list 确认通道 → channel_send(channel_id="yunzhijia", message="开会通知")

## 技能管理功能

xiaok 支持从 ClawHub 安装技能。当用户说"安装XX技能"时：

1. 用 skill_install 安装技能
2. 安装后可以用斜杠命令调用（如 /skill-name）

示例：
- "帮我安装 kai-slide-creator 技能" → skill_install(skill_name="kai-slide-creator")

## 长期记忆

当用户要求你"记住"某些信息（如姓名、偏好、习惯、常用配置等），使用 notebook_write 工具写入笔记本。这些信息会跨对话持久保存。
- "记住我叫张三" → notebook_write(content="用户名字：张三", tags=["个人信息"])
- "以后代码都用 TypeScript" → notebook_write(content="用户偏好：代码使用 TypeScript", tags=["偏好"])

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

## Slash 命令（技能调用）注意事项

当用户使用斜杠命令（例如 /kai-report-creator）调用技能时，技能内容已经直接注入到当前对话上下文中（你会在 prompt 中看到 "Skill content:" 标记后的完整技能指令）。
- 不需要用 glob、find 或 shell 命令搜索技能文件
- 不需要用 read 工具读取 SKILL.md
- 直接按照 Skill content 中的指令执行即可
- 禁止搜索技能目录或相关文件，那会浪费时间和 token
- 绝对不要在 xiaok 的技能目录之外搜索或执行技能（如其他 agent 的目录）

当用户要求执行操作时，直接使用工具完成，不要说"我没有权限"。用户已经授权你使用所有工具。
保持简洁、准确。

## 输出格式规则

在对话输出中，优先使用 Markdown 内联格式，而不是生成 HTML 文件：

- **流程图/架构图/时序图/状态图**：直接用 \`\`\`mermaid 代码块，不要生成 HTML 文件
- **表格**：直接用 Markdown table 语法（| col | col |），不要生成 HTML 文件
- **图表/数据可视化**：用 mermaid xychart，不要生成 HTML 文件
- 只在用户明确要求"生成网页"、"导出 HTML"等场景下才生成 HTML 文件
- 需要画图时直接在回复中嵌入 mermaid 代码块，渲染器会自动渲染为图形

## 任务进度报告

当用户请求涉及多个步骤的非trivial任务时，使用 report_progress 工具向用户报告执行计划和进度：

1. **何时调用**：接到需要多步完成的任务时（如"帮我写方案"、"分析这些文件"、"生成报告"等），先规划 3-6 个步骤，然后调用 report_progress 上报计划
2. **何时不调用**：简单问答（如"今天天气"、"解释一下XX"）、单步操作（如"读取某文件"）不需要调用
3. **更新时机**：每完成一个步骤后，再次调用 report_progress 更新所有步骤的状态
4. **label 要求**：使用面向用户的自然语言描述，不要使用技术术语
5. **多产物规则**：如果用户请求包含多个交付物（如"报告+演示文稿"、"文档+代码"），必须为每个交付物规划独立的步骤。不可在完成一个产物后就停止。

示例：
- 用户说"帮我基于这些材料写一版方案" → 调用 report_progress，steps 包含：收集材料、分析需求、起草方案、校验完整性
- 用户说"做一份报告写一份演示文稿" → steps 必须同时包含"生成报告"和"生成演示文稿"两个独立步骤
- 每完成一步，更新对应 step 的 status 为 completed，下一步为 running`;
}

const BASE_SYSTEM_PROMPT = buildSystemPrompt();

/** Convert tool name to user-friendly label for TaskPanel auto-progress */
function toolNameToLabel(name: string, input?: Record<string, unknown>): string {
  // MCP tools: extract server and action from mcp__server__action pattern
  const mcpMatch = name.match(/^mcp__([^_]+(?:-[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const action = mcpMatch[2].replace(/_/g, ' ');
    return action.charAt(0).toUpperCase() + action.slice(1);
  }
  // Built-in tools
  switch (name) {
    case 'Write': {
      const fp = input?.file_path as string | undefined;
      const fname = fp?.split('/').pop() || '';
      return fname ? `写入 ${fname}` : '写入文件';
    }
    case 'Read': {
      const fp = input?.file_path as string | undefined;
      const fname = fp?.split('/').pop() || '';
      return fname ? `读取 ${fname}` : '读取文件';
    }
    case 'Edit': return '编辑文件';
    case 'bash': return '执行命令';
    case 'Glob': return '搜索文件';
    case 'Grep': return '搜索内容';
    case 'reminder_create': return '创建提醒';
    case 'reminder_list': return '查看提醒';
    case 'channel_send': return '发送消息';
    case 'notebook_write': return '写入记忆';
    case 'notebook_read': return '读取记忆';
    default: return name.replace(/_/g, ' ');
  }
}

/**
 * Collect plugin skill directories as extraRoots for skill catalog.
 * Scans each plugin under ~/.xiaok/plugins for a skills subdirectory.
 */
function getPluginSkillRoots(): string[] {
  const pluginsDir = join(homedir(), '.xiaok', 'plugins');
  if (!existsSync(pluginsDir)) return [];
  const roots: string[] = [];
  try {
    for (const pluginName of readdirSync(pluginsDir)) {
      const skillsDir = join(pluginsDir, pluginName, 'skills');
      if (existsSync(skillsDir)) roots.push(skillsDir);
    }
  } catch { /* ignore */ }
  return roots;
}

function createDesktopModelRunner(dataRoot: string): TaskRunner {
  const cwd = process.cwd();
  const pluginSkillRoots = getPluginSkillRoots();
  let skillCatalog = createSkillCatalog(undefined, cwd, { extraRoots: pluginSkillRoots });
  let skillsLoaded = false;
  const tools = buildToolList();
  const registry = new ToolRegistry({ autoMode: true }, tools);
  // [2026-05-10] Intent delegation disabled — see docs/2026-05-10-desktop-intent-delegation-removal.md
  // const intentStore = new InMemoryIntentLedgerStore();
  // intentStore.seedEmpty('desktop-session');
  // const intentTools = createIntentDelegationTools({
  //   ledgerStore: intentStore as never,
  //   sessionId: 'desktop-session',
  //   instanceId: 'desktop-instance',
  // });
  // registry.registerTool(intentTools[0]);

  // Register report_progress tool (TaskPanel progress reporting)
  const reportProgressTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'report_progress',
      description: '向用户报告任务计划和进度。在开始非trivial任务时调用此工具上报计划，每完成一步更新状态。简单问答不要调用。',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '步骤稳定标识，如 step-1' },
                label: { type: 'string', description: '面向用户的步骤描述，使用自然语言' },
                status: { type: 'string', enum: ['planned', 'running', 'completed', 'blocked', 'failed'] },
              },
              required: ['id', 'label', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    },
    async execute(input) {
      const { steps } = input as { steps: unknown };
      if (!Array.isArray(steps)) {
        return JSON.stringify({ ok: false, error: 'steps must be an array' });
      }
      const validStatuses = new Set(['planned', 'running', 'completed', 'blocked', 'failed']);
      const validated: Array<{ id: string; label: string; status: string }> = [];
      for (const s of steps) {
        if (!s || !s.id || !s.label) continue;
        validated.push({
          id: String(s.id),
          label: String(s.label),
          status: validStatuses.has(s.status) ? s.status : 'planned',
        });
      }
      const base = JSON.stringify({ ok: true, displayed_steps: validated.length, _validated: validated });
      const allCompleted = validated.length > 0 && validated.every(s => s.status === 'completed');
      if (allCompleted) {
        return base + '\n\n⚠️ 所有步骤已标记完成。请回顾用户原始请求，确认是否所有要求的交付物都已生成。如果有遗漏，请追加新步骤继续执行，不要结束任务。';
      }
      return base;
    },
  };
  registry.registerTool(reportProgressTool);

  // Register notebook (memory) tools so Agent can remember things for the user
  const memoryDir = join(dataRoot, 'memories');
  const memoryStore = new UserMemoryStore(memoryDir);

  const notebookWriteTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'notebook_write',
      description: '将重要信息写入用户的长期记忆笔记本。当用户说"记住"、"帮我记一下"、"以后记得"等表达时使用此工具。写入的内容会在后续所有对话中持久存在。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要记住的内容，简洁明确' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签，如 ["偏好", "个人信息"]' },
        },
        required: ['content'],
      },
    },
    async execute(input) {
      const content = String(input.content ?? '').trim();
      if (!content) return 'Error: content 不能为空';
      const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
      const entry = memoryStore.create({ content, tags, source: 'agent' });
      return `已记住: "${content}" (id: ${(entry as any).id})`;
    },
  };

  const notebookReadTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'notebook_read',
      description: '读取用户的长期记忆笔记本。当需要回忆之前记住的信息时使用。',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute() {
      const entries = memoryStore.list();
      if (!Array.isArray(entries) || entries.length === 0) return '笔记本为空，暂无记忆。';
      return JSON.stringify(entries.slice(0, 50).map((e: any) => ({
        id: e.id, content: e.content, tags: e.tags, createdAt: e.createdAt,
      })), null, 2);
    },
  };

  registry.registerTool(notebookWriteTool);
  registry.registerTool(notebookReadTool);

  return async ({ sessionId, prompt, materials, signal, history: hostHistory, emitRuntimeEvent }) => {
    const turnId = `turn_${Date.now().toString(36)}`;
    const intentId = `intent_${Date.now().toString(36)}`;
    const stepId = `${intentId}:step:reply`;
    // Skill stats tracking
    const taskStartTime = Date.now();
    let skillNamesDetected: string[] = [];
    let skillTriggerType: 'slash_command' | 'tool_call' | 'auto' = 'auto';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
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
    let skillInvocation: SkillInvocation | null = null;

    if (slashMatch) {
      const skill = findSkillByCommandName(currentSkills, slashMatch.skillName);
      if (skill) {
        skillNamesDetected = [skill.name];
        skillTriggerType = 'slash_command';
        skillInvocation = buildSkillInvocation(skill.name, skillCatalog, sessionId);
        if (skillInvocation) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skill.name,
            event: 'skill_invoked', details: `slash: ${slashMatch.rest || '(no args)'}`,
          });
        }
        // Inject skill content directly — skill execution works best when model has full instructions
        effectivePrompt = slashMatch.rest
          ? `Execute skill "${skill.name}": ${skill.description}\n\nUser input: ${slashMatch.rest}\n\nSkill content:\n${skill.content}`
          : `Execute skill "${skill.name}": ${skill.description}\n\nSkill content:\n${skill.content}`;
      }
    }

    // Register skill_bundle_refs tool for skill executions
    const bundleTool = createSkillBundleRefsTool(skillCatalog);
    registry.registerTool(bundleTool);

    // Build prompt with materials context - include file contents directly
    let materialsContext = '';
    let fileContentBlocks: MessageBlock[] = [];
    if (materials && materials.length > 0) {
      materialsContext = '\n\n## 用户上传的文件\n\n';
      for (const m of materials) {
        // Read file content directly and include in message
        try {
          const content = readFileSync(m.workspacePath, 'utf-8');
          const ext = extname(m.workspacePath).toLowerCase();

          // Truncate very large files
          const maxLen = 50000;
          const truncated = content.length > maxLen
            ? content.slice(0, maxLen) + `\n...[截断，原文件 ${content.length} 字符]`
            : content;

          materialsContext += `- 文件: ${m.originalName} (${ext}, ${content.length} 字符)\n`;
          fileContentBlocks.push({
            type: 'text',
            text: `\n### ${m.originalName}\n\n${truncated}`,
          });
        } catch (e) {
          materialsContext += `- 文件: ${m.originalName} (读取失败)\n`;
        }
      }
      materialsContext += '\n以下是各文件的具体内容：\n';
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
    // Include file content blocks directly in user message
    const userContent: MessageBlock[] = [
      { type: 'text', text: userText },
      ...fileContentBlocks,
    ];
    const messages: Message[] = [
      ...hostHistory.map((h): Message => ({ role: h.role, content: [{ type: 'text', text: h.content }] })),
      {
      role: 'user',
      content: userContent,
    }];
    let reply = '';
    let iteration = 0;
    const MAX_ITERATIONS = 20;
    const TASK_TIMEOUT_MS = 30 * 60_000;
    const taskDeadline = Date.now() + TASK_TIMEOUT_MS;
    let totalToolCalls = 0;
    let planEmitted = false;
    const autoSteps: Array<{id: string; label: string; status: string}> = [];
    let referenceReads = 0;
    let lastRequestInputTokens = 0;
    const contextLimit = getContextLimit(adapter.getModelName());
    const sessionDir = join(dataRoot, 'sessions', sessionId);

    // Trace: first model turn start
    if (skillInvocation) {
      appendTrace(dataRoot, {
        ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, iteration: 1, event: 'model_turn_start',
      });
    }

    while (iteration < MAX_ITERATIONS) {
      if (signal.aborted) throw new Error('task cancelled');
      if (Date.now() > taskDeadline) throw new Error('任务超时（30分钟），可能是网络不稳定或模型响应过慢。请检查网络后重试。');
      iteration++;

      // Budget check
      if (skillInvocation) {
        const budgetResult = checkBudget(skillInvocation, iteration, totalToolCalls, referenceReads, totalInputTokens, dataRoot);
        if (!budgetResult.ok) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'model_turn_end',
            durationMs: Date.now() - taskStartTime, details: `stopped: ${budgetResult.reason}`,
          });
          break;
        }
      }

      // Trace: subsequent model turn start
      if (skillInvocation && iteration > 1) {
        appendTrace(dataRoot, {
          ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'model_turn_start',
        });
      }

      const assistantBlocks: MessageBlock[] = [];

      // Auto-compact: compress context if approaching limit
      if (iteration > 1 && shouldAutoCompact(lastRequestInputTokens, contextLimit)) {
        await compactConversation(messages, adapter, systemPrompt);
      }

      // Build API view: slice from last boundary + strip old thinking
      const apiMessages = buildViewForAPI(messages, 2);
      lastRequestInputTokens = 0;
      for await (const chunk of adapter.stream(apiMessages, allToolDefs, systemPrompt)) {
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
        } else if (chunk.type === 'usage') {
          try {
            const inputTkns = chunk.usage?.inputTokens ?? 0;
            lastRequestInputTokens = inputTkns;
            totalInputTokens += inputTkns;
            totalOutputTokens += chunk.usage?.outputTokens ?? 0;
          } catch { /* usage capture failure is non-critical */ }
        }
      }
      messages.push({ role: 'assistant', content: assistantBlocks });
      const toolCalls = assistantBlocks.filter((b): b is ToolCall => b.type === 'tool_use');
      if (toolCalls.length === 0) break;
      const toolResults: MessageBlock[] = [];
      for (const toolCall of toolCalls) {
        if (signal.aborted) throw new Error('task cancelled');
        totalToolCalls++;
        // Dynamic TaskPanel: auto-track progress from tool calls (skip internal tools)
        const isInternalTool = toolCall.name === 'report_progress' || toolCall.name === 'skill' || toolCall.name === 'skill_bundle_refs' || toolCall.name === 'skill_list';
        if (!isInternalTool && !planEmitted) {
          planEmitted = true;
        }
        emitRuntimeEvent({ type: 'pre_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id });

        // Trace: tool start
        if (skillInvocation) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'tool_start',
            toolName: toolCall.name,
          });
        }

        // Evidence tracking: count reference reads
        if (toolCall.name === 'Read') {
          referenceReads++;
          if (skillInvocation) {
            appendTrace(dataRoot, {
              ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
              stageId: skillInvocation.stageId, iteration, event: 'tool_end',
              toolName: 'read_reference', details: String((toolCall.input as Record<string, unknown>).file_path || ''),
            });
          }
        }

        // Track skill tool calls for stats and create invocation if missing
        if (toolCall.name === 'skill') {
          try {
            const extracted = extractSkillNames(toolCall.input as Record<string, unknown>);
            if (skillNamesDetected.length === 0 || skillTriggerType === 'auto') {
              skillNamesDetected = extracted;
              if (skillTriggerType === 'auto') skillTriggerType = 'tool_call';
              // Create invocation for tool-called skills too
              if (!skillInvocation) {
                skillInvocation = buildSkillInvocation(extracted[0], skillCatalog, sessionId);
                if (skillInvocation) {
                  appendTrace(dataRoot, {
                    ts: Date.now(), taskId: sessionId, skillName: extracted[0],
                    event: 'skill_invoked', details: 'tool_call',
                  });
                }
              }
            }
          } catch { /* non-critical */ }
        }
        let result = await registry.executeTool(toolCall.name, toolCall.input);
        const ok = !result.startsWith('Error');
        if (ok) {
          emitRuntimeEvent({ type: 'post_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolResponse: result.slice(0, 10000), toolUseId: toolCall.id });
        } else {
          emitRuntimeEvent({ type: 'post_tool_use_failure', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id, error: result.slice(0, 10000) });
        }
        // Dynamic TaskPanel: emit auto-progress from tool calls (skip internal tools)
        if (!isInternalTool) {
          const label = toolNameToLabel(toolCall.name, toolCall.input as Record<string, unknown>);
          autoSteps.push({ id: `auto-${totalToolCalls}`, label, status: ok ? 'completed' : 'failed' });
          emitRuntimeEvent({ type: 'progress_plan_reported', sessionId, steps: autoSteps });
        }

        // Trace: tool end
        if (skillInvocation) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'tool_end',
            toolName: toolCall.name, outputBytes: result.length,
          });
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
          // Evidence: stage artifact
          if (skillInvocation) {
            appendTrace(dataRoot, {
              ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
              stageId: skillInvocation.stageId, iteration, event: 'tool_end',
              toolName: 'artifact_written', details: filePath,
            });
          }
        }
        // Detect MCP tools that return output_path in JSON result (e.g. render_report)
        if (ok && toolCall.name !== 'Write') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.output_path && typeof parsed.output_path === 'string') {
              const filePath = parsed.output_path;
              emitRuntimeEvent({ type: 'file_changed', sessionId, filePath, event: 'add' });
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
          } catch { /* result not JSON, skip */ }
        }
        // Emit progress_plan_reported for TaskPanel
        if (ok && toolCall.name === 'report_progress') {
          try {
            const parsed = JSON.parse(result);
            if (parsed._validated) {
              emitRuntimeEvent({ type: 'progress_plan_reported', sessionId, steps: parsed._validated });
              // Clean internal field from LLM-visible result
              result = JSON.stringify({ ok: true, displayed_steps: parsed.displayed_steps });
            }
          } catch { /* non-critical */ }
        }
        const { content: resultContent } = maybePersistToolResult(result, toolCall.name, toolCall.id, sessionDir);
        toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: resultContent, is_error: !ok });
      }
      messages.push({ role: 'user', content: toolResults });

      // Trace: model turn end
      if (skillInvocation) {
        appendTrace(dataRoot, {
          ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'model_turn_end',
        });
      }
    }
    emitRuntimeEvent({ type: 'receipt_emitted', sessionId, turnId, intentId, stepId, note: reply.trim() || '模型没有返回内容。' });
    // Record skill execution stats
    if (skillNamesDetected.length > 0) {
      try {
        const taskId = sessionId;
        await appendExecRecord(dataRoot, {
          id: `exec_${taskStartTime.toString(36)}`,
          skillNames: skillNamesDetected,
          taskId,
          startTime: taskStartTime,
          endTime: Date.now(),
          durationMs: Date.now() - taskStartTime,
          status: 'success',
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          prompt: prompt.slice(0, 80),
          triggerType: skillTriggerType,
        });
      } catch { /* stats recording failure is non-critical */ }
    }
    // Trace: skill execution complete
    if (skillInvocation) {
      appendTrace(dataRoot, {
        ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, event: 'stage_end',
        durationMs: Date.now() - taskStartTime,
        details: `tool_calls=${totalToolCalls} refs_read=${referenceReads} tokens=${totalInputTokens}`,
      });
    }
  };
}

function createDesktopModelRunnerWithRegistry(registry: ToolRegistry, tools: Tool[], dataRoot: string): TaskRunner {
  const cwd = process.cwd();
  const pluginSkillRoots = getPluginSkillRoots();
  let skillCatalog = createSkillCatalog(undefined, cwd, { extraRoots: pluginSkillRoots });
  let skillsLoaded = false;

  // Register kswarm create_project tool (allows AI to create multi-agent projects from chat)
  const kswarmCreateProjectTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'create_project',
      description: '创建一个多智能体协作项目（KSwarm）。当用户明确要求创建项目、建项目时调用。用户可能同时指定智能体数量、名称和交付物要求。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称，简短明确' },
          goal: { type: 'string', description: '项目目标，描述最终要交付什么' },
          requirements: { type: 'string', description: '补充要求或约束条件（交付物格式、参考资料等）' },
          memberNames: {
            type: 'array',
            items: { type: 'string' },
            description: '用户明确指定的 agent 名称，如 ["claude", "codex"]',
          },
          memberCount: {
            type: 'integer',
            description: '用户期望的智能体总数（不含 PO），未指定则不填',
          },
        },
        required: ['name', 'goal'],
      },
    },
    async execute(input) {
      const { name, goal, requirements, memberNames = [], memberCount = 0 } = input as {
        name: string; goal: string; requirements?: string;
        memberNames?: string[]; memberCount?: number;
      };

      const KSWARM_API = 'http://127.0.0.1:4400';
      const MAX_TOTAL_AGENTS = 10;

      try {
        // 1. 获取现有 agents
        const agentsRes = await fetch(`${KSWARM_API}/agents`);
        if (!agentsRes.ok) return JSON.stringify({ error: 'Cannot fetch agents from kswarm' });
        const { agents } = await agentsRes.json() as { agents: Array<{ id: string; name: string; roles?: string[]; status: string }> };

        // 2. 选 PO agent（优先 xiaok，其次 project_owner，最后第一个）
        const poAgent = agents.find(a => a.id === 'xiaok')?.id
          || agents.find(a => a.id === 'cli-xiaok')?.id
          || agents.find(a => a.roles?.includes('project_owner'))?.id
          || agents[0]?.id;
        if (!poAgent) return JSON.stringify({ error: 'No agents available. Create an agent in kswarm first.' });

        // 3. 解析智能体需求
        const available = agents.filter(a => a.id !== poAgent && a.status !== 'offline');
        const resolved: Array<{ id: string }> = [];

        // 3a. 匹配命名的 agent
        for (const agentName of memberNames) {
          const match = available.find(a => a.name === agentName || a.id === agentName);
          if (match) resolved.push(match);
        }

        // 3b. 补足数量
        if (memberCount > 0) {
          const remaining = available.filter(a => !resolved.some(r => r.id === a.id));
          const needed = Math.max(0, memberCount - resolved.length);
          resolved.push(...remaining.slice(0, needed));

          // 3c. 自动创建 agent（如果不够且未达上限，并发创建）
          const stillNeeded = memberCount - resolved.length;
          const canCreate = Math.min(stillNeeded, MAX_TOTAL_AGENTS - agents.length);
          if (canCreate > 0) {
            const createResults = await Promise.all(
              Array.from({ length: canCreate }, (_, i) =>
                fetch(`${KSWARM_API}/agents`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: `Worker-${agents.length + i + 1}`,
                    roles: ['worker'],
                    instructions: 'You are a KSwarm worker agent. Execute assigned tasks and submit results.',
                  }),
                }).then(r => r.ok ? r.json() : null).catch(() => null)
              )
            );
            for (const newAgent of createResults) {
              if (newAgent) resolved.push({ id: newAgent.id });
            }
          }
        } else if (memberNames.length === 0) {
          // 未指定：用所有可用的
          resolved.push(...available);
        }

        // 4. 创建项目
        const res = await fetch(`${KSWARM_API}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, goal,
            requirements: requirements || '',
            poAgent,
            members: resolved.map(a => a.id),
          }),
        });
        if (!res.ok) return JSON.stringify({ error: `Failed to create project: ${res.status}` });
        const { project } = await res.json() as { project: { id: string; name: string; status: string; createdAt: number } };

        // 5. 返回 project_card 标记
        return JSON.stringify({
          type: 'project_card',
          projectId: project.id,
          name: project.name,
          goal,
          status: project.status,
          createdAt: project.createdAt,
          memberCount: resolved.length,
        });
      } catch (err) {
        return JSON.stringify({ error: `KSwarm service unavailable: ${(err as Error).message}` });
      }
    },
  };
  registry.registerTool(kswarmCreateProjectTool);

  // Register report_progress tool (TaskPanel progress reporting)
  const reportProgressTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'report_progress',
      description: '向用户报告任务计划和进度。在开始非trivial任务时调用此工具上报计划，每完成一步更新状态。简单问答不要调用。',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '步骤稳定标识，如 step-1' },
                label: { type: 'string', description: '面向用户的步骤描述，使用自然语言' },
                status: { type: 'string', enum: ['planned', 'running', 'completed', 'blocked', 'failed'] },
              },
              required: ['id', 'label', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    },
    async execute(input) {
      const { steps } = input as { steps: unknown };
      if (!Array.isArray(steps)) {
        return JSON.stringify({ ok: false, error: 'steps must be an array' });
      }
      const validStatuses = new Set(['planned', 'running', 'completed', 'blocked', 'failed']);
      const validated: Array<{ id: string; label: string; status: string }> = [];
      for (const s of steps) {
        if (!s || !s.id || !s.label) continue;
        validated.push({
          id: String(s.id),
          label: String(s.label),
          status: validStatuses.has(s.status) ? s.status : 'planned',
        });
      }
      // Result is stored; event emission happens in the tool loop via emitRuntimeEvent
      const base = JSON.stringify({ ok: true, displayed_steps: validated.length, _validated: validated });
      const allCompleted = validated.length > 0 && validated.every(s => s.status === 'completed');
      if (allCompleted) {
        return base + '\n\n⚠️ 所有步骤已标记完成。请回顾用户原始请求，确认是否所有要求的交付物都已生成。如果有遗漏，请追加新步骤继续执行，不要结束任务。';
      }
      return base;
    },
  };
  registry.registerTool(reportProgressTool);

  // Register notebook (memory) tools so Agent can remember things for the user
  const memoryDir = join(dataRoot, 'memories');
  const memoryStore = new UserMemoryStore(memoryDir);

  const notebookWriteTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'notebook_write',
      description: '将重要信息写入用户的长期记忆笔记本。当用户说"记住"、"帮我记一下"、"以后记得"等表达时使用此工具。写入的内容会在后续所有对话中持久存在。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要记住的内容，简洁明确' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签，如 ["偏好", "个人信息"]' },
        },
        required: ['content'],
      },
    },
    async execute(input) {
      const content = String(input.content ?? '').trim();
      if (!content) return 'Error: content 不能为空';
      const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
      const entry = memoryStore.create({ content, tags, source: 'agent' });
      return `已记住: "${content}" (id: ${(entry as any).id})`;
    },
  };

  const notebookReadTool: Tool = {
    permission: 'safe',
    definition: {
      name: 'notebook_read',
      description: '读取用户的长期记忆笔记本。当需要回忆之前记住的信息时使用。',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute() {
      const entries = memoryStore.list();
      if (!Array.isArray(entries) || entries.length === 0) return '笔记本为空，暂无记忆。';
      return JSON.stringify(entries.slice(0, 50).map((e: any) => ({
        id: e.id, content: e.content, tags: e.tags, createdAt: e.createdAt,
      })), null, 2);
    },
  };

  registry.registerTool(notebookWriteTool);
  registry.registerTool(notebookReadTool);

  return async ({ sessionId, prompt, materials, signal, history: hostHistory, emitRuntimeEvent }) => {
    const turnId = `turn_${Date.now().toString(36)}`;
    const intentId = `intent_${Date.now().toString(36)}`;
    const stepId = `${intentId}:step:reply`;
    // Skill stats tracking
    const taskStartTime = Date.now();
    let skillNamesDetected: string[] = [];
    let skillTriggerType: 'slash_command' | 'tool_call' | 'auto' = 'auto';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
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
    let skillInvocation: SkillInvocation | null = null;

    if (slashMatch) {
      const skill = findSkillByCommandName(currentSkills, slashMatch.skillName);
      if (skill) {
        skillNamesDetected = [skill.name];
        skillTriggerType = 'slash_command';
        skillInvocation = buildSkillInvocation(skill.name, skillCatalog, sessionId);
        if (skillInvocation) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skill.name,
            event: 'skill_invoked', details: `slash: ${slashMatch.rest || '(no args)'}`,
          });
        }
        // Inject skill content directly — skill execution works best when model has full instructions
        effectivePrompt = slashMatch.rest
          ? `Execute skill "${skill.name}": ${skill.description}\n\nUser input: ${slashMatch.rest}\n\nSkill content:\n${skill.content}`
          : `Execute skill "${skill.name}": ${skill.description}\n\nSkill content:\n${skill.content}`;
      }
    }

    // Register skill_bundle_refs tool for skill executions
    const bundleTool = createSkillBundleRefsTool(skillCatalog);
    registry.registerTool(bundleTool);

    // Build prompt with materials context - include file contents directly
    let materialsContext = '';
    let fileContentBlocks: MessageBlock[] = [];
    if (materials && materials.length > 0) {
      materialsContext = '\n\n## 用户上传的文件\n\n';
      for (const m of materials) {
        // Read file content directly and include in message
        try {
          const content = readFileSync(m.workspacePath, 'utf-8');
          const ext = extname(m.workspacePath).toLowerCase();

          // Truncate very large files
          const maxLen = 50000;
          const truncated = content.length > maxLen
            ? content.slice(0, maxLen) + `\n...[截断，原文件 ${content.length} 字符]`
            : content;

          materialsContext += `- 文件: ${m.originalName} (${ext}, ${content.length} 字符)\n`;
          fileContentBlocks.push({
            type: 'text',
            text: `\n### ${m.originalName}\n\n${truncated}`,
          });
        } catch (e) {
          materialsContext += `- 文件: ${m.originalName} (读取失败)\n`;
        }
      }
      materialsContext += '\n以下是各文件的具体内容：\n';
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
    // Include file content blocks directly in user message
    const userContent: MessageBlock[] = [
      { type: 'text', text: userText },
      ...fileContentBlocks,
    ];
    const messages: Message[] = [
      ...hostHistory.map((h): Message => ({ role: h.role, content: [{ type: 'text', text: h.content }] })),
      {
      role: 'user',
      content: userContent,
    }];
    let reply = '';
    let iteration = 0;
    const MAX_ITERATIONS = 20;
    const TASK_TIMEOUT_MS = 30 * 60_000;
    const taskDeadline = Date.now() + TASK_TIMEOUT_MS;
    let totalToolCalls = 0;
    let planEmitted = false;
    const autoSteps: Array<{id: string; label: string; status: string}> = [];
    let referenceReads = 0;

    // Trace: first model turn start
    if (skillInvocation) {
      appendTrace(dataRoot, {
        ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, iteration: 1, event: 'model_turn_start',
      });
    }

    while (iteration < MAX_ITERATIONS) {
      if (signal.aborted) throw new Error('task cancelled');
      if (Date.now() > taskDeadline) throw new Error('任务超时（30分钟），可能是网络不稳定或模型响应过慢。请检查网络后重试。');
      iteration++;

      // Budget check
      if (skillInvocation) {
        const budgetResult = checkBudget(skillInvocation, iteration, totalToolCalls, referenceReads, totalInputTokens, dataRoot);
        if (!budgetResult.ok) {
          appendTrace(dataRoot, {
            ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'model_turn_end',
            durationMs: Date.now() - taskStartTime, details: `stopped: ${budgetResult.reason}`,
          });
          break;
        }
      }

      // Trace: subsequent model turn start
      if (skillInvocation && iteration > 1) {
        appendTrace(dataRoot, {
          ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'model_turn_start',
        });
      }

      const assistantBlocks: MessageBlock[] = [];

      // Pass full messages to API (no compact in skill runner)
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
        } else if (chunk.type === 'usage') {
          try {
            const inputTkns = chunk.usage?.inputTokens ?? 0;
            totalInputTokens += inputTkns;
            totalOutputTokens += chunk.usage?.outputTokens ?? 0;
          } catch { /* usage capture failure is non-critical */ }
        }
      }
      messages.push({ role: 'assistant', content: assistantBlocks });
      const toolCalls = assistantBlocks.filter((b): b is ToolCall => b.type === 'tool_use');
      if (toolCalls.length === 0) break;
      const toolResults: MessageBlock[] = [];
      for (const toolCall of toolCalls) {
        if (signal.aborted) throw new Error('task cancelled');
        totalToolCalls++;
        // Dynamic TaskPanel: auto-track progress from tool calls (skip internal tools)
        const isInternalTool = toolCall.name === 'report_progress' || toolCall.name === 'skill' || toolCall.name === 'skill_bundle_refs' || toolCall.name === 'skill_list';
        if (!isInternalTool && !planEmitted) {
          planEmitted = true;
        }
        emitRuntimeEvent({ type: 'pre_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id });
        // Track skill tool calls for stats and create invocation if missing
        if (toolCall.name === 'skill') {
          try {
            const extracted = extractSkillNames(toolCall.input as Record<string, unknown>);
            if (skillNamesDetected.length === 0 || skillTriggerType === 'auto') {
              skillNamesDetected = extracted;
              if (skillTriggerType === 'auto') skillTriggerType = 'tool_call';
              // Create invocation for tool-called skills too
              if (!skillInvocation) {
                skillInvocation = buildSkillInvocation(extracted[0], skillCatalog, sessionId);
                if (skillInvocation) {
                  appendTrace(dataRoot, {
                    ts: Date.now(), taskId: sessionId, skillName: extracted[0],
                    event: 'skill_invoked', details: 'tool_call',
                  });
                }
              }
            }
          } catch { /* non-critical */ }
        }
        let result = await registry.executeTool(toolCall.name, toolCall.input);
        const ok = !result.startsWith('Error');
        if (ok) {
          emitRuntimeEvent({ type: 'post_tool_use', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolResponse: result.slice(0, 10000), toolUseId: toolCall.id });
        } else {
          emitRuntimeEvent({ type: 'post_tool_use_failure', sessionId, turnId, toolName: toolCall.name, toolInput: toolCall.input, toolUseId: toolCall.id, error: result.slice(0, 10000) });
        }
        if (ok && toolCall.name === 'Write' && toolCall.input?.file_path) {
          const filePath = toolCall.input.file_path as string;
          emitRuntimeEvent({ type: 'file_changed', sessionId, filePath, event: 'add' });
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
        // Detect MCP tools that return output_path in JSON result (e.g. render_report)
        if (ok && toolCall.name !== 'Write') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.output_path && typeof parsed.output_path === 'string') {
              const filePath = parsed.output_path;
              emitRuntimeEvent({ type: 'file_changed', sessionId, filePath, event: 'add' });
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
          } catch { /* result not JSON, skip */ }
        }
        // Emit progress_plan_reported for TaskPanel
        if (ok && toolCall.name === 'report_progress') {
          try {
            const parsed = JSON.parse(result);
            if (parsed._validated) {
              emitRuntimeEvent({ type: 'progress_plan_reported', sessionId, steps: parsed._validated });
              // Clean internal field from LLM-visible result
              result = JSON.stringify({ ok: true, displayed_steps: parsed.displayed_steps });
            }
          } catch { /* non-critical */ }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: result.slice(0, 50000), is_error: !ok });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    emitRuntimeEvent({ type: 'receipt_emitted', sessionId, turnId, intentId, stepId, note: reply.trim() || '模型没有返回内容。' });
    // Record skill execution stats
    if (skillNamesDetected.length > 0) {
      try {
        const taskId = sessionId;
        await appendExecRecord(dataRoot, {
          id: `exec_${taskStartTime.toString(36)}`,
          skillNames: skillNamesDetected,
          taskId,
          startTime: taskStartTime,
          endTime: Date.now(),
          durationMs: Date.now() - taskStartTime,
          status: 'success',
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          prompt: prompt.slice(0, 80),
          triggerType: skillTriggerType,
        });
      } catch { /* stats recording failure is non-critical */ }
    }
    // Trace: skill execution complete
    if (skillInvocation) {
      appendTrace(dataRoot, {
        ts: Date.now(), taskId: sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, event: 'stage_end',
        durationMs: Date.now() - taskStartTime,
        details: `tool_calls=${totalToolCalls} refs_read=${referenceReads} tokens=${totalInputTokens}`,
      });
    }
  };
}

