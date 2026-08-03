import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
const REGISTRY_SCHEMA_VERSION = 1;
const LOCK_REF = 'refs/xiaok/worktree-registry-lock';
export function createWorktreeManager(options) {
    const normalizedRoot = resolve(options.repoRoot);
    const normalizedWorktreesDir = resolve(options.worktreesDir);
    const registryPath = resolve(options.registryPath
        ?? join(normalizedWorktreesDir, '.xiaok-worktree-registry'));
    if (!isWithinBoundary(normalizedRoot, registryPath)
        || !isWithinBoundary(normalizedWorktreesDir, registryPath)) {
        throw new Error(`worktree registry is outside configured boundary: ${registryPath}`);
    }
    const now = options.now ?? Date.now;
    const getCurrentProcessIdentity = options.getCurrentProcessIdentity
        ?? defaultCurrentProcessIdentity;
    const inspectProcess = options.inspectProcess ?? defaultInspectProcess;
    const inspectPathUsage = options.inspectPathUsage ?? defaultInspectPathUsage;
    const manager = {
        async allocate(input) {
            return withRegistryLock(async (identity) => {
                let registry = loadRegistry(registryPath, normalizedRoot, normalizedWorktreesDir);
                const gitWorktrees = await listGitWorktrees(options.execGit);
                const reconciliation = await reconcileRegistry(registry, gitWorktrees, inspectProcess, normalizedRoot, normalizedWorktreesDir);
                registry = reconciliation.registry;
                if (reconciliation.changed.length > 0) {
                    saveRegistry(registryPath, registry);
                }
                const existing = registry.leases.find((lease) => lease.branch === input.branch);
                if (existing) {
                    const registration = gitWorktrees.find((entry) => entry.path === existing.path && entry.branch === existing.branch);
                    if (existing.state === 'active' && registration) {
                        if (sameIdentity(existing.allocator, identity)
                            && existing.owner === input.owner
                            && existing.taskId === input.taskId) {
                            return toAllocation(existing, false);
                        }
                        throw new Error(`branch_in_use: ${input.branch}`);
                    }
                    throw new Error(`worktree lease requires recovery before allocation: ${input.branch}`);
                }
                const unowned = gitWorktrees.find((entry) => entry.branch === input.branch);
                if (unowned) {
                    throw new Error(`branch_checked_out_unowned: ${input.branch} at ${unowned.path}`);
                }
                const worktreePath = manager.validatePath(join(normalizedWorktreesDir, input.branch));
                const branchExists = await gitBranchExists(options.execGit, input.branch);
                const timestamp = now();
                const lease = {
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
                    await options.execGit(branchExists
                        ? ['worktree', 'add', worktreePath, input.branch]
                        : ['worktree', 'add', worktreePath, '-b', input.branch]);
                    lease.state = 'active';
                    lease.updatedAt = now();
                    delete lease.lastError;
                    saveRegistry(registryPath, registry);
                    return toAllocation(lease, true);
                }
                catch (error) {
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
                const registry = loadRegistry(registryPath, normalizedRoot, normalizedWorktreesDir);
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
                }
                catch (error) {
                    lease.lastError = errorMessage(error);
                    lease.updatedAt = now();
                    saveRegistry(registryPath, registry);
                    throw error;
                }
            });
        },
        async reconcile() {
            return withRegistryLock(async () => {
                const registry = loadRegistry(registryPath, normalizedRoot, normalizedWorktreesDir);
                const gitWorktrees = await listGitWorktrees(options.execGit);
                const result = await reconcileRegistry(registry, gitWorktrees, inspectProcess, normalizedRoot, normalizedWorktreesDir);
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
                let registry = loadRegistry(registryPath, normalizedRoot, normalizedWorktreesDir);
                const gitWorktrees = await listGitWorktrees(options.execGit);
                const reconciliation = await reconcileRegistry(registry, gitWorktrees, inspectProcess, normalizedRoot, normalizedWorktreesDir);
                registry = reconciliation.registry;
                const result = {
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
                    const registration = gitWorktrees.find((entry) => entry.path === lease.path && entry.branch === lease.branch);
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
                        }
                        catch (error) {
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
            if (!isWithinBoundary(normalizedRoot, normalizedPath)
                || !isWithinBoundary(normalizedWorktreesDir, normalizedPath)) {
                throw new Error(`worktree path is outside configured worktree boundary: ${path}`);
            }
            return normalizedPath;
        },
    };
    async function withRegistryLock(operation) {
        mkdirSync(normalizedWorktreesDir, { recursive: true });
        const identity = await getCurrentProcessIdentity();
        const owner = {
            ...identity,
            token: randomUUID(),
            acquiredAt: now(),
        };
        const ownerPath = join(normalizedWorktreesDir, `.xiaok-worktree-lock-owner-${owner.token}`);
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
            }
            finally {
                await options.execGit(['update-ref', '-d', LOCK_REF, ownerOid]);
            }
        }
        finally {
            try {
                unlinkSync(ownerPath);
            }
            catch { }
        }
    }
    async function acquireLock(ownerOid) {
        const zeroOid = '0'.repeat(ownerOid.length);
        try {
            await options.execGit(['update-ref', LOCK_REF, ownerOid, zeroOid]);
            return;
        }
        catch (firstError) {
            let observedOid;
            let owner;
            try {
                observedOid = (await options.execGit(['rev-parse', LOCK_REF])).trim();
                owner = parseLockOwner(await options.execGit(['cat-file', '-p', observedOid]));
            }
            catch {
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
function loadRegistry(registryPath, repoRoot, worktreesDir) {
    if (!existsSync(registryPath)) {
        return { schemaVersion: REGISTRY_SCHEMA_VERSION, leases: [] };
    }
    try {
        const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
        if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.leases)) {
            throw new Error('unsupported schema');
        }
        const branches = new Set();
        const paths = new Set();
        for (const lease of parsed.leases) {
            if (!isValidLease(lease)) {
                throw new Error('invalid lease');
            }
            if (!isWithinBoundary(repoRoot, lease.path)
                || !isWithinBoundary(worktreesDir, lease.path)
                || branches.has(lease.branch)
                || paths.has(lease.path)) {
                throw new Error('unsafe or duplicate lease');
            }
            branches.add(lease.branch);
            paths.add(lease.path);
        }
        return parsed;
    }
    catch (error) {
        throw new Error(`worktree registry is invalid: ${registryPath}; quarantine it manually after verifying active worktrees`, { cause: error });
    }
}
function saveRegistry(path, registry) {
    writeFileAtomicallySync(path, JSON.stringify(registry, null, 2));
}
async function reconcileRegistry(registry, gitWorktrees, inspectProcess, repoRoot, worktreesDir) {
    const changed = [];
    const skipped = [];
    for (const lease of [...registry.leases]) {
        const registrationByPath = gitWorktrees.find((entry) => entry.path === lease.path);
        const registrationByBranch = gitWorktrees.find((entry) => entry.branch === lease.branch);
        if ((registrationByPath && registrationByPath.branch !== lease.branch)
            || (registrationByBranch && registrationByBranch.path !== lease.path)) {
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
            }
            else if (lease.state === 'allocating') {
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
async function listGitWorktrees(execGit) {
    const output = await execGit(['worktree', 'list', '--porcelain']);
    const records = [];
    let current;
    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
            current = { path: resolve(line.slice('worktree '.length)) };
            records.push(current);
        }
        else if (current && line.startsWith('branch refs/heads/')) {
            current.branch = line.slice('branch refs/heads/'.length);
        }
    }
    return records;
}
async function gitBranchExists(execGit, branch) {
    try {
        await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
        return true;
    }
    catch {
        return false;
    }
}
function validateExistingPath(path, repoRoot, worktreesDir) {
    try {
        if (lstatSync(path).isSymbolicLink()) {
            return false;
        }
        const realPath = realpathSync(path);
        const realRepoRoot = realpathSync(repoRoot);
        const realWorktreesDir = realpathSync(worktreesDir);
        return isWithinBoundary(realRepoRoot, realPath)
            && isWithinBoundary(realWorktreesDir, realPath);
    }
    catch {
        return false;
    }
}
function isWithinBoundary(root, candidate) {
    const normalizedRoot = resolve(root);
    const normalizedCandidate = resolve(candidate);
    const rel = relative(normalizedRoot, normalizedCandidate);
    return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}
function toAllocation(lease, created) {
    return {
        branch: lease.branch,
        path: lease.path,
        owner: lease.owner,
        taskId: lease.taskId,
        cleanup: lease.cleanup,
        created,
    };
}
function isValidLease(value) {
    const lease = value;
    return Boolean(lease
        && typeof lease.branch === 'string'
        && typeof lease.path === 'string'
        && typeof lease.owner === 'string'
        && typeof lease.taskId === 'string'
        && ['keep', 'delete'].includes(lease.cleanup ?? '')
        && ['allocating', 'active', 'released', 'orphaned'].includes(lease.state ?? '')
        && lease.allocator
        && Number.isInteger(lease.allocator.pid)
        && (typeof lease.allocator.startedAt === 'string' || lease.allocator.startedAt === null)
        && typeof lease.allocator.cwd === 'string');
}
function parseLockOwner(raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed.token !== 'string'
        || typeof parsed.pid !== 'number'
        || (typeof parsed.startedAt !== 'string' && parsed.startedAt !== null)
        || typeof parsed.cwd !== 'string'
        || typeof parsed.acquiredAt !== 'number') {
        throw new Error('invalid lock owner');
    }
    return parsed;
}
function sameIdentity(left, right) {
    return left.pid === right.pid
        && left.startedAt !== null
        && right.startedAt !== null
        && left.startedAt === right.startedAt;
}
async function isInactive(identity, inspectProcess) {
    return isConfirmedInactive(await inspectProcess(identity));
}
function isConfirmedInactive(inspection) {
    return inspection.status === 'missing' || inspection.status === 'mismatch';
}
async function defaultCurrentProcessIdentity() {
    return {
        pid: process.pid,
        startedAt: readProcessStartToken(process.pid),
        cwd: process.cwd(),
    };
}
async function defaultInspectProcess(identity) {
    if (!identity.startedAt) {
        return { status: 'unknown' };
    }
    try {
        process.kill(identity.pid, 0);
    }
    catch (error) {
        const code = error.code;
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
async function defaultInspectPathUsage(path) {
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
    if (result.status === 1
        && !result.stdout.trim()
        && !result.stderr.trim()) {
        return 'free';
    }
    return 'unknown';
}
function readProcessStartToken(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    if (process.platform === 'win32') {
        try {
            return execFileSync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CreationDate.ToUniversalTime().ToString("o")`,
            ], { encoding: 'utf8' }).trim() || null;
        }
        catch {
            return null;
        }
    }
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
        return null;
    }
    try {
        return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
            encoding: 'utf8',
            env: { ...process.env, LC_ALL: 'C' },
        }).trim() || null;
    }
    catch {
        return null;
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
