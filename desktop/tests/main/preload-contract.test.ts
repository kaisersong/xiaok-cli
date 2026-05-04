import { describe, expect, it, vi } from 'vitest';
import { createPreloadApi, PRELOAD_API_KEYS } from '../../electron/preload-api.js';

describe('preload API contract', () => {
  it('exposes only task-semantic APIs', () => {
    expect(PRELOAD_API_KEYS).toEqual([
      'getModelConfig',
      'saveModelConfig',
      'testProviderConnection',
      'listAvailableModelsForProvider',
      'deleteProvider',
      'deleteModel',
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
      'listSkills',
      'listChannels',
      'createChannel',
      'updateChannel',
      'deleteChannel',
      'listMCPInstalls',
      'createMCPInstall',
      'updateMCPInstall',
      'deleteMCPInstall',
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
    expect(api).not.toHaveProperty('rawRuntimeEvents');
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

  it('routes createTaskWithFiles through semantic IPC channel', async () => {
    const result = { taskId: 'task_test' };
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(result),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await expect(api.createTaskWithFiles({ prompt: 'test', filePaths: ['/tmp/file.md'] })).resolves.toBe(result);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:createTaskWithFiles', { prompt: 'test', filePaths: ['/tmp/file.md'] });
  });
});
