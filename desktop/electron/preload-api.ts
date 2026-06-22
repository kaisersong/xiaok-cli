import type { IpcRenderer } from 'electron';
import type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskCreateContext,
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
  TaskCreateContext,
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
  'readClipboardImage',
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
  'openFileInSystemApp',
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
  'restartPluginMcpServers',
  'restartPluginMcpServer',
  'getComputerUseCapabilityStatus',
  'enableComputerUse',
  'reconnectComputerUse',
  'disableComputerUse',
  'openPluginDependencyPermissionSettings',
  'installPlugin',
  'listAvailablePlugins',
  'listPluginDependencyStatuses',
  'installPluginDependency',
  'updatePluginDependency',
  'diagnosePluginDependency',
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
  'getKswarmConfig',
  'saveKswarmConfig',
  'getSkillStats',
  'getServiceStatus',
  'restartRelatedService',
  'kswarmGetStatus',
  'kswarmStart',
  'kswarmStop',
  'kswarmRestart',
  'kswarmResumeWorkflowRun',
  'kswarmStartProjectPlanning',
  'onKSwarmStatus',
  'exportTraceBundle',
  'diagnose',
  'getLoopDefinitions',
  'listUserLoopTemplates',
  'createUserLoopTemplate',
  'updateUserLoopTemplate',
  'deleteUserLoopTemplate',
  'clearLoopRunHistory',
  'createLoopSchedule',
  'getLoopScheduleBindings',
  'getAutomationOverviewSnapshot',
  'getAutomationRunHistory',
  'getAutomationsConfig',
  'setGlobalBackgroundAutoRun',
  'openLoopOutputDirectory',
  'readLoopOutputPreview',
  'getLoopRuns',
  'getEvidenceAnomalies',
  'runLoopNow',
  'syncScheduledTasks',
  'getScheduledTasks',
  'createScheduledTask',
  'updateScheduledTask',
  'setScheduledTaskStatus',
  'cancelScheduledTask',
  'getTimedActions',
  'getTimedActionRuns',
  'approveTimedActionAuto',
  'revokeTimedActionAuto',
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
  'getEmbeddingModels',
  'downloadEmbeddingModel',
  'setEmbeddingModel',
  'getConnectorsConfig',
  'saveConnectorsConfig',
  'listConnectorRuntimes',
  'testConnectorProvider',
  'kbListCollections',
  'kbCreateCollection',
  'kbDeleteCollection',
  'kbListSources',
  'kbAddSource',
  'kbDeleteSource',
  'kbGetCollectionState',
  'kbSearch',
  'kbPickFiles',
] as const;

export const KSWARM_PROXY_KEYS = [
  'kswarmProxyGet',
  'kswarmProxyGetText',
  'kswarmProxyPost',
  'kswarmProxyPostJson',
  'kswarmProxyPut',
  'kswarmProxyPatch',
  'kswarmProxyDelete',
  'kswarmStreamSubscribe',
  'kswarmStreamUnsubscribe',
  'kswarmStreamGetStatus',
  'onKSwarmWsEvent',
  'onKSwarmConnectionStatus',
  'connectionHealthz',
  'connectionHealth',
] as const;

export const EXTRA_KEYS = [
  'showSaveDialog',
  'saveFile',
  'listPrinciples',
  'savePrinciple',
  'deletePrinciple',
  'systemUsername',
] as const;

export const THREAD_META_KEYS = [
  'getThreadLabels',
  'setThreadLabel',
  'unsetThreadLabel',
  'moveThreadLabel',
  'getAppFlag',
  'setAppFlag',
  'migrateLegacyThreadMeta',
] as const;

export const FULL_PRELOAD_KEYS: readonly string[] = [
  ...PRELOAD_API_KEYS,
  ...KSWARM_PROXY_KEYS,
  ...EXTRA_KEYS,
  ...THREAD_META_KEYS,
];

// P2: Explicit classification of preload keys.
//
// `EVENT_SUBSCRIPTION_KEYS` are renderer-side handlers that wire `ipcRenderer.on`
// listeners. They do NOT correspond to a single `ipcMain.handle()` channel
// (events are pushed via `webContents.send`). `subscribeTask` is a hybrid:
// it both subscribes to push events AND triggers an invoke handler
// `desktop:subscribeTask` to register the subscription on main side; we still
// classify it as event subscription because its primary surface is a stream.
export const EVENT_SUBSCRIPTION_KEYS = [
  'subscribeTask',
  'onUpdateStatus',
  'onReminder',
  'onScheduledTaskDue',
  'onKSwarmStatus',
  'onKSwarmWsEvent',
  'onKSwarmConnectionStatus',
] as const;

// `LOCAL_CONSTANT_KEYS` are exposed as plain values from preload, never going
// through IPC at runtime. Currently only `systemUsername`, captured at preload
// boot time.
export const LOCAL_CONSTANT_KEYS = [
  'systemUsername',
] as const;

// `INVOKE_API_KEYS` are the strict subset of preload keys that map 1:1 to a
// `ipcMain.handle()` channel and use `ipcRenderer.invoke()` from renderer.
// Computed at module load by removing event/local categories from the full
// surface so it remains in sync with the canonical lists above.
export const INVOKE_API_KEYS: readonly string[] = FULL_PRELOAD_KEYS.filter(
  (key) => !EVENT_SUBSCRIPTION_KEYS.includes(key as typeof EVENT_SUBSCRIPTION_KEYS[number])
    && !LOCAL_CONSTANT_KEYS.includes(key as typeof LOCAL_CONSTANT_KEYS[number]),
);

