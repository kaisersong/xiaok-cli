// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { deferred } from '../fixtures/multi-agent-authorization.js';

type Internals = {
  options: { snapshotStore: FileTaskSnapshotStore; acquireExecutionToken?: (taskId: string) => { release(): void } };
  activeExecutions: Map<string, unknown>;
  executionPromises: Map<string, Promise<void>>;
  persistedEventDispatchChains: Map<string, Promise<void>>;
  pendingTerminalPersistedEvents: Map<string, unknown>;
};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

describe('BDD: actual factory cancellation during original asynchronous admission snapshot read', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  it.each(['ordinary', 'multi-agent'] as const)(
    'C19 %s admission cannot restart a cancelled task or strand its sole terminal consumer', async population => {
      const root = mkdtempSync(join(tmpdir(), 'xiaok-cancel-admission-'));
      cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
      vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
      const entered = deferred(), release = deferred();
      const gate = new DesktopShutdownGate();
      let host: InProcessTaskRuntimeHost | undefined, runnerCalls = 0;
      const start = InProcessTaskRuntimeHost.prototype.startTask;
      vi.spyOn(InProcessTaskRuntimeHost.prototype, 'startTask').mockImplementation(function(this: InProcessTaskRuntimeHost, ...args) {
        host = this;
        const internals = this as unknown as Internals;
        // The real main gate tests the existing optional host token port only;
        // it is not a claim that current factory wires this optional port.
        internals.options.acquireExecutionToken = id => gate.acquire('task_execution', id);
        const store = internals.options.snapshotStore, recover = store.recoverTask.bind(store);
        let held = false;
        vi.spyOn(store, 'recoverTask').mockImplementation(async (...readArgs) => {
          const result = await recover(...readArgs);
          if (!held && readArgs[0] === args[0]) { held = true; entered.resolve(); await release.promise; }
          return result;
        });
        return start.apply(this, args);
      });
      const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
        getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
        onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture',
        request: async () => new Response('{}', { status: 503 }),
      } as unknown as KSwarmService;
      const provider = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
        runnerCalls++; yield { type: 'text', delta: 'This execution must not start after cancellation.' };
      });
      const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
        workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService,
        ...(population === 'ordinary' ? { runner: async () => { runnerCalls++; } } : {}),
      });
      cleanup.push(() => services.disposeMultiAgent());
      cleanup.push(async () => { release.resolve(); await host?.drain(); });
      await services.multiAgent?.ready;
      const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
      const created = await services.createGoal({ threadId: 'admission-cancel', objective: 'Hello', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
      const taskId = created.preparedTask.taskId;
      const admission = services.ackGoalTaskAttached({ threadId: 'admission-cancel', attachmentId: created.preparedTask.attachmentId })
        .then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
      await entered.promise;
      const actualHost = host!, internals = actualHost as unknown as Internals;
      expect(internals.executionPromises.has(taskId)).toBe(true); expect(internals.activeExecutions.has(taskId)).toBe(false);
      expect(gate.outstandingByKind()).toEqual({ task_execution: 1 });
      await services.cancelTask(taskId);
      const cold = () => new FileTaskSnapshotStore(join(root, 'data', 'tasks')).recoverTask(taskId);
      const cancelled = (await cold())!;
      expect(cancelled.status).toBe('cancelled'); expect(cancelled.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
      expect(runnerCalls).toBe(0);
      let drained = false; const draining = actualHost.drain().then(() => { drained = true; }); await turn();
      expect(drained).toBe(false); expect(gate.outstanding).toBe(1);
      expect(callback.mock.calls.filter(([input]) => input.taskId === taskId && input.event.type === 'task_terminal')).toHaveLength(0);
      release.resolve(); const admitted = await admission; await draining;
      while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
      const settled = (await cold())!;
      const terminalCalls = callback.mock.calls.map(([input]) => input).filter(input => input.taskId === taskId && input.event.type === 'task_terminal');
      console.log('CANCELLATION_ORIGINAL_ADMISSION_READ', { population, admitted, runnerCalls, status: settled.status,
        events: settled.events.map(event => event.type), terminalCalls: terminalCalls.map(input => [input.eventIndex, input.event.type]),
        pendingTerminal: internals.pendingTerminalPersistedEvents.has(taskId), outstanding: gate.outstanding });
      expect.soft(runnerCalls).toBe(0); expect.soft(settled.status).toBe('cancelled');
      expect.soft(settled.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
      expect.soft(terminalCalls).toHaveLength(1);
      expect.soft(internals.pendingTerminalPersistedEvents.has(taskId)).toBe(false);
      expect(gate.outstanding).toBe(0); expect(actualHost.inFlightTaskIds()).not.toContain(taskId);
      expect((await new FileTaskSnapshotStore(join(root, 'data', 'tasks')).getActiveTasks()).map(item => item.taskId)).not.toContain(taskId);
      if (population === 'multi-agent') expect(provider).not.toHaveBeenCalled();
    });
});
