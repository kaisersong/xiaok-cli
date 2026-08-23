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
import type {
  ModelRuntimeConstraints,
  ModelRuntimeOptions,
  ProtocolId,
} from '../../src/ai/providers/types.js';
import type {
  ConnectorsConfig,
  ProviderRuntime,
  SearchProviderName,
  FetchProviderName,
} from '../../src/ai/tools/connectors/config.js';
import type {
  ArtifactWorkspaceErrorCode,
  ArtifactWorkspaceEventName,
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspacePreview,
  ArtifactWorkspaceRelationKind,
  ArtifactWorkspaceRequestedKind,
  ArtifactWorkspaceSelectedArtifact,
  ArtifactWorkspaceSnapshot,
} from '../shared/artifact-workspace-types.js';

// Re-export types for renderer usage
export type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskCreateContext,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  ModelRuntimeConstraints,
  ModelRuntimeOptions,
  ProtocolId,
  ConnectorsConfig,
  ProviderRuntime,
  SearchProviderName,
  FetchProviderName,
};

export const PRELOAD_API_KEYS = [
  'getModelConfig',
  'saveModelConfig',
  'updateModelRuntimeOptions',
  'createManagedXiaokAgent',
  'testProviderConnection',
  'listAvailableModelsForProvider',
  'deleteProvider',
  'deleteModel',
  'getMobilePairingInfo',
  'getMobileRelayStatus',
  'openMobileRelaySignIn',
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
  'getArtifactWorkspaceSnapshot',
  'closeArtifactWorkspace',
  'readArtifactWorkspaceVersionPreview',
  'exportArtifactWorkspaceVersion',
  'createArtifactPlaceholder',
  'submitArtifactGeneration',
  'cancelArtifactGeneration',
  'retryArtifactGeneration',
  'preferArtifactVersion',
  'removeArtifactWorkspaceNode',
  'updateArtifactWorkspaceLayout',
  'saveArtifactWorkspaceViewport',
  'createArtifactWorkspaceCollection',
  'createArtifactWorkspaceNote',
  'updateArtifactWorkspaceNote',
  'createArtifactWorkspaceRelation',
  'setArtifactCollectionMembership',
  'recordArtifactWorkspaceEvent',
  'onArtifactWorkspaceChanged',
  'selectHtmlEditMedia',
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
  'retryPluginComponent',
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
  'onSkillsChanged',
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
  'getAssistantOverview',
  'activateAssistant',
  'pauseAssistant',
  'resumeAssistant',
  'acceptAssistantCandidate',
  'rejectAssistantCandidate',
  'planProjectTeam',
  'applyProjectTeamPlan',
  'getProjectTeamOperation',
  'createKSwarmProject',
  'updateKSwarmProjectExecutionMode',
  'deleteKSwarmProject',
  'createKSwarmAgent',
  'updateKSwarmAgent',
  'archiveKSwarmAgent',
  'startKSwarmAgent',
  'stopKSwarmAgent',
  'probeKSwarmAgent',
  'onKSwarmStatus',
  'onMobileRelayStatus',
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
  'readLoopTaskResult',
  'getLoopRuns',
  'getEvidenceAnomalies',
  'runLoopNow',
  'listLoopConstraints',
  'setLoopConstraintActive',
  'confirmLoopConstraint',
  'onLoopConstraintAdded',
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
  'clearScheduledTaskRunHistory',
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
  'kbGetSourceContent',
  'kbSearch',
  'kbPickFiles',
  'meetingPickAudioFile',
  'meetingGetMicrophonePermission',
  'meetingRequestMicrophonePermission',
  'meetingGetAsrConfig',
  'meetingSaveAsrConfig',
  'meetingListModels',
  'meetingDownloadModel',
  'meetingUninstallModel',
  'meetingSaveRecordedAudio',
  'meetingTranscribePreview',
  'meetingStartLiveTranscription',
  'meetingPushLiveTranscriptionAudio',
  'meetingFinishLiveTranscription',
  'meetingCancelLiveTranscription',
  'meetingDraftRecording',
  'meetingProcessRecording',
  'meetingSaveTranscript',
  'meetingOpenRecorderWindow',
  'meetingSetRecorderWindowMode',
  'meetingSetRecorderSessionState',
  'meetingNotifyRecorderSummaryReady',
  'meetingNotifyRecordingSaved',
  'meetingCloseRecorderWindow',
  'onMeetingRecorderCloseRequested',
  'onMeetingRecordingSaved',
  'onMeetingLiveTranscriptionUpdate',
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
  'onArtifactWorkspaceChanged',
  'onUpdateStatus',
  'onSkillsChanged',
  'onReminder',
  'onScheduledTaskDue',
  'onLoopConstraintAdded',
  'onKSwarmStatus',
  'onMobileRelayStatus',
  'onKSwarmWsEvent',
  'onKSwarmConnectionStatus',
  'onMeetingRecorderCloseRequested',
  'onMeetingRecordingSaved',
  'onMeetingLiveTranscriptionUpdate',
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
  updateModelRuntimeOptions: 'desktop:updateModelRuntimeOptions',
  createManagedXiaokAgent: 'desktop:createManagedXiaokAgent',
  testProviderConnection: 'desktop:testProviderConnection',
  listAvailableModelsForProvider: 'desktop:listAvailableModelsForProvider',
  deleteProvider: 'desktop:deleteProvider',
  deleteModel: 'desktop:deleteModel',
  getMobilePairingInfo: 'desktop:mobile:getPairingInfo',
  getMobileRelayStatus: 'desktop:mobile:getRelayStatus',
  openMobileRelaySignIn: 'desktop:mobile:openRelaySignIn',
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
  getArtifactWorkspaceSnapshot: 'desktop:artifactWorkspace:getArtifactWorkspaceSnapshot',
  closeArtifactWorkspace: 'desktop:artifactWorkspace:closeArtifactWorkspace',
  readArtifactWorkspaceVersionPreview: 'desktop:artifactWorkspace:readArtifactWorkspaceVersionPreview',
  exportArtifactWorkspaceVersion: 'desktop:artifactWorkspace:exportArtifactWorkspaceVersion',
  createArtifactPlaceholder: 'desktop:artifactWorkspace:createArtifactPlaceholder',
  submitArtifactGeneration: 'desktop:artifactWorkspace:submitArtifactGeneration',
  cancelArtifactGeneration: 'desktop:artifactWorkspace:cancelArtifactGeneration',
  retryArtifactGeneration: 'desktop:artifactWorkspace:retryArtifactGeneration',
  preferArtifactVersion: 'desktop:artifactWorkspace:preferArtifactVersion',
  removeArtifactWorkspaceNode: 'desktop:artifactWorkspace:removeArtifactWorkspaceNode',
  updateArtifactWorkspaceLayout: 'desktop:artifactWorkspace:updateArtifactWorkspaceLayout',
  saveArtifactWorkspaceViewport: 'desktop:artifactWorkspace:saveArtifactWorkspaceViewport',
  createArtifactWorkspaceCollection: 'desktop:artifactWorkspace:createArtifactWorkspaceCollection',
  createArtifactWorkspaceNote: 'desktop:artifactWorkspace:createArtifactWorkspaceNote',
  updateArtifactWorkspaceNote: 'desktop:artifactWorkspace:updateArtifactWorkspaceNote',
  createArtifactWorkspaceRelation: 'desktop:artifactWorkspace:createArtifactWorkspaceRelation',
  setArtifactCollectionMembership: 'desktop:artifactWorkspace:setArtifactCollectionMembership',
  recordArtifactWorkspaceEvent: 'desktop:artifactWorkspace:recordArtifactWorkspaceEvent',
  selectHtmlEditMedia: 'desktop:selectHtmlEditMedia',
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
  retryPluginComponent: 'desktop:retryPluginComponent',
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
  getAssistantOverview: 'desktop:assistant:getOverview',
  activateAssistant: 'desktop:assistant:activate',
  pauseAssistant: 'desktop:assistant:pause',
  resumeAssistant: 'desktop:assistant:resume',
  acceptAssistantCandidate: 'desktop:assistant:acceptCandidate',
  rejectAssistantCandidate: 'desktop:assistant:rejectCandidate',
  planProjectTeam: 'desktop:kswarm:team:plan',
  applyProjectTeamPlan: 'desktop:kswarm:team:apply',
  getProjectTeamOperation: 'desktop:kswarm:team:getOperation',
  createKSwarmProject: 'desktop:kswarm:project:create',
  updateKSwarmProjectExecutionMode: 'desktop:kswarm:project:updateExecutionMode',
  deleteKSwarmProject: 'desktop:kswarm:project:delete',
  createKSwarmAgent: 'desktop:kswarm:agent:create',
  updateKSwarmAgent: 'desktop:kswarm:agent:update',
  archiveKSwarmAgent: 'desktop:kswarm:agent:archive',
  startKSwarmAgent: 'desktop:kswarm:agent:start',
  stopKSwarmAgent: 'desktop:kswarm:agent:stop',
  probeKSwarmAgent: 'desktop:kswarm:agent:probe',
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
  readLoopTaskResult: 'desktop:loops:readTaskResult',
  getLoopRuns: 'desktop:loops:listRuns',
  getEvidenceAnomalies: 'desktop:loops:listAnomalies',
  runLoopNow: 'desktop:loops:runNow',
  listLoopConstraints: 'desktop:loops:listConstraints',
  setLoopConstraintActive: 'desktop:loops:setConstraintActive',
  confirmLoopConstraint: 'desktop:loops:confirmConstraint',
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
  clearScheduledTaskRunHistory: 'desktop:scheduledTasks:clearRunHistory',
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
  kbGetSourceContent: 'desktop:kb:getSourceContent',
  kbSearch: 'desktop:kb:search',
  kbPickFiles: 'desktop:kb:pickFiles',
  meetingPickAudioFile: 'desktop:meeting:pickAudioFile',
  meetingGetMicrophonePermission: 'desktop:meeting:getMicrophonePermission',
  meetingRequestMicrophonePermission: 'desktop:meeting:requestMicrophonePermission',
  meetingGetAsrConfig: 'desktop:meeting:getAsrConfig',
  meetingSaveAsrConfig: 'desktop:meeting:saveAsrConfig',
  meetingListModels: 'desktop:meeting:listModels',
  meetingDownloadModel: 'desktop:meeting:downloadModel',
  meetingUninstallModel: 'desktop:meeting:uninstallModel',
  meetingSaveRecordedAudio: 'desktop:meeting:saveRecordedAudio',
  meetingTranscribePreview: 'desktop:meeting:transcribePreview',
  meetingStartLiveTranscription: 'desktop:meeting:live:start',
  meetingPushLiveTranscriptionAudio: 'desktop:meeting:live:pushAudio',
  meetingFinishLiveTranscription: 'desktop:meeting:live:finish',
  meetingCancelLiveTranscription: 'desktop:meeting:live:cancel',
  meetingDraftRecording: 'desktop:meeting:draftRecording',
  meetingProcessRecording: 'desktop:meeting:processRecording',
  meetingSaveTranscript: 'desktop:meeting:saveTranscript',
  meetingOpenRecorderWindow: 'desktop:meetingOpenRecorderWindow',
  meetingSetRecorderWindowMode: 'desktop:meetingSetRecorderWindowMode',
  meetingSetRecorderSessionState: 'desktop:meetingSetRecorderSessionState',
  meetingNotifyRecorderSummaryReady: 'desktop:meetingNotifyRecorderSummaryReady',
  meetingNotifyRecordingSaved: 'desktop:meetingNotifyRecordingSaved',
  meetingCloseRecorderWindow: 'desktop:meetingCloseRecorderWindow',
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
  runtimeOptions?: ModelRuntimeOptions;
  runtimeConstraints?: ModelRuntimeConstraints;
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
  availableModels?: AvailableModelView[];
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

export interface DesktopUpdateModelRuntimeOptionsInput {
  modelId: string;
  runtimeOptions: ModelRuntimeOptions;
}

export interface AvailableModelView {
  modelId: string;
  model: string;
  label: string;
  capabilities?: string[];
  runtimeOptions?: ModelRuntimeOptions;
  runtimeConstraints?: ModelRuntimeConstraints;
}

export interface TestProviderConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export type MeetingAsrProviderId = 'sherpa-onnx-paraformer' | 'whisper' | 'volcengine-asr' | 'aliyun-asr';

export interface MeetingAsrConfigSnapshot {
  defaultProvider: MeetingAsrProviderId;
  volcengine: {
    configured: boolean;
    appKeyConfigured: boolean;
    accessKeyConfigured: boolean;
    endpoint?: string;
    resourceId: string;
  };
  aliyun: {
    configured: boolean;
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: string;
  };
}

export interface MeetingSaveAsrConfigInput {
  defaultProvider?: MeetingAsrProviderId;
  volcengine?: {
    appKey?: string;
    accessKey?: string;
    endpoint?: string;
    resourceId?: string;
    clearAppKey?: boolean;
    clearAccessKey?: boolean;
  };
  aliyun?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    clearApiKey?: boolean;
  };
}

