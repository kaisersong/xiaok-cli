// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { registerRuntimeActionIpc } from '../../electron/runtime-action-typed-ipc.js';
import { createDesktopRuntimeActionService } from '../../electron/runtime-action-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
type Case = { channel: string; args: unknown[]; value: unknown; error: string; register(ipc: IpcHandleRegistrar, producer: IpcHandlerListener): void };
const cases: Case[] = ['start', 'stop', 'restart', 'resumeWorkflowRun'].map(method => ({
  channel: 'desktop:kswarm:' + method,
  args: method === 'resumeWorkflowRun' ? [{ projectId: 'owned', workflowRunId: 'owned-run' }] : [],
  value: method === 'resumeWorkflowRun' ? { restored: false, reason: 'not_found', future: { kept: true } } : undefined,
  error: 'runtime_action_projection_unavailable',
  register: (ipc: IpcHandleRegistrar, producer: IpcHandlerListener) => registerRuntimeActionIpc(ipc, new Map([['desktop:kswarm:' + method, producer]])),
}));
function handler(row: Case, producer: IpcHandlerListener) {
  const listeners = new Map<string, IpcHandlerListener>();
  row.register({ handle: (name, listener) => listeners.set(name, listener) }, producer);
  return () => listeners.get(row.channel)!({} as never, ...row.args);
}
it('keeps exactly the original four Main channels', () => { expect(cases).toHaveLength(4); expect(new Set(cases.map(row => row.channel)).size).toBe(4); });
for (const row of cases) {
  for (const kind of ['constructor', 'species']) it(row.channel + ' rejects ' + kind + ' before getters without retry', async () => {
    let calls = 0, reads = 0;
    const raw = Promise.resolve(row.value);
    if (kind === 'constructor') Object.defineProperty(raw, 'constructor', { configurable: true, get() { reads++; return Promise; } });
    const invoke = handler(row, () => { calls++; return raw; });
    const species = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!;
    let pending: unknown;
    try {
      if (kind === 'species') Object.defineProperty(Promise, Symbol.species, { configurable: true, get() { reads++; return Promise; } });
      pending = invoke();
    } finally { Object.defineProperty(Promise, Symbol.species, species); }
    await expect(pending).rejects.toThrow(row.error);
    expect(calls).toBe(kind === 'species' ? 0 : 1); expect(reads).toBe(0);
  });
  for (const kind of ['normal', 'ownThen', 'ownConstructor', 'rejection']) it(row.channel + ' preserves ' + kind + ' with one producer call', async () => {
    let calls = 0, reads = 0;
    const business = Error('actual-producer-business-error');
    const raw = kind === 'rejection' ? Promise.reject(business) : Promise.resolve(row.value);
    if (kind === 'ownThen') Object.defineProperty(raw, 'then', { configurable: true, get() { reads++; throw Error('own then executed'); } });
    if (kind === 'ownConstructor') Object.defineProperty(raw, 'constructor', { configurable: true, value: Promise });
    const invoke = handler(row, () => { calls++; return raw; });
    if (kind === 'rejection') {
      await expect(invoke()).rejects.toBe(business);
    } else expect(await invoke()).toEqual(row.value);
    expect(calls).toBe(1); expect(reads).toBe(0);
  });
  it(row.channel + ' uses captured native then without reading its call accessor', async () => {
    let calls = 0, reads = 0;
    const raw = Promise.resolve(row.value), invoke = handler(row, () => { calls++; return raw; });
    const then = Promise.prototype.then, original = Object.getOwnPropertyDescriptor(then, 'call'), nativeCall = Function.prototype.call;
    let pending: unknown;
    try { Object.defineProperty(then, 'call', { configurable: true, get() { reads++; return nativeCall; } }); pending = invoke(); }
    finally { if (original) Object.defineProperty(then, 'call', original); else Reflect.deleteProperty(then, 'call'); }
    expect(await pending).toEqual(row.value); expect(reads).toBe(0); expect(calls).toBe(1);
  });
}

function service() {
  const ops = { start: vi.fn((): unknown => Promise.resolve(undefined)), stop: vi.fn((): unknown => Promise.resolve(undefined)), restart: vi.fn((): unknown => Promise.resolve(undefined)), resumeWorkflowRun: vi.fn((_input: { projectId: string; workflowRunId: string }): unknown => Promise.resolve({ restored: false, reason: 'invalid_input' })) };
  return { ops, facade: createDesktopRuntimeActionService(ops) };
}
it.each(['start', 'stop', 'restart', 'resumeWorkflowRun'] as const)('actual %s facade denies absent/agent/scheduler before dependency', async method => {
  const f = service();
  for (const source of [undefined, 'agent', 'scheduler']) await expect(Reflect.apply(f.facade[method], f.facade, method === 'resumeWorkflowRun' ? [{ projectId: 'owned', workflowRunId: 'owned-run' }, source] : [source])).rejects.toThrow('runtime_action_source_forbidden');
  for (const op of Object.values(f.ops)) expect(op).not.toHaveBeenCalled();
});
it.each(['start', 'stop', 'restart', 'resumeWorkflowRun'] as const)('actual %s facade projects synchronous and async dependency secrets to fixed failure', async method => {
  const f = service();
  const invoke = () => Reflect.apply(f.facade[method], f.facade, method === 'resumeWorkflowRun' ? [{ projectId: 'owned', workflowRunId: 'owned-run' }, 'user'] : ['user']);
  f.ops[method].mockImplementationOnce(() => { throw Error('owned-sensitive-marker'); }); await expect(invoke()).rejects.toThrow('runtime_action_failed');
  f.ops[method].mockImplementationOnce(() => Promise.reject(Error('owned-sensitive-marker'))); await expect(invoke()).rejects.toThrow('runtime_action_failed'); expect(f.ops[method]).toHaveBeenCalledTimes(2);
});
it('actual resume facade preserves empty string invalid_input and captures before getters', async () => {
  const f = service(); expect(await f.facade.resumeWorkflowRun({ projectId: '', workflowRunId: '' }, 'user')).toEqual({ restored: false, reason: 'invalid_input' });
  let reads = 0; const input = Object.defineProperty({ workflowRunId: 'owned' }, 'projectId', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(f.facade.resumeWorkflowRun(input, 'user')).rejects.toThrow('runtime_action_input_invalid'); expect(reads).toBe(0); expect(f.ops.resumeWorkflowRun).toHaveBeenCalledTimes(1);
});
it('actual registrar detaches producer map bindings and owns idempotent registration', async () => {
  const listeners = new Map<string, IpcHandlerListener>(); const ipc = { handle: (name: string, listener: IpcHandlerListener) => listeners.set(name, listener) };
  const original = vi.fn(() => Promise.resolve(undefined)), later = vi.fn(() => Promise.resolve(undefined)), producers = new Map([['desktop:kswarm:start', original]]);
  registerRuntimeActionIpc(ipc, producers); producers.set('desktop:kswarm:start', later); registerRuntimeActionIpc(ipc, producers);
  await listeners.get('desktop:kswarm:start')!({} as never); expect(original).toHaveBeenCalledTimes(1); expect(later).not.toHaveBeenCalled(); expect(() => registerRuntimeActionIpc(ipc, new Map(producers))).toThrow('runtime_action_registrar_owner_conflict');
});
