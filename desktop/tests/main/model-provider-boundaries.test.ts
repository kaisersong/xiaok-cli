// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { registerModelProviderIpc } from '../../electron/model-provider-typed-ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const methods = ['getModelConfig', 'saveModelConfig', 'updateModelRuntimeOptions', 'getSystemOneConfig', 'saveSystemOneConfig', 'createManagedXiaokAgent', 'testProviderConnection', 'listAvailableModelsForProvider', 'deleteProvider', 'deleteModel'] as const;
const snapshot = () => ({ configPath: 'own-config', defaultProvider: 'owned', defaultModelId: 'owned-model', providers: [], models: [], providerProfiles: [] });
const sys = () => ({ configured: false, keySource: 'none' as const, keyEnvVar: null, baseUrl: 'https://owned.invalid', model: 'jev-latest', apiKeyMasked: null });
function fixture(authorize?: Parameters<typeof registerModelProviderIpc>[2]) {
  const handlers = new Map<string, IpcHandlerListener>();
  const service = { getModelConfig: vi.fn(snapshot), saveModelConfig: vi.fn(snapshot), updateModelRuntimeOptions: vi.fn(snapshot), getSystemOneConfig: vi.fn(sys), saveSystemOneConfig: vi.fn(sys), createManagedXiaokAgent: vi.fn(), testProviderConnection: vi.fn(() => ({ success: false, error: 'owned' })), listAvailableModelsForProvider: vi.fn(() => []), deleteProvider: vi.fn(), deleteModel: vi.fn() };
  const ipc = { handle(channel: string, handler: IpcHandlerListener) { handlers.set(channel, handler); } };
  registerModelProviderIpc(ipc, service as never, authorize);
  return { service, ipc, handlers, call: (method: string, ...args: unknown[]) => handlers.get('desktop:' + method)!({} as never, ...args) };
}
it('registers every original sibling as a round18 exact risk/tuple contract', () => {
  resetIpcSchemaRegistryForTests(); fixture();
  const config = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData'];
  for (const method of methods) {
    const expected = method === 'listAvailableModelsForProvider' ? [] : method === 'createManagedXiaokAgent' ? [...config, 'network', 'exec', 'external-process', 'internal-mutation'] : method === 'testProviderConnection' ? [...config, 'network'] : method.startsWith('get') ? config : [...config, 'internal-mutation'];
    expect(IPC_SCHEMA_REGISTRY.get('desktop:' + method)).toMatchObject({ rolloutRound: 18, payloadMode: 'tuple', inputStage: 'beforeHandler', riskTags: expected });
  }
  resetIpcSchemaRegistryForTests();
});
it('checks the existing native actor producer before wire getters and invokes it only once', async () => {
  const denied = Error('host actor unavailable'), authorize = vi.fn(() => { throw denied; }), f = fixture(authorize);
  let reads = 0; const input = Object.defineProperty({}, 'providerId', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(f.call('saveModelConfig', input)).rejects.toBe(denied); expect(authorize).toHaveBeenCalledTimes(1); expect(reads).toBe(0); expect(f.service.saveModelConfig).not.toHaveBeenCalled();
});
it('rejects unknown nested output slots instead of treating known runtime metadata as legacy JSON', async () => {
  const f = fixture(); f.service.getModelConfig.mockReturnValue({ ...snapshot(), models: [{ id: 'owned', provider: 'owned', model: 'owned', label: 'Owned', isDefault: true, runtimeOptions: { contextLimit: 'bad' } }] } as never);
  await expect(f.call('getModelConfig')).rejects.toThrow('model_config_operation_unknown');
});
it('does not read getters or retry after a real producer has returned an unsafe reply', async () => {
  const f = fixture(); let reads = 0; f.service.saveSystemOneConfig.mockReturnValue(Object.defineProperty({}, 'configured', { get() { reads++; return true; }, enumerable: true }) as never);
  await expect(f.call('saveSystemOneConfig', {})).rejects.toThrow('model_config_operation_unknown'); expect(reads).toBe(0); expect(f.service.saveSystemOneConfig).toHaveBeenCalledExactlyOnceWith({}, 'user');
});
it('keeps same-owner partial registration and rejects any new owner or authorizer', () => {
  const f = fixture(); registerModelProviderIpc(f.ipc, f.service as never); expect(f.handlers.size).toBe(10);
  expect(() => registerModelProviderIpc(f.ipc, { ...f.service } as never)).toThrow('model_config_registrar_owner_conflict');
  expect(() => registerModelProviderIpc(f.ipc, f.service as never, () => undefined)).toThrow('model_config_registrar_owner_conflict');
  let calls = 0; const installed: string[] = []; const ipc = { handle(channel: string) { if (++calls === 2) throw Error('owned registration interruption'); installed.push(channel); } };
  expect(() => registerModelProviderIpc(ipc, f.service as never)).toThrow('owned registration interruption'); registerModelProviderIpc(ipc, f.service as never); expect(new Set(installed).size).toBe(10); expect(installed).toHaveLength(10);
});
it('rejects missing runtime before caller input and preserves actual thrown service identity', async () => {
  const handlers = new Map<string, IpcHandlerListener>(); registerModelProviderIpc({ handle(channel, listener) { handlers.set(channel, listener); } });
  let reads = 0; const input = Object.defineProperty({}, 'providerId', { get() { reads++; return 'owned'; } });
  await expect(handlers.get('desktop:saveModelConfig')!({} as never, input)).rejects.toThrow('model_config_runtime_unavailable'); expect(reads).toBe(0);
  const f = fixture(), error = Error('actual producer error'); f.service.getModelConfig.mockImplementation(() => { throw error; }); await expect(f.call('getModelConfig')).rejects.toBe(error);
});

it('uses intrinsic native Promise continuation without reading an own then accessor', async () => {
  const f = fixture(); let reads = 0;
  const returned = Object.defineProperty(Promise.resolve(snapshot()), 'then', { get() { reads++; throw Error('owned then getter'); } });
  let calls = 0; f.service.getModelConfig = (() => { calls++; return returned; }) as never;
  await expect(f.call('getModelConfig')).resolves.toEqual(snapshot());
  expect(reads).toBe(0); expect(calls).toBe(1);
});
it('rejects unknown wire input fields before calling the producer and without accessing their getters', async () => {
  const f = fixture(); let reads = 0;
  const input = Object.defineProperty({ providerId: 'owned' }, 'extra', { enumerable: true, get() { reads++; return 'unsafe'; } });
  await expect(f.call('saveModelConfig', input)).rejects.toThrow('model_config_input_invalid');
  expect(reads).toBe(0); expect(f.service.saveModelConfig).not.toHaveBeenCalled();
});

it('captures the native actor once per original event and isolates concurrent calls', async () => {
  const first = { actorId: 'first' }, second = { actorId: 'second' };
  const authorize = vi.fn((event: unknown) => ({ requestSource: 'user' as const, actorId: (event as typeof first).actorId }));
  const f = fixture(authorize); const seen: Array<{ input: unknown; actor: unknown; source: unknown }> = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.service.saveModelConfig.mockImplementation((async (input: unknown, actor: unknown, source: unknown) => {
    seen.push({ input, actor, source }); await gate; return snapshot();
  }) as never);
  const handler = f.handlers.get('desktop:saveModelConfig')!;
  const a = handler(first as never, { providerId: 'first' }), b = handler(second as never, { providerId: 'second' });
  release(); await Promise.all([a, b]);
  expect(authorize.mock.calls).toEqual([[first], [second]]);
  expect(seen).toEqual([
    { input: { providerId: 'first' }, actor: { requestSource: 'user', actorId: 'first' }, source: 'user' },
    { input: { providerId: 'second' }, actor: { requestSource: 'user', actorId: 'second' }, source: 'user' },
  ]);
});

it('rejects a native Promise with accessor constructor without reading the getter', async () => {
  const f = fixture(); let reads = 0;
  const returned = Object.defineProperty(Promise.resolve(snapshot()), 'constructor', { get() { reads++; throw Error('owned constructor getter'); } });
  f.service.getModelConfig = (() => returned) as never;
  await expect(f.call('getModelConfig')).rejects.toThrow('model_config_operation_unknown');
  expect(reads).toBe(0);
});
