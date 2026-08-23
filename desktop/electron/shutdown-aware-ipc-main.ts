/**
 * DesktopShutdownGate + ShutdownAwareIpcMain (design v58 §5.5, R17-03, R18-01, R19-01).
 *
 * Why a gate instead of a hand-maintained mutation allowlist: production has
 * 206 `ipcMain.handle()` registrations across `main.ts` (53), `ipc.ts` (141) and
 * `kswarm-ipc-proxy.ts` (12), plus the currently caller-less migration shim in
 * `ipc-runtime.ts`. Enumerating "the mutating ones" by hand guarantees a missed
 * entry point, so every invoke — reads included — takes a token and releases it
 * in `finally`.
 *
 * Only `ShutdownAwareIpcMain` may hold the raw Electron `ipcMain`; every other
 * registration surface receives the narrow `IpcHandleRegistrar` interface.
 */

// Type-only import: this module is the sole holder of the raw ipcMain object,
// and the erased type keeps every registrar signature identical to production.
import type { IpcMainInvokeEvent } from 'electron';

// Mirrors Electron's own `ipcMain.handle` signature so every existing handler
// assigns unchanged; `any[]` is deliberate and matches the upstream typing.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type IpcHandlerListener = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

/** The narrow surface every registration site receives. */
export interface IpcHandleRegistrar {
  handle(channel: string, listener: IpcHandlerListener): void;
}

/** Minimal shape of the raw Electron ipcMain we depend on. */
export interface RawIpcMainLike {
  handle(channel: string, listener: IpcHandlerListener): void;
}

export type ShutdownTokenKind =
  | 'ipc'
  | 'task_execution'
  | 'bootstrap_queue'
  | 'external';

export interface ShutdownToken {
  readonly id: number;
  readonly kind: ShutdownTokenKind;
  readonly label: string;
  release(): void;
}

export class ShuttingDownError extends Error {
  readonly code = 'shutting_down';

  constructor(label: string) {
    super(`shutting_down: ${label}`);
    this.name = 'ShuttingDownError';
  }
}

export class DesktopShutdownGate {
  private open = true;

  private seq = 0;

  private readonly tokens = new Map<number, { kind: ShutdownTokenKind; label: string }>();

  private drainWaiters: Array<() => void> = [];

  get isOpen(): boolean {
    return this.open;
  }

  get outstanding(): number {
    return this.tokens.size;
  }

  outstandingByKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { kind } of this.tokens.values()) out[kind] = (out[kind] ?? 0) + 1;
    return out;
  }

  /** Closed synchronously in shutdown phase ①. */
  close(): void {
    this.open = false;
  }

  /**
   * Acquires a token or throws `shutting_down`. Callers must release in
   * `finally`; an outer IPC token only covers its own callback, never work that
   * keeps running after the callback returns.
   */
  acquire(kind: ShutdownTokenKind, label: string): ShutdownToken {
    if (!this.open) throw new ShuttingDownError(label);
    this.seq += 1;
    const id = this.seq;
    this.tokens.set(id, { kind, label });
    let released = false;
    return {
      id,
      kind,
      label,
      release: () => {
        if (released) return;
        released = true;
        this.tokens.delete(id);
        if (this.tokens.size === 0) {
          const waiters = this.drainWaiters;
          this.drainWaiters = [];
          for (const w of waiters) w();
        }
      },
    };
  }

  /** Resolves true when every token drained inside the deadline. */
  async drain(deadlineMs: number, setTimer: typeof setTimeout = setTimeout): Promise<boolean> {
    if (this.tokens.size === 0) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimer(() => {
        if (settled) return;
        settled = true;
        resolve(this.tokens.size === 0);
      }, deadlineMs);
      this.drainWaiters.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer as ReturnType<typeof setTimeout>);
        resolve(true);
      });
    });
  }

  /** Diagnostic snapshot for `store_close_deferred_to_process_exit`. */
  describeOutstanding(): string[] {
    return [...this.tokens.values()].map(({ kind, label }) => `${kind}:${label}`);
  }
}

/**
 * The only holder of the raw Electron `ipcMain`. Every channel registered
 * through it takes a gate token for the duration of the handler.
 */
export class ShutdownAwareIpcMain implements IpcHandleRegistrar {
  private readonly channels = new Set<string>();

  constructor(
    private readonly rawIpcMain: RawIpcMainLike,
    private readonly gate: DesktopShutdownGate,
  ) {}

  /** Every registered channel, used by the contract test to prove coverage. */
  registeredChannels(): string[] {
    return [...this.channels].sort();
  }

  handle(channel: string, listener: IpcHandlerListener): void {
    if (this.channels.has(channel)) {
      throw new Error(`duplicate ipc channel registration: ${channel}`);
    }
    this.channels.add(channel);
    this.rawIpcMain.handle(channel, (async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const token = this.gate.acquire('ipc', channel);
      try {
        return await listener(event, ...args);
      } finally {
        token.release();
      }
    }) as never);
  }
}
