import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, statSync, realpathSync } from 'node:fs';
import { join, extname, basename, dirname, resolve, relative, isAbsolute } from 'node:path';
import { writeFile as writeFileAsync, readFile as readFileAsync } from 'node:fs/promises';
import { homedir, platform, arch, type } from 'node:os';
import { spawnSync, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createAdapter } from '../../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../../src/ai/providers/registry.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner, type TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRecord, MaterialRole, TaskCreateContext, TaskSnapshot, TaskUnderstanding } from '../../src/runtime/task-host/types.js';
import { diagnoseTraceBundle } from '../../src/runtime/diagnostics/diagnoser.js';
import { diagnoseProjectSnapshot } from '../../src/runtime/diagnostics/project-diagnoser.js';
import type { DiagnosisReport } from '../../src/runtime/diagnostics/types.js';
import { extractMaterialText } from '../../src/runtime/materials/text-extractor.js';
import {
  buildProjectTraceBundleFromKSwarmDetail,
  buildSessionTraceBundleFromSnapshots,
  loadTaskSnapshotsForSession,
  writeTraceBundleToPath,
} from '../../src/runtime/trace/exporter.js';
import type { Config, Message, MessageBlock, ModelAdapter, StreamChunk, ToolCall, ToolDefinition } from '../../src/types.js';
import { buildToolList, ToolRegistry } from '../../src/ai/tools/index.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, findSkillByCommandName, type SkillMeta, type SkillCatalog } from '../../src/ai/skills/loader.js';
import { createSkillTool } from '../../src/ai/skills/tool.js';
import { getConfigDir, getConfigPath, loadConfig, saveConfig } from '../../src/utils/config.js';
import { createIntentDelegationTools } from '../../src/ai/tools/intent-delegation.js';
import { analyzeIntent as analyzeStageIntent } from '../../src/runtime/stage/executor.js';
import { createEmptySessionIntentLedger, cloneSessionIntentLedger, createIntentLedgerRecord, type SessionIntentLedger, type IntentPlanDraft, type IntentLedgerRecord } from '../../src/runtime/intent-delegation/types.js';
import { DELEGATION_TEMPLATES } from '../../src/ai/intent-delegation/templates.js';
import { buildSkillInvocation, createSkillBundleRefsTool, checkBudget, appendTrace } from './skill-runtime.js';
import type { SkillInvocation } from './skill-runtime.js';
import type { Tool } from '../../src/types.js';
import type { TimedActionService } from './timed-action-service.js';
import type { TimedActionTrigger } from './timed-action-types.js';
import { ConnectorsService } from './connectors-service.js';
import { ConnectorsStore } from './connectors-store.js';
import { maybePersistToolResult, buildViewForAPI, shouldAutoCompact, compactConversation, getContextLimit } from './context-manager.js';
import { startMcpServerProcess, createStdioMcpTransport } from '../../src/ai/mcp/runtime/server-process.js';
import { createMcpRuntimeClient } from '../../src/ai/mcp/runtime/client.js';
import { buildMcpRuntimeTools } from '../../src/ai/mcp/runtime/tools.js';
import { classifyMcpStartupError, type McpErrorDetail } from './mcp-error-classifier.js';
import { loadPlugins } from '../../src/platform/plugins/loader.js';
import {
  buildOfficialInstallerExecution,
  getPluginDependencyStatus,
  type ExternalPluginDependency,
  type PluginDependencyStatusOptions,
} from './plugin-dependency-service.js';
import { prelaunchCuaDriverDaemonForMcp, runCuaMcpReadinessSmoke } from './cua-driver-manager.js';
import { UserMemoryStore } from './user-memory.js';
import { createComputerUseTool, type ComputerUseBackend, type ComputerUseUnavailableError } from '../../src/ai/tools/computer-use.js';
import {
  isComputerUseAutoConnectEligibleApp,
  loadComputerUsePreference,
  saveComputerUsePreference,
  type ComputerUseAppIdentity,
  type ComputerUseFailureCode,
  type ComputerUsePreference,
} from './computer-use-capability-service.js';
import { createNotebookTools } from '../../src/ai/tools/notebook.js';
import { createKbTools } from './kb-tools.js';
import { createKbStoreSqlite } from './kb-store-sqlite.js';
import { createKbRetriever } from './kb-retrieval.js';
import type { MemoryStore } from '../../src/ai/memory/store.js';
import type { KSwarmService, KSwarmUnavailableError } from './kswarm-service.js';
import { JsonKSwarmInitialPlanBootstrapStore, KSwarmInitialPlanBootstrapQueue } from './kswarm-initial-plan-bootstrap.js';
import { extractCreatedAgentId, resolveCreateProjectMembers, sanitizeCreateProjectMembers } from './kswarm-project-tool.js';
import {
  createKSwarmGetDynamicWorkflowStatusTool,
  createKSwarmRunDynamicWorkflowScriptTool,
  isResumableWorkflowRunStatus,
  restoreWorkflowScriptBackgroundJob,
} from './kswarm-dynamic-workflow-script-tool.js';
import { XIAOK_PO_SEED_ID, getPreferredPoAgentId } from '../shared/kswarm-seed-contract.js';
import type { KSwarmTaskHandoff, KSwarmWorkflowNodeHandoff } from './kswarm-runtime-bridge.js';
// NOTE: LayeredMemoryStore/resolveLayeredConfig are loaded dynamically
// because they import better-sqlite3 which may not be compatible with the current Electron
// version's native module ABI.
let _LayeredMemoryStoreClass: (typeof import('../../src/ai/memory/layered-store.js'))['LayeredMemoryStore'] | null = null;
let _resolveLayeredConfigFn: (typeof import('../../src/ai/memory/layered-store.js'))['resolveLayeredConfig'] | null = null;
try {
  const mod = await import('../../src/ai/memory/layered-store.js');
  _LayeredMemoryStoreClass = mod.LayeredMemoryStore;
  _resolveLayeredConfigFn = mod.resolveLayeredConfig;
} catch (e) {
  console.warn('[memory] Could not load layered-store module:', (e as Error).message);
}

// ---- Shared memory store (singleton per dataRoot) ----

let _desktopMemoryStore: MemoryStore | null = null;
let _desktopMemoryStoreDataRoot: string | null = null;

type DesktopFallbackMemoryStore = MemoryStore & {
  getStats(): { l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number };
  clearAll(): void;
};

/**
 * Adapt UserMemoryStore (pure-JS, no native deps) to the MemoryStore interface.
 * Used as fallback when better-sqlite3 cannot load in this Electron version.
 */
function createFallbackMemoryStore(dataRoot: string): MemoryStore {
  const memoriesDir = join(dataRoot, 'memories');
  mkdirSync(memoriesDir, { recursive: true });
  const userStore = new UserMemoryStore(memoriesDir);

  const store: DesktopFallbackMemoryStore = {
    async save(record) {
      userStore.create({
        content: record.summary || record.title || '',
        tags: record.tags || [],
        source: record.scope || 'global',
      });
    },
    async listRelevant({ query }) {
      const results = query ? userStore.search(query) : userStore.list().slice(0, 20);
      return results.map(m => ({
        id: m.id,
        scope: 'global' as const,
        title: m.content.slice(0, 80),
        summary: m.content,
        tags: m.tags,
        updatedAt: m.createdAt,
        type: 'user' as const,
      }));
    },
    async search(query, limit = 20) {
      const results = query ? userStore.search(query) : userStore.list();
      return results.slice(0, limit).map(m => ({
        id: m.id,
        scope: 'global' as const,
        title: m.content.slice(0, 80),
        summary: m.content,
        tags: m.tags,
        updatedAt: m.createdAt,
        type: 'user' as const,
      }));
    },
    async delete(id: string, _layer?: number) {
      return userStore.delete(id);
    },
    getStats() {
      const list = userStore.list();
      return { l0: 0, l1: list.length, l2: 0, l3: 0, dbSizeBytes: 0 };
    },
    clearAll() {
      for (const m of userStore.list()) userStore.delete(m.id);
    },
  };
  return store;
}

export function getDesktopMemoryStore(dataRoot: string): MemoryStore {
  if (_desktopMemoryStore && _desktopMemoryStoreDataRoot === dataRoot) {
    return _desktopMemoryStore;
  }

  let store: MemoryStore;

  try {
    if (!_LayeredMemoryStoreClass || !_resolveLayeredConfigFn) {
      throw new Error('layered-store module not available');
    }
    const dbPath = join(dataRoot, 'memory.db');
    const config = _resolveLayeredConfigFn({ dbPath });
    const layeredStore = new _LayeredMemoryStoreClass(config);

    // Migrate from legacy user-memories.json if present
    const legacyPath = join(dataRoot, 'memories', 'user-memories.json');
    if (existsSync(legacyPath)) {
      try {
        const raw = readFileSync(legacyPath, 'utf-8');
        const entries = JSON.parse(raw) as Array<{ id: string; content: string; tags: string[]; createdAt?: number }>;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            layeredStore.save({
              id: entry.id,
              scope: 'global',
              title: (entry.content || '').slice(0, 80),
              summary: entry.content || '',
              tags: entry.tags || [],
              updatedAt: entry.createdAt || Date.now(),
              type: 'user',
            }).catch(() => {});
          }
        }
        // Rename to .migrated to avoid re-import
        renameSync(legacyPath, legacyPath + '.migrated');
      } catch { /* migration is best-effort */ }
    }

    store = layeredStore;
  } catch (err) {
    console.warn('[memory] LayeredMemoryStore unavailable (native module issue), using fallback:', (err as Error).message);
    store = createFallbackMemoryStore(dataRoot);
  }

  _desktopMemoryStore = store;
  _desktopMemoryStoreDataRoot = dataRoot;
  return store;
}
import { buildPythonServerEnv, normalizePythonServerCommand } from './python-runtime.js';
import { buildManagedXiaokAgentPayload } from './managed-xiaok-agent.js';

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
  } catch (e) { console.warn('[exec-record] append failed:', (e as Error).message) }
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
  kswarmService: KSwarmService;
  pluginRootDir?: string;
  pluginDependencies?: Array<{ pluginName: string; dependency: ExternalPluginDependency }>;
  pluginDependencyStatusOptions?: PluginDependencyStatusOptions;
  computerUseAppIdentity?: ComputerUseAppIdentity;
  computerUsePreferencePath?: string;
}

const CUA_DRIVER_DEPENDENCY: ExternalPluginDependency = {
  id: 'cua-driver',
  kind: 'macos_app_cli',
  displayName: 'CUA Driver',
  envOverride: 'XIAOK_CUA_DRIVER_CMD',
  binaryCandidates: ['~/.local/bin/cua-driver', '/usr/local/bin/cua-driver', '/opt/homebrew/bin/cua-driver', 'cua-driver'],
  minVersion: '0.1.0',
  install: {
    kind: 'official_installer',
    sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
    sourceAllowlist: ['https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh'],
    requiresUserConfirmation: true,
  },
  update: {
    kind: 'official_installer',
    sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
    sourceAllowlist: ['https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh'],
    requiresUserConfirmation: true,
  },
  health: {
    version: ['~/.local/bin/cua-driver', '--version'],
    status: ['~/.local/bin/cua-driver', 'status'],
  },
  mcp: {
    serverName: 'cua-driver',
    command: '~/.local/bin/cua-driver',
    // Let cua-driver proxy through CuaDriver.app so macOS TCC attributes
    // Accessibility and Screen Recording to com.trycua.driver, not xiaok.
    args: ['mcp'],
    requiresUserActivation: true,
  },
};

