// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createMobileRelaySignInOwner } from '../../electron/mobile-relay-signin.js';
import { registerMobileSignInIpc } from '../../electron/mobile-signin-typed-ipc.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const originalEnv = process.env.NODE_ENV;
afterEach(() => { if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv; });
it.each([undefined, 'agent', 'scheduler', {}, Promise.resolve('user')])('denies source %s before fact or shell access', async source => {
  const getRelayUrl = vi.fn(), openExternal = vi.fn(), owner = createMobileRelaySignInOwner({ getRelayUrl, openExternal });
  await expect(Reflect.apply(owner.open, owner, [source])).rejects.toThrow('mobile_signin_request_source_forbidden'); expect(getRelayUrl).not.toHaveBeenCalled(); expect(openExternal).not.toHaveBeenCalled();
});
it('rejects malformed production DTO before the general runtime can resolve a false ACK', async () => {
  process.env.NODE_ENV = 'production'; resetIpcSchemaRegistryForTests(); const listeners = new Map<string, IpcHandlerListener>();
  const ipc = { handle(name: string, listener: IpcHandlerListener) { listeners.set(name, listener); } }, producers = new Map([['desktop:mobile:openRelaySignIn', () => Promise.resolve({ ok: true })]]);
  registerMobileSignInIpc(ipc, producers); registerMobileSignInIpc(ipc, producers); expect(listeners.size).toBe(1);
  expect(() => registerMobileSignInIpc(ipc, new Map())).toThrow('mobile_signin_registrar_owner_conflict');
  await expect(Reflect.apply(listeners.get('desktop:mobile:openRelaySignIn')!, undefined, [{ sender: {} }])).rejects.toThrow('mobile_signin_operation_unknown');
});
it('keeps actual TS/CJS sandbox sign-in calls at zero transport arguments', async () => {
  for (const cjs of [false, true]) {
    const ipc = { invoke: vi.fn(async (_name: string, ..._args: unknown[]) => ({ ok: true, url: 'https://owned.invalid/auth/login' })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
    let api = createPreloadApi(ipc);
    if (cjs) runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: typeof api) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected dependency');
    } });
    expect(await api.openMobileRelaySignIn()).toEqual({ ok: true, url: 'https://owned.invalid/auth/login' }); expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:mobile:openRelaySignIn'); expect(ipc.invoke.mock.calls[0]).toHaveLength(1);
  }
});
