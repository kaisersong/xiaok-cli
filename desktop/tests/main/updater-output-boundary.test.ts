// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { registerUpdaterIpc } from '../../electron/updater-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const methods = ['getUpdateStatus', 'checkForUpdates', 'quitAndInstall'] as const;
const status = { checking: false, available: true, downloading: false, downloaded: true, progress: 100, currentVersion: 'owned-current' };
function fixture(method: typeof methods[number], produce: () => unknown) {
  resetIpcSchemaRegistryForTests();
  const listeners = new Map<string, IpcHandlerListener>();
  const sender = {};
  registerUpdaterIpc({ handle(channel, listener) { listeners.set(channel, listener); } }, new Map([['desktop:' + method, produce]]), value => value === sender);
  return () => listeners.get('desktop:' + method)!({ sender } as Parameters<IpcHandlerListener>[0]);
}
describe('actual updater registrar output boundary', () => {
  it.each(methods)('rejects malformed output for %s without reading accessors', async method => {
    let reads = 0;
    const value = Object.defineProperty({}, 'then', { get() { reads++; throw Error('must_not_read'); } });
    await expect(fixture(method, () => value)()).rejects.toThrow(method === 'getUpdateStatus' ? 'updater_projection_unavailable' : 'updater_operation_unknown');
    expect(reads).toBe(0);
  });
  it.each(methods)('rejects a native Promise constructor accessor for %s before then assimilation', async method => {
    let reads = 0;
    const result = Promise.resolve(undefined);
    Object.defineProperty(result, 'constructor', { get() { reads++; return Promise; } });
    await expect(fixture(method, () => result)()).rejects.toThrow(method === 'getUpdateStatus' ? 'updater_projection_unavailable' : 'updater_operation_unknown');
    expect(reads).toBe(0);
  });
  it('detaches a successful full status DTO from its private producer alias', async () => {
    const result = await fixture('getUpdateStatus', () => status)() as typeof status;
    result.progress = 39;
    expect(status.progress).toBe(100);
  });
  it.each(methods)('accepts the standard native Promise for %s', async method => {
    const result = method === 'getUpdateStatus' ? status : method === 'quitAndInstall' ? { status: 'pending', projection: { status: 'install_handoff_pending' } } : undefined;
    expect(await fixture(method, () => Promise.resolve(result))()).toEqual(result);
  });
});
