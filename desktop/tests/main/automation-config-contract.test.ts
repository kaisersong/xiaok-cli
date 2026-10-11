// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
import { registerAutomationConfigIpc } from '../../electron/automation-config-typed-ipc.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
it('keeps actual TS/CJS 0/0/1 parameter ABI and complete result fields', async () => {
  for (const cjs of [false, true]) {
    const calls: unknown[][] = [], api = createPreloadApi({ invoke: async (...args: unknown[]) => { calls.push(args); return { globalBackgroundAutoRunEnabled: false, extra: 'retained' }; }, on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() } as Parameters<typeof createPreloadApi>[0]);
    let actual = api;
    if (cjs) runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require: (name: string) => name === 'electron' ? { contextBridge: { exposeInMainWorld: (_key: string, value: typeof api) => { actual = value; } }, ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return { globalBackgroundAutoRunEnabled: false, extra: 'retained' }; }, on() {}, removeListener() {}, send() {} } } : name === 'os' ? os : {}, process: { platform: 'darwin', versions: {}, env: {} }, console });
    expect(await actual.getAutomationsConfig()).toMatchObject({ globalBackgroundAutoRunEnabled: false, extra: 'retained' }); await actual.getAutomationOverviewSnapshot(); await actual.setGlobalBackgroundAutoRun({ enabled: false });
    expect(calls).toEqual([['desktop:automations:getConfig'], ['desktop:automations:getOverviewSnapshot'], ['desktop:automations:setGlobalBackgroundAutoRun', { enabled: false }]]);
  }
});
it('permits late producer fill while rejecting unavailable or conflicting registration ownership', async () => {
  const handlers = new Map<string, IpcHandlerListener>(), registrar = { handle: (channel: string, fn: IpcHandlerListener) => { expect(handlers.has(channel)).toBe(false); handlers.set(channel, fn); } }, producers = new Map<string, IpcHandlerListener>();
  registerAutomationConfigIpc(registrar, producers); registerAutomationConfigIpc(registrar, producers); expect(handlers.size).toBe(3);
  const read = handlers.get('desktop:automations:getConfig')!; await expect(async () => read({} as Parameters<IpcHandlerListener>[0])).rejects.toThrow('automation_config_runtime_unavailable');
  producers.set('desktop:automations:getConfig', () => ({ globalBackgroundAutoRunEnabled: false, extra: { retained: true } })); expect(await read({} as Parameters<IpcHandlerListener>[0])).toEqual({ globalBackgroundAutoRunEnabled: false, extra: { retained: true } });
  expect(() => registerAutomationConfigIpc(registrar, new Map())).toThrow('automation_config_registrar_owner_conflict');
});
it('rejects a producer Promise constructor getter and resolved bad output without fake ACK', async () => {
  const handlers = new Map<string, IpcHandlerListener>(), registrar = { handle: (channel: string, fn: IpcHandlerListener) => handlers.set(channel, fn) }, producers = new Map<string, IpcHandlerListener>();
  let value: unknown = {}; producers.set('desktop:automations:getConfig', () => value); registerAutomationConfigIpc(registrar, producers); const read = handlers.get('desktop:automations:getConfig')!;
  await expect(async () => read({} as Parameters<IpcHandlerListener>[0])).rejects.toThrow('automation_config_operation_unknown'); let reads = 0;
  value = Object.defineProperty(Promise.resolve({ globalBackgroundAutoRunEnabled: true }), 'constructor', { get() { reads++; return Promise; } }); await expect(async () => read({} as Parameters<IpcHandlerListener>[0])).rejects.toThrow('automation_config_operation_unknown'); expect(reads).toBe(0);
});
