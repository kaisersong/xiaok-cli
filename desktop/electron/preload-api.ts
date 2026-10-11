import type { MobilePairingInfoDto, MobileRelayStatusDto } from '../shared/mobile-readonly-ipc-contract.js';
import type { PluginMcpServerDto, PluginDependencyStatusDto, AvailablePluginDto } from '../shared/plugin-catalog-ipc-contract.js';
import type { UpdateIpcStatusDto, UpdateInstallDto } from '../shared/updater-ipc-contract.js';
import type { RecorderWindowReply, RecorderWindowNotificationReply } from '../shared/recorder-window-ipc-contract.js';
import type {ConnectorsConfigDto as ConnectorsConfig,ConnectorsRuntimeDto as ProviderRuntime,ConnectorsSnapshotDto,ConnectorTestResultDto,ConnectorsSearchProviderName as SearchProviderName,ConnectorsFetchProviderName as FetchProviderName} from '../shared/connectors-ipc-contract.js';
import type { ScheduledTaskDto, ScheduledCreateDto, ScheduledUpdateDto, ScheduledUpdateResultDto, ScheduledActionDto, ScheduledRunDto, ScheduledBindingDto, ScheduledLoopCreateDto, ScheduledReminderDto, ScheduledReminderStatusDto } from '../shared/scheduled-timed-action-ipc-contract.js';
import type { KnowledgeCollectionDto, KnowledgeSourceDto, KnowledgeCreateCollectionInput, KnowledgeAddSourceInput, KnowledgeCollectionStateDto, KnowledgeSourceContentInput, KnowledgeSourceContentDto, KnowledgeSearchInput, KnowledgeSearchResultDto } from '../shared/knowledge-ipc-contract.js';
import type { ProjectPrincipleDto, PrincipleSaveInput, PrincipleSaveResult, PrincipleDeleteResult } from '../shared/principles-ipc-contract.js';
import type * as ModelProviderDTO from '../shared/model-provider-ipc-contract.js';
import type { DesktopTraceTarget, DesktopTraceExportResult, DesktopDiagnosisReport, DesktopSkillStats } from '../shared/desktop-diagnostics-ipc-contract.js';
export type { DesktopTraceTarget } from '../shared/desktop-diagnostics-ipc-contract.js';
import type { ProxyJsonResult, ProxyTextResult, ProxyDeleteResult, ProxyHttpBody, ProxyStreamResult, ProxyStatusResult, ProxyHealthResult } from '../shared/kswarm-proxy-ipc-contract.js';
import type { ThreadMetadataSnapshotDto, ThreadMetadataMigrationResultDto } from '../shared/thread-metadata-ipc-contract.js';
import type { LoopCreateTemplateDto, LoopTemplatePatchDto, LoopDefinitionDto, UserLoopTemplateDto, CreateLoopTemplateResultDto, LoopConstraintDto, LoopAnomalyDto, LoopManagementRunResultDto } from '../shared/loop-management-ipc-contract.js';
import type { RoomCreateInput, RoomArchiveInput, RoomDeleteInput, RoomMembersInput, RoomSendInput, RoomSeenInput, RoomCancelInput, RoomProjectCreateInput, RoomTaskCreateInput, RoomListResultDto, RoomSnapshotDto, RoomCreateResultDto, RoomArchiveResultDto, RoomDeleteResultDto, RoomMembersResultDto, RoomSendResultDto, RoomSeenResultDto, RoomCancelResultDto, RoomProjectCreateResultDto, RoomTaskCreateResultDto } from '../shared/collaboration-room-ipc-contract.js';
import type { KSwarmProjectFactDto, KSwarmProjectModeResultDto, KSwarmProjectDeleteResultDto, KSwarmAgentFactDto, KSwarmProbeFactDto, KSwarmProjectCreateDto, KSwarmAgentCreateDto } from '../shared/kswarm-project-agent-ipc-contract.js';
import type { ProjectTeamPlanItemDto, ProjectTeamPlanDto, ProjectTeamOperationDto } from '../shared/kswarm-team-ipc-contract.js';
import type { AssistantProfileDto, AssistantCandidateDto, AssistantAcceptResultDto, AssistantOverviewDto } from '../shared/assistant-ipc-contract.js';
import type {LoopRunObservationDto,AutomationRunHistoryDto} from '../shared/loop-current-view-ipc-contract.js';
import type {LoopOutputActionResultView,LoopOutputPreviewView,LoopTaskResultView,LoopPublishedArtifactsView} from '../shared/loop-output-ipc-contract.js';
import type { MemoryIpcEntry, MemoryImportIpcResult, MemoryStatsIpcSnapshot, MemoryPersonaIpcTrait, MemoryLayerIpcEntry, EmbeddingModelIpcEntry } from '../shared/memory-ipc-types.js';
import type {OpenFileResult, ReadFileResult, SaveFileInput, SaveFileResult, ShowSaveDialogInput, ShowSaveDialogResult} from '../shared/file-ipc-contract.js';
import type { CompoundExecutionStatus, SemanticCompactionStatus } from '../shared/host-observation-types.js';
import type {LoopArtifactPageRequest} from '../shared/loop-artifacts.js';
import type {LoopPublicationActionDto,LoopPublicationActionResultDto,LoopPublicationStateDto,StoredLoopPublicationConfigurationDto} from '../shared/loop-publication-ipc-contract.js';
import type { DesktopGoalNativeMutationProjection } from '../shared/host-observation-types.js';
export type { DesktopGoalNativeMutationProjection } from '../shared/host-observation-types.js';
import type { GoalCompletionObservation } from '../shared/host-observation-types.js';
import type { ConversationActivity, WorkWatch, WorkProjection, ReportingPreference, McpInputForm } from '../shared/conversation-activity-types.js';
import type { IpcRenderer } from 'electron';
import type { RoomWorkspaceApi } from '../shared/room-workspace-contract.js';
import type { MultiAgentDesktopAPI } from '../shared/multi-agent-types.js';
import type { GoalAttachmentRequest, GoalAttachmentSource } from '../shared/goal-attachment.js';
export type { GoalAttachmentRequest, GoalAttachmentSource } from '../shared/goal-attachment.js';
import { createMultiAgentPreload } from './desktop-multi-agent-preload.js';
import type {
  DesktopTaskEvent,
  GoalTurnExecutionScope,
  MaterialView,
  MaterialRole,
  TaskCreateContext,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
} from '../../src/runtime/task-host/types.js';
import type { GoalActivation, GoalCreationInput, GoalInput, GoalState } from '../shared/host-observation-types.js';
import type {
  ModelRuntimeConstraints,
  ModelRuntimeOptions,
  ProtocolId,
} from '../../src/ai/providers/types.js';
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
  'getSystemOneConfig',
  'saveSystemOneConfig',
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
  'prepareObservationTask',
  'createObservationTask',
  'stopObservationTask',
  'revokeObservationTask',
  'getObservationTaskStatus',
  'createTask',
  'createTaskWithFiles',
  'subscribeTask',
  'getConversationActivities',
  'getConversationActivityUnread',
  'markConversationActivitiesRead',
  'subscribeConversationActivityOverview',
  'subscribeConversationActivities',
  'getWorkActivity',
  'getMcpTaskInputs',
  'answerMcpTaskInput',
  'cancelMcpWork',
  'updateWorkReporting',
  'stopWorkWatch',
  'getMultiAgentSnapshot',
  'listMultiAgentGroups',
  'listMultiAgents',
  'getMultiAgentEvents',
  'getAgentContent',
  'getMultiAgentOperation',
  'getMultiAgentResources',
  'resolveMultiAgentResource',
  'resetMultiAgentGroup',
  'getMultiAgentThreadDeletion',
  'deleteMultiAgentThread',
  'sendAgentMessage',
  'followupAgent',
  'interruptAgent',
  'closeAgent',
  'subscribeMultiAgents',
  'unsubscribeMultiAgents',
  'getLocalExecutionAuthorization',
  'getLocalExecutionWorkspace',
  'getMultiAgentApproval',
  'decideMultiAgentApproval',
  'setLocalExecutionAuthorization',
  'getLocalExecutionAuthorizationOperation',
  'subscribeLocalExecutionAuthorization',
  'unsubscribeLocalExecutionAuthorization',
  'getGoal',
  'getGoalNativeMutation',
  'recoverGoalNativeMutation',
  'continueGoalNativeMutation',
  'cancelGoalNativeMutation',
  'createGoal',
  'pauseGoal',
  'resumeGoal',
  'recoverGoalPublication',
  'continueGoalPublication',
  'cancelGoal',
  'replaceGoal',
  'ackGoalTaskAttached',
  'setGoalUserQueuePending',
  'onGoalChanged',
  'onGoalTaskPrepared',
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
  'cancelPluginDependencyTask',
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
  'listLoopPublishedArtifacts',
  'getLoopRuns',
  'getLoopPublicationConfiguration',
  'getLoopPublicationState',
  'performLoopPublicationAction',
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
  ...["listCollaborationRooms", "getCollaborationRoom", "createCollaborationRoom", "archiveCollaborationRoom", "deleteCollaborationRoom", "updateCollaborationRoomMembers", "sendCollaborationRoomMessage", "markCollaborationRoomSeen", "cancelRoomDiscussion", "createProjectFromRoom", "createTaskFromRoomMessage", "onCollaborationRoomEvent"]
  , 'getCollaborationRoomWorkspace', 'previewCollaborationRoomWorkspace', 'commitCollaborationRoomWorkspace',
  'cancelCollaborationRoomWorkspaceChange', 'listCollaborationRoomWorkspaceFiles', 'previewCollaborationRoomWorkspaceFile',
  'publishCollaborationRoomWorkspaceInstructions', 'confirmCollaborationRoomWorkspaceArtifact',
  'registerCollaborationRoomWorkspaceArtifact', 'mapCollaborationRoomWorkspaceProject', 'retryCollaborationRoomWorkspaceChange', 'setCollaborationRoomLocalCommands'
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
  'subscribeConversationActivityOverview',
  'subscribeConversationActivities',
  'subscribeTask',
  'subscribeMultiAgents',
  'subscribeLocalExecutionAuthorization',
  'onCollaborationRoomEvent',
  'onGoalChanged',
  'onGoalTaskPrepared',
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
  getConversationActivities: 'desktop:activity:list',
  getConversationActivityUnread: 'desktop:activity:unread',
  markConversationActivitiesRead: 'desktop:activity:read',
  getWorkActivity: 'desktop:activity:work',
  getMcpTaskInputs: 'desktop:activity:mcpInputs',
  answerMcpTaskInput: 'desktop:activity:mcpAnswer',
  cancelMcpWork: 'desktop:activity:mcpCancel',
  updateWorkReporting: 'desktop:activity:reporting',
  stopWorkWatch: 'desktop:activity:stop',
  getMultiAgentSnapshot: 'desktop:getMultiAgentSnapshot',
  listMultiAgentGroups: 'desktop:listMultiAgentGroups',
  listMultiAgents: 'desktop:listMultiAgents',
  getMultiAgentEvents: 'desktop:getMultiAgentEvents',
  getAgentContent: 'desktop:getAgentContent',
  getMultiAgentOperation: 'desktop:getMultiAgentOperation',
  getMultiAgentResources: 'desktop:getMultiAgentResources',
  resolveMultiAgentResource: 'desktop:resolveMultiAgentResource',
  resetMultiAgentGroup: 'desktop:resetMultiAgentGroup',
  getMultiAgentThreadDeletion: 'desktop:getMultiAgentThreadDeletion',
  deleteMultiAgentThread: 'desktop:deleteMultiAgentThread',
  sendAgentMessage: 'desktop:sendAgentMessage',
  followupAgent: 'desktop:followupAgent',
  interruptAgent: 'desktop:interruptAgent',
  closeAgent: 'desktop:closeAgent',
  unsubscribeMultiAgents: 'desktop:unsubscribeMultiAgents',
  getLocalExecutionAuthorization: 'desktop:getLocalExecutionAuthorization',
  getLocalExecutionWorkspace: 'desktop:getLocalExecutionWorkspace',
  getMultiAgentApproval: 'desktop:getMultiAgentApproval',
  decideMultiAgentApproval: 'desktop:decideMultiAgentApproval',
  setLocalExecutionAuthorization: 'desktop:setLocalExecutionAuthorization',
  getLocalExecutionAuthorizationOperation: 'desktop:getLocalExecutionAuthorizationOperation',
  unsubscribeLocalExecutionAuthorization: 'desktop:unsubscribeLocalExecutionAuthorization',
  getModelConfig: 'desktop:getModelConfig',
  saveModelConfig: 'desktop:saveModelConfig',
  updateModelRuntimeOptions: 'desktop:updateModelRuntimeOptions',
  getSystemOneConfig: 'desktop:getSystemOneConfig',
  saveSystemOneConfig: 'desktop:saveSystemOneConfig',
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
  prepareObservationTask: 'desktop:prepareObservationTask',
  createObservationTask: 'desktop:createObservationTask',
  stopObservationTask: 'desktop:stopObservationTask',
  revokeObservationTask: 'desktop:revokeObservationTask',
  getObservationTaskStatus: 'desktop:getObservationTaskStatus',
  createTask: 'desktop:createTask',
  createTaskWithFiles: 'desktop:createTaskWithFiles',
  getGoal: 'desktop:goal:get',
  getGoalNativeMutation: 'desktop:goal:getNativeMutation',
  recoverGoalNativeMutation: 'desktop:goal:recoverNativeMutation',
  continueGoalNativeMutation: 'desktop:goal:continueNativeMutation',
  cancelGoalNativeMutation: 'desktop:goal:cancelNativeMutation',
  createGoal: 'desktop:goal:create',
  pauseGoal: 'desktop:goal:pause',
  resumeGoal: 'desktop:goal:resume',
  recoverGoalPublication: 'desktop:goal:recoverPublication',
  continueGoalPublication: 'desktop:goal:continuePublication',
  cancelGoal: 'desktop:goal:cancel',
  replaceGoal: 'desktop:goal:replace',
  ackGoalTaskAttached: 'desktop:goal:ackTaskAttached',
  setGoalUserQueuePending: 'desktop:goal:setUserQueuePending',
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
  cancelPluginDependencyTask: 'desktop:cancelPluginDependencyTask',
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
  listLoopPublishedArtifacts: 'desktop:loops:listPublishedArtifacts',
  getLoopRuns: 'desktop:loops:listRuns',
  getLoopPublicationConfiguration: 'desktop:loops:getPublicationConfiguration',
  getLoopPublicationState: 'desktop:loops:getPublicationState',
  performLoopPublicationAction: 'desktop:loops:performPublicationAction',
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
  listCollaborationRooms: 'desktop:collaborationRoom:listRooms',
  getCollaborationRoomWorkspace: 'desktop:roomWorkspace:get',
  previewCollaborationRoomWorkspace: 'desktop:roomWorkspace:preview',
  commitCollaborationRoomWorkspace: 'desktop:roomWorkspace:commit',
  cancelCollaborationRoomWorkspaceChange: 'desktop:roomWorkspace:cancelChange',
  listCollaborationRoomWorkspaceFiles: 'desktop:roomWorkspace:listFiles',
  previewCollaborationRoomWorkspaceFile: 'desktop:roomWorkspace:previewFile',
  publishCollaborationRoomWorkspaceInstructions: 'desktop:roomWorkspace:publishInstructions',
  confirmCollaborationRoomWorkspaceArtifact: 'desktop:roomWorkspace:confirmArtifact',
  registerCollaborationRoomWorkspaceArtifact: 'desktop:roomWorkspace:registerArtifact',
  mapCollaborationRoomWorkspaceProject: 'desktop:roomWorkspace:mapProject',
  setCollaborationRoomLocalCommands: 'desktop:roomWorkspace:localCommands',
  retryCollaborationRoomWorkspaceChange: 'desktop:roomWorkspace:retryChange',
  getCollaborationRoom: 'desktop:collaborationRoom:getRoom',
  createCollaborationRoom: 'desktop:collaborationRoom:createRoom',
  archiveCollaborationRoom: 'desktop:collaborationRoom:archiveRoom',
  deleteCollaborationRoom: 'desktop:collaborationRoom:deleteRoom',
  updateCollaborationRoomMembers: 'desktop:collaborationRoom:updateMembers',
  sendCollaborationRoomMessage: 'desktop:collaborationRoom:sendMessage',
  markCollaborationRoomSeen: 'desktop:collaborationRoom:markSeen',
  cancelRoomDiscussion: 'desktop:collaborationRoom:cancelDiscussion',
  createProjectFromRoom: 'desktop:collaborationRoom:createProjectFromRoom',
  createTaskFromRoomMessage: 'desktop:collaborationRoom:createTaskFromRoomMessage',
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
  // Invoked by subscribeConversationActivities' disposer, not separate renderer methods.
  'desktop:activity:subscribe',
  'desktop:activity:overview',
  'desktop:activity:unsubscribe',
  // Task subscription cleanup is invoked only by the stream disposer.
  'desktop:unsubscribeTask',
  // Artifact editing handlers (ipc.ts:465-493) — predate the preload bridge
  // and are not currently called from renderer. Track them here until they're
  // either exposed or removed.
  'desktop:artifactBackup',
  'desktop:artifactRevert',
  'desktop:artifactCleanup',
  'desktop:artifactWatch',
  'desktop:artifactUnwatch',
];

