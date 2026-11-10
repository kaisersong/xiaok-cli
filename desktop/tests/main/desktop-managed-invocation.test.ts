// @vitest-environment node
// Ordinary session lifecycle only: no Native identity or Source qualification.
import {afterEach, expect, it, vi} from 'vitest';
import {DesktopManagedAgentSession} from '../../electron/desktop-managed-agent-session.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import type {Message, StreamChunk} from '../../../src/types.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
function contains(value: unknown, expected: unknown, seen = new Set<unknown>()): boolean {
  if (value === expected) return true;
  if (!(value instanceof Error) || seen.has(value)) return false;
  seen.add(value);
  return (Object.hasOwn(value, 'cause') && contains(value.cause, expected, seen))
    || (value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen)));
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const action of cleanup.splice(0).reverse()) {
    try { await action(); } catch (error) { failures.push(error); }
  }
  vi.restoreAllMocks();
  if (failures.length) throw new AggregateError(failures, 'fixture_cleanup_failed');
});
function setup(options: {
  returned?: () => Promise<void>;
  body?: () => AsyncGenerator<StreamChunk>;
  registryCreated?: (session: DesktopManagedAgentSession) => void;
} = {}) {
  let turn = 1;
  const releaseResources = vi.fn(async () => {}), scopedDisposals: ReturnType<typeof vi.fn>[] = [];
  const histories: Message[][] = [], iterators: AsyncIterator<StreamChunk>[] = [];
  const returned = vi.fn(options.returned ?? (async () => {}));
  const stream = vi.fn((messages: Message[]) => {
    histories.push(structuredClone(messages));
    const index = iterators.length;
    const source = options.body?.() ?? (async function* () {
      yield {type: 'text' as const, delta: 'child answer ' + index};
      yield {type: 'done' as const};
    })();
    const iterator = {
      next: () => source.next(),
      async return() {
        await returned();
        return source.return(undefined);
      },
      [Symbol.asyncIterator]() { return this; },
    };
    iterators.push(iterator);
    return iterator;
  });
  const lifetime = new AbortController();
  const session = new DesktopManagedAgentSession({
    adapter: {stream}, systemPrompt: 'child fixture', forkContext: false, materials: [],
    skillCatalog: {list: () => []} as never, dataRoot: '',
    getTurnContext: () => ({sourceTaskId: 'root_task_fixture', groupId: 'group', agentId: 'child',
      cwd: process.cwd(), turn, turnId: 'turn-' + turn, signal: lifetime.signal,
      effectiveDeadline: Date.now() + 30000}) as never,
    createRegistry: () => {
      const registry = new ToolRegistry({autoMode: true}, []);
      const dispose = vi.fn(() => registry.dispose());
      scopedDisposals.push(dispose);
      options.registryCreated?.(session);
      return {registry, dispose};
    },
    emitRuntimeEvent: async () => {}, releaseResources,
  });
  let expected: {fault: unknown} | undefined;
  cleanup.push(async () => {
    try { await session.dispose(); }
    catch (error) { if (!expected || !contains(error, expected.fault)) throw error; }
  });
  return {session, returned, stream, iterators, histories, scopedDisposals, releaseResources,
    next: () => turn++, expectCloseFailure: (fault: unknown) => { expected = {fault}; }};
}