export function createTimedActionTools(service: TimedActionService, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): Tool[] {
  return [
    {
      permission: 'safe',
      definition: {
        name: 'reminder_create',
        description: '创建到点通知提醒。只通知用户，不会自动执行 AI 任务；如果用户要小K未来检查/执行/生成，请使用 scheduled_task_create。',
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
        const record = service.createReminder(content, scheduleAt, tz);
        return JSON.stringify({
          reminderId: record.reminderId,
          status: record.status,
          content: record.content,
          scheduleAt: record.scheduleAt,
          timezone: record.timezone,
          createdAt: record.createdAt,
          note: 'notification only; will not run AI tasks',
        }, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'reminder_list',
        description: '列出所有活跃的通知提醒',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() {
        return JSON.stringify(service.listReminders().map(r => ({
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
        description: '取消一个通知提醒',
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
        const ok = service.cancelReminder(id);
        return ok ? `已取消提醒 ${id}` : `未找到提醒 ${id}`;
      },
    },
    {
      permission: 'write',
      definition: {
        name: 'scheduled_task_create',
        description: '创建会在未来自动执行 AI 任务的定时任务。适用于“你/小K稍后检查/执行/生成”或“每隔N分钟检查直到完成”；不要用于单纯通知提醒。',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名称' },
            prompt: { type: 'string', description: '到期时创建 AI 任务使用的 prompt；停止条件满足时应要求调用 scheduled_task_cancel；agent 创建的 interval 临时任务取消时会删除' },
            frequency: { type: 'string', enum: ['once', 'interval', 'daily', 'weekdays', 'weekly'] },
            schedule_at: { type: 'number', description: 'once 任务的执行时间戳（毫秒）' },
            interval_minutes: { type: 'number', description: 'interval 任务的分钟间隔，agent 创建时最小 5' },
            hour: { type: 'number', description: 'daily/weekdays/weekly 执行小时 0-23' },
            minute: { type: 'number', description: 'daily/weekdays/weekly 执行分钟 0-59' },
            day_of_week: { type: 'number', description: 'weekly 星期几，0=周日，1=周一' },
            max_runs: { type: 'number', description: '最大运行次数' },
            expires_at: { type: 'number', description: '过期时间戳（毫秒）' },
          },
          required: ['name', 'prompt', 'frequency'],
        },
      },
      async execute(input) {
        const name = String(input.name ?? '').trim();
        const prompt = String(input.prompt ?? '').trim();
        if (!name || !prompt) return 'Error: name 和 prompt 不能为空';
        let trigger: TimedActionTrigger;
        try {
          trigger = parseScheduledTaskTrigger(input);
        } catch (error) {
          return `Error: ${(error as Error).message}`;
        }
        try {
          const task = service.createScheduledTask({
            name,
            prompt,
            trigger,
            source: 'agent',
            policy: {
              maxRuns: input.max_runs === undefined ? undefined : Number(input.max_runs),
              expiresAt: input.expires_at === undefined ? undefined : Number(input.expires_at),
            },
          });
          const action = service.getActions().find(a => a.id === task.id);
          return JSON.stringify({
            ok: true,
            taskId: task.id,
            name: task.name,
            frequency: trigger.kind,
            nextRunAt: task.nextRunAt,
            maxRuns: action?.policy.maxRuns,
            expiresAt: action?.policy.expiresAt,
            note: 'will create AI tasks automatically; call scheduled_task_cancel when stop condition is met; agent interval tasks are deleted on cancel',
          }, null, 2);
        } catch (error) {
          return `Error: ${(error as Error).message}`;
        }
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'scheduled_task_list',
        description: '列出会自动执行 AI 任务的定时任务',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() {
        return JSON.stringify(service.listScheduledTasks(), null, 2);
      },
    },
    {
      permission: 'write',
      definition: {
        name: 'scheduled_task_cancel',
        description: '取消一个由 agent 自己创建的临时定时任务（interval 类型会直接删除）。**严禁取消用户创建的周期任务**（daily/weekly/cron 等 source=user 的任务），即使你认为它已经完成或不再需要——用户的周期任务由用户自己管理。',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'scheduled_task_create 返回的 taskId' },
            reason: { type: 'string', description: '取消原因' },
          },
          required: ['task_id'],
        },
      },
      async execute(input) {
        const id = String(input.task_id ?? '').trim();
        if (!id) return 'Error: task_id 不能为空';
        const target = service.listScheduledTasks().find(t => t.id === id);
        if (target && target.source === 'user') {
          return `Error: 不允许取消用户创建的定时任务 ${id}（"${target.name}"）。这类任务只能由用户在界面上取消。`;
        }
        const ok = service.cancelScheduledTask(id, String(input.reason ?? '').trim() || undefined, 'agent');
        return ok ? `已取消自动任务 ${id}` : `未找到自动任务 ${id}`;
      },
    },
  ];
}

function parseScheduledTaskTrigger(input: Record<string, unknown>): TimedActionTrigger {
  const frequency = String(input.frequency ?? '').trim();
  if (frequency === 'once') {
    const at = Number(input.schedule_at ?? 0);
    if (!Number.isFinite(at) || at <= 0) throw new Error('schedule_at 必须是有效时间戳');
    return { kind: 'once', at };
  }
  if (frequency === 'interval') {
    const intervalMinutes = Number(input.interval_minutes ?? 0);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error('interval_minutes 必须大于 0');
    return { kind: 'interval', intervalMinutes };
  }
  if (frequency === 'daily' || frequency === 'weekdays') {
    return {
      kind: frequency,
      hour: Number(input.hour ?? 9),
      minute: Number(input.minute ?? 0),
    };
  }
  if (frequency === 'weekly') {
    return {
      kind: 'weekly',
      dayOfWeek: Number(input.day_of_week ?? 1),
      hour: Number(input.hour ?? 9),
      minute: Number(input.minute ?? 0),
    };
  }
  throw new Error('frequency 必须是 once、interval、daily、weekdays 或 weekly');
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
  availableModels?: { modelId: string; model: string; label: string; capabilities?: string[] }[];
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
  const initialPlanBootstrapStore = new JsonKSwarmInitialPlanBootstrapStore(options.dataRoot);
  const initialPlanBootstrapQueue = new KSwarmInitialPlanBootstrapQueue(
    initialPlanBootstrapStore,
    input => bootstrapKSwarmInitialPlan(input),
    { now: options.now }
  );
  const kswarmCreateProjectToolOptions: KSwarmCreateProjectToolOptions = {
    enqueuePlanBootstrap: input => initialPlanBootstrapQueue.enqueue(input),
  };
  registerKSwarmTools(registry, options.kswarmService, kswarmCreateProjectToolOptions);

  // Register KB (knowledge base) tools on the main registry
  try {
    const kbUserData = process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'xiaok-desktop')
      : join(homedir(), 'Library', 'Application Support', 'xiaok-desktop');
    const kbDbPath = join(kbUserData, 'knowledge.db');
    const kbStore = createKbStoreSqlite(kbDbPath);
    const kbRetriever = createKbRetriever({ db: (kbStore as any)._db ?? ({} as any), embedFn: () => null });
    for (const tool of createKbTools(kbStore, kbRetriever)) {
      registry.registerTool(tool);
    }
  } catch (e) {
    console.error('[KB] tool registration failed:', e);
  }

  initialPlanBootstrapQueue.startRecovery();
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
    lastError?: string;
    lastErrorDetail?: McpErrorDetail;
  }
  const pluginMcpServers: PluginMcpServerState[] = [];
  const pluginMcpDisposers: Array<{ name: string; pluginName: string; dispose: () => void }> = [];
  const pluginDependencies = options.pluginDependencies ?? [
    { pluginName: 'cua-computer-use', dependency: CUA_DRIVER_DEPENDENCY },
  ];
  const pluginRootDir = options.pluginRootDir ?? getConfigDir('plugins');
  const computerUsePreferencePath = options.computerUsePreferencePath ?? join(options.dataRoot, 'computer-use-state.json');
  let computerUsePreference = loadComputerUsePreference(computerUsePreferencePath);
  const computerUseAppIdentity = options.computerUseAppIdentity ?? resolveComputerUseAppIdentity();
  let computerUseBackend: ComputerUseBackend | null = null;
  let computerUseUnavailableError: ComputerUseUnavailableError = computerUsePreference.lastFailureCode === 'COMPUTER_USE_DISABLED_BY_USER'
    ? buildComputerUseDisabledUnavailableError()
    : buildComputerUseNeedsEnablementError();

  registry.registerTool(createComputerUseTool({
    getUnavailableError: () => computerUseBackend ? null : computerUseUnavailableError,
    onRecoverableError: (error) => {
      markComputerUseRecoverableFailure(error);
    },
    callToolResult: (name, input) => {
      if (!computerUseBackend) {
        return Promise.resolve({
          text: computerUseUnavailableError.message,
          images: [],
          isError: true,
          summary: computerUseUnavailableError.code,
        });
      }
      return computerUseBackend.callToolResult(name, input);
    },
  }));

  const findPluginDependency = (pluginName: string, dependencyId: string) =>
    pluginDependencies.find((entry) => entry.pluginName === pluginName && entry.dependency.id === dependencyId);

  const findPluginDependencyForMcpServer = (pluginName: string, serverName: string) =>
    pluginDependencies.find((entry) => entry.pluginName === pluginName && entry.dependency.mcp?.serverName === serverName);

  const isPluginInstalled = (pluginName: string) =>
    existsSync(join(pluginRootDir, pluginName, 'plugin.json'));

  const getDependencyStatusView = async (entry: { pluginName: string; dependency: ExternalPluginDependency }) => ({
    pluginName: entry.pluginName,
    pluginInstalled: isPluginInstalled(entry.pluginName),
    ...(await getPluginDependencyStatus(entry.dependency, options.pluginDependencyStatusOptions)),
  });

  const resolvePluginMcpLaunch = async (
    pluginName: string,
    serverName: string,
    fallbackCommand: string,
    fallbackArgs: string[],
  ): Promise<{ command: string; args: string[] }> => {
    const dependency = findPluginDependencyForMcpServer(pluginName, serverName);
    if (!dependency) return { command: fallbackCommand, args: fallbackArgs };
    const status = await getDependencyStatusView(dependency);
    if (status.state !== 'ready' || !status.resolvedBinary) {
      throw new Error(`Plugin dependency is not ready: ${status.code}`);
    }
    return {
      command: status.resolvedBinary,
      args: dependency.dependency.mcp?.args ?? fallbackArgs,
    };
  };

  async function runDependencyCommand(
    command: string,
    args: string[],
    timeout = 300_000,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout });
    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) {
      return { success: false, error: result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}` };
    }
    return { success: true, output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() };
  }

  const persistComputerUsePreference = (): void => {
    try {
      saveComputerUsePreference(computerUsePreferencePath, computerUsePreference);
    } catch {
      // Preference persistence is best-effort; runtime state still drives the current session.
    }
  };

  const recordComputerUseReady = (source: 'user_enable' | 'auto_recovery'): void => {
    const {
      lastFailureCode: _lastFailureCode,
      autoConnectSuspendedReason: _autoConnectSuspendedReason,
      ...preferenceWithoutFailure
    } = computerUsePreference;
    computerUsePreference = {
      ...preferenceWithoutFailure,
      schemaVersion: 1,
      enabledByUser: source === 'user_enable' ? true : computerUsePreference.enabledByUser,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: options.now?.() ?? Date.now(),
      ...(computerUseAppIdentity.bundleId ? { lastSuccessfulAppBundleId: computerUseAppIdentity.bundleId } : {}),
      ...(computerUseAppIdentity.appPath ? { lastSuccessfulAppPath: computerUseAppIdentity.appPath } : {}),
      ...(computerUseAppIdentity.teamId ? { lastSuccessfulTeamId: computerUseAppIdentity.teamId } : {}),
      launchMethod: 'open_app',
    };
    persistComputerUsePreference();
  };

  const recordComputerUseFailure = (code: ComputerUseFailureCode): void => {
    const suspendsAutoConnect = code === 'COMPUTER_USE_NEEDS_ACCESSIBILITY'
      || code === 'COMPUTER_USE_NEEDS_SCREEN_RECORDING'
      || code === 'COMPUTER_USE_ATTRIBUTION_MISMATCH'
      || code === 'COMPUTER_USE_PERMISSION_INVALID'
      || code === 'COMPUTER_USE_DRIVER_MISSING'
      || code === 'COMPUTER_USE_PLUGIN_MISSING';
    computerUsePreference = {
      ...computerUsePreference,
      schemaVersion: 1,
      lastFailureCode: code,
      ...(suspendsAutoConnect ? { autoConnectSuspendedReason: code } : {}),
    };
    persistComputerUsePreference();
  };

  const disposePluginMcpServers = (predicate: (server: { name: string; pluginName: string }) => boolean = () => true): void => {
    for (let index = pluginMcpDisposers.length - 1; index >= 0; index -= 1) {
      const entry = pluginMcpDisposers[index];
      if (!predicate(entry)) continue;
      try {
        entry.dispose();
      } catch {}
      pluginMcpDisposers.splice(index, 1);
    }
  };

  function markComputerUseRecoverableFailure(error: ComputerUseUnavailableError): void {
    disposePluginMcpServers((server) => server.name === 'cua-driver' && server.pluginName === 'cua-computer-use');
    computerUseBackend = null;
    computerUseUnavailableError = error;
    recordComputerUseFailure(error.code as ComputerUseFailureCode);

    const existing = pluginMcpServers.find((entry) => entry.name === 'cua-driver' && entry.pluginName === 'cua-computer-use');
    if (existing) {
      existing.connected = false;
      existing.enabled = true;
      existing.toolCount = 0;
      existing.lastError = error.message;
      return;
    }

    pluginMcpServers.push({
      name: 'cua-driver',
      pluginName: 'cua-computer-use',
      toolCount: 0,
      connected: false,
      enabled: true,
      lastError: error.message,
    });
  }

  const reconnectPluginMcpServers = async (
    options: { userInitiated?: boolean; targetServerName?: string; autoConnectComputerUse?: boolean } = {},
  ): Promise<PluginMcpServerState[]> => {
    const matchesTarget = (server: { name: string; pluginName: string }) =>
      !options.targetServerName || server.name === options.targetServerName;
    disposePluginMcpServers(matchesTarget);
    for (let index = pluginMcpServers.length - 1; index >= 0; index -= 1) {
      if (matchesTarget(pluginMcpServers[index])) {
        pluginMcpServers.splice(index, 1);
      }
    }
    if (!options.targetServerName || options.targetServerName === 'cua-driver') {
      computerUseBackend = null;
      computerUseUnavailableError = options.userInitiated
        ? { code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT', message: 'Computer Use 正在连接或连接失败。', userAction: { type: 'reconnect_computer_use', label: '重新连接' } }
        : buildComputerUseNeedsEnablementError();
    }
    try {
      const plugins = await loadPlugins([pluginRootDir]);
      for (const plugin of plugins) {
        if (!plugin.mcpServers?.length) continue;
        for (const server of plugin.mcpServers) {
          if (server.type !== 'stdio') continue;
          if (!matchesTarget({ name: server.name, pluginName: plugin.name })) continue;
          const dependency = findPluginDependencyForMcpServer(plugin.name, server.name);
          const mayConnectUserActivatedServer = options.userInitiated
            || (server.name === 'cua-driver' && options.autoConnectComputerUse === true);
          if (dependency?.dependency.mcp?.requiresUserActivation && !mayConnectUserActivatedServer) {
            if (server.name === 'cua-driver') {
              computerUseUnavailableError = buildComputerUseNeedsEnablementError();
            }
            pluginMcpServers.push({
              name: server.name,
              pluginName: plugin.name,
              toolCount: 0,
              connected: false,
              enabled: false,
              lastError: '等待用户点击连接，避免自动触发 macOS 权限弹窗',
            });
            continue;
          }
          let transportRef: { getStderrTail(): string } | null = null;
          let resolvedCommand: string | undefined;
          try {
            const launch = await resolvePluginMcpLaunch(plugin.name, server.name, server.command, server.args ?? []);
            // Use managed venv python if available for Python MCP servers
            const isPythonServer = launch.command === 'python3' || launch.command === 'python';
            const isNodeServer = launch.command === 'node' || launch.command === 'nodejs';
            const command = isPythonServer
              ? normalizePythonServerCommand(launch.command, process.platform, process.env.XIAOK_PYTHON_CMD)
              : isNodeServer
                ? (process.env.XIAOK_NODE_CMD || process.execPath)
                : launch.command;
            resolvedCommand = command;
            prelaunchCuaDriverDaemonForMcp(server.name, command);
            const baseEnv = 'env' in server ? (server as { env?: Record<string, string> }).env : undefined;
            const runtimeEnv = isPythonServer
              ? buildPythonServerEnv(baseEnv)
              : isNodeServer && !process.env.XIAOK_NODE_CMD && process.versions.electron
                ? { ...(baseEnv ?? {}), ELECTRON_RUN_AS_NODE: '1' }
                : baseEnv;
            const proc = startMcpServerProcess(command, launch.args, {
              cwd: plugin.rootDir,
              env: runtimeEnv,
            });
            const transport = createStdioMcpTransport(proc.child);
            transportRef = transport;
            const client = createMcpRuntimeClient(transport);
            await client.initialize();
            const schemas = await client.listTools();
            let mcpTools: Tool[];
            let toolCount = 0;
            if (server.name === 'cua-driver') {
              const readiness = await runCuaMcpReadinessSmoke({
                schemas,
                callToolResult: (name, input) => client.callToolResult(name, input),
              });
              if (!readiness.ready) {
                transport.dispose();
                proc.dispose();
                throw new Error(`CUA MCP readiness failed: ${readiness.code}`);
              }
              computerUseBackend = { callToolResult: (name, input) => client.callToolResult(name, input) };
              if (options.userInitiated || options.autoConnectComputerUse) {
                recordComputerUseReady(options.userInitiated ? 'user_enable' : 'auto_recovery');
              }
              mcpTools = [];
              toolCount = 1;
            } else {
              mcpTools = buildMcpRuntimeTools(
                { name: server.name, command: server.command },
                { listTools: () => Promise.resolve(schemas), callTool: (name, input) => client.callTool(name, input), dispose: () => { transport.dispose(); proc.dispose(); } },
                schemas,
              );
              toolCount = mcpTools.length;
            }
            for (const tool of mcpTools) {
              registry.registerTool(tool);
            }
            pluginMcpDisposers.push({
              name: server.name,
              pluginName: plugin.name,
              dispose: () => {
                if (server.name === 'cua-driver') {
                  computerUseBackend = null;
                  computerUseUnavailableError = buildComputerUseNeedsEnablementError();
                }
                transport.dispose();
                proc.dispose();
              },
            });
            pluginMcpServers.push({
              name: server.name,
              pluginName: plugin.name,
              toolCount,
              connected: true,
              enabled: true,
            });
          } catch (e) {
            const baseMessage = e instanceof Error ? e.message : String(e);
            const stderrTail = transportRef?.getStderrTail() ?? '';
            const combinedDetail = stderrTail ? `${baseMessage}\n${stderrTail}` : baseMessage;
            const errorDetail = classifyMcpStartupError(combinedDetail, resolvedCommand);
            if (server.name === 'cua-driver') {
              computerUseBackend = null;
              computerUseUnavailableError = mapComputerUseStartupError(e);
              if (options.userInitiated || options.autoConnectComputerUse) {
                recordComputerUseFailure(computerUseUnavailableError.code as ComputerUseFailureCode);
              }
            }
            // MCP server failed to start/connect — record as disconnected
            pluginMcpServers.push({
              name: server.name,
              pluginName: plugin.name,
              toolCount: 0,
              connected: false,
              enabled: true,
              lastError: baseMessage,
              lastErrorDetail: errorDetail,
            });
          }
        }
      }
    } catch (e) {
      // Plugin loading failed — non-fatal
    }
    return pluginMcpServers;
  };

  const getComputerUseCapabilityStatus = (): { state: string; mcpConnected: boolean; wrapperReady: boolean; lastError?: string } => {
    const server = pluginMcpServers.find((entry) => entry.name === 'cua-driver' && entry.pluginName === 'cua-computer-use');
    if (computerUseUnavailableError.code === 'COMPUTER_USE_DISABLED_BY_USER') {
      return {
        state: 'disabled_by_user',
        mcpConnected: false,
        wrapperReady: true,
        lastError: computerUseUnavailableError.message,
      };
    }
    if (computerUseBackend && server?.connected) {
      return { state: 'ready', mcpConnected: true, wrapperReady: true };
    }
    if (server?.enabled === false || computerUseUnavailableError.code === 'COMPUTER_USE_NEEDS_ENABLEMENT') {
      return {
        state: 'not_enabled',
        mcpConnected: false,
        wrapperReady: true,
        lastError: computerUseUnavailableError.message,
      };
    }
    return {
      state: 'failed',
      mcpConnected: false,
      wrapperReady: true,
      lastError: server?.lastError ?? computerUseUnavailableError.message,
    };
  };

  const host = new InProcessTaskRuntimeHost({
    materialRegistry,
    snapshotStore,
    runner: options.runner ?? createDesktopModelRunnerWithRegistry(registry, tools, options.dataRoot, options.kswarmService, materialRegistry, kswarmCreateProjectToolOptions),
    now: options.now,
    aheGuards: { artifactEvidence: true, recoveryContinuity: true },
    // Use timestamp + random suffix to ensure unique taskId/sessionId across app restarts
    createTaskId: () => `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createSessionId: () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  });

  const createKSwarmTaskHost = (workspaceRoot: string) => {
    const scopedTools = buildToolList(undefined, { cwd: workspaceRoot });
    const scopedRegistry = new ToolRegistry({ autoMode: true }, scopedTools);
    return new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: options.runner ?? createDesktopModelRunnerWithRegistry(scopedRegistry, scopedTools, options.dataRoot, options.kswarmService, materialRegistry, kswarmCreateProjectToolOptions),
      now: options.now,
      aheGuards: { artifactEvidence: false, recoveryContinuity: true },
      createTaskId: () => `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createSessionId: () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    });
  };

  const connectorsService = new ConnectorsService({
    store: new ConnectorsStore({ dataRoot: options.dataRoot }),
    toolRegistry: registry,
  });

  async function runKSwarmHandoffTask({ handoff, targetParticipantId, signal }: { handoff: KSwarmTaskHandoff; targetParticipantId?: string; signal?: AbortSignal }) {
    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('agent aborted', 'AbortError');
      }
    };

    throwIfAborted();
    const artifactsDir = handoff.project.artifactsDir || (handoff.project.workFolder ? join(handoff.project.workFolder, 'artifacts') : '');
    const workspaceRoot = handoff.project.workFolder || (artifactsDir ? dirname(artifactsDir) : process.cwd());
    const taskHost = createKSwarmTaskHost(workspaceRoot);
    const runStartedAt = Date.now();
    const requiresArtifactEvidence = shouldRequireKSwarmArtifactEvidence(handoff.task);
    const requiredOutputsText = formatKSwarmRequiredOutputs(handoff.task.requiredOutputs);
    const prompt = [
      'KSwarm 项目任务执行。',
      `执行者：${targetParticipantId || 'xiaok-worker'}`,
      `项目：${handoff.project.name}`,
      `目标：${handoff.project.goal}`,
      handoff.project.requirements ? `要求：${handoff.project.requirements}` : '',
      artifactsDir ? `产物目录：${artifactsDir}` : '',
      `任务：${handoff.task.title}`,
      handoff.task.brief ? `任务说明：${handoff.task.brief}` : '',
      handoff.task.acceptanceCriteria ? `验收标准：${handoff.task.acceptanceCriteria}` : '',
      requiredOutputsText ? `必须产出：${requiredOutputsText}` : '',
      handoff.task.evidenceContract ? `外部来源证据要求：${JSON.stringify(handoff.task.evidenceContract)}` : '',
      handoff.task.repairInstruction ? `修复反馈：${handoff.task.repairInstruction}` : '',
      requiresArtifactEvidence ? '本任务必须写入至少一个完整产物文件到产物目录；不要只在摘要里描述文件，最终交接必须能看到文件路径。' : '',
      requiresArtifactEvidence
        ? '不要调用项目推进或修复工具来代替本次任务执行；请直接完成当前任务，把产物文件写入上面的产物目录，使用文件路径作为交接依据，并返回 result manifest。'
        : '不要调用项目推进或修复工具来代替本次任务执行；请直接完成当前任务，并返回 result manifest。如果任务没有要求生成文件，artifacts 可以为空数组，但 summary 必须说明完成了哪些要求。',
    ].filter(Boolean).join('\n');
    const created = await taskHost.createTask({ prompt, materials: [] });
    const cancelCreatedTask = () => {
      void taskHost.cancelTask(created.taskId).catch(() => {});
    };
    signal?.addEventListener('abort', cancelCreatedTask, { once: true });
    try {
      throwIfAborted();
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        throwIfAborted();
        const recovered = await taskHost.recoverTask(created.taskId);
        throwIfAborted();
        if (recovered.snapshot.status === 'completed') {
          const resultEvent = [...recovered.snapshot.events].reverse().find(event => event.type === 'result');
          const artifactEvents = recovered.snapshot.events.filter(event => event.type === 'artifact_recorded');
          const eventArtifacts = artifactEvents.map(event => ({
            path: (event as any).filePath || (event as any).path,
            kind: inferKSwarmArtifactKind((event as any).kind, (event as any).label),
            label: (event as any).label,
          })).filter(artifact => artifact.path);
          const discoveredArtifacts = discoverKSwarmArtifactsFromDirectory({
            artifactsDir,
            runStartedAt,
            knownPaths: eventArtifacts.map(artifact => artifact.path),
          });
          const artifacts = [...eventArtifacts, ...discoveredArtifacts];
          if (artifacts.length === 0 && requiresArtifactEvidence) {
            throw new Error('artifact_evidence_missing');
          }
          return {
            summary: resultEvent?.type === 'result' ? resultEvent.result.summary : 'completed',
            artifacts,
            provenance: {
              runtimeSource: 'desktop-agent-runtime',
              producingAgent: targetParticipantId || 'xiaok-worker',
              desktopTaskId: created.taskId,
            },
          };
        }
        if (recovered.snapshot.status === 'failed' || recovered.snapshot.status === 'cancelled') {
          throw new Error(`desktop_task_${recovered.snapshot.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('desktop_task_timeout');
    } finally {
      signal?.removeEventListener('abort', cancelCreatedTask);
    }
  }

  async function runKSwarmReadinessProbe({ targetParticipantId }: { targetParticipantId?: string } = {}) {
    const participantId = targetParticipantId || XIAOK_PO_SEED_ID;
    const base = {
      runtimeSource: 'desktop-agent-runtime',
      participantId,
      capabilities: [
        'planning',
        'research',
        'analysis',
        'source_research',
        'writing',
        'report_generation',
      ],
      outputCapabilities: ['markdown', 'html', 'report_html', 'text', 'json', 'csv'],
    };

    try {
      const config = await loadConfig();
      const model = config.models?.[config.defaultModelId];
      const provider = config.providers?.[config.defaultProvider];
      if (!config.defaultProvider || !config.defaultModelId || !model || !provider) {
        return { ...base, ok: false as const, reason: 'model_config_missing' };
      }

      const toolNames = new Set(registry.getToolDefinitions().map(tool => tool.name));
      for (const requiredTool of ['create_project', 'inspect_project', 'continue_project', 'repair_project_task_from_file']) {
        if (!toolNames.has(requiredTool)) {
          return { ...base, ok: false as const, reason: 'kswarm_tools_unavailable' };
        }
      }

      mkdirSync(join(options.dataRoot, 'runtime-health'), { recursive: true });
      return { ...base, ok: true as const };
    } catch (error) {
      return {
        ...base,
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function runKSwarmWorkflowNode({ handoff, targetParticipantId }: { handoff: KSwarmWorkflowNodeHandoff; targetParticipantId?: string }) {
    const workspaceRoot = handoff.project?.workFolder || process.cwd();
    const artifactsDir = handoff.project?.workFolder ? join(handoff.project.workFolder, 'artifacts') : '';
    const taskDeliverableNode = isKSwarmTaskDeliverableWorkflowNode(handoff);
    const projectDeliverableNode = isKSwarmProjectDeliverableWorkflowNode(handoff);
    const deliverableNode = taskDeliverableNode || projectDeliverableNode;
    if (artifactsDir) mkdirSync(artifactsDir, { recursive: true });
    const taskHost = createKSwarmTaskHost(workspaceRoot);
    const runStartedAt = Date.now();
    const prompt = buildKSwarmWorkflowNodePrompt(handoff, targetParticipantId || 'xiaok-worker', { artifactsDir });
    const runtimeResult = await runKSwarmRuntimeTextTask(taskHost, prompt, {
      artifactsDir,
      runStartedAt,
    });
    const { summary, artifacts } = runtimeResult;
    let parsed: Record<string, unknown>;
    try {
      parsed = parseKSwarmRuntimeStructuredJson(runtimeResult);
    } catch {
      console.warn('[kswarm-workflow-node] structured JSON extraction failed, fallback applied', {
        nodeKind: handoff.nodeKind,
        rawPreview: summary.slice(0, 200),
      });
      if (handoff.nodeKind === 'review') {
        // Review nodes must not default to 'blocked' on parse failure — that
        // permanently blocks the workflow. Use 'needs_rework' so the orchestrator
        // can retry or escalate, and capture the raw output as the reason.
        parsed = {
          reviewDecision: {
            status: 'needs_rework',
            reason: summary.slice(0, 2000) || 'Reviewer output was not structured JSON.',
          },
        };
      } else {
        parsed = {};
      }
    }

    if (handoff.nodeKind === 'review') {
      const rawDecision = isRecord(parsed.reviewDecision) ? parsed.reviewDecision : parsed;
      const reviewDecision = normalizeKSwarmWorkflowReviewDecision(rawDecision);
      const output = normalizeKSwarmWorkflowNodeOutput(isRecord(parsed.output) ? parsed.output : {}, summary);
      return { output, reviewDecision };
    }

    const output = normalizeKSwarmWorkflowNodeOutput(isRecord(parsed.output) ? parsed.output : parsed, summary);
    const mergedArtifacts = mergeKSwarmArtifacts(output.artifacts, artifacts, { artifactsDir });
    if (deliverableNode) {
      if (mergedArtifacts.length === 0) {
        throw new Error('workflow_artifact_evidence_missing');
      }
      return {
        output: {
          ...output,
          artifacts: mergedArtifacts,
          ...(artifactsDir ? { workFolder: workspaceRoot, workspacePath: workspaceRoot } : {}),
          evidenceRefs: mergeKSwarmEvidenceRefs(output.evidenceRefs, mergedArtifacts, { artifactsDir }),
        },
        reviewDecision: null,
      };
    }

    return {
      output: {
        ...output,
        ...(mergedArtifacts.length > 0 ? {
          artifacts: mergedArtifacts,
          evidenceRefs: mergeKSwarmEvidenceRefs(output.evidenceRefs, mergedArtifacts, { artifactsDir }),
          ...(artifactsDir ? { workFolder: workspaceRoot, workspacePath: workspaceRoot } : {}),
        } : {}),
      },
      reviewDecision: null,
    };
  }

  async function runKSwarmAssignPo({ payload, targetParticipantId }: { payload: Record<string, unknown>; targetParticipantId?: string }) {
    try {
      const projectId = readString(payload.projectId) || readString(payload.taskId);
      if (!projectId) return { ok: false as const, error: 'project_id_missing' };
      const fromAgent = targetParticipantId || readString(payload.poAgent) || XIAOK_PO_SEED_ID;
      const members = readStringArray(payload.members);
      const fallbackWorkerId = members[0] || 'xiaok-worker';
      const prompt = buildKSwarmAssignPoPrompt(payload, fallbackWorkerId);
      const runtimeResult = await runKSwarmRuntimeTextTask(host, prompt);
      const parsed = parseKSwarmRuntimeStructuredJson(runtimeResult);
      const plan = normalizeKSwarmPlan(isRecord(parsed.plan) ? parsed.plan : parsed, fallbackWorkerId, {
        userGoal: readString(payload.goal),
        userRequirements: readString(payload.requirements),
        planningGuidance: readString(payload.planningGuidance),
      });
      const tasks = buildKSwarmTasksFromPlan(plan);

      // Phase 1: submit plan. `plan_already_exists` is non-fatal on retry —
      // the plan is durable, but tasks/dispatch may still be missing, so we
      // must continue rather than short-circuit a half-bootstrapped project.
      try {
        await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plan, fromAgent }),
        });
      } catch (planError) {
        const message = planError instanceof Error ? planError.message : String(planError);
        if (message !== 'plan_already_exists') {
          return { ok: false as const, error: message, phase: 'plan' as const };
        }
      }

      // Phase 2: create tasks. Server `addTasksChecked` skips already-existing
      // task ids, so re-running this phase is idempotent.
      if (tasks.length > 0) {
        try {
          await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tasks, fromAgent }),
          });
        } catch (tasksError) {
          return {
            ok: false as const,
            error: tasksError instanceof Error ? tasksError.message : String(tasksError),
            phase: 'tasks' as const,
          };
        }
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function bootstrapKSwarmInitialPlan(input: KSwarmInitialPlanBootstrapInput) {
    const result = await runKSwarmAssignPo({
      targetParticipantId: input.poAgent,
      payload: {
        projectId: input.projectId,
        projectName: input.projectName,
        name: input.projectName,
        goal: input.goal,
        requirements: input.requirements,
        planningGuidance: input.planningGuidance,
        poAgent: input.poAgent,
        members: input.members,
      },
    });
    if (!result.ok) {
      return result;
    }
    // Phase 3: dispatch. Server `/dispatch` is idempotent (only dispatches
    // pending tasks), so failing the whole job here is safe — the queue will
    // retry plan(skipped)/tasks(skipped)/dispatch until tasks actually run.
    // Silently swallowing this left projects planned-but-never-running.
    try {
      await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(input.projectId)}/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromAgent: input.poAgent }),
      });
    } catch (dispatchError) {
      return {
        ok: false as const,
        error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        phase: 'dispatch' as const,
      };
    }
    return { ok: true as const };
  }

  async function runKSwarmReviewSubmission({ payload, targetParticipantId }: { payload: Record<string, unknown>; targetParticipantId?: string }) {
    try {
      const projectId = readString(payload.projectId);
      const taskId = readString(payload.taskId);
      if (!projectId || !taskId) return { ok: false as const, error: 'project_or_task_id_missing' };
      const fromAgent = targetParticipantId || readString(payload.poAgent) || XIAOK_PO_SEED_ID;
      const reviewPrompt = buildKSwarmReviewPrompt(payload);
      const runtimeResult = await runKSwarmRuntimeTextTask(host, reviewPrompt);
      const parsed = parseKSwarmRuntimeStructuredJson(runtimeResult);
      const review = normalizeKSwarmReview(isRecord(parsed.review) ? parsed.review : parsed);

      await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ review, fromAgent }),
      });

      if (review.passed) {
        const detail = await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}`);
        if (shouldSynthesizeKSwarmProject(detail)) {
          const synthesisPrompt = buildKSwarmSynthesisPrompt(detail);
          const synthesis = (await runKSwarmRuntimeTextTask(host, synthesisPrompt)).summary;
          await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}/synthesize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ synthesis, fromAgent }),
          });
        }
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runKSwarmPlanApproved({ payload, targetParticipantId }: { payload: Record<string, unknown>; targetParticipantId?: string }) {
    try {
      const projectId = readString(payload.projectId) || readString(payload.taskId);
      if (!projectId) return { ok: false as const, error: 'project_id_missing' };
      const fromAgent = targetParticipantId || readString(payload.poAgent) || XIAOK_PO_SEED_ID;
      await requestKSwarmJson(options.kswarmService, `/projects/${encodeURIComponent(projectId)}/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromAgent }),
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    registerTimedActionService(service: TimedActionService) {
      for (const tool of createTimedActionTools(service)) {
        registry.registerTool(tool);
      }
    },
    getConnectorsConfig() {
      return connectorsService.getConfig();
    },
    async setConnectorsConfig(input: unknown) {
      return connectorsService.setConfig(input);
    },
    listConnectorRuntimes() {
      return connectorsService.listProviders();
    },
    async testConnectorProvider(kind: 'search' | 'fetch') {
      return connectorsService.testProvider(kind);
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
      const autoConnectDecision = isComputerUseAutoConnectEligibleApp(computerUsePreference, computerUseAppIdentity);
      await reconnectPluginMcpServers({
        userInitiated: false,
        autoConnectComputerUse: autoConnectDecision.eligible,
      });
      return { dispose: disposePluginMcpServers };
    },
    listPluginMcpServers(): PluginMcpServerState[] {
      return pluginMcpServers;
    },
    async restartPluginMcpServers(): Promise<PluginMcpServerState[]> {
      return reconnectPluginMcpServers({ userInitiated: true });
    },
    async restartPluginMcpServer(input: { name: string }): Promise<PluginMcpServerState[]> {
      return reconnectPluginMcpServers({ userInitiated: true, targetServerName: input.name });
    },
    async enableComputerUse(): Promise<{ state: string; mcpConnected: boolean; wrapperReady: boolean; lastError?: string }> {
      await reconnectPluginMcpServers({ userInitiated: true, targetServerName: 'cua-driver' });
      return getComputerUseCapabilityStatus();
    },
    async reconnectComputerUse(): Promise<{ state: string; mcpConnected: boolean; wrapperReady: boolean; lastError?: string }> {
      await reconnectPluginMcpServers({ userInitiated: true, targetServerName: 'cua-driver' });
      return getComputerUseCapabilityStatus();
    },
    async disableComputerUse(): Promise<{ state: string; mcpConnected: boolean; wrapperReady: boolean; lastError?: string }> {
      disposePluginMcpServers((server) => server.name === 'cua-driver');
      for (let index = pluginMcpServers.length - 1; index >= 0; index -= 1) {
        if (pluginMcpServers[index].name === 'cua-driver') pluginMcpServers.splice(index, 1);
      }
      computerUseBackend = null;
      computerUseUnavailableError = buildComputerUseDisabledUnavailableError();
      computerUsePreference = {
        ...computerUsePreference,
        schemaVersion: 1,
        enabledByUser: false,
        autoConnectAfterSuccessfulEnablement: false,
        lastFailureCode: 'COMPUTER_USE_DISABLED_BY_USER',
        autoConnectSuspendedReason: 'COMPUTER_USE_DISABLED_BY_USER',
      };
      persistComputerUsePreference();
      return getComputerUseCapabilityStatus();
    },
    getComputerUseCapabilityStatus(): { state: string; mcpConnected: boolean; wrapperReady: boolean; lastError?: string } {
      return getComputerUseCapabilityStatus();
    },
    setPluginMcpServerEnabled(input: { name: string; enabled: boolean }): PluginMcpServerState[] {
      const server = pluginMcpServers.find(s => s.name === input.name);
      if (server) server.enabled = input.enabled;
      return pluginMcpServers;
    },
    async installPlugin(name: string): Promise<{ success: boolean; error?: string }> {
      const pluginName = name.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(pluginName)) {
        return { success: false, error: 'invalid_plugin_name' };
      }
      return new Promise((resolve) => {
        execFile('xiaok', ['plugin', 'install', pluginName], { timeout: 120_000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
            return;
          }
          resolve({ success: true });
        });
      });
    },
    async listAvailablePlugins(): Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>> {
      try {
        const res = await fetch('https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry.json');
        if (!res.ok) return [];
        const data = await res.json() as { plugins: Array<{ name: string; display_name: string; description: string; version: string }> };
        return (data.plugins || []).map(p => ({
          ...p,
          installed: existsSync(join(pluginRootDir, p.name, 'plugin.json')),
        }));
      } catch {
        return [];
      }
    },
    async listPluginDependencyStatuses() {
      return Promise.all(pluginDependencies.map(getDependencyStatusView));
    },
    async installPluginDependency(input: { pluginName: string; dependencyId: string; confirmed?: boolean }): Promise<{ success: boolean; status?: unknown; error?: string }> {
      const entry = findPluginDependency(input.pluginName, input.dependencyId);
      if (!entry) return { success: false, error: 'plugin_dependency_not_found' };
      try {
        const dependency = entry.dependency;
        if (dependency.install?.kind !== 'official_installer') {
          return { success: false, error: 'plugin_dependency_installer_not_available' };
        }
        if (dependency.install.requiresUserConfirmation && !input.confirmed) {
          return { success: false, error: 'confirmation_required' };
        }
        if (dependency.install.sourceAllowlist && !dependency.install.sourceAllowlist.includes(dependency.install.sourceUrl)) {
          return { success: false, error: 'installer_source_not_allowed' };
        }
        const installerDir = join(options.dataRoot, 'runtime', 'plugin-installers');
        mkdirSync(installerDir, { recursive: true });
        const res = await fetch(dependency.install.sourceUrl);
        if (!res.ok) return { success: false, error: `installer_download_failed_${res.status}` };
        const installerPath = join(installerDir, `${dependency.id}-${Date.now()}.sh`);
        await writeFileAsync(installerPath, Buffer.from(await res.arrayBuffer()));
        const execution = buildOfficialInstallerExecution(dependency, installerPath, { confirmed: Boolean(input.confirmed) });
        const result = await runDependencyCommand(execution.command, execution.args);
        if (!result.success) return { success: false, error: result.error };
        return { success: true, status: await getDependencyStatusView(entry) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async updatePluginDependency(input: { pluginName: string; dependencyId: string; confirmed?: boolean }): Promise<{ success: boolean; status?: unknown; error?: string }> {
      const entry = findPluginDependency(input.pluginName, input.dependencyId);
      if (!entry) return { success: false, error: 'plugin_dependency_not_found' };
      const dependency = entry.dependency;
      if (!dependency.update) return { success: false, error: 'plugin_dependency_update_not_available' };
      if (dependency.update.requiresUserConfirmation && !input.confirmed) {
        return { success: false, error: 'confirmation_required' };
      }
      if (dependency.update.kind === 'official_installer') {
        const updateConfig = dependency.update;
        if (updateConfig.sourceAllowlist && !updateConfig.sourceAllowlist.includes(updateConfig.sourceUrl)) {
          return { success: false, error: 'installer_source_not_allowed' };
        }
        try {
          const installerDir = join(options.dataRoot, 'runtime', 'plugin-installers');
          mkdirSync(installerDir, { recursive: true });
          const res = await fetch(updateConfig.sourceUrl);
          if (!res.ok) return { success: false, error: `installer_download_failed_${res.status}` };
          const installerPath = join(installerDir, `${dependency.id}-update-${Date.now()}.sh`);
          await writeFileAsync(installerPath, Buffer.from(await res.arrayBuffer()));
          const result = await runDependencyCommand('/bin/bash', [installerPath]);
          if (!result.success) return { success: false, error: result.error };
          return { success: true, status: await getDependencyStatusView(entry) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      const status = await getDependencyStatusView(entry);
      if (!status.resolvedBinary) return { success: false, error: 'plugin_dependency_binary_missing' };
      const result = await runDependencyCommand(status.resolvedBinary, dependency.update.args ?? []);
      if (!result.success) return { success: false, error: result.error };
      return { success: true, status: await getDependencyStatusView(entry) };
    },
    async diagnosePluginDependency(input: { pluginName: string; dependencyId: string }): Promise<{ success: boolean; output?: string; status?: unknown; error?: string }> {
      const entry = findPluginDependency(input.pluginName, input.dependencyId);
      if (!entry) return { success: false, error: 'plugin_dependency_not_found' };
      const status = await getDependencyStatusView(entry);
      if (!status.resolvedBinary) return { success: false, error: 'plugin_dependency_binary_missing' };
      const doctor = entry.dependency.health?.doctor;
      if (!doctor) return { success: false, error: 'plugin_dependency_diagnose_not_available' };
      const [, ...args] = doctor;
      const result = await runDependencyCommand(status.resolvedBinary, args, 120_000);
      if (!result.success) return { success: false, error: result.error };
      return { success: true, output: result.output, status: await getDependencyStatusView(entry) };
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
      context?: TaskCreateContext;
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
      return host.createTask({ prompt: input.prompt, materials, context: input.context });
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
    async createManagedXiaokAgent(input: {
      name: string;
      description?: string;
      roles?: string[];
      capabilities?: string[];
      instructions?: string;
      maxConcurrentTasks?: number;
    }) {
      const config = await loadConfig();
      const payload = buildManagedXiaokAgentPayload(input, config);
      const response = await fetch('http://127.0.0.1:4400/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Failed to create managed xiaok agent: ${response.status}`);
      }
      return response.json();
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
    async getKswarmConfig() {
      const config = await loadConfig();
      return { maxConcurrentTasks: config.kswarm?.maxConcurrentTasks ?? 3 };
    },
    async saveKswarmConfig(input: { maxConcurrentTasks: number }) {
      const config = await loadConfig();
      const clamped = Math.max(1, Math.min(10, Math.round(input.maxConcurrentTasks)));
      config.kswarm = { ...(config.kswarm || {}), maxConcurrentTasks: clamped };
      await saveConfig(config);
      return { maxConcurrentTasks: clamped };
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
    runKSwarmHandoffTask,
    runKSwarmWorkflowNode,
    runKSwarmReadinessProbe,
    runKSwarmAssignPo,
    runKSwarmReviewSubmission,
    runKSwarmPlanApproved,
    subscribeTask: host.subscribeTask.bind(host),
    answerQuestion: host.answerQuestion.bind(host),
    cancelTask: host.cancelTask.bind(host),
    getActiveTask: host.getActiveTask.bind(host),
    recoverTask: host.recoverTask.bind(host),
    async recoverStaleTasks(): Promise<void> {
      const active = await host.getActiveTasks();
      for (const ref of active) {
        try {
          await host.recoverTask(ref.taskId);
        } catch {
          // Per-task recovery failure must not block desktop startup.
        }
      }
      try {
        await recoverInterruptedScriptWorkflows(options.kswarmService);
      } catch {
        // Dynamic workflow recovery is best-effort; never block desktop startup.
      }
    },
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

    async exportTraceBundle(input: { kind: 'session' | 'project' | 'task'; id: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
      try {
        const bundle = input.kind === 'project'
          ? buildProjectTraceBundleFromKSwarmDetail(await fetchKSwarmProjectFullDetail(options.kswarmService, input.id), { projectId: input.id })
          : await buildDesktopSessionTraceBundle({ kind: input.kind, id: input.id }, options.dataRoot, snapshotStore);
        const path = writeTraceBundleToPath({
          bundle,
          outputPath: join(options.dataRoot, 'traces', `${input.kind}_${sanitizeFilePart(input.id)}_${Date.now()}.json`),
          force: true,
        });
        return { ok: true, path };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },

    async diagnose(input: { kind: 'session' | 'project' | 'task'; id: string }): Promise<DiagnosisReport> {
      if (input.kind === 'project') {
        const detail = await fetchKSwarmProjectFullDetail(options.kswarmService, input.id);
        return diagnoseProjectSnapshot(detail as never);
      }
      const bundle = await buildDesktopSessionTraceBundle({ kind: input.kind, id: input.id }, options.dataRoot, snapshotStore);
      return diagnoseTraceBundle(bundle);
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
    startProjectPlanning(input: { projectId: string; projectName: string; goal: string; requirements: string; planningGuidance: string; poAgent: string; members: string[] }) {
      return initialPlanBootstrapQueue.enqueue(input);
    },
  };
}

function buildComputerUseNeedsEnablementError(): ComputerUseUnavailableError {
  return {
    code: 'COMPUTER_USE_NEEDS_ENABLEMENT',
    message: 'Computer Use 尚未启用。',
    userAction: { type: 'enable_computer_use', label: '启用 Computer Use' },
  };
}

function buildComputerUseDisabledUnavailableError(): ComputerUseUnavailableError {
  return {
    code: 'COMPUTER_USE_DISABLED_BY_USER',
    message: 'Computer Use 已被用户禁用。',
  };
}

function mapComputerUseStartupError(error: unknown): ComputerUseUnavailableError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('permission_accessibility_missing')) {
    return {
      code: 'COMPUTER_USE_NEEDS_ACCESSIBILITY',
      message: 'CUA Driver 缺少辅助功能权限。',
      userAction: { type: 'open_system_settings', label: '打开系统设置' },
    };
  }
  if (message.includes('permission_screen_missing')) {
    return {
      code: 'COMPUTER_USE_NEEDS_SCREEN_RECORDING',
      message: 'CUA Driver 缺少屏幕录制权限。',
      userAction: { type: 'open_system_settings', label: '打开系统设置' },
    };
  }
  if (message.includes('mcp_content_unsupported')) {
    return {
      code: 'COMPUTER_USE_PERMISSION_INVALID',
      message: 'Computer Use 权限看似已授权，但未返回可用屏幕内容。',
      userAction: { type: 'open_system_settings', label: '重新设置权限' },
    };
  }
  return {
    code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT',
    message: message || 'Computer Use 连接失败。',
    userAction: { type: 'reconnect_computer_use', label: '重新连接' },
  };
}

function resolveComputerUseAppIdentity(): ComputerUseAppIdentity {
  const appPath = resolveMacAppBundlePath(process.execPath);
  const teamId = appPath ? resolveCodeSignatureTeamId(appPath) : undefined;
  return {
    isPackaged: process.env.NODE_ENV !== 'development' && Boolean(appPath),
    ...(appPath ? { appPath } : {}),
    ...(process.env.XIAOK_DESKTOP_BUNDLE_ID ? { bundleId: process.env.XIAOK_DESKTOP_BUNDLE_ID } : {}),
    ...(teamId ? { teamId } : {}),
    ...(process.env.XIAOK_DESKTOP_DEV_SERVER ? { devServerUrl: process.env.XIAOK_DESKTOP_DEV_SERVER } : {}),
    ...(process.env.NODE_ENV ? { nodeEnv: process.env.NODE_ENV } : {}),
  };
}

function resolveMacAppBundlePath(executablePath: string): string | undefined {
  const marker = '.app/Contents/MacOS/';
  const index = executablePath.indexOf(marker);
  if (index === -1) return undefined;
  return executablePath.slice(0, index + '.app'.length);
}

function resolveCodeSignatureTeamId(appPath: string): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], {
      encoding: 'utf8',
      timeout: 1_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    return /TeamIdentifier=([A-Z0-9]+)/.exec(output)?.[1];
  } catch {
    return undefined;
  }
}

function formatKSwarmRequiredOutputs(outputs: KSwarmTaskHandoff['task']['requiredOutputs']): string {
  if (!Array.isArray(outputs)) return '';
  const normalized: string[] = [];
  for (const output of outputs) {
    const raw = typeof output === 'string'
      ? output
      : output?.type || output?.format || output?.kind || output?.mimeType || '';
    const value = String(raw || '').trim();
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized.join(', ');
}

function inferKSwarmArtifactKind(kind: string, label: string): string {
  const normalized = String(kind || '').toLowerCase();
  const lowerLabel = String(label || '').toLowerCase();
  if ((normalized === 'text' || normalized === 'other') && lowerLabel.endsWith('.md')) return 'markdown';
  return normalized || 'file';
}

function shouldRequireKSwarmArtifactEvidence(task: KSwarmTaskHandoff['task']): boolean {
  if ((task.requiredOutputs ?? []).length > 0) return true;
  if (task.evidenceContract && task.evidenceContract.required === true) return true;
  return false;
}

function discoverKSwarmArtifactsFromDirectory(input: {
  artifactsDir: string;
  runStartedAt: number;
  knownPaths: string[];
}): Array<{ path: string; kind: string; label: string }> {
  const { artifactsDir, runStartedAt, knownPaths } = input;
  if (!artifactsDir || !existsSync(artifactsDir)) return [];
  const known = new Set(knownPaths.map(item => String(item || '')));
  const minMtime = runStartedAt - 5_000;
  const discovered: Array<{ path: string; kind: string; label: string }> = [];
  for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (isKSwarmSystemArtifactFilename(entry.name)) continue;
    const filePath = join(artifactsDir, entry.name);
    if (known.has(filePath)) continue;
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < minMtime) continue;
    discovered.push({
      path: filePath,
      kind: inferKSwarmArtifactKind(kindFromFilename(entry.name), entry.name),
      label: entry.name,
    });
  }
  return discovered.sort((left, right) => left.label.localeCompare(right.label));
}

function isKSwarmSystemArtifactFilename(filename: string): boolean {
  return filename === 'plan-v1.md' || filename === 'synthesis.md';
}

function kindFromFilename(filename: string): string {
  const extension = extname(filename).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  if (extension === '.pptx') return 'pptx';
  if (extension === '.pdf') return 'pdf';
  return 'file';
}

async function runKSwarmRuntimeTextTask(
  host: InProcessTaskRuntimeHost,
  prompt: string,
  options: { artifactsDir?: string; runStartedAt?: number } = {},
): Promise<{ taskId: string; summary: string; structuredOutput?: Record<string, unknown>; artifacts: Array<{ path: string; kind: string; label?: string }> }> {
  const runStartedAt = options.runStartedAt || Date.now();
  const maxAttempts = 2;
  let lastFailure: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const created = await host.createTask({ prompt, materials: [] });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const recovered = await host.recoverTask(created.taskId);
      if (recovered.snapshot.status === 'completed') {
        const artifactEvents = recovered.snapshot.events.filter(event => event.type === 'artifact_recorded');
        const eventArtifacts = artifactEvents.map(event => ({
          path: (event as any).filePath || (event as any).path,
          kind: inferKSwarmArtifactKind((event as any).kind, (event as any).label),
          label: (event as any).label,
        })).filter(artifact => artifact.path);
        const discoveredArtifacts = discoverKSwarmArtifactsFromDirectory({
          artifactsDir: options.artifactsDir || '',
          runStartedAt,
          knownPaths: eventArtifacts.map(artifact => artifact.path),
        });
        return {
          taskId: created.taskId,
          summary: recovered.snapshot.result?.summary || '',
          structuredOutput: isRecord(recovered.snapshot.result?.structuredOutput) ? recovered.snapshot.result.structuredOutput : undefined,
          artifacts: [...eventArtifacts, ...discoveredArtifacts],
        };
      }
      if (recovered.snapshot.status === 'failed' || recovered.snapshot.status === 'cancelled') {
        lastFailure = getKSwarmRuntimeTaskFailureReason(recovered.snapshot) || `desktop_task_${recovered.snapshot.status}`;
        if (
          recovered.snapshot.status === 'failed'
          && attempt < maxAttempts
          && isRetryableKSwarmRuntimeTaskFailure(lastFailure)
        ) {
          await new Promise(resolve => setTimeout(resolve, 750));
          break;
        }
        throw new Error(`desktop_task_${recovered.snapshot.status}: ${lastFailure}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(lastFailure ? `desktop_task_failed: ${lastFailure}` : 'desktop_task_timeout');
}

function parseKSwarmRuntimeStructuredJson(result: { summary: string; structuredOutput?: Record<string, unknown> }): Record<string, unknown> {
  return result.structuredOutput ?? extractKSwarmJsonObject(result.summary);
}

function getKSwarmRuntimeTaskFailureReason(snapshot: { salvage?: { reason?: unknown }; events?: Array<unknown> }): string {
  const salvageReason = typeof snapshot.salvage?.reason === 'string' ? snapshot.salvage.reason.trim() : '';
  if (salvageReason) return salvageReason;
  for (const event of [...(snapshot.events || [])].reverse()) {
    if (!isRecord(event)) continue;
    if (event.type === 'error' && typeof event.message === 'string' && event.message.trim()) {
      return event.message.trim();
    }
  }
  return '';
}

function isRetryableKSwarmRuntimeTaskFailure(reason: string): boolean {
  return /Premature close|ERR_STREAM_PREMATURE_CLOSE|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|terminated/i.test(reason);
}

function formatUpstreamOutputsSection(upstreamOutputs: Record<string, { nodeId?: string; nodeTitle?: string; summary?: string; artifactPaths?: string[]; _truncated?: boolean; [key: string]: unknown }> | undefined): string {
  if (!upstreamOutputs || typeof upstreamOutputs !== 'object') return '';
  const entries = Object.values(upstreamOutputs);
  if (entries.length === 0) return '';

  const lines = ['', '## 上游节点产出（参考信息）', ''];
  for (const entry of entries) {
    const title = entry.nodeTitle || entry.nodeId || '未知节点';
    lines.push(`### ${title}`);
    if (entry.summary) lines.push(`- 摘要：${entry.summary}`);
    if (Array.isArray(entry.artifactPaths) && entry.artifactPaths.length > 0) {
      lines.push(`- 产物文件：${entry.artifactPaths.join(', ')}`);
    }
    if (entry._truncated) lines.push('- （部分信息被截断，如需完整内容请读取产物文件）');
    const extraKeys = Object.keys(entry).filter(k => !['nodeId', 'nodeTitle', 'summary', 'artifactPaths', '_truncated'].includes(k));
    for (const k of extraKeys.slice(0, 5)) {
      try {
        const v = JSON.stringify(entry[k]);
        if (v && v.length < 200) lines.push(`- ${k}：${v}`);
      } catch { /* skip */ }
    }
    lines.push('');
  }
  lines.push('如需完整内容，请使用 Read 工具读取上述文件路径。');
  return lines.join('\n');
}

function buildKSwarmWorkflowNodePrompt(handoff: KSwarmWorkflowNodeHandoff, participantId: string, options: { artifactsDir?: string } = {}): string {
  const project = handoff.project || { id: handoff.projectId };
  const inputWithoutUpstream = handoff.input ? (() => {
    const { upstreamOutputs: _u, ...rest } = handoff.input as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : null;
  })() : null;
  const upstreamSection = formatUpstreamOutputsSection((handoff.input as Record<string, unknown>)?.upstreamOutputs as Record<string, { nodeId?: string; nodeTitle?: string; summary?: string; artifactPaths?: string[]; _truncated?: boolean }> | undefined);
  const base = [
    'KSwarm 动态工作流节点执行。',
    `执行者：${participantId}`,
    `工作流：${handoff.workflowId}`,
    `真实 workflow run ID：${handoff.workflowRunId}`,
    `节点：${handoff.nodeTitle} (${handoff.nodeId})`,
    `项目：${project.name || project.id}`,
    project.goal ? `目标：${project.goal}` : '',
    project.workFolder ? `工作区：${project.workFolder}` : '',
    inputWithoutUpstream ? `节点输入：${JSON.stringify(inputWithoutUpstream)}` : '',
  ].filter(Boolean);

  if (handoff.nodeKind === 'review') {
    return [
      ...base,
      '你是 reviewer / adversarial agent。请审查 worker 输出是否足够可靠、是否存在明显遗漏、是否包含可复核交付物证据、是否能支撑下一步行动。',
      '如果节点输入包含 sourceTask，则 sourceTask 是唯一验收范围；项目 plan、plan-v1 或其他任务只能作为背景证据，不能要求源任务以外的任务先完成。',
      `如果交付物需要 workflow run ID，必须检查它是否使用真实 workflow run ID：${handoff.workflowRunId}；不能接受自行推导或占位 ID。`,
      upstreamSection,
      '只返回一个 JSON 对象，不要返回 Markdown 包裹：',
      '{"reviewDecision":{"status":"passed|needs_rework|blocked","reason":"一句明确原因","evidenceRefs":["可选证据引用"]},"output":{"summary":"复核摘要"}}',
      'status 只能是 passed、needs_rework、blocked。reason 不能为空。',
    ].filter(Boolean).join('\n');
  }

  if (isKSwarmTaskDeliverableWorkflowNode(handoff)) {
    return [
      ...base,
      options.artifactsDir ? `产物目录：${options.artifactsDir}` : '',
      '你是 worker agent。请执行节点输入中的 sourceTask，产出当前任务的最终交付物，而不是只写诊断或计划。',
      `真实 workflow run ID 是 ${handoff.workflowRunId}；如果正文需要 workflow run ID，只能使用这个值，不要自行推导、缩写或伪造。`,
      'sourceTask 是唯一工作范围；项目 plan、plan-v1 或 taskSnapshot 中的其他任务只能作为背景，不是本节点必须完成的额外任务。',
      '必须逐条满足 sourceTask.description、sourceTask.acceptanceCriteria 和 sourceTask.requiredOutputs；如果验收标准要求项目 ID、任务 ID、workflow run ID 或 artifact 路径，正文中必须明确写出这些值。',
      '必须把完整、可复核的交付物文件写入产物目录；推荐 markdown 文件，文件名使用英文小写和连字符。',
      '如果 sourceTask 要求 HTML 报告、report renderer 或 kai-report-creator，必须先生成完整 .report.md IR 内容，再调用 render_report_artifact 输出 .html；不要读取 ~/.xiaok/plugins 插件内部文件，不要手写 HTML。',
      upstreamSection,
      'JSON 输出只放 manifest，不要把完整正文塞进 JSON。',
      '只返回一个 JSON 对象，不要返回 Markdown 包裹：',
      '{"output":{"summary":"交付物摘要，说明文件内容和完成范围","artifacts":[{"path":"绝对路径或相对产物路径","kind":"markdown","label":"文件名"}],"workFolder":"项目工作区路径","evidenceRefs":["artifact:文件路径"]}}',
      '如果不能生成可读文件，status 不能假装完成；请在 summary 说明阻塞原因。',
    ].filter(Boolean).join('\n');
  }

  if (isKSwarmProjectDeliverableWorkflowNode(handoff)) {
    return [
      ...base,
      options.artifactsDir ? `产物目录：${options.artifactsDir}` : '',
      '你是 worker agent。请执行整个项目，产出最终项目交付物，而不是只写诊断、计划或单个任务结果。',
      `真实 workflow run ID 是 ${handoff.workflowRunId}；如果正文需要 workflow run ID，只能使用这个值，不要自行推导、缩写或伪造。`,
      '项目目标、项目要求、计划和 taskSnapshot 共同构成本节点的工作范围；请覆盖所有尚未完成但属于项目目标的任务。',
      '必须生成完整、可读、可复核的最终项目交付物文件，并写入产物目录；推荐 markdown 文件，文件名使用英文小写和连字符。',
      '如果项目要求 HTML 报告、report renderer 或 kai-report-creator，必须先生成完整 .report.md IR 内容，再调用 render_report_artifact 输出 .html；不要读取 ~/.xiaok/plugins 插件内部文件，不要手写 HTML。',
      upstreamSection,
      'JSON 输出只放 manifest，不要把完整正文塞进 JSON。',
      '只返回一个 JSON 对象，不要返回 Markdown 包裹：',
      '{"output":{"summary":"项目交付物摘要，说明覆盖范围和文件内容","artifacts":[{"path":"绝对路径或相对产物路径","kind":"markdown","label":"文件名"}],"workFolder":"项目工作区路径","evidenceRefs":["artifact:文件路径"]}}',
      '如果不能生成可读文件，status 不能假装完成；请在 summary 说明阻塞原因。',
    ].filter(Boolean).join('\n');
  }

  return [
    ...base,
    options.artifactsDir ? `产物目录：${options.artifactsDir}` : '',
    '你是 worker agent。请执行节点输入中的 prompt，而不是诊断项目状态或只复述计划。',
    '节点输入里的 prompt 是当前 workflow 节点的唯一工作指令；项目状态和计划只能作为背景。',
    '如果 prompt 要求生成报告、分析、代码或其他交付物，必须把完整、可复核的文件写入产物目录；推荐文件名使用英文小写和连字符。',
    '如果 prompt 要求 HTML 报告、report renderer 或 kai-report-creator，必须先生成完整 .report.md IR 内容，再调用 render_report_artifact 输出 .html；不要读取 ~/.xiaok/plugins 插件内部文件，不要手写 HTML。',
    `真实 workflow run ID 是 ${handoff.workflowRunId}；如果正文需要 workflow run ID，只能使用这个值，不要自行推导、缩写或伪造。`,
    upstreamSection,
    'JSON 输出只放 manifest，不要把完整正文塞进 JSON。',
    '只返回一个 JSON 对象，不要返回 Markdown 包裹：',
    '{"output":{"summary":"节点执行摘要","artifacts":[{"path":"绝对路径或相对产物路径","kind":"markdown","label":"文件名"}],"evidenceRefs":["artifact:文件路径"]}}',
    '如果本节点确实不需要生成文件，artifacts 可以为空数组，但 summary 必须说明完成了 prompt 的哪些要求。',
  ].filter(Boolean).join('\n');
}

function isKSwarmTaskDeliverableWorkflowNode(handoff: KSwarmWorkflowNodeHandoff): boolean {
  return handoff.workflowId === 'po-generated-task-workflow' && handoff.nodeId === 'worker-produce-deliverable';
}

function isKSwarmProjectDeliverableWorkflowNode(handoff: KSwarmWorkflowNodeHandoff): boolean {
  return handoff.workflowId === 'po-generated-project-workflow' && handoff.nodeId === 'worker-produce-project-deliverable';
}

function mergeKSwarmArtifacts(
  rawArtifacts: unknown,
  discoveredArtifacts: Array<{ path: string; kind: string; label?: string }> = [],
  options: { artifactsDir?: string } = {},
) {
  const merged = new Map<string, { path: string; kind: string; label?: string }>();
  const add = (artifact: unknown) => {
    if (!isRecord(artifact)) return;
    const rawPath = readString(artifact.path) || readString(artifact.relativePath) || readString(artifact.filename);
    const normalizedPath = normalizeKSwarmArtifactManifestPath(rawPath, options);
    if (!normalizedPath) return;
    merged.set(normalizedPath, {
      path: normalizedPath,
      kind: inferKSwarmArtifactKind(readString(artifact.kind) || readString(artifact.type), readString(artifact.label) || readString(artifact.filename) || normalizedPath),
      label: readString(artifact.label) || readString(artifact.filename) || basename(normalizedPath),
    });
  };
  if (Array.isArray(rawArtifacts)) {
    for (const artifact of rawArtifacts) add(artifact);
  }
  for (const artifact of discoveredArtifacts) add(artifact);
  return [...merged.values()];
}

function normalizeKSwarmArtifactManifestPath(rawPath: string, options: { artifactsDir?: string } = {}): string {
  const value = readString(rawPath);
  if (!value) return '';
  const withoutQuery = value.split(/[?#]/, 1)[0] || value;
  const artifactsDir = readString(options.artifactsDir);
  if (artifactsDir && isAbsolute(withoutQuery)) {
    const relativeToArtifacts = relative(resolve(artifactsDir), resolve(withoutQuery)).replace(/\\/g, '/');
    if (relativeToArtifacts && !relativeToArtifacts.startsWith('..') && !isAbsolute(relativeToArtifacts)) {
      return `artifacts/${relativeToArtifacts}`;
    }
  }
  const normalized = withoutQuery.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.startsWith('artifacts/')) return `artifacts/${basename(normalized)}`;
  if (normalized.includes('/artifacts/')) return `artifacts/${basename(normalized)}`;
  return `artifacts/${basename(normalized)}`;
}

function mergeKSwarmEvidenceRefs(rawEvidenceRefs: unknown, artifacts: Array<{ path: string }>, options: { artifactsDir?: string } = {}) {
  const refs = new Set(readStringArray(rawEvidenceRefs).map(ref => normalizeKSwarmEvidenceRef(ref, options)));
  for (const artifact of artifacts) {
    if (artifact.path) refs.add(`artifact:${artifact.path}`);
  }
  return [...refs];
}

function normalizeKSwarmEvidenceRef(ref: string, options: { artifactsDir?: string } = {}): string {
  const value = readString(ref);
  if (!value.startsWith('artifact:')) return value;
  const artifactPath = normalizeKSwarmArtifactManifestPath(value.slice('artifact:'.length), options);
  return artifactPath ? `artifact:${artifactPath}` : value;
}

function buildKSwarmAssignPoPrompt(payload: Record<string, unknown>, fallbackWorkerId: string): string {
  const members = readStringArray(payload.members);
  return [
    'KSwarm PO 规划任务。',
    `项目 ID：${readString(payload.projectId) || readString(payload.taskId)}`,
    `项目名称：${readString(payload.projectName) || readString(payload.name) || '未命名项目'}`,
    `用户目标：${readString(payload.goal)}`,
    readString(payload.requirements) ? `用户要求：${readString(payload.requirements)}` : '',
    readString(payload.planningGuidance) ? `规划补充：${readString(payload.planningGuidance)}` : '',
    `可分配 Worker：${members.length > 0 ? members.join(', ') : fallbackWorkerId}`,
    '不要改写用户目标或用户要求；细化内容只放入 plan 的 phases/items。',
    '用户没有明确指定数量时，不要为本月/近期/最新类信息收集任务编造固定条数门槛；验收标准应要求尽可能完整覆盖已公开信息，并在公开信息不足时说明搜索范围、已找到条目和信息缺口，不得凑数。',
    '请只输出一个 JSON object，不要 Markdown，不要解释。',
    'JSON schema: {"analysis":"string","successCriteria":["string"],"phases":[{"id":"phase-1","name":"string","items":[{"id":"item-1","title":"string","brief":"string","assignedAgent":"string","dependencies":[],"acceptanceCriteria":"string","requiredOutputs":["markdown"]}]}]}',
  ].filter(Boolean).join('\n');
}

function buildKSwarmReviewPrompt(payload: Record<string, unknown>): string {
  return [
    'KSwarm PO 验收任务提交。',
    `项目 ID：${readString(payload.projectId)}`,
    `任务 ID：${readString(payload.taskId)}`,
    readString(payload.fromWorker) ? `提交 Worker：${readString(payload.fromWorker)}` : '',
    '任务结果 JSON：',
    JSON.stringify(payload.result ?? {}, null, 2),
    '请基于任务结果和产物证据做标准门禁验收。不要因为是小K帮忙推进就绕过门禁。',
    '请只输出一个 JSON object，不要 Markdown，不要解释。',
    'JSON schema: {"passed":true,"feedback":"string","failureClass":null,"planRevisionNeeded":false}',
  ].filter(Boolean).join('\n');
}

function buildKSwarmSynthesisPrompt(detail: unknown): string {
  const record = isRecord(detail) ? detail : {};
  const project = isRecord(record.project) ? record.project : {};
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  return [
    'KSwarm 项目收尾。',
    '项目所有任务已经完成，请写项目小结。',
    `项目名称：${readString(project.name)}`,
    `项目目标：${readString(project.goal)}`,
    '任务状态 JSON：',
    JSON.stringify(tasks.map(task => {
      const taskRecord = isRecord(task) ? task : {};
      return {
        id: readString(taskRecord.id),
        title: readString(taskRecord.title),
        status: readString(taskRecord.status),
        result: taskRecord.result ?? null,
      };
    }), null, 2),
    '输出 Markdown。内容只写正式项目小结，不要出现修订说明、评审回应、第二轮、【新增】、修订版等内部过程字样。',
  ].join('\n');
}

function extractKSwarmJsonObject(text: string): Record<string, unknown> {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('structured_json_missing');
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to fenced / embedded JSON extraction.
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Fall through to embedded JSON extraction.
    }
  }
  const embedded = trimmed.match(/\{[\s\S]*\}/);
  if (embedded?.[0]) {
    try {
      const parsed = JSON.parse(embedded[0]);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Fall through to the structured_json_missing failure below.
    }
  }
  throw new Error('structured_json_missing');
}

function normalizeKSwarmPlan(
  rawPlan: Record<string, unknown>,
  fallbackWorkerId: string,
  context: { userGoal?: string; userRequirements?: string; planningGuidance?: string } = {},
) {
  const phasesInput = Array.isArray(rawPlan.phases) ? rawPlan.phases : [];
  const phases = phasesInput.map((phase, phaseIndex) => {
    const phaseRecord = isRecord(phase) ? phase : {};
    const phaseId = readString(phaseRecord.id) || `phase-${phaseIndex + 1}`;
    const itemsInput = Array.isArray(phaseRecord.items) ? phaseRecord.items : [];
    const items = itemsInput.map((item, itemIndex) => {
      const itemRecord = isRecord(item) ? item : {};
      const itemId = readString(itemRecord.id) || `item-${phaseIndex + 1}.${itemIndex + 1}`;
      return {
        id: itemId,
        title: readString(itemRecord.title) || `任务 ${phaseIndex + 1}.${itemIndex + 1}`,
        brief: readString(itemRecord.brief),
        rationale: readString(itemRecord.rationale),
        assignedAgent: readString(itemRecord.assignedAgent) || fallbackWorkerId,
        dependencies: readStringArray(itemRecord.dependencies),
        acceptanceCriteria: softenGeneratedTemporalQuantityCriteria(readString(itemRecord.acceptanceCriteria), context),
        requiredOutputs: readStringArray(itemRecord.requiredOutputs),
        status: readString(itemRecord.status) || 'pending',
      };
    });
    return {
      id: phaseId,
      name: readString(phaseRecord.name) || `阶段 ${phaseIndex + 1}`,
      items,
    };
  }).filter(phase => phase.items.length > 0);

  if (phases.length === 0) {
    phases.push({
      id: 'phase-1',
      name: '交付',
      items: [{
        id: 'item-1',
        title: '完成项目交付',
        brief: '根据用户目标和要求完成交付。',
        rationale: '默认执行项',
        assignedAgent: fallbackWorkerId,
        dependencies: [],
        acceptanceCriteria: '交付内容满足用户目标和要求。',
        requiredOutputs: [],
        status: 'pending',
      }],
    });
  }

  return {
    analysis: readString(rawPlan.analysis),
    successCriteria: readStringArray(rawPlan.successCriteria),
    phases,
  };
}

function softenGeneratedTemporalQuantityCriteria(
  acceptanceCriteria: string,
  context: { userGoal?: string; userRequirements?: string; planningGuidance?: string } = {},
) {
  const text = String(acceptanceCriteria || '').trim();
  if (!text) return text;
  const userText = [context.userGoal, context.userRequirements, context.planningGuidance].filter(Boolean).join('\n');
  if (userExplicitlyRequestedItemCount(userText)) return text;
  if (!hasGeneratedHardItemCount(text)) return text;
  if (!hasCurrentPeriodResearchContext(text)) return text;

  const softened = text.replace(
    /(包含|列出|整理)?\s*(至少|不少于|不低于)\s*[0-9一二三四五六七八九十百]+\s*条\s*([^，。；;,.]*)/gu,
    '尽可能完整覆盖已公开的本期相关动态',
  );
  const suffix = '若公开信息不足，应明确列出已找到条目、搜索范围、来源和信息缺口，不得编造或用弱相关内容凑数。';
  return softened.includes('不得编造或用弱相关内容凑数') ? softened : `${softened}${softened.endsWith('。') ? '' : '。'}${suffix}`;
}

function userExplicitlyRequestedItemCount(text: string) {
  return /(至少|不少于|不低于|超过|不少过|约|大约)?\s*[0-9一二三四五六七八九十百]+\s*条/u.test(String(text || ''));
}

function hasGeneratedHardItemCount(text: string) {
  return /(至少|不少于|不低于)\s*[0-9一二三四五六七八九十百]+\s*条/u.test(text);
}

function hasCurrentPeriodResearchContext(text: string) {
  return /(本月|当月|本周|当周|近期|最新|截至|当前|过去|近[一二三四五六七八九十0-9]+[天周月]|产品动态|产品特性|公开信息|来源链接)/u.test(text);
}

function buildKSwarmTasksFromPlan(plan: ReturnType<typeof normalizeKSwarmPlan>) {
  return plan.phases.flatMap(phase => phase.items.map(item => ({
    id: item.id,
    title: item.title,
    brief: item.brief,
    rationale: item.rationale,
    assignedAgent: item.assignedAgent,
    dependencies: item.dependencies,
    phaseId: phase.id,
    planItemId: item.id,
    acceptanceCriteria: item.acceptanceCriteria,
    requiredOutputs: item.requiredOutputs,
  })));
}

function normalizeKSwarmReview(rawReview: Record<string, unknown>) {
  return {
    passed: rawReview.passed === true,
    feedback: readString(rawReview.feedback) || (rawReview.passed === true ? '验收通过。' : '验收未通过。'),
    failureClass: rawReview.failureClass === null ? null : (readString(rawReview.failureClass) || null),
    planRevisionNeeded: rawReview.planRevisionNeeded === true,
  };
}

function normalizeKSwarmWorkflowNodeOutput(rawOutput: Record<string, unknown>, fallbackSummary: string): Record<string, unknown> & { summary: string } {
  return {
    ...rawOutput,
    summary: readString(rawOutput.summary) || fallbackSummary || 'workflow node completed',
  };
}

function normalizeKSwarmWorkflowReviewDecision(rawDecision: Record<string, unknown>) {
  const status = readString(rawDecision.status);
  const normalizedStatus = ['passed', 'needs_rework', 'blocked'].includes(status) ? status : 'blocked';
  return {
    status: normalizedStatus,
    reason: readString(rawDecision.reason) || 'Reviewer did not provide a valid reason.',
    evidenceRefs: readStringArray(rawDecision.evidenceRefs),
  };
}

function shouldSynthesizeKSwarmProject(detail: unknown): boolean {
  const record = isRecord(detail) ? detail : {};
  const project = isRecord(record.project) ? record.project : {};
  if (readString(project.status) === 'delivered' || readString(project.status) === 'closed') return false;
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  return tasks.length > 0 && tasks.every(task => {
    const status = isRecord(task) ? readString(task.status) : '';
    return status === 'done' || status === 'cancelled';
  });
}

async function requestKSwarmJson(kswarmService: KSwarmService, path: string, init?: RequestInit): Promise<unknown> {
  if (!kswarmService) throw new Error('kswarm_service_missing');
  const response = await kswarmService.request(path, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`kswarm_http_${response.status}`);
  }
  if (isRecord(body) && body.ok === false) {
    throw new Error(readString(body.error) || 'kswarm_request_failed');
  }
  return body;
}

export async function recoverInterruptedScriptWorkflows(kswarmService: KSwarmService): Promise<void> {
  if (!kswarmService) return;
  let projects: Record<string, unknown>[] = [];
  try {
    const payload = await requestKSwarmJson(kswarmService, '/projects');
    const list = isRecord(payload) ? payload.projects : null;
    if (!Array.isArray(list)) return;
    projects = list.filter(isRecord);
  } catch {
    // kswarm not ready / unavailable — skip silently, do not block startup.
    return;
  }

  // Global cap (across all projects) to avoid flooding the runtime during cold boot.
  const maxRestarts = 3;
  let restarted = 0;
  for (const project of projects) {
    if (restarted >= maxRestarts) break;
    const projectId = readString(project.id);
    if (!projectId) continue;
    let runs: Record<string, unknown>[] = [];
    try {
      const payload = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows`);
      const list = isRecord(payload) ? payload.workflowRuns : null;
      runs = Array.isArray(list) ? list.filter(isRecord) : [];
    } catch {
      continue;
    }
    for (const run of runs) {
      if (restarted >= maxRestarts) break;
      if (readString(run.source) !== 'script_generated') continue;
      if (!isResumableWorkflowRunStatus(run)) continue;
      const scriptSource = readString(run.scriptSource);
      if (!scriptSource) continue;
      try {
        const result = restoreWorkflowScriptBackgroundJob({
          kswarmService,
          projectId,
          workflowRunId: readString(run.id),
          scriptSource,
          scriptHash: readString(run.scriptHash) || null,
          assignedAgent: readString(run.assignedAgent) || undefined,
        });
        if (result.restored) restarted += 1;
      } catch {
        // Per-run restore failure must not abort the rest of the scan.
      }
    }
  }
}

// Single-run direct resume powering the renderer's one-click "继续推进" for
// dynamic (script_generated) workflows. Unlike the conversational path, this
// rebuilds the desktop background job directly. All failures return a reason
// code; nothing is thrown back to the renderer.
export async function resumeOneScriptWorkflow(
  kswarmService: KSwarmService,
  projectId: string,
  workflowRunId: string,
): Promise<{ restored: boolean; reason?: string; jobId?: string }> {
  if (!kswarmService) return { restored: false, reason: 'kswarm_unavailable' };
  if (!readString(projectId) || !readString(workflowRunId)) {
    return { restored: false, reason: 'invalid_input' };
  }
  let run: Record<string, unknown> | null = null;
  try {
    const payload = await requestKSwarmJson(
      kswarmService,
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`,
    );
    if (isRecord(payload)) {
      run = isRecord(payload.workflowRun) ? payload.workflowRun : payload;
    }
  } catch {
    return { restored: false, reason: 'kswarm_unavailable' };
  }
  if (!run) return { restored: false, reason: 'not_found' };
  if (readString(run.source) !== 'script_generated') {
    return { restored: false, reason: 'not_script_workflow' };
  }
  if (!isResumableWorkflowRunStatus(run)) {
    return { restored: false, reason: 'not_resumable' };
  }
  const scriptSource = readString(run.scriptSource);
  if (!scriptSource) return { restored: false, reason: 'no_script_source' };
  try {
    return restoreWorkflowScriptBackgroundJob({
      kswarmService,
      projectId,
      workflowRunId: readString(run.id) || workflowRunId,
      scriptSource,
      scriptHash: readString(run.scriptHash) || null,
      assignedAgent: readString(run.assignedAgent) || undefined,
    });
  } catch {
    return { restored: false, reason: 'restore_failed' };
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveToolOutputArtifactPath(
  toolInput: unknown,
  result: string,
  options: ToolOutputArtifactPathOptions = {},
): string | null {
  return resolveToolOutputArtifactPathWithOptions(toolInput, result, options);
}

export function resolveWriteToolArtifactPath(toolName: string, toolInput: unknown): string | null {
  if (!isToolName(toolName, 'write') || !isRecord(toolInput)) return null;
  return readString(toolInput.file_path) || null;
}

interface ToolOutputArtifactPathOptions {
  toolName?: string;
  toolStartedAt?: number;
}

function resolveToolOutputArtifactPathWithOptions(
  toolInput: unknown,
  result: string,
  options: ToolOutputArtifactPathOptions = {},
): string | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (isRecord(parsed)) {
      const explicitlyFailed = parsed.success === false || parsed.ok === false;
      if (explicitlyFailed) return null;

      const returnedPath = readString(parsed.output_path);
      if (returnedPath) return returnedPath;

      const succeeded = parsed.success === true || parsed.ok === true;
      if (succeeded && isRecord(toolInput)) {
        const inputPath = readString(toolInput.output_path);
        if (inputPath) return inputPath;
      }
    }
  } catch {
    // Non-JSON tool output is handled below for bash.
  }

  return resolveBashOutputArtifactPath(toolInput, result, options);
}

function isToolName(toolName: string | undefined, expected: string): boolean {
  return typeof toolName === 'string' && toolName.trim().toLowerCase() === expected;
}

export function attachRuntimeToolRequestScope(toolName: string | undefined, input: unknown, sessionId: string): Record<string, unknown> {
  const toolInput = isRecord(input) ? input : {};
  if (!isToolName(toolName, 'create_project')) return toolInput;
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) return toolInput;
  return {
    ...toolInput,
    _xiaokRequestScope: `task-session:${normalizedSessionId}`,
  };
}

function resolveBashOutputArtifactPath(
  toolInput: unknown,
  result: string,
  options: ToolOutputArtifactPathOptions,
): string | null {
  if (!isToolName(options.toolName, 'bash')) return null;
  if (!result.trim() || result.trimStart().startsWith('Error')) return null;

  const command = isRecord(toolInput) ? readString(toolInput.command) : '';
  const candidates = rankArtifactPathCandidates([
    ...extractArtifactPathCandidates(result),
    ...extractArtifactPathCandidates(command),
  ]);
  for (const candidate of candidates) {
    if (isFreshExistingArtifactPath(candidate, options.toolStartedAt)) {
      return candidate;
    }
  }
  return null;
}

function rankArtifactPathCandidates(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths
    .map((path, index) => ({ path, index, score: scoreArtifactPath(path) }))
    .filter(item => {
      if (!item.path || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.path);
}

function scoreArtifactPath(path: string): number {
  let score = 0;
  if (!/(^|\/)(tmp|private\/tmp|var\/folders)\//.test(path)) score += 10;
  if (/\.(?:pdf|pptx|docx|xlsx)$/iu.test(path)) score += 5;
  return score;
}

function extractArtifactPathCandidates(text: string): string[] {
  if (!text) return [];
  const candidates: string[] = [];
  const pathPatterns = [
    /(?:file:\/\/)?(\/[^\s"'`<>|]+?\.(?:pdf|html|md|markdown|pptx|docx|xlsx|csv|json|txt|png|jpg|jpeg|webp|svg))(?:\b|$)/giu,
    /([A-Za-z]:\\[^\s"'`<>|]+?\.(?:pdf|html|md|markdown|pptx|docx|xlsx|csv|json|txt|png|jpg|jpeg|webp|svg))(?:\b|$)/giu,
  ];
  for (const pattern of pathPatterns) {
    for (const match of text.matchAll(pattern)) {
      const path = normalizeArtifactPathCandidate(match[1]);
      if (path) candidates.push(path);
    }
  }
  return candidates;
}

function normalizeArtifactPathCandidate(path: string): string {
  return path.trim().replace(/[),.;，。]+$/u, '');
}

function isFreshExistingArtifactPath(filePath: string, toolStartedAt?: number): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (typeof toolStartedAt === 'number' && stat.mtimeMs < toolStartedAt - 2_000) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => readString(item)).filter(Boolean);
}

async function buildDesktopSessionTraceBundle(
  input: { kind: 'session' | 'task'; id: string },
  dataRoot: string,
  snapshotStore: FileTaskSnapshotStore,
) {
  if (input.kind === 'task') {
    const snapshot = await requireTaskSnapshot(snapshotStore, input.id);
    return buildSessionTraceBundleFromSnapshots([snapshot], { sessionId: snapshot.sessionId, dataRoot });
  }
  const snapshots = loadTaskSnapshotsForSession({ dataRoot, sessionId: input.id });
  if (snapshots.length === 0) {
    throw new Error(`no snapshots found for session: ${input.id}`);
  }
  return buildSessionTraceBundleFromSnapshots(snapshots, { sessionId: input.id, dataRoot });
}

async function requireTaskSnapshot(snapshotStore: FileTaskSnapshotStore, taskId: string): Promise<TaskSnapshot> {
  const snapshot = await snapshotStore.recoverTask(taskId);
  if (!snapshot) throw new Error(`task snapshot not found: ${taskId}`);
  return snapshot;
}

async function fetchKSwarmProjectFullDetail(kswarmService: KSwarmService, projectId: string): Promise<unknown> {
  const response = await kswarmService.request(`/projects/${projectId}/full`);
  if (!response.ok) {
    throw new Error(`kswarm project detail request failed: HTTP ${response.status}`);
  }
  return response.json();
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
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
      availableModels: profile.availableModels?.map(m => ({
        modelId: m.modelId, model: m.model, label: m.label, capabilities: m.capabilities,
      })),
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

## 工具优先 / 真实数据优先（防编造）

- 在汇报任何项目、任务、定时任务、消息通道、skill、记忆、产物的状态前，必须先调用对应的查询工具拿当前状态，禁止凭对话历史或印象推断。
- 不允许把"我之前说过的状态"或"我估计是这样"当作事实。每一条状态声明都必须能在最近一次工具返回里找到原始字段；回复中要引用真实字段名/取值（例如 'task.failureReason'、'projectIntervention.primaryAction.strategy'、'gateDecision.reason'、'scheduled_task.lastRunAt'），不要改写或润色。
- 工具调用失败时，如实告诉用户"我没有读到 X，请稍后重试或 Y"，禁止伪造结果。
- 如果用户问的状态你还没读，先调工具再回答；不要先给一段听起来对的话再补调。
- 长流程不能省略状态核查：每次推进项目、续跑工作流、续跑/取消定时任务前，都要先 inspect 当前真实状态，再决定动作。

你有以下工具可用：
- Read: 读取文件内容
- Write: 创建或覆盖文件
- Edit: 精确编辑文件中的特定内容
- Bash: 执行 shell 命令
- Grep: 搜索文件内容
- Glob: 按模式匹配查找文件
- skill: 调用已安装的 skill
- reminder_create: 创建到点通知提醒，只通知用户，不会自动执行 AI 任务
- reminder_list: 列出所有活跃的提醒
- reminder_cancel: 取消一个提醒
- scheduled_task_create: 创建未来会自动执行 AI 任务的定时任务
- scheduled_task_list: 列出自动执行 AI 的定时任务
- scheduled_task_cancel: 取消自动执行 AI 的定时任务
- channel_list: 列出所有配置的消息通道（云之家、Discord、飞书等）
- channel_send: 向指定通道发送消息（当用户说"发消息到云之家"、"通知团队"时使用）
- skill_install: 安装一个技能（当用户说"安装XX技能"时使用）
- skill_uninstall: 卸载一个技能（当用户说"卸载XX技能"时使用）
- skill_list: 列出已安装的技能
- report_progress: 向用户报告任务执行计划和进度
- notebook_write: 将需要跨对话保留的重要信息写入长期笔记本（偏好、身份、约定）
- notebook_read: 读取长期笔记本中的个人备忘和约定（可与 kb_search 同时使用）
- kb_list_collections: 列出知识库集合
- kb_create_collection: 创建知识库集合
- kb_search: 【知识检索】在用户的知识库中搜索已保存的文档和资料（可与 notebook_read 同时使用）
- kb_add_source: 向知识库写入内容（文本/文件/URL），写入后自动分片索引，可被 kb_search 检索
- kb_get_source: 获取知识库中某文档的完整内容（支持分页）
- inspect_project: 检查 KSwarm 项目状态、卡住任务和最新可读产物
- create_project: 创建 KSwarm 多智能体协作项目；仅当用户明确说"创建项目""建个项目""用工作流""多智能体协作"时才能调用；单人可完成的任务（写报告、做调研、生成文档等）禁止调用此工具，直接执行即可。用户明确要求 workflow/动态工作流时必须传 executionMode="workflow"
- run_dynamic_workflow_script: 为 KSwarm 项目运行命令式动态 workflow 脚本，支持 phase、agent、parallel、pipeline 编排
- get_dynamic_workflow_status: 查询 dynamic workflow run 当前状态、并行分支、阻塞原因和交付状态
- continue_project: 安全推进已经卡住的 KSwarm 项目
- repair_project_task_from_file: 修复 KSwarm 失败任务时，提交已经写入 artifacts 的产物文件路径回审核流
- repair_project_task: 旧兼容工具；不要用它提交完整正文

## 提醒与自动执行

xiaok desktop 内置了统一定时动作服务。不要写 shell 脚本、cron、launchd 等系统级定时机制来实现普通提醒或自动任务。
如果用户明确要求写脚本或使用系统定时，则遵循用户要求。

reminder_create 只创建到点通知，不会自动执行 AI 任务，不会检查项目、调用工具或继续推理。

scheduled_task_create 会在到期时自动创建新的 AI task。用户说“你/小K 之后去检查/执行/生成/推进”时使用它。

用户说“每隔N分钟检查/执行/直到完成”时，必须使用 scheduled_task_create，并在 prompt 中写明停止条件满足后调用 scheduled_task_cancel。

不要用 reminder_create 承诺会自动检查项目、调用工具或继续推理。

示例：
- "30分钟后提醒我发日报" → reminder_create(content="发日报", schedule_at=<当前时间+30分钟>)
- "明天早上9点提醒我开会" → reminder_create(content="开会", schedule_at=<明天9点的时间戳>)
- "10分钟后你再看一下这个项目" → scheduled_task_create(frequency="once", schedule_at=<当前时间+10分钟>, prompt="检查项目...")
- "每5分钟检查项目直到完成" → scheduled_task_create(frequency="interval", interval_minutes=5, prompt="检查项目；完成时调用 scheduled_task_cancel")
- "每天晚上11点同步代码" → scheduled_task_create(frequency="daily", hour=23, minute=0, prompt="同步代码到GitHub")

时间戳使用毫秒级 UNIX timestamp。

## 知识库（重要）

用户已在知识库中保存了文档和资料，在笔记本中保存了个人备忘。当用户提问时，**同时调用 notebook_read 和 kb_search**，从两个来源获取信息。

使用方法：
- 同时调用 notebook_read(query) 和 kb_search(query)（collection_id 可省略，默认使用第一个集合）
- 如果都无结果，直接用自身知识回答，不要重复搜索
- 需要读全文时调用 kb_get_source(source_id)

触发条件：用户问的问题不是通用常识、且可能涉及个人资料/文档/偏好时，同时搜索两个来源。纯代码任务或通用问题不需要搜索。

## create_project 使用边界（重要）

create_project 只用于用户**明确要求**多智能体协作或项目管理的场景。判断标准：

**必须调用 create_project 的情况**：
- 用户说”创建项目””建个项目””发起项目””启动工作流””用工作流方式””让多个智能体协作””多人并行”

**禁止调用 create_project 的情况**（直接执行）：
- 用户说”写报告””写调研报告””生成文档””帮我做个PPT””分析一下XX””总结这些材料”
- 任何单人可完成的内容生成、分析、整理任务
- 用户没有提到”项目””工作流””协作””多智能体”等关键词

简单规则：如果一个人（你自己）能直接完成的任务，就直接做，不要创建项目。

## Swarm 项目推进

## Dynamic Workflow

当用户明确说”workflow 方式””动态工作流””用工作流跑””让 N 个智能体并行”等：

1. 先用 create_project 创建 KSwarm 项目，并传 executionMode="workflow"。
2. 再调用 run_dynamic_workflow_script 启动命令式 JavaScript workflow；脚本必须使用 phase(...)、agent(...)、parallel(...) 或 pipeline(...)，不要提交声明式 agents/nodes/tasks JSON。
3. 用户要求多个智能体或并行处理时，脚本必须用 parallel([() => agent(...), ...]) 表达并行分支；不要把并行需求改写成串行步骤。
4. 默认 waitForCompletion=false，启动后必须在回复中说明 workflowRunId、当前正在后台执行、可以到项目详情查看状态；用户问进展时用 get_dynamic_workflow_status。
5. 如果最终交付物是报告、分析报告、研究报告，最终节点必须生成 report renderer HTML 交付物；只生成 .report.md 或普通 markdown 不算完成。脚本里的最终 agent prompt 要明确要求调用 report renderer / kai-report-creator 生成 HTML，并返回 html artifact 路径。
6. 如果 workflow 被阻塞，不要说已完成；说明 gateDecision 或 projectDelivery 里的失败原因，并给出下一步需要修复的交付物。

当用户要求"推进项目"、"诊断项目"、"修复项目"、"项目卡住了"，或提到某个 Swarm/KSwarm 项目名称时：

1. 如果上下文没有完整 projectId、taskId、expectedTaskUpdatedAt，先调用 inspect_project 读取项目状态；用户只给项目名时，也先调用 inspect_project。
2. 如果 inspect_project 返回 ambiguous_project，不要猜测项目；列出候选并请用户确认。
3. 如果 inspect_project 返回 projectIntervention.primaryAction.strategy 是 needs_conversation，或卡住任务已经多次质量失败，不要先调用 continue_project；直接根据 inspect_project 返回的失败原因和最新可读产物生成完整修复产物，把完整修复产物写入 artifacts 文件，然后调用 repair_project_task_from_file。
4. 其他可自动恢复的 projectIntervention.required 状态，先调用 continue_project，并传入 projectId、expectedPrimaryTaskId、expectedTaskUpdatedAt。
5. 如果 continue_project 返回 recovery_budget_exceeded、needs_user_action 或 needs_conversation，不要反复调用 continue_project；应根据 inspect_project 返回的失败原因和最新可读产物，生成完整修复产物，把文件写入 artifacts 后调用 repair_project_task_from_file。
6. 不要在回复、stdout、tool 参数或聊天消息中粘贴完整交付物；只传 artifactPath、summary、mimeType 等元数据。
7. repair_project_task_from_file 只是提交复审，不是强制完成；不要跳过必需任务，不要人工放行不合格结果，不要提交占位符。
8. 完成后说明项目是"已继续派发"、"已提交复审"还是"仍需用户确认"，并说明下一步等待谁处理。
9. 如果 inspect_project 返回 projectIntervention.kind 是 script_workflow（strategy=resume_workflow），说明这是被中断的动态工作流（dynamic workflow），需要续跑而不是新建：先调用 get_dynamic_workflow_status 查看卡点，再调用 run_dynamic_workflow_script 续跑，只传 projectId 和 resumeWorkflowRunId（即 intervention 里的 workflowRunId），不要传 script 参数——已持久化的脚本源会自动恢复并重新校验，重贴脚本可能导致 hash 不一致而失败。

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
这些文件会被自动导入到任务材料库，当前消息会列出每个文件的 materialId、文件名、格式和解析状态。
读取附件必须使用 read_material 工具，并传入对应的 materialId。
不要用 Glob、Read、Bash 或临时脚本去重新寻找、复制或解析同一个上传附件。
如果 read_material 返回 unsupported 或 failed，应明确告诉用户哪个文件暂时无法直接读取，以及原因。

用户上传文件后，消息中会显示"附件: 文件名"的提示。你应该：
1. 确认收到附件
2. 在需要文件内容时调用 read_material
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
    case 'read_material': return '读取附件';
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
  const pluginsDir = getConfigDir('plugins');
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

export function createReportArtifactTool(): Tool {
  return {
    permission: 'write',
    definition: {
      name: 'render_report_artifact',
      description: [
        '将 .report.md IR 内容渲染为 HTML 报告 artifact。',
        '用于 KSwarm / dynamic workflow 的最终报告节点。',
        '不要读取插件内部文件，不要手写 HTML；把完整 IR 放入 ir_content，并把 output_path 指向项目 artifacts 目录下的 .html 文件。',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          ir_content: { type: 'string', description: '完整 .report.md IR 内容，包含 frontmatter 和 ::: component blocks' },
          output_path: { type: 'string', description: 'HTML 输出文件路径，必须是 .html 或 .htm' },
          theme: { type: 'string', description: '可选主题名，例如 corporate-blue' },
        },
        required: ['ir_content', 'output_path'],
      },
    },
    async execute(input) {
      const record = input as Record<string, unknown>;
      const irContent = readString(record.ir_content);
      const outputPath = resolve(readString(record.output_path));
      const theme = readString(record.theme) || undefined;
      if (!irContent.trim()) return JSON.stringify({ success: false, error: 'ir_content_required' });
      if (!outputPath) return JSON.stringify({ success: false, error: 'output_path_required' });
      if (!['.html', '.htm'].includes(extname(outputPath).toLowerCase())) {
        return JSON.stringify({ success: false, error: 'output_path_must_be_html', output_path: outputPath });
      }
      if (!isAllowedReportArtifactOutputPath(outputPath)) {
        return JSON.stringify({ success: false, error: 'output_path_outside_allowed_roots', output_path: outputPath });
      }

      const pluginDir = join(getConfigDir('plugins'), 'kai-report-creator');
      const serverBundlePath = join(
        pluginDir,
        'mcp-servers',
        'report-renderer',
        'dist',
        'server.bundle.js',
      );
      const rendererPath = join(
        getConfigDir('plugins'),
        'kai-report-creator',
        'mcp-servers',
        'report-renderer',
        'dist',
        'renderer',
        'html-builder.js',
      );
      if (!existsSync(serverBundlePath)) {
        return JSON.stringify({
          success: false,
          error: 'report_renderer_not_installed',
          server_path: serverBundlePath,
          renderer_path: rendererPath,
        });
      }

      try {
        const result = await renderReportArtifactViaBundledMcp({
          pluginDir,
          serverBundlePath,
          irContent,
          outputPath,
          theme,
        });
        const outputExists = existsSync(outputPath);
        const success = outputExists && (result.success !== false || isReportRendererStructurallyValid(result.validation));
        if (success && isRecord(result.validation) && result.validation.l3_passed === false) {
          console.warn('[report-renderer] L3 quality check failed (KPI placeholders detected)', {
            warnings: Array.isArray(result.validation.l3_warnings) ? result.validation.l3_warnings : [],
          });
        }
        return JSON.stringify({
          ...result,
          success,
          output_path: outputPath,
          stats: result.stats ?? null,
          validation: result.validation ?? null,
          warnings: Array.isArray(result.warnings) ? result.warnings : [],
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          output_path: outputPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function createReportProgressTool(): Tool {
  return {
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
}

async function renderReportArtifactViaBundledMcp({
  pluginDir,
  serverBundlePath,
  irContent,
  outputPath,
  theme,
}: {
  pluginDir: string;
  serverBundlePath: string;
  irContent: string;
  outputPath: string;
  theme?: string;
}): Promise<Record<string, unknown>> {
  mkdirSync(dirname(outputPath), { recursive: true });
  const command = process.env.XIAOK_NODE_CMD || process.execPath;
  const runtimeEnv = !process.env.XIAOK_NODE_CMD && process.versions.electron
    ? { ELECTRON_RUN_AS_NODE: '1' }
    : undefined;
  const proc = startMcpServerProcess(command, [serverBundlePath], {
    cwd: pluginDir,
    env: runtimeEnv,
  });
  const transport = createStdioMcpTransport(proc.child);
  const client = createMcpRuntimeClient(transport);
  try {
    await withReportRendererTimeout(client.initialize(), 'report_renderer_initialize');
    const raw = await withReportRendererTimeout(
      client.callTool('render_report', {
        ir_content: irContent,
        output_path: outputPath,
        ...(theme ? { theme } : {}),
      }),
      'report_renderer_render',
    );
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Handled below as an invalid renderer response.
    }
    return {
      success: false,
      error: 'report_renderer_response_invalid',
      response: raw.slice(0, 2000),
    };
  } finally {
    transport.dispose();
    proc.dispose();
  }
}

function isReportRendererStructurallyValid(validation: unknown): boolean {
  if (!isRecord(validation)) return false;
  const l0 = validation.l0_passed ?? validation.l0;
  const l1 = validation.l1_passed ?? validation.l1;
  const l2 = validation.l2_passed ?? validation.l2;
  return l0 === true && l1 === true && l2 === true;
}

function withReportRendererTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation}_timeout`)), 30_000);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isAllowedReportArtifactOutputPath(outputPath: string): boolean {
  const allowedRoots = [
    process.cwd(),
    dirname(getConfigDir()),
    join(homedir(), '.kswarm', 'projects'),
  ].map(root => resolve(root));
  return allowedRoots.some(root => {
    const rel = relative(root, outputPath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
  });
}

const DEFAULT_READ_MATERIAL_MAX_CHARS = 50_000;

export const READ_MATERIAL_TOOL_DEFINITION: ToolDefinition = {
  name: 'read_material',
  description: '读取用户通过附件上传的材料。必须使用 materialId，不要用本地路径、glob 或 shell 脚本查找附件。若正文不可提取，也会返回文件名、类型、大小等元数据。',
  inputSchema: {
    type: 'object',
    properties: {
      materialId: { type: 'string', description: '当前用户消息中列出的附件 materialId，例如 mat_0001' },
      maxChars: { type: 'number', description: '可选，返回内容的最大字符数，默认 50000' },
    },
    required: ['materialId'],
  },
};

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function buildMaterialManifestForPrompt(materials: MaterialRecord[]): string {
  if (materials.length === 0) return '';
  const lines = [
    '',
    '',
    '## 用户上传的文件',
    '',
    '以下文件已导入任务材料库。如果用户只问文件名、格式、大小等元数据，请直接根据清单回答；需要读取正文时，请调用 read_material，并传入对应 materialId。不要用 glob、read、bash 或脚本重新查找附件。',
    '',
  ];
  for (const material of materials) {
    const ext = extname(material.originalName || material.workspacePath).toLowerCase() || 'unknown';
    const status = material.parseStatus || 'pending';
    const summary = material.parseSummary ? `, ${material.parseSummary}` : '';
    const isImage = IMAGE_MIME_TYPES.has(material.mimeType);
    const imageNote = isImage ? '；已作为多模态图像输入直接传递给模型，无需调用 read_material' : '';
    lines.push(`- materialId: ${material.materialId}; 文件: ${material.originalName}; 格式: ${ext}; MIME: ${material.mimeType}; 大小: ${material.sizeBytes} bytes (${formatMaterialSize(material.sizeBytes)}); 状态: ${status}${summary}${imageNote}`);
  }
  return lines.join('\n');
}

export function buildImageBlocksForMaterials(materials: MaterialRecord[]): Extract<MessageBlock, { type: 'image' }>[] {
  const blocks: Extract<MessageBlock, { type: 'image' }>[] = [];
  for (const material of materials) {
    if (!IMAGE_MIME_TYPES.has(material.mimeType)) continue;
    try {
      const data = readFileSync(material.workspacePath).toString('base64');
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: material.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data,
        },
      });
    } catch {
      // If the file can't be read, skip it silently — it will still appear in the text manifest
    }
  }
  return blocks;
}

export async function executeReadMaterialForDesktop(
  input: Record<string, unknown>,
  options: {
    taskId: string;
    materials: MaterialRecord[];
    materialRegistry?: MaterialRegistry;
    maxChars?: number;
  },
): Promise<{ ok: boolean; result: string }> {
  const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';
  const maxChars = normalizeReadMaterialLimit(input.maxChars, options.maxChars);
  if (!materialId) {
    return createReadMaterialResult(false, {
      ok: false,
      error: 'invalid_input',
      message: 'read_material 需要 materialId。',
    });
  }

  const material = options.materials.find((item) => item.materialId === materialId);
  if (!material) {
    return createReadMaterialResult(false, {
      ok: false,
      error: 'material_not_attached',
      materialId,
      message: '该 materialId 不属于当前任务，无法读取。',
    });
  }
  if (!options.materialRegistry) {
    return createReadMaterialResult(false, {
      ok: false,
      error: 'material_tool_unavailable',
      materialId,
      originalName: material.originalName,
      mimeType: material.mimeType,
      sizeBytes: material.sizeBytes,
      message: '当前运行器没有可用的材料注册表，无法读取附件。',
    });
  }

  if (material.extractedTextPath && existsSync(material.extractedTextPath)) {
    const cached = truncateMaterialText(readFileSync(material.extractedTextPath, 'utf8'), maxChars);
    return createReadMaterialResult(true, {
      ok: true,
      ...buildReadMaterialMetadata(material),
      parseStatus: 'parsed',
      cached: true,
      content: cached,
    });
  }

  const extraction = await extractMaterialText({
    workspacePath: material.workspacePath,
    mimeType: material.mimeType,
    maxChars,
  });
  if (extraction.parseStatus === 'parsed' && extraction.text) {
    const extractedTextPath = join(dirname(material.workspacePath), `${material.materialId}.txt`);
    writeFileSync(extractedTextPath, extraction.text, 'utf8');
    await options.materialRegistry.updateMaterialExtraction(material.materialId, {
      extractedTextPath,
      parseStatus: 'parsed',
      parseSummary: extraction.parseSummary,
    });
    return createReadMaterialResult(true, {
      ok: true,
      ...buildReadMaterialMetadata(material),
      parseStatus: 'parsed',
      parseSummary: extraction.parseSummary,
      content: extraction.text,
    });
  }

  await options.materialRegistry.updateMaterialExtraction(material.materialId, {
    parseStatus: extraction.parseStatus,
    parseSummary: extraction.parseSummary,
    errorMessage: extraction.errorMessage,
  });
  if (extraction.parseStatus === 'unsupported') {
    return createReadMaterialResult(true, {
      ok: true,
      ...buildReadMaterialMetadata(material),
      parseStatus: 'unsupported',
      parseSummary: extraction.parseSummary,
      contentAvailable: false,
      message: extraction.errorMessage ?? '该附件格式暂不支持直接提取正文；文件名、类型、大小等元数据仍可用于回答元数据问题。',
    });
  }
  return createReadMaterialResult(false, {
    ok: false,
    error: 'material_read_failed',
    ...buildReadMaterialMetadata(material),
    parseStatus: extraction.parseStatus,
    contentAvailable: false,
    message: extraction.errorMessage ?? '附件读取失败。',
  });
}

async function executeDesktopTaskTool(
  toolCall: ToolCall,
  options: {
    registry: ToolRegistry;
    taskId: string;
    materials: MaterialRecord[];
    materialRegistry?: MaterialRegistry;
  },
): Promise<{ ok: boolean; result: string }> {
  if (toolCall.name === 'read_material') {
    return executeReadMaterialForDesktop(toolCall.input, {
      taskId: options.taskId,
      materials: options.materials,
      materialRegistry: options.materialRegistry,
    });
  }
  const result = await options.registry.executeTool(toolCall.name, toolCall.input);
  return { ok: !result.startsWith('Error'), result };
}

function normalizeReadMaterialLimit(inputLimit: unknown, fallback?: number): number {
  const raw = typeof inputLimit === 'number' && Number.isFinite(inputLimit)
    ? inputLimit
    : fallback ?? DEFAULT_READ_MATERIAL_MAX_CHARS;
  return Math.max(1_000, Math.min(100_000, Math.floor(raw)));
}

function truncateMaterialText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[截断，原文件 ${text.length} 字符]`;
}

function buildReadMaterialMetadata(material: MaterialRecord): Record<string, unknown> {
  return {
    materialId: material.materialId,
    originalName: material.originalName,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
  };
}

function formatMaterialSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value < 10 ? 2 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function createReadMaterialResult(ok: boolean, payload: Record<string, unknown>): { ok: boolean; result: string } {
  return { ok, result: JSON.stringify(payload, null, 2) };
}

const DESKTOP_MODEL_TOOL_LOOP_MAX_ITERATIONS = 20;

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason instanceof Error
    ? signal.reason.message
    : typeof signal.reason === 'string'
      ? signal.reason
      : '';
  if (reason === 'task_watchdog_timeout') {
    throw new Error('任务执行超时，已自动终止。');
  }
  if (reason === 'loop_poll_timeout') {
    throw new Error('任务运行时间过长，已自动停止。');
  }
  // user_cancelled and any unknown/missing reason fall back to the prior wire
  // message so existing catch blocks (and renderer copy) keep working.
  throw new Error('task cancelled');
}

const DESKTOP_MODEL_TOOL_LOOP_FINALIZATION_PROMPT = [
  '工具调用预算已用尽。不要再调用工具。',
  '请基于以上所有工具结果直接给出最终答复。',
  '如果原始任务要求 JSON 或特定 schema，必须严格按原始 schema 输出。',
  '不要输出 Markdown 代码块，除非原始任务明确要求 Markdown 正文。',
].join('\n');

async function streamDesktopToolLoopFinalization(input: {
  adapter: Pick<ModelAdapter, 'stream'>;
  apiMessages: Message[];
  systemPrompt: string;
  signal: AbortSignal;
  sessionId: string;
  turnId: string;
  intentId: string;
  stepId: string;
  emitRuntimeEvent: TaskRunnerInput['emitRuntimeEvent'];
  onUsage?: (chunk: Extract<StreamChunk, { type: 'usage' }>) => void;
}): Promise<{ reply: string; assistantBlocks: MessageBlock[] }> {
  const assistantBlocks: MessageBlock[] = [];
  let reply = '';
  for await (const chunk of input.adapter.stream(input.apiMessages, [], input.systemPrompt)) {
    throwIfAborted(input.signal);
    if (chunk.type === 'text') {
      const lastBlock = assistantBlocks[assistantBlocks.length - 1];
      if (lastBlock?.type === 'text') {
        lastBlock.text += chunk.delta;
      } else {
        assistantBlocks.push({ type: 'text', text: chunk.delta });
      }
      reply += chunk.delta;
      input.emitRuntimeEvent({
        type: 'assistant_delta',
        sessionId: input.sessionId,
        turnId: input.turnId,
        intentId: input.intentId,
        stepId: input.stepId,
        delta: chunk.delta,
      });
    } else if (chunk.type === 'thinking') {
      const lastBlock = assistantBlocks[assistantBlocks.length - 1];
      if (lastBlock?.type === 'thinking') {
        lastBlock.thinking += chunk.delta;
      } else {
        assistantBlocks.push({ type: 'thinking', thinking: chunk.delta });
      }
    } else if (chunk.type === 'tool_use') {
      // Model violated the "no tools" finalization constraint. Ignore the tool
      // call and keep consuming the stream — accumulated text is sufficient.
      continue;
    } else if (chunk.type === 'usage') {
      input.onUsage?.(chunk);
    }
  }
  if (!reply.trim()) {
    throw new Error('desktop_tool_loop_finalization_empty');
  }
  return { reply, assistantBlocks };
}

interface ToolLoopStrategies {
  compact: {
    enabled: boolean;
    shouldCompact: (inputTokens: number) => boolean;
    doCompact: (msgs: Message[]) => Promise<void>;
  };
  buildApiView: (msgs: Message[]) => Message[];
  processToolResult: (result: string, toolName: string, toolUseId: string) => string;
  trackAutoProgress: boolean;
  trackReferenceReads: boolean;
  emitSkillArtifactTrace: boolean;
}

interface ToolLoopContext {
  adapter: Pick<ModelAdapter, 'stream'>;
  systemPrompt: string;
  messages: Message[];
  allToolDefs: ToolDefinition[];
  registry: ToolRegistry;
  signal: AbortSignal;
  taskDeadline: number;
  sessionId: string;
  turnId: string;
  intentId: string;
  stepId: string;
  taskId: string;
  materials: MaterialRecord[];
  materialRegistry?: MaterialRegistry;
  emitRuntimeEvent: TaskRunnerInput['emitRuntimeEvent'];
  skillInvocation: SkillInvocation | null;
  skillCatalog: SkillCatalog;
  dataRoot: string;
  taskStartTime: number;
  strategies: ToolLoopStrategies;
  maxIterations?: number;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
}

async function runDesktopToolLoop(ctx: ToolLoopContext): Promise<{
  reply: string;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  referenceReads: number;
  autoSteps: Array<{ id: string; label: string; status: string }>;
  skillNamesDetected: string[];
  skillTriggerType: 'slash_command' | 'tool_call' | 'auto';
  skillInvocation: SkillInvocation | null;
}> {
  let reply = '';
  let iteration = 0;
  let totalToolCalls = 0;
  let planEmitted = false;
  const autoSteps: Array<{ id: string; label: string; status: string }> = [];
  let referenceReads = 0;
  let lastRequestInputTokens = 0;
  let toolResultsAwaitingFinalResponse = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let { skillInvocation } = ctx;
  let skillNamesDetected: string[] = [];
  let skillTriggerType: 'slash_command' | 'tool_call' | 'auto' = 'auto';

  if (skillInvocation) {
    appendTrace(ctx.dataRoot, {
      ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
      stageId: skillInvocation.stageId, iteration: 1, event: 'model_turn_start',
    });
  }

  while (iteration < (ctx.maxIterations ?? DESKTOP_MODEL_TOOL_LOOP_MAX_ITERATIONS)) {
    throwIfAborted(ctx.signal);
    if (Date.now() > ctx.taskDeadline) throw new Error('任务超时，可能是网络不稳定或模型响应过慢。请检查网络后重试。');
    iteration++;

    if (skillInvocation) {
      const budgetResult = checkBudget(skillInvocation, iteration, totalToolCalls, referenceReads, totalInputTokens, ctx.dataRoot);
      if (!budgetResult.ok) {
        appendTrace(ctx.dataRoot, {
          ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'model_turn_end',
          durationMs: Date.now() - ctx.taskStartTime, details: `stopped: ${budgetResult.reason}`,
        });
        break;
      }
    }

    if (skillInvocation && iteration > 1) {
      appendTrace(ctx.dataRoot, {
        ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, iteration, event: 'model_turn_start',
      });
    }

    const assistantBlocks: MessageBlock[] = [];

    if (ctx.strategies.compact.enabled && iteration > 1 && ctx.strategies.compact.shouldCompact(lastRequestInputTokens)) {
      await ctx.strategies.compact.doCompact(ctx.messages);
    }

    const apiMessages = ctx.strategies.buildApiView(ctx.messages);
    lastRequestInputTokens = 0;
    for await (const chunk of ctx.adapter.stream(apiMessages, ctx.allToolDefs, ctx.systemPrompt)) {
      throwIfAborted(ctx.signal);
      if (chunk.type === 'text') {
        const lastBlock = assistantBlocks[assistantBlocks.length - 1];
        if (lastBlock?.type === 'text') {
          lastBlock.text += chunk.delta;
        } else {
          assistantBlocks.push({ type: 'text', text: chunk.delta });
        }
        reply += chunk.delta;
        ctx.emitRuntimeEvent({ type: 'assistant_delta', sessionId: ctx.sessionId, turnId: ctx.turnId, intentId: ctx.intentId, stepId: ctx.stepId, delta: chunk.delta });
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
          ctx.onUsage?.(inputTkns, chunk.usage?.outputTokens ?? 0);
        } catch (e) { console.warn('[usage] token capture failed:', (e as Error).message) }
      }
    }
    ctx.messages.push({ role: 'assistant', content: assistantBlocks });
    const toolCalls = assistantBlocks.filter((b): b is ToolCall => b.type === 'tool_use');
    if (toolCalls.length === 0) {
      if (assistantBlocks.some((block) => block.type === 'text' && block.text.trim())) {
        toolResultsAwaitingFinalResponse = false;
      }
      break;
    }
    const toolResults: MessageBlock[] = [];
    for (const toolCall of toolCalls) {
      throwIfAborted(ctx.signal);
      totalToolCalls++;
      const runtimeToolInput = attachRuntimeToolRequestScope(toolCall.name, toolCall.input, ctx.sessionId);
      const isInternalTool = toolCall.name === 'report_progress' || toolCall.name === 'skill' || toolCall.name === 'skill_bundle_refs' || toolCall.name === 'skill_list';
      if (!isInternalTool && !planEmitted) {
        planEmitted = true;
      }
      ctx.emitRuntimeEvent({ type: 'pre_tool_use', sessionId: ctx.sessionId, turnId: ctx.turnId, toolName: toolCall.name, toolInput: runtimeToolInput, toolUseId: toolCall.id });

      if (skillInvocation) {
        appendTrace(ctx.dataRoot, {
          ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'tool_start',
          toolName: toolCall.name,
        });
      }

      if (ctx.strategies.trackReferenceReads && isToolName(toolCall.name, 'read')) {
        referenceReads++;
        if (skillInvocation) {
          appendTrace(ctx.dataRoot, {
            ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'tool_end',
            toolName: 'read_reference', details: String((toolCall.input as Record<string, unknown>).file_path || ''),
          });
        }
      }

      if (toolCall.name === 'skill') {
        try {
          const extracted = extractSkillNames(toolCall.input as Record<string, unknown>);
          if (skillNamesDetected.length === 0 || skillTriggerType === 'auto') {
            skillNamesDetected = extracted;
            if (skillTriggerType === 'auto') skillTriggerType = 'tool_call';
            if (!skillInvocation) {
              skillInvocation = buildSkillInvocation(extracted[0], ctx.skillCatalog, ctx.sessionId);
              if (skillInvocation) {
                appendTrace(ctx.dataRoot, {
                  ts: Date.now(), taskId: ctx.sessionId, skillName: extracted[0],
                  event: 'skill_invoked', details: 'tool_call',
                });
              }
            }
          }
        } catch { /* non-critical */ }
      }
      const toolStartedAt = Date.now();
      let { ok, result } = await executeDesktopTaskTool({ ...toolCall, input: runtimeToolInput }, {
        registry: ctx.registry,
        taskId: ctx.taskId,
        materials: ctx.materials,
        materialRegistry: ctx.materialRegistry,
      });
      if (ok) {
        ctx.emitRuntimeEvent({ type: 'post_tool_use', sessionId: ctx.sessionId, turnId: ctx.turnId, toolName: toolCall.name, toolInput: runtimeToolInput, toolResponse: result.slice(0, 10000), toolUseId: toolCall.id });
      } else {
        ctx.emitRuntimeEvent({ type: 'post_tool_use_failure', sessionId: ctx.sessionId, turnId: ctx.turnId, toolName: toolCall.name, toolInput: runtimeToolInput, toolUseId: toolCall.id, error: result.slice(0, 10000) });
      }
      if (ctx.strategies.trackAutoProgress && !isInternalTool) {
        const label = toolNameToLabel(toolCall.name, toolCall.input as Record<string, unknown>);
        autoSteps.push({ id: `auto-${totalToolCalls}`, label, status: ok ? 'completed' : 'failed' });
        ctx.emitRuntimeEvent({ type: 'progress_plan_reported', sessionId: ctx.sessionId, steps: autoSteps });
      }

      if (skillInvocation) {
        appendTrace(ctx.dataRoot, {
          ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
          stageId: skillInvocation.stageId, iteration, event: 'tool_end',
          toolName: toolCall.name, outputBytes: result.length,
        });
      }

      const writeArtifactPath = resolveWriteToolArtifactPath(toolCall.name, runtimeToolInput);
      if (ok && writeArtifactPath) {
        const filePath = writeArtifactPath;
        ctx.emitRuntimeEvent({ type: 'file_changed', sessionId: ctx.sessionId, filePath, event: 'add' });
        const extMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
        const kind = extMatch ? extMatch[1].toLowerCase() : 'other';
        const fileName = filePath.split('/').pop() || filePath;
        ctx.emitRuntimeEvent({
          type: 'artifact_recorded',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          intentId: ctx.intentId,
          stageId: ctx.stepId,
          artifactId: `artifact_${toolCall.id}`,
          label: fileName,
          kind,
          path: filePath,
          creator: 'agent',
        });
        if (ctx.strategies.emitSkillArtifactTrace && skillInvocation) {
          appendTrace(ctx.dataRoot, {
            ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
            stageId: skillInvocation.stageId, iteration, event: 'tool_end',
            toolName: 'artifact_written', details: filePath,
          });
        }
      }
      if (ok && !isToolName(toolCall.name, 'write') && !isToolName(toolCall.name, 'render_ui')) {
        const filePath = resolveToolOutputArtifactPath(runtimeToolInput, result, { toolName: toolCall.name, toolStartedAt });
        if (filePath) {
          ctx.emitRuntimeEvent({ type: 'file_changed', sessionId: ctx.sessionId, filePath, event: 'add' });
          const extMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
          const kind = extMatch ? extMatch[1].toLowerCase() : 'other';
          const fileName = filePath.split('/').pop() || filePath;
          ctx.emitRuntimeEvent({
            type: 'artifact_recorded',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            intentId: ctx.intentId,
            stageId: ctx.stepId,
            artifactId: `artifact_${toolCall.id}`,
            label: fileName,
            kind,
            path: filePath,
            creator: 'agent',
          });
        }
      }
      if (ok && toolCall.name === 'report_progress') {
        try {
          const parsed = JSON.parse(result);
          if (parsed._validated) {
            ctx.emitRuntimeEvent({ type: 'progress_plan_reported', sessionId: ctx.sessionId, steps: parsed._validated });
            result = JSON.stringify({ ok: true, displayed_steps: parsed.displayed_steps });
          }
        } catch { /* non-critical */ }
      }
      const resultContent = ctx.strategies.processToolResult(result, toolCall.name, toolCall.id);
      toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: resultContent, is_error: !ok });
    }
    ctx.messages.push({ role: 'user', content: toolResults });
    toolResultsAwaitingFinalResponse = true;

    if (skillInvocation) {
      appendTrace(ctx.dataRoot, {
        ts: Date.now(), taskId: ctx.sessionId, skillName: skillInvocation.primarySkill,
        stageId: skillInvocation.stageId, iteration, event: 'model_turn_end',
      });
    }
  }

  if (toolResultsAwaitingFinalResponse) {
    ctx.messages.push({
      role: 'user',
      content: [{ type: 'text', text: DESKTOP_MODEL_TOOL_LOOP_FINALIZATION_PROMPT }],
    });
    const finalized = await streamDesktopToolLoopFinalization({
      adapter: ctx.adapter,
      apiMessages: ctx.strategies.buildApiView(ctx.messages),
      systemPrompt: ctx.systemPrompt,
      signal: ctx.signal,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      intentId: ctx.intentId,
      stepId: ctx.stepId,
      emitRuntimeEvent: ctx.emitRuntimeEvent,
      onUsage: (chunk) => {
        try {
          const inputTkns = chunk.usage?.inputTokens ?? 0;
          lastRequestInputTokens = inputTkns;
          totalInputTokens += inputTkns;
          totalOutputTokens += chunk.usage?.outputTokens ?? 0;
          ctx.onUsage?.(inputTkns, chunk.usage?.outputTokens ?? 0);
        } catch (e) { console.warn('[usage] token capture failed:', (e as Error).message) }
      },
    });
    reply += finalized.reply;
    ctx.messages.push({ role: 'assistant', content: finalized.assistantBlocks });
  }

  return {
    reply,
    totalToolCalls,
    totalInputTokens,
    totalOutputTokens,
    referenceReads,
    autoSteps,
    skillNamesDetected,
    skillTriggerType,
    skillInvocation,
  };
}

interface KSwarmInitialPlanBootstrapInput {
  projectId: string;
  projectName: string;
  goal: string;
  requirements: string;
  planningGuidance: string;
  poAgent: string;
  members: string[];
}

interface KSwarmCreateProjectToolOptions {
  enqueuePlanBootstrap?: (input: KSwarmInitialPlanBootstrapInput) => { ok: true; status: 'queued' } | { ok: false; error: string };
}

export function createKSwarmCreateProjectTool(kswarmService: KSwarmService, options: KSwarmCreateProjectToolOptions = {}): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'create_project',
      description: '创建一个多智能体协作项目（KSwarm）。仅当用户明确说"创建项目""建项目""用工作流""多智能体协作"时调用。单人可完成的任务（写报告、写调研、生成文档、分析材料等）不要调用此工具，直接执行即可。用户可能同时指定智能体数量、名称和交付物要求。报告默认作为 report renderer HTML 规划；演示文稿/幻灯片默认作为 slide renderer HTML 规划，除非用户明确要求 Markdown 或 PPTX。',
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
          workFolder: {
            type: 'string',
            description: '项目工作目录的完整本地路径；仅当用户明确指定工作目录时填写',
          },
          executionMode: {
            type: 'string',
            enum: ['direct', 'workflow', 'auto'],
            description: '项目执行方式。用户明确说 workflow/动态工作流/工作流方式时填 workflow；用户明确说 direct/快速编排时填 direct；不确定时不填或填 auto。',
          },
        },
        required: ['name', 'goal'],
      },
    },
    async execute(input) {
      const { name, goal, requirements, memberNames = [], memberCount = 0, workFolder, executionMode, _xiaokRequestScope } = input as {
        name: string; goal: string; requirements?: string;
        memberNames?: string[]; memberCount?: number; workFolder?: string; executionMode?: string;
        _xiaokRequestScope?: string;
      };
      const resolvedWorkFolder = typeof workFolder === 'string' ? workFolder.trim() : '';
      const resolvedExecutionMode = resolveCreateProjectExecutionMode({
        executionMode,
        name,
        goal,
        requirements: requirements || '',
      });

      const MAX_TOTAL_AGENTS = 10;

      try {
        // 1. 获取现有 agents
        const agentsRes = await kswarmService.request('/agents');
        if (!agentsRes.ok) return JSON.stringify({ error: 'Cannot fetch agents from kswarm' });
        const { agents } = await agentsRes.json() as { agents: Array<{ id: string; name: string; runtimeType?: string; roles?: string[]; status: string; archivedAt?: number | null }> };

        // 2. 选 PO agent（优先 dedicated xiaok-po，兼容旧 xiaok）
        const poAgent = getPreferredPoAgentId(agents);
        if (!poAgent) return JSON.stringify({ error: 'No agents available. Create an agent in kswarm first.' });

        // 3. 解析智能体需求
        const resolvedMembers = resolveCreateProjectMembers({
          agents,
          poAgent,
          memberNames,
          memberCount,
        }).members;
        const explicitlyNamedMemberIds = new Set(
          (Array.isArray(memberNames) ? memberNames : [])
            .map(name => agents.find(agent => agent.id === name || agent.name === name)?.id)
            .filter((id): id is string => Boolean(id))
        );

        // 3a. 自动创建 agent（如果用户明确指定数量且不够，并发创建）
        if (memberCount > 0) {
          const stillNeeded = memberCount - resolvedMembers.length;
          const canCreate = Math.min(stillNeeded, MAX_TOTAL_AGENTS - agents.length);
          if (canCreate > 0) {
            const createResults = await Promise.all(
              Array.from({ length: canCreate }, (_, i) =>
                kswarmService.request('/agents', {
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
              const newAgentId = extractCreatedAgentId(newAgent);
              if (newAgentId && !resolvedMembers.includes(newAgentId)) resolvedMembers.push(newAgentId);
            }
          }
        }
        const sanitizedMembers = sanitizeCreateProjectMembers(resolvedMembers, poAgent);

        // 4. 创建项目
        const planningGuidance = buildCreateProjectPlanningGuidanceForTool({ goal, requirements: requirements || '' });
        const clientRequestKey = buildCreateProjectClientRequestKey({
          requestScope: _xiaokRequestScope,
          name,
          goal,
          requirements: requirements || '',
          members: sanitizedMembers,
          workFolder: resolvedWorkFolder,
        });
        const res = await kswarmService.request('/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, goal,
            requirements: requirements || '',
            ...(planningGuidance ? { planningGuidance } : {}),
            poAgent,
            members: sanitizedMembers,
            agentSelection: {
              poAgent: { agentId: poAgent, source: 'default_seed' },
              members: sanitizedMembers.map(agentId => ({
                agentId,
                source: explicitlyNamedMemberIds.has(agentId) ? 'explicit_user' : 'default_seed',
              })),
            },
            ...(resolvedExecutionMode ? { executionMode: resolvedExecutionMode } : {}),
            ...(options.enqueuePlanBootstrap ? { autoStartPlanning: false } : {}),
            ...(resolvedWorkFolder ? { workFolder: resolvedWorkFolder } : {}),
            ...(clientRequestKey ? { clientRequestKey } : {}),
          }),
        });
        if (!res.ok) return JSON.stringify({ error: `Failed to create project: ${res.status}` });
        const { project, reused } = await res.json() as { project: { id: string; name: string; status: string; createdAt: number }; reused?: boolean };

        let planningStatus: 'queued' | undefined;
        if (options.enqueuePlanBootstrap && !reused) {
          const enqueueResult = options.enqueuePlanBootstrap({
            projectId: project.id,
            projectName: project.name,
            goal,
            requirements: requirements || '',
            planningGuidance,
            poAgent,
            members: sanitizedMembers,
          });
          if (!enqueueResult.ok) {
            return JSON.stringify({
              error: 'project_created_but_planning_enqueue_failed',
              projectId: project.id,
              name: project.name,
              reason: enqueueResult.error,
            });
          }
          planningStatus = enqueueResult.status;
        }

        // 5. 返回 project_card 标记
        return JSON.stringify({
          type: 'project_card',
          projectId: project.id,
          name: project.name,
          goal,
          status: options.enqueuePlanBootstrap && !reused ? 'planning' : project.status,
          createdAt: project.createdAt,
          memberCount: sanitizedMembers.length,
          ...(resolvedExecutionMode ? { executionMode: resolvedExecutionMode } : {}),
          ...(reused ? { reused: true } : {}),
          ...(planningStatus ? { planningStatus } : {}),
        });
      } catch (err) {
        return JSON.stringify({ error: `KSwarm service unavailable: ${(err as Error).message}` });
      }
    },
  };
}

function resolveCreateProjectExecutionMode(input: {
  executionMode?: unknown;
  name: string;
  goal: string;
  requirements: string;
}): 'direct' | 'workflow_preferred' | 'auto' | undefined {
  const explicit = normalizeCreateProjectExecutionMode(input.executionMode);
  if (explicit && explicit !== 'auto') return explicit;
  const inferred = inferCreateProjectExecutionModeFromIntent([
    input.name,
    input.goal,
    input.requirements,
  ].join('\n'));
  return inferred || (explicit === 'auto' ? 'auto' : undefined);
}

function normalizeCreateProjectExecutionMode(value: unknown): 'direct' | 'workflow_preferred' | 'auto' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'workflow' || normalized === 'workflow_preferred') return 'workflow_preferred';
  if (normalized === 'direct') return 'direct';
  if (normalized === 'auto') return 'auto';
  return undefined;
}

