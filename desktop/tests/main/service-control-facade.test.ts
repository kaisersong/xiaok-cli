// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDesktopServiceControl } from '../../electron/desktop-service-control.js';
import { registerServiceControlIpc } from '../../electron/service-control-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
function fixture() {
  const snapshot = { checkedAt: 0, services: [{ id: 'intent-broker', label: '', running: false, reachable: false, port: 0, pid: null, lastError: '', future: [null, false] }] };
  const options = { getSdkSnapshot: vi.fn(() => snapshot), restartSdk: vi.fn(() => undefined), getRuntimeBridgeFacts: vi.fn(() => ({ started: false, clients: 0 })), getRuntimeBridgeRestart: vi.fn(() => vi.fn(() => undefined)) };
  return { options, snapshot, facade: createDesktopServiceControl(options) };
}
describe('actual Main service facade source and complete output guard', () => {
  it.each([undefined, 'agent', 'scheduler', false, {}, Promise.resolve('user')])('denies source %s before touching a target or dependencies', async source => {
    const f = fixture(); let reads = 0; const target = Object.defineProperty({}, 'id', { enumerable: true, get() { reads++; return 'kswarm'; } });
    await expect(Reflect.apply(f.facade.restart, f.facade, [target, source])).rejects.toThrow('service_request_source_forbidden');
    expect(reads).toBe(0); for (const fn of Object.values(f.options)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(['kswarm', 'intent-broker'])('dispatches the owned user %s target once without extra transport source fields', async id => {
    const f = fixture(); expect(await f.facade.restart(id, 'user')).toBeUndefined(); expect(f.options.restartSdk).toHaveBeenCalledExactlyOnceWith(id); expect(f.options.getRuntimeBridgeRestart).not.toHaveBeenCalled();
  });
  it('preserves the actual contract empty/nullable/optional SDK values with a detached wire snapshot', async () => {
    const f = fixture(), result = await f.facade.getStatus(); expect(result.services[0]).toEqual(f.snapshot.services[0]); expect(result.services[0]).not.toBe(f.snapshot.services[0]);
    expect(Object.hasOwn(result.services[0]!, 'restartCount')).toBe(false); expect(result.checkedAt).toBe(0);
  });
  it('propagates an opaque SDK throw without reading message or retrying', async () => {
    const f = fixture(); let reads = 0; const error = Object.defineProperty({}, 'message', { get() { reads++; return 'private'; } });
    f.options.restartSdk.mockImplementation(() => { throw error; }); await expect(f.facade.restart('kswarm', 'user')).rejects.toBe(error); expect(reads).toBe(0); expect(f.options.restartSdk).toHaveBeenCalledTimes(1);
  });
  it('guards internal runtime fact accessors before the append reads them', async () => {
    const f = fixture(); let reads = 0;
    f.options.getRuntimeBridgeFacts.mockReturnValueOnce(Object.defineProperty({ started: false, clients: 0 }, 'clients', { enumerable: true, get() { reads++; return 0; } }));
    await expect(f.facade.getStatus()).rejects.toThrow('service_projection_unavailable'); expect(reads).toBe(0);
  });
  it('retains exactly one registrar owner, with idempotence and map-replacement denial', () => {
    resetIpcSchemaRegistryForTests(); const listeners = new Map<string, IpcHandlerListener>();
    const ipc: IpcHandleRegistrar = { handle: (channel, listener) => { listeners.set(channel, listener); } }, producers = new Map<string, IpcHandlerListener>();
    registerServiceControlIpc(ipc, producers); registerServiceControlIpc(ipc, producers); expect(listeners.size).toBe(2);
    expect(() => registerServiceControlIpc(ipc, new Map())).toThrow('service_registrar_owner_conflict');
  });
});
