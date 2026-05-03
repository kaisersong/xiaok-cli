import { describe, expect, it, vi } from 'vitest';
import { createPreloadApi, PRELOAD_API_KEYS } from '../../electron/preload-api.js';

describe('preload API contract', () => {
  it('exposes only task-semantic APIs', () => {
    expect(PRELOAD_API_KEYS).toEqual([
      'getModelConfig',
      'saveModelConfig',
      'selectMaterials',
      'importMaterial',
      'createTask',
      'subscribeTask',
      'answerQuestion',
      'cancelTask',
      'getActiveTask',
      'recoverTask',
      'openArtifact',
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
});
