import { closeSync, constants, openSync, readSync } from 'node:fs';
import { isatty } from 'node:tty';
import { canMeasureTerminalCursor } from './keyboard-protocol.js';
import { deferCursorReport, type PendingCursorReport } from './terminal-replies.js';

export interface TerminalCursor { row: number; column: number; rows?: number; columns?: number }
export interface CursorQueryIO {
  write(request: string): void;
  read(): Buffer;
  replay(bytes: Buffer): void;
  now(): number;
  pause(): void;
}

/** Consume only the solicited CPR; leave decoding and control keys to stdin. */
export function queryTerminalCursor(io: CursorQueryIO, timeoutMs = 120): TerminalCursor | null {
  let received = '';
  try {
    io.write('\x1b[?6n');
    const deadline = io.now() + timeoutMs;
    while (io.now() < deadline && received.length < 65536) {
      received += io.read().toString('latin1');
      const report = /\x1b\[\?(\d+);(\d+)R/.exec(received);
      if (report && [Number(report[1]), Number(report[2])].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65535)) {
        received = received.slice(0, report.index) + received.slice(report.index + report[0].length);
        return { row: Number(report[1]), column: Number(report[2]) };
      }
      io.pause();
    }
  } catch {
    // An unsupported/disconnected terminal keeps the existing geometry fallback.
  } finally {
    if (received) io.replay(Buffer.from(received, 'latin1'));
  }
  return null;
}

const pauseWord = new Int32Array(new SharedArrayBuffer(4));
let pendingReport: PendingCursorReport | undefined;

/** Do not hand the physical terminal to a child with an unresolved reply. */
export async function waitForTerminalCursorReport(timeoutMs = 1000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (pendingReport?.active) {
    if (performance.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - performance.now()))));
  }
  return true;
}

export function cancelPendingCursorReport(): void {
  pendingReport?.cancel();
  pendingReport = undefined;
}

/** Read the reflowed content anchor in one bounded, serialized resize frame. */
export function readTerminalCursor(stream: NodeJS.WriteStream, restore: string): TerminalCursor | null {
  const fd = (stream as NodeJS.WriteStream & { fd?: number }).fd;
  // Multiplexers clamp their saved cursor on resize instead of preserving its
  // transcript anchor; their own reflow must keep the established geometry path.
  if (!canMeasureTerminalCursor() || pendingReport?.active || process.platform === 'win32' || process.env.TMUX || process.env.STY || !process.stdin.isRaw
    || typeof fd !== 'number' || !isatty(fd) || !isatty(process.stdin.fd)) return null;
  let inputFd: number;
  try { inputFd = openSync('/dev/tty', constants.O_RDWR | constants.O_NONBLOCK); }
  catch { return null; }
  const replay: Buffer[] = [];
  try {
    const bytes = Buffer.alloc(512);
    // Public dimensions are cached until SIGWINCH is dispatched. A short
    // stability window prevents using an earlier SSH resize with a later CPR.
    const handle = (stream as unknown as { _handle?: { getWindowSize(size: number[]): number } })._handle;
    const readSize = (): number[] | null => {
      const size = [0, 0];
      return handle && !handle.getWindowSize(size) && size.every(value => value > 0) ? size : null;
    };
    const deadline = performance.now() + 400;
    for (let attempt = 0; attempt < 2; attempt++) {
      let size = readSize();
      let stableSince = performance.now();
      while (size && performance.now() - stableSince < 30 && performance.now() < deadline - 120) {
        Atomics.wait(pauseWord, 0, 0, 5);
        const next = readSize();
        if (!next || next[0] !== size[0] || next[1] !== size[1]) stableSince = performance.now();
        size = next;
      }
      const position = queryTerminalCursor({
        write: request => { stream.write(restore + request); },
        read: () => {
          try { return Buffer.from(bytes.subarray(0, readSync(inputFd, bytes, 0, bytes.length, null))); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return Buffer.alloc(0);
            throw error;
          }
        },
        now: () => performance.now(),
        pause: () => { Atomics.wait(pauseWord, 0, 0, 2); },
        replay: input => { replay.push(input); },
      }, Math.min(120, Math.max(1, deadline - performance.now())));
      const after = readSize();
      if (!position) {
        // A reply may be split across the synchronous deadline. Preserve its
        // parser state below all current/future stdin data listeners. Unsupported
        // terminals keep the established fallback until this query is resolved.
        pendingReport = deferCursorReport(process.stdin);
        return null;
      }
      if (!size || !after) return position;
      if (size[0] === after[0] && size[1] === after[1]) {
        return position.row <= after[1] && position.column <= after[0]
          ? { ...position, columns: after[0], rows: after[1] } : null;
      }
    }
    return null;
  } finally {
    closeSync(inputFd);
    if (replay.length) queueMicrotask(() => {
      if (process.stdin.destroyed || !process.stdin.readable) return;
      const bytes = Buffer.concat(replay);
      if (pendingReport?.active) pendingReport.replay(bytes);
      else process.stdin.push(bytes);
    });
  }
}
