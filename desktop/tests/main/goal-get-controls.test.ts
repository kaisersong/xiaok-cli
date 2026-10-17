// @vitest-environment node
// Finite SOURCE transport controls; never native factory/report/issuer qualification.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-get', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { goalGetFixture, projection } from '../support/goal-get-fixture.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import type { GoalGetDto } from '../../shared/goal-get-ipc-contract.js';
const NativePromise = Promise;
const fixtures: Array<Awaited<ReturnType<typeof goalGetFixture>>> = [];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
async function fixture(read?: Parameters<typeof goalGetFixture>[0], enabled = true) {
  const f = await goalGetFixture(read, enabled); fixtures.push(f); return f;
}
const tick = () => new NativePromise<void>(resolve => setImmediate(resolve));
it('original registrar owns a one-tuple, complete nullable public projection and the original Services delegate', async () => {
  const row = projection(), f = await fixture(async function () { return row; });
  expect(IPC_SCHEMA_REGISTRY.get('desktop:goal:get')).toMatchObject({ payloadMode: 'tuple', sourceFile: 'desktop/electron/goal-get-typed-ipc.ts' });
  expect(await f.invoke([{ threadId: ' thread ', requestSource: 'agent', authority: {} }])).toEqual(row);
  expect(f.calls).toEqual(['thread']); expect(f.gate.outstanding).toBe(0);
  // Type contract in both directions; never a private SDK authority assertion.
  const publicType: DesktopGoalProjection | null = row satisfies GoalGetDto;
  const dto: GoalGetDto | null = publicType; expect(dto).toEqual(row);
});
it('original null projection remains null', async () => {
  const f = await fixture(async function () { return null; });
  expect(await f.invoke()).toBeNull(); expect(f.calls).toEqual(['thread']);
});
it.each(['active', 'paused', 'blocked', 'complete', 'cancelled'] as const)('keeps the public GoalState %s contract and all optional state fields', async status => {
  const row = projection();
  row.state = { ...row.state, status, forkedFromGoalId: 'historical', completionCriterion: 'criterion',
    terminalReason: 'reason', pendingCompletionIntentId: 'pending', blockerFingerprint: 'blocker',
    budgetLimits: { turnLimit: 20, tokenLimit: 100, activeWallClockLimitMs: 5000 } };
  const f = await fixture(async function () { return row; });
  expect(await f.invoke()).toEqual(row); expect(f.calls).toHaveLength(1);
});
const completions: Array<DesktopGoalProjection['currentCompletion']> = [undefined, { kind: 'ordinary' }, { kind: 'unavailable' },
  ...(['binding_required', 'binding_pending', 'binding_mismatch', 'needs_revalidation', 'publication_pending', 'verified'] as const)
    .map(state => ({ kind: 'protected' as const, state }))];
