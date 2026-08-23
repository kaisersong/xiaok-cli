/**
 * ControlledStdioClientTransport (design v58 §1.2 item 7, §3.4, §5.5).
 *
 * Why Xiaok owns this instead of the SDK's StdioClientTransport: the SDK close
 * path only guards its delayed SIGTERM/SIGKILL with `exitCode === null`, never
 * looks at `signalCode` or descendants, and returns before the child is proven
 * gone — so a background kill can still fire later. Reserved bundled providers
 * need exactly one owner for stdin close, TERM, KILL, exit observation and
 * idempotent close.
 *
 * Frozen behaviours:
 *  - `finalEnv` is the complete, final spawn environment. It is passed verbatim;
 *    `process.env` and SDK defaults are never merged in.
 *  - The startup abort listener is installed synchronously in the constructor,
 *    before `start()`/spawn, so a caller/runtime abort during spawn, modern
 *    `server/discover` or legacy initialize enters the same idempotent close.
 *  - Close order and budget: mark expected → `stdin.end()` + 1s → guard →
 *    SIGTERM + 1s → guard → SIGKILL + 1s. Total 3s. Any signal must pass the
 *    construction-time ForceKillGuard; a refusing guard produces a typed
 *    cleanup failure and never a background delayed kill.
 *  - The raw close handle, the final connection and `Client.close()` share one
 *    close promise and one state machine.
 *  - `closed` resolves exactly once and distinguishes host-expected close from
 *    unexpected child exit.
 *  - `stderr`/`pid` are exposed so the SDK classifies this as a stdio probe
 *    transport (design v56/v58: `detectProbeTransportKind`).
 */
import { type ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import type { Transport } from '@modelcontextprotocol/client';
/** Shared platform-layer type; must not import Desktop runtime types. */
export interface ForceKillGuard {
    canForceKill(input: {
        childPid: number;
        resourceId: string;
    }): Promise<boolean>;
}
export interface ControlledCloseBudget {
    readonly stdinGraceMs: number;
    readonly termGraceMs: number;
    readonly killGraceMs: number;
}
export declare const DEFAULT_CONTROLLED_CLOSE_BUDGET: ControlledCloseBudget;
export interface ControlledCloseOutcome {
    readonly expected: boolean;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
}
export type ControlledCleanupStatus = {
    ok: true;
    escalation: 'stdin' | 'sigterm' | 'sigkill' | 'already-exited';
} | {
    ok: false;
    reason: 'guard_refused' | 'guard_threw' | 'no_exit';
    diagnostic: string;
};
export interface ControlledStdioOptions {
    readonly command: string;
    readonly args?: readonly string[];
    /** Complete and final env map. Never merged with process.env. */
    readonly finalEnv: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly resourceId: string;
    readonly forceKillGuard: ForceKillGuard;
    readonly closeBudget?: ControlledCloseBudget;
    /** Combined caller + runtime signal; owns startup interruption. */
    readonly startupSignal?: AbortSignal;
    readonly spawnImpl?: typeof spawn;
    readonly setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    readonly clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}
export declare class ControlledStdioClientTransport implements Transport {
    private readonly options;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
    private child;
    private state;
    private closePromise;
    private readBuffer;
    private expectedClose;
    private closedResolved;
    private resolveClosed;
    private cleanup;
    private startupAborted;
    /** Resolves once: host-expected close or unexpected child exit. */
    readonly closed: Promise<ControlledCloseOutcome>;
    private readonly budget;
    constructor(options: ControlledStdioOptions);
    /** Dynamic lookup; never a PID snapshot captured before connect. */
    getChildPid(): number | null;
    /** Exposed so the SDK classifies this transport as stdio (probe kind). */
    get pid(): number | null;
    get stderr(): ChildProcess['stderr'] | null;
    get cleanupStatus(): ControlledCleanupStatus | null;
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    /** Idempotent: every entry point shares this promise and state machine. */
    close(): Promise<void>;
    private runControlledClose;
    private escalate;
    private raceExit;
    private finishClose;
    private ingest;
}
