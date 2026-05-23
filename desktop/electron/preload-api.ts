import type { IpcRenderer } from 'electron';
import type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
} from '../../src/runtime/task-host/types.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';
import type {
  ConnectorsConfig,
  ProviderRuntime,
  SearchProviderName,
  FetchProviderName,
} from '../../src/ai/tools/connectors/config.js';

// Re-export types for renderer usage
export type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  ProtocolId,
  ConnectorsConfig,
  ProviderRuntime,
  SearchProviderName,
  FetchProviderName,
};

export const PRELOAD_API_KEYS = [
  'getModelConfig',
  'saveModelConfig',
  'createManagedXiaokAgent',
  'testProviderConnection',
  'listAvailableModelsForProvider',
  'deleteProvider',
  'deleteModel',
  'readClipboardFilePaths',
  'selectDirectory',
  'selectMaterials',
  'importMaterial',
  'createTask',
  'createTaskWithFiles',
  'subscribeTask',
  'answerQuestion',
  'cancelTask',
  'getActiveTask',
  'recoverTask',
  'openArtifact',
  'readFileContent',
  'listSkills',
  'installSkill',
  'uninstallSkill',
  'listChannels',
  'testChannel',
  'createChannel',
  'updateChannel',
  'deleteChannel',
  'listMCPInstalls',
  'createMCPInstall',
  'updateMCPInstall',
  'deleteMCPInstall',
  'listPluginMcpServers',
  'setPluginMcpServerEnabled',
  'installPlugin',
  'listAvailablePlugins',
  'getUpdateStatus',
  'checkForUpdates',
  'quitAndInstall',
  'onUpdateStatus',
  'createReminder',
  'listReminders',
  'cancelReminder',
  'getReminderStatus',
  'onReminder',
  'getSkillDebugConfig',
  'saveSkillDebugConfig',
  'getSkillStats',
  'kswarmGetStatus',
  'kswarmStart',
  'kswarmStop',
  'kswarmRestart',
  'onKSwarmStatus',
  'exportTraceBundle',
  'diagnose',
  'syncScheduledTasks',
  'getScheduledTasks',
  'createScheduledTask',
  'updateScheduledTask',
  'cancelScheduledTask',
  'getTimedActions',
  'getTimedActionRuns',
  'onScheduledTaskDue',
  'listMemories',
  'createMemory',
  'updateMemory',
  'deleteMemory',
  'importMemories',
  'memoryStats',
  'memoryCompact',
  'memoryPersonaTraits',
  'memoryListLayer',
  'memoryDeleteEntry',
  'memoryClearAll',
  'memoryGetModelId',
  'memorySetModelId',
  'getConnectorsConfig',
  'saveConnectorsConfig',
  'listConnectorRuntimes',
  'testConnectorProvider',
] as const;

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

export interface AvailableModelView {
  modelId: string;
  model: string;
  label: string;
  capabilities?: string[];
}

export interface TestProviderConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export type DesktopChannelType = 'yunzhijia' | 'discord' | 'feishu' | 'qq' | 'qqbot' | 'weixin' | 'telegram';