// Explicit mapping from preload API key to its `ipcMain.handle()` channel
// name. Tests cross-check this against the live preload implementation and the
// main-process handler registry to catch drift.
export const INVOKE_CHANNEL_BY_KEY: Readonly<Record<string, string>> = {
  getModelConfig: 'desktop:getModelConfig',
  saveModelConfig: 'desktop:saveModelConfig',
  createManagedXiaokAgent: 'desktop:createManagedXiaokAgent',
  testProviderConnection: 'desktop:testProviderConnection',
  listAvailableModelsForProvider: 'desktop:listAvailableModelsForProvider',
  deleteProvider: 'desktop:deleteProvider',
  deleteModel: 'desktop:deleteModel',
  readClipboardFilePaths: 'desktop:readClipboardFilePaths',
  readClipboardImage: 'desktop:readClipboardImage',
  selectDirectory: 'desktop:selectDirectory',
  selectMaterials: 'desktop:selectMaterials',
  importMaterial: 'desktop:importMaterial',
  createTask: 'desktop:createTask',
  createTaskWithFiles: 'desktop:createTaskWithFiles',
  answerQuestion: 'desktop:answerQuestion',
  cancelTask: 'desktop:cancelTask',
  getActiveTask: 'desktop:getActiveTask',
  recoverTask: 'desktop:recoverTask',
  openArtifact: 'desktop:openArtifact',
  openFileInSystemApp: 'desktop:openFileInSystemApp',
  readFileContent: 'desktop:readFileContent',
  listSkills: 'desktop:listSkills',
  installSkill: 'desktop:installSkill',
  uninstallSkill: 'desktop:uninstallSkill',
  listChannels: 'desktop:listChannels',
  testChannel: 'desktop:testChannel',
  createChannel: 'desktop:createChannel',
  updateChannel: 'desktop:updateChannel',
  deleteChannel: 'desktop:deleteChannel',
  listMCPInstalls: 'desktop:listMCPInstalls',
  createMCPInstall: 'desktop:createMCPInstall',
  updateMCPInstall: 'desktop:updateMCPInstall',
  deleteMCPInstall: 'desktop:deleteMCPInstall',
  listPluginMcpServers: 'desktop:listPluginMcpServers',
  setPluginMcpServerEnabled: 'desktop:setPluginMcpServerEnabled',
  restartPluginMcpServers: 'desktop:restartPluginMcpServers',
  restartPluginMcpServer: 'desktop:restartPluginMcpServer',
  getComputerUseCapabilityStatus: 'desktop:getComputerUseCapabilityStatus',
  enableComputerUse: 'desktop:enableComputerUse',
  reconnectComputerUse: 'desktop:reconnectComputerUse',
  disableComputerUse: 'desktop:disableComputerUse',
  openPluginDependencyPermissionSettings: 'desktop:openPluginDependencyPermissionSettings',
  installPlugin: 'desktop:installPlugin',
  listAvailablePlugins: 'desktop:listAvailablePlugins',
  listPluginDependencyStatuses: 'desktop:listPluginDependencyStatuses',
  installPluginDependency: 'desktop:installPluginDependency',
  updatePluginDependency: 'desktop:updatePluginDependency',
  diagnosePluginDependency: 'desktop:diagnosePluginDependency',
  getUpdateStatus: 'desktop:getUpdateStatus',
  checkForUpdates: 'desktop:checkForUpdates',
  quitAndInstall: 'desktop:quitAndInstall',
  createReminder: 'desktop:createReminder',
  listReminders: 'desktop:listReminders',
  cancelReminder: 'desktop:cancelReminder',
  getReminderStatus: 'desktop:getReminderStatus',
  getSkillDebugConfig: 'desktop:getSkillDebugConfig',
  saveSkillDebugConfig: 'desktop:saveSkillDebugConfig',
  getKswarmConfig: 'desktop:getKswarmConfig',
  saveKswarmConfig: 'desktop:saveKswarmConfig',
  getSkillStats: 'desktop:getSkillStats',
  getServiceStatus: 'desktop:services:getStatus',
  restartRelatedService: 'desktop:services:restart',
  kswarmGetStatus: 'desktop:kswarm:getStatus',
  kswarmStart: 'desktop:kswarm:start',
  kswarmStop: 'desktop:kswarm:stop',
  kswarmRestart: 'desktop:kswarm:restart',
  kswarmResumeWorkflowRun: 'desktop:kswarm:resumeWorkflowRun',
  kswarmStartProjectPlanning: 'desktop:kswarm:startProjectPlanning',
  exportTraceBundle: 'desktop:trace:export',
  diagnose: 'desktop:diagnose',
  getLoopDefinitions: 'desktop:loops:listDefinitions',
  listUserLoopTemplates: 'desktop:loops:listUserTemplates',
  createUserLoopTemplate: 'desktop:loops:createUserTemplate',
  updateUserLoopTemplate: 'desktop:loops:updateUserTemplate',
  deleteUserLoopTemplate: 'desktop:loops:deleteUserTemplate',
  clearLoopRunHistory: 'desktop:loops:clearRunHistory',
  createLoopSchedule: 'desktop:loops:createSchedule',
  getLoopScheduleBindings: 'desktop:loops:getScheduleBindings',
  getAutomationOverviewSnapshot: 'desktop:automations:getOverviewSnapshot',
  getAutomationRunHistory: 'desktop:automations:getRunHistory',
  getAutomationsConfig: 'desktop:automations:getConfig',
  setGlobalBackgroundAutoRun: 'desktop:automations:setGlobalBackgroundAutoRun',
  openLoopOutputDirectory: 'desktop:loops:openOutputDirectory',
  readLoopOutputPreview: 'desktop:loops:readOutputPreview',
  getLoopRuns: 'desktop:loops:listRuns',
  getEvidenceAnomalies: 'desktop:loops:listAnomalies',
  runLoopNow: 'desktop:loops:runNow',
  syncScheduledTasks: 'desktop:syncScheduledTasks',
  getScheduledTasks: 'desktop:getScheduledTasks',
  createScheduledTask: 'desktop:createScheduledTask',
  updateScheduledTask: 'desktop:updateScheduledTask',
  setScheduledTaskStatus: 'desktop:setScheduledTaskStatus',
  cancelScheduledTask: 'desktop:cancelScheduledTask',
  getTimedActions: 'desktop:getTimedActions',
  getTimedActionRuns: 'desktop:getTimedActionRuns',
  approveTimedActionAuto: 'desktop:timedAction:approveAuto',
  revokeTimedActionAuto: 'desktop:timedAction:revokeAuto',
  listMemories: 'desktop:listMemories',
  createMemory: 'desktop:createMemory',
  updateMemory: 'desktop:updateMemory',
  deleteMemory: 'desktop:deleteMemory',
  importMemories: 'desktop:importMemories',
  memoryStats: 'desktop:memoryStats',
  memoryCompact: 'desktop:memoryCompact',
  memoryPersonaTraits: 'desktop:memoryPersonaTraits',
  memoryListLayer: 'desktop:memoryListLayer',
  memoryDeleteEntry: 'desktop:memoryDeleteEntry',
  memoryClearAll: 'desktop:memoryClearAll',
  memoryGetModelId: 'desktop:memoryGetModelId',
  memorySetModelId: 'desktop:memorySetModelId',
  getEmbeddingModels: 'desktop:getEmbeddingModels',
  downloadEmbeddingModel: 'desktop:downloadEmbeddingModel',
  setEmbeddingModel: 'desktop:setEmbeddingModel',
  getConnectorsConfig: 'desktop:getConnectorsConfig',
  saveConnectorsConfig: 'desktop:saveConnectorsConfig',
  listConnectorRuntimes: 'desktop:listConnectorRuntimes',
  testConnectorProvider: 'desktop:testConnectorProvider',
  kbListCollections: 'desktop:kb:listCollections',
  kbCreateCollection: 'desktop:kb:createCollection',
  kbDeleteCollection: 'desktop:kb:deleteCollection',
  kbListSources: 'desktop:kb:listSources',
  kbAddSource: 'desktop:kb:addSource',
  kbDeleteSource: 'desktop:kb:deleteSource',
  kbGetCollectionState: 'desktop:kb:getCollectionState',
  kbSearch: 'desktop:kb:search',
  kbPickFiles: 'desktop:kb:pickFiles',
  // KSwarm proxy
  kswarmProxyGet: 'desktop:kswarm:proxy:get',
  kswarmProxyGetText: 'desktop:kswarm:proxy:getText',
  kswarmProxyPost: 'desktop:kswarm:proxy:post',
  kswarmProxyPostJson: 'desktop:kswarm:proxy:postJson',
  kswarmProxyPut: 'desktop:kswarm:proxy:put',
  kswarmProxyPatch: 'desktop:kswarm:proxy:patch',
  kswarmProxyDelete: 'desktop:kswarm:proxy:delete',
  kswarmStreamSubscribe: 'desktop:kswarm:stream:subscribe',
  kswarmStreamUnsubscribe: 'desktop:kswarm:stream:unsubscribe',
  kswarmStreamGetStatus: 'desktop:kswarm:stream:status',
  connectionHealthz: 'desktop:connection:healthz',
  connectionHealth: 'desktop:connection:health',
  // Extra
  showSaveDialog: 'desktop:showSaveDialog',
  saveFile: 'desktop:saveFile',
  listPrinciples: 'desktop:listPrinciples',
  savePrinciple: 'desktop:savePrinciple',
  deletePrinciple: 'desktop:deletePrinciple',
  // Thread meta
  getThreadLabels: 'desktop:getThreadLabels',
  setThreadLabel: 'desktop:setThreadLabel',
  unsetThreadLabel: 'desktop:unsetThreadLabel',
  moveThreadLabel: 'desktop:moveThreadLabel',
  getAppFlag: 'desktop:getAppFlag',
  setAppFlag: 'desktop:setAppFlag',
  migrateLegacyThreadMeta: 'desktop:migrateLegacyThreadMeta',
};

