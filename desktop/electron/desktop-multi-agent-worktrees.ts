import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createWorktreeManager, type WorktreeLeaseRecord } from '../../src/platform/worktrees/manager.js';
import type { MultiAgentManagedResource } from '../shared/multi-agent-types.js';
import { DesktopMultiAgentStore, truncateMultiAgentText } from './desktop-multi-agent-store.js';

const execFileAsync = promisify(execFile);
const DIRECTORY = '.xiaok-desktop-worktrees';
class PersistedWorktreeCleanupError extends Error {
  constructor(error: unknown) { super(error instanceof Error ? error.message : String(error), { cause: error }); }
}
export class DesktopWorktreeJournalError extends Error {
  constructor(error: unknown) { super(error instanceof Error ? error.message : String(error), { cause: error }); }
}
export interface DesktopWorktreeAllocation {
  resourceId: string; cwd: string; release(): Promise<void>;
  /** Called only after the owning managed execution has really settled. */
  releaseSessionResources(): Promise<void>;
}

/** Journal owner around the existing allocator. No model/IPC-provided paths. */
export class DesktopMultiAgentWorktrees {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly allocating = new Set<string>();
  private readonly releasing = new Set<string>();
  constructor(private readonly options: { store: DesktopMultiAgentStore }) {}

  isIdle(): boolean { return !this.pending.size && !this.allocating.size && !this.releasing.size; }

  async allocate(input: { groupId: string; agentId: string; cwd: string; cleanupPolicy: 'keep' | 'delete'; signal: AbortSignal }): Promise<DesktopWorktreeAllocation> {
    input.signal.throwIfAborted();
    if (!this.options.store.getAgent(input.groupId, input.agentId)) throw new Error('unknown worktree agent');
    const repositoryRoot = realpathSync((await this.git(input.cwd, ['rev-parse', '--show-toplevel'])).trim());
    const allocationToken = randomUUID();
    const record: MultiAgentManagedResource = { resourceId: randomUUID(), groupId: input.groupId, agentId: input.agentId,
      ownerBootId: this.options.store.bootId, kind: 'worktree', repositoryRoot,
      canonicalPath: join(repositoryRoot, DIRECTORY, allocationToken), allocationToken,
      cleanupPolicy: input.cleanupPolicy, cleanupEligibility: 'auto', state: 'planned' };
    input.signal.throwIfAborted();
    // Durable intent precedes allocator lock files, branches and directories.
    this.put(record);
    this.allocating.add(record.resourceId);
    const release = () => this.serial(record.resourceId, () => this.release(record.groupId, record.resourceId));
    const allocation: DesktopWorktreeAllocation = { resourceId: record.resourceId, cwd: record.canonicalPath, release,
      releaseSessionResources: async () => {
        try { await release(); }
        catch (error) {
          // A durable disk obligation is not a still-running session. A failed
          // journal write is NOT such a transfer: propagate and retain ownership.
          if (!(error instanceof PersistedWorktreeCleanupError)) throw error;
        }
      } };
    try {
      const created = await this.manager(record).allocate({ owner: this.owner(record), taskId: record.agentId,
        branch: allocationToken, cleanup: record.cleanupPolicy });
      if (!samePath(created.path, record.canonicalPath)) throw new Error('worktree allocation path mismatch');
      this.put({ ...this.get(record.groupId, record.resourceId), state: 'allocated' });
      this.allocating.delete(record.resourceId);
      if (input.signal.aborted) { await allocation.release(); input.signal.throwIfAborted(); }
      return allocation;
    } catch (error) {
      const latest = this.get(record.groupId, record.resourceId);
      if (!['released', 'retained_by_policy', 'cleanup_pending'].includes(latest.state)) this.putFailure(latest, error, 'unknown');
      throw error;
    } finally { this.allocating.delete(record.resourceId); }
  }

  beforeOpaqueInvocation(groupId: string, agentId: string, cwd?: string): void {
    this.options.store.transaction(() => {
      for (const resource of this.options.store.resources(groupId)) if ((resource.agentId === agentId || cwd && within(resource.canonicalPath, cwd))
        && !['released', 'retained_by_policy'].includes(resource.state)) {
        if (this.releasing.has(resource.resourceId) || this.allocating.has(resource.resourceId) || resource.state !== 'allocated') throw new Error('worktree_cleanup_in_progress');
        if (resource.cleanupEligibility !== 'manual') this.put({ ...resource, cleanupEligibility: 'manual' }, true);
      }
    });
  }

