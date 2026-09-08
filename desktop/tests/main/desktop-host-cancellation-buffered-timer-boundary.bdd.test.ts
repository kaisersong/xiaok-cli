// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
type Internals = { flushMutations(taskId: string): Promise<void>; persistedEventDispatchChains: Map<string, Promise<void>> };

describe('BDD: a real buffered timer already dispatched when cancellation drains its original failure', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.writeFile).mockImplementation(actual.writeFile);
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  it('C21 cancellation consumes an in-flight timer flush failure without losing its already-committed runtime receipt', async () => {
    const f = await authorizationFixture(cleanup);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host, internals = host as unknown as Internals;
    const modelEntered = deferred(), releaseModel = deferred(), writeEntered = deferred(), releaseWrite = deferred();
    cleanup.push(async () => { releaseModel.resolve(); releaseWrite.resolve(); await host.drain(); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      for (let i = 0; i < 253; i++) yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: 'text', delta: 'The original buffered timer owns this delta before cancellation.' };
      modelEntered.resolve(); await releaseModel.promise;
    });
    const task = await host.prepareTask({ prompt: 'Hello', materials: [] });
    await host.startTask(task.taskId); await modelEntered.promise; await internals.flushMutations(task.taskId);
    while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
    expect((await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId))!.events).toHaveLength(255);
    const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
    const failure = Object.assign(new Error('timer-owned original interim checkpoint EIO'), { code: 'EIO' });
    let faults = 0;
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (faults === 0 && basename(String(args[0])).startsWith(`${task.taskId}.json.`)) {
        const snapshot = JSON.parse(String(args[1])) as { events?: unknown[]; status?: string };
        if (snapshot.status === 'running' && snapshot.events?.length === 256) {
          faults++; writeEntered.resolve(); await releaseWrite.promise; throw failure;
        }
      }
      await actual.writeFile(...args);
    });
    // Advance only the existing 50ms delta timer; the real model remains held.
    await vi.advanceTimersByTimeAsync(50); await writeEntered.promise;
    let cancelled = false;
    const cancellation = f.services.cancelTask(task.taskId).then(() => undefined, error => error as unknown).finally(() => { cancelled = true; });
    await turn(); expect(cancelled).toBe(false);
    releaseWrite.resolve(); expect.soft(await cancellation).toBe(failure);
    releaseModel.resolve(); await host.drain();
    while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
    const cold = (await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId))!;
    const runtimeCalls = callback.mock.calls.map(([input]) => input).filter(input => input.taskId === task.taskId && input.event.type === 'assistant_delta');
    console.log('CANCELLATION_ALREADY_DISPATCHED_TIMER_FLUSH', { faults, cold: cold.events.slice(255).map(event => event.type),
      status: cold.status, runtimeCalls: runtimeCalls.map(input => input.eventIndex) });
    expect(cold.events[255]?.type).toBe('assistant_delta'); expect(cold.events.filter(event => event.type === 'assistant_delta')).toHaveLength(1);
    expect.soft(runtimeCalls.map(input => input.eventIndex)).toEqual([255]);
    expect.soft(cold.status).toBe('failed');
    expect(faults).toBe(1);
  });
});
