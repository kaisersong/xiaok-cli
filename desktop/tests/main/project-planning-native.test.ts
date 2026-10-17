// Post-application only; new production module imported. Not native SDK qualification.
// @vitest-environment node
import { expect, it, beforeEach } from 'vitest';
import { registerProjectPlanningIpc } from '../../electron/project-planning-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const NativePromise = Promise;
const input = { projectId: '', projectName: 'Owned', goal: '', requirements: '', planningGuidance: '', poAgent: '', members: [], startPolicy: 'plan_only' };
beforeEach(resetIpcSchemaRegistryForTests);
function boundary(producer: IpcHandlerListener) {
  let listener!: IpcHandlerListener;
  const gate = new DesktopShutdownGate(), ipc = new ShutdownAwareIpcMain({ handle(_name, value) { listener = value; } }, gate);
  registerProjectPlanningIpc(ipc, producer);
  return { gate, invoke: (...args: unknown[]) => listener({} as never, ...args) };
}
it('queued ACK preserves empty strings, policy and exact members; original token stays until producer settles', async () => {
  let release!: () => void, received: unknown;
  const hold = new NativePromise<void>(resolve => { release = resolve; });
  const f = boundary(async (_event, value) => { received = value; await hold; return { ok: true, status: 'queued' }; });
  const pending = f.invoke(input); expect(received).toEqual(input); expect(f.gate.outstanding).toBe(1);
  f.gate.close(); const drain = f.gate.drain(5000); release(); expect(await pending).toEqual({ ok: true, status: 'queued' });
  expect(await drain).toBe(true); expect(f.gate.outstanding).toBe(0);
});
it('surplus tuple denies before queue; closed gate denies work', async () => {
  let effects = 0; const f = boundary(async () => { effects++; return { ok: true, status: 'queued' }; });
  await expect(f.invoke(input, undefined)).rejects.toThrow('project_planning_input_invalid'); expect(effects).toBe(0);
  f.gate.close(); await expect(f.invoke(input)).rejects.toThrow('shutting_down'); expect(effects).toBe(0);
});
it.each(['thenable', 'subclass', 'proxy', 'constructor-getter', 'constructor-value', 'prototype', 'own-then'])('raw producer %s is checked before assimilation', async kind => {
  let reads = 0, raw: unknown = NativePromise.resolve({ ok: true, status: 'queued' });
  if (kind === 'thenable') raw = { get then() { reads++; throw Error('owned-then'); } };
  if (kind === 'subclass') raw = new (class extends NativePromise<object> {})(resolve => resolve({ ok: true, status: 'queued' }));
  if (kind === 'proxy') raw = new Proxy(raw as object, { get() { reads++; throw Error('owned-proxy'); } });
  if (kind === 'constructor-getter') Object.defineProperty(raw, 'constructor', { get() { reads++; throw Error('owned-constructor'); } });
  if (kind === 'constructor-value') Object.defineProperty(raw, 'constructor', { value: {} });
  if (kind === 'prototype') Object.setPrototypeOf(raw, {});
  if (kind === 'own-then') Object.defineProperty(raw, 'then', { get() { reads++; throw Error('owned-own-then'); } });
  const f = boundary(() => raw);
  if (kind === 'own-then') expect(await f.invoke(input)).toEqual({ ok: true, status: 'queued' });
  else await expect(f.invoke(input)).rejects.toThrow('project_planning_projection_unavailable');
  expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each(['getter', 'value'])('global species %s prevents true async producer effect and orphan rejection', async kind => {
  let effects = 0, reads = 0; const orphan: unknown[] = [], observe = (reason: unknown) => { orphan.push(reason); };
  const f = boundary(async () => { effects++; await undefined; throw Error('owned-inner'); });
  const descriptor = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!; process.on('unhandledRejection', observe);
  try {
    let pending: unknown;
    try { Object.defineProperty(NativePromise, Symbol.species, kind === 'getter' ? { configurable: true, get() { reads++; return NativePromise; } } : { configurable: true, value: NativePromise }); pending = f.invoke(input); }
    finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); }
    await expect(pending).rejects.toThrow('project_planning_projection_unavailable');
    await new NativePromise<void>(resolve => setImmediate(resolve)); await new NativePromise<void>(resolve => setImmediate(resolve));
    expect(effects).toBe(0); expect(reads).toBe(0); expect(orphan).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); process.removeListener('unhandledRejection', observe); }
});