export type DesktopModelProviderView = ModelProviderDTO.ModelProviderView;

export type DesktopModelEntryView = ModelProviderDTO.ModelEntryView;

export type DesktopProviderProfileView = ModelProviderDTO.ModelProviderProfileView;

export type DesktopModelConfigSnapshot = ModelProviderDTO.ModelConfigResult;

export type DesktopSaveModelConfigInput = ModelProviderDTO.SaveModelConfigInput;

export type DesktopUpdateModelRuntimeOptionsInput = ModelProviderDTO.UpdateModelRuntimeInput;

/**
 * TypeSafe System One（Jev）辅助决策模型配置快照。
 *
 * Jev 不是推理 provider：它不出现在 `providers` / `models` / `defaultModelId`
 * 里，所以单独走这一对 IPC。主进程只回传掩码，明文 Key 永不进入 renderer。
 */
export type DesktopSystemOneConfigSnapshot = ModelProviderDTO.SystemOneConfigResult;

/** `undefined` = 不变更，空串 = 清除该字段。 */
export type DesktopSaveSystemOneConfigInput = ModelProviderDTO.SystemOneConfigPatch;

export type AvailableModelView = ModelProviderDTO.AvailableModelResult;

export type TestProviderConnectionResult = ModelProviderDTO.ProviderConnectionResult;

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

