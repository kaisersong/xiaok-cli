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
  canForceKill(input: { childPid: number; resourceId: string }): Promise<boolean>;
}

export interface ControlledCloseBudget {
  readonly stdinGraceMs: number;
  readonly termGraceMs: number;
  readonly killGraceMs: number;
}

export const DEFAULT_CONTROLLED_CLOSE_BUDGET: ControlledCloseBudget = Object.freeze({
  stdinGraceMs: 1_000,
  termGraceMs: 1_000,
  killGraceMs: 1_000,
});

export interface ControlledCloseOutcome {
  readonly expected: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export type ControlledCleanupStatus =
  | { ok: true; escalation: 'stdin' | 'sigterm' | 'sigkill' | 'already-exited' }
  | { ok: false; reason: 'guard_refused' | 'guard_threw' | 'no_exit'; diagnostic: string };

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

type CloseState = 'open' | 'closing' | 'closed';

export class ControlledStdioClientTransport implements Transport {
  onclose?: () => void;

  onerror?: (error: Error) => void;

  onmessage?: (message: unknown) => void;

  private child: ChildProcess | null = null;

  private state: CloseState = 'open';

  private closePromise: Promise<void> | null = null;

  private readBuffer = '';

  private expectedClose = false;

  private closedResolved = false;

  private resolveClosed: (o: ControlledCloseOutcome) => void = () => {};

  private cleanup: ControlledCleanupStatus | null = null;

  private startupAborted = false;

  /** Resolves once: host-expected close or unexpected child exit. */
  readonly closed: Promise<ControlledCloseOutcome>;

  private readonly budget: ControlledCloseBudget;

  constructor(private readonly options: ControlledStdioOptions) {
    this.budget = options.closeBudget ?? DEFAULT_CONTROLLED_CLOSE_BUDGET;
    this.closed = new Promise<ControlledCloseOutcome>((resolve) => {
      this.resolveClosed = (outcome) => {
        if (this.closedResolved) return;
        this.closedResolved = true;
        resolve(outcome);
      };
    });

    // Installed synchronously, before any spawn can happen.
    const signal = options.startupSignal;
    if (signal) {
      if (signal.aborted) this.startupAborted = true;
      else {
        signal.addEventListener('abort', () => {
          this.startupAborted = true;
          void this.close();
        }, { once: true });
      }
    }
  }

  /** Dynamic lookup; never a PID snapshot captured before connect. */
  getChildPid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Exposed so the SDK classifies this transport as stdio (probe kind). */
  get pid(): number | null {
    return this.getChildPid();
  }

  get stderr(): ChildProcess['stderr'] | null {
    return this.child?.stderr ?? null;
  }

  get cleanupStatus(): ControlledCleanupStatus | null {
    return this.cleanup;
  }

