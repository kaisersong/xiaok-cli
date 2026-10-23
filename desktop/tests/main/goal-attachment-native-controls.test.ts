// @vitest-environment node
// Ordinary SOURCE transport controls only. Do not execute real native workflow/producers here.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-attachment', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { specs, fixture, output, mutation, prepared, type Spec } from '../support/goal-attachment-native-fixture.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const NativePromise = Promise, tick = () => new NativePromise<void>(resolve => setImmediate(resolve));
const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(async () => {
  const failures: unknown[] = [];
  try {
    for (const f of fixtures.splice(0)) {
      try { await f.close(); } catch (error) { failures.push(error); }
    }
  } finally {
    try { vi.restoreAllMocks(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'goal_attachment_all_fixture_cleanup_failed');
});
async function setup(...args: Parameters<typeof fixture>) { const f = await fixture(...args); fixtures.push(f); return f; }
it.each(specs)('$method original registrar preserves parser -> original Services -> afterRecovery -> public DTO/void', async spec => {
  const f = await setup(); expect(IPC_SCHEMA_REGISTRY.get('desktop:goal:' + spec.method)).toMatchObject({ payloadMode: 'tuple', sourceFile: 'desktop/electron/goal-attachment-native-typed-ipc.ts' });
  expect(await f.invoke(spec)).toEqual(output(spec));
  expect(f.calls).toEqual([{ api: spec.api, input: spec.method === 'ackTaskAttached' ? spec.input : { ...spec.input, requestSource: 'user' } }]);
  expect(f.gate.outstanding).toBe(0);
});
it('ack original trim and ignored extra data fields remain; only original semantic two fields reach delegate', async () => {
  const f = await setup(); await expect(f.invoke(specs[0], [{ threadId: ' thread ', attachmentId: ' attachment ', requestSource: 'scheduler', authority: {} }])).resolves.toBeUndefined();
  expect(f.calls).toEqual([{ api: 'ackGoalTaskAttached', input: { threadId: 'thread', attachmentId: 'attachment' } }]);
});
it('continue omitted legacy requestId stays omitted, never fabricated; supplied source is rejected by original parser', async () => {
  const f = await setup();
  await f.invoke(specs[2], [{ threadId: ' thread ' }]);
  expect(f.calls).toEqual([{ api: 'continueGoalNativeMutation', input: { threadId: 'thread', requestSource: 'user' } }]);
  await expect(f.invoke(specs[2], [{ threadId: 'thread', requestSource: 'agent' }])).rejects.toThrow('invalid_goal_native_input');
  expect(f.calls).toHaveLength(1);
});
it('recover accepts original nullable goal', async () => {
  const f = await setup(async function () { return { mutation: mutation(), goal: null }; });
  expect(await f.invoke(specs[1])).toEqual({ mutation: mutation(), goal: null });
});
it.each(specs)('$method rejects missing/surplus tuples/accessors/proxies before parser or Services', async spec => {
  const f = await setup(); let reads = 0;
  const accessor = Object.defineProperty({}, 'threadId', { enumerable: true, get() { reads++; return 'thread'; } });
  const proxy = new Proxy(spec.input, { ownKeys() { reads++; return []; } });
  for (const args of [[], [spec.input, {}], [accessor], [proxy]]) await expect(f.invoke(spec, args)).rejects.toThrow('goal_attachment_native_input_invalid');
  expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
const domainCases: Array<{ spec: Spec; input: unknown; code: string }> = [
  { spec: specs[0], input: undefined, code: 'invalid_goal_attachment' },
  { spec: specs[0], input: { threadId: 'thread', attachmentId: '' }, code: 'invalid_goal_attachment' },
  { spec: specs[0], input: { threadId: '', attachmentId: 'attachment' }, code: 'invalid_goal_thread_id' },
  { spec: specs[1], input: { threadId: 'thread', requestSource: 'user' }, code: 'invalid_goal_publication_field' },
  { spec: specs[1], input: undefined, code: 'invalid_goal_publication_input' },
  { spec: specs[2], input: { threadId: 'thread', requestId: 'wrong' }, code: 'invalid_goal_request_id' },
  { spec: specs[2], input: {}, code: 'invalid_goal_thread_id' },
  { spec: specs[3], input: { threadId: 'x'.repeat(201) }, code: 'invalid_goal_thread_id' },
];
it.each(domainCases)('keeps original $spec.method parser error $code, with zero coordinator calls', async ({ spec, input, code }) => {
  const f = await setup(); await expect(f.invoke(spec, [input])).rejects.toThrow(code); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(specs)('$method real Main denies recorder, absent finer, wrong frame and destroyed sender before raw payload getter', async spec => {
  const f = await setup(), missing = await setup(undefined, true, NativePromise.resolve(), false); let reads = 0;
  const payload = Object.defineProperty({}, 'threadId', { enumerable: true, get() { reads++; return 'thread'; } });
  await expect(f.invoke(spec, [payload], { sender: f.recorder, senderFrame: f.frame })).rejects.toThrow('goal_attachment_native_sender_forbidden');
  await expect(missing.invoke(spec, [payload])).rejects.toThrow('goal_attachment_native_sender_forbidden');
  await expect(f.invoke(spec, [payload], { sender: f.target, senderFrame: { url: f.frame.url } })).rejects.toThrow('desktop_user_sender_forbidden');
  f.destroy(); await expect(f.invoke(spec, [payload])).rejects.toThrow('desktop_user_sender_forbidden');
  expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(missing.calls).toEqual([]);
});
it.each(specs.flatMap(spec => [false, true].map(rejecting => ({ spec, rejecting }))))('$spec.method blocks real async port under ambient species (rejecting=$rejecting)', async ({ spec, rejecting }) => {
  let effects = 0, getters = 0;
  const f = await setup(async function (method) { effects++; if (rejecting) throw Error('unstarted-native-transport-port'); return output(method); });
  const descriptor = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!;
  const orphans: unknown[] = [], observe = (reason: unknown) => orphans.push(reason);
  process.on('unhandledRejection', observe);
  try {
    let pending: Promise<unknown>;
    Object.defineProperty(NativePromise, Symbol.species, { configurable: descriptor.configurable, enumerable: descriptor.enumerable, get() { getters++; return NativePromise; } });
    try { pending = f.invoke(spec); } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); }
    await expect(pending!).rejects.toThrow('goal_attachment_native_projection_unavailable'); await tick(); await tick();
    expect(effects).toBe(0); expect(getters).toBe(0); expect(f.calls).toEqual([]); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); process.off('unhandledRejection', observe); }
});
it.each(specs.flatMap(spec => [false, true].map(rejecting => ({ spec, rejecting }))))('$spec.method preserves original held recovery barrier and invocation token (rejecting=$rejecting)', async ({ spec, rejecting }) => {
  let release!: () => void; const recovery = new NativePromise<void>(resolve => { release = resolve; });
  const error = Error('original-native-transport-reject');
  const f = await setup(async function (method) { if (rejecting) throw error; return output(method); }, false, recovery);
  const orphans: unknown[] = [], observe = (reason: unknown) => orphans.push(reason); process.on('unhandledRejection', observe);
  const pending = f.invoke(spec), observed = pending.then(value => ({ value }), reason => ({ reason }));
  try {
    expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(1); f.gate.close();
    await expect(f.invoke(spec)).rejects.toThrow(/shutting_down/);
    let done = false; const drain = f.gate.drain(1500).then(value => { done = value; return value; });
    await tick(); expect(done).toBe(false); release();
    expect(await observed).toEqual(rejecting ? { reason: error } : { value: output(spec) });
    expect(f.calls).toHaveLength(1); expect(await drain).toBe(true); await tick(); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { release(); await observed; process.off('unhandledRejection', observe); }
});
it.each(specs)('$method authorizes output after a held admitted operation, without claiming view revoke cancels SDK work', async spec => {
  let release!: () => void; const held = new NativePromise<void>(resolve => { release = resolve; });
  const f = await setup(async function (method) { await held; return output(method); });
  const pending = f.invoke(spec); f.frame.url = 'https://untrusted.invalid/'; release();
  await expect(pending).rejects.toThrow('goal_attachment_native_sender_forbidden'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each(specs)('$method rejects private output and accessors before a success response', async spec => {
  let reads = 0;
  const value = output(spec);
  const privateOutput = spec.method === 'ackTaskAttached' ? { ok: true } : { ...(value as object), privateController: 'not-wire' };
  const accessor = Object.defineProperty({}, 'goal', { enumerable: true, get() { reads++; return value; } });
  for (const raw of [privateOutput, accessor]) {
    const f = await setup(async function () { return raw; });
    await expect(f.invoke(spec)).rejects.toThrow('goal_attachment_native_projection_unavailable'); expect(f.gate.outstanding).toBe(0);
  }
  expect(reads).toBe(0);
});
it.each([specs[1], specs[2], specs[3]])('$method original Services source rejects agent/scheduler even if invoked directly outside IPC', async spec => {
  const f = await setup();
  for (const requestSource of ['agent', 'scheduler']) expect(() => Reflect.apply(f.delegates[spec.api], undefined, [{ threadId: 'thread', requestSource }])).toThrow('goal_native_mutation_source');
  expect(f.calls).toEqual([]);
});
it('continue output excludes timeout/permissionRevision even though they exist in internal pending data', async () => {
  const f = await setup(async function () { return { goal: (output(specs[2]) as { goal: unknown }).goal, preparedTask: { ...prepared(), timeout: {}, permissionRevision: 1 } }; });
  await expect(f.invoke(specs[2])).rejects.toThrow('goal_attachment_native_projection_unavailable');
});