export type DesktopMobileRelayCredentialState = MobileRelayStatusDto['credentialState'];
export type DesktopMobileRelayStatus = MobileRelayStatusDto;
export type DesktopMobilePairingInfo = MobilePairingInfoDto;

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

export type PluginMcpServerView = PluginMcpServerDto;
export type PluginDependencyStatusView = PluginDependencyStatusDto;

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

export type ReminderRecord = ScheduledReminderDto;

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

export type ConnectorsConfigSnapshot = ConnectorsSnapshotDto;


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
    desktopModelId: typeof candidate?.desktopModelId === 'string' || candidate?.desktopModelId === null ? candidate.desktopModelId : undefined,
    maxConcurrentTasks: candidate?.maxConcurrentTasks,
    fallbackToDesktopModel: typeof candidate?.fallbackToDesktopModel === 'boolean' ? candidate.fallbackToDesktopModel : undefined,
  });
  if (kind === 'agent-update') {
    const patch = input?.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
      ? sanitizeAgent(input.patch as Record<string, unknown>)
      : {};
    return { agentId: typeof input?.agentId === 'string' ? input.agentId : '', patch };
  }
  return sanitizeAgent(input);
}

export type AssistantOverviewView = AssistantOverviewDto;

export type ProjectTeamPlanItemView = ProjectTeamPlanItemDto;
export type ProjectTeamPlanView = ProjectTeamPlanDto;
export type ProjectTeamOperationView = ProjectTeamOperationDto;

export type CreateKSwarmProjectSemanticInput = KSwarmProjectCreateDto;
export type KSwarmAgentSemanticInput = KSwarmAgentCreateDto;

export interface DesktopGoalProjection {
  currentCompletion?: GoalCompletionObservation;
  state: GoalState;
  activation: GoalActivation;
  waitingReason?: 'waiting_children' | 'children_need_attention';
}

export interface DesktopGoalTaskPrepared {
  attachmentId: string;
  attachmentSource: GoalAttachmentSource;
  threadId: string;
  taskId: string;
  executionScope: GoalTurnExecutionScope;
  goalRef: { goalId: string; revision: number };
  expiresAt: number;
}

export interface DesktopGoalMutationResult {
  goal: DesktopGoalProjection;
  preparedTask: DesktopGoalTaskPrepared;
}

export interface DesktopGoalChangedEvent {
  threadId: string;
  goal: DesktopGoalProjection;
}