  async resolve(input: { requestSource: 'user' | 'agent' | 'scheduler'; groupId: string; resourceId: string; action: 'keep' | 'retryCleanup' }): Promise<void> {
    if (input.requestSource !== 'user') throw new Error('worktree resolution source is not permitted');
    if (this.allocating.has(input.resourceId)) throw new Error('worktree_is_allocating');
    if (this.pending.has(input.resourceId) || this.releasing.has(input.resourceId)) throw new Error('worktree_cleanup_in_progress');
    return this.serial(input.resourceId, () => this.resolveSerial(input));
  }

  private async resolveSerial(input: { groupId: string; resourceId: string; action: 'keep' | 'retryCleanup' }): Promise<void> {
    const record = this.get(input.groupId, input.resourceId);
    if (record.state === 'released' && input.action === 'keep') throw new Error('worktree_already_released');
    if (this.allocating.has(input.resourceId)) throw new Error('worktree_is_allocating');
    const agent = this.options.store.getAgent(input.groupId, record.agentId);
    if (!agent || agent.executionActive || this.hasLiveDescendant(record)) throw new Error('worktree still has a live execution');
    if (input.action === 'keep') {
      this.put({ ...record, state: 'retained_by_policy', cleanupPolicy: 'keep', lastError: undefined }, true);
      return;
    }
    if (input.action !== 'retryCleanup') throw new Error('invalid worktree resolution');
    if (agent.sessionResident && agent.status !== 'closed') throw new Error('worktree still has a live resumable session');
    await this.release(input.groupId, input.resourceId);
  }

  private serial(resourceId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(resourceId);
    const operation = (previous ?? Promise.resolve()).catch(() => {}).then(action);
    this.pending.set(resourceId, operation);
    void operation.finally(() => { if (this.pending.get(resourceId) === operation) this.pending.delete(resourceId); }).catch(() => {});
    return operation;
  }

  /** Startup only, after the application owner has verified the old boot exited. */
  async reconcile(groupId: string): Promise<void> {
    for (const record of this.options.store.resources(groupId)) {
      if (record.ownerBootId === this.options.store.bootId || ['released', 'retained_by_policy'].includes(record.state)) continue;
      this.options.store.assertResourceOwnerSettled(record.ownerBootId);
      try { await this.serial(record.resourceId, () => this.release(groupId, record.resourceId)); }
      catch (error) { if (!(error instanceof PersistedWorktreeCleanupError)) throw error; }
    }
  }

  private async release(groupId: string, resourceId: string): Promise<void> {
    const record = this.get(groupId, resourceId);
    if (['released', 'retained_by_policy'].includes(record.state)) return;
    this.releasing.add(resourceId);
    try {
      if (this.allocating.has(resourceId)) throw new Error('worktree_is_allocating');
      if (this.hasLiveDescendant(record)) throw new Error('worktree still has a live descendant execution');
      this.validateRecordPath(record);
      if (record.cleanupPolicy === 'keep') {
        // Keep relinquishes managed execution ownership, not a claim that an
        // opaque external process has exited. Never deletes user output.
        this.put({ ...record, state: 'retained_by_policy', lastError: undefined }, true);
        return;
      }
      if (record.cleanupEligibility === 'manual') throw new Error('worktree_requires_manual_keep');
      const registered = await this.git(record.repositoryRoot!, ['worktree', 'list', '--porcelain']);
      const paths = registered.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
      if (!existsSync(record.canonicalPath) && !paths.some(path => samePath(path, record.canonicalPath))) {
        this.put({ ...record, state: 'released', lastError: undefined }, true); return;
      }
      this.validateAllocatorOwnership(record);
      this.put({ ...record, state: 'cleanup_pending' }, true);
      // Existing manager verifies actual Git registration/branch, allocator
      // identity and non-symlink realpath. Its non-force remove refuses dirt.
      await this.manager(record).release(record.canonicalPath);
      if (existsSync(record.canonicalPath)) throw new Error('worktree deletion did not release directory');
      this.put({ ...record, state: 'released', lastError: undefined }, true);
    } catch (error) {
      this.putFailure(record, error, 'cleanup_pending');
      // Issued only after THIS attempt's error was committed. An older error
      // row cannot make a new SQLITE_FULL failure look like a safe transfer.
      throw new PersistedWorktreeCleanupError(error);
    } finally { this.releasing.delete(resourceId); }
  }