it.each(completions.map(currentCompletion => ({ currentCompletion })))('captures completion DTO $currentCompletion without invoking any protected producer', async ({ currentCompletion }) => {
  const row = projection(); if (currentCompletion === undefined) delete row.currentCompletion; else row.currentCompletion = currentCompletion;
  const f = await fixture(async function () { return row; }); expect(await f.invoke()).toEqual(row);
});
it.each([undefined, 'waiting_children', 'children_need_attention'] as const)('preserves optional waitingReason %s', async waitingReason => {
  const row = projection(); if (waitingReason !== undefined) row.waitingReason = waitingReason;
  const f = await fixture(async function () { return row; }); expect(await f.invoke()).toEqual(row);
});
it.each(['armed', 'disarmed'] as const)('preserves activation=%s as data, without granting execution', async activation => {
  const row = { ...projection(), activation }, f = await fixture(async function () { return row; });
  expect(await f.invoke()).toEqual(row);
});
const badInputs: Array<{ args: unknown[]; code: string }> = [
  { args: [], code: 'goal_get_input_invalid' },
  { args: [{ threadId: 'thread' }, {}], code: 'goal_get_input_invalid' },
  { args: [undefined], code: 'goal_get_input_invalid' },
  { args: [{ threadId: '' }], code: 'invalid_goal_thread_id' },
  { args: [{ threadId: 'x'.repeat(201) }], code: 'invalid_goal_thread_id' },
  { args: [{ threadId: 1 }], code: 'invalid_goal_thread_id' },
];
it.each(badInputs)('original registrar rejects a full malformed tuple $code before the delegated producer', async ({ args, code }) => {
  const f = await fixture(); await expect(f.invoke(args)).rejects.toThrow(code);
  expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it('capture rejects payload accessors/proxies without executing their traps', async () => {
  const f = await fixture(); let reads = 0;
  const accessor = Object.defineProperty({}, 'threadId', { enumerable: true, get() { reads++; return 'thread'; } });
  const proxy = new Proxy({ threadId: 'thread' }, { ownKeys() { reads++; return ['threadId']; } });
  for (const input of [accessor, proxy]) await expect(f.invoke([input])).rejects.toThrow('goal_get_input_invalid');
  expect(reads).toBe(0); expect(f.calls).toEqual([]);
});
it('actual Main finer authorizer rejects recorder and absent authorizer before input inspection', async () => {
  const f = await fixture(); let reads = 0;
  const input = Object.defineProperty({}, 'threadId', { enumerable: true, get() { reads++; return 'thread'; } });
  await expect(f.invoke([input], { sender: f.recorder, senderFrame: f.frame })).rejects.toThrow('goal_get_sender_forbidden');
  const missing = await fixture(undefined, false); await expect(missing.invoke([input])).rejects.toThrow('goal_get_sender_forbidden');
  expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(missing.calls).toEqual([]);
});
it('actual Main coarse authority rejects wrong frame/URL/destroyed sender before producer', async () => {
  const f = await fixture();
  await expect(f.invoke(undefined, { sender: f.target, senderFrame: { url: f.frame.url } })).rejects.toThrow('desktop_user_sender_forbidden');
  f.frame.url = 'https://untrusted.invalid/'; await expect(f.invoke()).rejects.toThrow('desktop_user_sender_forbidden');
  f.destroy(); await expect(f.invoke()).rejects.toThrow('desktop_user_sender_forbidden');
  expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each([false, true])('real async transport port is not started under ambient species (rejecting=%s)', async rejecting => {
  let effects = 0, getters = 0;
  const f = await fixture(async function () { effects++; if (rejecting) throw Error('unstarted-inner-rejection'); return projection(); });
  const saved = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!;
  const orphans: unknown[] = [], observe = (reason: unknown) => orphans.push(reason);
  process.on('unhandledRejection', observe);
  try {
    let pending: Promise<unknown>;
    Object.defineProperty(NativePromise, Symbol.species, { configurable: saved.configurable, enumerable: saved.enumerable, get() { getters++; return NativePromise; } });
    try { pending = f.invoke(); } finally { Object.defineProperty(NativePromise, Symbol.species, saved); }
    await expect(pending!).rejects.toThrow('goal_get_projection_unavailable'); await tick(); await tick();
    expect(effects).toBe(0); expect(getters).toBe(0); expect(f.calls).toEqual([]); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, saved); process.off('unhandledRejection', observe); }
});
it.each([false, true])('owns held actual async transport through shutdown (rejecting=%s)', async rejecting => {
  let release!: () => void; const held = new NativePromise<void>(resolve => { release = resolve; });
  const error = Error('original-goal-read-failure');
  const f = await fixture(async function () { await held; if (rejecting) throw error; return projection(); });
  const orphans: unknown[] = [], observe = (reason: unknown) => orphans.push(reason);
  process.on('unhandledRejection', observe);
  const pending = f.invoke(), result = pending.then(value => ({ value }), reason => ({ reason }));
  try {
    expect(f.calls).toEqual(['thread']); expect(f.gate.outstanding).toBe(1); f.gate.close();
    await expect(f.invoke()).rejects.toThrow(/shutting_down/); expect(f.calls).toHaveLength(1);
    let drained = false; const drain = f.gate.drain(1500).then(value => { drained = value; return value; });
    await tick(); expect(drained).toBe(false); release();
    const settled = await result;
    if (rejecting) expect(settled).toEqual({ reason: error }); else expect(settled).toEqual({ value: projection() });
    expect(await drain).toBe(true); await tick(); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { release(); await result; process.off('unhandledRejection', observe); }
});
it('rechecks real Main authority after producer settlement before delivering output', async () => {
  let release!: () => void; const held = new NativePromise<void>(resolve => { release = resolve; });
  const f = await fixture(async function () { await held; return projection(); });
  const pending = f.invoke(); f.frame.url = 'https://untrusted.invalid/'; release();
  await expect(pending).rejects.toThrow('goal_get_sender_forbidden'); expect(f.calls).toEqual(['thread']); expect(f.gate.outstanding).toBe(0);
});
it('output capture rejects private/accessor/proxy DTOs without exposing data or consulting getters', async () => {
  let reads = 0;
  const accessor = Object.defineProperty(projection(), 'currentCompletion', { enumerable: true, get() { reads++; return { kind: 'ordinary' }; } });
  const proxy = new Proxy(projection(), { ownKeys() { reads++; return []; } });
  for (const output of [{ ...projection(), controller: 'private-marker' }, accessor, proxy]) {
    const f = await fixture(async function () { return output; });
    await expect(f.invoke()).rejects.toThrow('goal_get_projection_unavailable'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
  }
  expect(reads).toBe(0);
});

