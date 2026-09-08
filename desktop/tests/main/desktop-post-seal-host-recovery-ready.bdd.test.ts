// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { bounded, deferred, nextTurn } from '../fixtures/desktop-post-seal-harness.js';
import { snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';

interface RecoveryReadyContract {
  bindMultiAgentRecovery(ready: Promise<void>): void;
  inspectActiveTasks(): Promise<Array<{ taskId: string }>>;
}
const readyContract = (host: InProcessTaskRuntimeHost) => host as unknown as RecoveryReadyContract;

describe('R4/D18 host public recovery readers share the actual startup owner', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  async function crashedOwner() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-ready-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const processOwner = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts', import.meta.url)), root, 'before-marker'], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = new Promise<void>(resolve => processOwner.once('close', () => resolve()));
    const stop = async () => { if (processOwner.exitCode === null && processOwner.signalCode === null) processOwner.kill('SIGKILL'); await closed; };
    cleanup.push(stop);
    let text = ''; let stderr = '';
    processOwner.stderr!.on('data', chunk => { stderr += String(chunk); });
    const taskId = await bounded(new Promise<string>((resolve, reject) => {
      processOwner.once('error', reject);
      processOwner.once('close', code => reject(new Error(`owner exited before seal ${code}: ${stderr}`)));
      processOwner.stdout!.on('data', chunk => {
        text += String(chunk);
        for (;;) {
          const newline = text.indexOf('\n'); if (newline < 0) return;
          const line = text.slice(0, newline); text = text.slice(newline + 1);
          if (!line.startsWith('{')) continue;
          const event = JSON.parse(line) as { stage: string; taskId: string };
          if (event.stage === 'sealed') resolve(event.taskId);
        }
      });
    }));
    await stop();
    expect(processOwner.exitCode !== null || processOwner.signalCode !== null).toBe(true);
    return { root, taskId };
  }

  function open(root: string) {
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
    const runner = vi.fn(async () => {});
    const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots,
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner });
    const sessions = vi.fn(async () => { throw new Error('replay forbidden'); });
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: sessions });
    cleanup.push(() => service.dispose());
    return { store, snapshots, host, runner, sessions, service };
  }

  it.each(['recoverTask', 'getActiveTask', 'getActiveTasks'] as const)('%s cannot overtake actual startup inspect and turn a bound root into ordinary stale failure', async method => {
    const { root, taskId } = await crashedOwner(); const f = open(root);
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const inspect = f.host.inspectTask.bind(f.host);
    let held = false;
    vi.spyOn(f.host, 'inspectTask').mockImplementation(async (...args) => {
      if (!held) { held = true; entered.resolve(); await release.promise; }
      return inspect(...args);
    });
    const ready = f.service.initialize(f.host); void ready.catch(() => undefined); await bounded(entered.promise);
    let settled = false;
    const read = (method === 'recoverTask' ? f.host.recoverTask(taskId) : f.host[method]())
      .then(value => { settled = true; return { ok: true as const, value }; }, error => { settled = true; return { ok: false as const, error }; });
    // These are actual filesystem continuations, not a fake timer or invented
    // await inserted into a synchronous production transaction.
    for (let i = 0; i < 20; i++) await nextTurn();
    expect.soft(settled).toBe(false);
    expect.soft((await new FileTaskSnapshotStore(join(root, 'tasks')).recoverTask(taskId))?.status).toBe('running');
    release.resolve(); await bounded(ready); expect((await bounded(read)).ok).toBe(true);
    expect(await inspect(taskId)).toMatchObject({ status: 'failed', salvage: { reason: 'multi_agent_prepare_interrupted' } });
    expect(f.runner).not.toHaveBeenCalled(); expect(f.sessions).not.toHaveBeenCalled();
  });

  it.each(['recoverTask', 'getActiveTask', 'getActiveTasks'] as const)('%s propagates failed initialization instead of returning or mutating through it', async method => {
    const { root, taskId } = await crashedOwner(); const f = open(root);
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const failure = new Error('controlled recovery source read failure');
    const inspect = f.host.inspectTask.bind(f.host); let held = false;
    vi.spyOn(f.host, 'inspectTask').mockImplementation(async (...args) => {
      if (!held) { held = true; entered.resolve(); await release.promise; throw failure; }
      return inspect(...args);
    });
    const ready = f.service.initialize(f.host); void ready.catch(() => undefined); await bounded(entered.promise);
    const read = (method === 'recoverTask' ? f.host.recoverTask(taskId) : f.host[method]())
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    release.resolve(); await expect(ready).rejects.toBe(failure);
    expect(await bounded(read)).toMatchObject({ ok: false, error: failure });
    expect((await new FileTaskSnapshotStore(join(root, 'tasks')).recoverTask(taskId))?.status).toBe('running');
    expect(f.runner).not.toHaveBeenCalled(); expect(f.sessions).not.toHaveBeenCalled();
  });

  it('only the first main readiness Promise may bind; identical bind is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-ready-bind-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const f = open(root); const contract = readyContract(f.host); const ready = Promise.resolve();
    expect(typeof contract.bindMultiAgentRecovery).toBe('function');
    contract.bindMultiAgentRecovery(ready); expect(() => contract.bindMultiAgentRecovery(ready)).not.toThrow();
    expect(() => contract.bindMultiAgentRecovery(Promise.resolve())).toThrow(/recovery.*bound|readiness.*bound/);
  });

  it('ordinary snapshots retain their existing recovery while internal inspect never waits or clears the index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-ready-ordinary-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const f = open(root); const ready = deferred(); cleanup.push(() => ready.resolve());
    if (typeof readyContract(f.host).bindMultiAgentRecovery === 'function') readyContract(f.host).bindMultiAgentRecovery(ready.promise);
    const task = snapshotFixture({ taskId: 'ordinary-ready-control' }); await f.snapshots.save(task);
    const cleared = vi.spyOn(f.snapshots, 'clearActiveTask');
    expect(await bounded(f.host.inspectTask(task.taskId))).toEqual(task);
    if (typeof readyContract(f.host).inspectActiveTasks === 'function') {
      expect(await bounded(readyContract(f.host).inspectActiveTasks())).toEqual([{ taskId: task.taskId }]);
      expect(cleared).not.toHaveBeenCalled();
    }
    expect((await bounded(f.host.recoverTask(task.taskId))).snapshot).toMatchObject({ status: 'failed', salvage: { reason: 'stale_running_task_recovered' } });
    expect(f.runner).not.toHaveBeenCalled();
  });
});