function inferCreateProjectExecutionModeFromIntent(text: string): 'direct' | 'workflow_preferred' | undefined {
  if (/(direct|quick|快速编排|直接编排|快速执行|直接执行)/i.test(text)) return 'direct';
  if (/(workflow|dynamic workflow|动态工作流|工作流方式|工作流执行|用工作流|以工作流)/i.test(text)) {
    return 'workflow_preferred';
  }
  return undefined;
}

function buildCreateProjectClientRequestKey(input: {
  requestScope?: unknown;
  name: string;
  goal: string;
  requirements: string;
  members: string[];
  workFolder: string;
}): string | undefined {
  const requestScope = normalizeCreateProjectKeyPart(input.requestScope);
  if (!requestScope) return undefined;
  const payload = {
    requestScope,
    name: normalizeCreateProjectKeyPart(input.name),
    goal: normalizeCreateProjectKeyPart(input.goal),
    requirements: normalizeCreateProjectKeyPart(input.requirements),
    members: [...input.members].map(member => normalizeCreateProjectKeyPart(member)).sort(),
    workFolder: normalizeCreateProjectKeyPart(input.workFolder),
  };
  return `create-project:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function normalizeCreateProjectKeyPart(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function buildCreateProjectPlanningGuidanceForTool(input: { goal: string; requirements?: string }): string {
  const text = `${input.goal || ''}\n${input.requirements || ''}`;
  const explicitMarkdown = /(\.md\b|\.markdown\b|\bmarkdown\b)/i.test(text);
  const explicitPptx = /(\.pptx\b|\bpptx\b|\bpowerpoint\b|\bppt\s*(文件|file|deck)?\b)/i.test(text);
  const slide = /(幻灯片|演示文稿|slide deck|slides|presentation)/i.test(text);
  const report = /(报告|\breport\b)/i.test(text);
  const analysisReport = !report && isAnalysisReportLikeProject(text);
  if (slide && explicitPptx) {
    return [
      '输出意图：用户明确要求演示文稿/幻灯片交付 PPTX。',
      '不要改写用户目标或项目要求；计划中细化为最终任务生成 PPTX 文件。',
      '前序内容任务可以产出素材或草稿，但最终交付物必须符合用户明确格式。',
    ].join('\n');
  }
  if (slide && !explicitPptx) {
    return [
      '输出意图：用户要演示文稿/幻灯片。',
      '计划中必须安排最终任务使用 slide renderer 生成 HTML deck；不要默认改成 PPTX。',
      '前序内容任务可以产出素材或草稿，但最终交付物必须是 slide renderer HTML。',
    ].join('\n');
  }
  if (report && explicitMarkdown) {
    return [
      '输出意图：用户明确要求报告交付 Markdown。',
      '不要改写用户目标或项目要求；计划中细化为最终任务生成 Markdown 报告。',
      '前序研究/写作任务可以产出素材或草稿，但最终交付物必须符合用户明确格式。',
    ].join('\n');
  }
  if ((report || analysisReport) && !explicitMarkdown) {
    return [
      analysisReport
        ? '输出意图：用户要分析/研究类交付物，默认按报告交付；最终任务必须使用 report renderer 生成 HTML 报告。'
        : '输出意图：用户要报告，最终任务必须使用 report renderer 生成 HTML 报告。',
      '不要把用户目标改写为其他交付格式。',
      '前序研究/写作任务可以产出素材或中间 Markdown，但最终交付物必须是 report renderer HTML。',
    ].join('\n');
  }
  return '';
}

function isAnalysisReportLikeProject(text: string): boolean {
  const analysis = /(分析|研究|调研|评估|研判|洞察|复盘|\banalysis\b|\bresearch\b|\bassessment\b|\bbrief\b)/i.test(text);
  const deliverableCue = /(高层|管理层|决策|战略|研发|产品|竞品|市场|行业|趋势|动态|情况|内容|汇报|材料|交付|leadership|executive|strategy|market|industry|trend|product|competitive)/i.test(text);
  return analysis && deliverableCue;
}

export function createKSwarmContinueProjectTool(kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'continue_project',
      description: '诊断并安全推进一个已经卡住的 KSwarm 项目。仅在用户要求小K帮忙推进项目，或当前上下文明确包含卡住项目时调用。该工具不会跳过必需任务，也不会人工放行不合格结果。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID，例如 proj-1779090338840' },
          expectedPrimaryTaskId: { type: 'string', description: '当前卡住的主任务 ID，用于防止状态过期' },
          expectedTaskUpdatedAt: {
            oneOf: [{ type: 'number' }, { type: 'string' }],
            description: '卡住任务在诊断时的更新时间，用于防止状态过期',
          },
          idempotencyKey: { type: 'string', description: '本次继续推进操作的幂等键；同一次会话重试时保持一致' },
        },
        required: ['projectId'],
      },
    },
    async execute(input) {
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      if (!projectId) return JSON.stringify({ error: 'projectId is required' });

      const body: Record<string, unknown> = {
        idempotencyKey: typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
          ? input.idempotencyKey.trim()
          : `xiaok-chat-${projectId}-${Date.now()}`,
      };
      if (typeof input.expectedPrimaryTaskId === 'string' && input.expectedPrimaryTaskId.trim()) {
        body.expectedPrimaryTaskId = input.expectedPrimaryTaskId.trim();
      }
      if (input.expectedTaskUpdatedAt !== undefined && input.expectedTaskUpdatedAt !== null && input.expectedTaskUpdatedAt !== '') {
        body.expectedTaskUpdatedAt = input.expectedTaskUpdatedAt;
      }

      try {
        const res = await kswarmService.request(`/projects/${encodeURIComponent(projectId)}/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            status: res.status,
            error: payload.error || `continue_project_failed_${res.status}`,
            ...payload,
          });
        }
        return JSON.stringify(payload);
      } catch (err) {
        return JSON.stringify({ ok: false, error: `KSwarm service unavailable: ${(err as Error).message}` });
      }
    },
  };
}

