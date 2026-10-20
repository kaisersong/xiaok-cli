import { describe, expect, it } from 'vitest';
import { queryTerminalCursor, readTerminalCursor, waitForTerminalCursorReport } from '../../src/ui/terminal-cursor.js';

function ioFor(chunks: (Buffer | Error)[]) {
  let time = 0;
  const written: string[] = [], replayed: Buffer[] = [];
  return { written, replayed, io: {
    write: (value: string) => { written.push(value); },
    read: () => { const value = chunks.shift(); if (value instanceof Error) throw value; return value ?? Buffer.alloc(0); },
    replay: (value: Buffer) => { replayed.push(value); },
    now: () => time,
    pause: () => { time += 5; },
  } };
}

describe('solicited terminal cursor reports', () => {
  it('joins fragmented CPR and replays mixed UTF-8 and control keys byte for byte', () => {
    const input = Buffer.from('中文\x03\x1b[A');
    const h = ioFor([input.subarray(0, 2), Buffer.concat([input.subarray(2), Buffer.from('\x1b[?12;')]), Buffer.from('34Rtail')]);
    expect(queryTerminalCursor(h.io)).toEqual({ row: 12, column: 34 });
    expect(h.written).toEqual(['\x1b[?6n']);
    expect(Buffer.concat(h.replayed)).toEqual(Buffer.concat([input, Buffer.from('tail')]));
  });
  it('preserves modified F3 instead of accepting it as a cursor report', () => {
    const h = ioFor([Buffer.from('\x1b[1;2R\x1b[?17;1R')]);
    expect(queryTerminalCursor(h.io)).toEqual({ row: 17, column: 1 });
    expect(Buffer.concat(h.replayed).toString()).toBe('\x1b[1;2R');
  });
  it('bounds unsupported terminal waits and preserves ordinary input', () => {
    const h = ioFor([Buffer.from('KEEP_DRAFT')]);
    expect(queryTerminalCursor(h.io, 20)).toBeNull();
    expect(Buffer.concat(h.replayed).toString()).toBe('KEEP_DRAFT');
    expect(h.io.now()).toBe(20);
  });
  it.each(['write', 'read'] as const)('preserves bytes when the %s transport fails', method => {
    const h = ioFor([Buffer.from('draft'), new Error('disconnected')]);
    if (method === 'write') h.io.write = () => { throw new Error('disconnected'); };
    expect(queryTerminalCursor(h.io)).toBeNull();
    expect(Buffer.concat(h.replayed).toString()).toBe(method === 'write' ? '' : 'draft');
  });
  it('rejects invalid reports without accepting an unsafe position', () => {
    const h = ioFor([Buffer.from('\x1b[?0;34R')]);
    expect(queryTerminalCursor(h.io, 10)).toBeNull();
  });
  it('does not delay external handoff when no report is outstanding', async () => {
    expect(await waitForTerminalCursorReport()).toBe(true);
  });
  it('never attempts a query for a stream without a TTY fd', () => {
    let writes = 0;
    const stream = { write: () => { writes++; } } as unknown as NodeJS.WriteStream;
    expect(readTerminalCursor(stream, '\x1b8')).toBeNull();
    expect(writes).toBe(0);
  });
});
