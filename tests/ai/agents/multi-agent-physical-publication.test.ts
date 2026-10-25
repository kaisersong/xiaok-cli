import { it, expect, vi } from 'vitest';
import { MultiAgentCoordinator, type ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function session(dispose: () => Promise<void>): ManagedAgentSession { return { run: async () => 'completed', dispose }; }
it('actual Core child cleanup holds its parent until physical-close publication completes', async () => {
  const publication = deferred<void>(); let childId = '', childClosed = false, parentDisposals = 0, callbacks = 0;
  const options = { closeSettlementTimeoutMs: 10, onPhysicalResourcesClosed: async (witness: object) => {
    const inspect = Reflect.get(core, 'inspectPhysicalCloseWitness'); expect(typeof inspect).toBe('function');
    const snapshot = Reflect.apply(inspect, core, [witness]);
    if (snapshot.id === childId) { callbacks++; expect(childClosed).toBe(true); await publication.promise; }
  } };
  const core = new MultiAgentCoordinator(options);
  const parent = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'parent', message: 'first', createSession: async () => session(async () => { parentDisposals++; }) });
  const child = await core.spawn({ requestSource: 'agent', callerId: parent.id, taskName: 'child', message: 'first', createSession: async () => session(async () => { childClosed = true; }) }); childId = child.id;
  await vi.waitFor(() => expect(core.listAgents({ requestSource: 'user', callerId: 'main' }).filter(a => a.id !== 'main').every(a => a.status === 'completed')).toBe(true));
  const closed = core.dispose(); let drained = false; const physical = core.waitForDisposedResources().then(() => { drained = true; });
  try { await vi.waitFor(() => expect(callbacks).toBe(1)); expect(parentDisposals).toBe(0); expect(drained).toBe(false); }
  finally { publication.resolve(); await closed; await physical; }
  expect(parentDisposals).toBe(1); expect(callbacks).toBe(1);
});
it.each([new Error('ORIGINAL_PUBLICATION_FAILURE'), undefined])('actual Core keeps publication rejection identity and undefined presence', async failure => {
  let calls = 0; let released: boolean | undefined;
  const options = { closeSettlementTimeoutMs: 10, onEvent: (event: import('../../../src/ai/agents/multi-agent-coordinator.js').MultiAgentEvent) => { if(event.agent.id !== 'main')released=event.agent.resourcesReleased; }, onPhysicalResourcesClosed: async () => { calls++; throw failure; } };
  const core = new MultiAgentCoordinator(options);
  const child = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'child', message: 'first', createSession: async () => session(async () => {}) });
  await vi.waitFor(() => expect(core.listAgents({ requestSource: 'user', callerId: 'main' }).find(a => a.id === child.id)?.status).toBe('completed'));
  await core.dispose(); let error: unknown; try { await core.waitForDisposedResources(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(AggregateError); const actual = error as AggregateError;
  expect(actual.errors.some(e => e === failure)).toBe(true); expect(Object.hasOwn(actual, 'cause')).toBe(true); expect(actual.cause).toBe(failure);
  expect(calls).toBe(1); expect(released).toBe(false);
});
it('physical witness rejects copies and foreign Core inspection, with one owner under synchronous reentry', async () => {
  let calls = 0, reentered: Promise<unknown> | undefined;
  const foreign = new MultiAgentCoordinator();
  const core = new MultiAgentCoordinator({ closeSettlementTimeoutMs: 10, onPhysicalResourcesClosed: async witness => {
    calls++;
    const facts = core.inspectPhysicalCloseWitness(witness);
    expect(() => core.inspectPhysicalCloseWitness({ ...witness })).toThrow('multi_agent_physical_close_witness_invalid');
    expect(() => foreign.inspectPhysicalCloseWitness(witness)).toThrow('multi_agent_physical_close_witness_invalid');
    reentered = core.closeAgent({ requestSource: 'user', callerId: 'main', target: facts.id });
  } });
  const child = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'child', message: 'first', createSession: async () => session(async () => {}) });
  await vi.waitFor(() => expect(core.listAgents({ requestSource: 'user', callerId: 'main' }).find(a => a.id === child.id)?.status).toBe('completed'));
  await core.closeAgent({ requestSource: 'user', callerId: 'main', target: child.id });
  await reentered;
  expect(calls).toBe(1);
  await core.dispose(); await core.waitForDisposedResources();
});
it('no physical witness is issued while actual native dispose is pending', async () => {
  const native = deferred<void>(); let entered = false, calls = 0;
  const core = new MultiAgentCoordinator({ closeSettlementTimeoutMs: 10, onPhysicalResourcesClosed: async () => { calls++; } });
  const child = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'child', message: 'first', createSession: async () => session(async () => { entered = true; await native.promise; }) });
  await vi.waitFor(() => expect(core.listAgents({ requestSource: 'user', callerId: 'main' }).find(a => a.id === child.id)?.status).toBe('completed'));
  try {
    const result = await core.closeAgent({ requestSource: 'user', callerId: 'main', target: child.id });
    expect(entered).toBe(true); expect(calls).toBe(0); expect(result).toMatchObject({ resourcesReleased: false, cleanupPending: true });
  } finally { native.resolve(); await core.dispose(); await core.waitForDisposedResources(); }
  expect(calls).toBe(1);
});
it('a fulfilled child cleanup carrying native failure cannot mint its parent physical witness', async () => {
  const failure = new Error('REAL_CHILD_NATIVE_DISPOSE_FAILURE'); const witnessed: string[] = [];
  const core = new MultiAgentCoordinator({ closeSettlementTimeoutMs: 10, onPhysicalResourcesClosed: async witness => { witnessed.push(core.inspectPhysicalCloseWitness(witness).id); } });
  const parent = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'parent', message: 'first', createSession: async () => session(async () => {}) });
  await core.spawn({ requestSource: 'agent', callerId: parent.id, taskName: 'child', message: 'first', createSession: async () => session(async () => { throw failure; }) });
  await vi.waitFor(() => expect(core.listAgents({ requestSource: 'user', callerId: 'main' }).filter(a => a.id !== 'main').every(a => a.status === 'completed')).toBe(true));
  await core.dispose(); await expect(core.waitForDisposedResources()).rejects.toThrow('multi_agent_cleanup_unconfirmed');
  expect(witnessed).toEqual([]);
});
it.each(['close', 'dispose', 'watchdog'] as const)('publishes the original cleanup owner before synchronous signal reentry: %s', async route => {
  let id = '', original: Promise<void> | undefined, observed = false, runEntered = false, witnessStatus = '';
  const core = new MultiAgentCoordinator({ closeSettlementTimeoutMs: 10, idleTimeoutMs: route === 'watchdog' ? 20 : 0,
    onPhysicalResourcesClosed: async witness => { witnessStatus = core.inspectPhysicalCloseWitness(witness).status; } });
  const child = await core.spawn({ requestSource: 'user', callerId: 'main', taskName: 'child', message: 'first', createSession: async () => ({
    run: async (_message, signal) => {
      runEntered = true;
      if (!signal) throw Error('actual Core run signal missing');
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => {
        // Diagnostic access verifies the owner that the real callback observes; it grants nothing.
        const records = Reflect.get(core, 'records') as Map<string, { cleanup?: Promise<void> }>;
        original = records.get(id)?.cleanup; observed = original instanceof Promise;
        if (route === 'dispose') void core.dispose();
        resolve();
      }, { once: true }); });
      return 'completed';
    }, dispose: async () => {} }) });
  id = child.id;
  await vi.waitFor(() => expect(runEntered).toBe(true));
  if (route === 'close') await core.closeAgent({ requestSource: 'user', callerId: 'main', target: id });
  if (route === 'dispose') await core.dispose();
  await vi.waitFor(() => expect(observed).toBe(true));
  await original;
  expect(witnessStatus).toBe(route === 'watchdog' ? 'failed' : 'closed');
  await core.dispose(); await core.waitForDisposedResources();
});