const INSPECT_PROJECT_MAX_ARTIFACTS = 3;
const INSPECT_PROJECT_MAX_ARTIFACT_CHARS = 12000;
const INSPECT_PROJECT_READABLE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.html', '.htm']);

export function createKSwarmInspectProjectTool(kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'inspect_project',
      description: '检查 KSwarm 项目状态、卡住任务、项目干预信息和最新可读产物。当用户要求推进/诊断/修复 Swarm 项目，尤其只给项目名时，先调用此工具。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID，例如 proj-1779090338840' },
          projectName: { type: 'string', description: 'KSwarm 项目名称。没有 projectId 时用于匹配项目' },
          includeArtifacts: { type: 'boolean', description: '是否读取最新文本产物正文，默认 true' },
        },
      },
    },
    async execute(input) {
      const projectIdInput = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : '';
      const includeArtifacts = input.includeArtifacts !== false;

      if (!projectIdInput && !projectName) {
        return JSON.stringify({ ok: false, error: 'projectId_or_projectName_required' });
      }

      try {
        const resolved = projectIdInput
          ? { ok: true as const, projectId: projectIdInput, match: { mode: 'project_id' } }
          : await resolveKSwarmProjectByName(kswarmService, projectName);
        if (!resolved.ok) return JSON.stringify(resolved);

        const detailRes = await kswarmService.request(`/projects/${encodeURIComponent(resolved.projectId)}`);
        const detail = await detailRes.json().catch(() => ({})) as Record<string, unknown>;
        if (!detailRes.ok) {
          return JSON.stringify({
            ok: false,
            error: detail?.error || `project_detail_failed:${detailRes.status}`,
            status: detailRes.status,
            projectId: resolved.projectId,
          });
        }

        const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
        const readableArtifacts = includeArtifacts
          ? await readLatestProjectArtifacts(kswarmService, resolved.projectId, detail)
          : [];

        return JSON.stringify({
          ok: true,
          match: resolved.match,
          project: summarizeProject(detail.project),
          artifactWriteDir: inferArtifactWriteDir(detail),
          projectIntervention: detail.projectIntervention || null,
          projectHealth: detail.projectHealth || null,
          dispatchPlan: detail.dispatchPlan || null,
          planProgress: detail.planProgress || null,
          tasks: tasks.map(summarizeKSwarmTask),
          readableArtifacts,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: `KSwarm service unavailable: ${(err as Error).message}` });
      }
    },
  };
}

