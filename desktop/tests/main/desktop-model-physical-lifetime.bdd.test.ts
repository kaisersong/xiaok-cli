// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelAdapter, StreamChunk } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import * as desktopServiceModule from '../../electron/desktop-services.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import type { TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { DesktopManagedAgentSession } from '../../electron/desktop-managed-agent-session.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { parkedActivityFixture, activityFixture, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';
const cleanup: Cleanup = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 20));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; }); return { promise, resolve, reject }; }

it('actual Root cancel ACK remains logical while the original held provider keeps Root resources and Host drain resident', async () => {
  const f = await parkedActivityFixture(cleanup);
  await f.services.cancelTask(f.taskId);
  await tick();
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)).toMatchObject({ resourcesReleased: false, cleanupPending: true });
  expect(f.live().root).toBeDefined();
  const host = (f.service as unknown as { host: { inFlightTaskIds(): string[]; drain(): Promise<void> } }).host;
  expect(host.inFlightTaskIds()).toContain(f.taskId);
  let drained = false; const draining = host.drain().then(() => { drained = true; });
  await tick(); expect(drained).toBe(false);
  f.release.release(); await draining;
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(true);
  expect(f.live().root).toBeUndefined();
});

it('actual Root service disposal keeps its original archive owner until the held provider has physically exited', async () => {
  const f = await parkedActivityFixture(cleanup);
  let disposed = false; const disposing = f.service.dispose().then(() => { disposed = true; });
  await tick(); expect(disposed).toBe(false);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(false);
  f.release.release(); await disposing;
  expect(disposed).toBe(true);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(true);
});

function actualChild() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-child-model-physical-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const read = deferred<IteratorResult<StreamChunk>>(), returned = deferred<IteratorResult<StreamChunk>>();
  let requestSignal: AbortSignal | undefined;
  let reads = 0, returns = 0;
  const adapter = { stream(_messages: unknown, _tools: unknown, _system: unknown, options: { signal?: AbortSignal }) {
    requestSignal = options.signal;
    return { next() { reads++; return read.promise; }, return() { returns++; return returned.promise; }, [Symbol.asyncIterator]() { return this; } };
  } } as unknown as Pick<ModelAdapter, 'stream'>;
  const lifetime = new AbortController();
  const context = { groupId: 'owned-child-group', agentId: 'owned-child', turnId: 'turn-1', turn: 1, rootEpoch: 1, cwd: root,
    effectiveDeadline: Date.now() + 60_000, signal: lifetime.signal, permissionRevision: 0, actor: {} } as DesktopAgentExecutionContext;
  const disposeRegistry = vi.fn();
  const session = new DesktopManagedAgentSession({ adapter, systemPrompt: 'child', parentMessages: [], forkContext: true,
    getTurnContext: () => context, createRegistry: () => { const registry = new ToolRegistry({ autoMode: true }, []);
      return { registry, dispose: () => { disposeRegistry(); registry.dispose(); } }; },
    dataRoot: join(root, 'application-data'), skillCatalog: createSkillCatalog(undefined, root), materials: [],
    emitRuntimeEvent: () => {}, maxIterations: 1,
  });
  let expectedDisposeError: unknown;
  cleanup.push(async () => { read.resolve({ done: true, value: undefined }); returned.resolve({ done: true, value: undefined }); try { await session.dispose(); } catch (error) { if (error !== expectedDisposeError) throw error; } });
  return { session, root, adapter, read, returned, disposeRegistry, expectDisposeError: (error: unknown) => { expectedDisposeError = error; }, facts: () => ({ reads, returns, requestSignal }) };
}

