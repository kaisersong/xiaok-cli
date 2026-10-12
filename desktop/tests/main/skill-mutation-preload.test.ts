// @vitest-environment node
// Copy to desktop/tests/main/skill-mutation-preload.test.ts.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
function port() { return { invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => ({ success: true, message: 'owned_ok' })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  for (const method of ['installSkill', 'uninstallSkill'] as const) {
    ipc.invoke.mockClear(); expect(await api[method]('owned-skill')).toEqual({ success: true, message: 'owned_ok' });
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:' + method, 'owned-skill');
    const failure = Error('owned_failure'); ipc.invoke.mockRejectedValueOnce(failure); await expect(api[method]('owned-skill')).rejects.toBe(failure);
    ipc.invoke.mockResolvedValueOnce({ success: false, message: 'owned_business_failure' }); expect(await api[method]('owned-skill')).toEqual({ success: false, message: 'owned_business_failure' });
  }
  const callback = vi.fn(), dispose = api.onSkillsChanged(callback); expect(ipc.on).toHaveBeenCalledExactlyOnceWith('desktop:skillsChanged', expect.any(Function));
  ipc.on.mock.calls[0]![1]({}, undefined); expect(callback).toHaveBeenCalledTimes(1); dispose();
  expect([...ipc.off.mock.calls, ...ipc.removeListener.mock.calls]).toEqual([['desktop:skillsChanged', ipc.on.mock.calls[0]![1]]]);
}
it('TS preload retains exact skill tuple, business failure, rejection and reload disposal', async () => { const ipc = port(); await check(createPreloadApi(ipc), ipc); });
it('real CJS sandbox preload retains exact skill tuple, business failure, rejection and reload disposal', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
    if (name === 'os') return os; throw Error('unexpected dependency ' + name);
  } }); await check(api, ipc);
});
