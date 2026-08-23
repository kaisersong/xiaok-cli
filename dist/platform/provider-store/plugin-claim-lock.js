/**
 * PluginClaimLock v2 (design v58 §4.4, R28-01, R29-03).
 *
 * Why the old lock could not be fixed in place: `acquirePluginLock()` reclaims a
 * stale lock by read-dead → rm → create on one shared path. Two processes can
 * both see the same dead lock, and after A creates its new owner file B still
 * deletes it by the old verdict and becomes a second owner. Any pin protocol
 * built on that is unsound.
 *
 * The v2 protocol never deletes a path another process may legitimately own:
 *  - every contender creates its own unique `<token>.choosing` file with
 *    `openSync(..., 'wx')` and fsyncs the file and the claims directory;
 *  - it then picks `ticket = max(settled tickets) + 1` and atomically renames
 *    its own file to `<ticket>-<token>.claim`;
 *  - after settling it freezes the *currently visible* choosing predecessors and
 *    only waits for that bounded cohort, so a continuous stream of newcomers
 *    cannot starve an already-settled owner (R29-03);
 *  - the smallest live ticket enters the critical section;
 *  - release unlinks only its own claim; stale cleanup unlinks only a claim whose
 *    pid + process start identity is proven dead. Unreadable identity fails
 *    closed and asks for explicit diagnosis.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
export class PluginLockBusyError extends Error {
    holder;
    code = 'plugin_lock_busy';
    constructor(holder) {
        super(`plugin_lock_busy: held by ${holder}`);
        this.holder = holder;
        this.name = 'PluginLockBusyError';
    }
}
export class PluginLockFailClosedError extends Error {
    code = 'plugin_lock_identity_unreadable';
    constructor(detail) {
        super(`plugin_lock_identity_unreadable: ${detail}`);
        this.name = 'PluginLockFailClosedError';
    }
}
const CHOOSING_SUFFIX = '.choosing';
const CLAIM_SUFFIX = '.claim';
function fsyncDir(dir) {
    // POSIX: makes the new/renamed/unlinked directory entry durable. On Windows a
    // directory handle fsync is not available; the design records that platform
    // split honestly instead of pretending otherwise.
    if (process.platform === 'win32')
        return;
    const fd = openSync(dir, 'r');
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function writeClaimFile(path, payload) {
    const fd = openSync(path, 'wx');
    try {
        writeSync(fd, `${JSON.stringify(payload)}\n`);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function parseClaim(claimsDir, fileName) {
    const isChoosing = fileName.endsWith(CHOOSING_SUFFIX);
    const isSettled = fileName.endsWith(CLAIM_SUFFIX);
    if (!isChoosing && !isSettled)
        return null;
    let raw;
    try {
        raw = readFileSync(join(claimsDir, fileName), 'utf8');
    }
    catch {
        return null; // vanished between readdir and read: treat as gone
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new PluginLockFailClosedError(`corrupt claim ${fileName}`);
    }
    if (typeof parsed.token !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.startIdentity !== 'string') {
        throw new PluginLockFailClosedError(`invalid claim schema ${fileName}`);
    }
    const ticket = isSettled ? Number(fileName.split('-')[0]) : null;
    if (isSettled && (!Number.isSafeInteger(ticket) || ticket < 0)) {
        throw new PluginLockFailClosedError(`invalid ticket in ${fileName}`);
    }
    return {
        fileName,
        token: parsed.token,
        ticket,
        identity: { pid: parsed.pid, startIdentity: parsed.startIdentity },
    };
}
export class PluginClaimLock {
    claimsDir;
    deps;
    acquireTimeoutMs;
    pollIntervalMs;
    constructor(options) {
        this.claimsDir = options.claimsDir;
        this.deps = options.deps;
        this.acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
        this.pollIntervalMs = options.pollIntervalMs ?? 10;
    }
    /** Creates the claims directory chain, fsyncing each new level (R34-03). */
    ensureDirs() {
        mkdirSync(this.claimsDir, { recursive: true });
        fsyncDir(this.claimsDir);
    }
    listClaims() {
        const claims = [];
        for (const fileName of readdirSync(this.claimsDir).sort()) {
            const claim = parseClaim(this.claimsDir, fileName);
            if (claim)
                claims.push(claim);
        }
        return claims;
    }
    isLive(claim) {
        const identity = this.deps.probeIdentity(claim.identity.pid);
        if (!identity)
            return false;
        return identity.startIdentity === claim.identity.startIdentity;
    }
    /** Removes only claims proven dead; never a path a live owner may reuse. */
    cleanupDeadClaims(claims) {
        const live = [];
        for (const claim of claims) {
            if (this.isLive(claim)) {
                live.push(claim);
                continue;
            }
            try {
                unlinkSync(join(this.claimsDir, claim.fileName));
                fsyncDir(this.claimsDir);
            }
            catch {
                // Someone else already reclaimed it; nothing else to do.
            }
        }
        return live;
    }
    async acquire() {
        this.ensureDirs();
        const self = this.deps.self();
        const token = randomBytes(12).toString('hex');
        const choosingName = `${token}${CHOOSING_SUFFIX}`;
        writeClaimFile(join(this.claimsDir, choosingName), {
            token, pid: self.pid, startIdentity: self.startIdentity, createdAt: this.deps.now(),
        });
        fsyncDir(this.claimsDir);
        // Ticket selection: strictly after every settled ticket we can see.
        const settledBefore = this.cleanupDeadClaims(this.listClaims())
            .filter((c) => c.ticket !== null);
        const ticket = settledBefore.reduce((max, c) => Math.max(max, c.ticket), 0) + 1;
        const claimName = `${String(ticket).padStart(6, '0')}-${token}${CLAIM_SUFFIX}`;
        renameSync(join(this.claimsDir, choosingName), join(this.claimsDir, claimName));
        fsyncDir(this.claimsDir);
        // Freeze the bounded predecessor cohort: only contenders that were already
        // choosing when we settled. Newcomers must observe our ticket and queue
        // behind it, so they can never starve us.
        const cohort = new Set(this.cleanupDeadClaims(this.listClaims())
            .filter((c) => c.ticket === null && c.token !== token)
            .map((c) => c.token));
        const startedAt = this.deps.now();
        for (;;) {
            const live = this.cleanupDeadClaims(this.listClaims());
            const pendingCohort = live.filter((c) => c.ticket === null && cohort.has(c.token));
            const settled = live.filter((c) => c.ticket !== null);
            const smallest = settled.reduce((best, c) => (best === null || c.ticket < best.ticket ? c : best), null);
            if (pendingCohort.length === 0 && smallest?.token === token) {
                return { token, ticket, claimsDir: this.claimsDir };
            }
            if (this.deps.now() - startedAt > this.acquireTimeoutMs) {
                this.releaseByToken(token);
                throw new PluginLockBusyError(smallest ? `ticket ${smallest.ticket}` : 'unknown');
            }
            await this.deps.sleep(this.pollIntervalMs);
        }
    }
    release(capability) {
        this.releaseByToken(capability.token);
    }
    releaseByToken(token) {
        for (const fileName of readdirSync(this.claimsDir)) {
            if (!fileName.includes(token))
                continue;
            try {
                unlinkSync(join(this.claimsDir, fileName));
                fsyncDir(this.claimsDir);
            }
            catch {
                // Already gone.
            }
        }
    }
    /** Runs `fn` inside the critical section, releasing even on throw. */
    async withLock(fn) {
        const capability = await this.acquire();
        try {
            return await fn(capability);
        }
        finally {
            this.release(capability);
        }
    }
}
