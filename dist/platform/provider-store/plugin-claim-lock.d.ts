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
export declare class PluginLockBusyError extends Error {
    readonly holder: string;
    readonly code = "plugin_lock_busy";
    constructor(holder: string);
}
export declare class PluginLockFailClosedError extends Error {
    readonly code = "plugin_lock_identity_unreadable";
    constructor(detail: string);
}
/** Opaque capability proving the holder is inside the critical section. */
export interface PluginLockCapability {
    readonly token: string;
    readonly ticket: number;
    readonly claimsDir: string;
}
export declare class PluginClaimLock {
    private readonly claimsDir;
    private readonly deps;
    private readonly acquireTimeoutMs;
    private readonly pollIntervalMs;
    constructor(options: ClaimLockOptions);
    /** Creates the claims directory chain, fsyncing each new level (R34-03). */
    ensureDirs(): void;
    private listClaims;
    private isLive;
    /** Removes only claims proven dead; never a path a live owner may reuse. */
    private cleanupDeadClaims;
    acquire(): Promise<PluginLockCapability>;
    release(capability: PluginLockCapability): void;
    private releaseByToken;
    /** Runs `fn` inside the critical section, releasing even on throw. */
    withLock<T>(fn: (capability: PluginLockCapability) => Promise<T>): Promise<T>;
}