export interface DesktopApi extends MultiAgentDesktopAPI, RoomWorkspaceApi {
  getModelConfig(): Promise<DesktopModelConfigSnapshot>;
  saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot>;
  updateModelRuntimeOptions(input: DesktopUpdateModelRuntimeOptionsInput): Promise<DesktopModelConfigSnapshot>;
  getSystemOneConfig(): Promise<DesktopSystemOneConfigSnapshot>;
  saveSystemOneConfig(input?: DesktopSaveSystemOneConfigInput): Promise<DesktopSystemOneConfigSnapshot>;
  createManagedXiaokAgent(input: ModelProviderDTO.ManagedAgentInput): Promise<ModelProviderDTO.ManagedAgentResult>;
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
  prepareObservationTask(): Promise<{draftId:string;expiresAt:number;model:string}|null>;
  createObservationTask(input:{draftId:string;prompt:string;threadId?:string}): Promise<{taskId:string}>;
  stopObservationTask(taskId:string): Promise<{mode:string}>;
  revokeObservationTask(taskId:string): Promise<{mode:string}>;
  getObservationTaskStatus(taskId:string): Promise<{mode:string;semantic?:SemanticCompactionStatus;compound?:CompoundExecutionStatus}>;
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
  getGoal(threadId: string): Promise<DesktopGoalProjection | null>;
  getGoalNativeMutation(threadId: string): Promise<DesktopGoalNativeMutationProjection | null>;
  recoverGoalNativeMutation(input: { threadId: string }): Promise<{ mutation: DesktopGoalNativeMutationProjection; goal: DesktopGoalProjection | null }>;
  continueGoalNativeMutation(input: { threadId: string } & GoalAttachmentRequest): Promise<DesktopGoalMutationResult>;
  cancelGoalNativeMutation(input: { threadId: string }): Promise<DesktopGoalNativeMutationProjection>;
  createGoal(input: { threadId: string } & GoalCreationInput & GoalAttachmentRequest): Promise<DesktopGoalMutationResult>;
  pauseGoal(threadId: string): Promise<DesktopGoalProjection>;
  resumeGoal(input: { threadId: string; turnLimit?: number } & GoalAttachmentRequest): Promise<DesktopGoalMutationResult>;
  recoverGoalPublication(input: { threadId: string }): Promise<DesktopGoalProjection | null>;
  continueGoalPublication(input: { threadId: string }): Promise<DesktopGoalProjection | null>;
  cancelGoal(threadId: string): Promise<DesktopGoalProjection>;
  replaceGoal(input: { threadId: string } & GoalCreationInput & GoalAttachmentRequest): Promise<DesktopGoalMutationResult>;
  ackGoalTaskAttached(input: { threadId: string; attachmentId: string }): Promise<void>;
  setGoalUserQueuePending(input: { threadId: string; pending: boolean }): Promise<void>;
  onGoalChanged(handler: (input: DesktopGoalChangedEvent) => void): () => void;
  onGoalTaskPrepared(handler: (input: DesktopGoalTaskPrepared) => void): () => void;
  getConversationActivityUnread(): Promise<Array<{ threadId: string; count: number }>>;
  markConversationActivitiesRead(input: { threadId: string; throughLocalSeq: number }): Promise<void>;
  subscribeConversationActivityOverview(handler: (change: { threadId: string; watchId?: string }) => void): () => void;
  getConversationActivities(input: { threadId: string; afterLocalSeq?: number; limit?: number }): Promise<ConversationActivity[]>;
  subscribeConversationActivities(threadId: string, handler: (change: { threadId: string; watchId?: string }) => void): () => void;
  getWorkActivity(watchId: string): Promise<{ watch: WorkWatch; projection: WorkProjection }>;
  getMcpTaskInputs(watchId: string): Promise<McpInputForm[]>;
  answerMcpTaskInput(input: { watchId: string; inputId: string; expectedDigest: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }): Promise<void>;
  cancelMcpWork(watchId: string): Promise<{ requested: true }>;
  updateWorkReporting(input: { watchId: string; preference: ReportingPreference; expectedPolicyRevision: number }): Promise<WorkWatch>;
  stopWorkWatch(input: { watchId: string; expectedPolicyRevision: number }): Promise<WorkWatch>;
  subscribeTask(taskId: string, handler: (event: DesktopTaskEvent) => void, sinceIndex?: number): () => void;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getActiveTask(): Promise<{ taskId: string } | null>;
  recoverTask(taskId: string, legacyPrompt?: string): Promise<{ snapshot: TaskSnapshot; recoveredFromTaskId?: string }>;
  openArtifact(artifactId: string): Promise<void>;
  openFileInSystemApp(filePath: string): Promise<OpenFileResult>;
  readFileContent(filePath: string): Promise<ReadFileResult>;
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
  listAvailablePlugins(): Promise<AvailablePluginDto[]>;
  listPluginDependencyStatuses(): Promise<PluginDependencyStatusView[]>;
  installPluginDependency(input: PluginDependencyActionInput): Promise<PluginDependencyActionResult>;
  updatePluginDependency(input: PluginDependencyActionInput): Promise<PluginDependencyActionResult>;
  cancelPluginDependencyTask(input: Omit<PluginDependencyActionInput, 'confirmed'>): Promise<{ cancelling: boolean }>;
  diagnosePluginDependency(input: Omit<PluginDependencyActionInput, 'confirmed'>): Promise<PluginDependencyActionResult>;
  getUpdateStatus(): Promise<UpdateIpcStatusDto>;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): Promise<UpdateInstallDto>;
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  onSkillsChanged(handler: () => void): () => void;
  createReminder(input: { content: string; scheduleAt: number; timezone?: string }): Promise<ReminderRecord>;
  listReminders(): Promise<ReminderRecord[]>;
  cancelReminder(id: string): Promise<boolean>;
  getReminderStatus(): Promise<ScheduledReminderStatusDto>;
  onReminder(handler: (event: { reminderId: string; content: string; createdAt: number }) => void): () => void;
  getSkillDebugConfig(): Promise<{ enabled: boolean }>;
  saveSkillDebugConfig(input: { enabled: boolean }): Promise<{ enabled: boolean }>;
  getKswarmConfig(): Promise<{ maxConcurrentTasks: number }>;
  saveKswarmConfig(input: { maxConcurrentTasks: number }): Promise<{ maxConcurrentTasks: number }>;
  getSkillStats(): Promise<DesktopSkillStats[]>;
  getServiceStatus(): Promise<DesktopServiceStatusSnapshot>;
  restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void>;
  kswarmGetStatus(): Promise<KSwarmServiceStatus>;
  kswarmStart(): Promise<void>;
  kswarmStop(): Promise<void>;
  kswarmRestart(): Promise<void>;
  kswarmResumeWorkflowRun(input: { projectId: string; workflowRunId: string }): Promise<{ restored: boolean; reason?: string; jobId?: string }>;
  kswarmStartProjectPlanning(input: { projectId: string; projectName: string; goal: string; requirements: string; planningGuidance: string; poAgent: string; members: string[]; startPolicy?: 'plan_only' | 'auto_activate_after_plan' | 'activate_and_dispatch_after_plan' }): Promise<{ ok: boolean; status?: string; error?: string }>;
  getAssistantOverview(): Promise<AssistantOverviewView>;
  activateAssistant(): Promise<AssistantProfileDto>;
  pauseAssistant(): Promise<AssistantProfileDto>;
  resumeAssistant(): Promise<AssistantProfileDto>;
  acceptAssistantCandidate(input: { candidateId: string; collectionId?: string }): Promise<AssistantAcceptResultDto>;
  rejectAssistantCandidate(input: { candidateId: string }): Promise<AssistantCandidateDto>;
  planProjectTeam(input: { projectId: string }): Promise<ProjectTeamPlanView>;
  applyProjectTeamPlan(input: { projectId: string; planId: string; projectRevision: number }): Promise<ProjectTeamOperationView>;
  getProjectTeamOperation(input: { projectId: string }): Promise<ProjectTeamOperationView | null>;
  createKSwarmProject(input: CreateKSwarmProjectSemanticInput): Promise<KSwarmProjectFactDto>;
  updateKSwarmProjectExecutionMode(input: { projectId: string; executionMode: 'direct' | 'auto' | 'workflow_preferred' }): Promise<KSwarmProjectModeResultDto>;
  deleteKSwarmProject(input: { projectId: string }): Promise<KSwarmProjectDeleteResultDto>;
  createKSwarmAgent(input: KSwarmAgentSemanticInput): Promise<KSwarmAgentFactDto>;
  updateKSwarmAgent(input: { agentId: string; patch: Partial<KSwarmAgentSemanticInput> }): Promise<KSwarmAgentFactDto>;
  archiveKSwarmAgent(input: { agentId: string }): Promise<boolean>;
  startKSwarmAgent(input: { agentId: string }): Promise<boolean>;
  stopKSwarmAgent(input: { agentId: string }): Promise<boolean>;
  probeKSwarmAgent(input: { agentId: string }): Promise<KSwarmProbeFactDto>;
  onKSwarmStatus(handler: (status: KSwarmServiceStatus) => void): () => void;
  exportTraceBundle(input: DesktopTraceTarget): Promise<DesktopTraceExportResult>;
  diagnose(input: DesktopTraceTarget): Promise<DesktopDiagnosisReport>;
  getLoopDefinitions(): Promise<LoopDefinitionDto[]>;
  listUserLoopTemplates(): Promise<UserLoopTemplateDto[]>;
  createUserLoopTemplate(input: LoopCreateTemplateDto): Promise<CreateLoopTemplateResultDto>;
  updateUserLoopTemplate(loopId: string, patch?: LoopTemplatePatchDto | null): Promise<UserLoopTemplateDto | undefined>;
  deleteUserLoopTemplate(loopId: string): Promise<void>;
  clearLoopRunHistory(loopId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }>;
  createLoopSchedule(input: ScheduledLoopCreateDto): Promise<ScheduledActionDto>;
  getLoopScheduleBindings(): Promise<ScheduledBindingDto[]>;
  getAutomationOverviewSnapshot(): Promise<unknown>;
  getAutomationRunHistory(): Promise<AutomationRunHistoryDto[]>;
  getAutomationsConfig(): Promise<{ globalBackgroundAutoRunEnabled: boolean }>;
  setGlobalBackgroundAutoRun(input: { enabled: boolean }): Promise<{ globalBackgroundAutoRunEnabled: boolean }>;
  openLoopOutputDirectory(loopId: string): Promise<LoopOutputActionResultView>;
  readLoopOutputPreview(loopId: string): Promise<LoopOutputPreviewView>;
  readLoopTaskResult(loopId: string): Promise<LoopTaskResultView>;
  listLoopPublishedArtifacts(loopId:string,page:LoopArtifactPageRequest):Promise<LoopPublishedArtifactsView>;
  getLoopRuns(loopId: string): Promise<LoopRunObservationDto[]>;
  getLoopPublicationConfiguration(loopId:string):Promise<Readonly<StoredLoopPublicationConfigurationDto>|null>;
  getLoopPublicationState(runId:string):Promise<Readonly<LoopPublicationStateDto>>;
  performLoopPublicationAction(input:LoopPublicationActionDto):Promise<LoopPublicationActionResultDto>;
  getEvidenceAnomalies(loopId: string): Promise<LoopAnomalyDto[]>;
  runLoopNow(loopId: string): Promise<LoopManagementRunResultDto>;
  listLoopConstraints(loopId: string): Promise<LoopConstraintDto[]>;
  setLoopConstraintActive(constraintId: string, active: boolean): Promise<LoopConstraintDto | undefined>;
  confirmLoopConstraint(constraintId: string): Promise<LoopConstraintDto | undefined>;
  onLoopConstraintAdded(handler: (constraint: unknown) => void): () => void;
  syncScheduledTasks(tasks: Array<{ id: string; cronExpr: string; enabled: boolean }>): Promise<ScheduledTaskDto[]>;
  getScheduledTasks(): Promise<ScheduledTaskDto[]>;
  createScheduledTask(input: ScheduledCreateDto): Promise<ScheduledTaskDto>;
  updateScheduledTask(input: ScheduledUpdateDto): Promise<ScheduledUpdateResultDto>;
  setScheduledTaskStatus(id: string, status: 'active' | 'paused'): Promise<ScheduledTaskDto | null>;
  cancelScheduledTask(id: string): Promise<boolean>;
  getTimedActions(): Promise<ScheduledActionDto[]>;
  getTimedActionRuns(actionId: string): Promise<ScheduledRunDto[]>;
  approveTimedActionAuto(actionId: string): Promise<ScheduledActionDto | null>;
  revokeTimedActionAuto(actionId: string): Promise<ScheduledActionDto | null>;
  clearScheduledTaskRunHistory(actionId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }>;
  onScheduledTaskDue(handler: (event: { taskId: string; runtimeTaskId?: string; completed?: boolean; dispatchStatus?: 'success' | 'failed' | 'skipped'; runtimeState?: 'accepted' | 'not_started'; success?: boolean; title?: string; lastRunAt?: number; nextRunAt?: number; error?: string }) => void): () => void;
  listMemories(): Promise<MemoryIpcEntry[]>;
  createMemory(input: { content: string; tags: string[]; source?: string }): Promise<MemoryIpcEntry>;
  updateMemory(input: { id: string; content?: string; tags?: string[] }): Promise<MemoryIpcEntry>;
  deleteMemory(id: string): Promise<boolean>;
  importMemories(raw: string): Promise<MemoryImportIpcResult>;
  memoryStats(): Promise<MemoryStatsIpcSnapshot | null>;
  memoryCompact(): Promise<boolean>;
  memoryPersonaTraits(): Promise<MemoryPersonaIpcTrait[]>;
  memoryListLayer(layer: number, limit?: number, offset?: number): Promise<MemoryLayerIpcEntry[]>;
  memoryDeleteEntry(id: string, layer: number): Promise<boolean>;
  memoryClearAll(): Promise<boolean>;
  memoryGetModelId(): Promise<string | null>;
  memorySetModelId(modelId: string | null): Promise<boolean>;
  getEmbeddingModels(): Promise<EmbeddingModelIpcEntry[]>;
  downloadEmbeddingModel(modelId: string): Promise<void>;
  setEmbeddingModel(modelId: string): Promise<void>;
  getConnectorsConfig(): Promise<ConnectorsConfigSnapshot>;
  saveConnectorsConfig(input: ConnectorsConfig): Promise<ConnectorsConfigSnapshot>;
  listConnectorRuntimes(): Promise<ProviderRuntime[]>;
  testConnectorProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult>;

  // Knowledge Base
  kbListCollections(): Promise<KnowledgeCollectionDto[]>;
  kbCreateCollection(input: KnowledgeCreateCollectionInput): Promise<KnowledgeCollectionDto>;
  kbDeleteCollection(id: string): Promise<void>;
  kbListSources(collectionId: string): Promise<KnowledgeSourceDto[]>;
  kbAddSource(input: KnowledgeAddSourceInput): Promise<KnowledgeSourceDto>;
  kbDeleteSource(id: string): Promise<void>;
  kbGetCollectionState(collectionId: string): Promise<KnowledgeCollectionStateDto | undefined>;
  kbGetSourceContent(input?: KnowledgeSourceContentInput | null): Promise<KnowledgeSourceContentDto | undefined>;
  kbSearch(input?: KnowledgeSearchInput | null): Promise<KnowledgeSearchResultDto[]>;
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
  listCollaborationRooms(): Promise<RoomListResultDto>;
  getCollaborationRoom(roomId: string): Promise<RoomSnapshotDto>;
  createCollaborationRoom(input: RoomCreateInput): Promise<RoomCreateResultDto>;
  archiveCollaborationRoom(input: RoomArchiveInput): Promise<RoomArchiveResultDto>;
  deleteCollaborationRoom(input: RoomDeleteInput): Promise<RoomDeleteResultDto>;
  updateCollaborationRoomMembers(input: RoomMembersInput): Promise<RoomMembersResultDto>;
  sendCollaborationRoomMessage(input: RoomSendInput): Promise<RoomSendResultDto>;
  markCollaborationRoomSeen(input: RoomSeenInput): Promise<RoomSeenResultDto>;
  cancelRoomDiscussion(input: RoomCancelInput): Promise<RoomCancelResultDto>;
  createProjectFromRoom(input: RoomProjectCreateInput): Promise<RoomProjectCreateResultDto>;
  createTaskFromRoomMessage(input: RoomTaskCreateInput): Promise<RoomTaskCreateResultDto>;
  onCollaborationRoomEvent(listener: (event: unknown) => void): () => void;
  meetingOpenRecorderWindow(input: { collectionId: string }): Promise<RecorderWindowReply>;
  meetingSetRecorderWindowMode(input: { mode: 'workbench' | 'compact' | 'summary' }): Promise<RecorderWindowReply>;
  meetingSetRecorderSessionState(input: { state: 'idle' | 'recording' | 'processing' | 'summary' }): Promise<RecorderWindowReply>;
  meetingNotifyRecorderSummaryReady(input: { title: string }): Promise<RecorderWindowNotificationReply>;
  meetingNotifyRecordingSaved(input: { collectionId: string }): Promise<RecorderWindowReply>;
  meetingCloseRecorderWindow(): Promise<RecorderWindowReply>;
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
  getThreadLabels(): Promise<ThreadMetadataSnapshotDto>;
  setThreadLabel(threadId: string, label: string): Promise<ThreadMetaWriteResult>;
  unsetThreadLabel(threadId: string, label: string): Promise<ThreadMetaWriteResult>;
  moveThreadLabel(threadId: string, from: string, to: string): Promise<ThreadMetaWriteResult>;
  getAppFlag(key: AppFlagKey): Promise<string | null>;
  setAppFlag(key: AppFlagKey, value: string): Promise<ThreadMetaWriteResult>;
  migrateLegacyThreadMeta(data: ThreadMetaSnapshot): Promise<ThreadMetadataMigrationResultDto>;
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