// Channels that are intentionally registered on main but not exposed via the
// preload bridge today. Listed here so the IPC contract test does not flag
// them, but kept under explicit watch — adding to this list should be a
// deliberate decision (and ideally short-lived).
export const KNOWN_UNROUTED_HANDLERS: readonly string[] = [
  // Artifact editing handlers (ipc.ts:465-493) — predate the preload bridge
  // and are not currently called from renderer. Track them here until they're
  // either exposed or removed.
  'desktop:artifactBackup',
  'desktop:artifactRevert',
  'desktop:artifactCleanup',
  'desktop:artifactWatch',
  'desktop:artifactUnwatch',
];

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

export type PluginMcpErrorCategory = 'python_version_too_old' | 'python_module_missing';

export interface PluginMcpErrorDetail {
  category: PluginMcpErrorCategory | null;
  message: string;
  detectedVersion?: string;
  requiredVersion?: string;
  command?: string;
  missingModule?: string;
}

export interface PluginMcpServerView {
  name: string;
  pluginName: string;
  toolCount: number;
  connected: boolean;
  enabled: boolean;
  lastError?: string;
  lastErrorDetail?: PluginMcpErrorDetail;
}

export interface PluginDependencyStatusView {
  pluginName: string;
  dependencyId: string;
  displayName: string;
  pluginInstalled?: boolean;
  state: 'ready' | 'missing' | 'needs_permission' | 'degraded' | 'unsupported';
  code: string;
  resolvedBinary?: string;
  version?: string;
  detail?: string;
  canInstall: boolean;
  canUpdate: boolean;
  canDiagnose: boolean;
}