  async start(): Promise<void> {
    if (this.state !== 'open') throw new Error(`transport already ${this.state}`);
    if (this.startupAborted) {
      await this.close();
      throw new Error('startup aborted before spawn');
    }
    if (this.child) throw new Error('transport already started');

    const spawnFn = this.options.spawnImpl ?? spawn;
    const child = spawnFn(this.options.command, [...(this.options.args ?? [])], {
      env: this.options.finalEnv as Record<string, string>,
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    this.child = child;

    child.on('error', (error: unknown) => {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const outcome: ControlledCloseOutcome = { expected: this.expectedClose, exitCode: code, signal };
      this.resolveClosed(outcome);
      if (!this.expectedClose) {
        this.state = 'closed';
        this.onclose?.();
      }
    });
    child.stdout?.on('data', (chunk: Buffer | string) => this.ingest(chunk.toString()));

    // The startup signal may have fired between the checks above and spawn.
    if (this.startupAborted) {
      await this.close();
      throw new Error('startup aborted during spawn');
    }
  }

  async send(message: unknown): Promise<void> {
    if (this.state !== 'open') throw new Error('transport is not open');
    const stdin = this.child?.stdin;
    if (!stdin) throw new Error('transport is not connected');
    await new Promise<void>((resolve, reject) => {
      stdin.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** Idempotent: every entry point shares this promise and state machine. */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.runControlledClose();
    return this.closePromise;
  }

  private async runControlledClose(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closing';
    this.expectedClose = true; // atomic marker: no further sends
    const child = this.child;
    if (!child) {
      this.state = 'closed';
      this.cleanup = { ok: true, escalation: 'already-exited' };
      this.resolveClosed({ expected: true, exitCode: null, signal: null });
      this.onclose?.();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      this.state = 'closed';
      this.cleanup = { ok: true, escalation: 'already-exited' };
      this.resolveClosed({ expected: true, exitCode: child.exitCode, signal: child.signalCode });
      this.onclose?.();
      return;
    }

    const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });

    try { child.stdin?.end(); } catch { /* already gone */ }
    if (await this.raceExit(exited, this.budget.stdinGraceMs)) {
      this.finishClose(child, { ok: true, escalation: 'stdin' });
      return;
    }

    const term = await this.escalate(child, 'SIGTERM');
    if (!term.ok) {
      this.finishClose(child, term);
      return;
    }
    if (await this.raceExit(exited, this.budget.termGraceMs)) {
      this.finishClose(child, { ok: true, escalation: 'sigterm' });
      return;
    }

    const kill = await this.escalate(child, 'SIGKILL');
    if (!kill.ok) {
      this.finishClose(child, kill);
      return;
    }
    if (await this.raceExit(exited, this.budget.killGraceMs)) {
      this.finishClose(child, { ok: true, escalation: 'sigkill' });
      return;
    }

    // No further signals: the host never leaves a delayed background kill.
    this.finishClose(child, {
      ok: false,
      reason: 'no_exit',
      diagnostic: `child ${child.pid ?? 'unknown'} still alive after controlled close budget`,
    });
  }

  private async escalate(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): Promise<ControlledCleanupStatus> {
    const childPid = child.pid;
    if (childPid === undefined) {
      return { ok: false, reason: 'no_exit', diagnostic: 'child pid unavailable; refusing to signal' };
    }
    let allowed: boolean;
    try {
      allowed = await this.options.forceKillGuard.canForceKill({ childPid, resourceId: this.options.resourceId });
    } catch (error) {
      return {
        ok: false,
        reason: 'guard_threw',
        diagnostic: `force kill guard threw before ${signal}: ${(error as Error).message}`,
      };
    }
    if (!allowed) {
      return { ok: false, reason: 'guard_refused', diagnostic: `force kill guard refused ${signal}` };
    }
    try { child.kill(signal); } catch { /* raced with exit */ }
    return { ok: true, escalation: signal === 'SIGTERM' ? 'sigterm' : 'sigkill' };
  }

  private async raceExit(exited: Promise<void>, ms: number): Promise<boolean> {
    const setTimer = this.options.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    const clearTimer = this.options.clearTimer ?? ((t: ReturnType<typeof setTimeout>) => clearTimeout(t));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimer(() => resolve(false), ms);
    });
    const result = await Promise.race([exited.then(() => true), timeout]);
    if (timer) clearTimer(timer);
    return result;
  }

  private finishClose(child: ChildProcess, status: ControlledCleanupStatus): void {
    this.cleanup = status;
    this.state = 'closed';
    this.resolveClosed({ expected: true, exitCode: child.exitCode, signal: child.signalCode });
    this.onclose?.();
  }

  private ingest(text: string): void {
    this.readBuffer += text;
    let index = this.readBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.readBuffer.slice(0, index).trim();
      this.readBuffer = this.readBuffer.slice(index + 1);
      if (line) {
        try {
          this.onmessage?.(JSON.parse(line));
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
      index = this.readBuffer.indexOf('\n');
    }
  }
}
