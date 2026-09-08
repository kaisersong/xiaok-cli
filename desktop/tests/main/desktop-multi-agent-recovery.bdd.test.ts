// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
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

describe('BDD: startup proves physical boot ownership before reconciliation', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ma-recovery-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const dbPath = join(root, 'groups.sqlite');
    const old = new DesktopMultiAgentStore(dbPath, { bootId: 'old-boot' }); cleanup.push(() => old.close());
    old.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = old.createGroup('thread');
    const next = () => {
      const store = new DesktopMultiAgentStore(dbPath, { bootId: 'new-boot' }); cleanup.push(() => store.close());
      const coordinator = new DesktopExecutionCoordinator();
      const createSession = vi.fn(async () => { throw new Error('must not create'); });
      const service = new DesktopMultiAgentService({ store, coordinator, createSession });
      cleanup.push(() => service.dispose());
      const runner = vi.fn(async () => {});
      const snapshotStore = new FileTaskSnapshotStore(join(root, 'tasks'));
      const host = new InProcessTaskRuntimeHost({ snapshotStore,
        materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner });
      return { store, coordinator, service, host, runner, snapshotStore, createSession };
    };
    return { root, old, group, next };
  }
  async function liveProcess(): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; } });
    await once(child.stdout!, 'data'); return child;
  }

  it('A12/A25 Given an actually accepted queued followup before process death, Then reopening keeps its historical source without replay or guessing a new root', async () => {
    const f = fixture(); const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const script = `
      import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
      const load = file => import(pathToFileURL(join(${JSON.stringify(projectRoot)}, file)).href);
      const { DesktopMultiAgentStore } = await load('desktop/electron/desktop-multi-agent-store.ts');
      const { DesktopMultiAgentService } = await load('desktop/electron/desktop-multi-agent-service.ts');
      const { DesktopExecutionCoordinator } = await load('desktop/electron/desktop-execution-coordinator.ts');
      const { InProcessTaskRuntimeHost } = await load('src/runtime/task-host/task-runtime-host.ts');
      const { FileTaskSnapshotStore } = await load('src/runtime/task-host/snapshot-store.ts');
      const { MaterialRegistry } = await load('src/runtime/task-host/material-registry.ts');
      const root = ${JSON.stringify(f.root)}; const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'), { bootId: 'old-boot' });
      const coordinator = new DesktopExecutionCoordinator(); let childId;
      const service = new DesktopMultiAgentService({ store, coordinator, createSession: async () => ({
        run: async () => new Promise(() => {}), suspend: async () => {}, dispose: async () => {},
      }) });
      const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
        materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
        runner: input => service.runRoot(input, async context => {
          childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'crash-spawn', taskName: 'crash', message: 'first' })).targetAgentId;
          await service.followup({ actor: context.actor, requestSource: 'agent', operationId: 'crash-followup', target: childId, message: 'not replayed' });
        }), authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
        decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason), getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      });
      await service.initialize(host);
      const task = await service.prepareRoot(host, 'thread', { prompt: 'source A', materials: [] }); await host.startTask(task.taskId); await host.drain();
      process.stdout.write(JSON.stringify({ childId, sourceTaskId: task.taskId }) + '\\n');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; } });
    let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const ready = await new Promise<{ childId: string; sourceTaskId: string }>((resolve, reject) => {
      let text = '';
      child.once('error', reject);
      child.once('close', code => reject(new Error(`source recovery fixture exited ${code}: ${stderr}`)));
      child.stdout!.on('data', chunk => {
        text += String(chunk); const line = text.split('\n').find(item => item.startsWith('{"childId"') && item.endsWith('}'));
        if (line) { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } }
      });
    });
    expect(f.old.getOperation(f.group.groupId, 'crash-followup')).toMatchObject({ applyState: 'applied', result: { state: 'queued_next_admission' } });
    expect(f.old.getAgent(f.group.groupId, ready.childId)?.sourceTaskId).toBe(ready.sourceTaskId);
    const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
    const n = f.next(); await n.service.initialize(n.host);
    const access = n.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    expect(n.store.activeGroup('thread')).toBeNull();
    expect(n.store.getAgent(f.group.groupId, ready.childId)).toMatchObject({ sourceTaskId: ready.sourceTaskId, turn: 1, resumable: false, executionActive: false });
    expect(n.service.getSnapshot({ access, groupId: f.group.groupId })).toMatchObject({ group: { historicalOnly: true }, hasAgentHistory: true });
    await expect(n.service.userFollowup({ access, requestSource: 'user', groupId: f.group.groupId, agentId: ready.childId,
      expectedTurn: 1, operationId: 'try-resume-history', message: 'must not run' })).rejects.toThrow(/historical|read.only/);
    expect(n.store.getOperation(f.group.groupId, 'crash-followup')?.result.state).toBe('queued_next_admission');
    expect(n.store.getOperation(f.group.groupId, 'try-resume-history')).toBeNull();
    expect(n.runner).not.toHaveBeenCalled(); expect(n.createSession).not.toHaveBeenCalled(); expect(n.coordinator.snapshot().active).toBe(0);
    console.info('[followup-source-recovery]', JSON.stringify({ ownerPid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
      sourceTaskId: ready.sourceTaskId, recoveredSourceTaskId: n.store.getAgent(f.group.groupId, ready.childId)?.sourceTaskId,
      oldReceiptState: n.store.getOperation(f.group.groupId, 'crash-followup')?.result.state, newSessionCalls: n.createSession.mock.calls.length }));
  });

  it('A26/A31 Given a live previous process, Then no recovery mutation or ordinary admission is allowed', async () => {
    const f = fixture(); const child = await liveProcess();
    f.old.claimBootOwnership(child.pid!);
    f.old.putAgent(f.group.groupId, { ...f.old.getAgent(f.group.groupId, `root_${f.group.groupId}`)!, status: 'running', turn: 1, executionActive: true, runtimeResident: true });
    const n = f.next();
    await expect(n.service.initialize(n.host)).rejects.toThrow(/owner.*live/);
    expect(n.store.activeGroup('thread')?.groupId).toBe(f.group.groupId);
    expect(n.store.getAgent(f.group.groupId, `root_${f.group.groupId}`)?.executionActive).toBe(true);
    await expect(n.coordinator.acquireLease({ policy: 'ordinary' })).rejects.toThrow(/owner|blocked/);
    expect(n.runner).not.toHaveBeenCalled();
  });

  it('A26/A42 Given that exact process has exited, Then old JS ownership settles without replay and a new boot is admitted', async () => {
    const f = fixture(); const child = await liveProcess(); f.old.claimBootOwnership(child.pid!);
    f.old.putAgent(f.group.groupId, { ...f.old.getAgent(f.group.groupId, `root_${f.group.groupId}`)!, status: 'running', turn: 1, executionActive: true, sessionResident: true, runtimeResident: true });
    const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
    const n = f.next(); await n.service.initialize(n.host);
    expect(n.store.activeGroup('thread')).toBeNull();
    expect(n.store.getAgent(f.group.groupId, `root_${f.group.groupId}`)).toMatchObject({ status: 'interrupted', executionActive: false, sessionResident: false, runtimeResident: false, resourcesReleased: true, cleanupPending: false });
    const lease = await n.coordinator.acquireLease({ policy: 'ordinary' }); lease.release();
    expect(n.runner).not.toHaveBeenCalled();
  });

  it('A26 Given a PID probe returns EPERM rather than ESRCH, Then ownership remains unknown and history is not rewritten', async () => {
    const f = fixture(); f.old.claimBootOwnership(2147483646);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    const n = f.next(); await expect(n.service.initialize(n.host)).rejects.toThrow(/owner.*unknown/);
    expect(n.store.activeGroup('thread')?.groupId).toBe(f.group.groupId);
  });

  it('A26 Given no owner identity but a persisted live execution, Then no fabricated recovery releases its slot', async () => {
    const f = fixture(); f.old.putAgent(f.group.groupId, { ...f.old.getAgent(f.group.groupId, `root_${f.group.groupId}`)!, status: 'running', executionActive: true });
    const n = f.next(); await expect(n.service.initialize(n.host)).rejects.toThrow(/owner.*unknown/);
    expect(n.store.getAgent(f.group.groupId, `root_${f.group.groupId}`)?.executionActive).toBe(true);
  });

  it('A31 Given an ordinary view or a second service opens the same DB, Then closing a DB handle is not proof the original app stopped', async () => {
    const f = fixture(); f.old.claimBootOwnership(process.pid); f.old.close();
    const n = f.next(); await expect(n.service.initialize(n.host)).rejects.toThrow(/owner.*live/);
    await expect(n.coordinator.acquireLease({ policy: 'ordinary' })).rejects.toThrow(/owner|blocked/);
  });

  it('A15 Given a pre-crash applied cleanup receipt, Then the restarted read API returns unknown without relying on an in-memory flag', async () => {
    const f = fixture(); f.old.putOperation({ groupId: f.group.groupId, operationId: 'pending-cleanup', command: 'resolve_resource', requestHash: 'hash', applyState: 'applied', result: { state: 'cleanup_pending' } });
    const n = f.next(); await n.service.initialize(n.host);
    const access = n.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    expect(n.service.readOperation({ access, groupId: f.group.groupId, operationId: 'pending-cleanup' })).toMatchObject({ applyState: 'unknown', result: { state: 'unknown' } });
  });

  it('A42 Given only the host checkpoint carries an unknown old owner, Then startup cannot abandon it or open ordinary admission', async () => {
    const f = fixture(); const n = f.next(); const task = await n.host.prepareTask({ prompt: 'host-only', materials: [] });
    const snapshot = (await n.host.inspectTask(task.taskId))!;
    await n.snapshotStore.save({ ...snapshot, multiAgentPreparation: { bootId: 'untracked-boot', groupId: 'untracked-group', rootEpoch: 1, rootTurnId: 'turn', preparationId: 'prepare' } });
    await expect(n.service.initialize(n.host)).rejects.toThrow(/owner.*unknown/);
    expect((await n.host.inspectTask(task.taskId))?.status).toBe('understanding');
    // Public reads share failed startup readiness; the trusted inspection path
    // proves recovery did not remove or abandon the unknown owner's index.
    await expect(n.host.getActiveTasks()).rejects.toThrow(/owner.*unknown/);
    expect(await n.host.inspectActiveTasks()).toContainEqual({ taskId: task.taskId });
    await expect(n.coordinator.acquireLease({ policy: 'ordinary' })).rejects.toThrow(/owner|blocked/);
  });

  it('A42 Given recovery has not completed because host compensation rejects, Then dispose cannot publish a reusable quiesced boot', async () => {
    const f = fixture(); f.old.claimBootOwnership(process.pid); f.old.settleBootOwnership(); const n = f.next();
    const task = await n.host.prepareTask({ prompt: 'old preparation', materials: [] }); const snapshot = (await n.host.inspectTask(task.taskId))!;
    await n.snapshotStore.save({ ...snapshot, multiAgentPreparation: { bootId: 'old-boot', groupId: f.group.groupId, rootEpoch: 1, rootTurnId: 'turn', preparationId: 'prepare' } });
    vi.spyOn(n.host, 'abandonMultiAgentPreparation').mockRejectedValue(new Error('disk unavailable'));
    await expect(n.service.initialize(n.host)).rejects.toThrow('disk unavailable'); await n.service.dispose();
    const third = new DesktopMultiAgentStore(join(f.root, 'groups.sqlite'), { bootId: 'third-boot' }); cleanup.push(() => third.close());
    expect(() => third.claimBootOwnership()).toThrow(/owner.*live/);
  });

  it('A42 Given the journal and checkpoint preparation identities disagree, Then the host checkpoint remains untouched and startup is blocked', async () => {
    const f = fixture(); f.old.claimBootOwnership(process.pid); f.old.settleBootOwnership(); const n = f.next();
    const task = await n.host.prepareTask({ prompt: 'mismatched preparation', materials: [] }); const snapshot = (await n.host.inspectTask(task.taskId))!;
    const marker = { bootId: 'old-boot', groupId: f.group.groupId, rootEpoch: 1, rootTurnId: 'turn', preparationId: 'checkpoint-prepare' };
    await n.snapshotStore.save({ ...snapshot, multiAgentPreparation: marker });
    f.old.putRootBinding({ ...marker, threadId: 'thread', preparationId: 'journal-prepare', sourceTaskId: task.taskId, phase: 'queued', status: 'pending' });
    await expect(n.service.initialize(n.host)).rejects.toThrow(/mismatch/);
    expect((await n.host.inspectTask(task.taskId))?.status).toBe('understanding');
  });
});
