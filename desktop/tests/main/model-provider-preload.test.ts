// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { createPreloadApi } from '../../electron/preload-api.js';
function ipc() { return { invoke: vi.fn(async () => ({ transportOnly: true })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, port: ReturnType<typeof ipc>) {
  const calls = [
    ['getModelConfig', []], ['saveModelConfig', [{ providerId: 'kimi', modelId: null, apiKey: null }]],
    ['updateModelRuntimeOptions', [{ modelId: 'owned', runtimeOptions: { contextLimit: 262144, reasoningEffort: 'high' } }]],
    ['getSystemOneConfig', []], ['saveSystemOneConfig', [{ apiKey: '', model: undefined }]],
    ['createManagedXiaokAgent', [{ id: 'own', name: 'Owned', desktopModelId: null, roles: ['worker'], maxConcurrentTasks: 3 }]],
    ['testProviderConnection', [{ providerId: 'owned', modelId: 'owned' }]],
    ['listAvailableModelsForProvider', ['owned']], ['deleteProvider', ['owned']], ['deleteModel', ['owned']],
  ] as const;
  for (const [method, args] of calls) {
    port.invoke.mockClear();
    await (api[method] as unknown as (...args: unknown[]) => Promise<unknown>)(...args);
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith('desktop:' + method, ...args);
    expect(port.invoke.mock.calls[0]).toHaveLength(args.length + 1);
  }
  port.invoke.mockClear(); await (api.saveSystemOneConfig as (input?: unknown) => Promise<unknown>)();
  expect(port.invoke).toHaveBeenCalledExactlyOnceWith('desktop:saveSystemOneConfig', undefined);
}
it('preserves all ten actual TS preload tuples including nullable slots and omitted SystemOne patch', async () => {
  const port = ipc(); await check(createPreloadApi(port as never), port);
});
it('preserves all ten actual CJS preload tuples with no source/actor transport additions', async () => {
  const port = ipc(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: port, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
    },
  }); await check(api, port);
});
