// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
const port = () => ({ invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => undefined), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() });
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  await api.getServiceStatus(); expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:services:getStatus');
  for (const id of ['kswarm', 'intent-broker', 'runtime-bridge'] as const) { ipc.invoke.mockClear(); await api.restartRelatedService(id); expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:services:restart', id); expect(ipc.invoke.mock.calls[0]).toHaveLength(2); }
}
it('keeps the actual TS services zero/one transport tuples', async () => { const ipc = port(); await check(createPreloadApi(ipc), ipc); });
it('keeps the actual CJS services zero/one transport tuples', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
    if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
  } }); await check(api, ipc);
});