export type DesktopMobileRelayCredentialState =
  | 'ok' | 'missing' | 'expired' | 'rejected' | 'unparseable';

export interface DesktopMobileRelayStatus {
  running: boolean;
  connected: boolean;
  relayUrl: string;
  roomId: string;
  lastError: string | null;
  credentialState: DesktopMobileRelayCredentialState;
  credentialExpiresAt?: string;
  requiresUserReauth: boolean;
}

export interface DesktopMobilePairingInfo {
  desktopId: string;
  desktopName: string;
  gatewayURL: string;
  reachableURLs: string[];
  relayUrl?: string;
  relayJwt?: string;
  relayRoomSecret: string;
  deepLink: string;
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

export interface HtmlEditMediaSelection {
  canceled: boolean;
  filePath: string;
  content: string;
  error?: string;
}

export interface ArtifactWorkspaceIpcError {
  code: ArtifactWorkspaceErrorCode;
  message: string;
  canonical?: unknown;
}

export type ArtifactWorkspaceIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ArtifactWorkspaceIpcError };

export interface ArtifactWorkspaceIdentityInput {
  conversationId: string;
  /** @deprecated Main owns the opaque workspace root identity; renderer values are ignored. */
  workspaceRootId?: string;
}

export interface GetArtifactWorkspaceSnapshotInput extends ArtifactWorkspaceIdentityInput {
  selectedArtifact?: ArtifactWorkspaceSelectedArtifact;
}

