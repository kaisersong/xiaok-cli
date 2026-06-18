import Module, { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreloadApi,
  PRELOAD_API_KEYS,
  FULL_PRELOAD_KEYS,
  KSWARM_PROXY_KEYS,
  EXTRA_KEYS,
  THREAD_META_KEYS,
  EVENT_SUBSCRIPTION_KEYS,
  LOCAL_CONSTANT_KEYS,
  INVOKE_API_KEYS,
  INVOKE_CHANNEL_BY_KEY,
  KNOWN_UNROUTED_HANDLERS,
} from '../../electron/preload-api.js';

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
    ]);
  });

  it('does not expose raw fs, shell, or runtime event channels', () => {
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    expect(Object.keys(api).sort()).toEqual([...FULL_PRELOAD_KEYS].sort());
    expect(api).not.toHaveProperty('readFile');
    expect(api).not.toHaveProperty('readdir');
    expect(api).not.toHaveProperty('shell');
    expect(api).not.toHaveProperty('runPluginCommand');
    expect(api).not.toHaveProperty('rawRuntimeEvents');
    expect(api).not.toHaveProperty('insertEvidence');
    expect(api).not.toHaveProperty('completeLoopRun');
    expect(api).not.toHaveProperty('completeTask');
    expect(api).not.toHaveProperty('sql');
    expect(api).not.toHaveProperty('query');
    expect(api).not.toHaveProperty('execute');
    expect(api).not.toHaveProperty('fs');
  });

  it('routes loop diagnostics through semantic IPC channels', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.getLoopDefinitions();
    await api.listUserLoopTemplates();
    await api.createUserLoopTemplate({
      loopId: 'user-loop-1',
      title: 'User Loop',
      kind: 'markdown_file',
      prompt: 'Write note',
      outputDirectory: '/tmp/xiaok-loop',
      outputFileName: 'note.md',
    });
    await api.createLoopSchedule({
      loopId: 'user-loop-1',
      title: 'User Loop Schedule',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
    });
    await api.getLoopScheduleBindings();
    await api.getAutomationOverviewSnapshot();
    await api.getAutomationRunHistory();
    await api.getAutomationsConfig();
    await api.setGlobalBackgroundAutoRun({ enabled: false });
    await api.openLoopOutputDirectory('user-loop-1');
    await api.readLoopOutputPreview('user-loop-1');
    await api.getLoopRuns('artifact-evidence-regression');
    await api.getEvidenceAnomalies('artifact-evidence-regression');
    await api.runLoopNow('artifact-evidence-regression');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:listDefinitions');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:listUserTemplates');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:createUserTemplate', {
      loopId: 'user-loop-1',
      title: 'User Loop',
      kind: 'markdown_file',
      prompt: 'Write note',
      outputDirectory: '/tmp/xiaok-loop',
      outputFileName: 'note.md',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:createSchedule', {
      loopId: 'user-loop-1',
      title: 'User Loop Schedule',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:getScheduleBindings');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:automations:getOverviewSnapshot');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:automations:getRunHistory');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:automations:getConfig');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:automations:setGlobalBackgroundAutoRun', { enabled: false });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:openOutputDirectory', 'user-loop-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:readOutputPreview', 'user-loop-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:listRuns', 'artifact-evidence-regression');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:listAnomalies', 'artifact-evidence-regression');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:loops:runNow', 'artifact-evidence-regression');
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

  it('FULL_PRELOAD_KEYS is the composition of PRELOAD_API_KEYS + KSWARM_PROXY_KEYS + EXTRA_KEYS + THREAD_META_KEYS', () => {
    const composed = [...PRELOAD_API_KEYS, ...KSWARM_PROXY_KEYS, ...EXTRA_KEYS, ...THREAD_META_KEYS];
    expect(FULL_PRELOAD_KEYS.sort()).toEqual([...composed].sort());
  });

  it('createPreloadApi returns keys matching FULL_PRELOAD_KEYS', () => {
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer, 'test-user');
    const actualKeys = Object.keys(api).sort();
    expect(actualKeys).toEqual([...FULL_PRELOAD_KEYS].sort());
  });

  it('runtime preload.cjs exposes keys matching FULL_PRELOAD_KEYS', () => {
    const api = loadRuntimePreloadApi();
    expect(Object.keys(api).sort()).toEqual([...FULL_PRELOAD_KEYS].sort());
  });

  it('routes kswarm proxy methods through semantic IPC channels', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ data: 'test' }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer, 'test-user');

    await api.kswarmProxyGet('/projects');
    await api.kswarmProxyPost('/tasks', { title: 'test' });
    await api.kswarmProxyDelete('/tasks/t1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:kswarm:proxy:get', '/projects');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:kswarm:proxy:post', '/tasks', { title: 'test' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:kswarm:proxy:delete', '/tasks/t1');
  });

  it('routes extra methods through semantic IPC channels', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer, 'test-user');

    await api.showSaveDialog({ defaultPath: '/tmp/test.md' });
    await api.saveFile({ filePath: '/tmp/test.md', content: 'hello' });
    await api.listPrinciples();
    await api.savePrinciple({ id: 'p1', content: 'test' });
    await api.deletePrinciple('p1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:showSaveDialog', { defaultPath: '/tmp/test.md' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:saveFile', { filePath: '/tmp/test.md', content: 'hello' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:listPrinciples');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:savePrinciple', { id: 'p1', content: 'test' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:deletePrinciple', 'p1');
  });
});