async function resolveKSwarmProjectByName(kswarmService: KSwarmService, projectName: string) {
  const projectsRes = await kswarmService.request('/projects');
  const payload = await projectsRes.json().catch(() => ({})) as { projects?: unknown[]; error?: string };
  if (!projectsRes.ok) {
    return { ok: false as const, error: payload.error || `projects_list_failed:${projectsRes.status}`, status: projectsRes.status };
  }

  const projects = Array.isArray(payload.projects) ? payload.projects.filter(isRecord) : [];
  const wanted = normalizeProjectName(projectName);
  const exact = projects.filter(project => normalizeProjectName(project.name) === wanted);
  const matches = exact.length > 0
    ? exact
    : projects.filter(project => normalizeProjectName(project.name).includes(wanted));
  const sortedMatches = matches.sort(compareProjectUpdatedDesc);

  if (sortedMatches.length === 0) {
    return { ok: false as const, error: 'project_not_found', projectName };
  }
  if (sortedMatches.length > 1) {
    return {
      ok: false as const,
      error: 'ambiguous_project',
      projectName,
      candidates: sortedMatches.map(summarizeProject),
    };
  }

  const selected = sortedMatches[0];
  return {
    ok: true as const,
    projectId: String(selected.id),
    match: { mode: exact.length > 0 ? 'name_exact' : 'name_contains', projectName },
  };
}

