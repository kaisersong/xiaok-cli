import { describe, expect, it, vi } from 'vitest';
import { createPreloadApi, PRELOAD_API_KEYS } from '../../electron/preload-api.js';

describe('preload API contract', () => {
  it('exposes only task-semantic APIs', () => {
    expect(PRELOAD_API_KEYS).toEqual([
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
      'getSkillStats',
      'getServiceStatus',
      'restartRelatedService',
      'kswarmGetStatus',
      'kswarmStart',
      'kswarmStop',
      'kswarmRestart',
      'kswarmResumeWorkflowRun',
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
    ]);
  });

  it('does not expose raw fs, shell, or runtime event channels', () => {
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    expect(Object.keys(api).sort()).toEqual([...PRELOAD_API_KEYS].sort());
    expect(api).not.toHaveProperty('readFile');
    expect(api).not.toHaveProperty('readdir');
    expect(api).not.toHaveProperty('shell');
    expect(api).not.toHaveProperty('runPluginCommand');
    expect(api).not.toHaveProperty('rawRuntimeEvents');
  });

  it('routes plugin dependency operations through semantic IPC channels', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ success: true }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.listPluginDependencyStatuses();
    await api.installPluginDependency({ pluginName: 'cua-computer-use', dependencyId: 'cua-driver', confirmed: true });
    await api.updatePluginDependency({ pluginName: 'cua-computer-use', dependencyId: 'cua-driver', confirmed: true });
    await api.diagnosePluginDependency({ pluginName: 'cua-computer-use', dependencyId: 'cua-driver' });
    await api.restartPluginMcpServers();
    await api.restartPluginMcpServer({ name: 'cua-driver' });
    await api.getComputerUseCapabilityStatus();
    await api.enableComputerUse();
    await api.reconnectComputerUse();
    await api.disableComputerUse();
    await api.openPluginDependencyPermissionSettings({ permission: 'accessibility' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:listPluginDependencyStatuses');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:installPluginDependency', {
      pluginName: 'cua-computer-use',
      dependencyId: 'cua-driver',
      confirmed: true,
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:updatePluginDependency', {
      pluginName: 'cua-computer-use',
      dependencyId: 'cua-driver',
      confirmed: true,
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:diagnosePluginDependency', {
      pluginName: 'cua-computer-use',
      dependencyId: 'cua-driver',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:restartPluginMcpServers');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:restartPluginMcpServer', { name: 'cua-driver' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:getComputerUseCapabilityStatus');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:enableComputerUse');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:reconnectComputerUse');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:disableComputerUse');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:openPluginDependencyPermissionSettings', {
      permission: 'accessibility',
    });
  });

  it('routes provider connection test through semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ success: true, latencyMs: 150 }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.testProviderConnection({ providerId: 'anthropic' })).resolves.toEqual({ success: true, latencyMs: 150 });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:testProviderConnection', { providerId: 'anthropic' });
  });

  it('routes available models list through semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue([
        { modelId: 'anthropic-claude-opus-4-6', model: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      ]),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.listAvailableModelsForProvider('anthropic')).resolves.toEqual([
      { modelId: 'anthropic-claude-opus-4-6', model: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    ]);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:listAvailableModelsForProvider', 'anthropic');
  });

  it('routes provider deletion through semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.deleteProvider('custom-provider');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:deleteProvider', 'custom-provider');
  });

  it('routes model deletion through semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.deleteModel('custom-model');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:deleteModel', 'custom-model');
  });

  it('routes material selection through a semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ filePaths: ['/tmp/a.pdf'] }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.selectMaterials()).resolves.toEqual({ filePaths: ['/tmp/a.pdf'] });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:selectMaterials');
  });

  it('routes directory selection through a semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ filePath: '/tmp/workspace' }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.selectDirectory()).resolves.toEqual({ filePath: '/tmp/workspace' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:selectDirectory');
  });

  it('routes model config reads and saves through semantic IPC channels', async () => {
    const snapshot = { defaultModelId: 'kimi-default', providers: [], models: [] };
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(snapshot),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.getModelConfig()).resolves.toBe(snapshot);
    await expect(api.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' })).resolves.toBe(snapshot);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:getModelConfig');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:saveModelConfig', { providerId: 'kimi', apiKey: 'sk-kimi' });
  });

  it('routes managed xiaok agent creation through semantic IPC channel', async () => {
    const result = { ok: true, agent: { id: 'xiaok-po' } };
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(result),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.createManagedXiaokAgent({ name: 'PO-Agent', roles: ['project_owner'] })).resolves.toBe(result);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:createManagedXiaokAgent', {
      name: 'PO-Agent',
      roles: ['project_owner'],
    });
  });

  it('routes createTask thread context through semantic IPC channel', async () => {
    const result = { taskId: 'task_test' };
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(result),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);
    const input = {
      prompt: 'test',
      materials: [],
      context: { threadId: 'thread-a', taskIds: ['task_1'] },
    };

    await expect(api.createTask(input)).resolves.toBe(result);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:createTask', input);
  });

  it('routes createTaskWithFiles thread context through semantic IPC channel', async () => {
    const result = { taskId: 'task_test' };
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(result),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);
    const input = {
      prompt: 'test',
      filePaths: ['/tmp/file.md'],
      context: { threadId: 'thread-a', taskIds: ['task_1'] },
    };

    await expect(api.createTaskWithFiles(input)).resolves.toBe(result);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:createTaskWithFiles', input);
  });

  it('routes timed action review approve / revoke through semantic IPC channels', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ id: 'action-1' }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.approveTimedActionAuto('action-1');
    await api.revokeTimedActionAuto('action-1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:timedAction:approveAuto', 'action-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:timedAction:revokeAuto', 'action-1');
  });

  it('routes dynamic workflow direct resume through semantic IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ restored: true, jobId: 'wf-script-job-run-1' }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(
      api.kswarmResumeWorkflowRun({ projectId: 'proj-1', workflowRunId: 'run-1' }),
    ).resolves.toEqual({ restored: true, jobId: 'wf-script-job-run-1' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:kswarm:resumeWorkflowRun', {
      projectId: 'proj-1',
      workflowRunId: 'run-1',
    });
  });
});
