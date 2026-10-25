// @vitest-environment node
import { types } from 'node:util';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDesktopRuntimeActionService } from '../../electron/runtime-action-service.js';
import { registerRuntimeActionIpc } from '../../electron/runtime-action-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import type { RuntimeActionMethod } from '../../shared/runtime-actions-ipc-contract.js';
const NativePromise = Promise;
const methods = ['start', 'stop', 'restart', 'resumeWorkflowRun'] as const;
const resumeInput = { projectId: 'owned', workflowRunId: 'owned-run' };
const resumed = { restored: false, reason: 'not_found', future: { kept: true } };
beforeEach(resetIpcSchemaRegistryForTests);
function fixture(method: RuntimeActionMethod, operation: () => unknown) {
  // Only the external SDK operation is substituted, never facade or registrar.
  const ops = { start: vi.fn(operation), stop: vi.fn(operation), restart: vi.fn(operation), resumeWorkflowRun: vi.fn((_input: typeof resumeInput) => operation()) };
  const facade = createDesktopRuntimeActionService(ops);
  const producers = new Map<string, IpcHandlerListener>([
    ['desktop:kswarm:start', () => facade.start('user')],
    ['desktop:kswarm:stop', () => facade.stop('user')],
    ['desktop:kswarm:restart', () => facade.restart('user')],
    ['desktop:kswarm:resumeWorkflowRun', (_event, input) => facade.resumeWorkflowRun(input, 'user')],
  ]); // same production wiring as main.ts:666-676; no async test wrapper.
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle: (channel, listener) => listeners.set(channel, listener) }, gate);
  registerRuntimeActionIpc(ipc, producers);
  return { ops, gate, invoke: () => listeners.get('desktop:kswarm:' + method)!({} as never, ...(method === 'resumeWorkflowRun' ? [resumeInput] : [])) };
}
const turn = () => new NativePromise<void>(resolve => setImmediate(resolve));
it.each(methods)('actual %s facade -> registrar normal call starts SDK exactly once and retains its token until settlement', async method => {
  let release!: (value: unknown) => void;
  const raw = new NativePromise<unknown>(resolve => { release = resolve; });
  const f = fixture(method, () => raw), pending = f.invoke();
  expect(types.isPromise(pending)).toBe(true);
  expect(f.ops[method]).toHaveBeenCalledTimes(1);
  for (const other of methods.filter(name => name !== method)) expect(f.ops[other]).not.toHaveBeenCalled();
  if (method === 'resumeWorkflowRun') expect(f.ops.resumeWorkflowRun).toHaveBeenCalledExactlyOnceWith(resumeInput);
  expect(f.gate.outstanding).toBe(1);
  release(method === 'resumeWorkflowRun' ? resumed : undefined);
  expect(await pending).toEqual(method === 'resumeWorkflowRun' ? resumed : undefined);
  expect(f.gate.outstanding).toBe(0);
});
const speciesRows = methods.flatMap(method => (['getter', 'value'] as const).flatMap(species => (['fulfilled-sdk', 'rejecting-sdk'] as const).map(sdk => ({ method, species, sdk }))));
it.each(speciesRows)('actual $method facade -> registrar refuses ambient $species species before $sdk side effect and leaves no orphan rejection', async ({ method, species, sdk }) => {
  let reads = 0, sdkEffects = 0;
  const orphanMarker = Error(`owned-unstarted-${method}-${sdk}`);
  const f = fixture(method, () => {
    sdkEffects++; // external SDK launch witness; must remain zero under bad ambient species.
    return sdk === 'rejecting-sdk' ? NativePromise.reject(orphanMarker) : NativePromise.resolve(method === 'resumeWorkflowRun' ? resumed : undefined);
  });
  const descriptor = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!;
  const orphanRejections: unknown[] = [];
  const observe = (reason: unknown) => { orphanRejections.push(reason); };
  process.on('unhandledRejection', observe); // observes, does not silence Vitest's handler.
  let pending: unknown;
  try {
    try {
      Object.defineProperty(NativePromise, Symbol.species, species === 'getter'
        ? { configurable: true, get() { reads++; return NativePromise; } }
        : { configurable: true, value: NativePromise });
      pending = f.invoke(); // actual facade+registrar while ambient descriptor is invalid.
    } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); }
    // Only attach test observers after restoring the ambient descriptor.
    expect(types.isPromise(pending)).toBe(true);
    const outcome = await (pending as Promise<unknown>).then(value => ({ value, error: null as unknown }), error => ({ value: undefined, error }));
    await turn(); await turn(); // real Node event turns, no hand-emitted rejection event.
    expect(outcome.error).toBeInstanceOf(Error);
    expect((outcome.error as Error).message).toBe('runtime_action_projection_unavailable');
    expect(reads).toBe(0);
    expect(sdkEffects).toBe(0);
    for (const op of Object.values(f.ops)) expect(op).not.toHaveBeenCalled();
    expect(orphanRejections).toEqual([]);
    expect(f.gate.outstanding).toBe(0);
  } finally {
    Object.defineProperty(NativePromise, Symbol.species, descriptor);
    process.removeListener('unhandledRejection', observe);
  }
});
it.each(methods)('actual %s facade -> registrar normal SDK rejection is observed once with fixed public error', async method => {
  const orphans: unknown[] = [], observe = (reason: unknown) => { orphans.push(reason); };
  process.on('unhandledRejection', observe);
  try {
    const f = fixture(method, () => NativePromise.reject(Error('owned-sdk-secret-marker')));
    await expect(f.invoke()).rejects.toThrow('runtime_action_failed');
    await turn(); await turn();
    expect(f.ops[method]).toHaveBeenCalledTimes(1);
    expect(orphans).toEqual([]);
    expect(f.gate.outstanding).toBe(0);
  } finally { process.removeListener('unhandledRejection', observe); }
});