export type ConnectorTestResult = ConnectorTestResultDto;

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

/** Route-aware own-data gateway; display facts never grant execution authority. */
export interface KSwarmProxyApi {
  kswarmProxyGet(path: string): Promise<ProxyJsonResult>;
  kswarmProxyGetText(path: string): Promise<ProxyTextResult>;
  kswarmProxyPost(path: string, body?: ProxyHttpBody): Promise<ProxyJsonResult>;
  kswarmProxyPostJson(path: string, body?: ProxyHttpBody): Promise<ProxyJsonResult>;
  kswarmProxyPut(path: string, body?: ProxyHttpBody): Promise<ProxyJsonResult>;
  kswarmProxyPatch(path: string, body?: ProxyHttpBody): Promise<ProxyJsonResult>;
  kswarmProxyDelete(path: string): Promise<ProxyDeleteResult>;
  kswarmStreamSubscribe(): Promise<ProxyStreamResult>;
  kswarmStreamUnsubscribe(): Promise<ProxyStreamResult>;
  kswarmStreamGetStatus(): Promise<ProxyStatusResult>;
  onKSwarmWsEvent(handler: (event: unknown) => void): () => void;
  onKSwarmConnectionStatus(handler: (status: unknown) => void): () => void;
  connectionHealthz(url: string): Promise<ProxyHealthResult>;
  connectionHealth(url: string): Promise<ProxyHealthResult>;
}

/**
 * systemUsername is a snapshot from preload execution time and does not reflect
 * runtime user switching. Use only for UI display; path construction or
 * permission checks should use IPC real-time queries.
 */