function inferArtifactWriteDir(detail: Record<string, unknown>) {
  const workspace = isRecord(detail.workspace) ? detail.workspace : null;
  const project = isRecord(detail.project) ? detail.project : null;
  const workFolder = stringOrUndefined(workspace?.path) || stringOrUndefined(project?.workFolder);
  if (!workFolder) return null;
  return {
    directory: `${workFolder.replace(/\/$/, '')}/artifacts`,
    relativePrefix: 'artifacts/',
    instruction: '把完整修复产物写入这个 artifacts 目录，然后调用 repair_project_task_from_file 提交 artifactPath；不要在 tool 参数里粘贴完整正文。',
  };
}

function normalizeProjectName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function compareProjectUpdatedDesc(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0);
}

function summarizeProject(project: unknown) {
  if (!isRecord(project)) return null;
  return {
    id: stringOrUndefined(project.id),
    name: stringOrUndefined(project.name),
    goal: stringOrUndefined(project.goal),
    status: stringOrUndefined(project.status),
    createdAt: numberOrUndefined(project.createdAt),
    updatedAt: numberOrUndefined(project.updatedAt),
    taskCount: numberOrUndefined(project.taskCount),
    doneCount: numberOrUndefined(project.doneCount),
    stoppedCount: numberOrUndefined(project.stoppedCount),
  };
}