  private hasLiveDescendant(record: MultiAgentManagedResource): boolean {
    const agents = this.options.store.allAgents(record.groupId); const byId = new Map(agents.map(agent => [agent.id, agent]));
    return agents.some(agent => {
      if (agent.id === record.agentId || !(agent.executionActive || agent.sessionResident || agent.runtimeResident
        || agent.turn > 0 && ['prepared', 'activating'].includes(agent.activationState))) return false;
      let parentId = agent.parentId; const seen = new Set<string>();
      while (parentId && !seen.has(parentId)) {
        if (parentId === record.agentId) return true;
        seen.add(parentId); parentId = byId.get(parentId)?.parentId ?? null;
      }
      return false;
    });
  }

  private put(resource: MultiAgentManagedResource, control = false): void {
    try { this.options.store.putResource(resource, control); }
    catch (error) { throw new DesktopWorktreeJournalError(error); }
  }

  private get(groupId: string, resourceId: string): MultiAgentManagedResource {
    const resource = this.options.store.resources(groupId).find(item => item.resourceId === resourceId);
    if (!resource) throw new Error('unknown managed resource'); return resource;
  }
  private owner(record: MultiAgentManagedResource): string { return `desktop:${record.ownerBootId}:${record.groupId}:${record.allocationToken}`; }
  private validateRecordPath(record: MultiAgentManagedResource): void {
    if (!record.repositoryRoot || !isAbsolute(record.repositoryRoot) || !/^[a-f0-9-]{36}$/.test(record.allocationToken)) throw new Error('invalid worktree owner token or repository path');
    const expected = join(record.repositoryRoot, DIRECTORY, record.allocationToken);
    if (resolve(record.canonicalPath) !== resolve(expected)) throw new Error('worktree token/path mismatch');
    const boundary = join(record.repositoryRoot, DIRECTORY);
    if (existsSync(boundary) && lstatSync(boundary).isSymbolicLink()) throw new Error('unsafe worktree boundary symlink');
    if (existsSync(expected)) {
      if (lstatSync(expected).isSymbolicLink()) throw new Error('unsafe worktree symlink');
      const rel = relative(realpathSync(record.repositoryRoot), realpathSync(expected));
      if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('unsafe worktree realpath');
    }
  }
  private validateAllocatorOwnership(record: MultiAgentManagedResource): void {
    const registryPath = join(record.repositoryRoot!, DIRECTORY, '.xiaok-worktree-registry');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { schemaVersion?: number; leases?: WorktreeLeaseRecord[] };
    const lease = registry.schemaVersion === 1 && registry.leases?.find(item => samePath(item.path, record.canonicalPath));
    if (!lease || lease.branch !== record.allocationToken || lease.owner !== this.owner(record) || lease.taskId !== record.agentId
      || lease.cleanup !== record.cleanupPolicy) throw new Error('worktree allocator owner/token mismatch');
  }
  private manager(record: MultiAgentManagedResource) {
    this.validateRecordPath(record);
    return createWorktreeManager({ repoRoot: record.repositoryRoot!, worktreesDir: join(record.repositoryRoot!, DIRECTORY),
      execGit: args => this.git(record.repositoryRoot!, args) });
  }
  private async git(cwd: string, args: string[]): Promise<string> {
    // Every subprocess is bounded; no shell interpolation or force remove.
    return (await execFileAsync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout;
  }
  private putFailure(record: MultiAgentManagedResource, error: unknown, state: 'unknown' | 'cleanup_pending'): void {
    this.put({ ...record, state, lastError: truncateMultiAgentText(error instanceof Error ? error.message : String(error), 512).text }, true);
  }
}

function samePath(left: string, right: string): boolean {
  const canonical = (path: string) => { let value = resolve(path); try { value = realpathSync(path); } catch { /* Missing paths still compare lexically. */ }
    return process.platform === 'win32' ? value.toLowerCase() : value; };
  return canonical(left) === canonical(right);
}
function within(root: string, candidate: string): boolean {
  // A cwd is an existing main-bound directory. Do not silently treat an
  // unresolvable alias as unrelated and permit an opaque side effect.
  const canonical = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const path = relative(canonical(existsSync(root) ? realpathSync(root) : resolve(root)), canonical(realpathSync(candidate)));
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}
