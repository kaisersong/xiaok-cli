const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

contextBridge.exposeInMainWorld('xiaokDesktop', {
  systemUsername: os.userInfo().username,
  getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig'),
  saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input),
  createManagedXiaokAgent: (input) => ipcRenderer.invoke('desktop:createManagedXiaokAgent', input),
  testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input),
  listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId),
  deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId),
  deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId),
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
  setPluginMcpServerEnabled: (input) => ipcRenderer.invoke('desktop:setPluginMcpServerEnabled', input),
  restartPluginMcpServers: () => ipcRenderer.invoke('desktop:restartPluginMcpServers'),
  restartPluginMcpServer: (input) => ipcRenderer.invoke('desktop:restartPluginMcpServer', input),
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
  getSkillStats: () => ipcRenderer.invoke('desktop:getSkillStats'),
  getServiceStatus: () => ipcRenderer.invoke('desktop:services:getStatus'),
  restartRelatedService: (serviceId) => ipcRenderer.invoke('desktop:services:restart', serviceId),
  kswarmGetStatus: () => ipcRenderer.invoke('desktop:kswarm:getStatus'),
  kswarmStart: () => ipcRenderer.invoke('desktop:kswarm:start'),
  kswarmStop: () => ipcRenderer.invoke('desktop:kswarm:stop'),
  kswarmRestart: () => ipcRenderer.invoke('desktop:kswarm:restart'),
  kswarmResumeWorkflowRun: (input) => ipcRenderer.invoke('desktop:kswarm:resumeWorkflowRun', input),
  kswarmStartProjectPlanning: (input) => ipcRenderer.invoke('desktop:kswarm:startProjectPlanning', input),
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
  getLoopRuns: (loopId) => ipcRenderer.invoke('desktop:loops:listRuns', loopId),
  getEvidenceAnomalies: (loopId) => ipcRenderer.invoke('desktop:loops:listAnomalies', loopId),
  runLoopNow: (loopId) => ipcRenderer.invoke('desktop:loops:runNow', loopId),
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
  kbSearch: (input) => ipcRenderer.invoke('desktop:kb:search', input),
  kbPickFiles: () => ipcRenderer.invoke('desktop:kb:pickFiles'),
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