const HANDLER_REGISTRATION_FILES = [
  resolve(process.cwd(), 'electron', 'main.ts'),
  resolve(process.cwd(), 'electron', 'ipc.ts'),
  resolve(process.cwd(), 'electron', 'kswarm-ipc-proxy.ts'),
];

function extractRegisteredHandlerChannels(): Set<string> {
  const channels = new Set<string>();
  for (const filePath of HANDLER_REGISTRATION_FILES) {
    const source = readFileSync(filePath, 'utf8');
    const re = /ipcMain\.handle\(\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      channels.add(match[1]!);
    }
  }
  return channels;
}

describe('IPC handler ↔ preload key parity', () => {
  it('three preload key categories are disjoint and cover FULL_PRELOAD_KEYS', () => {
    const eventSet = new Set<string>(EVENT_SUBSCRIPTION_KEYS);
    const localSet = new Set<string>(LOCAL_CONSTANT_KEYS);
    const invokeSet = new Set<string>(INVOKE_API_KEYS);

    // Disjoint
    for (const key of EVENT_SUBSCRIPTION_KEYS) {
      expect(localSet.has(key)).toBe(false);
      expect(invokeSet.has(key)).toBe(false);
    }
    for (const key of LOCAL_CONSTANT_KEYS) {
      expect(eventSet.has(key)).toBe(false);
      expect(invokeSet.has(key)).toBe(false);
    }

    // Cover
    const union = new Set<string>([...eventSet, ...localSet, ...invokeSet]);
    expect(union.size).toBe(FULL_PRELOAD_KEYS.length);
    for (const key of FULL_PRELOAD_KEYS) {
      expect(union.has(key)).toBe(true);
    }
  });

  it('INVOKE_CHANNEL_BY_KEY keys exactly match INVOKE_API_KEYS', () => {
    const mappedKeys = Object.keys(INVOKE_CHANNEL_BY_KEY).sort();
    const expectedKeys = [...INVOKE_API_KEYS].sort();
    expect(mappedKeys).toEqual(expectedKeys);
  });

  it('every INVOKE_CHANNEL_BY_KEY channel is registered in main process source files', () => {
    const registeredChannels = extractRegisteredHandlerChannels();
    const orphanInvokes: Array<{ key: string; channel: string }> = [];
    for (const [key, channel] of Object.entries(INVOKE_CHANNEL_BY_KEY)) {
      if (!registeredChannels.has(channel)) {
        orphanInvokes.push({ key, channel });
      }
    }
    expect(orphanInvokes).toEqual([]);
  });

  it('every registered ipcMain.handle channel either maps to a preload key or is in KNOWN_UNROUTED_HANDLERS', () => {
    const registeredChannels = extractRegisteredHandlerChannels();
    const reverseMap = new Set(Object.values(INVOKE_CHANNEL_BY_KEY));
    // subscribeTask is hybrid: it triggers an invoke 'desktop:subscribeTask' but
    // is classified as event subscription. Add the invoke side here so it does
    // not appear orphaned.
    reverseMap.add('desktop:subscribeTask');
    const knownOrphans = new Set(KNOWN_UNROUTED_HANDLERS);

    const undeclaredOrphans: string[] = [];
    for (const channel of registeredChannels) {
      if (reverseMap.has(channel)) continue;
      if (knownOrphans.has(channel)) continue;
      undeclaredOrphans.push(channel);
    }
    expect(undeclaredOrphans).toEqual([]);
  });
});

function loadRuntimePreloadApi(): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  const preloadPath = resolve(process.cwd(), 'electron', 'preload.cjs');
  const originalLoad = (Module as unknown as { _load: NodeJS.Require })._load;
  let exposedApi: Record<string, unknown> | null = null;
  const ipcRenderer = {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };

  delete require.cache[preloadPath];
  (Module as unknown as { _load: NodeJS.Require })._load = ((request: string, parent: unknown, isMain: boolean) => {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name: string, api: Record<string, unknown>) {
            if (name === 'xiaokDesktop') exposedApi = api;
          },
        },
        ipcRenderer,
      };
    }
    if (request === 'os') {
      return { userInfo: () => ({ username: 'test-user' }) };
    }
    return originalLoad(request, parent, isMain);
  }) as NodeJS.Require;

  try {
    require(preloadPath);
  } finally {
    (Module as unknown as { _load: NodeJS.Require })._load = originalLoad;
    delete require.cache[preloadPath];
  }

  if (!exposedApi) {
    throw new Error('preload.cjs did not expose xiaokDesktop');
  }
  return exposedApi;
}
