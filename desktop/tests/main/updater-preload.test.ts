// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { createPreloadApi } from '../../electron/preload-api.js';
function ipc() { return { invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => ({ ok: true })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, port: ReturnType<typeof ipc>) {
  const calls = [['getUpdateStatus', []], ['checkForUpdates', []], ['quitAndInstall', []]] as const;
  for (const [method, args] of calls) {
    port.invoke.mockClear();
    await (api[method] as unknown as (...args: unknown[]) => Promise<unknown>)(...args);
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith('desktop:' + method, ...args);
    expect(port.invoke.mock.calls[0]).toHaveLength(args.length + 1);
  }
}
it('preserves all three actual TS updater tuples without source or grant transport additions', async () => {
  const port = ipc(); await check(createPreloadApi(port), port);
});
it('preserves all three actual CJS updater tuples without source or grant transport additions', async () => {
  const port = ipc(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: port, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
    },
  }); await check(api, port);
});
