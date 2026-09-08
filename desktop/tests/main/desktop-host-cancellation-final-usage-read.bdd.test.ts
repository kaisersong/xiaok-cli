// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import { deferred } from '../fixtures/multi-agent-authorization.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: vi.fn(actual.appendFile), readFile: vi.fn(actual.readFile) };
});
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
type Internals = { persistedEventDispatchChains: Map<string, Promise<void>> };

describe('BDD: final cancellation cost confirmation owns actual Store reads until their outcome', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.appendFile).mockImplementation(actual.appendFile);
    vi.mocked(fs.readFile).mockImplementation(actual.readFile);
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });

  it.each(['pending-resolve', 'pending-reject', 'persistent-reject', 'pending-followup'] as const)(
    'C18 final native read %s never releases an unsettled execution or invents latest Goal cost', async stage => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const root = mkdtempSync(join(tmpdir(), 'xiaok-cancel-final-cost-'));
      cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
      vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
      const modelEntered = deferred(), releaseModel = deferred(), usageCommitted = deferred(), releaseUsage = deferred();
      const releaseRead = deferred(), releaseFollowupRead = deferred();
      const gate = new DesktopShutdownGate();
      let host: InProcessTaskRuntimeHost | undefined, taskId = '', readArmed = false;
      const start = InProcessTaskRuntimeHost.prototype.startTask;
      vi.spyOn(InProcessTaskRuntimeHost.prototype, 'startTask').mockImplementation(function(this: InProcessTaskRuntimeHost, ...args) {
        host = this;
        // Exercise the host's existing main-only token port using the real
        // shutdown owner. Current factory does not wire this optional port;
        // this is not evidence that factory startup already owns such tokens.
        const options = (this as unknown as { options: { acquireExecutionToken?: (id: string) => { release(): void } } }).options;
        options.acquireExecutionToken = id => gate.acquire('task_execution', id);
        return start.apply(this, args);
      });
      const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
        getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
        onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture',
        request: async () => new Response('{}', { status: 503 }),
      } as unknown as KSwarmService;
      const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
        workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService,
        runner: async input => { modelEntered.resolve(); await releaseModel.promise; await input.emitUsage({ inputTokens: 17, outputTokens: 19 }); },
      });
      cleanup.push(() => services.disposeMultiAgent());
      cleanup.push(async () => { readArmed = false; releaseModel.resolve(); releaseUsage.resolve(); releaseRead.resolve(); releaseFollowupRead.resolve(); await host?.drain(); });
      const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
      const created = await services.createGoal({ threadId: 'final-cost', objective: 'Hello', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
      taskId = created.preparedTask.taskId;
      await services.ackGoalTaskAttached({ threadId: 'final-cost', attachmentId: created.preparedTask.attachmentId });
      await modelEntered.promise;
      const actualHost = host!, internals = actualHost as unknown as Internals;
      const ownerStore = (actualHost as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
      const recover = ownerStore.recoverTask.bind(ownerStore);
      const observedReads: Array<Promise<unknown>> = [];
      vi.spyOn(ownerStore, 'recoverTask').mockImplementation((...args) => {
        const raw = recover(...args);
        if (readArmed) observedReads.push(raw);
        return raw;
      });
      expect(gate.outstandingByKind()).toEqual({ task_execution: 1 });
      await services.cancelTask(taskId);
      const cold = () => new FileTaskSnapshotStore(join(root, 'data', 'tasks')).recoverTask(taskId);
      const cancelled = (await cold())!;
      const terminalIndex = cancelled.events.findIndex(event => event.type === 'task_terminal');
      const writeFailure = Object.assign(new Error('late usage native append completed but its receipt rejected'), { code: 'EIO' });
      const readFailure = Object.assign(new Error('native final-cost checkpoint read unavailable'), { code: 'EIO' });
      let writeFaults = 0, finalReads = 0, pendingReads = 0;
      vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
        await actual.appendFile(...args);
        if (writeFaults === 0 && basename(String(args[0])) === `${taskId}.journal.jsonl` && String(args[1]).includes('usage_recorded')) {
          writeFaults++; usageCommitted.resolve(); await releaseUsage.promise; throw writeFailure;
        }
      });
      vi.mocked(fs.readFile).mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
        if (readArmed && basename(String(args[0])) === `${taskId}.json`) {
          finalReads++;
          if (stage !== 'persistent-reject') {
            const wait = stage === 'pending-followup' && finalReads === 2 ? releaseFollowupRead : releaseRead;
            pendingReads++; try { await wait.promise; } finally { pendingReads--; }
          }
          if (stage !== 'pending-resolve' && stage !== 'pending-followup') throw readFailure;
        }
        return actual.readFile(...args);
      });
      releaseModel.resolve(); await usageCommitted.promise;
      // A separate production FileStore proves the complete native journal
      // before arming read faults. The old owner cache is invalidated only by
      // its real save rejection, not by test mutation of cache/checksum/state.
      const committed = (await cold())!;
      expect(committed.usage).toEqual({ inputTokens: 17, outputTokens: 19, known: true });
      expect(committed.events[terminalIndex]).toEqual(cancelled.events[terminalIndex]);
      readArmed = true;
      let drained = false; const draining = actualHost.drain().then(() => { drained = true; });
      releaseUsage.resolve();
      while (finalReads === 0 && !drained) await turn();
      expect.soft(finalReads, 'physical-finally must confirm the actual Store after the original cache-invalidating save failure').toBeGreaterThan(0);
      if (stage !== 'persistent-reject') {
        expect.soft(pendingReads).toBe(1);
        expect.soft(drained).toBe(false);
        expect.soft(actualHost.inFlightTaskIds()).toContain(taskId);
        expect.soft(gate.outstandingByKind()).toEqual({ task_execution: 1 });
        expect.soft(callback.mock.calls.filter(([input]) => input.taskId === taskId && input.event.type === 'task_terminal')).toHaveLength(0);
      }
      if (stage === 'pending-followup') {
        const followup = services.cancelTask(taskId);
        while (finalReads < 2) await turn();
        releaseRead.resolve(); await observedReads[0]; await turn();
        expect.soft(pendingReads).toBe(1);
        expect.soft(gate.outstandingByKind(), 'a new actual stop read entered while the final fact was pending').toEqual({ task_execution: 1 });
        expect.soft(actualHost.inFlightTaskIds()).toContain(taskId);
        expect.soft(callback.mock.calls.filter(([input]) => input.taskId === taskId && input.event.type === 'task_terminal')).toHaveLength(0);
        releaseFollowupRead.resolve(); await followup;
      }
      releaseRead.resolve(); await draining;
      while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
      expect(pendingReads).toBe(0); expect(gate.outstanding).toBe(0);
      expect(actualHost.inFlightTaskIds()).not.toContain(taskId);
      expect(finalReads).toBeLessThanOrEqual(stage === 'pending-followup' ? 4 : 2); // one extra actual user stop, not an automatic retry loop
      readArmed = false;
      const confirmed = (await cold())!;
      const goalStore = new SqliteGoalStore(join(root, 'data', 'goals', 'goals.sqlite'));
      cleanup.push(() => goalStore.close());
      const document = (await goalStore.load('final-cost'))!;
      const terminals = callback.mock.calls.map(([input]) => input).filter(input => input.taskId === taskId && input.event.type === 'task_terminal');
      console.log('CANCELLATION_FINAL_COST_NATIVE_READ', { stage, finalReads, writeFaults, usage: confirmed.usage,
        terminalCount: terminals.length, callbackUsage: terminals.map(input => input.snapshot.usage), goalTokens: document.state.tokensUsed,
        turns: document.turns.length, outstanding: gate.outstanding, drained });
      expect(confirmed.usage).toEqual(committed.usage);
      expect(confirmed.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
      if (stage === 'pending-resolve' || stage === 'pending-followup') {
        expect.soft(terminals).toHaveLength(1);
        expect.soft(terminals[0]?.eventIndex).toBe(terminalIndex);
        expect.soft(terminals[0]?.snapshot.usage).toEqual(confirmed.usage);
        expect.soft(document.turns.map(item => item.tokensUsed)).toEqual([36]);
      } else {
        expect.soft(terminals, 'unknown final cost must not be irreversibly settled from the old zero-cost receipt').toHaveLength(0);
        expect.soft(document.turns).toHaveLength(0);
      }
      // An explicit later stop is not authority to duplicate an already
      // dispatched terminal; unknown ordinary delivery is not promised here.
      await services.cancelTask(taskId);
      while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
      const later = callback.mock.calls.map(([input]) => input).filter(input => input.taskId === taskId && input.event.type === 'task_terminal');
      expect.soft(later.length).toBeLessThanOrEqual(1);
      expect((await goalStore.load('final-cost'))!.turns.length).toBeLessThanOrEqual(1);
      expect(writeFaults).toBe(1);
    });
});