it('actual Desktop child disposal retains its registry through both the original next and original return', async () => {
  const f = actualChild(), run = f.session.run('read'), caught = run.catch(error => error);
  await vi.waitFor(() => expect(f.facts().reads).toBe(1));
  let disposed = false; const disposing = f.session.dispose().then(() => { disposed = true; });
  await tick();
  expect(f.disposeRegistry).not.toHaveBeenCalled(); expect(disposed).toBe(false);
  f.read.resolve({ done: false, value: { type: 'text', delta: 'abandoned' } });
  await vi.waitFor(() => expect(f.facts().returns).toBe(1));
  await tick(); expect(f.disposeRegistry).not.toHaveBeenCalled(); expect(disposed).toBe(false);
  f.returned.resolve({ done: true, value: undefined }); await disposing;
  expect(f.disposeRegistry).toHaveBeenCalledTimes(1); expect(disposed).toBe(true);
  expect(await caught).toMatchObject({ name: 'AbortError' });
});

it('actual Desktop child publishes the same original disposal Promise before synchronous provider abort reentry', async () => {
  const f = actualChild(), run = f.session.run('read'), caught = run.catch(error => error);
  await vi.waitFor(() => expect(f.facts().reads).toBe(1));
  let reentered: Promise<void> | undefined;
  f.facts().requestSignal!.addEventListener('abort', () => { reentered = f.session.dispose(); }, { once: true });
  const original = f.session.dispose();
  expect(reentered).toBe(original);
  f.read.resolve({ done: true, value: undefined }); f.returned.resolve({ done: true, value: undefined });
  await original; await reentered; await caught;
});

function containsOriginalError(value: unknown, expected: unknown, seen = new Set<unknown>()): boolean {
  if (value === expected) return true;
  if (!(value instanceof Error) || seen.has(value)) return false;
  seen.add(value);
  return containsOriginalError(value.cause, expected, seen) || (value instanceof AggregateError && value.errors.some(error => containsOriginalError(error, expected, seen)));
}

it('actual child retains the original business abort together with independent late return failure and sticky allocation', async () => {
  const f = actualChild(), stop = new AbortController(), business = new Error('ORIGINAL_CHILD_BUSINESS'), physical = new Error('INDEPENDENT_CHILD_RETURN');
  const run = f.session.run('read', stop.signal), caught = run.catch(error => error);
  await vi.waitFor(() => expect(f.facts().reads).toBe(1)); stop.abort(business); await tick();
  f.read.resolve({ done: false, value: { type: 'text', delta: 'abandoned' } });
  await vi.waitFor(() => expect(f.facts().returns).toBe(1)); f.returned.reject(physical);
  const error = await caught;
  const disposeError = await f.session.dispose().catch(error => error); f.expectDisposeError(disposeError);
  expect(f.disposeRegistry).not.toHaveBeenCalled();
  expect(containsOriginalError(error, business)).toBe(true);
  expect(containsOriginalError(error, physical)).toBe(true);
  expect((error as Error).cause).toBe(business);
  expect(containsOriginalError(disposeError, physical)).toBe(true);
  await expect(f.session.run('must stay blocked')).rejects.toThrow(/closed|pending/);
});

