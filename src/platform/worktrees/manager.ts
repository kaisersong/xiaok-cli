import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';

export type WorktreeCleanupPolicy = 'keep' | 'delete';
export type WorktreeLeaseState = 'allocating' | 'active' | 'released' | 'orphaned';
export type PathUsage = 'used' | 'free' | 'unknown';

export interface ProcessIdentity {
  pid: number;
  startedAt: string | null;
  cwd: string;
}

export interface ProcessInspection {
  status: 'same' | 'missing' | 'mismatch' | 'unknown';
  startedAt?: string | null;
  cwd?: string;
}

export interface WorktreeAllocationRecord {
  branch: string;
  path: string;
  owner: string;
  taskId: string;
  cleanup: WorktreeCleanupPolicy;
  created: boolean;
}

export interface WorktreeLeaseRecord {
  branch: string;
  path: string;
  owner: string;
  taskId: string;
  cleanup: WorktreeCleanupPolicy;
  state: WorktreeLeaseState;
  allocator: ProcessIdentity;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

interface WorktreeRegistryDocument {
  schemaVersion: 1;
  leases: WorktreeLeaseRecord[];
}

interface GitWorktreeRecord {
  path: string;
  branch?: string;
}

interface LockOwner extends ProcessIdentity {
  token: string;
  acquiredAt: number;
}

export interface AllocateWorktreeInput {
  owner: string;
  taskId: string;
  branch: string;
  cleanup?: WorktreeCleanupPolicy;
}

export interface WorktreeManagerOptions {
  repoRoot: string;
  worktreesDir: string;
  execGit(args: string[]): Promise<string>;
  getCurrentProcessIdentity?(): Promise<ProcessIdentity>;
  inspectProcess?(identity: ProcessIdentity): Promise<ProcessInspection>;
  inspectPathUsage?(path: string): Promise<PathUsage>;
  now?(): number;
  registryPath?: string;
}

export interface WorktreeReconcileResult {
  changed: string[];
  skipped: Array<{ branch: string; reason: string }>;
}

export interface WorktreeGcResult {
  dryRun: boolean;
  candidates: string[];
  removed: string[];
  skipped: Array<{ branch: string; reason: string }>;
}

export interface WorktreeManager {
  allocate(input: AllocateWorktreeInput): Promise<WorktreeAllocationRecord>;
  release(path: string): Promise<void>;
  reconcile(): Promise<WorktreeReconcileResult>;
  gc(options?: { dryRun?: boolean }): Promise<WorktreeGcResult>;
  validatePath(path: string): string;
}

const REGISTRY_SCHEMA_VERSION = 1;
const LOCK_REF = 'refs/xiaok/worktree-registry-lock';

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
  const normalizedRoot = resolve(options.repoRoot);
  const normalizedWorktreesDir = resolve(options.worktreesDir);
  const registryPath = resolve(
    options.registryPath
      ?? join(normalizedWorktreesDir, '.xiaok-worktree-registry'),
  );
  if (
    !isWithinBoundary(normalizedRoot, registryPath)
    || !isWithinBoundary(normalizedWorktreesDir, registryPath)
  ) {
    throw new Error(`worktree registry is outside configured boundary: ${registryPath}`);
  }
  const now = options.now ?? Date.now;
  const getCurrentProcessIdentity = options.getCurrentProcessIdentity
    ?? defaultCurrentProcessIdentity;
  const inspectProcess = options.inspectProcess ?? defaultInspectProcess;
  const inspectPathUsage = options.inspectPathUsage ?? defaultInspectPathUsage;

