const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

function sanitizeArtifactWorkspaceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { requestSource: _requestSource, viewKey: _viewKey, ...safe } = input;
  return safe;
}

function pickDefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function sanitizeAssistantCandidateInput(input) {
  return pickDefined({
    candidateId: typeof input?.candidateId === 'string' ? input.candidateId : '',
    collectionId: typeof input?.collectionId === 'string' ? input.collectionId : undefined,
  });
}

function sanitizeKSwarmSemanticInput(kind, input) {
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
    return { projectId: typeof input?.projectId === 'string' ? input.projectId : '', executionMode: input?.executionMode };
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
  const sanitizeAgent = (candidate) => pickDefined({
    name: candidate?.name,
    description: candidate?.description,
    roles: candidate?.roles,
    capabilities: candidate?.capabilities,
    instructions: candidate?.instructions,
    runtimeType: candidate?.runtimeType,
    maxConcurrentTasks: candidate?.maxConcurrentTasks,
    fallbackToDesktopModel: typeof candidate?.fallbackToDesktopModel === 'boolean' ? candidate.fallbackToDesktopModel : undefined,
  });
  if (kind === 'agent-update') {
    const patch = input?.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
      ? sanitizeAgent(input.patch)
      : {};
    return { agentId: typeof input?.agentId === 'string' ? input.agentId : '', patch };
  }
  return sanitizeAgent(input);
}

