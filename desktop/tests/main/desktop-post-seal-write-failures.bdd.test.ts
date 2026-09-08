// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { bounded, createPostSealHarness, deferred, hostDelivery, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); });

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), appendFile: vi.fn(actual.appendFile) };
});

describe('R4 explicit settlement errors use the real journal/checkpoint/index queues', () => {
  const fixtures: PostSealHarness[] = [];
  afterEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.writeFile).mockImplementation(actual.writeFile); vi.mocked(fs.appendFile).mockImplementation(actual.appendFile);
    vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) await fixture.close();
  });

  it.each((['flush-journal', 'terminal-checkpoint', 'terminal-index'] as const).flatMap(stage =>
    (['before-sdk-write', 'after-sdk-write'] as const).map(timing => ({ stage, timing }))))(
    'D4 $stage throws $timing: no catch re-flush, no reversed committed terminal, no overlapping writer', async ({ stage, timing }) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const entered = deferred(); let armed = false; let injections = 0; let activeWrites = 0; let maxWrites = 0;
      const failure = Object.assign(new Error(`readonly fixture ${stage} write failed`), { code: 'EIO' });
      async function execute(target: boolean, write: () => Promise<void>): Promise<void> {
        if (!armed) return write();
        activeWrites++; maxWrites = Math.max(maxWrites, activeWrites);
        try {
          if (target && injections === 0) {
            injections++; entered.resolve();
            if (timing === 'after-sdk-write') await write();
            throw failure;
          }
          await write();
        } finally { activeWrites--; }
      }
      vi.mocked(fs.writeFile).mockImplementation((...args) => {
        const path = String(args[0]); const data = String(args[1]);
        const target = stage === 'terminal-checkpoint' ? data.includes('"status": "completed"')
          : stage === 'terminal-index' && basename(path).startsWith('active-task.json') && data.includes('"activeTaskIds": []');
        return execute(target, () => actual.writeFile(...args));
      });
      vi.mocked(fs.appendFile).mockImplementation((...args) => execute(stage === 'flush-journal' && String(args[1]).includes('assistant_delta'), () => actual.appendFile(...args)));
      const f = await createPostSealHarness({ spawnChild: false, prompt: 'Hello', emit: async input => {
        await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId, turnId: 'turn', intentId: 'intent',
          stepId: 'step', delta: 'A buffered result retained by the real mutation journal' });
      }, runnerTail: async () => { armed = true; } }); fixtures.push(f);
      // Observe the actual private method, not a replacement flush/queue algorithm.
      const flush = vi.spyOn(f.host as unknown as { flushRuntimeEvents(taskId: string): Promise<void> }, 'flushRuntimeEvents');
      const taskId = await f.start(); await bounded(entered.promise); await bounded(f.host.drain());
      expect(injections).toBe(1); expect(activeWrites).toBe(0); expect(maxWrites).toBe(1);
      expect.soft(flush).toHaveBeenCalledOnce();
      // Use a cold real store so a cached aggregate cannot conceal disk truth.
      const fresh = new FileTaskSnapshotStore(join(f.root, 'tasks')); const saved = await fresh.recoverTask(taskId);
      const expectedStatus = stage === 'flush-journal' ? 'failed' : 'completed';
      expect.soft(saved?.status).toBe(expectedStatus);
      expect.soft(saved?.events.filter(event => event.type === 'task_terminal')).toEqual([{ type: 'task_terminal', status: expectedStatus }]);
      expect.soft(hostDelivery(saved)).toMatchObject({ status: stage === 'flush-journal' ? 'failed' : 'passed', hostSettlement: 'committed',
        verification: stage === 'flush-journal' ? 'failed' : 'passed' });
      expect((await fresh.getActiveTasks()).map(task => task.taskId)).not.toContain(taskId);
      expect(f.runnerCalls).toBe(1); expect(f.tokenReleases).toBe(1); expect(f.host.inFlightTaskIds()).not.toContain(taskId);
      expect(saved?.events.filter(event => event.type === 'assistant_delta')).toHaveLength(stage === 'flush-journal' && timing === 'before-sdk-write' ? 0 : 1);
      expect(f.store.getRootBinding(taskId)).toMatchObject({ phase: 'settled', status: 'completed' });
    });

  it.each(['terminal-journal', 'terminal-checkpoint'] as const)(
    'D4 persistent %s EIO drains its original writer and sole compensation without claiming pending cleanup forever', async stage => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const starts = nativeWorker.starts; const exits = nativeWorker.exits;
      let armed = false; let failures = 0; let activeWrites = 0; let maxWrites = 0; let terminalAppends = 0;
      const failure = Object.assign(new Error(`persistent ${stage} EIO at the original async filesystem boundary`), { code: 'EIO' });
      async function execute(target: boolean, write: () => Promise<void>): Promise<void> {
        if (!armed) return write();
        activeWrites++; maxWrites = Math.max(maxWrites, activeWrites);
        try {
          // Reject every matching original SDK operation, including compensation.
          // Real host/store queues and all non-target IO remain unchanged.
          if (target) { failures++; throw failure; }
          await write();
        } finally { activeWrites--; }
      }
      vi.mocked(fs.appendFile).mockImplementation((...args) => {
        const terminal = armed && String(args[1]).includes('task_terminal');
        if (terminal) terminalAppends++;
        return execute(stage === 'terminal-journal' && terminal, () => actual.appendFile(...args));
      });
      vi.mocked(fs.writeFile).mockImplementation((...args) => execute(
        stage === 'terminal-checkpoint' && String(args[1]).includes('"status": "completed"'),
        () => actual.writeFile(...args),
      ));
      const f = await createPostSealHarness({ spawnChild: false, prompt: 'Hello', emit: async input => {
        await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId,
          turnId: 'turn', intentId: 'intent', stepId: 'step', delta: 'Answer survives both persistence error receipts' });
      }, runnerTail: async () => { armed = true; } }); fixtures.push(f);
      const flush = vi.spyOn(f.host as unknown as { flushRuntimeEvents(id: string): Promise<void> }, 'flushRuntimeEvents');
      const taskId = await f.start(); await bounded(f.host.drain());
      expect(failures).toBe(2); expect(activeWrites).toBe(0); expect(maxWrites).toBe(1);
      expect(flush).toHaveBeenCalledOnce(); expect(f.runnerCalls).toBe(1); expect(f.tokenReleases).toBe(1);
      expect(f.host.inFlightTaskIds()).not.toContain(taskId);
      expect(nativeWorker.starts - starts).toBe(1); expect(nativeWorker.exits - exits).toBe(1);
      const saved = await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(taskId);
      const terminals = saved?.events.filter(event => event.type === 'task_terminal');
      if (stage === 'terminal-journal') {
        expect(terminalAppends).toBe(2); expect(terminals).toEqual([]);
        expect(saved?.status).toBe('running');
      } else {
        // Journal already committed: a checkpoint receipt cannot reverse it.
        expect(terminalAppends).toBe(1); expect(terminals).toEqual([{ type: 'task_terminal', status: 'completed' }]);
        expect(saved?.status).toBe('completed');
      }
      expect.soft(f.reports.at(-1)?.delivery).toMatchObject({ status: 'unknown', verification: 'passed',
        hostSettlement: 'unknown', readerCleanup: 'settled', storeCleanup: 'settled' });
      expect.soft(f.store.getRootBinding(taskId)).toMatchObject({ phase: 'settled', status: 'completed',
        delivery: { status: 'unknown', verification: 'passed', hostSettlement: 'unknown',
          readerCleanup: 'settled', storeCleanup: 'settled' } });
      expect(failures).toBe(2); expect(terminalAppends).toBe(stage === 'terminal-journal' ? 2 : 1);
    });
});
