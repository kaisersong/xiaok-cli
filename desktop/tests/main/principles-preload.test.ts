// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { createPreloadApi } from '../../electron/preload-api.js';

const row = { id: 'owned', content: 'Own knowledge', scenarios: ['planning'] as const, source: 'manual' as const, enabled: true, createdAt: 1, updatedAt: 2 };
function ipc() { return { invoke: vi.fn(async (channel: string) => channel === 'desktop:listPrinciples' ? [row] : { success: true }), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, port: ReturnType<typeof ipc>) {
  const calls = [['listPrinciples', []], ['savePrinciple', [row]], ['deletePrinciple', ['owned']]] as const;
  for (const [method, args] of calls) {
    port.invoke.mockClear();
    const result = await (api[method] as unknown as (...args: unknown[]) => Promise<unknown>)(...args);
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith(`desktop:${method}`, ...args);
    expect(port.invoke.mock.calls[0]).toHaveLength(args.length + 1);
    expect(result).toEqual(method === 'listPrinciples' ? [row] : { success: true });
  }
}
it('preserves every original TS principle tuple and actual delete acknowledgement without role arguments', async () => {
  const port = ipc(); await check(createPreloadApi(port as never), port);
});
it('preserves every original actual CJS principle tuple and acknowledgement without role arguments', async () => {
  const port = ipc(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: port, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error(`unexpected preload dependency ${name}`);
    },
  }); await check(api, port);
});
