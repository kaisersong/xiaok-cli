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
  selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials'),
  importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input),
  listSkills: () => ipcRenderer.invoke('desktop:listSkills'),
  installSkill: (skillName) => ipcRenderer.invoke('desktop:installSkill', skillName),
  uninstallSkill: (skillName) => ipcRenderer.invoke('desktop:uninstallSkill', skillName),
  createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input),
  createTask: (input) => ipcRenderer.invoke('desktop:createTask', input),
  subscribeTask(taskId, handler) {
    const channel = `desktop:taskEvent:${taskId}`;
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    void ipcRenderer.invoke('desktop:subscribeTask', { taskId });
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
  readFileContent: (filePath) => ipcRenderer.invoke('desktop:readFileContent', { filePath }),
  getSkillStats: () => ipcRenderer.invoke('desktop:getSkillStats'),
  kswarmGetStatus: () => ipcRenderer.invoke('desktop:kswarm:getStatus'),
  kswarmStart: () => ipcRenderer.invoke('desktop:kswarm:start'),
  kswarmStop: () => ipcRenderer.invoke('desktop:kswarm:stop'),
  kswarmRestart: () => ipcRenderer.invoke('desktop:kswarm:restart'),
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
  listMemories: () => ipcRenderer.invoke('desktop:listMemories'),
  createMemory: (input) => ipcRenderer.invoke('desktop:createMemory', input),
  updateMemory: (input) => ipcRenderer.invoke('desktop:updateMemory', input),
  deleteMemory: (id) => ipcRenderer.invoke('desktop:deleteMemory', id),
  importMemories: (items) => ipcRenderer.invoke('desktop:importMemories', items),
  syncScheduledTasks: (tasks) => ipcRenderer.invoke('desktop:syncScheduledTasks', tasks),
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
});
