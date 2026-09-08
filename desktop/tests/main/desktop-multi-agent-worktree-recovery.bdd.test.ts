// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { DesktopAgentSnapshot, MultiAgentManagedResource } from '../../shared/multi-agent-types.js';
import type { WorktreeLeaseRecord } from '../../../src/platform/worktrees/manager.js';

type WorktreeCheckpoint = 'running' | 'planned-before-allocation' | 'git-created-before-allocated';
interface FixtureReady {
  ready: true; checkpoint: WorktreeCheckpoint; groupId: string; childId: string; taskId: string; modelRequests: number;
  resource: MultiAgentManagedResource; agent: DesktopAgentSnapshot;
}

describe('BDD: actual worktree runtime process death and boot reconciliation', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  const processClosed = new WeakMap<ChildProcess, Promise<void>>();
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  async function stop(child: ChildProcess) {
    const closed = processClosed.get(child);
    if (!closed) throw new Error('untracked test process');
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    // exitCode/signalCode may be visible before stdio closes. The same promise
    // also makes repeated cleanup wait for close on Windows, not merely kill ACK.
    await closed;
  }
  function git(cwd: string, args: string[]) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  }
  function gitHasWorktree(cwd: string, target: string) {
    const canonical = (value: string) => {
      const path = existsSync(value) ? realpathSync(value) : resolve(value);
      return process.platform === 'win32' ? path.toLowerCase() : path;
    };
    return git(cwd, ['worktree', 'list', '--porcelain']).split('\n')
      .filter(line => line.startsWith('worktree ')).some(line => canonical(line.slice(9)) === canonical(target));
  }
  function repository() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-worktree-process-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const cwd = join(root, 'repo'); mkdirSync(cwd); mkdirSync(join(root, 'data'));
    git(cwd, ['init']); writeFileSync(join(cwd, 'seed.txt'), 'KEEP_TRACKED_BYTES'); git(cwd, ['add', 'seed.txt']);
    git(cwd, ['-c', 'user.name=BDD', '-c', 'user.email=bdd@example.invalid', 'commit', '-m', 'fixture']);
    return { root, cwd };
  }
  async function startFixture(root: string, cleanupPolicy: 'keep' | 'delete', checkpoint: WorktreeCheckpoint = 'running') {
    const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const fixture = fileURLToPath(new URL('../fixtures/multi-agent-worktree-owner.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, root, cleanupPolicy, checkpoint], {
      cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    processClosed.set(child, new Promise<void>(resolve => { child.once('close', () => resolve()); }));
    cleanup.push(() => stop(child));
    let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const ready = await new Promise<FixtureReady>((accept, reject) => {
      let output = '';
      child.once('error', reject); child.once('close', code => reject(new Error(`worktree fixture exited ${code}: ${stderr}`)));
      child.stdout!.on('data', chunk => {
        output += String(chunk);
        const line = output.split('\n').find(item => item.startsWith('{"ready":true,') && item.endsWith('}'));
        if (line) { try { accept(JSON.parse(line)); } catch (error) { reject(error); } }
      });
    });
    expect(ready.checkpoint).toBe(checkpoint);
    return { child, ready };
  }
  function openBoot(root: string, bootId: string) {
    const dataRoot = join(root, 'data');
    const store = new DesktopMultiAgentStore(join(dataRoot, 'groups.sqlite'), { bootId }); cleanup.push(() => store.close());
    const coordinator = new DesktopExecutionCoordinator(); const worktrees = new DesktopMultiAgentWorktrees({ store });
    const createSession = vi.fn(async () => { throw new Error('historical child must not replay'); });
    const service = new DesktopMultiAgentService({ store, coordinator, worktrees, createSession }); cleanup.push(() => service.dispose());
    const runner = vi.fn(async () => {});
    const snapshotStore = new FileTaskSnapshotStore(join(dataRoot, 'tasks'));
    const host = new InProcessTaskRuntimeHost({ snapshotStore,
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(dataRoot, 'materials'), maxBytes: 1024 }), runner });
    return { store, coordinator, service, host, createSession, runner };
  }

  it.each(['clean-delete', 'keep', 'dirty-delete'] as const)('A26 Given a real scoped worktree child (%s), Then live-owner recovery is denied and only physical process death permits reconciliation', async scenario => {
    const { root, cwd } = repository();
    const { child, ready } = await startFixture(root, scenario === 'keep' ? 'keep' : 'delete');
    expect(ready.modelRequests).toBe(1);
    expect(ready.agent).toMatchObject({ executionActive: true, sessionResident: true, status: 'running' });
    expect(ready.resource).toMatchObject({ state: 'allocated', ownerBootId: 'crashed-worktree-owner', cleanupEligibility: 'auto' });
    const path = ready.resource.canonicalPath;
    expect(gitHasWorktree(cwd, path)).toBe(true);
    expect(readFileSync(join(path, 'seed.txt'), 'utf8')).toBe('KEEP_TRACKED_BYTES');
    if (scenario === 'dirty-delete') writeFileSync(join(path, 'user-result.txt'), 'PRESERVE_USER_RESULT');

    const liveAttempt = openBoot(root, 'live-owner-probe');
    await expect(liveAttempt.service.initialize(liveAttempt.host)).rejects.toThrow(/owner.*live/);
    await expect(liveAttempt.coordinator.acquireLease({ policy: 'ordinary' })).rejects.toThrow(/owner|blocked/);
    expect(liveAttempt.store.resources(ready.groupId)[0]).toEqual(ready.resource);
    expect(liveAttempt.store.getAgent(ready.groupId, ready.childId)?.executionActive).toBe(true);
    expect(gitHasWorktree(cwd, path)).toBe(true);
    expect(liveAttempt.runner).not.toHaveBeenCalled(); expect(liveAttempt.createSession).not.toHaveBeenCalled();

    await stop(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    const next = openBoot(root, 'recovered-worktree-owner');
    await next.service.initialize(next.host);
    // The failed service never acquired this boot. Disposing it while the new
    // owner is still live must neither quiesce that owner nor block its lease.
    await liveAttempt.service.dispose();
    const ordinary = await next.coordinator.acquireLease({ policy: 'ordinary' });
    expect(ordinary.released).toBe(false); ordinary.release();
    const third = new DesktopMultiAgentStore(join(root, 'data', 'groups.sqlite'), { bootId: 'after-failed-disposal-probe' });
    cleanup.push(() => third.close());
    expect(() => third.claimBootOwnership()).toThrow(/owner.*live/);
    const access = next.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    expect(next.store.activeGroup('thread')).toBeNull();
    expect(next.service.getSnapshot({ access, groupId: ready.groupId })).toMatchObject({ group: { historicalOnly: true }, hasAgentHistory: true });
    expect(next.store.getAgent(ready.groupId, ready.childId)).toMatchObject({ executionActive: false, sessionResident: false, runtimeResident: false, resumable: false });
    await expect(next.service.userFollowup({ access, requestSource: 'user', groupId: ready.groupId, agentId: ready.childId,
      expectedTurn: 1, operationId: 'resume-dead-owner', message: 'must not replay' })).rejects.toThrow(/historical|read.only/);
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    expect(next.coordinator.snapshot().active).toBe(0);
    if (scenario === 'dirty-delete') {
      expect(next.store.resources(ready.groupId)[0]).toMatchObject({ state: 'cleanup_pending' });
      expect(next.store.getAgent(ready.groupId, ready.childId)).toMatchObject({ cleanupPending: true, resourcesReleased: false });
      expect(next.store.threadHasUnreleasedResources('thread')).toBe(true);
      await expect(next.service.prepareRoot(next.host, 'thread', { prompt: 'blocked by user files', materials: [] })).rejects.toThrow(/cleanup_pending/);
      await expect(next.service.resolveResource({ access, requestSource: 'agent', groupId: ready.groupId,
        resourceId: ready.resource.resourceId, action: 'keep', operationId: 'forged-keep' })).rejects.toThrow(/source/);
      expect(gitHasWorktree(cwd, path)).toBe(true);
      expect(readFileSync(join(path, 'user-result.txt'), 'utf8')).toBe('PRESERVE_USER_RESULT');
      expect((await next.service.resolveResource({ access, requestSource: 'user', groupId: ready.groupId,
        resourceId: ready.resource.resourceId, action: 'keep', operationId: 'user-keep' })).state).toBe('completed');
      expect(next.store.resources(ready.groupId)[0]).toMatchObject({ state: 'retained_by_policy' });
      expect(next.store.threadHasUnreleasedResources('thread')).toBe(false);
      expect(readFileSync(join(path, 'user-result.txt'), 'utf8')).toBe('PRESERVE_USER_RESULT');
    } else {
      const kept = scenario === 'keep';
      expect(next.store.resources(ready.groupId)[0]).toMatchObject({ state: kept ? 'retained_by_policy' : 'released' });
      expect(next.store.threadHasUnreleasedResources('thread')).toBe(false);
      expect(existsSync(path)).toBe(kept); expect(gitHasWorktree(cwd, path)).toBe(kept);
      if (kept) expect(readFileSync(join(path, 'seed.txt'), 'utf8')).toBe('KEEP_TRACKED_BYTES');
    }
    expect(next.store.getAgent(ready.groupId, ready.childId)).toMatchObject({ resourcesReleased: true, cleanupPending: false, resumable: false });
    console.info('[worktree-process-recovery]', JSON.stringify({ scenario, ownerPid: child.pid, signal: child.signalCode, exitCode: child.exitCode,
      resources: next.store.resources(ready.groupId).map(resource => ({ state: resource.state, cleanupPolicy: resource.cleanupPolicy })),
      newSessionCalls: next.createSession.mock.calls.length, modelReplays: next.runner.mock.calls.length }));
  });

  it.each([
    ['planned-before-allocation', 'clean-delete'],
    ['git-created-before-allocated', 'clean-delete'],
    ['git-created-before-allocated', 'keep'],
    ['git-created-before-allocated', 'dirty-delete'],
    ['git-created-before-allocated', 'foreign-owner'],
    ['git-created-before-allocated', 'foreign-token'],
  ] as const)('A26 Given a real %s crash window (%s), Then startup reconciles disk evidence without replaying allocation', async (checkpoint, scenario) => {
    const { root, cwd } = repository();
    const { child, ready } = await startFixture(root, scenario === 'keep' ? 'keep' : 'delete', checkpoint);
    const path = ready.resource.canonicalPath;
    const allocatedOnDisk = checkpoint === 'git-created-before-allocated';
    expect(ready.modelRequests).toBe(0);
    expect(ready.resource).toMatchObject({ state: 'planned', ownerBootId: 'crashed-worktree-owner', cleanupEligibility: 'auto' });
    expect(existsSync(path)).toBe(allocatedOnDisk);
    expect(gitHasWorktree(cwd, path)).toBe(allocatedOnDisk);
    if (allocatedOnDisk) expect(readFileSync(join(path, 'seed.txt'), 'utf8')).toBe('KEEP_TRACKED_BYTES');
    if (scenario === 'dirty-delete') writeFileSync(join(path, 'user-result.txt'), 'PRESERVE_USER_RESULT');

    const liveAttempt = openBoot(root, 'live-allocation-window-probe');
    expect(liveAttempt.store.resources(ready.groupId)[0]).toEqual(ready.resource);
    await expect(liveAttempt.service.initialize(liveAttempt.host)).rejects.toThrow(/owner.*live/);
    expect(liveAttempt.store.resources(ready.groupId)[0]).toEqual(ready.resource);
    expect(existsSync(path)).toBe(allocatedOnDisk); expect(gitHasWorktree(cwd, path)).toBe(allocatedOnDisk);
    await stop(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);

    if (scenario === 'foreign-owner' || scenario === 'foreign-token') {
      // Corrupt only the external allocator's claimed identity after its owner
      // died. Do not mutate the production SQLite journal or reimplement release.
      const registryPath = join(cwd, '.xiaok-desktop-worktrees', '.xiaok-worktree-registry');
      const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { schemaVersion: number; leases: WorktreeLeaseRecord[] };
      const lease = registry.leases.find(item => item.taskId === ready.childId)!;
      expect(lease).toBeDefined();
      if (scenario === 'foreign-owner') lease.owner = 'desktop:foreign-boot:foreign-group:foreign-token';
      else lease.branch = '00000000-0000-4000-8000-000000000001';
      writeFileSync(registryPath, JSON.stringify(registry));
    }

    const next = openBoot(root, 'recovered-allocation-window-owner');
    await next.service.initialize(next.host);
    expect(next.store.activeGroup('thread')).toBeNull();
    expect(next.store.requireGroup(ready.groupId).historicalOnly).toBe(true);
    expect(next.store.getAgent(ready.groupId, ready.childId)).toMatchObject({ executionActive: false, sessionResident: false, runtimeResident: false, resumable: false });
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    expect(next.coordinator.snapshot().active).toBe(0);
    const retainedPending = ['dirty-delete', 'foreign-owner', 'foreign-token'].includes(scenario);
    const resource = next.store.resources(ready.groupId)[0];
    expect(resource).toMatchObject({ state: retainedPending ? 'cleanup_pending' : scenario === 'keep' ? 'retained_by_policy' : 'released' });
    expect(next.store.threadHasUnreleasedResources('thread')).toBe(retainedPending);
    expect(next.store.getAgent(ready.groupId, ready.childId)).toMatchObject({ resourcesReleased: !retainedPending, cleanupPending: retainedPending });
    expect(existsSync(path)).toBe(retainedPending || scenario === 'keep');
    expect(gitHasWorktree(cwd, path)).toBe(retainedPending || scenario === 'keep');
    if (retainedPending || scenario === 'keep') expect(readFileSync(join(path, 'seed.txt'), 'utf8')).toBe('KEEP_TRACKED_BYTES');
    if (scenario === 'foreign-owner' || scenario === 'foreign-token') expect(resource.lastError).toMatch(/owner\/token mismatch/);
    if (scenario === 'dirty-delete') expect(readFileSync(join(path, 'user-result.txt'), 'utf8')).toBe('PRESERVE_USER_RESULT');
    const access = next.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    await expect(next.service.userFollowup({ access, requestSource: 'user', groupId: ready.groupId, agentId: ready.childId,
      expectedTurn: ready.agent.turn, operationId: 'no-crash-window-replay', message: 'must not start' })).rejects.toThrow(/historical|read.only/);
    if (retainedPending) {
      await expect(next.service.prepareRoot(next.host, 'thread', { prompt: 'must remain blocked', materials: [] })).rejects.toThrow(/cleanup_pending/);
      await expect(next.service.resolveResource({ access, requestSource: 'agent', groupId: ready.groupId, resourceId: resource.resourceId,
        action: 'keep', operationId: 'no-agent-keep' })).rejects.toThrow(/source/);
    }
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    console.info('[worktree-allocation-crash]', JSON.stringify({ checkpoint, scenario, ownerPid: child.pid,
      signal: child.signalCode, exitCode: child.exitCode, allocatedOnDisk, beforeState: ready.resource.state, afterState: resource.state,
      newSessionCalls: next.createSession.mock.calls.length, modelReplays: next.runner.mock.calls.length }));
  });
});
