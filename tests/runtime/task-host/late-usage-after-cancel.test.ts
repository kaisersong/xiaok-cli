import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InProcessTaskRuntimeHost, type TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

it('the original cancelled execution commits final usage without admitting late runtime events or expired writers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-final-usage-'));
  let enter!: () => void, release!: () => void, original!: TaskRunnerInput;
  const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const directory = join(root, 'tasks'), store = new FileTaskSnapshotStore(directory);
  const host = new InProcessTaskRuntimeHost({ snapshotStore: store, materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner: async input => {
    original = input;enter();await gate;
    await input.emitUsage({ inputTokens: 17, outputTokens: 19 });
    await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: 'old-turn', intentId: 'old-intent', stepId: 'old-step', note: 'late forbidden runtime event' });
  } });
  try {
    const task = await host.createTask({ prompt: 'original bounded request', materials: [] });await entered;
    await host.cancelTask(task.taskId);
    const cold = () => new FileTaskSnapshotStore(directory).recoverTask(task.taskId);
    const cancelled = (await cold())!;expect(cancelled.status).toBe('cancelled');
    const terminalIndex = cancelled.events.findIndex(event => event.type === 'task_terminal');expect(terminalIndex).toBeGreaterThanOrEqual(0);
    release();await host.drain();
    const complete = (await cold())!;
    expect(complete.status).toBe('cancelled');expect(complete.events[terminalIndex]).toEqual(cancelled.events[terminalIndex]);
    expect(complete.usage).toEqual({ inputTokens: 17, outputTokens: 19, known: true });
    expect(complete.events.slice(cancelled.events.length)).toEqual([{ type: 'usage_recorded', inputTokens: 17, outputTokens: 19 }]);
    await expect(original.emitUsage({ inputTokens: 99, outputTokens: 99 })).rejects.toThrow('SOL_PI_DESKTOP_EXECUTION_EXPIRED');
    expect(await cold()).toEqual(complete);
  } finally { release();await host.drain();rmSync(root,{recursive:true,force:true}); }
});
