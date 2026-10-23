// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
function port() { return { invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => []), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  for (const method of ['listChannels', 'listMCPInstalls'] as const) {
    ipc.invoke.mockClear(); expect(await api[method]()).toEqual([]); expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:' + method);
    const error = Error('owned_read_failure'); ipc.invoke.mockRejectedValueOnce(error); await expect(api[method]()).rejects.toBe(error);
  }
  expect(ipc.invoke.mock.calls.every(call => ['desktop:listChannels','desktop:listMCPInstalls'].includes(call[0]))).toBe(true);
}
it('actual TS preload preserves both readonly zero tuples and rejection', async () => { const ipc = port(); await check(createPreloadApi(ipc), ipc); });
it('actual CJS sandbox preload preserves both readonly zero tuples and rejection', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected dependency ' + name);
    },
  }); await check(api, ipc);
});
