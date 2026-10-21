// @vitest-environment node
import { expect, it } from 'vitest';
import { registerPrinciplesIpc } from '../../electron/principles-typed-ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';

function fixture() {
  const handlers = new Map<string, IpcHandlerListener>();
  const store = { list: () => [] as unknown[], save: () => Promise.resolve({ success: true }), delete: () => Promise.resolve({ success: true }) };
  const ipc = { handle(channel: string, listener: IpcHandlerListener) { handlers.set(channel, listener); } };
  registerPrinciplesIpc(ipc, store as never);
  return { handlers, store, ipc, call: (method: string, ...args: unknown[]) => handlers.get(`desktop:${method}`)!({} as never, ...args) };
}
const input = () => ({ id: 'own', content: 'Own content', scenarios: ['planning'], source: 'manual', enabled: true, createdAt: 1, updatedAt: 1 });

it('registers all original three exact tuple schemas and own effect metadata', () => {
  resetIpcSchemaRegistryForTests(); fixture();
  for (const method of ['listPrinciples', 'savePrinciple', 'deletePrinciple']) {
    expect(IPC_SCHEMA_REGISTRY.get(`desktop:${method}`)).toMatchObject({ rolloutRound: 20, payloadMode: 'tuple', inputStage: 'beforeHandler', riskTags: method === 'listPrinciples' ? ['fs-read'] : ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'internal-mutation'] });
  }
  resetIpcSchemaRegistryForTests();
});
it('refuses output getters and unknown acknowledgement fields without retrying the producer', async () => {
  const f = fixture(); let reads = 0, calls = 0;
  f.store.list = () => [Object.defineProperty({}, 'id', { enumerable: true, get() { reads++; return 'unsafe'; } })];
  await expect(f.call('listPrinciples')).rejects.toThrow('principles_projection_unavailable');
  f.store.save = (() => { calls++; return { success: true, extra: 'unsafe' }; }) as never;
  await expect(f.call('savePrinciple', input())).rejects.toThrow('principles_operation_unknown');
  expect(reads).toBe(0); expect(calls).toBe(1);
});
it('continues a native Promise intrinsically and rejects constructor accessors with zero getter reads', async () => {
  const f = fixture(); let reads = 0;
  const safe = Object.defineProperty(Promise.resolve({ success: true }), 'then', { get() { reads++; throw Error('unsafe own then'); } });
  f.store.save = () => safe;
  await expect(f.call('savePrinciple', input())).resolves.toEqual({ success: true });
  const unsafe = Object.defineProperty(Promise.resolve({ success: true }), 'constructor', { get() { reads++; throw Error('unsafe constructor'); } });
  f.store.save = () => unsafe;
  await expect(f.call('savePrinciple', input())).rejects.toThrow('principles_operation_unknown');
  expect(reads).toBe(0);
});
it('preserves owner identity and resumes a same-owner interrupted registration without duplicates', () => {
  const f = fixture(); registerPrinciplesIpc(f.ipc, f.store as never); expect(f.handlers.size).toBe(3);
  expect(() => registerPrinciplesIpc(f.ipc, { ...f.store } as never)).toThrow('principles_registrar_owner_conflict');
  let attempts = 0; const installed: string[] = [];
  const ipc = { handle(channel: string) { if (++attempts === 2) throw Error('owned interruption'); installed.push(channel); } };
  expect(() => registerPrinciplesIpc(ipc, f.store as never)).toThrow('owned interruption');
  registerPrinciplesIpc(ipc, f.store as never); expect(installed).toHaveLength(3); expect(new Set(installed).size).toBe(3);
});