export interface ArtifactWorkspaceVersionInput extends ArtifactWorkspaceIdentityInput {
  versionId: string;
}

export interface CreateArtifactPlaceholderInput extends ArtifactWorkspaceIdentityInput {
  requestedKind: ArtifactWorkspaceRequestedKind;
  title?: string;
  x?: number;
  y?: number;
  expectedStructureRevision: number;
}

export interface SubmitArtifactGenerationInput extends ArtifactWorkspaceIdentityInput {
  placeholderNodeId?: string;
  prompt: string;
  sourceVersionId?: string;
  selectedArtifact?: ArtifactWorkspaceSelectedArtifact;
  requestedKind?: ArtifactWorkspaceRequestedKind;
  expectedStructureRevision?: number;
}

export interface CancelArtifactGenerationInput extends ArtifactWorkspaceIdentityInput {
  generationRequestId: string;
}

export interface RetryArtifactGenerationInput extends CancelArtifactGenerationInput {
  prompt?: string;
}

export interface PreferArtifactVersionInput extends ArtifactWorkspaceVersionInput {
  lineageId: string;
  expectedStructureRevision: number;
}

export interface RemoveArtifactWorkspaceNodeInput extends ArtifactWorkspaceIdentityInput {
  nodeId: string;
  expectedStructureRevision: number;
}

export interface UpdateArtifactWorkspaceLayoutInput extends ArtifactWorkspaceIdentityInput {
  patches: ArtifactWorkspaceLayoutPatch[];
}

export interface SaveArtifactWorkspaceViewportInput extends ArtifactWorkspaceIdentityInput {
  viewport: { x: number; y: number; zoom: number };
  expectedViewRevision?: number;
}

export interface CreateArtifactWorkspaceCollectionInput extends ArtifactWorkspaceIdentityInput {
  title: string;
  x?: number;
  y?: number;
  expectedStructureRevision: number;
}

export interface CreateArtifactWorkspaceNoteInput extends ArtifactWorkspaceIdentityInput {
  title?: string;
  noteText: string;
  x?: number;
  y?: number;
  expectedStructureRevision: number;
}

