// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { registerLoopCurrentViewIpc, LOOP_CURRENT_VIEW_CHANNELS } from '../../electron/loop-current-view-ipc.js';
import type { LoopCurrentViews } from '../../electron/loop-current-views.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { AUTOMATION_RUN_HISTORY_SCHEMA } from '../../shared/loop-current-view-ipc-contract.js';

afterEach(() => resetIpcSchemaRegistryForTests());
const event = {} as Parameters<IpcHandlerListener>[0];
const list = LOOP_CURRENT_VIEW_CHANNELS.listRuns, history = LOOP_CURRENT_VIEW_CHANNELS.getRunHistory;
function registrar() {
  const handlers = new Map<string, IpcHandlerListener>();
  const ipc: IpcHandleRegistrar = { handle(channel, fn) { handlers.set(channel, fn); } };
  return { ipc, handlers };
}
const row = () => ({ id: 'run', loopId: 'loop', status: 'running' as const,
  trigger: JSON.parse('{"kind":"historical_custom","permission":true,"nested":{"legacy":[1,null,false]},"__proto__":{"ownHistoricalData":true}}'),
  evidenceIds: [], startedAt: 1, updatedAt: 1, businessState: 'running' as const });
it('registers exactly the original two1/0 tuple channels and real completion/recovery effects', () => {
  const f = registrar(); registerLoopCurrentViewIpc(f.ipc, {} as LoopCurrentViews, () => false);
  expect(f.handlers.size).toBe(2);
  for (const channel of [list, history]) {
    expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({ sourceFile: 'desktop/electron/loop-current-view-ipc.ts', payloadMode: 'tuple', rolloutRound: 8 });
    expect(IPC_SCHEMA_REGISTRY.get(channel)!.riskTags).toEqual(['fs-read', 'network', 'external-process', 'exec', 'capability-token', 'issues-token', 'internal-mutation', 'fs-write-userData']);
  }
});
it('checks frame and original arity ahead of Proxy/serializer access and actual owner calls', async () => {
  const f = registrar(), fn = vi.fn(); let effects = 0;
  const value = new Proxy({}, { ownKeys() { effects++; throw Error('never'); } });
  registerLoopCurrentViewIpc(f.ipc, { getLoopRuns: fn, getRunHistory: fn } as unknown as LoopCurrentViews, e => e === event);
  await expect(Promise.resolve().then(() => f.handlers.get(list)!({} as typeof event, value))).rejects.toThrow('loop_view_ipc_denied');
  await expect(Promise.resolve().then(() => f.handlers.get(history)!(event, value))).rejects.toThrow('loop_view_ipc_denied');
  await expect(Promise.resolve().then(() => f.handlers.get(list)!(event, value))).rejects.toThrow('loop_view_ipc_input');
  await expect(Promise.resolve().then(() => f.handlers.get(list)!(event, ''))).rejects.toThrow('loop_verification_execution_identity');
  expect(fn).not.toHaveBeenCalled(); expect(effects).toBe(0);
});
for (const mode of ['development', 'production']) {
  it(`returns independent full historical JSON preserving every data key and own proto slot in ${mode}`, async () => {
    vi.stubEnv('NODE_ENV', mode);
    try {
      const f = registrar(), original = [row()];
      registerLoopCurrentViewIpc(f.ipc, { getLoopRuns: async () => original } as unknown as LoopCurrentViews, () => true);
      const value = await f.handlers.get(list)!(event, 'loop') as typeof original;
      expect(value).not.toBe(original); expect(value[0]).not.toBe(original[0]); expect(value[0].trigger).toEqual(original[0].trigger);
      expect(Object.getPrototypeOf(value[0].trigger)).toBe(Object.prototype); expect(Object.hasOwn(value[0].trigger, '__proto__')).toBe(true);
      original[0].trigger.nested.legacy[0] = 'MUTATED'; expect(value[0].trigger.nested.legacy[0]).toBe(1);
      expect(value[0].trigger.permission).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
}
it('keeps the validated snapshot across a real asynchronous delivery gap while the producer alias changes', async () => {
  const output = [row()]; let delivery!: IpcHandlerListener;
  const ipc: IpcHandleRegistrar = { handle(channel, listener) {
    if (channel === list) delivery = async (event, ...args) => {
      const value = await listener(event, ...args);
      output[0].trigger.permission = false;
      return value;
    };
  } };
  registerLoopCurrentViewIpc(ipc, { getLoopRuns: async () => output } as unknown as LoopCurrentViews, () => true);
  const value = await delivery(event, 'loop') as typeof output;
  expect(output[0].trigger.permission).toBe(false); expect(value[0].trigger.permission).toBe(true);
});
it('rejects outer unknown fields and unsafe nested historical values without calling getters or serializers', async () => {
  let effects = 0; const getter = row(); Object.defineProperty(getter.trigger, 'bad', { enumerable: true, get() { effects++; return 1; } });
  const values = [[{ ...row(), forged: true }], [{ ...row(), trigger: { kind: 'manual', unexpectedFunction() { effects++; } } }], [getter],
    [new Proxy(row(), { ownKeys() { effects++; throw Error('never'); } })], [{ ...row(), trigger: { kind: 'manual', toJSON() { effects++; return {}; } } }]];
  for (const output of values) {
    const f = registrar(); registerLoopCurrentViewIpc(f.ipc, { getLoopRuns: async () => output } as unknown as LoopCurrentViews, () => true);
    await expect(f.handlers.get(list)!(event, 'loop')).rejects.toThrow('loop_view_projection_unavailable');
  }
  expect(effects).toBe(0);
});
it('keeps the empty history tuple and all three original automation populations/optional facts', async () => {
  const f = registrar(), rows = ['loop', 'notify', 'agent_task'].map((kind, i) => ({ id: `row${i}`, automationKind: kind,
    title: kind, startedAt: 1, status: 'running', historyStatus: 'running', schedulerStatus: 'legacy scheduler fact',
    loopRunId: undefined, finishedAt: undefined, failureKind: undefined }));
  const fn = vi.fn(async () => rows); registerLoopCurrentViewIpc(f.ipc, { getRunHistory: fn } as unknown as LoopCurrentViews, () => true);
  expect(await f.handlers.get(history)!(event)).toEqual(rows); expect(fn.mock.calls[0]).toEqual([]);
  for (const value of rows) expect(AUTOMATION_RUN_HISTORY_SCHEMA.safeParse(value).success).toBe(true);
});
it.each([0, 1])('never changes first owner/auth after an actual registration failure with %s handlers installed', async count => {
  const handlers = new Map<string, IpcHandlerListener>(); let i = 0;
  const ipc: IpcHandleRegistrar = { handle(channel, fn) { if (i++ === count) throw Error('actual registration failure'); handlers.set(channel, fn); } };
  const service = { getLoopRuns: async () => [row()] } as unknown as LoopCurrentViews, authorize = () => false;
  expect(() => registerLoopCurrentViewIpc(ipc, service, authorize)).toThrow('actual registration failure');
  expect(handlers.size).toBe(count);
  expect(() => registerLoopCurrentViewIpc(ipc, service, () => true)).toThrow('loop_view_ipc_registrar_owner_conflict');
  for (const handler of handlers.values()) await expect(Promise.resolve().then(() => handler(event, 'loop'))).rejects.toThrow('loop_view_ipc_denied');
  expect(handlers.size).toBe(count);
});