it('a failed original provider return stays failed after running clears and prevents later resource release', async () => {
  const fault = new Error('original_close_unknown');
  const f = setup({returned: async () => { throw fault; }});
  f.expectCloseFailure(fault);
  const error = await f.session.run('run').then(() => { throw Error('expected_failure'); }, error => error);
  expect(contains(error, fault)).toBe(true);
  await Promise.resolve();
  await expect(f.session.dispose()).rejects.toSatisfy(error => contains(error, fault));
  expect(f.returned).toHaveBeenCalledOnce();
  expect(f.releaseResources).not.toHaveBeenCalled();
});
it('dispose waits for the original provider return before releasing session resources', async () => {
  const held = gate(), f = setup({returned: () => held.promise});
  const running = f.session.run('run');
  let disposal: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(f.returned).toHaveBeenCalledOnce());
    disposal = f.session.dispose();
    await Promise.resolve();
    expect(f.releaseResources).not.toHaveBeenCalled();
  } finally { held.release(); await running.catch(() => {}); await disposal; }
  expect(f.releaseResources).toHaveBeenCalledOnce();
  expect(f.returned).toHaveBeenCalledOnce();
});
it('deactivation during actual turn-input preparation prevents late provider creation and sampling', async () => {
  // run() awaits its original installTurnInput before entering the model loop.
  // The retired async factory has no current lease to fabricate or close.
  const entered = gate();
  const f = setup({registryCreated: session => {
    queueMicrotask(() => { void session.deactivate(); entered.release(); });
  }});
  const running = f.session.run('run'), rejected = expect(running).rejects.toThrow();
  await entered.promise;
  await rejected;
  await f.session.dispose();
  expect(f.stream).not.toHaveBeenCalled();
  expect(f.returned).not.toHaveBeenCalled();
  expect(f.scopedDisposals[0]).toHaveBeenCalledOnce();
  expect(f.releaseResources).toHaveBeenCalledOnce();
});
it('each followup gets an independent physical iterator and original return while retaining completed conversation text', async () => {
  const f = setup();
  expect(await f.session.run('first')).toBe('child answer 0');
  f.next();
  expect(await f.session.run('second')).toBe('child answer 1');
  expect(f.stream).toHaveBeenCalledTimes(2);
  expect(f.iterators[0]).not.toBe(f.iterators[1]);
  expect(JSON.stringify(f.histories[1])).toContain('child answer 0');
  expect(f.returned).toHaveBeenCalledTimes(2);
});
it.each([new Error('drain_failed'), undefined, null, false])(
  'an unknown original return permanently blocks another run and suspend (%s)', async fault => {
    const f = setup({returned: async () => { throw fault; }});
    f.expectCloseFailure(fault);
    const outcome = await f.session.run('first').then(() => ({ok: true}), error => ({ok: false, error}));
    expect(outcome.ok).toBe(false);
    expect(contains('error' in outcome ? outcome.error : undefined, fault)).toBe(true);
    await Promise.resolve(); f.next();
    await expect(f.session.run('must not reopen')).rejects.toThrow(/pending/);
    expect(f.stream).toHaveBeenCalledOnce();
    await expect(f.session.suspend()).rejects.toSatisfy(error => contains(error, fault));
    await expect(f.session.dispose()).rejects.toSatisfy(error => contains(error, fault));
    expect(f.releaseResources).not.toHaveBeenCalled();
  },
);
it('a child activity callback failure disposes its original registry before the run settles', async () => {
  const f = setup();
  await expect(f.session.run('first', undefined, {onActivity: () => { throw Error('activity_failed'); }} as never))
    .rejects.toThrow('activity_failed');
  expect(f.scopedDisposals).toHaveLength(1);
  expect(f.scopedDisposals[0]).toHaveBeenCalledOnce();
  expect(f.stream).not.toHaveBeenCalled();
});
it('a completed child reply cannot escape after its actor is deactivated during the original provider return', async () => {
  const held = gate(), f = setup({returned: () => held.promise});
  const running = f.session.run('run'), rejected = expect(running).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(f.returned).toHaveBeenCalledOnce());
    await f.session.deactivate();
  } finally { held.release(); await rejected; await f.session.dispose(); }
  expect(f.releaseResources).toHaveBeenCalledOnce();
});
it('a child activity callback that deactivates the session prevents provider resource creation', async () => {
  const f = setup();
  await expect(f.session.run('first', undefined, {onActivity: () => { void f.session.deactivate(); }} as never))
    .rejects.toThrow();
  expect(f.stream).not.toHaveBeenCalled();
  expect(f.returned).not.toHaveBeenCalled();
});
