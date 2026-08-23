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

export interface ProcessIdentity {
  readonly pid: number;
  /** OS-reported process start identity; PID reuse must not look alive. */
  readonly startIdentity: string;
}

export interface ClaimLockDeps {
  /** Reads a live process identity, or null when the pid is gone. */
  probeIdentity(pid: number): ProcessIdentity | null;
  self(): ProcessIdentity;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ClaimLockOptions {
  readonly claimsDir: string;
  readonly deps: ClaimLockDeps;
  /** Bounded wait before returning a typed busy result. */
  readonly acquireTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export class PluginLockBusyError extends Error {
  readonly code = 'plugin_lock_busy';

  constructor(readonly holder: string) {
    super(`plugin_lock_busy: held by ${holder}`);
    this.name = 'PluginLockBusyError';
  }
}

export class PluginLockFailClosedError extends Error {
  readonly code = 'plugin_lock_identity_unreadable';

  constructor(detail: string) {
    super(`plugin_lock_identity_unreadable: ${detail}`);
    this.name = 'PluginLockFailClosedError';
  }
}

/** Opaque capability proving the holder is inside the critical section. */
export interface PluginLockCapability {
  readonly token: string;
  readonly ticket: number;
  readonly claimsDir: string;
}

interface ClaimFile {
  readonly fileName: string;
  readonly token: string;
  readonly ticket: number | null; // null while still choosing
  readonly identity: ProcessIdentity;
}

const CHOOSING_SUFFIX = '.choosing';
const CLAIM_SUFFIX = '.claim';

function fsyncDir(dir: string): void {
  // POSIX: makes the new/renamed/unlinked directory entry durable. On Windows a
  // directory handle fsync is not available; the design records that platform
  // split honestly instead of pretending otherwise.
  if (process.platform === 'win32') return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeClaimFile(path: string, payload: unknown): void {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, `${JSON.stringify(payload)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function parseClaim(claimsDir: string, fileName: string): ClaimFile | null {
  const isChoosing = fileName.endsWith(CHOOSING_SUFFIX);
  const isSettled = fileName.endsWith(CLAIM_SUFFIX);
  if (!isChoosing && !isSettled) return null;
  let raw: string;
  try {
    raw = readFileSync(join(claimsDir, fileName), 'utf8');
  } catch {
    return null; // vanished between readdir and read: treat as gone
  }
  let parsed: { token?: unknown; pid?: unknown; startIdentity?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PluginLockFailClosedError(`corrupt claim ${fileName}`);
  }
  if (typeof parsed.token !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.startIdentity !== 'string') {
    throw new PluginLockFailClosedError(`invalid claim schema ${fileName}`);
  }
  const ticket = isSettled ? Number(fileName.split('-')[0]) : null;
  if (isSettled && (!Number.isSafeInteger(ticket) || (ticket as number) < 0)) {
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
  private readonly claimsDir: string;

  private readonly deps: ClaimLockDeps;

  private readonly acquireTimeoutMs: number;

  private readonly pollIntervalMs: number;

  constructor(options: ClaimLockOptions) {
    this.claimsDir = options.claimsDir;
    this.deps = options.deps;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 10;
  }

  /** Creates the claims directory chain, fsyncing each new level (R34-03). */
  ensureDirs(): void {
    mkdirSync(this.claimsDir, { recursive: true });
    fsyncDir(this.claimsDir);
  }

  private listClaims(): ClaimFile[] {
    const claims: ClaimFile[] = [];
    for (const fileName of readdirSync(this.claimsDir).sort()) {
      const claim = parseClaim(this.claimsDir, fileName);
      if (claim) claims.push(claim);
    }
    return claims;
  }

  private isLive(claim: ClaimFile): boolean {
    const identity = this.deps.probeIdentity(claim.identity.pid);
    if (!identity) return false;
    return identity.startIdentity === claim.identity.startIdentity;
  }

  /** Removes only claims proven dead; never a path a live owner may reuse. */
  private cleanupDeadClaims(claims: ClaimFile[]): ClaimFile[] {
    const live: ClaimFile[] = [];
    for (const claim of claims) {
      if (this.isLive(claim)) {
        live.push(claim);
        continue;
      }
      try {
        unlinkSync(join(this.claimsDir, claim.fileName));
        fsyncDir(this.claimsDir);
      } catch {
        // Someone else already reclaimed it; nothing else to do.
      }
    }
    return live;
  }

  async acquire(): Promise<PluginLockCapability> {
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
    const ticket = settledBefore.reduce((max, c) => Math.max(max, c.ticket as number), 0) + 1;
    const claimName = `${String(ticket).padStart(6, '0')}-${token}${CLAIM_SUFFIX}`;
    renameSync(join(this.claimsDir, choosingName), join(this.claimsDir, claimName));
    fsyncDir(this.claimsDir);

    // Freeze the bounded predecessor cohort: only contenders that were already
    // choosing when we settled. Newcomers must observe our ticket and queue
    // behind it, so they can never starve us.
    const cohort = new Set(
      this.cleanupDeadClaims(this.listClaims())
        .filter((c) => c.ticket === null && c.token !== token)
        .map((c) => c.token),
    );

    const startedAt = this.deps.now();
    for (;;) {
      const live = this.cleanupDeadClaims(this.listClaims());
      const pendingCohort = live.filter((c) => c.ticket === null && cohort.has(c.token));
      const settled = live.filter((c) => c.ticket !== null);
      const smallest = settled.reduce<ClaimFile | null>(
        (best, c) => (best === null || (c.ticket as number) < (best.ticket as number) ? c : best),
        null,
      );
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

  release(capability: PluginLockCapability): void {
    this.releaseByToken(capability.token);
  }

  private releaseByToken(token: string): void {
    for (const fileName of readdirSync(this.claimsDir)) {
      if (!fileName.includes(token)) continue;
      try {
        unlinkSync(join(this.claimsDir, fileName));
        fsyncDir(this.claimsDir);
      } catch {
        // Already gone.
      }
    }
  }

  /** Runs `fn` inside the critical section, releasing even on throw. */
  async withLock<T>(fn: (capability: PluginLockCapability) => Promise<T>): Promise<T> {
    const capability = await this.acquire();
    try {
      return await fn(capability);
    } finally {
      this.release(capability);
    }
  }
}