function summarizeKSwarmTask(task: unknown) {
  if (!isRecord(task)) return task;
  const result = isRecord(task.result) ? task.result : null;
  const summary = typeof result?.summary === 'string' ? result.summary : '';
  return {
    id: stringOrUndefined(task.id),
    title: stringOrUndefined(task.title),
    status: stringOrUndefined(task.status),
    assignedAgent: stringOrUndefined(task.assignedAgent),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    updatedAt: numberOrUndefined(task.updatedAt),
    startedAt: numberOrUndefined(task.startedAt),
    completedAt: numberOrUndefined(task.completedAt),
    failedAt: numberOrUndefined(task.failedAt),
    attempt: numberOrUndefined(task.attempt),
    maxAttempts: numberOrUndefined(task.maxAttempts),
    qualityFailureCount: numberOrUndefined(task.qualityFailureCount),
    failureReason: stringOrUndefined(task.failureReason),
    blockedReason: stringOrUndefined(task.blockedReason),
    resultSummary: summary ? truncateText(summary, 800).text : undefined,
    artifactCount: collectTaskArtifacts(task).length,
  };
}

async function readLatestProjectArtifacts(kswarmService: KSwarmService, projectId: string, detail: Record<string, unknown>) {
  const artifacts = collectProjectArtifacts(detail)
    .filter(isReadableProjectArtifact)
    .sort(compareArtifactForInspection)
    .slice(0, INSPECT_PROJECT_MAX_ARTIFACTS);

  const results = [];
  for (const artifact of artifacts) {
    const url = typeof artifact.url === 'string' && artifact.url.startsWith(`/projects/${projectId}/artifacts/`)
      ? artifact.url
      : artifact.filename
        ? `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(String(artifact.filename))}`
        : '';
    const base = summarizeArtifact(artifact, url);
    if (!url) {
      results.push({ ...base, readError: 'artifact_url_missing' });
      continue;
    }

    try {
      const res = await kswarmService.request(url);
      const text = await res.text();
      if (!res.ok) {
        results.push({ ...base, readError: `artifact_read_failed:${res.status}` });
        continue;
      }
      const truncated = truncateText(text, INSPECT_PROJECT_MAX_ARTIFACT_CHARS);
      results.push({ ...base, content: truncated.text, truncated: truncated.truncated });
    } catch (err) {
      results.push({ ...base, readError: String((err as Error).message || err) });
    }
  }
  return results;
}