it('actual Root closes admission before unknown SQLite persistence fails, retaining all original business and physical facts', async () => {
  const ownedCleanup: Cleanup = [], late = new Error('INDEPENDENT_ROOT_READ'), release = deferred<void>(), entered = deferred<void>();
  cleanup.push(async () => {
    release.resolve();
    for (const action of ownedCleanup.splice(0).reverse()) {
      try { await action(); } catch (error) { if (!containsOriginalError(error, late)) throw error; }
    }
  });
  const f = await activityFixture(ownedCleanup); ownedCleanup.push(() => release.resolve());
  let observedRootError: unknown, originalRootActionError: unknown;
  const originalRoot = f.service.runRoot.bind(f.service);
  vi.spyOn(f.service, 'runRoot').mockImplementation(<T>(input: TaskRunnerInput, action: (context: DesktopAgentExecutionContext) => Promise<T>): Promise<T> => {
    const raw = originalRoot<T>(input, context => { const actionRaw = action(context); void actionRaw.catch(error => { originalRootActionError = error; }); return actionRaw; });
    void raw.catch(error => { observedRootError = error; }); return raw;
  });
  f.setProgram(async function* () { entered.resolve(); await release.promise; throw late; });
  const taskId = await f.start(); await entered.promise;
  const context = f.rootContext(); await f.services.cancelTask(taskId);
  const db = f.db;
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  db.exec(`CREATE TEMP TRIGGER deny_unknown_root BEFORE INSERT ON agents
    WHEN NEW.group_id=${literal(context.groupId)} AND NEW.agent_id=${literal(context.agentId)}
      AND json_extract(NEW.data_json,'$.cleanupPending')=1 AND json_extract(NEW.data_json,'$.executionActive')=0
    BEGIN SELECT RAISE(ABORT,'ORIGINAL_UNKNOWN_PERSIST_FAILURE'); END;`);
  ownedCleanup.push(() => db.exec('DROP TRIGGER IF EXISTS temp.deny_unknown_root'));
  release.resolve();
  const host = (f.service as unknown as { host: { drain(): Promise<void> }; runtimeBlockedReason?: string; options: { coordinator: { snapshot(): { active: number } } } }).host;
  await host.drain();
  expect((f.service as unknown as { runtimeBlockedReason?: string }).runtimeBlockedReason).toBe('runtime_blocked');
  expect(originalRootActionError).toBeInstanceOf(Error);
  expect(containsOriginalError(observedRootError, originalRootActionError)).toBe(true);
  expect(containsOriginalError(observedRootError, late)).toBe(true);
  expect(errorMessages(observedRootError)).toMatch(/ORIGINAL_UNKNOWN_PERSIST_FAILURE/);
  expect(f.live().root).toBeDefined();
  expect(f.store.getAgent(context.groupId, context.agentId)?.resourcesReleased).toBe(false);
  expect((f.service as unknown as { options: { coordinator: { snapshot(): { active: number } } } }).options.coordinator.snapshot().active).toBeGreaterThan(0);
});

function errorMessages(value: unknown, seen = new Set<unknown>()): string {
  if (!(value instanceof Error) || seen.has(value)) return '';
  seen.add(value);
  return [value.message, errorMessages(value.cause, seen), ...(value instanceof AggregateError ? value.errors.map(error => errorMessages(error, seen)) : [])].join('\n');
}

const finalization = (desktopServiceModule as unknown as { __testFinalization(input: {
  modelPhysicalScope?: ReturnType<DesktopMultiAgentService['captureRootModelPhysicalScope']>;
  adapter: Pick<ModelAdapter, 'stream'>; apiMessages: []; systemPrompt: string; streamOptions: { signal: AbortSignal };
  signal: AbortSignal; sessionId: string; turnId: string; intentId: string; stepId: string; emitRuntimeEvent: () => void;
}): Promise<{reply: string}> }).__testFinalization;

