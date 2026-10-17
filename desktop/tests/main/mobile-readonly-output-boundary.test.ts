// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { registerMobileReadonlyIpc } from '../../electron/mobile-readonly-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const methods = ['getRelayStatus', 'getPairingInfo'] as const;
const relay = { running: false, connected: false, relayUrl: '', roomId: '', lastError: null, credentialState: 'ok', requiresUserReauth: false };
const pairing = { desktopId: 'owned', desktopName: '', gatewayURL: '', reachableURLs: [], relayUrl: undefined, relayJwt: '', relayRoomSecret: '', deepLink: '' };
const originalEnvironment = process.env.NODE_ENV;
afterEach(() => { if (originalEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnvironment; });
function fixture(method: typeof methods[number], producer: IpcHandlerListener) {
  resetIpcSchemaRegistryForTests();
  const listeners = new Map<string, IpcHandlerListener>();
  const registrar: IpcHandleRegistrar = { handle: (channel, listener) => { listeners.set(channel, listener); } };
  const producers = new Map([['desktop:mobile:' + method, producer]]);
  registerMobileReadonlyIpc(registrar, producers);
  return { registrar, producers, listeners, invoke: (...args: unknown[]) => Reflect.apply(listeners.get('desktop:mobile:' + method)!, undefined, [{ sender: {} }, ...args]) };
}
describe('actual Mobile typed output and registrar ownership', () => {
  it.each(methods)('captures full standard Promise output for %s with optional/empty/extras unchanged', async method => {
    const owner = { ...(method === 'getRelayStatus' ? relay : pairing), future: { data: [null, false, '', { preserved: true }] } };
    const f = fixture(method, () => Promise.resolve(owner)), wire = await f.invoke() as typeof owner;
    expect(wire).toEqual(owner); expect(wire).not.toBe(owner); expect(wire.future).not.toBe(owner.future);
    wire.future.data[0] = 'changed'; expect(owner.future.data[0]).toBeNull();
  });
  it.each(['ok', 'missing', 'expired', 'rejected', 'unparseable'])('preserves the actual credential state %s without adding a date/business consistency gate', async credentialState => {
    const value = { ...relay, credentialState, credentialExpiresAt: 'owner-format-retained' };
    expect(await fixture('getRelayStatus', () => value).invoke()).toEqual(value);
  });
  it.each(methods)('rejects malformed %s in production without generic success fallback', async method => {
    process.env.NODE_ENV = 'production'; await expect(fixture(method, () => ({})).invoke()).rejects.toThrow('mobile_projection_unavailable');
  });
  it.each(methods)('rejects input getter for %s without running it or the producer', async method => {
    let reads = 0, calls = 0; const f = fixture(method, () => { calls++; return {}; });
    const extra = Object.defineProperty({}, 'grant', { enumerable: true, get() { reads++; return true; } });
    await expect(f.invoke(extra)).rejects.toThrow('mobile_input_invalid'); expect(reads).toBe(0); expect(calls).toBe(0);
  });
  it('keeps same-owner registration idempotent and rejects a replacement producer map', () => {
    const f = fixture('getRelayStatus', () => relay); expect(f.listeners.size).toBe(2);
    registerMobileReadonlyIpc(f.registrar, f.producers); expect(f.listeners.size).toBe(2);
    expect(() => registerMobileReadonlyIpc(f.registrar, new Map(f.producers))).toThrow('mobile_registrar_owner_conflict');
  });
  it('rejects a missing producer instead of returning empty successful facts', async () => {
    const f = fixture('getRelayStatus', () => relay); f.producers.clear();
    await expect(f.invoke()).rejects.toThrow('mobile_runtime_unavailable');
  });
});