function collectProjectArtifacts(detail: Record<string, unknown>) {
  const collected: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (artifact: unknown, inspectionPriority = 0) => {
    if (!isRecord(artifact)) return;
    const key = String(artifact.url || artifact.path || artifact.filename || JSON.stringify(artifact));
    if (seen.has(key)) return;
    seen.add(key);
    collected.push({ ...artifact, __inspectionPriority: inspectionPriority });
  };

  const tasks = Array.isArray(detail.tasks) ? detail.tasks.filter(isRecord) : [];
  const interventionTaskIds = getInterventionArtifactTaskIds(detail, tasks);
  for (const task of tasks) {
    const taskId = String(task.id || '');
    if (!interventionTaskIds.has(taskId)) continue;
    for (const artifact of collectTaskArtifacts(task)) add(artifact, 1);
  }

  const workspace = isRecord(detail.workspace) ? detail.workspace : null;
  if (Array.isArray(workspace?.artifacts)) {
    for (const artifact of workspace.artifacts) add(artifact);
  }
  for (const task of tasks) {
    const taskId = String(task.id || '');
    if (interventionTaskIds.has(taskId)) continue;
    for (const artifact of collectTaskArtifacts(task)) add(artifact);
  }
  return collected;
}

function getInterventionArtifactTaskIds(detail: Record<string, unknown>, tasks: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  const intervention = isRecord(detail.projectIntervention) ? detail.projectIntervention : null;
  const primaryAction = isRecord(intervention?.primaryAction) ? intervention.primaryAction : null;
  const primaryTaskId = stringOrUndefined(intervention?.primaryTaskId) || stringOrUndefined(primaryAction?.taskId);
  if (!primaryTaskId) return ids;

  ids.add(primaryTaskId);
  const taskMap = new Map<string, Record<string, unknown>>();
  for (const task of tasks) {
    const taskId = String(task.id || '');
    if (taskId) taskMap.set(taskId, task);
  }
  const primaryTask = taskMap.get(primaryTaskId);
  const parentTaskId = stringOrUndefined(primaryTask?.parentTaskId);
  if (parentTaskId) ids.add(parentTaskId);

  for (const task of tasks) {
    const taskId = String(task.id || '');
    const taskParentId = stringOrUndefined(task.parentTaskId);
    if (taskParentId === primaryTaskId || (parentTaskId && taskParentId === parentTaskId)) ids.add(taskId);
  }
  return ids;
}

function collectTaskArtifacts(task: unknown): Record<string, unknown>[] {
  if (!isRecord(task)) return [];
  const result = isRecord(task.result) ? task.result : null;
  const fromResult = Array.isArray(result?.artifacts) ? result.artifacts.filter(isRecord) : [];
  const fromTask = Array.isArray(task.artifacts) ? task.artifacts.filter(isRecord) : [];
  return [...fromResult, ...fromTask];
}

function isReadableProjectArtifact(artifact: Record<string, unknown>): boolean {
  const filename = String(artifact.filename || artifact.path || artifact.url || '');
  const mimeType = String(artifact.mimeType || '').toLowerCase();
  const ext = extname(filename).toLowerCase();
  return (
    INSPECT_PROJECT_READABLE_EXTENSIONS.has(ext) ||
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/csv'
  );
}

function compareArtifactUpdatedDesc(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return Number(right.generatedAt || right.updatedAt || right.createdAt || 0) - Number(left.generatedAt || left.updatedAt || left.createdAt || 0);
}

function compareArtifactForInspection(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const priorityDiff = Number(right.__inspectionPriority || 0) - Number(left.__inspectionPriority || 0);
  if (priorityDiff !== 0) return priorityDiff;
  return compareArtifactUpdatedDesc(left, right);
}

function summarizeArtifact(artifact: Record<string, unknown>, url: string) {
  return {
    filename: stringOrUndefined(artifact.filename),
    url: url || stringOrUndefined(artifact.url),
    mimeType: stringOrUndefined(artifact.mimeType),
    size: numberOrUndefined(artifact.size),
    generatedAt: numberOrUndefined(artifact.generatedAt),
    updatedAt: numberOrUndefined(artifact.updatedAt),
  };
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`, truncated: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringOrUndefined(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function createKSwarmRepairProjectTaskFromFileTool(kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'repair_project_task_from_file',
      description: '修复 KSwarm 项目中卡住或失败的任务。必须先把完整产物写入项目 artifacts 文件，再用此工具提交文件路径回审核流；不要传完整正文。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID' },
          taskId: { type: 'string', description: '需要修复并提交的任务 ID，通常来自项目干预上下文' },
          expectedTaskUpdatedAt: {
            oneOf: [{ type: 'number' }, { type: 'string' }],
            description: '任务更新时间戳，用于防止覆盖已经变化的任务状态',
          },
          summary: { type: 'string', description: '本次修复提交的简要说明' },
          artifactPath: { type: 'string', description: '已经写入项目 artifacts 目录的产物路径，例如 artifacts/report.md 或 report.md' },
          mimeType: { type: 'string', description: '产物 MIME 类型，默认 text/markdown' },
          idempotencyKey: { type: 'string', description: '可选幂等键；重复调用同一请求时复用' },
        },
        required: ['projectId', 'taskId', 'artifactPath'],
      },
    },
    async execute(input) {
      const projectId = String(input.projectId || '').trim();
      const taskId = String(input.taskId || '').trim();
      const artifactPath = String(input.artifactPath || input.path || input.relativePath || '').trim();
      if (!projectId || !taskId || !artifactPath) {
        return JSON.stringify({ ok: false, error: 'projectId, taskId and artifactPath are required' });
      }

      const body = {
        idempotencyKey: String(input.idempotencyKey || `repair-${projectId}-${taskId}-${Date.now()}`).trim(),
        resolution: 'repair_and_submit',
        fromAgent: 'xiaok',
        expectedPrimaryTaskId: taskId,
        expectedTaskUpdatedAt: input.expectedTaskUpdatedAt ?? undefined,
        summary: typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : `Repaired submission for ${taskId}`,
        artifacts: [
          {
            path: artifactPath,
            mimeType: typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'text/markdown',
          },
        ],
      };

      try {
        const res = await kswarmService.request(`/projects/${encodeURIComponent(projectId)}/intervention/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            error: payload?.error || `repair_project_task_failed:${res.status}`,
            status: res.status,
            ...payload,
          });
        }
        return JSON.stringify(payload);
      } catch (err) {
        return JSON.stringify({ ok: false, error: `KSwarm service unavailable: ${(err as Error).message}` });
      }
    },
  };
}

export function createKSwarmRepairProjectTaskTool(_kswarmService: KSwarmService): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'repair_project_task',
      description: '旧兼容工具。不要用它传完整产物正文；请先用 Write 把产物写入 artifacts 文件，然后调用 repair_project_task_from_file。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'KSwarm 项目 ID' },
          taskId: { type: 'string', description: '需要修复并提交的任务 ID' },
          filename: { type: 'string', description: '旧参数，已禁用' },
          content: { type: 'string', description: '旧参数，已禁用；完整产物正文不能通过 tool 参数传递' },
          artifactPath: { type: 'string', description: '请改用 repair_project_task_from_file' },
        },
      },
    },
    async execute() {
      return JSON.stringify({
        ok: false,
        error: 'inline_content_forbidden',
        useTool: 'repair_project_task_from_file',
        message: '请先把完整修复产物写入项目 artifacts 文件，然后调用 repair_project_task_from_file，只传 artifactPath、summary 和 mimeType。',
      });
    },
  };
}
function createDesktopModelRunnerWithRegistry(
  registry: ToolRegistry,
  tools: Tool[],
  dataRoot: string,
  kswarmService: KSwarmService,
  materialRegistry: MaterialRegistry,
  createProjectToolOptions: KSwarmCreateProjectToolOptions = {},
): TaskRunner {
  const cwd = process.cwd();
  const pluginSkillRoots = getPluginSkillRoots();
  let skillCatalog = createSkillCatalog(undefined, cwd, { extraRoots: pluginSkillRoots });
  let skillsLoaded = false;

  // Register kswarm create_project tool (allows AI to create multi-agent projects from chat)
  registerKSwarmTools(registry, kswarmService, createProjectToolOptions);
  registry.registerTool(createReportArtifactTool());

  registry.registerTool(createReportProgressTool());

  // Register notebook (memory) tools — shared LayeredMemoryStore
  for (const tool of createNotebookTools(getDesktopMemoryStore(dataRoot))) {
    registry.registerTool(tool);
  }

  return async ({ taskId, sessionId, prompt, materials, signal, deadlineMs, history: hostHistory, emitRuntimeEvent, maxToolLoopIterations }) => {
    const turnId = `turn_${Date.now().toString(36)}`;
    const intentId = `intent_${Date.now().toString(36)}`;
    const stepId = `${intentId}:step:reply`;
    const taskStartTime = Date.now();
    let skillNamesDetected: string[] = [];
    let skillTriggerType: 'slash_command' | 'tool_call' | 'auto' = 'auto';
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

    const materialsContext = materials && materials.length > 0
      ? buildMaterialManifestForPrompt(materials)
      : '';

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

    const modelIdentity = `\n\n## 模型信息\n\n你当前运行的模型是: ${adapter.getModelName()}。不要假设自己是其他模型。`;
    const systemPrompt = skillsContext
      ? `${BASE_SYSTEM_PROMPT}${modelIdentity}\n\nAvailable skills:\n${skillsContext}`
      : `${BASE_SYSTEM_PROMPT}${modelIdentity}`;

    const userText = materialsContext
      ? `${effectivePrompt}${materialsContext}`
      : effectivePrompt;
    const allToolDefs = materials && materials.length > 0
      ? [...registry.getToolDefinitions(), READ_MATERIAL_TOOL_DEFINITION]
      : registry.getToolDefinitions();
    const imageBlocks = materials && materials.length > 0 ? buildImageBlocksForMaterials(materials) : [];
    const userContent: MessageBlock[] = [
      { type: 'text', text: userText },
      ...imageBlocks,
    ];
    const messages: Message[] = [
      ...hostHistory.map((h): Message => ({ role: h.role, content: [{ type: 'text', text: h.content }] })),
      {
      role: 'user',
      content: userContent,
    }];
    const TASK_TIMEOUT_MS = deadlineMs ?? 28 * 60_000;

    const loopResult = await runDesktopToolLoop({
      adapter,
      systemPrompt,
      messages,
      allToolDefs,
      registry,
      signal,
      taskDeadline: Date.now() + TASK_TIMEOUT_MS,
      sessionId,
      turnId,
      intentId,
      stepId,
      taskId,
      materials,
      materialRegistry,
      emitRuntimeEvent,
      skillInvocation,
      skillCatalog,
      dataRoot,
      taskStartTime,
      maxIterations: maxToolLoopIterations,
      strategies: {
        compact: {
          enabled: false,
          shouldCompact: () => false,
          doCompact: async () => {},
        },
        buildApiView: (msgs) => msgs,
        processToolResult: (result) => result.slice(0, 50000),
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    });

    const { reply, totalToolCalls, totalInputTokens, totalOutputTokens, referenceReads } = loopResult;
    skillNamesDetected = loopResult.skillNamesDetected.length > 0 ? loopResult.skillNamesDetected : skillNamesDetected;
    skillTriggerType = loopResult.skillTriggerType !== 'auto' ? loopResult.skillTriggerType : skillTriggerType;
    skillInvocation = loopResult.skillInvocation ?? skillInvocation;

    emitRuntimeEvent({ type: 'receipt_emitted', sessionId, turnId, intentId, stepId, note: reply.trim() || '模型没有返回内容。' });
    if (skillNamesDetected.length > 0) {
      try {
        await appendExecRecord(dataRoot, {
          id: `exec_${taskStartTime.toString(36)}`,
          skillNames: skillNamesDetected,
          taskId: sessionId,
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

function registerKSwarmTools(
  registry: ToolRegistry,
  kswarmService: KSwarmService,
  createProjectToolOptions: KSwarmCreateProjectToolOptions = {},
): void {
  registry.registerTool(createKSwarmCreateProjectTool(kswarmService, createProjectToolOptions));
  registry.registerTool(createKSwarmInspectProjectTool(kswarmService));
  registry.registerTool(createKSwarmContinueProjectTool(kswarmService));
  registry.registerTool(createKSwarmRunDynamicWorkflowScriptTool(kswarmService));
  registry.registerTool(createKSwarmGetDynamicWorkflowStatusTool(kswarmService));
  registry.registerTool(createKSwarmRepairProjectTaskFromFileTool(kswarmService));
  registry.registerTool(createKSwarmRepairProjectTaskTool(kswarmService));
}