export type FullDesktopApi = DesktopApi & KSwarmProxyApi & {
  showSaveDialog(input: ShowSaveDialogInput): Promise<ShowSaveDialogResult>;
  saveFile(input: SaveFileInput): Promise<SaveFileResult>;
  listPrinciples(): Promise<ProjectPrincipleDto[]>;
  savePrinciple(principle: PrincipleSaveInput): Promise<PrincipleSaveResult>;
  deletePrinciple(id: string): Promise<PrincipleDeleteResult>;
  systemUsername: string;
};

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createPreloadApi(ipcRenderer: IpcRendererLike, systemUsername = ''): FullDesktopApi {
  return {
    ...createMultiAgentPreload(ipcRenderer),
    getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig') as ReturnType<DesktopApi['getModelConfig']>,
    saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input) as ReturnType<DesktopApi['saveModelConfig']>,
    updateModelRuntimeOptions: (input) => ipcRenderer.invoke('desktop:updateModelRuntimeOptions', input) as ReturnType<DesktopApi['updateModelRuntimeOptions']>,
    getSystemOneConfig: () => ipcRenderer.invoke('desktop:getSystemOneConfig') as ReturnType<DesktopApi['getSystemOneConfig']>,
    saveSystemOneConfig: (input) => ipcRenderer.invoke('desktop:saveSystemOneConfig', input) as ReturnType<DesktopApi['saveSystemOneConfig']>,
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
    prepareObservationTask: () => ipcRenderer.invoke('desktop:prepareObservationTask') as ReturnType<DesktopApi['prepareObservationTask']>,
    createObservationTask: input => ipcRenderer.invoke('desktop:createObservationTask',input) as ReturnType<DesktopApi['createObservationTask']>,
    stopObservationTask: taskId => ipcRenderer.invoke('desktop:stopObservationTask',{taskId}) as ReturnType<DesktopApi['stopObservationTask']>,
    revokeObservationTask: taskId => ipcRenderer.invoke('desktop:revokeObservationTask',{taskId}) as ReturnType<DesktopApi['revokeObservationTask']>,
    getObservationTaskStatus: taskId => ipcRenderer.invoke('desktop:getObservationTaskStatus',{taskId}) as ReturnType<DesktopApi['getObservationTaskStatus']>,
    createTask: (input) => ipcRenderer.invoke('desktop:createTask', input) as ReturnType<DesktopApi['createTask']>,
    createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input) as ReturnType<DesktopApi['createTaskWithFiles']>,
    getGoal: (threadId) => ipcRenderer.invoke('desktop:goal:get', { threadId }) as ReturnType<DesktopApi['getGoal']>,
    getGoalNativeMutation: (threadId) => ipcRenderer.invoke('desktop:goal:getNativeMutation', { threadId }) as ReturnType<DesktopApi['getGoalNativeMutation']>,
    recoverGoalNativeMutation: (input) => ipcRenderer.invoke('desktop:goal:recoverNativeMutation', input) as ReturnType<DesktopApi['recoverGoalNativeMutation']>,
    continueGoalNativeMutation: (input) => ipcRenderer.invoke('desktop:goal:continueNativeMutation', input) as ReturnType<DesktopApi['continueGoalNativeMutation']>,
    cancelGoalNativeMutation: (input) => ipcRenderer.invoke('desktop:goal:cancelNativeMutation', input) as ReturnType<DesktopApi['cancelGoalNativeMutation']>,
    createGoal: (input) => ipcRenderer.invoke('desktop:goal:create', input) as ReturnType<DesktopApi['createGoal']>,
    pauseGoal: (threadId) => ipcRenderer.invoke('desktop:goal:pause', { threadId }) as ReturnType<DesktopApi['pauseGoal']>,
    resumeGoal: (input) => ipcRenderer.invoke('desktop:goal:resume', input) as ReturnType<DesktopApi['resumeGoal']>,
    recoverGoalPublication: input => ipcRenderer.invoke('desktop:goal:recoverPublication', input) as ReturnType<DesktopApi['recoverGoalPublication']>,
    continueGoalPublication: input => ipcRenderer.invoke('desktop:goal:continuePublication', input) as ReturnType<DesktopApi['continueGoalPublication']>,
    cancelGoal: (threadId) => ipcRenderer.invoke('desktop:goal:cancel', { threadId }) as ReturnType<DesktopApi['cancelGoal']>,
    replaceGoal: (input) => ipcRenderer.invoke('desktop:goal:replace', input) as ReturnType<DesktopApi['replaceGoal']>,
    ackGoalTaskAttached: (input) => ipcRenderer.invoke('desktop:goal:ackTaskAttached', input) as Promise<void>,
    setGoalUserQueuePending: (input) => ipcRenderer.invoke('desktop:goal:setUserQueuePending', input) as Promise<void>,
    onGoalChanged(handler) {
      const listener = (_event: unknown, payload: unknown) => handler(payload as DesktopGoalChangedEvent);
      ipcRenderer.on('desktop:goal:changed', listener);
      return () => ipcRenderer.off('desktop:goal:changed', listener);
    },
    onGoalTaskPrepared(handler) {
      const listener = (_event: unknown, payload: unknown) => handler(payload as DesktopGoalTaskPrepared);
      ipcRenderer.on('desktop:goal:taskPrepared', listener);
      return () => ipcRenderer.off('desktop:goal:taskPrepared', listener);
    },
    getConversationActivityUnread: () => ipcRenderer.invoke('desktop:activity:unread') as Promise<Array<{ threadId: string; count: number }>>,
    markConversationActivitiesRead: input => ipcRenderer.invoke('desktop:activity:read', input) as Promise<void>,
    subscribeConversationActivityOverview(handler) {
      const subscriptionId = `overview-${Date.now()}-${Math.random()}`;
      const listener = (_event: unknown, payload: unknown) => { const data = payload as { threadId?: unknown; watchId?: unknown } | null; if (typeof data?.threadId === 'string') handler({ threadId: data.threadId, ...(typeof data.watchId === 'string' ? { watchId: data.watchId } : {}) }); };
      ipcRenderer.on('desktop:activity:changed', listener);
      void ipcRenderer.invoke('desktop:activity:overview', { subscriptionId }).catch(() => undefined);
      return () => { ipcRenderer.off('desktop:activity:changed', listener); void ipcRenderer.invoke('desktop:activity:unsubscribe', { subscriptionId }).catch(() => undefined); };
    },
    getConversationActivities: input => ipcRenderer.invoke('desktop:activity:list', input) as Promise<ConversationActivity[]>,
    getWorkActivity: watchId => ipcRenderer.invoke('desktop:activity:work', { watchId }) as Promise<{ watch: WorkWatch; projection: WorkProjection }>,
    getMcpTaskInputs: watchId => ipcRenderer.invoke('desktop:activity:mcpInputs', { watchId }) as Promise<McpInputForm[]>,
    answerMcpTaskInput: input => ipcRenderer.invoke('desktop:activity:mcpAnswer', input) as Promise<void>,
    cancelMcpWork: watchId => ipcRenderer.invoke('desktop:activity:mcpCancel', { watchId }) as Promise<{ requested: true }>,
    updateWorkReporting: input => ipcRenderer.invoke('desktop:activity:reporting', input) as Promise<WorkWatch>,
    stopWorkWatch: input => ipcRenderer.invoke('desktop:activity:stop', input) as Promise<WorkWatch>,
    subscribeConversationActivities(threadId, handler) {
      const subscriptionId = `activity-${Date.now()}-${Math.random()}`;
      const listener = (_event: unknown, payload: unknown) => { const data = payload as { threadId?: unknown; watchId?: unknown } | null; if (data?.threadId === threadId) handler({ threadId, ...(typeof data.watchId === 'string' ? { watchId: data.watchId } : {}) }); };
      ipcRenderer.on('desktop:activity:changed', listener);
      let live = true;
      void ipcRenderer.invoke('desktop:activity:subscribe', { threadId, subscriptionId }).then(() => { if (live) handler({ threadId }); }).catch(() => undefined);
      return () => { live = false; ipcRenderer.off('desktop:activity:changed', listener); void ipcRenderer.invoke('desktop:activity:unsubscribe', { subscriptionId }).catch(() => undefined); };
    },
    subscribeTask(taskId, handler, sinceIndex) {
      const subscriptionId = `task-${Date.now()}-${Math.random()}`;
      const channel = `desktop:taskEvent:${taskId}`;
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as DesktopTaskEvent);
      };
      ipcRenderer.on(channel, listener);
      const registration = ipcRenderer.invoke('desktop:subscribeTask', typeof sinceIndex === 'number' ? { taskId, sinceIndex, subscriptionId } : { taskId, subscriptionId }).catch(() => undefined);
      return () => {
        ipcRenderer.off(channel, listener);
        void registration.then(() => ipcRenderer.invoke('desktop:unsubscribeTask', { taskId, subscriptionId })).catch(() => undefined);
      };
    },
    answerQuestion: (input) => ipcRenderer.invoke('desktop:answerQuestion', input) as Promise<void>,
    cancelTask: (taskId) => ipcRenderer.invoke('desktop:cancelTask', { taskId }) as Promise<void>,
    getActiveTask: () => ipcRenderer.invoke('desktop:getActiveTask') as ReturnType<DesktopApi['getActiveTask']>,
    recoverTask: (taskId, legacyPrompt) => ipcRenderer.invoke('desktop:recoverTask', { taskId, legacyPrompt }) as ReturnType<DesktopApi['recoverTask']>,
    openArtifact: (artifactId) => ipcRenderer.invoke('desktop:openArtifact', { artifactId }) as Promise<void>,
    openFileInSystemApp: (filePath) => ipcRenderer.invoke('desktop:openFileInSystemApp', { filePath }) as Promise<OpenFileResult>,
    readFileContent: (filePath) => ipcRenderer.invoke('desktop:readFileContent', { filePath }) as Promise<ReadFileResult>,
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
    listAvailablePlugins: () => ipcRenderer.invoke('desktop:listAvailablePlugins') as Promise<AvailablePluginDto[]>,
    listPluginDependencyStatuses: () => ipcRenderer.invoke('desktop:listPluginDependencyStatuses') as Promise<PluginDependencyStatusView[]>,
    installPluginDependency: (input) => ipcRenderer.invoke('desktop:installPluginDependency', input) as Promise<PluginDependencyActionResult>,
    updatePluginDependency: (input) => ipcRenderer.invoke('desktop:updatePluginDependency', input) as Promise<PluginDependencyActionResult>,
    cancelPluginDependencyTask: (input) => ipcRenderer.invoke('desktop:cancelPluginDependencyTask', input) as Promise<{ cancelling: boolean }>,
    diagnosePluginDependency: (input) => ipcRenderer.invoke('desktop:diagnosePluginDependency', input) as Promise<PluginDependencyActionResult>,
    getUpdateStatus: () => ipcRenderer.invoke('desktop:getUpdateStatus') as Promise<UpdateIpcStatusDto>,
    checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates') as Promise<void>,
    quitAndInstall: () => ipcRenderer.invoke('desktop:quitAndInstall') as Promise<UpdateInstallDto>,
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
    getReminderStatus: () => ipcRenderer.invoke('desktop:getReminderStatus') as Promise<ScheduledReminderStatusDto>,
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
    activateAssistant: () => ipcRenderer.invoke('desktop:assistant:activate') as ReturnType<DesktopApi['activateAssistant']>,
    pauseAssistant: () => ipcRenderer.invoke('desktop:assistant:pause') as ReturnType<DesktopApi['pauseAssistant']>,
    resumeAssistant: () => ipcRenderer.invoke('desktop:assistant:resume') as ReturnType<DesktopApi['resumeAssistant']>,
    acceptAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:acceptCandidate', sanitizeAssistantCandidateInput(input)) as ReturnType<DesktopApi['acceptAssistantCandidate']>,
    rejectAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:rejectCandidate', sanitizeAssistantCandidateInput(input)) as ReturnType<DesktopApi['rejectAssistantCandidate']>,
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
    ) as ReturnType<DesktopApi['createKSwarmProject']>,
    updateKSwarmProjectExecutionMode: (input) => ipcRenderer.invoke(
      'desktop:kswarm:project:updateExecutionMode',
      sanitizeKSwarmSemanticInput('project-execution-mode', input),
    ) as ReturnType<DesktopApi['updateKSwarmProjectExecutionMode']>,
    deleteKSwarmProject: (input) => ipcRenderer.invoke(
      'desktop:kswarm:project:delete',
      sanitizeKSwarmSemanticInput('project-delete', input),
    ) as ReturnType<DesktopApi['deleteKSwarmProject']>,
    createKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:create',
      sanitizeKSwarmSemanticInput('agent-create', input as unknown as Record<string, unknown>),
    ) as ReturnType<DesktopApi['createKSwarmAgent']>,
    updateKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:update',
      sanitizeKSwarmSemanticInput('agent-update', input),
    ) as ReturnType<DesktopApi['updateKSwarmAgent']>,
    archiveKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:archive',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ) as ReturnType<DesktopApi['archiveKSwarmAgent']>,
    startKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:start',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ) as ReturnType<DesktopApi['startKSwarmAgent']>,
    stopKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:stop',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ) as ReturnType<DesktopApi['stopKSwarmAgent']>,
    probeKSwarmAgent: (input) => ipcRenderer.invoke(
      'desktop:kswarm:agent:probe',
      sanitizeKSwarmSemanticInput('agent-id', input),
    ) as ReturnType<DesktopApi['probeKSwarmAgent']>,
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
    exportTraceBundle: (input) => ipcRenderer.invoke('desktop:trace:export', input) as Promise<DesktopTraceExportResult>,
    diagnose: (input) => ipcRenderer.invoke('desktop:diagnose', input) as Promise<DesktopDiagnosisReport>,
    getLoopDefinitions: () => ipcRenderer.invoke('desktop:loops:listDefinitions') as Promise<LoopDefinitionDto[]>,
    listUserLoopTemplates: () => ipcRenderer.invoke('desktop:loops:listUserTemplates') as Promise<UserLoopTemplateDto[]>,
    createUserLoopTemplate: (input) => ipcRenderer.invoke('desktop:loops:createUserTemplate', input) as Promise<CreateLoopTemplateResultDto>,
    updateUserLoopTemplate: (loopId, patch) => ipcRenderer.invoke('desktop:loops:updateUserTemplate', loopId, patch) as Promise<UserLoopTemplateDto | undefined>,
    deleteUserLoopTemplate: (loopId) => ipcRenderer.invoke('desktop:loops:deleteUserTemplate', loopId) as Promise<void>,
    clearLoopRunHistory: (loopId, statuses) => ipcRenderer.invoke('desktop:loops:clearRunHistory', loopId, statuses) as Promise<{ ok: boolean; removed: number }>,
    createLoopSchedule: (input) => ipcRenderer.invoke('desktop:loops:createSchedule', input) as Promise<ScheduledActionDto>,
    getLoopScheduleBindings: () => ipcRenderer.invoke('desktop:loops:getScheduleBindings') as Promise<ScheduledBindingDto[]>,
    getAutomationOverviewSnapshot: () => ipcRenderer.invoke('desktop:automations:getOverviewSnapshot') as Promise<unknown>,
    getAutomationRunHistory: () => ipcRenderer.invoke('desktop:automations:getRunHistory') as Promise<AutomationRunHistoryDto[]>,
    getAutomationsConfig: () => ipcRenderer.invoke('desktop:automations:getConfig') as Promise<{ globalBackgroundAutoRunEnabled: boolean }>,
    setGlobalBackgroundAutoRun: (input) => ipcRenderer.invoke('desktop:automations:setGlobalBackgroundAutoRun', input) as Promise<{ globalBackgroundAutoRunEnabled: boolean }>,
    openLoopOutputDirectory: (loopId) => ipcRenderer.invoke('desktop:loops:openOutputDirectory', loopId) as Promise<LoopOutputActionResultView>,
    readLoopOutputPreview: (loopId) => ipcRenderer.invoke('desktop:loops:readOutputPreview', loopId) as Promise<LoopOutputPreviewView>,
    listLoopPublishedArtifacts: (loopId,page) => ipcRenderer.invoke('desktop:loops:listPublishedArtifacts',loopId,page) as Promise<LoopPublishedArtifactsView>,
    readLoopTaskResult: (loopId) => ipcRenderer.invoke('desktop:loops:readTaskResult', loopId) as Promise<LoopTaskResultView>,
    getLoopRuns: (loopId) => ipcRenderer.invoke('desktop:loops:listRuns', loopId) as Promise<LoopRunObservationDto[]>,
    getLoopPublicationConfiguration: loopId => ipcRenderer.invoke('desktop:loops:getPublicationConfiguration',loopId) as Promise<StoredLoopPublicationConfigurationDto|null>,
    getLoopPublicationState: runId => ipcRenderer.invoke('desktop:loops:getPublicationState',runId) as Promise<LoopPublicationStateDto>,
    performLoopPublicationAction: input => ipcRenderer.invoke('desktop:loops:performPublicationAction',input) as Promise<LoopPublicationActionResultDto>,
    getEvidenceAnomalies: (loopId) => ipcRenderer.invoke('desktop:loops:listAnomalies', loopId) as Promise<LoopAnomalyDto[]>,
    runLoopNow: (loopId) => ipcRenderer.invoke('desktop:loops:runNow', loopId) as Promise<LoopManagementRunResultDto>,
    listLoopConstraints: (loopId) => ipcRenderer.invoke('desktop:loops:listConstraints', loopId) as Promise<LoopConstraintDto[]>,
    setLoopConstraintActive: (constraintId, active) => ipcRenderer.invoke('desktop:loops:setConstraintActive', constraintId, active) as Promise<LoopConstraintDto | undefined>,
    confirmLoopConstraint: (constraintId) => ipcRenderer.invoke('desktop:loops:confirmConstraint', constraintId) as Promise<LoopConstraintDto | undefined>,
    syncScheduledTasks: (tasks) => ipcRenderer.invoke('desktop:syncScheduledTasks', tasks) as Promise<ScheduledTaskDto[]>,
    getScheduledTasks: () => ipcRenderer.invoke('desktop:getScheduledTasks') as Promise<ScheduledTaskDto[]>,
    createScheduledTask: (input) => ipcRenderer.invoke('desktop:createScheduledTask', input) as Promise<ScheduledTaskDto>,
    updateScheduledTask: (input) => ipcRenderer.invoke('desktop:updateScheduledTask', input) as Promise<ScheduledUpdateResultDto>,
    setScheduledTaskStatus: (id, status) => ipcRenderer.invoke('desktop:setScheduledTaskStatus', id, status) as Promise<ScheduledTaskDto | null>,
    cancelScheduledTask: (id) => ipcRenderer.invoke('desktop:cancelScheduledTask', id) as Promise<boolean>,
    getTimedActions: () => ipcRenderer.invoke('desktop:getTimedActions') as Promise<ScheduledActionDto[]>,
    getTimedActionRuns: (actionId) => ipcRenderer.invoke('desktop:getTimedActionRuns', actionId) as Promise<ScheduledRunDto[]>,
    approveTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:approveAuto', actionId) as Promise<ScheduledActionDto | null>,
    revokeTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:revokeAuto', actionId) as Promise<ScheduledActionDto | null>,
    clearScheduledTaskRunHistory: (actionId, statuses) => ipcRenderer.invoke('desktop:scheduledTasks:clearRunHistory', actionId, statuses) as Promise<{ ok: boolean; removed: number }>,
    onScheduledTaskDue(handler) {
      const channel = 'desktop:scheduledTaskDue';
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as { taskId: string; runtimeTaskId?: string; completed?: boolean; dispatchStatus?: 'success' | 'failed' | 'skipped'; runtimeState?: 'accepted' | 'not_started'; success?: boolean; title?: string; lastRunAt?: number; nextRunAt?: number; error?: string });
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
    listMemories: () => ipcRenderer.invoke('desktop:listMemories') as Promise<MemoryIpcEntry[]>,
    createMemory: (input) => ipcRenderer.invoke('desktop:createMemory', input) as Promise<MemoryIpcEntry>,
    updateMemory: (input) => ipcRenderer.invoke('desktop:updateMemory', input) as Promise<MemoryIpcEntry>,
    deleteMemory: (id) => ipcRenderer.invoke('desktop:deleteMemory', id) as Promise<boolean>,
    importMemories: (items) => ipcRenderer.invoke('desktop:importMemories', items) as Promise<MemoryImportIpcResult>,
    memoryStats: () => ipcRenderer.invoke('desktop:memoryStats') as Promise<MemoryStatsIpcSnapshot | null>,
    memoryCompact: () => ipcRenderer.invoke('desktop:memoryCompact') as Promise<boolean>,
    memoryPersonaTraits: () => ipcRenderer.invoke('desktop:memoryPersonaTraits') as Promise<MemoryPersonaIpcTrait[]>,
    memoryListLayer: (layer: number, limit?: number, offset?: number) => ipcRenderer.invoke('desktop:memoryListLayer', layer, limit, offset) as Promise<MemoryLayerIpcEntry[]>,
    memoryDeleteEntry: (id: string, layer: number) => ipcRenderer.invoke('desktop:memoryDeleteEntry', id, layer) as Promise<boolean>,
    memoryClearAll: () => ipcRenderer.invoke('desktop:memoryClearAll') as Promise<boolean>,
    memoryGetModelId: () => ipcRenderer.invoke('desktop:memoryGetModelId') as Promise<string | null>,
    memorySetModelId: (modelId: string | null) => ipcRenderer.invoke('desktop:memorySetModelId', modelId) as Promise<boolean>,
    getEmbeddingModels: () => ipcRenderer.invoke('desktop:getEmbeddingModels') as ReturnType<DesktopApi['getEmbeddingModels']>,
    downloadEmbeddingModel: (modelId: string) => ipcRenderer.invoke('desktop:downloadEmbeddingModel', modelId) as Promise<void>,
    setEmbeddingModel: (modelId: string) => ipcRenderer.invoke('desktop:setEmbeddingModel', modelId) as Promise<void>,
    getConnectorsConfig: () => ipcRenderer.invoke('desktop:getConnectorsConfig') as Promise<ConnectorsConfigSnapshot>,
    saveConnectorsConfig: (input) => ipcRenderer.invoke('desktop:saveConnectorsConfig', input) as Promise<ConnectorsConfigSnapshot>,
    listConnectorRuntimes: () => ipcRenderer.invoke('desktop:listConnectorRuntimes') as Promise<ProviderRuntime[]>,
    testConnectorProvider: (kind) => ipcRenderer.invoke('desktop:testConnectorProvider', kind) as Promise<ConnectorTestResult>,
    kbListCollections: () => ipcRenderer.invoke('desktop:kb:listCollections') as Promise<KnowledgeCollectionDto[]>,
    kbCreateCollection: (input) => ipcRenderer.invoke('desktop:kb:createCollection', input) as Promise<KnowledgeCollectionDto>,
    kbDeleteCollection: (id) => ipcRenderer.invoke('desktop:kb:deleteCollection', id) as Promise<void>,
    kbListSources: (collectionId) => ipcRenderer.invoke('desktop:kb:listSources', collectionId) as Promise<KnowledgeSourceDto[]>,
    kbAddSource: (input) => ipcRenderer.invoke('desktop:kb:addSource', input) as Promise<KnowledgeSourceDto>,
    kbDeleteSource: (id) => ipcRenderer.invoke('desktop:kb:deleteSource', id) as Promise<void>,
    kbGetCollectionState: (collectionId) => ipcRenderer.invoke('desktop:kb:getCollectionState', collectionId) as Promise<KnowledgeCollectionStateDto | undefined>,
    kbGetSourceContent: (input) => ipcRenderer.invoke('desktop:kb:getSourceContent', input) as Promise<KnowledgeSourceContentDto | undefined>,
    kbSearch: (input) => ipcRenderer.invoke('desktop:kb:search', input) as Promise<KnowledgeSearchResultDto[]>,
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
    listCollaborationRooms: () => ipcRenderer.invoke('desktop:collaborationRoom:listRooms') as ReturnType<DesktopApi['listCollaborationRooms']>,
    getCollaborationRoomWorkspace: (input) => ipcRenderer.invoke('desktop:roomWorkspace:get', input) as ReturnType<RoomWorkspaceApi['getCollaborationRoomWorkspace']>,
    previewCollaborationRoomWorkspace: (input) => ipcRenderer.invoke('desktop:roomWorkspace:preview', input) as ReturnType<RoomWorkspaceApi['previewCollaborationRoomWorkspace']>,
    commitCollaborationRoomWorkspace: (input) => ipcRenderer.invoke('desktop:roomWorkspace:commit', input) as ReturnType<RoomWorkspaceApi['commitCollaborationRoomWorkspace']>,
    cancelCollaborationRoomWorkspaceChange: (input) => ipcRenderer.invoke('desktop:roomWorkspace:cancelChange', input) as ReturnType<RoomWorkspaceApi['cancelCollaborationRoomWorkspaceChange']>,
    listCollaborationRoomWorkspaceFiles: (input) => ipcRenderer.invoke('desktop:roomWorkspace:listFiles', input) as ReturnType<RoomWorkspaceApi['listCollaborationRoomWorkspaceFiles']>,
    previewCollaborationRoomWorkspaceFile: (input) => ipcRenderer.invoke('desktop:roomWorkspace:previewFile', input) as ReturnType<RoomWorkspaceApi['previewCollaborationRoomWorkspaceFile']>,
    publishCollaborationRoomWorkspaceInstructions: (input) => ipcRenderer.invoke('desktop:roomWorkspace:publishInstructions', input) as ReturnType<RoomWorkspaceApi['publishCollaborationRoomWorkspaceInstructions']>,
    confirmCollaborationRoomWorkspaceArtifact: (input) => ipcRenderer.invoke('desktop:roomWorkspace:confirmArtifact', input) as ReturnType<RoomWorkspaceApi['confirmCollaborationRoomWorkspaceArtifact']>,
    registerCollaborationRoomWorkspaceArtifact: (input) => ipcRenderer.invoke('desktop:roomWorkspace:registerArtifact', input) as ReturnType<RoomWorkspaceApi['registerCollaborationRoomWorkspaceArtifact']>,
    mapCollaborationRoomWorkspaceProject: (input) => ipcRenderer.invoke('desktop:roomWorkspace:mapProject', input) as ReturnType<RoomWorkspaceApi['mapCollaborationRoomWorkspaceProject']>,
    setCollaborationRoomLocalCommands: (input) => ipcRenderer.invoke('desktop:roomWorkspace:localCommands', input) as ReturnType<RoomWorkspaceApi['setCollaborationRoomLocalCommands']>,
    retryCollaborationRoomWorkspaceChange: (input) => ipcRenderer.invoke('desktop:roomWorkspace:retryChange', input) as ReturnType<RoomWorkspaceApi['retryCollaborationRoomWorkspaceChange']>,
    getCollaborationRoom: (roomId: string) => ipcRenderer.invoke('desktop:collaborationRoom:getRoom', roomId) as ReturnType<DesktopApi['getCollaborationRoom']>,
    createCollaborationRoom: (input: RoomCreateInput) => ipcRenderer.invoke('desktop:collaborationRoom:createRoom', input) as ReturnType<DesktopApi['createCollaborationRoom']>,
    deleteCollaborationRoom: (input: RoomDeleteInput) => ipcRenderer.invoke('desktop:collaborationRoom:deleteRoom', input) as ReturnType<DesktopApi['deleteCollaborationRoom']>,
    archiveCollaborationRoom: (input: RoomArchiveInput) => ipcRenderer.invoke('desktop:collaborationRoom:archiveRoom', input) as ReturnType<DesktopApi['archiveCollaborationRoom']>,
    updateCollaborationRoomMembers: (input: RoomMembersInput) => ipcRenderer.invoke('desktop:collaborationRoom:updateMembers', input) as ReturnType<DesktopApi['updateCollaborationRoomMembers']>,
    sendCollaborationRoomMessage: (input: RoomSendInput) => ipcRenderer.invoke('desktop:collaborationRoom:sendMessage', input) as ReturnType<DesktopApi['sendCollaborationRoomMessage']>,
    markCollaborationRoomSeen: (input: RoomSeenInput) => ipcRenderer.invoke('desktop:collaborationRoom:markSeen', input) as ReturnType<DesktopApi['markCollaborationRoomSeen']>,
    cancelRoomDiscussion: (input: RoomCancelInput) => ipcRenderer.invoke('desktop:collaborationRoom:cancelDiscussion', input) as ReturnType<DesktopApi['cancelRoomDiscussion']>,
    createProjectFromRoom: (input: RoomProjectCreateInput) => ipcRenderer.invoke('desktop:collaborationRoom:createProjectFromRoom', input) as ReturnType<DesktopApi['createProjectFromRoom']>,
    createTaskFromRoomMessage: (input: RoomTaskCreateInput) => ipcRenderer.invoke('desktop:collaborationRoom:createTaskFromRoomMessage', input) as ReturnType<DesktopApi['createTaskFromRoomMessage']>,
    onCollaborationRoomEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on('desktop:collaborationRoom:event', handler as never);
      return () => {
        ipcRenderer.off?.('desktop:collaborationRoom:event', handler as never);
      };
    },
    meetingOpenRecorderWindow: (input) => ipcRenderer.invoke('desktop:meetingOpenRecorderWindow', input) as Promise<RecorderWindowReply>,
    meetingSetRecorderWindowMode: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderWindowMode', input) as Promise<RecorderWindowReply>,
    meetingSetRecorderSessionState: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderSessionState', input) as Promise<RecorderWindowReply>,
    meetingNotifyRecorderSummaryReady: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecorderSummaryReady', input) as Promise<RecorderWindowNotificationReply>,
    meetingNotifyRecordingSaved: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecordingSaved', input) as Promise<RecorderWindowReply>,
    meetingCloseRecorderWindow: () => ipcRenderer.invoke('desktop:meetingCloseRecorderWindow') as Promise<RecorderWindowReply>,
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
    getThreadLabels: () => ipcRenderer.invoke('desktop:getThreadLabels') as Promise<ThreadMetadataSnapshotDto>,
    setThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:setThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    unsetThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:unsetThreadLabel', threadId, label) as Promise<ThreadMetaWriteResult>,
    moveThreadLabel: (threadId, from, to) => ipcRenderer.invoke('desktop:moveThreadLabel', threadId, from, to) as Promise<ThreadMetaWriteResult>,
    getAppFlag: (key) => ipcRenderer.invoke('desktop:getAppFlag', key) as Promise<string | null>,
    setAppFlag: (key, value) => ipcRenderer.invoke('desktop:setAppFlag', key, value) as Promise<ThreadMetaWriteResult>,
    migrateLegacyThreadMeta: (data) => ipcRenderer.invoke('desktop:migrateLegacyThreadMeta', data) as Promise<ThreadMetadataMigrationResultDto>,
    showSaveDialog: (input) => ipcRenderer.invoke('desktop:showSaveDialog', input) as Promise<ShowSaveDialogResult>,
    saveFile: (input) => ipcRenderer.invoke('desktop:saveFile', input) as Promise<SaveFileResult>,
    listPrinciples: () => ipcRenderer.invoke('desktop:listPrinciples') as Promise<ProjectPrincipleDto[]>,
    savePrinciple: (principle) => ipcRenderer.invoke('desktop:savePrinciple', principle) as Promise<PrincipleSaveResult>,
    deletePrinciple: (id) => ipcRenderer.invoke('desktop:deletePrinciple', id) as Promise<PrincipleDeleteResult>,
    kswarmProxyGet: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:get', path) as Promise<ProxyJsonResult>,
    kswarmProxyGetText: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:getText', path) as Promise<ProxyTextResult>,
    kswarmProxyPost: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:post', path, body) as Promise<ProxyJsonResult>,
    kswarmProxyPostJson: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:postJson', path, body) as Promise<ProxyJsonResult>,
    kswarmProxyPut: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:put', path, body) as Promise<ProxyJsonResult>,
    kswarmProxyPatch: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:patch', path, body) as Promise<ProxyJsonResult>,
    kswarmProxyDelete: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:delete', path) as Promise<ProxyDeleteResult>,
    kswarmStreamSubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:subscribe') as Promise<ProxyStreamResult>,
    kswarmStreamUnsubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:unsubscribe') as Promise<ProxyStreamResult>,
    kswarmStreamGetStatus: () => ipcRenderer.invoke('desktop:kswarm:stream:status') as Promise<ProxyStatusResult>,
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
    connectionHealthz: (url) => ipcRenderer.invoke('desktop:connection:healthz', url) as Promise<ProxyHealthResult>,
    connectionHealth: (url) => ipcRenderer.invoke('desktop:connection:health', url) as Promise<ProxyHealthResult>,
    systemUsername,
  };
}

export type { IpcRenderer };