export interface UpdateArtifactWorkspaceNoteInput extends ArtifactWorkspaceIdentityInput {
  nodeId: string;
  noteText: string;
  expectedStructureRevision: number;
}

export interface CreateArtifactWorkspaceRelationInput extends ArtifactWorkspaceIdentityInput {
  fromNodeId: string;
  toNodeId: string;
  kind: ArtifactWorkspaceRelationKind;
  order?: number;
  expectedStructureRevision: number;
}

export interface SetArtifactCollectionMembershipInput extends ArtifactWorkspaceIdentityInput {
  collectionNodeId: string;
  memberNodeId: string;
  included: boolean;
  order?: number;
  expectedStructureRevision: number;
}

export interface RecordArtifactWorkspaceEventInput extends ArtifactWorkspaceIdentityInput {
  eventName: ArtifactWorkspaceEventName;
  requestId?: string;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export function sanitizeArtifactWorkspaceInput<T>(input: T): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { requestSource: _requestSource, viewKey: _viewKey, ...safe } = input as Record<string, unknown>;
  return safe as T;
}

function pickDefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function sanitizeAssistantCandidateInput(input: { candidateId?: unknown; collectionId?: unknown }): { candidateId: string; collectionId?: string } {
  return pickDefined({
    candidateId: typeof input?.candidateId === 'string' ? input.candidateId : '',
    collectionId: typeof input?.collectionId === 'string' ? input.collectionId : undefined,
  }) as { candidateId: string; collectionId?: string };
}

export function sanitizeKSwarmSemanticInput(
  kind: 'team-plan' | 'team-apply' | 'team-operation' | 'project-create' | 'project-execution-mode'
    | 'project-delete' | 'agent-create' | 'agent-update' | 'agent-id',
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'team-plan' || kind === 'team-operation' || kind === 'project-delete' || kind === 'agent-id') {
    const idKey = kind === 'agent-id' ? 'agentId' : 'projectId';
    return { [idKey]: typeof input?.[idKey] === 'string' ? input[idKey] : '' };
  }
  if (kind === 'team-apply') {
    return {
      projectId: typeof input?.projectId === 'string' ? input.projectId : '',
      planId: typeof input?.planId === 'string' ? input.planId : '',
      projectRevision: typeof input?.projectRevision === 'number' ? input.projectRevision : -1,
    };
  }
  if (kind === 'project-execution-mode') {
    return {
      projectId: typeof input?.projectId === 'string' ? input.projectId : '',
      executionMode: input?.executionMode,
    };
  }
  if (kind === 'project-create') {
    return pickDefined({
      name: input?.name,
      goal: input?.goal,
      requirements: input?.requirements,
      poAgent: input?.poAgent,
      members: input?.members,
      workFolder: input?.workFolder,
      enableSummary: input?.enableSummary,
      executionMode: input?.executionMode,
      agentSelection: input?.agentSelection,
      planningGuidance: input?.planningGuidance,
      autoStartPlanning: input?.autoStartPlanning,
    });
  }
  const sanitizeAgent = (candidate: Record<string, unknown>) => pickDefined({
    name: candidate?.name,
    description: candidate?.description,
    roles: candidate?.roles,
    capabilities: candidate?.capabilities,
    instructions: candidate?.instructions,
    runtimeType: candidate?.runtimeType,
    maxConcurrentTasks: candidate?.maxConcurrentTasks,
  });
  if (kind === 'agent-update') {
    const patch = input?.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
      ? sanitizeAgent(input.patch as Record<string, unknown>)
      : {};
    return { agentId: typeof input?.agentId === 'string' ? input.agentId : '', patch };
  }
  return sanitizeAgent(input);
}

export interface AssistantOverviewView {
  profile: { status: 'needs_consent' | 'active' | 'paused'; eveningTime: string; morningTime: string };
  suggestions: Array<{ id: string; title: string; summary: string }>;
  pendingCandidateCount: number;
  candidates: Array<Record<string, unknown>>;
}

export interface ProjectTeamPlanItemView {
  desiredAgentId: string;
  action: 'keep' | 'reuse' | 'create';
  role: string;
  agentName?: string;
  capabilityLabels: string[];
  reasonCode: string;
}

export interface ProjectTeamPlanView {
  planId: string;
  projectId: string;
  projectRevision: number;
  outcome: 'proposal' | 'no_change' | 'needs_manual_scope';
  summary: string;
  items: ProjectTeamPlanItemView[];
}

