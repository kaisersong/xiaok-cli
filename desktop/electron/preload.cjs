const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xiaokDesktop', {
  getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig'),
  saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input),
  testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input),
  listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId),
  deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId),
  deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId),
  selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials'),
  importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input),
  listSkills: () => ipcRenderer.invoke('desktop:listSkills'),
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
  createChannel: (input) => ipcRenderer.invoke('desktop:createChannel', input),
  updateChannel: (id, input) => ipcRenderer.invoke('desktop:updateChannel', id, input),
  deleteChannel: (id) => ipcRenderer.invoke('desktop:deleteChannel', id),
  listMCPInstalls: () => ipcRenderer.invoke('desktop:listMCPInstalls'),
  createMCPInstall: (input) => ipcRenderer.invoke('desktop:createMCPInstall', input),
  updateMCPInstall: (id, input) => ipcRenderer.invoke('desktop:updateMCPInstall', id, input),
  deleteMCPInstall: (id) => ipcRenderer.invoke('desktop:deleteMCPInstall', id),
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
});
