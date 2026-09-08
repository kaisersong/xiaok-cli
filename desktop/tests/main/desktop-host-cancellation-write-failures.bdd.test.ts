// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type PersistedTaskEvent } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { DesktopTaskEvent, TaskMultiAgentPreparation } from '../../../src/runtime/task-host/types.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: vi.fn(actual.appendFile), writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink), readFile: vi.fn(actual.readFile) };
});

type HostInternals = {
  persistedEventDispatchChains: Map<string, Promise<void>>;
  subscribers: Map<string, Set<unknown>>;
  closeSubscribers(taskId: string): void;
};
type Frame = { taskId: string; events: DesktopTaskEvent[]; patch: Record<string, unknown> };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const actualGoalConsumer = DesktopGoalCoordinator.prototype.handlePersistedTaskEvent;

describe('BDD: one host cancellation frame preserves original publication after actual filesystem failures', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.appendFile).mockImplementation(actual.appendFile);
    vi.mocked(fs.writeFile).mockImplementation(actual.writeFile);
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    vi.mocked(fs.unlink).mockImplementation(actual.unlink);
    vi.mocked(fs.readFile).mockImplementation(actual.readFile);
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });

  async function fixture() {
    const f = await authorizationFixture(cleanup);
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const internals = host as unknown as HostInternals;
    const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
    const task = await host.prepareTask({ prompt: 'An ordinary prepared task at the real factory host.', materials: [] });
    expect(f.store.getRootBinding(task.taskId)).toBeNull();
    const snapshot = (await host.inspectTask(task.taskId))!;
    await flushDispatch(internals); callback.mockClear();
    const live: DesktopTaskEvent[] = [];
    let streamClosed = false;
    const stream = (async () => {
      for await (const event of host.subscribeTask(task.taskId, { sinceIndex: snapshot.events.length })) live.push(event);
    })().then(() => { streamClosed = true; });
    await vi.waitFor(() => expect(internals.subscribers.get(task.taskId)?.size).toBe(1));
    cleanup.push(async () => { internals.closeSubscribers(task.taskId); await stream; });
    return { ...f, host, internals, callback, taskId: task.taskId, startIndex: snapshot.events.length,
      live, streamClosed: () => streamClosed,
      cold: () => new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId) };
  }

  async function flushDispatch(internals: HostInternals): Promise<void> {
    while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
  }

  it.each(['checkpoint-write', 'checkpoint-rename', 'journal-unlink', 'index-write', 'index-rename'] as const)(
    'C5 actual %s rejection after journal append keeps one original event pair and completes its publication', async stage => {
      const f = await fixture();
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const failure = Object.assign(new Error(`native ${stage} receipt rejected`), { code: 'EIO' });
      const frames: Frame[] = []; let faults = 0;
      async function call(target: boolean, native: () => Promise<void>) {
        if (target && faults === 0) { faults++; throw failure; }
        await native();
      }
      vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
        await actual.appendFile(...args);
        if (basename(String(args[0])) === `${f.taskId}.journal.jsonl`) frames.push(JSON.parse(String(args[1])) as Frame);
      });
      vi.mocked(fs.writeFile).mockImplementation((...args) => {
        const name = basename(String(args[0])), data = String(args[1]);
        const target = stage === 'checkpoint-write' && name.startsWith(`${f.taskId}.json.`) && data.includes('"status": "cancelled"')
          || stage === 'index-write' && name.startsWith('active-task.json.') && data.includes('"activeTaskIds": []');
        return call(target, () => actual.writeFile(...args));
      });
      vi.mocked(fs.rename).mockImplementation((...args) => call(
        stage === 'checkpoint-rename' && basename(String(args[1])) === `${f.taskId}.json`
          || stage === 'index-rename' && basename(String(args[1])) === 'active-task.json', () => actual.rename(...args)));
      vi.mocked(fs.unlink).mockImplementation((...args) => call(
        stage === 'journal-unlink' && basename(String(args[0])) === `${f.taskId}.journal.jsonl`, () => actual.unlink(...args)));
      await expect(f.services.cancelTask(f.taskId)).rejects.toBe(failure);
      expect(faults).toBe(1);
      // An explicitly retried stop may repair pending publication/index, but is
      // not permission to create another salvage or a replacement event index.
      await f.services.cancelTask(f.taskId);
      await flushDispatch(f.internals); await turn();
      const cold = (await f.cold())!;
      const originalPair = cold.events.slice(f.startIndex);
      const calls = f.callback.mock.calls.map(([input]) => input).filter(input => input.taskId === f.taskId);
      const cancels = frames.filter(frame => frame.events.some(event => event.type === 'salvage'));
      console.log('CANCELLATION_POST_APPEND_FAILURE', { stage, faults, frameEvents: frames.map(frame => frame.events.map(event => event.type)),
        callbackEvents: calls.map(input => [input.eventIndex, input.event.type, input.snapshot.status]), live: f.live.map(event => event.type),
        coldStatus: cold.status, closed: f.streamClosed() });
      expect(cold.status).toBe('cancelled');
      expect(originalPair.map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      expect.soft(cancels).toHaveLength(1);
      expect.soft(cancels[0]?.events.map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      expect.soft(cancels[0]?.patch.status).toBe('cancelled');
      expect.soft(calls.map(input => [input.eventIndex, input.event.type, input.snapshot.status])).toEqual([
        [f.startIndex, 'salvage', 'cancelled'], [f.startIndex + 1, 'task_terminal', 'cancelled'],
      ]);
      expect.soft(f.live.map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      expect.soft(f.streamClosed()).toBe(true);
      expect.soft((await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).getActiveTasks()).map(item => item.taskId)).not.toContain(f.taskId);
      expect(faults).toBe(1);
    });

  it.each(['complete-frame-then-reject', 'partial-frame-then-reject'] as const)(
    'C6 actual %s is distinguished by the original Store replay before a second explicit stop', async stage => {
      const f = await fixture();
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const failure = Object.assign(new Error(stage), { code: 'EIO' });
      const completeFrames: Frame[] = []; let injected = false;
      vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
        const own = basename(String(args[0])) === `${f.taskId}.journal.jsonl`;
        const frame = own ? JSON.parse(String(args[1])) as Frame : undefined;
        if (frame?.events.some(event => event.type === 'salvage') && !injected) {
          injected = true;
          if (stage === 'partial-frame-then-reject') {
            const data = String(args[1]);
            await actual.appendFile(args[0], data.slice(0, Math.floor(data.length / 2)), 'utf8');
          } else { await actual.appendFile(...args); completeFrames.push(frame); }
          throw failure;
        }
        await actual.appendFile(...args); if (frame) completeFrames.push(frame);
      });
      await expect(f.services.cancelTask(f.taskId)).rejects.toBe(failure);
      expect(injected).toBe(true);
      const beforeRetry = (await f.cold())!;
      if (stage === 'partial-frame-then-reject') {
        expect(beforeRetry.status).toBe('understanding');
        expect(beforeRetry.events).toHaveLength(f.startIndex);
      } else {
        expect.soft(beforeRetry.status).toBe('cancelled');
        expect.soft(beforeRetry.events.slice(f.startIndex).map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      }
      await f.services.cancelTask(f.taskId); await flushDispatch(f.internals); await turn();
      const cold = (await f.cold())!;
      const published: PersistedTaskEvent[] = f.callback.mock.calls.map(([input]) => input).filter(input => input.taskId === f.taskId);
      console.log('CANCELLATION_JOURNAL_RECEIPT', { stage, completeFrames: completeFrames.map(frame => frame.events.map(event => event.type)),
        coldEvents: cold.events.slice(f.startIndex).map(event => event.type), published: published.map(input => input.eventIndex) });
      expect.soft(completeFrames.filter(frame => frame.events.some(event => event.type === 'salvage'))).toHaveLength(1);
      expect.soft(cold.events.slice(f.startIndex).map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      expect.soft(published.map(input => [input.eventIndex, input.event.type])).toEqual([
        [f.startIndex, 'salvage'], [f.startIndex + 1, 'task_terminal'],
      ]);
      expect.soft(f.streamClosed()).toBe(true);
    });

  it('C7 a no-live prepared task cancellation keeps host drain pending for its actual original append IO', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const entered = deferred(), release = deferred(); cleanup.push(() => release.resolve());
    let pending = 0, nativeWrites = 0;
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      const own = basename(String(args[0])) === `${f.taskId}.journal.jsonl`;
      if (own) { pending++; entered.resolve(); await release.promise; }
      try { await actual.appendFile(...args); if (own) nativeWrites++; }
      finally { if (own) pending--; }
    });
    const stopping = f.services.cancelTask(f.taskId);
    await entered.promise;
    expect(f.host.inFlightTaskIds()).not.toContain(f.taskId);
    let drained = false;
    const drain = f.host.drain().then(() => { drained = true; });
    await turn();
    expect(pending).toBe(1); expect(nativeWrites).toBe(0);
    expect.soft(drained, 'the real original append is still physically pending without a runner').toBe(false);
    release.resolve(); await stopping; await drain; await flushDispatch(f.internals);
    expect(pending).toBe(0); expect(drained).toBe(true);
    expect((await f.cold())?.status).toBe('cancelled');
  });

  it('C7 a live root which physically exits while cancellation append is pending cannot dispatch terminal or finish host drain early', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service;
    const host = (service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const internals = host as unknown as HostInternals;
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const modelEntered = deferred(), releaseModel = deferred(), providerExited = deferred();
    const writeEntered = deferred(), releaseWrite = deferred();
    cleanup.push(async () => { releaseModel.resolve(); releaseWrite.resolve(); await host.drain(); });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      try { modelEntered.resolve(); await releaseModel.promise; }
      finally { providerExited.resolve(); }
    });
    const rootRun = vi.spyOn(service, 'runRoot');
    const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
    const task = await f.services.createTask({ prompt: 'Hold this original model call.', materials: [], permissionMode: 'auto', context: { threadId: 'cancel-io-live' } });
    await modelEntered.promise;
    let pending = 0;
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      const held = basename(String(args[0])) === `${task.taskId}.journal.jsonl` && String(args[1]).includes('"salvage"');
      if (held) { pending++; writeEntered.resolve(); await releaseWrite.promise; }
      try { await actual.appendFile(...args); } finally { if (held) pending--; }
    });
    const cancelling = f.services.cancelTask(task.taskId); await writeEntered.promise;
    let drained = false; const drain = host.drain().then(() => { drained = true; });
    releaseModel.resolve(); await providerExited.promise;
    await Promise.allSettled(rootRun.mock.results.map(result => result.value));
    await turn();
    expect(pending).toBe(1); expect(drained).toBe(false);
    expect(host.inFlightTaskIds()).toContain(task.taskId);
    expect(callback.mock.calls.filter(([input]) => input.taskId === task.taskId && input.event.type === 'task_terminal')).toHaveLength(0);
    releaseWrite.resolve(); await cancelling; await drain; await flushDispatch(internals);
    expect(pending).toBe(0); expect(host.inFlightTaskIds()).not.toContain(task.taskId);
    expect(callback.mock.calls.filter(([input]) => input.taskId === task.taskId && input.event.type === 'task_terminal')).toHaveLength(1);
  });

  it.each(['groupId', 'rootEpoch', 'rootTurnId', 'preparationId', 'bootId'] as const)(
    'C8 the actual authorized cancellation cannot write after awaited decision changes original marker %s', async field => {
      const f = await authorizationFixture(cleanup), service = f.boundary.service;
      const host = (service as unknown as { host: InProcessTaskRuntimeHost }).host;
      const snapshotStore = (host as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
      const threadId = `marker-${field}`;
      await service.registerThreadWithOwnership({ threadId, profileId: f.boundary.profileId,
        workspaceId: f.boundary.workspaceId, cwd: f.root }, 'user');
      const task = await service.prepareRoot(host, threadId, { prompt: 'An actual main-prepared root.', materials: [], permissionMode: 'auto', context: { threadId } });
      const before = (await host.inspectTask(task.taskId))!;
      expect(before.multiAgentPreparation).toBeDefined();
      const decided = deferred(), release = deferred(); cleanup.push(() => release.resolve());
      const original = service.decideHostCancellation.bind(service);
      const verdicts: Array<{ hostAbortAllowed: boolean }> = [];
      vi.spyOn(service, 'decideHostCancellation').mockImplementation(async (...args) => {
        const verdict = await original(...args); verdicts.push(verdict); decided.resolve(); await release.promise; return verdict;
      });
      const stopping = f.services.cancelTask(task.taskId).then(() => undefined, error => error as unknown);
      await decided.promise;
      expect(verdicts).toEqual([{ hostAbortAllowed: true, ack: 'applied' }]);
      const marker = { ...before.multiAgentPreparation!, [field]: field === 'rootEpoch'
        ? before.multiAgentPreparation!.rootEpoch + 1 : `${String(before.multiAgentPreparation![field])}-changed` } as TaskMultiAgentPreparation;
      // Write through the actual Store while the real decision callback is
      // awaited. No fake authorization, queue algorithm or in-memory snapshot.
      await snapshotStore.save({ ...before, multiAgentPreparation: marker }, before);
      release.resolve(); const rejection = await stopping;
      const cold = (await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId))!;
      expect.soft(rejection).toBeInstanceOf(Error);
      expect(cold.multiAgentPreparation).toEqual(marker);
      expect.soft(cold.status).toBe(before.status);
      expect.soft(cold.events).toEqual(before.events);
    });

  it('C9 persistent index failure still publishes the confirmed original pair once and a later explicit stop repairs only cleanup', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const failure = Object.assign(new Error('persistent actual active index write error'), { code: 'EIO' });
    let faults = 0; const frames: Frame[] = [];
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      await actual.appendFile(...args);
      if (basename(String(args[0])) === `${f.taskId}.journal.jsonl`) frames.push(JSON.parse(String(args[1])) as Frame);
    });
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (basename(String(args[0])).startsWith('active-task.json.') && String(args[1]).includes('"activeTaskIds": []')) { faults++; throw failure; }
      await actual.writeFile(...args);
    });
    await expect(f.services.cancelTask(f.taskId)).rejects.toBe(failure);
    const retry = await f.services.cancelTask(f.taskId).then(() => undefined, error => error as unknown);
    await flushDispatch(f.internals); await turn();
    expect.soft(retry).toBe(failure);
    expect.soft(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId).map(([input]) => [input.eventIndex, input.event.type])).toEqual([
      [f.startIndex, 'salvage'], [f.startIndex + 1, 'task_terminal'],
    ]);
    expect.soft(f.streamClosed()).toBe(true);
    expect(faults).toBeGreaterThanOrEqual(1);
    vi.mocked(fs.writeFile).mockImplementation(actual.writeFile);
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    expect.soft((await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).getActiveTasks()).map(item => item.taskId)).not.toContain(f.taskId);
    expect(frames.filter(frame => frame.events.some(event => event.type === 'salvage'))).toHaveLength(1);
    expect.soft(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId && input.event.type === 'task_terminal')).toHaveLength(1);
  });

  it('C7 append receipt failure followed by a pending original Store read keeps cancellation and no-live drain pending', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const failure = Object.assign(new Error('original full append receipt failed'), { code: 'EIO' });
    const appended = deferred(), releaseRead = deferred(); cleanup.push(() => releaseRead.resolve());
    let armedRead = false, reads = 0, readPending = 0, finished = false, drained = false;
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      await actual.appendFile(...args);
      if (!armedRead && basename(String(args[0])) === `${f.taskId}.journal.jsonl`) {
        armedRead = true; appended.resolve(); throw failure;
      }
    });
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      const own = armedRead && [f.taskId + '.json', f.taskId + '.journal.jsonl'].includes(basename(String(args[0])));
      if (own) { reads++; readPending++; await releaseRead.promise; }
      try { return await actual.readFile(...args); } finally { if (own) readPending--; }
    });
    const cancelling = f.services.cancelTask(f.taskId).then(() => undefined, error => error as unknown).finally(() => { finished = true; });
    await appended.promise;
    // Wait for a real boundary: old code returns its failure without readback;
    // repaired code requests Store replay and is held at its real read adapter.
    await vi.waitFor(() => expect(finished || readPending > 0).toBe(true));
    const drain = f.host.drain().then(() => { drained = true; }); await turn();
    expect.soft(readPending).toBe(1);
    expect.soft(finished).toBe(false); expect.soft(drained).toBe(false);
    expect.soft(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId)).toHaveLength(0);
    releaseRead.resolve(); expect(await cancelling).toBe(failure); await drain; await flushDispatch(f.internals);
    expect(readPending).toBe(0); expect.soft(reads).toBeGreaterThanOrEqual(1);
    expect.soft((await f.cold())?.status).toBe('cancelled');
  });

  it('C7 all failed reads physically settle as unknown without automatic rewrites, and restored Store replay prevents a duplicate complete frame', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const failure = Object.assign(new Error('full frame receipt failed before repeated read EIO'), { code: 'EIO' });
    const readFailure = Object.assign(new Error('persistent read EIO'), { code: 'EIO' });
    let failedAppend = false, reads = 0; const frames: Frame[] = [];
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      await actual.appendFile(...args);
      if (basename(String(args[0])) === `${f.taskId}.journal.jsonl`) {
        frames.push(JSON.parse(String(args[1])) as Frame);
        if (!failedAppend) { failedAppend = true; throw failure; }
      }
    });
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (failedAppend && [f.taskId + '.json', f.taskId + '.journal.jsonl'].includes(basename(String(args[0])))) { reads++; throw readFailure; }
      return actual.readFile(...args);
    });
    await expect(f.services.cancelTask(f.taskId)).rejects.toBe(failure);
    await f.host.drain(); await turn();
    expect.soft(reads).toBeGreaterThanOrEqual(1); expect(reads).toBeLessThanOrEqual(2);
    expect(frames).toHaveLength(1);
    expect(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId && input.event.type === 'task_terminal')).toHaveLength(0);
    vi.mocked(fs.readFile).mockImplementation(actual.readFile);
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    const cold = (await f.cold())!;
    expect.soft(frames.filter(frame => frame.events.some(event => event.type === 'salvage'))).toHaveLength(1);
    expect.soft(cold.events.slice(f.startIndex).map(event => event.type)).toEqual(['salvage', 'task_terminal']);
    // Persistent read failure is not a durable notification outbox guarantee.
    // The eventual ordinary callback count is deliberately not asserted here.
  });

  it.each(['completed', 'failed'] as const)('C8 an already committed %s terminal remains unchanged and never asks for new cancellation authority', async status => {
    const f = await fixture();
    const snapshotStore = (f.host as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
    const before = (await f.host.inspectTask(f.taskId))!;
    await snapshotStore.save({ ...before, status, events: [...before.events, { type: 'task_terminal', status }] }, before);
    const decided = vi.spyOn(f.boundary.service, 'decideHostCancellation');
    const saved = (await f.cold())!;
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    expect(decided).not.toHaveBeenCalled(); expect(await f.cold()).toEqual(saved);
    expect(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId)).toHaveLength(0);
  });

  it('C8 a preparation marker without its real MA binding remains default-denied with no cancellation effects', async () => {
    const f = await fixture();
    const snapshotStore = (f.host as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
    const before = (await f.host.inspectTask(f.taskId))!;
    await snapshotStore.save({ ...before, multiAgentPreparation: { groupId: 'foreign-group', rootEpoch: 1,
      rootTurnId: 'foreign-turn', preparationId: 'foreign-preparation', bootId: f.store.bootId } }, before);
    const saved = await f.cold(), decided = vi.spyOn(f.boundary.service, 'decideHostCancellation');
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    expect(decided).toHaveBeenCalledOnce(); expect(await decided.mock.results[0]!.value).toEqual({ hostAbortAllowed: false });
    expect(await f.cold()).toEqual(saved); expect(f.live).toEqual([]);
  });

  it('C9 a rejecting existing terminal consumer is isolated without replaying the original cancellation effects', async () => {
    const f = await fixture();
    const failure = new Error('existing consumer unavailable');
    f.callback.mockImplementation(async function (this: DesktopGoalCoordinator, input) {
      if (input.taskId === f.taskId && input.event.type === 'task_terminal') throw failure;
      await actualGoalConsumer.call(this, input);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    await f.services.cancelTask(f.taskId); await flushDispatch(f.internals);
    expect(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId && input.event.type === 'task_terminal')).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('[goal] task event settlement failed:', failure.message);
    expect((await f.cold())?.events.slice(f.startIndex).map(event => event.type)).toEqual(['salvage', 'task_terminal']);
  });

  it('C11 preserves real late ordinary usage and hands the original terminal receipt its final committed cost', async () => {
    const f = await fixture();
    const entered = deferred(), release = deferred(); cleanup.push(async () => { release.resolve(); await f.host.drain(); });
    let modelCalls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      modelCalls++; entered.resolve(); await release.promise;
      yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 19 } };
    });
    await f.host.startTask(f.taskId); await entered.promise;
    await f.services.cancelTask(f.taskId);
    const cancelled = (await f.cold())!;
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.events.at(-1)?.type).toBe('task_terminal');
    expect(f.host.inFlightTaskIds()).toContain(f.taskId);
    release.resolve(); await f.host.drain(); await flushDispatch(f.internals);
    const cold = (await f.cold())!;
    console.log('CANCELLATION_LATE_FORMAL_USAGE', { modelCalls, before: cancelled.events.map(event => event.type),
      after: cold.events.map(event => event.type), usage: cold.usage,
      persisted: f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId).map(([input]) => [input.eventIndex, input.event.type]) });
    expect.soft(cold.events.slice(0, cancelled.events.length)).toEqual(cancelled.events);
    expect.soft(cold.events.slice(cancelled.events.length)).toEqual([{ type: 'usage_recorded', inputTokens: 17, outputTokens: 19 }]);
    expect.soft(cold.usage).toEqual({ inputTokens: 17, outputTokens: 19, known: true });
    const terminal = f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId && input.event.type === 'task_terminal');
    expect.soft(terminal).toHaveLength(1);
    expect.soft(terminal[0]?.[0].eventIndex).toBe(cancelled.events.length - 1);
    expect.soft(terminal[0]?.[0].snapshot.usage).toEqual(cold.usage);
    expect.soft(f.callback.mock.calls.filter(([input]) => input.taskId === f.taskId && input.event.type === 'usage_recorded')).toHaveLength(1);
    expect(modelCalls).toBe(1);
  });

  it('C12 actual cancellation flush rejection cannot release its runner leaving a running snapshot orphan', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const entered = deferred(), release = deferred(); cleanup.push(async () => { release.resolve(); await f.host.drain(); });
    const failure = Object.assign(new Error('actual buffered-delta flush rejected before journal append'), { code: 'EIO' });
    let faults = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'text', delta: 'Buffered before cancel, not a completed result.' };
      entered.resolve(); await release.promise;
    });
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      if (faults === 0 && basename(String(args[0])) === `${f.taskId}.journal.jsonl` && String(args[1]).includes('assistant_delta')) {
        faults++; throw failure;
      }
      await actual.appendFile(...args);
    });
    await f.host.startTask(f.taskId); await entered.promise;
    await expect(f.services.cancelTask(f.taskId)).rejects.toBe(failure);
    expect(faults).toBe(1); release.resolve(); await f.host.drain(); await flushDispatch(f.internals);
    const cold = (await f.cold())!;
    const active = await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).getActiveTasks();
    console.log('CANCELLATION_FLUSH_FAILURE_OWNERSHIP', { status: cold.status, inFlight: f.host.inFlightTaskIds(),
      active, events: cold.events.map(event => event.type) });
    expect.soft(['failed', 'cancelled']).toContain(cold.status);
    expect.soft(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect.soft(active.map(item => item.taskId)).not.toContain(f.taskId);
    expect(f.host.inFlightTaskIds()).not.toContain(f.taskId);
  });

  it.each(['initial-read', 'actual-decision'] as const)(
    'C7 each original cancellation Promise stays tracked at %s even when another same-task call finishes first', async stage => {
      const f = await fixture();
      const entered = deferred(), release = deferred(); cleanup.push(() => release.resolve());
      let held = false;
      if (stage === 'initial-read') {
        const store = (f.host as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
        const read = store.recoverTask.bind(store);
        vi.spyOn(store, 'recoverTask').mockImplementation(async (...args) => {
          const result = await read(...args);
          if (!held && args[0] === f.taskId) { held = true; entered.resolve(); await release.promise; }
          return result;
        });
      } else {
        const decide = f.boundary.service.decideHostCancellation.bind(f.boundary.service);
        vi.spyOn(f.boundary.service, 'decideHostCancellation').mockImplementation(async (...args) => {
          const result = await decide(...args);
          if (!held && args[0].taskId === f.taskId) { held = true; entered.resolve(); await release.promise; }
          return result;
        });
      }
      const first = f.services.cancelTask(f.taskId); await entered.promise;
      const second = f.services.cancelTask(f.taskId); await second;
      expect((await f.cold())?.status).toBe('cancelled');
      f.host.stopAccepting('fixture_drain_after_ingress_closed');
      let drained = false; const drain = f.host.drain().then(() => { drained = true; }); await turn();
      expect.soft(drained, 'the second same-task completion must not erase the first original Promise').toBe(false);
      release.resolve(); await first; await drain; await flushDispatch(f.internals);
      const cold = (await f.cold())!;
      expect.soft(cold.events.slice(f.startIndex).map(event => event.type)).toEqual(['salvage', 'task_terminal']);
      expect(drained).toBe(true);
    });

  it('C12 a second real failed-terminal write failure stays tracked and never upgrades the original flush failure to a successful memory terminal', async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const modelEntered = deferred(), releaseModel = deferred(), providerExited = deferred();
    const releaseFailure = deferred(); cleanup.push(async () => { releaseModel.resolve(); releaseFailure.resolve(); await f.host.drain(); });
    const firstFailure = Object.assign(new Error('first original buffered flush EIO'), { code: 'EIO' });
    const secondFailure = Object.assign(new Error('actual failed-terminal writer EIO'), { code: 'EIO' });
    let flushFaults = 0, failureWrites = 0, failurePending = 0, cancellationDone = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      try { yield { type: 'text', delta: 'A buffered pre-cancel delta.' }; modelEntered.resolve(); await releaseModel.promise; }
      finally { providerExited.resolve(); }
    });
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      if (basename(String(args[0])) === `${f.taskId}.journal.jsonl`) {
        const frame = JSON.parse(String(args[1])) as Frame;
        if (flushFaults === 0 && frame.events.some(event => event.type === 'assistant_delta')) { flushFaults++; throw firstFailure; }
        if (frame.events.some(event => event.type === 'task_terminal' && event.status === 'failed')) {
          failureWrites++; failurePending++; await releaseFailure.promise; failurePending--; throw secondFailure;
        }
      }
      await actual.appendFile(...args);
    });
    await f.host.startTask(f.taskId); await modelEntered.promise;
    const cancelling = f.services.cancelTask(f.taskId).then(() => undefined, error => error as unknown).finally(() => { cancellationDone = true; });
    // setImmediate is real; no fake timer advances a grace/deadline window.
    while (!cancellationDone && failurePending === 0) await turn();
    expect(flushFaults).toBe(1); expect.soft(failurePending).toBe(1);
    releaseModel.resolve(); await providerExited.promise;
    let drained = false; const drain = f.host.drain().then(() => { drained = true; }); await turn();
    if (failurePending) expect(drained).toBe(false);
    releaseFailure.resolve(); expect(await cancelling).toBe(firstFailure); await drain;
    expect.soft(failureWrites).toBe(1); expect(failurePending).toBe(0);
    const cold = (await f.cold())!;
    expect(cold.status).toBe('running');
    expect(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(0);
    // All original IO genuinely rejected. Do not assert a fake saved failure
    // or pretend this case promises an ordinary durable recovery outbox.
    expect(flushFaults).toBe(1);
  });
});