export interface PluginDependencyActionInput {
  pluginName: string;
  dependencyId: string;
  confirmed?: boolean;
}

export interface PluginDependencyActionResult {
  success: boolean;
  status?: PluginDependencyStatusView;
  output?: string;
  error?: string;
}

export interface ComputerUseCapabilityStatusView {
  state: string;
  mcpConnected: boolean;
  wrapperReady: boolean;
  lastError?: string;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
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

export type DesktopRelatedServiceId = 'kswarm' | 'intent-broker' | 'runtime-bridge';

export interface DesktopRelatedServiceStatus {
  id: DesktopRelatedServiceId;
  label: string;
  running: boolean;
  reachable: boolean;
  port: number;
  pid: number | null;
  restartCount?: number;
  lastError: string | null;
  detail?: string;
}

export interface DesktopServiceStatusSnapshot {
  checkedAt: number;
  services: DesktopRelatedServiceStatus[];
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
  readClipboardImage(): Promise<string | null>;
  selectDirectory(): Promise<{ filePath: string }>;
  selectMaterials(): Promise<{ filePaths: string[] }>;
  importMaterial(input: { taskId: string; filePath: string; role: MaterialRole }): Promise<MaterialView>;
  createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
    context?: TaskCreateContext;
  }): Promise<{ taskId: string; understanding: TaskUnderstanding }>;
  createTaskWithFiles(input: {
    prompt: string;
    filePaths: string[];
    context?: TaskCreateContext;
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  subscribeTask(taskId: string, handler: (event: DesktopTaskEvent) => void, sinceIndex?: number): () => void;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getActiveTask(): Promise<{ taskId: string } | null>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
  openArtifact(artifactId: string): Promise<void>;
  openFileInSystemApp(filePath: string): Promise<void>;
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
  restartPluginMcpServers(): Promise<PluginMcpServerView[]>;
  restartPluginMcpServer(input: { name: string }): Promise<PluginMcpServerView[]>;
  getComputerUseCapabilityStatus(): Promise<ComputerUseCapabilityStatusView>;
  enableComputerUse(): Promise<ComputerUseCapabilityStatusView>;
  reconnectComputerUse(): Promise<ComputerUseCapabilityStatusView>;
  disableComputerUse(): Promise<ComputerUseCapabilityStatusView>;
  openPluginDependencyPermissionSettings(input: { permission: 'accessibility' | 'screen' }): Promise<void>;
  installPlugin(name: string): Promise<{ success: boolean; error?: string }>;
  listAvailablePlugins(): Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>>;
  listPluginDependencyStatuses(): Promise<PluginDependencyStatusView[]>;
  installPluginDependency(input: PluginDependencyActionInput): Promise<PluginDependencyActionResult>;
  updatePluginDependency(input: PluginDependencyActionInput): Promise<PluginDependencyActionResult>;
  diagnosePluginDependency(input: Omit<PluginDependencyActionInput, 'confirmed'>): Promise<PluginDependencyActionResult>;
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
  getKswarmConfig(): Promise<{ maxConcurrentTasks: number }>;
  saveKswarmConfig(input: { maxConcurrentTasks: number }): Promise<{ maxConcurrentTasks: number }>;
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
  getServiceStatus(): Promise<DesktopServiceStatusSnapshot>;
  restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void>;
  kswarmGetStatus(): Promise<KSwarmServiceStatus>;
  kswarmStart(): Promise<void>;
  kswarmStop(): Promise<void>;
  kswarmRestart(): Promise<void>;
  kswarmResumeWorkflowRun(input: { projectId: string; workflowRunId: string }): Promise<{ restored: boolean; reason?: string; jobId?: string }>;
  kswarmStartProjectPlanning(input: { projectId: string; projectName: string; goal: string; requirements: string; planningGuidance: string; poAgent: string; members: string[] }): Promise<{ ok: boolean; status?: string; error?: string }>;
  onKSwarmStatus(handler: (status: KSwarmServiceStatus) => void): () => void;
  exportTraceBundle(input: DesktopTraceTarget): Promise<{ ok: boolean; path?: string; error?: string }>;
  diagnose(input: DesktopTraceTarget): Promise<unknown>;
  getLoopDefinitions(): Promise<unknown[]>;
  listUserLoopTemplates(): Promise<unknown[]>;
  createUserLoopTemplate(input: unknown): Promise<unknown>;
  updateUserLoopTemplate(loopId: string, patch: unknown): Promise<unknown>;
  deleteUserLoopTemplate(loopId: string): Promise<void>;
  clearLoopRunHistory(loopId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }>;
  createLoopSchedule(input: unknown): Promise<unknown>;
  getLoopScheduleBindings(): Promise<unknown[]>;
  getAutomationOverviewSnapshot(): Promise<unknown>;
  getAutomationRunHistory(): Promise<unknown[]>;
  getAutomationsConfig(): Promise<{ globalBackgroundAutoRunEnabled: boolean }>;
  setGlobalBackgroundAutoRun(input: { enabled: boolean }): Promise<{ globalBackgroundAutoRunEnabled: boolean }>;
  openLoopOutputDirectory(loopId: string): Promise<unknown>;
  readLoopOutputPreview(loopId: string): Promise<unknown>;
  getLoopRuns(loopId: string): Promise<unknown[]>;
  getEvidenceAnomalies(loopId: string): Promise<unknown[]>;
  runLoopNow(loopId: string): Promise<unknown>;
  syncScheduledTasks(tasks: Array<{ id: string; cronExpr: string; enabled: boolean }>): Promise<void>;
  getScheduledTasks(): Promise<unknown[]>;
  createScheduledTask(input: unknown): Promise<unknown>;
  updateScheduledTask(input: unknown): Promise<unknown>;
  setScheduledTaskStatus(id: string, status: 'active' | 'paused'): Promise<unknown | null>;
  cancelScheduledTask(id: string): Promise<boolean>;
  getTimedActions(): Promise<unknown[]>;
  getTimedActionRuns(actionId: string): Promise<unknown[]>;
  approveTimedActionAuto(actionId: string): Promise<unknown | null>;
  revokeTimedActionAuto(actionId: string): Promise<unknown | null>;
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
  getEmbeddingModels(): Promise<{ id: string; name: string; dims: number; size: string; languages: string; downloaded: boolean; active: boolean; manualHint: { urls: { file: string; url: string }[]; targetDir: string } }[]>;
  downloadEmbeddingModel(modelId: string): Promise<void>;
  setEmbeddingModel(modelId: string): Promise<void>;
  getConnectorsConfig(): Promise<ConnectorsConfigSnapshot | null>;
  saveConnectorsConfig(input: ConnectorsConfig): Promise<ConnectorsConfigSnapshot>;
  listConnectorRuntimes(): Promise<ProviderRuntime[]>;
  testConnectorProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult>;

  // Knowledge Base
  kbListCollections(): Promise<unknown[]>;
  kbCreateCollection(input: unknown): Promise<unknown>;
  kbDeleteCollection(id: string): Promise<void>;
  kbListSources(collectionId: string): Promise<unknown[]>;
  kbAddSource(input: unknown): Promise<unknown>;
  kbDeleteSource(id: string): Promise<void>;
  kbGetCollectionState(collectionId: string): Promise<unknown>;
  kbSearch(input: unknown): Promise<unknown[]>;
  kbPickFiles(): Promise<string[]>;

  // Thread meta (GTD / pinned)
  getThreadLabels(): Promise<ThreadMetaSnapshot>;
  setThreadLabel(threadId: string, label: string): Promise<ThreadMetaWriteResult>;
  unsetThreadLabel(threadId: string, label: string): Promise<ThreadMetaWriteResult>;
  moveThreadLabel(threadId: string, from: string, to: string): Promise<ThreadMetaWriteResult>;
  getAppFlag(key: AppFlagKey): Promise<string | null>;
  setAppFlag(key: AppFlagKey, value: string): Promise<ThreadMetaWriteResult>;
  migrateLegacyThreadMeta(data: ThreadMetaSnapshot): Promise<{ migrated: boolean; reason?: string }>;
}

export type AppFlagKey = 'gtd-enabled';

export interface ThreadMetaSnapshot {
  gtdEnabled?: boolean;
  inbox?: string[];
  todo?: string[];
  waiting?: string[];
  someday?: string[];
  archived?: string[];
  pinned?: string[];
}

export interface ThreadMetaWriteResult {
  ok: boolean;
  degraded?: boolean;
}

export interface ConnectorTestResult {
  success: boolean;
  latencyMs: number;
  providerName: string;
  detail?: string;
  error?: string;
}

export interface KSwarmArtifact {
  name?: string;
  filename?: string;
  mimeType?: string;
  type?: string;
  projectId?: string;
  path?: string;
  relativePath?: string;
  url?: string;
  size?: number;
  previewable?: boolean;
  createdAt?: number | string;
  updatedAt?: number | string;
  generatedAt?: number | string;
}

export interface KSwarmTaskResult {
  summary?: string;
  artifacts?: KSwarmArtifact[];
}

export interface KSwarmTaskReviewResult {
  passed?: boolean;
  feedback?: string;
  failureClass?: string;
  reviewedAt?: number;
}

export interface KSwarmProjectDeliverable {
  summary?: string;
  artifacts?: KSwarmArtifact[];
  synthesis?: boolean;
  files?: unknown[];
  description?: string;
}

/**
 * KSwarm HTTP proxy interface.
 * ⚠️ All methods return Promise<unknown> — these are IPC pass-throughs to the
 * kswarm REST API. Consumers must perform runtime type validation or type
 * assertions. High-frequency endpoints (/projects, /tasks, /agents) should be
 * wrapped in type-safe accessor functions in useKSwarmClient with zod/runtime
 * validation on return values.
 */
export interface KSwarmProxyApi {
  kswarmProxyGet(path: string): Promise<unknown>;
  kswarmProxyGetText(path: string): Promise<string>;
  kswarmProxyPost(path: string, body: unknown): Promise<unknown>;
  kswarmProxyPostJson(path: string, body: unknown): Promise<unknown>;
  kswarmProxyPut(path: string, body: unknown): Promise<unknown>;
  kswarmProxyPatch(path: string, body: unknown): Promise<unknown>;
  kswarmProxyDelete(path: string): Promise<unknown>;
  kswarmStreamSubscribe(): Promise<void>;
  kswarmStreamUnsubscribe(): Promise<void>;
  kswarmStreamGetStatus(): Promise<unknown>;
  onKSwarmWsEvent(handler: (event: unknown) => void): () => void;
  onKSwarmConnectionStatus(handler: (status: unknown) => void): () => void;
  connectionHealthz(url: string): Promise<boolean>;
  connectionHealth(url: string): Promise<unknown>;
}

/**
 * systemUsername is a snapshot from preload execution time and does not reflect
 * runtime user switching. Use only for UI display; path construction or
 * permission checks should use IPC real-time queries.
 */
export type FullDesktopApi = DesktopApi & KSwarmProxyApi & {
  showSaveDialog(input: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ filePath: string; canceled: boolean }>;
  saveFile(input: { filePath: string; content: string }): Promise<{ ok: boolean; error?: string }>;
  listPrinciples(): Promise<unknown[]>;
  savePrinciple(principle: unknown): Promise<unknown>;
  deletePrinciple(id: string): Promise<void>;
  systemUsername: string;
};

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createPreloadApi(ipcRenderer: IpcRendererLike, systemUsername = ''): FullDesktopApi {
  return {
    getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig') as ReturnType<DesktopApi['getModelConfig']>,
    saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input) as ReturnType<DesktopApi['saveModelConfig']>,
    createManagedXiaokAgent: (input) => ipcRenderer.invoke('desktop:createManagedXiaokAgent', input) as ReturnType<DesktopApi['createManagedXiaokAgent']>,
    testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input) as ReturnType<DesktopApi['testProviderConnection']>,
    listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId) as ReturnType<DesktopApi['listAvailableModelsForProvider']>,
    deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId) as Promise<void>,
    deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId) as Promise<void>,
    readClipboardFilePaths: () => ipcRenderer.invoke('desktop:readClipboardFilePaths') as Promise<string[]>,
    readClipboardImage: () => ipcRenderer.invoke('desktop:readClipboardImage') as Promise<string | null>,
    selectDirectory: () => ipcRenderer.invoke('desktop:selectDirectory') as Promise<{ filePath: string }>,
    selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials') as ReturnType<DesktopApi['selectMaterials']>,
    importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input) as ReturnType<DesktopApi['importMaterial']>,
    createTask: (input) => ipcRenderer.invoke('desktop:createTask', input) as ReturnType<DesktopApi['createTask']>,
    createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input) as ReturnType<DesktopApi['createTaskWithFiles']>,
    subscribeTask(taskId, handler, sinceIndex) {
      const channel = `desktop:taskEvent:${taskId}`;
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as DesktopTaskEvent);
      };
      ipcRenderer.on(channel, listener);
      void ipcRenderer.invoke('desktop:subscribeTask', typeof sinceIndex === 'number' ? { taskId, sinceIndex } : { taskId });
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    answerQuestion: (input) => ipcRenderer.invoke('desktop:answerQuestion', input) as Promise<void>,
    cancelTask: (taskId) => ipcRenderer.invoke('desktop:cancelTask', { taskId }) as Promise<void>,
    getActiveTask: () => ipcRenderer.invoke('desktop:getActiveTask') as ReturnType<DesktopApi['getActiveTask']>,
    recoverTask: (taskId) => ipcRenderer.invoke('desktop:recoverTask', { taskId }) as ReturnType<DesktopApi['recoverTask']>,
    openArtifact: (artifactId) => ipcRenderer.invoke('desktop:openArtifact', { artifactId }) as Promise<void>,
    openFileInSystemApp: (filePath) => ipcRenderer.invoke('desktop:openFileInSystemApp', { filePath }) as Promise<void>,
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
    restartPluginMcpServers: () => ipcRenderer.invoke('desktop:restartPluginMcpServers') as Promise<PluginMcpServerView[]>,
    restartPluginMcpServer: (input) => ipcRenderer.invoke('desktop:restartPluginMcpServer', input) as Promise<PluginMcpServerView[]>,
    getComputerUseCapabilityStatus: () => ipcRenderer.invoke('desktop:getComputerUseCapabilityStatus') as Promise<ComputerUseCapabilityStatusView>,
    enableComputerUse: () => ipcRenderer.invoke('desktop:enableComputerUse') as Promise<ComputerUseCapabilityStatusView>,
    reconnectComputerUse: () => ipcRenderer.invoke('desktop:reconnectComputerUse') as Promise<ComputerUseCapabilityStatusView>,
    disableComputerUse: () => ipcRenderer.invoke('desktop:disableComputerUse') as Promise<ComputerUseCapabilityStatusView>,
    openPluginDependencyPermissionSettings: (input) => ipcRenderer.invoke('desktop:openPluginDependencyPermissionSettings', input) as Promise<void>,
    installPlugin: (name) => ipcRenderer.invoke('desktop:installPlugin', name) as Promise<{ success: boolean; error?: string }>,
    listAvailablePlugins: () => ipcRenderer.invoke('desktop:listAvailablePlugins') as Promise<Array<{ name: string; display_name: string; description: string; version: string; installed: boolean }>>,
    listPluginDependencyStatuses: () => ipcRenderer.invoke('desktop:listPluginDependencyStatuses') as Promise<PluginDependencyStatusView[]>,
    installPluginDependency: (input) => ipcRenderer.invoke('desktop:installPluginDependency', input) as Promise<PluginDependencyActionResult>,
    updatePluginDependency: (input) => ipcRenderer.invoke('desktop:updatePluginDependency', input) as Promise<PluginDependencyActionResult>,
    diagnosePluginDependency: (input) => ipcRenderer.invoke('desktop:diagnosePluginDependency', input) as Promise<PluginDependencyActionResult>,
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
    getKswarmConfig: () => ipcRenderer.invoke('desktop:getKswarmConfig') as Promise<{ maxConcurrentTasks: number }>,
    saveKswarmConfig: (input) => ipcRenderer.invoke('desktop:saveKswarmConfig', input) as Promise<{ maxConcurrentTasks: number }>,
    getSkillStats: () => ipcRenderer.invoke('desktop:getSkillStats') as ReturnType<DesktopApi['getSkillStats']>,
    getServiceStatus: () => ipcRenderer.invoke('desktop:services:getStatus') as Promise<DesktopServiceStatusSnapshot>,
    restartRelatedService: (serviceId) => ipcRenderer.invoke('desktop:services:restart', serviceId) as Promise<void>,
    kswarmGetStatus: () => ipcRenderer.invoke('desktop:kswarm:getStatus') as Promise<KSwarmServiceStatus>,
    kswarmStart: () => ipcRenderer.invoke('desktop:kswarm:start') as Promise<void>,
    kswarmStop: () => ipcRenderer.invoke('desktop:kswarm:stop') as Promise<void>,
    kswarmRestart: () => ipcRenderer.invoke('desktop:kswarm:restart') as Promise<void>,
    kswarmResumeWorkflowRun: (input) => ipcRenderer.invoke('desktop:kswarm:resumeWorkflowRun', input) as Promise<{ restored: boolean; reason?: string; jobId?: string }>,
    kswarmStartProjectPlanning: (input) => ipcRenderer.invoke('desktop:kswarm:startProjectPlanning', input) as Promise<{ ok: boolean; status?: string; error?: string }>,
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
    getLoopDefinitions: () => ipcRenderer.invoke('desktop:loops:listDefinitions') as Promise<unknown[]>,
    listUserLoopTemplates: () => ipcRenderer.invoke('desktop:loops:listUserTemplates') as Promise<unknown[]>,
    createUserLoopTemplate: (input) => ipcRenderer.invoke('desktop:loops:createUserTemplate', input) as Promise<unknown>,
    updateUserLoopTemplate: (loopId, patch) => ipcRenderer.invoke('desktop:loops:updateUserTemplate', loopId, patch) as Promise<unknown>,
    deleteUserLoopTemplate: (loopId) => ipcRenderer.invoke('desktop:loops:deleteUserTemplate', loopId) as Promise<void>,
    clearLoopRunHistory: (loopId, statuses) => ipcRenderer.invoke('desktop:loops:clearRunHistory', loopId, statuses) as Promise<{ ok: boolean; removed: number }>,
    createLoopSchedule: (input) => ipcRenderer.invoke('desktop:loops:createSchedule', input) as Promise<unknown>,
    getLoopScheduleBindings: () => ipcRenderer.invoke('desktop:loops:getScheduleBindings') as Promise<unknown[]>,
    getAutomationOverviewSnapshot: () => ipcRenderer.invoke('desktop:automations:getOverviewSnapshot') as Promise<unknown>,
    getAutomationRunHistory: () => ipcRenderer.invoke('desktop:automations:getRunHistory') as Promise<unknown[]>,
    getAutomationsConfig: () => ipcRenderer.invoke('desktop:automations:getConfig') as Promise<{ globalBackgroundAutoRunEnabled: boolean }>,
    setGlobalBackgroundAutoRun: (input) => ipcRenderer.invoke('desktop:automations:setGlobalBackgroundAutoRun', input) as Promise<{ globalBackgroundAutoRunEnabled: boolean }>,
    openLoopOutputDirectory: (loopId) => ipcRenderer.invoke('desktop:loops:openOutputDirectory', loopId) as Promise<unknown>,
    readLoopOutputPreview: (loopId) => ipcRenderer.invoke('desktop:loops:readOutputPreview', loopId) as Promise<unknown>,
    getLoopRuns: (loopId) => ipcRenderer.invoke('desktop:loops:listRuns', loopId) as Promise<unknown[]>,
    getEvidenceAnomalies: (loopId) => ipcRenderer.invoke('desktop:loops:listAnomalies', loopId) as Promise<unknown[]>,
    runLoopNow: (loopId) => ipcRenderer.invoke('desktop:loops:runNow', loopId) as Promise<unknown>,
    syncScheduledTasks: (tasks) => ipcRenderer.invoke('desktop:syncScheduledTasks', tasks) as Promise<void>,
    getScheduledTasks: () => ipcRenderer.invoke('desktop:getScheduledTasks') as Promise<unknown[]>,
    createScheduledTask: (input) => ipcRenderer.invoke('desktop:createScheduledTask', input) as Promise<unknown>,
    updateScheduledTask: (input) => ipcRenderer.invoke('desktop:updateScheduledTask', input) as Promise<unknown>,
    setScheduledTaskStatus: (id, status) => ipcRenderer.invoke('desktop:setScheduledTaskStatus', id, status) as Promise<unknown | null>,
    cancelScheduledTask: (id) => ipcRenderer.invoke('desktop:cancelScheduledTask', id) as Promise<boolean>,
    getTimedActions: () => ipcRenderer.invoke('desktop:getTimedActions') as Promise<unknown[]>,
    getTimedActionRuns: (actionId) => ipcRenderer.invoke('desktop:getTimedActionRuns', actionId) as Promise<unknown[]>,
    approveTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:approveAuto', actionId) as Promise<unknown | null>,
    revokeTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:revokeAuto', actionId) as Promise<unknown | null>,
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
    getEmbeddingModels: () => ipcRenderer.invoke('desktop:getEmbeddingModels') as ReturnType<DesktopApi['getEmbeddingModels']>,
    downloadEmbeddingModel: (modelId: string) => ipcRenderer.invoke('desktop:downloadEmbeddingModel', modelId) as Promise<void>,
    setEmbeddingModel: (modelId: string) => ipcRenderer.invoke('desktop:setEmbeddingModel', modelId) as Promise<void>,
    getConnectorsConfig: () => ipcRenderer.invoke('desktop:getConnectorsConfig') as Promise<ConnectorsConfigSnapshot | null>,
    saveConnectorsConfig: (input) => ipcRenderer.invoke('desktop:saveConnectorsConfig', input) as Promise<ConnectorsConfigSnapshot>,
    listConnectorRuntimes: () => ipcRenderer.invoke('desktop:listConnectorRuntimes') as Promise<ProviderRuntime[]>,
    testConnectorProvider: (kind) => ipcRenderer.invoke('desktop:testConnectorProvider', kind) as Promise<ConnectorTestResult>,
    kbListCollections: () => ipcRenderer.invoke('desktop:kb:listCollections') as Promise<unknown[]>,
    kbCreateCollection: (input) => ipcRenderer.invoke('desktop:kb:createCollection', input) as Promise<unknown>,
    kbDeleteCollection: (id) => ipcRenderer.invoke('desktop:kb:deleteCollection', id) as Promise<void>,
    kbListSources: (collectionId) => ipcRenderer.invoke('desktop:kb:listSources', collectionId) as Promise<unknown[]>,
    kbAddSource: (input) => ipcRenderer.invoke('desktop:kb:addSource', input) as Promise<unknown>,
    kbDeleteSource: (id) => ipcRenderer.invoke('desktop:kb:deleteSource', id) as Promise<void>,
    kbGetCollectionState: (collectionId) => ipcRenderer.invoke('desktop:kb:getCollectionState', collectionId) as Promise<unknown>,
    kbSearch: (input) => ipcRenderer.invoke('desktop:kb:search', input) as Promise<unknown[]>,
    kbPickFiles: () => ipcRenderer.invoke('desktop:kb:pickFiles') as Promise<string[]>,
    getThreadLabels: () => ipcRenderer.invoke('desktop:getThreadLabels') as Promise<ThreadMetaSnapshot>,
    setThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:setThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    unsetThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:unsetThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    moveThreadLabel: (threadId, from, to) => ipcRenderer.invoke('desktop:moveThreadLabel', threadId, from, to) as Promise<ThreadMetaWriteResult>,
    getAppFlag: (key) => ipcRenderer.invoke('desktop:getAppFlag', key) as Promise<string | null>,
    setAppFlag: (key, value) => ipcRenderer.invoke('desktop:setAppFlag', key, value) as Promise<ThreadMetaWriteResult>,
    migrateLegacyThreadMeta: (data) => ipcRenderer.invoke('desktop:migrateLegacyThreadMeta', data) as Promise<{ migrated: boolean; reason?: string }>,
    showSaveDialog: (input) => ipcRenderer.invoke('desktop:showSaveDialog', input) as Promise<{ filePath: string; canceled: boolean }>,
    saveFile: (input) => ipcRenderer.invoke('desktop:saveFile', input) as Promise<{ ok: boolean; error?: string }>,
    listPrinciples: () => ipcRenderer.invoke('desktop:listPrinciples') as Promise<unknown[]>,
    savePrinciple: (principle) => ipcRenderer.invoke('desktop:savePrinciple', principle) as Promise<unknown>,
    deletePrinciple: (id) => ipcRenderer.invoke('desktop:deletePrinciple', id) as Promise<void>,
    kswarmProxyGet: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:get', path) as Promise<unknown>,
    kswarmProxyGetText: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:getText', path) as Promise<string>,
    kswarmProxyPost: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:post', path, body) as Promise<unknown>,
    kswarmProxyPostJson: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:postJson', path, body) as Promise<unknown>,
    kswarmProxyPut: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:put', path, body) as Promise<unknown>,
    kswarmProxyPatch: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:patch', path, body) as Promise<unknown>,
    kswarmProxyDelete: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:delete', path) as Promise<unknown>,
    kswarmStreamSubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:subscribe') as Promise<void>,
    kswarmStreamUnsubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:unsubscribe') as Promise<void>,
    kswarmStreamGetStatus: () => ipcRenderer.invoke('desktop:kswarm:stream:status') as Promise<unknown>,
    onKSwarmWsEvent(handler) {
      const channel = 'desktop:kswarm:wsEvent';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    onKSwarmConnectionStatus(handler) {
      const channel = 'desktop:kswarm:connectionStatus';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    connectionHealthz: (url) => ipcRenderer.invoke('desktop:connection:healthz', url) as Promise<boolean>,
    connectionHealth: (url) => ipcRenderer.invoke('desktop:connection:health', url) as Promise<unknown>,
    systemUsername,
  };
}

export type { IpcRenderer };