export interface DesktopChannelView {
  id: string;
  type: DesktopChannelType;
  name: string;
  webhookUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopChannelInput {
  type: DesktopChannelType;
  name: string;
  webhookUrl?: string;
}

export interface DesktopMCPInstallView {
  id: string;
  name: string;
  source: 'npm' | 'github' | 'local';
  command: string;
  args?: string[];
  enabled: boolean;
  createdAt: number;
}

export interface DesktopMCPInput {
  name: string;
  source: 'npm' | 'github' | 'local';
  command: string;
  args?: string[];
}

export interface PluginMcpServerView {
  name: string;
  pluginName: string;
  toolCount: number;
  connected: boolean;
  enabled: boolean;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  version?: string;
  error?: string;
}

export interface ReminderRecord {
  reminderId: string;
  content: string;
  scheduleAt: number;
  timezone: string;
  status: 'pending' | 'delivering' | 'sent' | 'failed' | 'cancelled';
  retryCount: number;
  maxRetry: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
}

export interface KSwarmServiceStatus {
  running: boolean;
  port: number;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
}

export type ConnectorsLoadStatus = 'ok' | 'missing' | 'parse_failed';

export interface ConnectorsConfigSnapshot {
  config: ConnectorsConfig;
  loadStatus: ConnectorsLoadStatus;
  providers: ProviderRuntime[];
}

export type DesktopTraceTarget = { kind: 'session' | 'project' | 'task'; id: string };

export interface DesktopApi {
  getModelConfig(): Promise<DesktopModelConfigSnapshot>;
  saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot>;
  createManagedXiaokAgent(input: {
    name: string;
    description?: string;
    roles?: string[];
    capabilities?: string[];
    instructions?: string;
    maxConcurrentTasks?: number;
  }): Promise<unknown>;
  testProviderConnection(input: { providerId: string; modelId?: string }): Promise<TestProviderConnectionResult>;
  listAvailableModelsForProvider(providerId: string): Promise<AvailableModelView[]>;
  deleteProvider(providerId: string): Promise<void>;
  deleteModel(modelId: string): Promise<void>;
  readClipboardFilePaths(): Promise<string[]>;
  selectDirectory(): Promise<{ filePath: string }>;
  selectMaterials(): Promise<{ filePaths: string[] }>;
  importMaterial(input: { taskId: string; filePath: string; role: MaterialRole }): Promise<MaterialView>;
  createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
  }): Promise<{ taskId: string; understanding: TaskUnderstanding }>;
  createTaskWithFiles(input: {
    prompt: string;
    filePaths: string[];
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  subscribeTask(taskId: string, handler: (event: DesktopTaskEvent) => void): () => void;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getActiveTask(): Promise<{ taskId: string } | null>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
  openArtifact(artifactId: string): Promise<void>;
  readFileContent(filePath: string): Promise<{ content: string; error?: string }>;
  listSkills(): Promise<Array<{ name: string; aliases: string[]; description: string; source: string; tier: string }>>;
  installSkill(skillName: string): Promise<{ success: boolean; message: string }>;
  uninstallSkill(skillName: string): Promise<{ success: boolean; message: string }>;
  listChannels(): Promise<DesktopChannelView[]>;
  testChannel(channelId: string): Promise<{ success: boolean; latencyMs?: number; error?: string }>;
  createChannel(input: DesktopChannelInput): Promise<DesktopChannelView>;
  updateChannel(id: string, input: Partial<DesktopChannelInput>): Promise<DesktopChannelView>;
  deleteChannel(id: string): Promise<void>;
  listMCPInstalls(): Promise<DesktopMCPInstallView[]>;
  createMCPInstall(input: DesktopMCPInput): Promise<DesktopMCPInstallView>;
  updateMCPInstall(id: string, input: Partial<DesktopMCPInput>): Promise<DesktopMCPInstallView>;
  deleteMCPInstall(id: string): Promise<void>;
  listPluginMcpServers(): Promise<PluginMcpServerView[]>;
  setPluginMcpServerEnabled(input: { name: string; enabled: boolean }): Promise<PluginMcpServerView[]>;
  installPlugin(name: string): Promise<{ success: boolean; error?: string }>;
  listAvailablePlugins(): Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): Promise<void>;
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  createReminder(input: { content: string; scheduleAt: number; timezone?: string }): Promise<ReminderRecord>;
  listReminders(): Promise<ReminderRecord[]>;
  cancelReminder(id: string): Promise<boolean>;
  getReminderStatus(): Promise<{
    pendingCount: number;
    activeReminders: ReminderRecord[];
    desktopNotification?: { ok: boolean; skipped?: boolean; reason?: string; at: number } | null;
  }>;
  onReminder(handler: (event: { reminderId: string; content: string; createdAt: number }) => void): () => void;
  getSkillDebugConfig(): Promise<{ enabled: boolean }>;
  saveSkillDebugConfig(input: { enabled: boolean }): Promise<{ enabled: boolean }>;
  getSkillStats(): Promise<Array<{
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
  }>>;
  kswarmGetStatus(): Promise<KSwarmServiceStatus>;
  kswarmStart(): Promise<void>;
  kswarmStop(): Promise<void>;
  kswarmRestart(): Promise<void>;
  onKSwarmStatus(handler: (status: KSwarmServiceStatus) => void): () => void;
  exportTraceBundle(input: DesktopTraceTarget): Promise<{ ok: boolean; path?: string; error?: string }>;
  diagnose(input: DesktopTraceTarget): Promise<unknown>;
  syncScheduledTasks(tasks: Array<{ id: string; cronExpr: string; enabled: boolean }>): Promise<void>;
  getScheduledTasks(): Promise<unknown[]>;
  createScheduledTask(input: unknown): Promise<unknown>;
  updateScheduledTask(input: unknown): Promise<unknown>;
  cancelScheduledTask(id: string): Promise<boolean>;
  getTimedActions(): Promise<unknown[]>;
  getTimedActionRuns(actionId: string): Promise<unknown[]>;
  onScheduledTaskDue(handler: (event: { taskId: string }) => void): () => void;
  listMemories(): Promise<unknown[]>;
  createMemory(input: { content: string; tags: string[]; source?: string }): Promise<unknown>;
  updateMemory(input: { id: string; content?: string; tags?: string[] }): Promise<unknown>;
  deleteMemory(id: string): Promise<void>;
  importMemories(raw: string): Promise<unknown>;
  memoryStats(): Promise<{ l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number } | null>;
  memoryCompact(): Promise<boolean>;
  memoryPersonaTraits(): Promise<{ trait: string; confidence: number }[]>;
  memoryListLayer(layer: number, limit?: number, offset?: number): Promise<{ id: string; content: string; tags?: string[]; createdAt: string; meta?: Record<string, unknown> }[]>;
  memoryDeleteEntry(id: string, layer: number): Promise<boolean>;
  memoryClearAll(): Promise<boolean>;
  memoryGetModelId(): Promise<string | null>;
  memorySetModelId(modelId: string | null): Promise<boolean>;
  getConnectorsConfig(): Promise<ConnectorsConfigSnapshot | null>;
  saveConnectorsConfig(input: ConnectorsConfig): Promise<ConnectorsConfigSnapshot>;
  listConnectorRuntimes(): Promise<ProviderRuntime[]>;
  testConnectorProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult>;
}

