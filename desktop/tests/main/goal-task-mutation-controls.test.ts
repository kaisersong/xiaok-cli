// @vitest-environment node
// R35 existing production registrar tests, SOURCE-before-safe: NO new typed module import.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-task-source-register', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} }, clipboard: {}, dialog: {}, shell: {} }));
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { METHODS, NativePromise, REQUEST_ID, fixture, payload, publicReply, definitionData, turn, type Reply } from '../support/goal-task-mutation-fixture.js';
const cleanup: Array<() => Promise<void>> = [];
beforeEach(resetIpcSchemaRegistryForTests); afterEach(async () => { const failures: unknown[] = []; for (const fn of cleanup.splice(0)) { try { await fn(); } catch (error) { failures.push(error); } } if (failures.length) throw new AggregateError(failures, 'ordinary_fixture_cleanup_failed'); });
async function setup(overrides: Parameters<typeof fixture>[0] = {}, omitFiner = false) { const f = await fixture(overrides, omitFiner); cleanup.push(f.close); return f; }
it.each(METHODS)('%s actual complete typed tuple and public reply through original semantic service', async method => {
  const f = await setup(); const reply = await f.invoke(method);
  expect(IPC_SCHEMA_REGISTRY.get('desktop:goal:' + method)).toMatchObject({ payloadMode: 'tuple', sourceFile: 'desktop/electron/goal-task-mutation-typed-ipc.ts' });
  expect(reply.goal.state.sessionId).toBe('thread'); expect(reply.preparedTask.attachmentSource).toEqual({ kind: 'request', requestId: REQUEST_ID });
  expect(f.calls).toEqual([{ method, input: payload(method), receiver: f.services }]); expect(f.gate.outstanding).toBe(0);
});
it.each(['create', 'replace'] as const)('%s original parser preserves verificationDefinition without executing any native delegate', async method => {
  const f = await setup(); const input = { ...payload(method), verificationDefinition: definitionData() };
  await f.invoke(method, [input]); expect(f.calls).toHaveLength(1);
  expect(f.calls[0].input).toMatchObject({ verificationDefinition: definitionData() }); expect(input.verificationDefinition).toEqual(definitionData());
  // Port sees normalized criteria DATA; this is NOT workflow/TaskHost/enrollment evidence.
  expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s keeps legacy missing requestId and trims thread/objective, deduplicates evidence', async method => {
  const f = await setup(); const input = method === 'resume' ? { threadId: ' thread ', turnLimit: 1 }
    : { threadId: ' thread ', objective: ' original ', completionCriterion: ' ', expectedEvidenceKinds: ['answer', 'answer'], turnLimit: 50 };
  await f.invoke(method, [input]); expect(f.calls[0].input).toEqual(method === 'resume' ? { threadId: 'thread', turnLimit: 1 }
    : { threadId: 'thread', objective: 'original', expectedEvidenceKinds: ['answer'], turnLimit: 50 });
});
it.each(METHODS)('%s preserves original closed-field error before effect, source/authority is not a grant', async method => {
  const f = await setup(); for (const field of ['authority', 'requestSource', 'actorId', 'control', 'unknown']) await expect(f.invoke(method, [{ ...payload(method), [field]: 'agent' }])).rejects.toThrow('invalid_goal_field:' + field);
  expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s original requestId/turnLimit/thread errors survive', async method => {
  const f = await setup();
  for (const requestId of ['', 'not-v4', 1]) await expect(f.invoke(method, [{ ...payload(method), requestId }])).rejects.toThrow('invalid_goal_request_id');
  for (const turnLimit of [0, 51, 1.5, NaN, '3']) await expect(f.invoke(method, [{ ...payload(method), turnLimit }])).rejects.toThrow('invalid_goal_turn_limit');
  for (const threadId of ['', ' ', 'x'.repeat(201), 1]) await expect(f.invoke(method, [{ ...payload(method), threadId }])).rejects.toThrow('invalid_goal_thread_id');
  expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(['create', 'replace'] as const)('%s original objective/evidence/definition parser errors, never strip protected criteria', async method => {
  const f = await setup();
  await expect(f.invoke(method, [{ ...payload(method), objective: ' ' }])).rejects.toThrow('invalid_goal_' + method + '_objective');
  await expect(f.invoke(method, [{ ...payload(method), expectedEvidenceKinds: [] }])).rejects.toThrow('invalid_goal_evidence_kinds');
  await expect(f.invoke(method, [{ ...payload(method), expectedEvidenceKinds: ['unknown'] }])).rejects.toThrow('invalid_goal_evidence_kind');
  await expect(f.invoke(method, [{ ...payload(method), verificationDefinition: {} }])).rejects.toThrow(); expect(f.calls).toEqual([]);
});
it.each(METHODS)('%s new tuple/descriptor capture rejects surplus, accessor and proxy before original parser/effect', async method => {
  const f = await setup(); let reads = 0;
  const hostile = Object.defineProperty({ ...payload(method) }, 'threadId', { enumerable: true, get() { reads++; throw Error('secret'); } });
  for (const args of [[], [payload(method), 1], [hostile], [new Proxy({}, { ownKeys() { reads++; return []; } })]]) await expect(f.invoke(method, args)).rejects.toThrow();
  expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s real Main source denies Recorder/frame/foreign before descriptor read', async method => {
  const f = await setup(); let reads = 0; const hostile = Object.defineProperty({}, 'threadId', { get() { reads++; return 'thread'; } });
  for (const event of [{ sender: f.recorder, senderFrame: f.frame }, { sender: f.target, senderFrame: { ...f.frame } }, { sender: { isDestroyed: () => false, mainFrame: f.frame }, senderFrame: f.frame }]) await expect(f.invoke(method, [hostile], event)).rejects.toThrow();
  expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s missing finer authority defaults deny before delegate', async method => {
  const f = await setup({}, true); await expect(f.invoke(method)).rejects.toThrow('goal_task_mutation_sender_forbidden'); expect(f.calls).toEqual([]);
});
it.each(METHODS)('%s full mandatory goal/preparedTask DTO rejects bad data/getter before success ACK', async method => {
  let reads = 0; const raw = publicReply(method); Object.defineProperty(raw.preparedTask, 'taskId', { enumerable: true, get() { reads++; throw Error('secret'); } });
  const bad = [null, { goal: publicReply(method).goal }, { ...publicReply(method), extraAuthority: {} }, raw];
  for (const value of bad) { const f = await setup({ [method]: () => NativePromise.resolve(value) as unknown as Promise<Reply> }); await expect(f.invoke(method)).rejects.toThrow('goal_task_mutation_projection_unavailable'); expect(f.gate.outstanding).toBe(0); }
  expect(reads).toBe(0);
});
it.each(METHODS)('%s accepts full optional/protected DISPLAY DTO and both public attachmentSource variants; no native qualifier', async method => {
  for (const currentCompletion of [{ kind: 'ordinary' }, { kind: 'unavailable' }, ...['binding_required', 'binding_pending', 'binding_mismatch', 'needs_revalidation', 'publication_pending', 'verified'].map(state => ({ kind: 'protected', state }))]) {
    const dto = publicReply(method); dto.goal.currentCompletion = currentCompletion as Reply['goal']['currentCompletion']; dto.goal.state.forkedFromGoalId = 'display-only'; dto.goal.state.completionCriterion = 'criterion'; dto.goal.state.pendingCompletionIntentId = 'display-only'; dto.goal.state.blockerFingerprint = 'display-only'; dto.goal.state.budgetLimits = { turnLimit: 3, tokenLimit: 100, activeWallClockLimitMs: 1000 }; dto.goal.waitingReason = 'children_need_attention';
    const f = await setup({ [method]: () => NativePromise.resolve(dto) }); await expect(f.invoke(method)).resolves.toEqual(dto);
  }
  const automatic = publicReply(method); automatic.preparedTask.attachmentSource = { kind: 'automatic', predecessorTaskId: 'display-only' }; const f = await setup({ [method]: () => NativePromise.resolve(automatic) }); await expect(f.invoke(method)).resolves.toEqual(automatic);
});
it.each(METHODS)('%s exact original synchronous/reject error identity and no unhandled orphan', async method => {
  const failure = Error('original-source-rejection'), orphans: unknown[] = [], observe = (error: unknown) => { orphans.push(error); }; process.on('unhandledRejection', observe);
  try { for (const producer of [() => { throw failure; }, () => NativePromise.reject<Reply>(failure)]) { const f = await setup({ [method]: producer }); await expect(f.invoke(method)).rejects.toBe(failure); expect(f.gate.outstanding).toBe(0); } await turn(); expect(orphans).toEqual([]); }
  finally { process.removeListener('unhandledRejection', observe); }
});
it.each(METHODS)('%s accepted raw Promise owns one original IPC token through close; failure finally releases only ordinary port', async method => {
  let release!: (reply: Reply) => void; const raw = new NativePromise<Reply>(resolve => { release = resolve; }); const f = await setup({ [method]: () => raw }); const pending = f.invoke(method);
  const observed = pending.then(value => ({ value }), error => ({ error }));
  try { await turn(); expect(f.calls).toHaveLength(1); expect(f.gate.outstandingByKind()).toEqual({ ipc: 1 }); f.gate.close(); await expect(f.invoke(method)).rejects.toThrow('shutting_down'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(1); }
  finally { release(publicReply(method)); await observed; }
  await expect(pending).resolves.toEqual(await raw); await expect(f.gate.drain(1500)).resolves.toBe(true); expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(METHODS)('%s finer authority is rechecked after raw await before public delivery, not business rollback', async method => {
  let release!: (reply: Reply) => void; const raw = new NativePromise<Reply>(resolve => { release = resolve; }); const f = await setup({ [method]: () => raw }); const pending = f.invoke(method); const observed = pending.then(value => ({ value }), error => ({ error }));
  try { await turn(); f.target.destroyed = true; } finally { release(publicReply(method)); await observed; }
  await expect(pending).rejects.toThrow('goal_task_mutation_sender_forbidden'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s raw own constructor getter rejected before assimilation; own then legally bypassed', async method => {
  let reads = 0; const raw = NativePromise.resolve(publicReply(method)); Object.defineProperty(raw, 'constructor', { get() { reads++; return NativePromise; } });
  const f = await setup({ [method]: () => raw }); await expect(f.invoke(method)).rejects.toThrow('goal_task_mutation_projection_unavailable'); expect(reads).toBe(0);
  const dto = publicReply(method), normal = NativePromise.resolve(dto); Object.defineProperty(normal, 'then', { get() { reads++; throw Error('raw_then'); } }); const g = await setup({ [method]: () => normal }); await expect(g.invoke(method)).resolves.toEqual(dto); expect(reads).toBe(0);
});
for (const method of METHODS) for (const result of ['fulfill', 'reject'] as const) for (const variant of ['getter', 'value'] as const) it(`${method} ambient species ${variant} ${result}: pre-producer/getter/orphan zero`, async () => {
  const f = await setup({ [method]: () => result === 'reject' ? NativePromise.reject(Error('UNSTARTED_INNER')) : NativePromise.resolve(publicReply(method)) });
  const original = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!; let reads = 0; const orphans: unknown[] = [], observe = (error: unknown) => { orphans.push(error); }; process.on('unhandledRejection', observe); let pending!: Promise<Reply>;
  try { try { Object.defineProperty(NativePromise, Symbol.species, variant === 'getter' ? { configurable: true, get() { reads++; return NativePromise; } } : { configurable: true, value: NativePromise }); pending = f.invoke(method); } finally { Object.defineProperty(NativePromise, Symbol.species, original); }
    await expect(pending).rejects.toThrow('goal_task_mutation_projection_unavailable'); await turn(); await turn(); expect(f.calls).toEqual([]); expect(reads).toBe(0); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, original); process.removeListener('unhandledRejection', observe); }
});

it.each(METHODS)('%s raw thenable/proxy/subclass fail before assimilation; standard helper never mints an SDK brand', async method => {
  let reads = 0; const thenable = Object.defineProperty({}, 'then', { get() { reads++; throw Error('secret'); } });
  const subclass = new (class extends NativePromise<Reply> {})(resolve => resolve(publicReply(method)));
  for (const raw of [thenable, new Proxy(NativePromise.resolve(publicReply(method)), {}), subclass]) {
    const f = await setup({ [method]: () => raw as Promise<Reply> }); await expect(f.invoke(method)).rejects.toThrow('goal_task_mutation_projection_unavailable'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
  } expect(reads).toBe(0);
});
