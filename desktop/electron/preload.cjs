const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xiaokDesktop', {
  getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig'),
  saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input),
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
});