  const manager: WorktreeManager = {
    async allocate(input) {
      return withRegistryLock(async (identity) => {
        let registry = loadRegistry(registryPath, normalizedRoot, normalizedWorktreesDir);
        const gitWorktrees = await listGitWorktrees(options.execGit);
        const reconciliation = await reconcileRegistry(
          registry,
          gitWorktrees,
          inspectProcess,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        registry = reconciliation.registry;
        if (reconciliation.changed.length > 0) {
          saveRegistry(registryPath, registry);
        }

        const existing = registry.leases.find((lease) => lease.branch === input.branch);
        if (existing) {
          const registration = gitWorktrees.find((entry) =>
            entry.path === existing.path && entry.branch === existing.branch
          );
          if (existing.state === 'active' && registration) {
            if (
              sameIdentity(existing.allocator, identity)
              && existing.owner === input.owner
              && existing.taskId === input.taskId
            ) {
              return toAllocation(existing, false);
            }
            throw new Error(`branch_in_use: ${input.branch}`);
          }
          throw new Error(`worktree lease requires recovery before allocation: ${input.branch}`);
        }

        const unowned = gitWorktrees.find((entry) => entry.branch === input.branch);
        if (unowned) {
          throw new Error(
            `branch_checked_out_unowned: ${input.branch} at ${unowned.path}`,
          );
        }

        const worktreePath = manager.validatePath(
          join(normalizedWorktreesDir, input.branch),
        );
        const branchExists = await gitBranchExists(options.execGit, input.branch);
        const timestamp = now();
        const lease: WorktreeLeaseRecord = {
          branch: input.branch,
          path: worktreePath,
          owner: input.owner,
          taskId: input.taskId,
          cleanup: input.cleanup ?? 'keep',
          state: 'allocating',
          allocator: identity,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        registry.leases.push(lease);
        saveRegistry(registryPath, registry);

        try {
          await options.execGit(
            branchExists
              ? ['worktree', 'add', worktreePath, input.branch]
              : ['worktree', 'add', worktreePath, '-b', input.branch],
          );
          lease.state = 'active';
          lease.updatedAt = now();
          delete lease.lastError;
          saveRegistry(registryPath, registry);
          return toAllocation(lease, true);
        } catch (error) {
          lease.lastError = errorMessage(error);
          lease.updatedAt = now();
          saveRegistry(registryPath, registry);
          throw error;
        }
      });
    },

    async release(path) {
      const normalizedPath = manager.validatePath(path);
      await withRegistryLock(async (identity) => {
        const registry = loadRegistry(
          registryPath,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        const lease = registry.leases.find((entry) => entry.path === normalizedPath);
        if (!lease) {
          return;
        }

        if (!sameIdentity(lease.allocator, identity)) {
          const inspection = await inspectProcess(lease.allocator);
          if (!isConfirmedInactive(inspection)) {
            throw new Error(`release_forbidden_active_allocator: ${lease.branch}`);
          }
        }
        lease.state = 'released';
        lease.updatedAt = now();
        saveRegistry(registryPath, registry);
        if (lease.cleanup === 'keep') {
          return;
        }

        try {
          const registration = (await listGitWorktrees(options.execGit))
            .find((entry) => entry.path === lease.path && entry.branch === lease.branch);
          if (!registration) {
            throw new Error(`git_registration_mismatch: ${lease.branch}`);
          }
          if (!validateExistingPath(lease.path, normalizedRoot, normalizedWorktreesDir)) {
            throw new Error(`unsafe worktree path: ${lease.path}`);
          }
          await options.execGit(['worktree', 'remove', normalizedPath]);
          registry.leases = registry.leases.filter((entry) => entry !== lease);
          saveRegistry(registryPath, registry);
        } catch (error) {
          lease.lastError = errorMessage(error);
          lease.updatedAt = now();
          saveRegistry(registryPath, registry);
          throw error;
        }
      });
    },

    async reconcile() {
      return withRegistryLock(async () => {
        const registry = loadRegistry(
          registryPath,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        const gitWorktrees = await listGitWorktrees(options.execGit);
        const result = await reconcileRegistry(
          registry,
          gitWorktrees,
          inspectProcess,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        if (result.changed.length > 0) {
          saveRegistry(registryPath, result.registry);
        }
        return {
          changed: result.changed,
          skipped: result.skipped,
        };
      });
    },

    async gc(gcOptions = {}) {
      const dryRun = gcOptions.dryRun ?? true;
      return withRegistryLock(async (identity) => {
        let registry = loadRegistry(
          registryPath,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        const gitWorktrees = await listGitWorktrees(options.execGit);
        const reconciliation = await reconcileRegistry(
          registry,
          gitWorktrees,
          inspectProcess,
          normalizedRoot,
          normalizedWorktreesDir,
        );
        registry = reconciliation.registry;
        const result: WorktreeGcResult = {
          dryRun,
          candidates: [],
          removed: [],
          skipped: [...reconciliation.skipped],
        };

        for (const lease of [...registry.leases]) {
          if (lease.cleanup !== 'delete') {
            result.skipped.push({ branch: lease.branch, reason: 'cleanup_keep' });
            continue;
          }

          const registration = gitWorktrees.find((entry) =>
            entry.path === lease.path && entry.branch === lease.branch
          );
          const inactive = await isInactive(lease.allocator, inspectProcess);
          if (!registration && !existsSync(lease.path) && inactive) {
            result.candidates.push(lease.branch);
            if (!dryRun) {
              registry.leases = registry.leases.filter((entry) => entry !== lease);
              result.removed.push(lease.branch);
            }
            continue;
          }

          if (!['released', 'orphaned'].includes(lease.state)) {
            result.skipped.push({ branch: lease.branch, reason: 'state_not_reclaimable' });
            continue;
          }
          if (!registration) {
            result.skipped.push({ branch: lease.branch, reason: 'registration_missing' });
            continue;
          }
          if (!inactive && !(lease.state === 'released' && sameIdentity(lease.allocator, identity))) {
            result.skipped.push({ branch: lease.branch, reason: 'allocator_active_or_unknown' });
            continue;
          }
          if (!validateExistingPath(lease.path, normalizedRoot, normalizedWorktreesDir)) {
            result.skipped.push({ branch: lease.branch, reason: 'path_unsafe' });
            continue;
          }
          const usage = await inspectPathUsage(lease.path);
          if (usage !== 'free') {
            result.skipped.push({ branch: lease.branch, reason: `path_${usage}` });
            continue;
          }

          result.candidates.push(lease.branch);
          if (!dryRun) {
            try {
              await options.execGit(['worktree', 'remove', lease.path]);
              registry.leases = registry.leases.filter((entry) => entry !== lease);
              result.removed.push(lease.branch);
            } catch (error) {
              lease.lastError = errorMessage(error);
              result.skipped.push({ branch: lease.branch, reason: 'remove_failed' });
            }
          }
        }

        if (!dryRun) {
          saveRegistry(registryPath, registry);
        }
        return result;
      });
    },

    validatePath(path) {
      const normalizedPath = resolve(path);
      if (
        !isWithinBoundary(normalizedRoot, normalizedPath)
        || !isWithinBoundary(normalizedWorktreesDir, normalizedPath)
      ) {
        throw new Error(`worktree path is outside configured worktree boundary: ${path}`);
      }
      return normalizedPath;
    },
  };

  async function withRegistryLock<T>(
    operation: (identity: ProcessIdentity) => Promise<T>,
  ): Promise<T> {
    mkdirSync(normalizedWorktreesDir, { recursive: true });
    const identity = await getCurrentProcessIdentity();
    const owner: LockOwner = {
      ...identity,
      token: randomUUID(),
      acquiredAt: now(),
    };
    const ownerPath = join(
      normalizedWorktreesDir,
      `.xiaok-worktree-lock-owner-${owner.token}`,
    );
    writeFileAtomicallySync(ownerPath, JSON.stringify(owner));
    let ownerOid = '';
    try {
      ownerOid = (await options.execGit(['hash-object', '-w', ownerPath])).trim();
      if (!ownerOid) {
        throw new Error('worktree lock owner OID is empty');
      }
      await acquireLock(ownerOid);
      try {
        return await operation(identity);
      } finally {
        await options.execGit(['update-ref', '-d', LOCK_REF, ownerOid]);
      }
    } finally {
      try {
        unlinkSync(ownerPath);
      } catch {}
    }
  }

  async function acquireLock(ownerOid: string): Promise<void> {
    const zeroOid = '0'.repeat(ownerOid.length);
    try {
      await options.execGit(['update-ref', LOCK_REF, ownerOid, zeroOid]);
      return;
    } catch (firstError) {
      let observedOid: string;
      let owner: LockOwner;
      try {
        observedOid = (await options.execGit(['rev-parse', LOCK_REF])).trim();
        owner = parseLockOwner(await options.execGit(['cat-file', '-p', observedOid]));
      } catch {
        throw new Error(`worktree lock is occupied and cannot be inspected: ${LOCK_REF}`, {
          cause: firstError,
        });
      }
      const inspection = await inspectProcess(owner);
      if (!isConfirmedInactive(inspection)) {
        throw new Error(`worktree lock is occupied: ${LOCK_REF}`);
      }
      await options.execGit(['update-ref', '-d', LOCK_REF, observedOid]);
      await options.execGit(['update-ref', LOCK_REF, ownerOid, zeroOid]);
    }
  }

  return manager;
}

function loadRegistry(
  registryPath: string,
  repoRoot: string,
  worktreesDir: string,
): WorktreeRegistryDocument {
  if (!existsSync(registryPath)) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, leases: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as WorktreeRegistryDocument;
    if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.leases)) {
      throw new Error('unsupported schema');
    }
    const branches = new Set<string>();
    const paths = new Set<string>();
    for (const lease of parsed.leases) {
      if (!isValidLease(lease)) {
        throw new Error('invalid lease');
      }
      if (
        !isWithinBoundary(repoRoot, lease.path)
        || !isWithinBoundary(worktreesDir, lease.path)
        || branches.has(lease.branch)
        || paths.has(lease.path)
      ) {
        throw new Error('unsafe or duplicate lease');
      }
      branches.add(lease.branch);
      paths.add(lease.path);
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `worktree registry is invalid: ${registryPath}; quarantine it manually after verifying active worktrees`,
      { cause: error },
    );
  }
}

function saveRegistry(path: string, registry: WorktreeRegistryDocument): void {
  writeFileAtomicallySync(path, JSON.stringify(registry, null, 2));
}

async function reconcileRegistry(
  registry: WorktreeRegistryDocument,
  gitWorktrees: GitWorktreeRecord[],
  inspectProcess: (identity: ProcessIdentity) => Promise<ProcessInspection>,
  repoRoot: string,
  worktreesDir: string,
): Promise<{
  registry: WorktreeRegistryDocument;
  changed: string[];
  skipped: Array<{ branch: string; reason: string }>;
}> {
  const changed: string[] = [];
  const skipped: Array<{ branch: string; reason: string }> = [];

  for (const lease of [...registry.leases]) {
    const registrationByPath = gitWorktrees.find((entry) => entry.path === lease.path);
    const registrationByBranch = gitWorktrees.find((entry) => entry.branch === lease.branch);
    if (
      (registrationByPath && registrationByPath.branch !== lease.branch)
      || (registrationByBranch && registrationByBranch.path !== lease.path)
    ) {
      throw new Error(`git_registration_mismatch: ${lease.branch}`);
    }
    if (existsSync(lease.path) && !validateExistingPath(lease.path, repoRoot, worktreesDir)) {
      throw new Error(`unsafe worktree path: ${lease.path}`);
    }

    const inspection = await inspectProcess(lease.allocator);
    const inactive = isConfirmedInactive(inspection);
    if (registrationByPath) {
      if (inactive) {
        if (lease.state !== 'orphaned') {
          lease.state = 'orphaned';
          changed.push(lease.branch);
        }
      } else if (lease.state === 'allocating') {
        lease.state = 'active';
        changed.push(lease.branch);
      }
      continue;
    }

    if (!existsSync(lease.path) && inactive) {
      registry.leases = registry.leases.filter((entry) => entry !== lease);
      changed.push(lease.branch);
      continue;
    }
    skipped.push({
      branch: lease.branch,
      reason: existsSync(lease.path)
        ? 'unregistered_path_present'
        : 'allocator_unknown',
    });
  }

  return { registry, changed, skipped };
}

async function listGitWorktrees(
  execGit: (args: string[]) => Promise<string>,
): Promise<GitWorktreeRecord[]> {
  const output = await execGit(['worktree', 'list', '--porcelain']);
  const records: GitWorktreeRecord[] = [];
  let current: GitWorktreeRecord | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: resolve(line.slice('worktree '.length)) };
      records.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return records;
}

async function gitBranchExists(
  execGit: (args: string[]) => Promise<string>,
  branch: string,
): Promise<boolean> {
  try {
    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function validateExistingPath(path: string, repoRoot: string, worktreesDir: string): boolean {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return false;
    }
    const realPath = realpathSync(path);
    const realRepoRoot = realpathSync(repoRoot);
    const realWorktreesDir = realpathSync(worktreesDir);
    return isWithinBoundary(realRepoRoot, realPath)
      && isWithinBoundary(realWorktreesDir, realPath);
  } catch {
    return false;
  }
}

function isWithinBoundary(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function toAllocation(
  lease: WorktreeLeaseRecord,
  created: boolean,
): WorktreeAllocationRecord {
  return {
    branch: lease.branch,
    path: lease.path,
    owner: lease.owner,
    taskId: lease.taskId,
    cleanup: lease.cleanup,
    created,
  };
}

function isValidLease(value: unknown): value is WorktreeLeaseRecord {
  const lease = value as Partial<WorktreeLeaseRecord>;
  return Boolean(
    lease
    && typeof lease.branch === 'string'
    && typeof lease.path === 'string'
    && typeof lease.owner === 'string'
    && typeof lease.taskId === 'string'
    && ['keep', 'delete'].includes(lease.cleanup ?? '')
    && ['allocating', 'active', 'released', 'orphaned'].includes(lease.state ?? '')
    && lease.allocator
    && Number.isInteger(lease.allocator.pid)
    && (typeof lease.allocator.startedAt === 'string' || lease.allocator.startedAt === null)
    && typeof lease.allocator.cwd === 'string'
  );
}

function parseLockOwner(raw: string): LockOwner {
  const parsed = JSON.parse(raw) as Partial<LockOwner>;
  if (
    typeof parsed.token !== 'string'
    || typeof parsed.pid !== 'number'
    || (typeof parsed.startedAt !== 'string' && parsed.startedAt !== null)
    || typeof parsed.cwd !== 'string'
    || typeof parsed.acquiredAt !== 'number'
  ) {
    throw new Error('invalid lock owner');
  }
  return parsed as LockOwner;
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid
    && left.startedAt !== null
    && right.startedAt !== null
    && left.startedAt === right.startedAt;
}

async function isInactive(
  identity: ProcessIdentity,
  inspectProcess: (identity: ProcessIdentity) => Promise<ProcessInspection>,
): Promise<boolean> {
  return isConfirmedInactive(await inspectProcess(identity));
}

function isConfirmedInactive(inspection: ProcessInspection): boolean {
  return inspection.status === 'missing' || inspection.status === 'mismatch';
}

async function defaultCurrentProcessIdentity(): Promise<ProcessIdentity> {
  return {
    pid: process.pid,
    startedAt: readProcessStartToken(process.pid),
    cwd: process.cwd(),
  };
}

async function defaultInspectProcess(
  identity: ProcessIdentity,
): Promise<ProcessInspection> {
  if (!identity.startedAt) {
    return { status: 'unknown' };
  }
  try {
    process.kill(identity.pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ESRCH' ? { status: 'missing' } : { status: 'unknown' };
  }
  const startedAt = readProcessStartToken(identity.pid);
  if (!startedAt) {
    return { status: 'unknown' };
  }
  return {
    status: startedAt === identity.startedAt ? 'same' : 'mismatch',
    startedAt,
  };
}

async function defaultInspectPathUsage(path: string): Promise<PathUsage> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return 'unknown';
  }
  const result = spawnSync('lsof', ['+D', path], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    return 'unknown';
  }
  if (result.status === 0) {
    return result.stdout.trim() ? 'used' : 'unknown';
  }
  if (
    result.status === 1
    && !result.stdout.trim()
    && !result.stderr.trim()
  ) {
    return 'free';
  }
  return 'unknown';
}

function readProcessStartToken(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  if (process.platform === 'win32') {
    try {
      return execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CreationDate.ToUniversalTime().ToString("o")`,
        ],
        { encoding: 'utf8' },
      ).trim() || null;
    } catch {
      return null;
    }
  }
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return null;
  }
  try {
    return execFileSync(
      'ps',
      ['-p', String(pid), '-o', 'lstart='],
      {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
      },
    ).trim() || null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