contextBridge.exposeInMainWorld('xiaokDesktop', {
  systemUsername: os.userInfo().username,
  getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig'),
  saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input),
  updateModelRuntimeOptions: (input) => ipcRenderer.invoke('desktop:updateModelRuntimeOptions', input),
  createManagedXiaokAgent: (input) => ipcRenderer.invoke('desktop:createManagedXiaokAgent', input),
  testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input),
  listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId),
  deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId),
  deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId),
  getMobilePairingInfo: () => ipcRenderer.invoke('desktop:mobile:getPairingInfo'),
  getMobileRelayStatus: () => ipcRenderer.invoke('desktop:mobile:getRelayStatus'),
  openMobileRelaySignIn: () => ipcRenderer.invoke('desktop:mobile:openRelaySignIn'),
  onMobileRelayStatus: (handler) => {
    const channel = 'desktop:mobileRelayStatus';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  readClipboardFilePaths: () => ipcRenderer.invoke('desktop:readClipboardFilePaths'),
  readClipboardImage: () => ipcRenderer.invoke('desktop:readClipboardImage'),
  selectDirectory: () => ipcRenderer.invoke('desktop:selectDirectory'),
  selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials'),
  importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input),
  listSkills: () => ipcRenderer.invoke('desktop:listSkills'),
  installSkill: (skillName) => ipcRenderer.invoke('desktop:installSkill', skillName),
  uninstallSkill: (skillName) => ipcRenderer.invoke('desktop:uninstallSkill', skillName),
  createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input),
  createTask: (input) => ipcRenderer.invoke('desktop:createTask', input),
  getGoal: (threadId) => ipcRenderer.invoke('desktop:goal:get', { threadId }),
  createGoal: (input) => ipcRenderer.invoke('desktop:goal:create', input),
  pauseGoal: (threadId) => ipcRenderer.invoke('desktop:goal:pause', { threadId }),
  resumeGoal: (input) => ipcRenderer.invoke('desktop:goal:resume', input),
  cancelGoal: (threadId) => ipcRenderer.invoke('desktop:goal:cancel', { threadId }),
  replaceGoal: (input) => ipcRenderer.invoke('desktop:goal:replace', input),
  ackGoalTaskAttached: (input) => ipcRenderer.invoke('desktop:goal:ackTaskAttached', input),
  setGoalUserQueuePending: (input) => ipcRenderer.invoke('desktop:goal:setUserQueuePending', input),
  onGoalChanged: (handler) => {
    const channel = 'desktop:goal:changed';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onGoalTaskPrepared: (handler) => {
    const channel = 'desktop:goal:taskPrepared';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  subscribeTask(taskId, handler, sinceIndex) {
    const channel = `desktop:taskEvent:${taskId}`;
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    void ipcRenderer.invoke('desktop:subscribeTask', typeof sinceIndex === 'number' ? { taskId, sinceIndex } : { taskId });
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  answerQuestion: (input) => ipcRenderer.invoke('desktop:answerQuestion', input),
  cancelTask: (taskId) => ipcRenderer.invoke('desktop:cancelTask', { taskId }),
  getActiveTask: () => ipcRenderer.invoke('desktop:getActiveTask'),
  recoverTask: (taskId) => ipcRenderer.invoke('desktop:recoverTask', { taskId }),
  openArtifact: (artifactId) => ipcRenderer.invoke('desktop:openArtifact', { artifactId }),
  openFileInSystemApp: (filePath) => ipcRenderer.invoke('desktop:openFileInSystemApp', { filePath }),
  listChannels: () => ipcRenderer.invoke('desktop:listChannels'),
  testChannel: (channelId) => ipcRenderer.invoke('desktop:testChannel', channelId),
  createChannel: (input) => ipcRenderer.invoke('desktop:createChannel', input),
  updateChannel: (id, input) => ipcRenderer.invoke('desktop:updateChannel', id, input),
  deleteChannel: (id) => ipcRenderer.invoke('desktop:deleteChannel', id),
  listMCPInstalls: () => ipcRenderer.invoke('desktop:listMCPInstalls'),
  createMCPInstall: (input) => ipcRenderer.invoke('desktop:createMCPInstall', input),
  updateMCPInstall: (id, input) => ipcRenderer.invoke('desktop:updateMCPInstall', id, input),
  deleteMCPInstall: (id) => ipcRenderer.invoke('desktop:deleteMCPInstall', id),
  listPluginMcpServers: () => ipcRenderer.invoke('desktop:listPluginMcpServers'),
  retryPluginComponent: (input) => ipcRenderer.invoke('desktop:retryPluginComponent', input),
  getComputerUseCapabilityStatus: () => ipcRenderer.invoke('desktop:getComputerUseCapabilityStatus'),
  enableComputerUse: () => ipcRenderer.invoke('desktop:enableComputerUse'),
  reconnectComputerUse: () => ipcRenderer.invoke('desktop:reconnectComputerUse'),
  disableComputerUse: () => ipcRenderer.invoke('desktop:disableComputerUse'),
  openPluginDependencyPermissionSettings: (input) => ipcRenderer.invoke('desktop:openPluginDependencyPermissionSettings', input),
  installPlugin: (name) => ipcRenderer.invoke('desktop:installPlugin', name),
  listAvailablePlugins: () => ipcRenderer.invoke('desktop:listAvailablePlugins'),
  listPluginDependencyStatuses: () => ipcRenderer.invoke('desktop:listPluginDependencyStatuses'),
  installPluginDependency: (input) => ipcRenderer.invoke('desktop:installPluginDependency', input),
  updatePluginDependency: (input) => ipcRenderer.invoke('desktop:updatePluginDependency', input),
  diagnosePluginDependency: (input) => ipcRenderer.invoke('desktop:diagnosePluginDependency', input),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates'),
  quitAndInstall: () => ipcRenderer.invoke('desktop:quitAndInstall'),
  onUpdateStatus(handler) {
    const channel = 'desktop:updateStatus';
    const listener = (_event, payload) => {
      handler(payload);
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
  createReminder: (input) => ipcRenderer.invoke('desktop:createReminder', input),
  listReminders: () => ipcRenderer.invoke('desktop:listReminders'),
  cancelReminder: (id) => ipcRenderer.invoke('desktop:cancelReminder', id),
  getReminderStatus: () => ipcRenderer.invoke('desktop:getReminderStatus'),
  onReminder(handler) {
    const channel = 'desktop:reminder';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  getSkillDebugConfig: () => ipcRenderer.invoke('desktop:getSkillDebugConfig'),
  saveSkillDebugConfig: (input) => ipcRenderer.invoke('desktop:saveSkillDebugConfig', input),
  getKswarmConfig: () => ipcRenderer.invoke('desktop:getKswarmConfig'),
  saveKswarmConfig: (input) => ipcRenderer.invoke('desktop:saveKswarmConfig', input),
  readFileContent: (filePath) => ipcRenderer.invoke('desktop:readFileContent', { filePath }),
  getArtifactWorkspaceSnapshot: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:getArtifactWorkspaceSnapshot', sanitizeArtifactWorkspaceInput(input)),
  closeArtifactWorkspace: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:closeArtifactWorkspace', sanitizeArtifactWorkspaceInput(input)),
  onArtifactWorkspaceChanged(handler) {
    const channel = 'desktop:artifactWorkspace:changed';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  readArtifactWorkspaceVersionPreview: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:readArtifactWorkspaceVersionPreview', sanitizeArtifactWorkspaceInput(input)),
  exportArtifactWorkspaceVersion: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:exportArtifactWorkspaceVersion', sanitizeArtifactWorkspaceInput(input)),
  createArtifactPlaceholder: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:createArtifactPlaceholder', sanitizeArtifactWorkspaceInput(input)),
  submitArtifactGeneration: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:submitArtifactGeneration', sanitizeArtifactWorkspaceInput(input)),
  cancelArtifactGeneration: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:cancelArtifactGeneration', sanitizeArtifactWorkspaceInput(input)),
  retryArtifactGeneration: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:retryArtifactGeneration', sanitizeArtifactWorkspaceInput(input)),
  preferArtifactVersion: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:preferArtifactVersion', sanitizeArtifactWorkspaceInput(input)),
  removeArtifactWorkspaceNode: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:removeArtifactWorkspaceNode', sanitizeArtifactWorkspaceInput(input)),
  updateArtifactWorkspaceLayout: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:updateArtifactWorkspaceLayout', sanitizeArtifactWorkspaceInput(input)),
  saveArtifactWorkspaceViewport: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:saveArtifactWorkspaceViewport', sanitizeArtifactWorkspaceInput(input)),
  createArtifactWorkspaceCollection: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:createArtifactWorkspaceCollection', sanitizeArtifactWorkspaceInput(input)),
  createArtifactWorkspaceNote: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:createArtifactWorkspaceNote', sanitizeArtifactWorkspaceInput(input)),
  updateArtifactWorkspaceNote: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:updateArtifactWorkspaceNote', sanitizeArtifactWorkspaceInput(input)),
  createArtifactWorkspaceRelation: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:createArtifactWorkspaceRelation', sanitizeArtifactWorkspaceInput(input)),
  setArtifactCollectionMembership: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:setArtifactCollectionMembership', sanitizeArtifactWorkspaceInput(input)),
  recordArtifactWorkspaceEvent: (input) => ipcRenderer.invoke('desktop:artifactWorkspace:recordArtifactWorkspaceEvent', sanitizeArtifactWorkspaceInput(input)),
  getSkillStats: () => ipcRenderer.invoke('desktop:getSkillStats'),
  getServiceStatus: () => ipcRenderer.invoke('desktop:services:getStatus'),
  restartRelatedService: (serviceId) => ipcRenderer.invoke('desktop:services:restart', serviceId),
  kswarmGetStatus: () => ipcRenderer.invoke('desktop:kswarm:getStatus'),
  kswarmStart: () => ipcRenderer.invoke('desktop:kswarm:start'),
  kswarmStop: () => ipcRenderer.invoke('desktop:kswarm:stop'),
  kswarmRestart: () => ipcRenderer.invoke('desktop:kswarm:restart'),
  kswarmResumeWorkflowRun: (input) => ipcRenderer.invoke('desktop:kswarm:resumeWorkflowRun', input),
  kswarmStartProjectPlanning: (input) => ipcRenderer.invoke('desktop:kswarm:startProjectPlanning', input),
  getAssistantOverview: () => ipcRenderer.invoke('desktop:assistant:getOverview'),
  activateAssistant: () => ipcRenderer.invoke('desktop:assistant:activate'),
  pauseAssistant: () => ipcRenderer.invoke('desktop:assistant:pause'),
  resumeAssistant: () => ipcRenderer.invoke('desktop:assistant:resume'),
  acceptAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:acceptCandidate', sanitizeAssistantCandidateInput(input)),
  rejectAssistantCandidate: (input) => ipcRenderer.invoke('desktop:assistant:rejectCandidate', sanitizeAssistantCandidateInput(input)),
  planProjectTeam: (input) => ipcRenderer.invoke('desktop:kswarm:team:plan', sanitizeKSwarmSemanticInput('team-plan', input)),
  applyProjectTeamPlan: (input) => ipcRenderer.invoke('desktop:kswarm:team:apply', sanitizeKSwarmSemanticInput('team-apply', input)),
  getProjectTeamOperation: (input) => ipcRenderer.invoke('desktop:kswarm:team:getOperation', sanitizeKSwarmSemanticInput('team-operation', input)),
  createKSwarmProject: (input) => ipcRenderer.invoke('desktop:kswarm:project:create', sanitizeKSwarmSemanticInput('project-create', input)),
  updateKSwarmProjectExecutionMode: (input) => ipcRenderer.invoke('desktop:kswarm:project:updateExecutionMode', sanitizeKSwarmSemanticInput('project-execution-mode', input)),
  deleteKSwarmProject: (input) => ipcRenderer.invoke('desktop:kswarm:project:delete', sanitizeKSwarmSemanticInput('project-delete', input)),
  createKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:create', sanitizeKSwarmSemanticInput('agent-create', input)),
  updateKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:update', sanitizeKSwarmSemanticInput('agent-update', input)),
  archiveKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:archive', sanitizeKSwarmSemanticInput('agent-id', input)),
  startKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:start', sanitizeKSwarmSemanticInput('agent-id', input)),
  stopKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:stop', sanitizeKSwarmSemanticInput('agent-id', input)),
  probeKSwarmAgent: (input) => ipcRenderer.invoke('desktop:kswarm:agent:probe', sanitizeKSwarmSemanticInput('agent-id', input)),
  onKSwarmStatus(handler) {
    const channel = 'desktop:kswarm:statusChange';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  exportTraceBundle: (input) => ipcRenderer.invoke('desktop:trace:export', input),
  diagnose: (input) => ipcRenderer.invoke('desktop:diagnose', input),
  selectHtmlEditMedia: (input) => ipcRenderer.invoke('desktop:selectHtmlEditMedia', input),
  getLoopDefinitions: () => ipcRenderer.invoke('desktop:loops:listDefinitions'),
  listUserLoopTemplates: () => ipcRenderer.invoke('desktop:loops:listUserTemplates'),
  createUserLoopTemplate: (input) => ipcRenderer.invoke('desktop:loops:createUserTemplate', input),
  updateUserLoopTemplate: (loopId, patch) => ipcRenderer.invoke('desktop:loops:updateUserTemplate', loopId, patch),
  deleteUserLoopTemplate: (loopId) => ipcRenderer.invoke('desktop:loops:deleteUserTemplate', loopId),
  clearLoopRunHistory: (loopId, statuses) => ipcRenderer.invoke('desktop:loops:clearRunHistory', loopId, statuses),
  createLoopSchedule: (input) => ipcRenderer.invoke('desktop:loops:createSchedule', input),
  getLoopScheduleBindings: () => ipcRenderer.invoke('desktop:loops:getScheduleBindings'),
  getAutomationOverviewSnapshot: () => ipcRenderer.invoke('desktop:automations:getOverviewSnapshot'),
  getAutomationRunHistory: () => ipcRenderer.invoke('desktop:automations:getRunHistory'),
  getAutomationsConfig: () => ipcRenderer.invoke('desktop:automations:getConfig'),
  setGlobalBackgroundAutoRun: (input) => ipcRenderer.invoke('desktop:automations:setGlobalBackgroundAutoRun', input),
  openLoopOutputDirectory: (loopId) => ipcRenderer.invoke('desktop:loops:openOutputDirectory', loopId),
  readLoopOutputPreview: (loopId) => ipcRenderer.invoke('desktop:loops:readOutputPreview', loopId),
  readLoopTaskResult: (loopId) => ipcRenderer.invoke('desktop:loops:readTaskResult', loopId),
  getLoopRuns: (loopId) => ipcRenderer.invoke('desktop:loops:listRuns', loopId),
  getEvidenceAnomalies: (loopId) => ipcRenderer.invoke('desktop:loops:listAnomalies', loopId),
  runLoopNow: (loopId) => ipcRenderer.invoke('desktop:loops:runNow', loopId),
  listLoopConstraints: (loopId) => ipcRenderer.invoke('desktop:loops:listConstraints', loopId),
  setLoopConstraintActive: (constraintId, active) => ipcRenderer.invoke('desktop:loops:setConstraintActive', constraintId, active),
  confirmLoopConstraint: (constraintId) => ipcRenderer.invoke('desktop:loops:confirmConstraint', constraintId),
  listMemories: () => ipcRenderer.invoke('desktop:listMemories'),
  createMemory: (input) => ipcRenderer.invoke('desktop:createMemory', input),
  updateMemory: (input) => ipcRenderer.invoke('desktop:updateMemory', input),
  deleteMemory: (id) => ipcRenderer.invoke('desktop:deleteMemory', id),
  importMemories: (items) => ipcRenderer.invoke('desktop:importMemories', items),
  memoryStats: () => ipcRenderer.invoke('desktop:memoryStats'),
  memoryCompact: () => ipcRenderer.invoke('desktop:memoryCompact'),
  memoryPersonaTraits: () => ipcRenderer.invoke('desktop:memoryPersonaTraits'),
  memoryListLayer: (layer, limit, offset) => ipcRenderer.invoke('desktop:memoryListLayer', layer, limit, offset),
  memoryDeleteEntry: (id, layer) => ipcRenderer.invoke('desktop:memoryDeleteEntry', id, layer),
  memoryClearAll: () => ipcRenderer.invoke('desktop:memoryClearAll'),
  memoryGetModelId: () => ipcRenderer.invoke('desktop:memoryGetModelId'),
  memorySetModelId: (modelId) => ipcRenderer.invoke('desktop:memorySetModelId', modelId),
  getEmbeddingModels: () => ipcRenderer.invoke('desktop:getEmbeddingModels'),
  downloadEmbeddingModel: (modelId) => ipcRenderer.invoke('desktop:downloadEmbeddingModel', modelId),
  setEmbeddingModel: (modelId) => ipcRenderer.invoke('desktop:setEmbeddingModel', modelId),
  syncScheduledTasks: (tasks) => ipcRenderer.invoke('desktop:syncScheduledTasks', tasks),
  getScheduledTasks: () => ipcRenderer.invoke('desktop:getScheduledTasks'),
  createScheduledTask: (input) => ipcRenderer.invoke('desktop:createScheduledTask', input),
  updateScheduledTask: (input) => ipcRenderer.invoke('desktop:updateScheduledTask', input),
  setScheduledTaskStatus: (id, status) => ipcRenderer.invoke('desktop:setScheduledTaskStatus', id, status),
  cancelScheduledTask: (id) => ipcRenderer.invoke('desktop:cancelScheduledTask', id),
  getTimedActions: () => ipcRenderer.invoke('desktop:getTimedActions'),
  getTimedActionRuns: (actionId) => ipcRenderer.invoke('desktop:getTimedActionRuns', actionId),
  approveTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:approveAuto', actionId),
  revokeTimedActionAuto: (actionId) => ipcRenderer.invoke('desktop:timedAction:revokeAuto', actionId),
  clearScheduledTaskRunHistory: (actionId, statuses) => ipcRenderer.invoke('desktop:scheduledTasks:clearRunHistory', actionId, statuses),
  showSaveDialog: (input) => ipcRenderer.invoke('desktop:showSaveDialog', input),
  saveFile: (input) => ipcRenderer.invoke('desktop:saveFile', input),
  listPrinciples: () => ipcRenderer.invoke('desktop:listPrinciples'),
  savePrinciple: (principle) => ipcRenderer.invoke('desktop:savePrinciple', principle),
  deletePrinciple: (id) => ipcRenderer.invoke('desktop:deletePrinciple', id),
  onScheduledTaskDue(handler) {
    const channel = 'desktop:scheduledTaskDue';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  onLoopConstraintAdded(handler) {
    const channel = 'desktop:loops:constraintAdded';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  getConnectorsConfig: () => ipcRenderer.invoke('desktop:getConnectorsConfig'),
  saveConnectorsConfig: (input) => ipcRenderer.invoke('desktop:saveConnectorsConfig', input),
  listConnectorRuntimes: () => ipcRenderer.invoke('desktop:listConnectorRuntimes'),
  testConnectorProvider: (kind) => ipcRenderer.invoke('desktop:testConnectorProvider', kind),
  kbListCollections: () => ipcRenderer.invoke('desktop:kb:listCollections'),
  kbCreateCollection: (input) => ipcRenderer.invoke('desktop:kb:createCollection', input),
  kbDeleteCollection: (id) => ipcRenderer.invoke('desktop:kb:deleteCollection', id),
  kbListSources: (collectionId) => ipcRenderer.invoke('desktop:kb:listSources', collectionId),
  kbAddSource: (input) => ipcRenderer.invoke('desktop:kb:addSource', input),
  kbDeleteSource: (id) => ipcRenderer.invoke('desktop:kb:deleteSource', id),
  kbGetCollectionState: (collectionId) => ipcRenderer.invoke('desktop:kb:getCollectionState', collectionId),
  kbGetSourceContent: (input) => ipcRenderer.invoke('desktop:kb:getSourceContent', input),
  kbSearch: (input) => ipcRenderer.invoke('desktop:kb:search', input),
  kbPickFiles: () => ipcRenderer.invoke('desktop:kb:pickFiles'),
  meetingPickAudioFile: () => ipcRenderer.invoke('desktop:meeting:pickAudioFile'),
  meetingGetMicrophonePermission: () => ipcRenderer.invoke('desktop:meeting:getMicrophonePermission'),
  meetingRequestMicrophonePermission: () => ipcRenderer.invoke('desktop:meeting:requestMicrophonePermission'),
  meetingGetAsrConfig: () => ipcRenderer.invoke('desktop:meeting:getAsrConfig'),
  meetingSaveAsrConfig: (input) => ipcRenderer.invoke('desktop:meeting:saveAsrConfig', input),
  meetingListModels: () => ipcRenderer.invoke('desktop:meeting:listModels'),
  meetingDownloadModel: (modelId) => ipcRenderer.invoke('desktop:meeting:downloadModel', modelId),
  meetingUninstallModel: (modelId) => ipcRenderer.invoke('desktop:meeting:uninstallModel', modelId),
  meetingSaveRecordedAudio: (input) => ipcRenderer.invoke('desktop:meeting:saveRecordedAudio', input),
  meetingTranscribePreview: (input) => ipcRenderer.invoke('desktop:meeting:transcribePreview', input),
  meetingStartLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:start', input),
  meetingPushLiveTranscriptionAudio: (input) => ipcRenderer.invoke('desktop:meeting:live:pushAudio', input),
  meetingFinishLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:finish', input),
  meetingCancelLiveTranscription: (input) => ipcRenderer.invoke('desktop:meeting:live:cancel', input),
  meetingDraftRecording: (input) => ipcRenderer.invoke('desktop:meeting:draftRecording', input),
  meetingProcessRecording: (input) => ipcRenderer.invoke('desktop:meeting:processRecording', input),
  meetingSaveTranscript: (input) => ipcRenderer.invoke('desktop:meeting:saveTranscript', input),
  meetingOpenRecorderWindow: (input) => ipcRenderer.invoke('desktop:meetingOpenRecorderWindow', input),
  meetingSetRecorderWindowMode: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderWindowMode', input),
  meetingSetRecorderSessionState: (input) => ipcRenderer.invoke('desktop:meetingSetRecorderSessionState', input),
  meetingNotifyRecorderSummaryReady: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecorderSummaryReady', input),
  meetingNotifyRecordingSaved: (input) => ipcRenderer.invoke('desktop:meetingNotifyRecordingSaved', input),
  meetingCloseRecorderWindow: () => ipcRenderer.invoke('desktop:meetingCloseRecorderWindow'),
  onMeetingRecorderCloseRequested(handler) {
    const channel = 'desktop:meetingRecorderCloseRequested';
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onMeetingRecordingSaved(handler) {
    const channel = 'desktop:meetingRecordingSaved';
    const listener = (_event, input) => handler(input);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onMeetingLiveTranscriptionUpdate(handler) {
    const channel = 'desktop:meeting:live:update';
    const listener = (_event, input) => handler(input);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  kswarmProxyGet: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:get', path),
  kswarmProxyGetText: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:getText', path),
  kswarmProxyPost: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:post', path, body),
  kswarmProxyPostJson: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:postJson', path, body),
  kswarmProxyPut: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:put', path, body),
  kswarmProxyPatch: (path, body) => ipcRenderer.invoke('desktop:kswarm:proxy:patch', path, body),
  kswarmProxyDelete: (path) => ipcRenderer.invoke('desktop:kswarm:proxy:delete', path),
  kswarmStreamSubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:subscribe'),
  kswarmStreamUnsubscribe: () => ipcRenderer.invoke('desktop:kswarm:stream:unsubscribe'),
  kswarmStreamGetStatus: () => ipcRenderer.invoke('desktop:kswarm:stream:status'),
  connectionHealthz: (url) => ipcRenderer.invoke('desktop:connection:healthz', url),
  connectionHealth: (url) => ipcRenderer.invoke('desktop:connection:health', url),
  onKSwarmWsEvent(handler) {
    const channel = 'desktop:kswarm:wsEvent';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  onKSwarmConnectionStatus(handler) {
    const channel = 'desktop:kswarm:connectionStatus';
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  getThreadLabels: () => ipcRenderer.invoke('desktop:getThreadLabels'),
  setThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:setThreadLabel', threadId, label),
  unsetThreadLabel: (threadId, label) => ipcRenderer.invoke('desktop:unsetThreadLabel', threadId, label),
  moveThreadLabel: (threadId, from, to) => ipcRenderer.invoke('desktop:moveThreadLabel', threadId, from, to),
  getAppFlag: (key) => ipcRenderer.invoke('desktop:getAppFlag', key),
  setAppFlag: (key, value) => ipcRenderer.invoke('desktop:setAppFlag', key, value),
  migrateLegacyThreadMeta: (data) => ipcRenderer.invoke('desktop:migrateLegacyThreadMeta', data),
});