export interface ProjectTeamOperationView {
  operationId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export interface CreateKSwarmProjectSemanticInput {
  name: string;
  goal: string;
  requirements?: string;
  poAgent: string;
  members?: string[];
  workFolder?: string;
  enableSummary?: boolean;
  executionMode?: 'direct' | 'auto' | 'workflow_preferred';
  agentSelection?: {
    poAgent: { agentId: string; source: string };
    members: Array<{ agentId: string; source: string }>;
  };
  planningGuidance?: string;
  autoStartPlanning?: boolean;
}

export interface KSwarmAgentSemanticInput {
  name: string;
  description?: string;
  roles?: string[];
  capabilities?: string[];
  instructions?: string;
  runtimeType?: string;
  maxConcurrentTasks?: number;
}

export interface DesktopApi {
  getModelConfig(): Promise<DesktopModelConfigSnapshot>;
  saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot>;
  updateModelRuntimeOptions(input: DesktopUpdateModelRuntimeOptionsInput): Promise<DesktopModelConfigSnapshot>;
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
  getMobilePairingInfo(): Promise<DesktopMobilePairingInfo>;
  /** Typed relay credential state so the UI can tell "expired" from "offline". */
  getMobileRelayStatus(): Promise<DesktopMobileRelayStatus>;
  onMobileRelayStatus(handler: (status: DesktopMobileRelayStatus) => void): () => void;
  /** Opens the relay's own sign-in page; the URL is derived in main, not passed in. */
  openMobileRelaySignIn(): Promise<{ ok: boolean; url?: string; error?: string }>;
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
  getArtifactWorkspaceSnapshot(input: GetArtifactWorkspaceSnapshotInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  closeArtifactWorkspace(input: ArtifactWorkspaceIdentityInput): Promise<ArtifactWorkspaceIpcResult<{ closed: boolean }>>;
  onArtifactWorkspaceChanged(handler: (change: { conversationId: string; workspaceId: string }) => void): () => void;
  readArtifactWorkspaceVersionPreview(input: ArtifactWorkspaceVersionInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspacePreview>>;
  exportArtifactWorkspaceVersion(input: ArtifactWorkspaceVersionInput): Promise<ArtifactWorkspaceIpcResult<{ exported: boolean; canceled?: boolean }>>;
  createArtifactPlaceholder(input: CreateArtifactPlaceholderInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  submitArtifactGeneration(input: SubmitArtifactGenerationInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  cancelArtifactGeneration(input: CancelArtifactGenerationInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  retryArtifactGeneration(input: RetryArtifactGenerationInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  preferArtifactVersion(input: PreferArtifactVersionInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  removeArtifactWorkspaceNode(input: RemoveArtifactWorkspaceNodeInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  updateArtifactWorkspaceLayout(input: UpdateArtifactWorkspaceLayoutInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  saveArtifactWorkspaceViewport(input: SaveArtifactWorkspaceViewportInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  createArtifactWorkspaceCollection(input: CreateArtifactWorkspaceCollectionInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  createArtifactWorkspaceNote(input: CreateArtifactWorkspaceNoteInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  updateArtifactWorkspaceNote(input: UpdateArtifactWorkspaceNoteInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  createArtifactWorkspaceRelation(input: CreateArtifactWorkspaceRelationInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  setArtifactCollectionMembership(input: SetArtifactCollectionMembershipInput): Promise<ArtifactWorkspaceIpcResult<ArtifactWorkspaceSnapshot>>;
  recordArtifactWorkspaceEvent(input: RecordArtifactWorkspaceEventInput): Promise<ArtifactWorkspaceIpcResult<{ recorded: boolean }>>;
  selectHtmlEditMedia(input: { kind: 'image' | 'svg' }): Promise<HtmlEditMediaSelection>;
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
  /** Design v58 §7.2: component-scoped retry; never writes persisted desired state. */
  retryPluginComponent(input: { componentId: string }): Promise<PluginMcpServerView[]>;
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
  onSkillsChanged(handler: () => void): () => void;
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
  getAssistantOverview(): Promise<AssistantOverviewView>;
  activateAssistant(): Promise<unknown>;
  pauseAssistant(): Promise<unknown>;
  resumeAssistant(): Promise<unknown>;
  acceptAssistantCandidate(input: { candidateId: string; collectionId?: string }): Promise<unknown>;
  rejectAssistantCandidate(input: { candidateId: string }): Promise<unknown>;
  planProjectTeam(input: { projectId: string }): Promise<ProjectTeamPlanView>;
  applyProjectTeamPlan(input: { projectId: string; planId: string; projectRevision: number }): Promise<ProjectTeamOperationView>;
  getProjectTeamOperation(input: { projectId: string }): Promise<ProjectTeamOperationView | null>;
  createKSwarmProject(input: CreateKSwarmProjectSemanticInput): Promise<unknown>;
  updateKSwarmProjectExecutionMode(input: { projectId: string; executionMode: 'direct' | 'auto' | 'workflow_preferred' }): Promise<unknown>;
  deleteKSwarmProject(input: { projectId: string }): Promise<unknown>;
  createKSwarmAgent(input: KSwarmAgentSemanticInput): Promise<unknown>;
  updateKSwarmAgent(input: { agentId: string; patch: Partial<KSwarmAgentSemanticInput> }): Promise<unknown>;
  archiveKSwarmAgent(input: { agentId: string }): Promise<unknown>;
  startKSwarmAgent(input: { agentId: string }): Promise<unknown>;
  stopKSwarmAgent(input: { agentId: string }): Promise<unknown>;
  probeKSwarmAgent(input: { agentId: string }): Promise<unknown>;
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
  readLoopTaskResult(loopId: string): Promise<unknown>;
  getLoopRuns(loopId: string): Promise<unknown[]>;
  getEvidenceAnomalies(loopId: string): Promise<unknown[]>;
  runLoopNow(loopId: string): Promise<unknown>;
  listLoopConstraints(loopId: string): Promise<unknown[]>;
  setLoopConstraintActive(constraintId: string, active: boolean): Promise<unknown>;
  confirmLoopConstraint(constraintId: string): Promise<unknown>;
  onLoopConstraintAdded(handler: (constraint: unknown) => void): () => void;
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
  clearScheduledTaskRunHistory(actionId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }>;
  onScheduledTaskDue(handler: (event: { taskId: string; runtimeTaskId?: string; completed?: boolean; success?: boolean; title?: string; lastRunAt?: number; nextRunAt?: number; error?: string }) => void): () => void;
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
  kbGetSourceContent(input: unknown): Promise<unknown>;
  kbSearch(input: unknown): Promise<unknown[]>;
  kbPickFiles(): Promise<string[]>;
  meetingPickAudioFile(): Promise<string | null>;
  meetingGetMicrophonePermission(): Promise<unknown>;
  meetingRequestMicrophonePermission(): Promise<unknown>;
  meetingGetAsrConfig(): Promise<MeetingAsrConfigSnapshot>;
  meetingSaveAsrConfig(input: MeetingSaveAsrConfigInput): Promise<MeetingAsrConfigSnapshot>;
  meetingListModels(): Promise<unknown[]>;
  meetingDownloadModel(modelId: string): Promise<unknown>;
  meetingUninstallModel(modelId: string): Promise<unknown>;
  meetingSaveRecordedAudio(input: unknown): Promise<unknown>;
  meetingTranscribePreview(input: unknown): Promise<unknown>;
  meetingStartLiveTranscription(input: { engine: 'aliyun-asr' | 'volcengine-asr'; sampleRate: number; language?: string }): Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  meetingPushLiveTranscriptionAudio(input: { sessionId: string; pcmBase64: string }): Promise<{ ok: boolean; error?: string }>;
  meetingFinishLiveTranscription(input: { sessionId: string }): Promise<{ ok: boolean; error?: string }>;
  meetingCancelLiveTranscription(input: { sessionId: string }): Promise<{ ok: boolean; error?: string }>;
  meetingDraftRecording(input: unknown): Promise<unknown>;
  meetingProcessRecording(input: unknown): Promise<unknown>;
  meetingSaveTranscript(input: unknown): Promise<unknown>;
  meetingOpenRecorderWindow(input: { collectionId: string }): Promise<{ ok: boolean; error?: string }>;
  meetingSetRecorderWindowMode(input: { mode: 'workbench' | 'compact' | 'summary' }): Promise<{ ok: boolean }>;
  meetingSetRecorderSessionState(input: { state: 'idle' | 'recording' | 'processing' | 'summary' }): Promise<{ ok: boolean }>;
  meetingNotifyRecorderSummaryReady(input: { title: string }): Promise<{ ok: boolean; skipped?: boolean; reason?: string }>;
  meetingNotifyRecordingSaved(input: { collectionId: string }): Promise<{ ok: boolean }>;
  meetingCloseRecorderWindow(): Promise<{ ok: boolean }>;
  onMeetingRecorderCloseRequested(handler: () => void): () => void;
  onMeetingRecordingSaved(handler: (input: { collectionId: string }) => void): () => void;
  onMeetingLiveTranscriptionUpdate(handler: (input: {
    sessionId: string;
    sentenceId: string;
    start: number;
    end: number;
    text: string;
    final: boolean;
  }) => void): () => void;

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
  saveFile(input: { filePath: string; content: string; purpose?: 'html-edit' | 'text-edit' }): Promise<{ ok?: boolean; success?: boolean; error?: string }>;
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
    updateModelRuntimeOptions: (input) => ipcRenderer.invoke('desktop:updateModelRuntimeOptions', input) as ReturnType<DesktopApi['updateModelRuntimeOptions']>,
    createManagedXiaokAgent: (input) => ipcRenderer.invoke('desktop:createManagedXiaokAgent', input) as ReturnType<DesktopApi['createManagedXiaokAgent']>,
    testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input) as ReturnType<DesktopApi['testProviderConnection']>,
    listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId) as ReturnType<DesktopApi['listAvailableModelsForProvider']>,
    deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId) as Promise<void>,
    deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId) as Promise<void>,
    getMobilePairingInfo: () => ipcRenderer.invoke('desktop:mobile:getPairingInfo') as Promise<DesktopMobilePairingInfo>,
    getMobileRelayStatus: () => ipcRenderer.invoke('desktop:mobile:getRelayStatus') as Promise<DesktopMobileRelayStatus>,
    openMobileRelaySignIn: () => ipcRenderer.invoke('desktop:mobile:openRelaySignIn') as Promise<{ ok: boolean; url?: string; error?: string }>,
    onMobileRelayStatus(handler) {
      const channel = 'desktop:mobileRelayStatus';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as DesktopMobileRelayStatus);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
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
    getArtifactWorkspaceSnapshot: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:getArtifactWorkspaceSnapshot',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['getArtifactWorkspaceSnapshot']>,
    closeArtifactWorkspace: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:closeArtifactWorkspace',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['closeArtifactWorkspace']>,
    onArtifactWorkspaceChanged(handler) {
      const channel = 'desktop:artifactWorkspace:changed';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as { conversationId: string; workspaceId: string });
      };
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.off(channel, listener);
    },
    readArtifactWorkspaceVersionPreview: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:readArtifactWorkspaceVersionPreview',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['readArtifactWorkspaceVersionPreview']>,
    exportArtifactWorkspaceVersion: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:exportArtifactWorkspaceVersion',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['exportArtifactWorkspaceVersion']>,
    createArtifactPlaceholder: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:createArtifactPlaceholder',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['createArtifactPlaceholder']>,
    submitArtifactGeneration: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:submitArtifactGeneration',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['submitArtifactGeneration']>,
    cancelArtifactGeneration: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:cancelArtifactGeneration',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['cancelArtifactGeneration']>,
    retryArtifactGeneration: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:retryArtifactGeneration',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['retryArtifactGeneration']>,
    preferArtifactVersion: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:preferArtifactVersion',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['preferArtifactVersion']>,
    removeArtifactWorkspaceNode: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:removeArtifactWorkspaceNode',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['removeArtifactWorkspaceNode']>,
    updateArtifactWorkspaceLayout: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:updateArtifactWorkspaceLayout',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['updateArtifactWorkspaceLayout']>,
    saveArtifactWorkspaceViewport: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:saveArtifactWorkspaceViewport',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['saveArtifactWorkspaceViewport']>,
    createArtifactWorkspaceCollection: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:createArtifactWorkspaceCollection',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['createArtifactWorkspaceCollection']>,
    createArtifactWorkspaceNote: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:createArtifactWorkspaceNote',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['createArtifactWorkspaceNote']>,
    updateArtifactWorkspaceNote: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:updateArtifactWorkspaceNote',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['updateArtifactWorkspaceNote']>,
    createArtifactWorkspaceRelation: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:createArtifactWorkspaceRelation',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['createArtifactWorkspaceRelation']>,
    setArtifactCollectionMembership: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:setArtifactCollectionMembership',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['setArtifactCollectionMembership']>,
    recordArtifactWorkspaceEvent: (input) => ipcRenderer.invoke(
      'desktop:artifactWorkspace:recordArtifactWorkspaceEvent',
      sanitizeArtifactWorkspaceInput(input),
    ) as ReturnType<DesktopApi['recordArtifactWorkspaceEvent']>,
    selectHtmlEditMedia: (input) => ipcRenderer.invoke('desktop:selectHtmlEditMedia', input) as Promise<HtmlEditMediaSelection>,
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
    retryPluginComponent: (input) => ipcRenderer.invoke('desktop:retryPluginComponent', input) as Promise<PluginMcpServerView[]>,
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
    onSkillsChanged(handler) {
      const channel = 'desktop:skillsChanged';
      const listener = () => {
        handler();
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
    getAssistantOverview: () => ipcRenderer.invoke('desktop:assistant:getOverview') as ReturnType<DesktopApi['getAssistantOverview']>,
    activateAssistant: () => ipcRenderer.invoke('desktop:assistant:activate'),
    pauseAssistant: () => ipcRenderer.invoke('desktop:assistant:pause'),
    resumeAssistant: () => ipcRenderer.invoke('desktop:assistant:resume'),
    acceptAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:acceptCandidate', sanitizeAssistantCandidateInput(input)),
    rejectAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:rejectCandidate', sanitizeAssistantCandidateInput(input)),
    planProjectTeam: (input) => ipcRenderer.invoke(
      'desktop:kswarm:team:plan',
      sanitizeKSwarmSemanticInput('team-plan', input),
    ) as ReturnType<DesktopApi['planProjectTeam']>,
    applyProjectTeamPlan: (input) => ipcRenderer.invoke(
      'desktop:kswarm:team:apply',
      sanitizeKSwarmSemanticInput('team-apply', input),
    ) as ReturnType<DesktopApi['applyProjectTeamPlan']>,
    getProjectTeamOperation: (input) => ipcRenderer.invoke(
      'desktop:kswarm:team:getOperation',
      sanitizeKSwarmSemanticInput('team-operation', input),
    ) as ReturnType<DesktopApi['getProjectTeamOperation']>,
    createKSwarmProject: (input) => ipcRenderer.invoke(
      'desktop:kswarm:project:create',
      sanitizeKSwarmSemanticInput('project-create', input as unknown as Record<string, unknown>),
    ),
    updateKSwarmProjectExecutionMode: (input) => ipcRenderer.invoke(
      'desktop:kswarm:project:updateExecutionMode',
      sanitizeKSwarmSemanticInput('project-execution-mode', input),
    ),
    deleteKSwarmProject: (input) => ipcRenderer.invoke(
      'desktop:kswarm:project:delete',
      sanitizeKSwarmSemanticInput('project-delete', input),
    ),
    createKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:create',
      sanitizeKSwarmSemanticInput('agent-create', input as unknown as Record<string, unknown>),
    ),
    updateKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:update',
      sanitizeKSwarmSemanticInput('agent-update', input),
    ),
    archiveKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:archive',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ),
    startKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:start',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ),
    stopKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:stop',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ),
    probeKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:probe',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ),
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
    readLoopTaskResult: (loopId) => ipcRenderer.invoke('desktop:loops:readTaskResult', loopId) as Promise<unknown>,
    getLoopRuns: (loopId) => ipcRenderer.invoke('desktop:loops:listRuns', loopId) as Promise<unknown[]>,
    getEvidenceAnomalies: (loopId) => ipcRenderer.invoke('desktop:loops:listAnomalies', loopId) as Promise<unknown[]>,
    runLoopNow: (loopId) => ipcRenderer.invoke('desktop:loops:runNow', loopId) as Promise<unknown>,
    listLoopConstraints: (loopId) => ipcRenderer.invoke('desktop:loops:listConstraints', loopId) as Promise<unknown[]>,
    setLoopConstraintActive: (constraintId, active) => ipcRenderer.invoke('desktop:loops:setConstraintActive', constraintId, active) as Promise<unknown>,
    confirmLoopConstraint: (constraintId) => ipcRenderer.invoke('desktop:loops:confirmConstraint', constraintId) as Promise<unknown>,
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
    clearScheduledTaskRunHistory: (actionId, statuses) => ipcRenderer.invoke('desktop:scheduledTasks:clearRunHistory', actionId, statuses) as Promise<{ ok: boolean; removed: number }>,
    onScheduledTaskDue(handler) {
      const channel = 'desktop:scheduledTaskDue';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as { taskId: string; runtimeTaskId?: string; completed?: boolean; success?: boolean; title?: string; lastRunAt?: number; nextRunAt?: number; error?: string });
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    onLoopConstraintAdded(handler) {
      const channel = 'desktop:loops:constraintAdded';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload);
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
    kbGetSourceContent: (input) => ipcRenderer.invoke('desktop:kb:getSourceContent', input) as Promise<unknown>,
    kbSearch: (input) => ipcRenderer.invoke('desktop:kb:search', input) as Promise<unknown[]>,
    kbPickFiles: () => ipcRenderer.invoke('desktop:kb:pickFiles') as Promise<string[]>,
    meetingPickAudioFile: () => ipcRenderer.invoke('desktop:meeting:pickAudioFile') as Promise<string | null>,
    meetingGetMicrophonePermission: () => ipcRenderer.invoke('desktop:meeting:getMicrophonePermission') as Promise<unknown>,
    meetingRequestMicrophonePermission: () => ipcRenderer.invoke('desktop:meeting:requestMicrophonePermission') as Promise<unknown>,
    meetingGetAsrConfig: () => ipcRenderer.invoke('desktop:meeting:getAsrConfig') as Promise<MeetingAsrConfigSnapshot>,
    meetingSaveAsrConfig: (input) => ipcRenderer.invoke('desktop:meeting:saveAsrConfig', input) as Promise<MeetingAsrConfigSnapshot>,
    meetingListModels: () => ipcRenderer.invoke('desktop:meeting:listModels') as Promise<unknown[]>,
    meetingDownloadModel: (modelId: string) => ipcRenderer.invoke('desktop:meeting:downloadModel', modelId) as Promise<unknown>,
    meetingUninstallModel: (modelId: string) => ipcRenderer.invoke('desktop:meeting:uninstallModel', modelId) as Promise<unknown>,
    meetingSaveRecordedAudio: (input) => ipcRenderer.invoke('desktop:meeting:saveRecordedAudio', input) as Promise<unknown>,
    meetingTranscribePreview: (input) => ipcRenderer.invoke('desktop:meeting:transcribePreview', input) as Promise<unknown>,
    meetingStartLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:start', input) as ReturnType<DesktopApi['meetingStartLiveTranscription']>,
    meetingPushLiveTranscriptionAudio: (input) => ipcRenderer.invoke('desktop:meeting:live:pushAudio', input) as ReturnType<DesktopApi['meetingPushLiveTranscriptionAudio']>,
    meetingFinishLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:finish', input) as ReturnType<DesktopApi['meetingFinishLiveTranscription']>,
    meetingCancelLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:cancel', input) as ReturnType<DesktopApi['meetingCancelLiveTranscription']>,
    meetingDraftRecording: (input) => ipcRenderer.invoke('desktop:meeting:draftRecording', input) as Promise<unknown>,
    meetingProcessRecording: (input) => ipcRenderer.invoke('desktop:meeting:processRecording', input) as Promise<unknown>,
    meetingSaveTranscript: (input) => ipcRenderer.invoke('desktop:meeting:saveTranscript', input) as Promise<unknown>,
    meetingOpenRecorderWindow: (input) => ipcRenderer.invoke('desktop:meetingOpenRecorderWindow', input) as Promise<{ ok: boolean; error?: string }>,
    meetingSetRecorderWindowMode: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderWindowMode', input) as Promise<{ ok: boolean }>,
    meetingSetRecorderSessionState: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderSessionState', input) as Promise<{ ok: boolean }>,
    meetingNotifyRecorderSummaryReady: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecorderSummaryReady', input) as Promise<{ ok: boolean; skipped?: boolean; reason?: string }>,
    meetingNotifyRecordingSaved: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecordingSaved', input) as Promise<{ ok: boolean }>,
    meetingCloseRecorderWindow: () => ipcRenderer.invoke('desktop:meetingCloseRecorderWindow') as Promise<{ ok: boolean }>,
    onMeetingRecorderCloseRequested: (handler) => {
      const channel = 'desktop:meetingRecorderCloseRequested';
      const listener = () => handler();
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.off(channel, listener);
    },
    onMeetingRecordingSaved: (handler) => {
      const channel = 'desktop:meetingRecordingSaved';
      const listener = (_event: unknown, input: unknown) => handler(input as { collectionId: string });
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.off(channel, listener);
    },
    onMeetingLiveTranscriptionUpdate: (handler) => {
      const channel = 'desktop:meeting:live:update';
      const listener = (_event: unknown, input: unknown) => handler(input as Parameters<typeof handler>[0]);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.off(channel, listener);
    },
    getThreadLabels: () => ipcRenderer.invoke('desktop:getThreadLabels') as Promise<ThreadMetaSnapshot>,
    setThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:setThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    unsetThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:unsetThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    moveThreadLabel: (threadId, from, to) => ipcRenderer.invoke('desktop:moveThreadLabel', threadId, from, to) as Promise<ThreadMetaWriteResult>,
    getAppFlag: (key) => ipcRenderer.invoke('desktop:getAppFlag', key) as Promise<string | null>,
    setAppFlag: (key, value) => ipcRenderer.invoke('desktop:setAppFlag', key, value) as Promise<ThreadMetaWriteResult>,
    migrateLegacyThreadMeta: (data) => ipcRenderer.invoke('desktop:migrateLegacyThreadMeta', data) as Promise<{ migrated: boolean; reason?: string }>,
    showSaveDialog: (input) => ipcRenderer.invoke('desktop:showSaveDialog', input) as Promise<{ filePath: string; canceled: boolean }>,
    saveFile: (input) => ipcRenderer.invoke('desktop:saveFile', input) as Promise<{ ok?: boolean; success?: boolean; error?: string }>,
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
