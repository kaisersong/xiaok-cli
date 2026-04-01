import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

type WritableChunk = string | Uint8Array;

export interface TtyHarness {
  emitter: EventEmitter;
  output: { raw: string; normalized: string };
  screen: { lines: () => string[]; text: () => string };
  send: (text: string) => void;
  restore: () => void;
}

function replayTerminal(raw: string, maxRows?: number): string[] {
  const lines: string[] = [''];
  let row = 0;
  let col = 0;
  let savedRow = 0;
  let savedCol = 0;
  const viewportRows = maxRows && maxRows > 0 ? maxRows : Number.POSITIVE_INFINITY;

  const ensureRow = (target: number) => {
    while (lines.length <= target) {
      lines.push('');
    }
  };

  const ensureCol = (targetRow: number, targetCol: number) => {
    ensureRow(targetRow);
    const line = lines[targetRow] ?? '';
    if (line.length < targetCol) {
      lines[targetRow] = line.padEnd(targetCol, ' ');
    }
  };

  const writeChar = (char: string) => {
    ensureCol(row, col);
    const line = lines[row] ?? '';
    if (col >= line.length) {
      lines[row] = line.padEnd(col, ' ') + char;
    } else {
      lines[row] = line.slice(0, col) + char + line.slice(col + 1);
    }
    col += 1;
  };

  const clearLine = (mode: string | undefined) => {
    ensureRow(row);
    const line = lines[row] ?? '';
    if (mode === '2') {
      lines[row] = '';
      col = 0;
      return;
    }
    lines[row] = line.slice(0, col);
  };

  const scrollIfNeeded = () => {
    if (viewportRows === Number.POSITIVE_INFINITY) {
      return;
    }

    while (row >= viewportRows) {
      lines.shift();
      lines.push('');
      row -= 1;
      savedRow = Math.max(0, savedRow - 1);
    }
  };

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '\n') {
      row += 1;
      col = 0;
      scrollIfNeeded();
      ensureRow(row);
      continue;
    }
    if (char === '\r') {
      col = 0;
      continue;
    }
    if (char !== '\x1b') {
      writeChar(char);
      continue;
    }

    const next = raw[i + 1];
    if (next === '[') {
      let j = i + 2;
      let params = '';
      while (j < raw.length && !/[A-Za-z]/.test(raw[j] ?? '')) {
        params += raw[j];
        j += 1;
      }
      const cmd = raw[j] ?? '';
      const value = Number.parseInt(params || '1', 10) || 1;
      if (cmd === 'A') row = Math.max(0, row - value);
      if (cmd === 'B') {
        row += value;
        scrollIfNeeded();
        ensureRow(row);
      }
      if (cmd === 'C') col += value;
      if (cmd === 'D') col = Math.max(0, col - value);
      if (cmd === 'H') {
        row = 0;
        col = 0;
      }
      if (cmd === 'K') clearLine(params);
      if (cmd === 's') {
        savedRow = row;
        savedCol = col;
      }
      if (cmd === 'u') {
        row = savedRow;
        col = savedCol;
      }
      i = j;
      continue;
    }
    if (next === '7' || next === 's') {
      savedRow = row;
      savedCol = col;
      i += 1;
      continue;
    }
    if (next === '8' || next === 'u') {
      row = savedRow;
      col = savedCol;
      i += 1;
      continue;
    }
  }

  return lines.map((line) => line.replace(/\s+$/g, ''));
}

export function createTtyHarness(columns = 80, rows?: number): TtyHarness {
  const emitter = new EventEmitter();
  let raw = '';

  const originalStdoutWrite = process.stdout.write;
  const originalStdoutColumns = process.stdout.columns;
  const originalStdoutRows = process.stdout.rows;
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalSetRawMode = (process.stdin as typeof process.stdin & { setRawMode?: (value: boolean) => void }).setRawMode;
  const originalResume = process.stdin.resume;
  const originalPause = process.stdin.pause;
  const originalOn = process.stdin.on;
  const originalRemoveListener = process.stdin.removeListener;

  process.stdout.columns = columns;
  if (rows !== undefined) {
    process.stdout.rows = rows;
  }
  process.stdin.isTTY = true;
  (process.stdin as typeof process.stdin & { setRawMode?: (value: boolean) => void }).setRawMode = vi.fn();
  process.stdin.resume = vi.fn(() => process.stdin);
  process.stdin.pause = vi.fn(() => process.stdin);
  process.stdin.on = ((event: string, listener: (...args: any[]) => void) => {
    emitter.on(event, listener);
    return process.stdin;
  }) as typeof process.stdin.on;
  process.stdin.removeListener = ((event: string, listener: (...args: any[]) => void) => {
    emitter.removeListener(event, listener);
    return process.stdin;
  }) as typeof process.stdin.removeListener;

  process.stdout.write = ((chunk: WritableChunk) => {
    raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;

  return {
    emitter,
    output: {
      get raw() {
        return raw;
      },
      get normalized() {
        return raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
      },
    },
    screen: {
      lines() {
        return replayTerminal(raw, rows);
      },
      text() {
        return replayTerminal(raw, rows).join('\n');
      },
    },
    send(text: string) {
      emitter.emit('data', Buffer.from(text, 'utf8'));
    },
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stdout.columns = originalStdoutColumns;
      process.stdout.rows = originalStdoutRows;
      process.stdin.isTTY = originalStdinIsTTY;
      (process.stdin as typeof process.stdin & { setRawMode?: (value: boolean) => void }).setRawMode = originalSetRawMode;
      process.stdin.resume = originalResume;
      process.stdin.pause = originalPause;
      process.stdin.on = originalOn;
      process.stdin.removeListener = originalRemoveListener;
      emitter.removeAllListeners();
    },
  };
}