export interface ConnectorTestResult {
  success: boolean;
  latencyMs: number;
  providerName: string;
  detail?: string;
  error?: string;
}

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createPreloadApi(ipcRenderer: IpcRendererLike): DesktopApi {
  return {
    getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig') as ReturnType<DesktopApi['getModelConfig']>,
    saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input) as ReturnType<DesktopApi['saveModelConfig']>,
    createManagedXiaokAgent: (input) => ipcRenderer.invoke('desktop:createManagedXiaokAgent', input) as ReturnType<DesktopApi['createManagedXiaokAgent']>,
    testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input) as ReturnType<DesktopApi['testProviderConnection']>,
    listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId) as ReturnType<DesktopApi['listAvailableModelsForProvider']>,
    deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId) as Promise<void>,
    deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId) as Promise<void>,
    readClipboardFilePaths: () => ipcRenderer.invoke('desktop:readClipboardFilePaths') as Promise<string[]>,
    selectDirectory: () => ipcRenderer.invoke('desktop:selectDirectory') as Promise<{ filePath: string }>,
    selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials') as ReturnType<DesktopApi['selectMaterials']>,
    importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input) as ReturnType<DesktopApi['importMaterial']>,
    createTask: (input) => ipcRenderer.invoke('desktop:createTask', input) as ReturnType<DesktopApi['createTask']>,
    createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input) as ReturnType<DesktopApi['createTaskWithFiles']>,
    subscribeTask(taskId, handler) {
      const channel = `desktop:taskEvent:${taskId}`;
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as DesktopTaskEvent);
      };
      ipcRenderer.on(channel, listener);
      void ipcRenderer.invoke('desktop:subscribeTask', { taskId });
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    answerQuestion: (input) => ipcRenderer.invoke('desktop:answerQuestion', input) as Promise<void>,
    cancelTask: (taskId) => ipcRenderer.invoke('desktop:cancelTask', { taskId }) as Promise<void>,
    getActiveTask: () => ipcRenderer.invoke('desktop:getActiveTask') as ReturnType<DesktopApi['getActiveTask']>,
    recoverTask: (taskId) => ipcRenderer.invoke('desktop:recoverTask', { taskId }) as ReturnType<DesktopApi['recoverTask']>,
    openArtifact: (artifactId) => ipcRenderer.invoke('desktop:openArtifact', { artifactId }) as Promise<void>,
    readFileContent: (filePath) => ipcRenderer.invoke('desktop:readFileContent', { filePath }) as Promise<{ content: string; error?: string }>,
    listSkills: () => ipcRenderer.invoke('desktop:listSkills') as ReturnType<DesktopApi['listSkills']>,
    installSkill: (skillName) => ipcRenderer.invoke('desktop:installSkill', skillName) as Promise<{ success: boolean; message: string }>,
    uninstallSkill: (skillName) => ipcRenderer.invoke('desktop:uninstallSkill', skillName) as Promise<{ success: boolean; message: string }>,
    listChannels: () => ipcRenderer.invoke('desktop:listChannels') as Promise<DesktopChannelView[]>,
    testChannel: (channelId) => ipcRenderer.invoke('desktop:testChannel', channelId) as Promise<{ success: boolean; latencyMs?: number; error?: string }>,
    createChannel: (input) => ipcRenderer.invoke('desktop:createChannel', input) as Promise<DesktopChannelView>,
    updateChannel: (id, input) => ipcRenderer.invoke('desktop:updateChannel', id, input) as Promise<DesktopChannelView>,
    deleteChannel: (id) => ipcRenderer.invoke('desktop:deleteChannel', id) as Promise<void>,
    listMCPInstalls: () => ipcRenderer.invoke('desktop:listMCPInstalls') as Promise<DesktopMCPInstallView[]>,
    createMCPInstall: (input) => ipcRenderer.invoke('desktop:createMCPInstall', input) as Promise<DesktopMCPInstallView>,
    updateMCPInstall: (id, input) => ipcRenderer.invoke('desktop:updateMCPInstall', id, input) as Promise<DesktopMCPInstallView>,
    deleteMCPInstall: (id) => ipcRenderer.invoke('desktop:deleteMCPInstall', id) as Promise<void>,
    listPluginMcpServers: () => ipcRenderer.invoke('desktop:listPluginMcpServers') as Promise<PluginMcpServerView[]>,
    setPluginMcpServerEnabled: (input) => ipcRenderer.invoke('desktop:setPluginMcpServerEnabled', input) as Promise<PluginMcpServerView[]>,
    installPlugin: (name) => ipcRenderer.invoke('desktop:installPlugin', name) as Promise<{ success: boolean; error?: string }>,
    listAvailablePlugins: () => ipcRenderer.invoke('desktop:listAvailablePlugins') as Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>>,
    getUpdateStatus: () => ipcRenderer.invoke('desktop:getUpdateStatus') as Promise<UpdateStatus>,
    checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates') as Promise<void>,
    quitAndInstall: () => ipcRenderer.invoke('desktop:quitAndInstall') as Promise<void>,
    onUpdateStatus(handler) {
      const channel = 'desktop:updateStatus';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as UpdateStatus);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    createReminder: (input) => ipcRenderer.invoke('desktop:createReminder', input) as Promise<ReminderRecord>,
    listReminders: () => ipcRenderer.invoke('desktop:listReminders') as Promise<ReminderRecord[]>,
    cancelReminder: (id) => ipcRenderer.invoke('desktop:cancelReminder', id) as Promise<boolean>,
    getReminderStatus: () => ipcRenderer.invoke('desktop:getReminderStatus') as Promise<{ pendingCount: number; activeReminders: ReminderRecord[] }>,
    onReminder(handler) {
      const channel = 'desktop:reminder';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as { reminderId: string; content: string; createdAt: number });
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    getSkillDebugConfig: () => ipcRenderer.invoke('desktop:getSkillDebugConfig') as Promise<{ enabled: boolean }>,
    saveSkillDebugConfig: (input) => ipcRenderer.invoke('desktop:saveSkillDebugConfig', input) as Promise<{ enabled: boolean }>,
    getSkillStats: () => ipcRenderer.invoke('desktop:getSkillStats') as ReturnType<DesktopApi['getSkillStats']>,
    kswarmGetStatus: () => ipcRenderer.invoke('desktop:kswarm:getStatus') as Promise<KSwarmServiceStatus>,
    kswarmStart: () => ipcRenderer.invoke('desktop:kswarm:start') as Promise<void>,
    kswarmStop: () => ipcRenderer.invoke('desktop:kswarm:stop') as Promise<void>,
    kswarmRestart: () => ipcRenderer.invoke('desktop:kswarm:restart') as Promise<void>,
    onKSwarmStatus(handler) {
      const channel = 'desktop:kswarm:statusChange';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as KSwarmServiceStatus);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    exportTraceBundle: (input) => ipcRenderer.invoke('desktop:trace:export', input) as Promise<{ ok: boolean; path?: string; error?: string }>,
    diagnose: (input) => ipcRenderer.invoke('desktop:diagnose', input) as Promise<unknown>,
    syncScheduledTasks: (tasks) => ipcRenderer.invoke('desktop:syncScheduledTasks', tasks) as Promise<void>,
    getScheduledTasks: () => ipcRenderer.invoke('desktop:getScheduledTasks') as Promise<unknown[]>,
    createScheduledTask: (input) => ipcRenderer.invoke('desktop:createScheduledTask', input) as Promise<unknown>,
    updateScheduledTask: (input) => ipcRenderer.invoke('desktop:updateScheduledTask', input) as Promise<unknown>,
    cancelScheduledTask: (id) => ipcRenderer.invoke('desktop:cancelScheduledTask', id) as Promise<boolean>,
    getTimedActions: () => ipcRenderer.invoke('desktop:getTimedActions') as Promise<unknown[]>,
    getTimedActionRuns: (actionId) => ipcRenderer.invoke('desktop:getTimedActionRuns', actionId) as Promise<unknown[]>,
    onScheduledTaskDue(handler) {
      const channel = 'desktop:scheduledTaskDue';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as { taskId: string });
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    listMemories: () => ipcRenderer.invoke('desktop:listMemories') as Promise<unknown[]>,
    createMemory: (input) => ipcRenderer.invoke('desktop:createMemory', input) as Promise<unknown>,
    updateMemory: (input) => ipcRenderer.invoke('desktop:updateMemory', input) as Promise<unknown>,
    deleteMemory: (id) => ipcRenderer.invoke('desktop:deleteMemory', id) as Promise<void>,
    importMemories: (items) => ipcRenderer.invoke('desktop:importMemories', items) as Promise<unknown>,
    memoryStats: () => ipcRenderer.invoke('desktop:memoryStats') as Promise<{ l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number } | null>,
    memoryCompact: () => ipcRenderer.invoke('desktop:memoryCompact') as Promise<boolean>,
    memoryPersonaTraits: () => ipcRenderer.invoke('desktop:memoryPersonaTraits') as Promise<{ trait: string; confidence: number }[]>,
    memoryListLayer: (layer: number, limit?: number, offset?: number) => ipcRenderer.invoke('desktop:memoryListLayer', layer, limit, offset) as Promise<{ id: string; content: string; tags?: string[]; createdAt: string; meta?: Record<string, unknown> }[]>,
    memoryDeleteEntry: (id: string, layer: number) => ipcRenderer.invoke('desktop:memoryDeleteEntry', id, layer) as Promise<boolean>,
    memoryClearAll: () => ipcRenderer.invoke('desktop:memoryClearAll') as Promise<boolean>,
    memoryGetModelId: () => ipcRenderer.invoke('desktop:memoryGetModelId') as Promise<string | null>,
    memorySetModelId: (modelId: string | null) => ipcRenderer.invoke('desktop:memorySetModelId', modelId) as Promise<boolean>,
    getConnectorsConfig: () => ipcRenderer.invoke('desktop:getConnectorsConfig') as Promise<ConnectorsConfigSnapshot | null>,
    saveConnectorsConfig: (input) => ipcRenderer.invoke('desktop:saveConnectorsConfig', input) as Promise<ConnectorsConfigSnapshot>,
    listConnectorRuntimes: () => ipcRenderer.invoke('desktop:listConnectorRuntimes') as Promise<ProviderRuntime[]>,
    testConnectorProvider: (kind) => ipcRenderer.invoke('desktop:testConnectorProvider', kind) as Promise<ConnectorTestResult>,
  };
}

export type { IpcRenderer };
