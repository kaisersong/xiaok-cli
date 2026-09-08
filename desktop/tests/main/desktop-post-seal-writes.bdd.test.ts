// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { createPostSealHarness, deferred, bounded, hostDelivery, nextTurn, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

const nativeWorker = vi.hoisted(() => ({ output: '', root: '' }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); });

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), appendFile: vi.fn(actual.appendFile) };
});

describe('R4 post-seal real file journal/checkpoint/index dependency barriers', () => {
  const fixtures: PostSealHarness[] = []; const releases: Array<() => void> = [];
  afterEach(async () => {
    for (const release of releases.splice(0)) release(); vi.useRealTimers();
    for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks();
  });

  it.each(['flush-journal', 'terminal-checkpoint', 'terminal-index'] as const)('D3/D4/D17 %s never-settle keeps real host owner and reports unknown without a second writer', async stage => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const entered = deferred(); const release = deferred(); releases.push(() => release.resolve());
    let armed = false; let interceptions = 0;
    const originals = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const write = vi.mocked(fs.writeFile); const append = vi.mocked(fs.appendFile);
    write.mockImplementation(async (...args) => {
      const path = String(args[0]); const data = String(args[1]);
      const target = stage === 'terminal-checkpoint' ? data.includes('"status": "completed"')
        : stage === 'terminal-index' && basename(path).startsWith('active-task.json') && data.includes('"activeTaskIds": []');
      if (armed && target) { interceptions++; entered.resolve(); await release.promise; }
      return originals.writeFile(...args);
    });
    append.mockImplementation(async (...args) => {
      if (armed && stage === 'flush-journal' && String(args[1]).includes('assistant_delta')) {
        interceptions++; entered.resolve(); await release.promise;
      }
      return originals.appendFile(...args);
    });
    const f = await createPostSealHarness({ prompt: 'Hello', emit: async input => {
      await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', delta: 'Pending buffered output' });
    }, runnerTail: async () => { armed = true; } }); fixtures.push(f);
    const id = await f.start(); await bounded(entered.promise);
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)?.status).toBe('completed');
    await vi.advanceTimersByTimeAsync(2100); for (let i = 0; i < 8; i++) await nextTurn();
    expect(f.host.inFlightTaskIds()).toContain(id); expect(f.tokenReleases).toBe(0); expect(interceptions).toBe(1);
    expect.soft(f.reports.at(-1)?.delivery).toMatchObject({ status: 'unknown', hostSettlement: 'unknown', storeCleanup: 'pending',
      verification: stage === 'flush-journal' ? 'failed' : 'passed' });
    if (stage !== 'flush-journal') {
      // The real journal has already committed the candidate while its original
      // checkpoint/index SDK Promise is still pending. A cold recovery must not
      // share a revision with the newer, conflicting SQLite unknown observation.
      const cold = await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(id);
      const candidate = hostDelivery(cold)!;
      const observed = f.store.getRootBinding(id)!.delivery!;
      expect(candidate).toMatchObject({ status: 'passed', verification: 'passed', hostSettlement: 'committed' });
      expect(observed).toMatchObject({ status: 'unknown', verification: 'passed', hostSettlement: 'unknown' });
      expect(f.reports.at(-1)?.source).toEqual(f.reports[0]?.source);
      expect(f.reports.at(-1)?.source.sourceTaskId).toBe(cold?.taskId);
      expect.soft(observed.revision).toBeGreaterThan(candidate.revision);
      expect(interceptions).toBe(1); expect(f.tokenReleases).toBe(0);
    }
    release.resolve(); await bounded(f.host.drain());
    const final = await f.host.inspectTask(id);
    expect(final?.status).toBe(stage === 'flush-journal' ? 'failed' : 'completed');
    expect(hostDelivery(final)).toMatchObject({ status: stage === 'flush-journal' ? 'failed' : 'passed', hostSettlement: 'committed' });
    expect(final?.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(f.runnerCalls).toBe(1); expect(f.tokenReleases).toBe(1);
  });
});
