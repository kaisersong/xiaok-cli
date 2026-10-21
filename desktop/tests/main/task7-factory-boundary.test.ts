// @vitest-environment node
// Source-before AND post-apply: imports only existing production via fixture.
import { expect, it, vi } from 'vitest';
import { TASK7_FACTORY_METHODS as methods, factoryTurn, task7FactoryFixture } from './task7-factory-fixture.js';
const NativePromise = Promise;
const outcome = (pending: Promise<unknown>) => pending.then(value => ({ value, error: undefined as unknown }), error => ({ value: undefined as unknown, error }));
const deadline = { timeout: 1500, interval: 10 };
it.each(methods)('actual factory -> actual registrar/Main normal %s retains its real facade/host behavior', async method => {
  const f = await task7FactoryFixture();
  const result = await f.invoke(method);
  expect(f.calls[method]).toHaveBeenCalledOnce();
  const actor = { actorId: `desktop-user:${f.service.multiAgent!.profileId}`, requestSource: 'user' as const };
  if (method === 'createTask' || method === 'createTaskWithFiles') {
    const created = result as { taskId: string; understanding?: { goal: string } };
    expect(created.taskId).toMatch(/^task_/);
    if (created.understanding) expect(created.understanding.goal).toBeTypeOf('string');
    expect(f.hostCalls.prepare).toHaveBeenCalledOnce(); expect(f.hostCalls.start).toHaveBeenCalledOnce();
    const recovered = await f.service.recoverTask(created.taskId);
    expect(recovered.snapshot.understanding?.goal).toBeTypeOf('string');
    expect(recovered.snapshot.prompt).toBe('ordinary boundary request'); expect(recovered.snapshot.context?.threadId).toBe('ordinary-thread');
    if (method === 'createTaskWithFiles') {
      expect(f.calls.createTaskWithFiles).toHaveBeenCalledExactlyOnceWith({ prompt: 'ordinary boundary request', filePaths: [f.file], context: { threadId: 'ordinary-thread' } }, actor);
      expect(recovered.snapshot.materials).toEqual([expect.objectContaining({ originalName: 'ordinary.txt', role: 'customer_material' })]);
    } else expect(f.calls.createTask).toHaveBeenCalledExactlyOnceWith({ prompt: 'ordinary boundary request', materials: [], context: { threadId: 'ordinary-thread' } }, actor);
    await f.service.cancelTask(created.taskId, actor);
  } else if (method === 'recoverTask') {
    expect(result).toEqual({ snapshot: expect.objectContaining({ taskId: f.seed.taskId, sessionId: f.seed.sessionId, events: f.seed.events }) });
    expect(f.calls.authorizeTaskRead).toHaveBeenCalledTimes(2); expect(f.hostCalls.recover).toHaveBeenCalledOnce();
  } else if (method === 'getActiveTask') {
    expect(result).toEqual({ taskId: f.seed.taskId }); expect(f.calls.authorizeTaskRead).toHaveBeenCalledExactlyOnceWith(f.seed.taskId, actor);
  } else if (method === 'answerQuestion') {
    expect(result).toBeUndefined(); expect(f.hostCalls.answer).toHaveBeenCalledExactlyOnceWith(f.payloads.answerQuestion[0]);
  } else if (method === 'cancelTask') {
    expect(result).toBeUndefined(); expect(f.hostCalls.cancel).toHaveBeenCalled();
    expect((await f.readCold(f.seed.taskId))?.status).toBe('cancelled');
  } else {
    expect(result).toBeUndefined(); await vi.waitFor(() => expect(f.sender.send).toHaveBeenCalledWith('desktop:taskEvent:' + f.seed.taskId, f.seed.events[0]), deadline);
    await f.listeners.get('desktop:unsubscribeTask')!(f.event as never, { taskId: f.seed.taskId, subscriptionId: 'factory-sub' }); await factoryTurn();
    expect(f.sender.listenerCount('destroyed')).toBe(0);
  }
  expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(methods)('tuple %s rejects every extra transport argument before the real facade or physical source writer', async method => {
  const f = await task7FactoryFixture();
  const invalid = method === 'getActiveTask' ? [undefined] : [...f.payloads[method], { source: 'agent', grants: ['all'] }];
  const result = await outcome(f.invoke(method, invalid));
  expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_input_invalid');
  for (const call of Object.values(f.calls)) expect.soft(call).not.toHaveBeenCalled();
  expect.soft(f.hostCalls.prepare).not.toHaveBeenCalled(); expect.soft(f.hostCalls.start).not.toHaveBeenCalled(); expect.soft(f.hostCalls.cancel).not.toHaveBeenCalled();
  expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(methods)('permission %s rejects the coarse-owned Recorder with actual Main finer gate before actual facade', async method => {
  const f = await task7FactoryFixture();
  const result = await outcome(f.invoke(method, f.payloads[method], { sender: f.recorder, senderFrame: f.recorderFrame }));
  expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_actor_forbidden');
  for (const call of Object.values(f.calls)) expect.soft(call).not.toHaveBeenCalled();
  expect.soft(f.hostCalls.prepare).not.toHaveBeenCalled(); expect.soft(f.hostCalls.start).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(['control', 'authority', 'principal', 'grants'] as const)('privateDTO rejects persisted ordinary snapshot %s through the actual recover facade before public return', async privateField => {
  const f = await task7FactoryFixture({ [privateField]: { privateValue: 'main-only-marker' } });
  // Establish the real producer witness: factory/storage retain this historical
  // data field. It does not authorize anything; transport must refuse its leak.
  const produced = await f.service.recoverTask(f.seed.taskId);
  expect(Object.hasOwn(produced.snapshot, privateField)).toBe(true); f.resetObservations();
  const result = await outcome(f.invoke('recoverTask'));
  expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_projection_unavailable');
  expect(f.calls.recoverTask).toHaveBeenCalledOnce();
  expect.soft(f.calls.authorizeTaskRead).toHaveBeenCalledTimes(1); // no raw snapshot field reads/followup auth
  expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(['createTask', 'createTaskWithFiles'] as const)('actual %s captures ignored authority accessors before production sanitizer/log/files/facade', async method => {
  const f = await task7FactoryFixture(); let reads = 0;
  const raw = Object.defineProperty({ ...f.payloads[method][0] }, 'principal', { enumerable: true, get() { reads++; throw Error('private getter effect'); } });
  const result = await outcome(f.invoke(method, [raw]));
  expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_input_invalid');
  expect.soft(reads).toBe(0); expect.soft(f.calls[method]).not.toHaveBeenCalled(); expect.soft(f.hostCalls.prepare).not.toHaveBeenCalled(); expect.soft(f.hostCalls.start).not.toHaveBeenCalled();
  expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(methods.flatMap(method => ['getter', 'value'].map(species => ({ method, species }))))('actual $method factory facade is never entered under global $species species; no abandoned SDK promise', async ({ method, species }) => {
  const f = await task7FactoryFixture(), descriptor = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!;
  // If called, the actual default runner's external SDK will create a real
  // rejecting iterator Promise. We never replace the service/facade/host body.
  f.stream.mockImplementation(async function* () { throw Error('unstarted-sdk-rejection'); });
  const orphans: unknown[] = [], observe = (reason: unknown) => { orphans.push(reason); }; let reads = 0;
  process.on('unhandledRejection', observe);
  try {
    let pending!: Promise<unknown>;
    try {
      Object.defineProperty(NativePromise, Symbol.species, species === 'getter' ? { configurable: true, get() { reads++; return NativePromise; } } : { configurable: true, value: NativePromise });
      pending = f.invoke(method);
    } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); }
    const result = await outcome(pending); await factoryTurn(); await factoryTurn();
    expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_projection_unavailable');
    expect.soft(reads).toBe(0); for (const call of Object.values(f.calls)) expect.soft(call).not.toHaveBeenCalled();
    expect.soft(f.hostCalls.prepare).not.toHaveBeenCalled(); expect.soft(f.hostCalls.start).not.toHaveBeenCalled(); expect.soft(f.stream).not.toHaveBeenCalled();
    expect.soft(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); process.removeListener('unhandledRejection', observe); }
}, 10000);
it('actual read facade Promise own constructor getter is rejected before await and the original raw Promise is retained to settlement', async () => {
  const f = await task7FactoryFixture(), original = f.originals.getActiveTask; let raw: ReturnType<typeof original> | undefined, reads = 0, producerCalls = 0;
  f.service.getActiveTask = () => {
    producerCalls++; raw = original(); Object.defineProperty(raw, 'constructor', { configurable: true, get() { reads++; return NativePromise; } }); return raw;
  }; // Plain call-through; spy settlement bookkeeping must not touch the hostile Promise.
  try {
    const result = await outcome(f.invoke('getActiveTask'));
    expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_projection_unavailable'); expect.soft(reads).toBe(0);
    expect(producerCalls).toBe(1); expect(f.gate.outstanding).toBe(0);
  } finally {
    if (raw) { Object.defineProperty(raw, 'constructor', { configurable: true, value: NativePromise }); await raw; }
  }
}, 10000);
it.each(['answerQuestion', 'cancelTask'] as const)('actual %s source actor barrier cannot mutate after Main is replaced', async method => {
  const f = await task7FactoryFixture(), original = f.originals.authorizeTaskRead;
  let release!: () => void; const held = new NativePromise<void>(resolve => { release = resolve; });
  f.calls.authorizeTaskRead.mockImplementationOnce(async (...args) => { await original(...args); await held; }); // Actual authorization completes before its return barrier.
  const pending = outcome(f.invoke(method));
  try {
    await vi.waitFor(() => expect(f.calls.authorizeTaskRead).toHaveBeenCalledOnce(), deadline); await factoryTurn();
    f.authority.setMain({ webContents: {}, isDestroyed: () => false }); release(); const result = await pending;
    expect.soft(result.error).toBeInstanceOf(Error); expect.soft((result.error as Error | undefined)?.message).toBe('task_actor_forbidden');
    expect.soft(f.calls[method]).not.toHaveBeenCalled(); expect.soft(method === 'cancelTask' ? f.hostCalls.cancel : f.hostCalls.answer).not.toHaveBeenCalled();
    expect(f.gate.outstanding).toBe(0);
  } finally { release(); await pending; }
}, 10000);
it('actual subscription has exact replacement/disposer/destroy physical Host iterator cleanup, keeping the existing shutdown gate', async () => {
  const f = await task7FactoryFixture();
  await f.invoke('subscribeTask'); await vi.waitFor(() => expect(f.sender.send).toHaveBeenCalledOnce(), deadline);
  const firstSignal = f.calls.subscribeTask.mock.calls[0]![1]!.signal!;
  await f.invoke('subscribeTask', [{ taskId: f.seed.taskId, sinceIndex: 0, subscriptionId: 'replacement' }]);
  await vi.waitFor(() => expect(f.sender.send).toHaveBeenCalledTimes(2), deadline);
  expect(f.calls.subscribeTask).toHaveBeenCalledTimes(2);
  const secondSignal = f.calls.subscribeTask.mock.calls[1]![1]!.signal!;
  expect(firstSignal.aborted).toBe(true);
  await f.listeners.get('desktop:unsubscribeTask')!(f.event as never, { taskId: f.seed.taskId, subscriptionId: 'factory-sub' }); expect(secondSignal.aborted).toBe(false);
  const actualHost = f.hostCalls.subscribe.mock.contexts[0] as unknown as { subscribers: Map<string, unknown> };
  expect(actualHost.subscribers.has(f.seed.taskId)).toBe(true);
  f.sender.destroy(); await vi.waitFor(() => expect(f.sender.listenerCount('destroyed')).toBe(0), deadline); expect(secondSignal.aborted).toBe(true);
  await vi.waitFor(() => expect(actualHost.subscribers.has(f.seed.taskId)).toBe(false), deadline);
  // A source-close over the real Host population cannot finish while the actual
  // iterator still owns source callbacks; no hand-made iterator-finally counter.
  await f.originals.cancelTask(f.seed.taskId, { requestSource: 'user', actorId: `desktop-user:${f.service.multiAgent!.profileId}` });
  await f.service.closeTaskSourceWritersForMigration();
  f.gate.close(); await expect(f.invoke('recoverTask')).rejects.toThrow('shutting_down'); expect(f.gate.outstanding).toBe(0);
}, 10000);
