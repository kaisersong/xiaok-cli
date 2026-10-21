// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
function port() { return { invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => ({ owned: 'surrogate' })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  for (const [method, channel] of [['getMobileRelayStatus', 'desktop:mobile:getRelayStatus'], ['getMobilePairingInfo', 'desktop:mobile:getPairingInfo']] as const) {
    ipc.invoke.mockClear(); await api[method]();
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith(channel); expect(ipc.invoke.mock.calls[0]).toHaveLength(1);
  }
  const callback = vi.fn(), dispose = api.onMobileRelayStatus(callback);
  expect(ipc.on).toHaveBeenCalledExactlyOnceWith('desktop:mobileRelayStatus', expect.any(Function));
  const snapshot = { running: true, connected: false, relayUrl: '', roomId: '', lastError: 'retained', credentialState: 'missing', requiresUserReauth: true, future: ['kept'] };
  ipc.on.mock.calls[0]![1]({}, snapshot); expect(callback).toHaveBeenCalledExactlyOnceWith(snapshot);
  dispose(); expect([...ipc.off.mock.calls, ...ipc.removeListener.mock.calls]).toEqual([['desktop:mobileRelayStatus', ipc.on.mock.calls[0]![1]]]);
  expect(ipc.invoke.mock.calls.some(call => call[0] === 'desktop:mobile:openRelaySignIn')).toBe(false);
}
it('preserves the actual TS mobile zero tuples and full event forwarding', async () => {
  const ipc = port(); await check(createPreloadApi(ipc), ipc);
});
it('preserves the actual CJS sandbox mobile zero tuples and full event forwarding', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
    },
  }); await check(api, ipc);
});