it.each(['loop', 'finalization'] as const)('actual standalone %s retains its original business abort and independent provider return failure', async mode => {
  const f = actualChild(), stop = new AbortController(), business = new Error('ORIGINAL_LOCAL_BUSINESS'), physical = new Error('INDEPENDENT_LOCAL_RETURN');
  const registry = new ToolRegistry({ autoMode: true }, []); cleanup.push(() => registry.dispose());
  const run = mode === 'finalization' ? finalization({ adapter: f.adapter, apiMessages: [], systemPrompt: 'summary',
    streamOptions: { signal: stop.signal }, signal: stop.signal, sessionId: 'local', turnId: 'local-turn', intentId: 'local-intent', stepId: 'reply', emitRuntimeEvent: () => {} })
    : desktopServiceModule.runDesktopToolLoop({ adapter: f.adapter, systemPrompt: 'local', messages: [], allToolDefs: [], registry,
      signal: stop.signal, taskDeadline: Date.now() + 60_000, sessionId: 'local', turnId: 'local-turn', intentId: 'local-intent', stepId: 'reply', taskId: 'local-task',
      materials: [], skillInvocation: null, skillCatalog: createSkillCatalog(undefined, f.root), dataRoot: f.root, taskStartTime: Date.now(), maxIterations: 1,
      emitRuntimeEvent: async () => {}, strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
        buildApiView: messages => messages, processToolResult: result => result, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
  const caught = run.catch(error => error); await vi.waitFor(() => expect(f.facts().reads).toBe(1));
  stop.abort(business); await tick();
  f.read.resolve({ done: false, value: { type: 'text', delta: 'abandoned' } });
  await vi.waitFor(() => expect(f.facts().returns).toBe(1)); f.returned.reject(physical);
  const error = await caught;
  expect(containsOriginalError(error, business)).toBe(true); expect(containsOriginalError(error, physical)).toBe(true);
  expect((error as Error).cause).toBe(business);
});

it('actual completed mutation actor still owns its same Root scope for the real finalization request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-root-sealed-summary-')); cleanup.push(() => rmSync(root, {recursive: true, force: true}));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
  const service = new DesktopMultiAgentService({store, coordinator: new DesktopExecutionCoordinator(), createSession: async () => { throw Error('unused child'); }});
  cleanup.push(() => service.dispose()); service.registerThread({threadId: 'summary', profileId: 'profile', workspaceId: 'workspace', cwd: root});
  let sends = 0, result = '';
  const host = new InProcessTaskRuntimeHost({snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry: new MaterialRegistry({workspaceRoot: join(root, 'materials'), maxBytes: 1024}),
    authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    runner: input => service.runRoot(input, async context => {
      await context.mailbox.trySealTurn({outcome: 'completed'});
      expect(() => service.assertInvocation(context.actor)).toThrow();
      const modelPhysicalScope = service.captureRootModelPhysicalScope(context);
      result = (await finalization({modelPhysicalScope, adapter: {async *stream() { sends++; yield {type: 'text', delta: 'FINAL_SUMMARY'}; yield {type: 'done'}; }},
        apiMessages: [], systemPrompt: 'summary', streamOptions: {signal: context.signal}, signal: context.signal,
        sessionId: input.sessionId, turnId: context.turnId, intentId: 'summary', stepId: 'summary', emitRuntimeEvent: () => {}})).reply;
    })});
  await service.initialize(host);
  const prepared = await service.prepareRoot(host, 'summary', {prompt: 'summary', materials: []}); await host.startTask(prepared.taskId); await host.drain();
  expect(sends).toBe(1); expect(result).toBe('FINAL_SUMMARY');
  expect(store.allAgents(store.getRootBinding(prepared.taskId)!.groupId)[0]?.resourcesReleased).toBe(true);
});

it('actual child preserves a thrown undefined business outcome alongside the original independent return failure', async () => {
  const f = actualChild(), physical = new Error('RETURN_AFTER_UNDEFINED');
  const caught = f.session.run('undefined body').catch(error => error);
  await vi.waitFor(() => expect(f.facts().reads).toBe(1)); f.read.reject(undefined);
  await vi.waitFor(() => expect(f.facts().returns).toBe(1)); f.returned.reject(physical);
  const error = await caught;
  const disposeError = await f.session.dispose().catch(error => error); f.expectDisposeError(disposeError);
  expect(error).toBeInstanceOf(AggregateError);
  const originalUndefinedBusiness = errorNodes(error).find(value => value instanceof AggregateError && Object.hasOwn(value, 'cause') && value.cause === undefined && value.errors[0] === undefined);
  expect(originalUndefinedBusiness).toBeDefined();
  expect(containsOriginalError(originalUndefinedBusiness, physical)).toBe(true);
  expect(containsOriginalError(error, physical)).toBe(true);
  expect(f.disposeRegistry).not.toHaveBeenCalled();
});

function errorNodes(value: unknown, seen = new Set<unknown>()): Error[] {
  if (!(value instanceof Error) || seen.has(value)) return [];
  seen.add(value);
  return [value, ...errorNodes(value.cause, seen), ...(value instanceof AggregateError ? value.errors.flatMap(error => errorNodes(error, seen)) : [])];
}
