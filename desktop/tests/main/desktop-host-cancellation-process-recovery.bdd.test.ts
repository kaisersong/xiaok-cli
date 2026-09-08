// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { HostDeliveryRecoveryReceipt } from '../../../src/runtime/task-host/delivery-types.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { bounded } from '../fixtures/desktop-post-seal-harness.js';

interface SeedReceipt {
  stage: 'cancel-write-rejected'; pid: number; taskId: string; groupId: string; bootId: string;
  faults: number; aborts: number; runnerCalls: number; inFlight: boolean; beforeEventCount: number;
  coldStatus: string; goalStatus: string; goalTurns: number; goalAttached: boolean;
  frameEvents: string[][]; cancellationFrames: number; hasDelivery: boolean;
}
const threadId = 'post-seal-thread';
describe('C10 actual OS exit preserves an original cancelled MA Goal terminal through startup recovery', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  async function oldOwner(fault: 'checkpoint-write' | 'index-write') {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-cancel-process-recovery-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    // process.execPath is the real executable, not a .cmd shim. SIGKILL below
    // is a real test-owned process termination on Windows too, never a PID mock.
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-host-cancellation-process-recovery-child.ts', import.meta.url)), root, fault], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; let stderr = '';
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return bounded(closed);
    };
    cleanup.push(async () => { await stop(); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const reached = new Promise<SeedReceipt>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => reject(new Error(`old owner exited before native write receipt (${code}/${signal}): ${stderr}`)));
      child.stdout.on('data', chunk => {
        output += String(chunk);
        for (;;) {
          const end = output.indexOf('\n'); if (end < 0) return;
          const line = output.slice(0, end); output = output.slice(end + 1);
          if (!line.startsWith('{')) continue;
          const receipt = JSON.parse(line) as SeedReceipt;
          if (receipt.stage === 'cancel-write-rejected') resolve(receipt);
        }
      });
    });
    return { root, child, receipt: await bounded(reached), stop };
  }

  function open(root: string) {
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    const goalStore = new SqliteGoalStore(join(root, 'goals.sqlite'));
    const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
    const runner = vi.fn(async () => { throw new Error('recovery runner replay forbidden'); });
    const createSession = vi.fn(async () => { throw new Error('recovery agent replay forbidden'); });
    const receipts: HostDeliveryRecoveryReceipt[] = [];
    const changed = vi.fn(); const prepared = vi.fn();
    let goal: DesktopGoalCoordinator;
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession,
      onRecoveredHostTerminal: async input => {
        // Capture the service-issued object itself; authorizing a copied scalar
        // ownerId must still fail inside this active recovery callback.
        receipts.push(input);
        service.assertDeliveryRecovery(input);
        expect(() => service.assertDeliveryRecovery({ ...input, authority: { ...input.authority } }))
          .toThrow('invalid_delivery_recovery_owner');
        await goal.handleRecoveredHostTerminal(input);
        // A repeated legitimate consumer while authority is live is exactly
        // idempotent, not a second turn or a model continuation.
        await goal.handleRecoveredHostTerminal(input);
      },
    });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots, runner,
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
      authorizeDeliveryRecovery: input => service.assertDeliveryRecovery(input),
    });
    const prepare = vi.spyOn(host, 'prepareTask'), start = vi.spyOn(host, 'startTask'), cancel = vi.spyOn(host, 'cancelTask');
    const save = vi.spyOn(snapshots, 'save');
    goal = new DesktopGoalCoordinator({ store: goalStore, taskHost: host, instanceId: 'cancel-new-owner',
      publishGoalChanged: changed, publishGoalTaskPrepared: prepared,
      authorizeRecoveredDelivery: input => service.assertDeliveryRecovery(input),
    });
    cleanup.push(async () => { await bounded(host.drain()); await service.dispose(); goal.disarmAll(); goalStore.close(); store.close(); });
    return { store, goalStore, snapshots, runner, createSession, receipts, changed, prepared, service, host, goal, prepare, start, cancel, save };
  }

  it.each(['checkpoint-write', 'index-write'] as const)(
    '%s fails after actual complete cancellation bytes; a physically exited owner recovers the exact terminal once', async fault => {
      const old = await oldOwner(fault);
      expect(old.receipt).toMatchObject({ aborts: 1, runnerCalls: 1, inFlight: true,
        coldStatus: 'cancelled', goalStatus: 'active', goalTurns: 0, goalAttached: true, cancellationFrames: 1, hasDelivery: false });
      if (fault === 'checkpoint-write') expect(old.receipt.faults).toBe(1);
      else expect(old.receipt.faults).toBeGreaterThanOrEqual(1);
      expect(old.receipt.pid).toBe(old.child.pid);
      expect(old.receipt.pid).not.toBe(process.pid);
      const taskDir = join(old.root, 'tasks');
      const cold = (await new FileTaskSnapshotStore(taskDir).recoverTask(old.receipt.taskId))!;
      expect(cold.status).toBe('cancelled');
      expect(cold.multiAgentPreparation?.bootId).toBe(old.receipt.bootId);
      expect(cold.executionScope).toMatchObject({ kind: 'goal_turn', threadId });
      expect(cold.events.filter(event => event.type === 'salvage')).toHaveLength(1);
      expect(cold.events.filter(event => event.type === 'task_terminal')).toEqual([{ type: 'task_terminal', status: 'cancelled' }]);
      expect(cold.usage).toMatchObject({ known: true, inputTokens: 7, outputTokens: 11 });
      const checkpointPath = join(taskDir, 'snapshots', `${old.receipt.taskId}.json`);
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as TaskSnapshot;
      const staleIndex = JSON.parse(readFileSync(join(taskDir, 'active-task.json'), 'utf8')) as { activeTaskIds: string[] };
      if (fault === 'checkpoint-write') {
        expect(checkpoint.status).not.toBe('cancelled');
        const journal = readFileSync(join(taskDir, 'snapshots', `${old.receipt.taskId}.journal.jsonl`), 'utf8');
        expect(journal.endsWith('\n')).toBe(true);
      } else {
        expect(checkpoint.status).toBe('cancelled');
        expect(staleIndex.activeTaskIds).toContain(old.receipt.taskId);
      }
      const inspectOwner = () => {
        const db = new DatabaseSync(join(old.root, 'groups.sqlite'), { readOnly: true });
        try { return db.prepare('SELECT owner_pid,state FROM boot_owners WHERE boot_id=?').get(old.receipt.bootId); }
        finally { db.close(); }
      };
      expect(inspectOwner()).toMatchObject({ owner_pid: old.receipt.pid, state: 'active' });
      const actualExit = await old.stop();
      expect(old.child.exitCode !== null || old.child.signalCode !== null).toBe(true);
      // No manufactured quiesced flag: it is still active on disk until the
      // production claimant checks the old PID and writes its exited fact.
      expect(inspectOwner()).toMatchObject({ state: 'active' });
      expect(() => process.kill(old.receipt.pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }));
      const f = open(old.root);
      await bounded(f.service.initialize(f.host));
      expect(inspectOwner()).toMatchObject({ state: 'exited' });
      expect(f.receipts).toHaveLength(1);
      const receipt = f.receipts[0];
      expect(receipt.snapshot).toEqual(cold);
      expect(receipt.eventIndex).toBe(cold.events.length - 1);
      expect(receipt.event).toEqual(cold.events[receipt.eventIndex]);
      expect(() => f.service.assertDeliveryRecovery(receipt)).toThrow('invalid_delivery_recovery_owner');
      const document = (await f.goalStore.load(threadId))!;
      expect(document.turns).toHaveLength(1);
      expect(document.events.filter(event => event.type === 'turn_settled')).toHaveLength(1);
      expect(document.state).toMatchObject({ status: 'paused', terminalReason: 'task_cancelled', turnsUsed: 1, tokensUsed: 18 });
      expect(await f.goal.getGoal(threadId)).toMatchObject({ activation: 'disarmed' });
      expect(f.goal.getPendingAttachmentForTest(threadId)).toBeNull();
      expect(await new FileTaskSnapshotStore(taskDir).recoverTask(old.receipt.taskId)).toEqual(cold);
      expect(f.save).not.toHaveBeenCalled();
      for (const method of [f.runner, f.createSession, f.prepare, f.start, f.cancel, f.prepared]) expect(method).not.toHaveBeenCalled();
      expect(f.host.inFlightTaskIds()).toEqual([]);
      expect(f.store.getRootBinding(old.receipt.taskId)?.sourceTaskId).toBe(old.receipt.taskId);
      console.info('C10_REAL_OS_RECOVERY', { fault, oldPid: old.receipt.pid, actualExit,
        oldFrameEvents: old.receipt.frameEvents, originalTerminalIndex: receipt.eventIndex,
        newBootId: f.store.bootId, recoveredHostStatus: receipt.snapshot.status,
        goalTurns: document.turns.length, tokensUsed: document.state.tokensUsed, replayCalls: 0 });
    });
});
