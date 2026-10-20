import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferCursorReport } from '../../src/ui/terminal-replies.js';

afterEach(() => vi.useRealTimers());
function inputHarness() {
  const input = new Readable({ read() {} });
  const chunks: Buffer[] = [];
  input.on('data', chunk => chunks.push(Buffer.from(chunk)));
  input.resume();
  return { input, chunks, text: () => Buffer.concat(chunks).toString() };
}

describe('late private cursor report routing below input owners', () => {
  it('removes a CPR split across the query timeout, preserving text and control keys', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    const original = h.input.push;
    const report = deferCursorReport(h.input);
    report.replay(Buffer.from('中文\x1b[?12;'));
    h.input.push(Buffer.from('34Rtail\x03'));
    expect(h.text()).toBe('中文tail\x03');
    expect(h.input.push).toBe(original);
    expect(report.active).toBe(false);
    h.input.destroy();
  });
  it('filters a completely late, fragmented report for whichever data owner is current', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    const report = deferCursorReport(h.input);
    h.input.push(Buffer.from('\x1b'));
    h.input.push(Buffer.from('[?12;'));
    h.input.push(Buffer.from('34RKEEP_DRAFT'));
    expect(h.text()).toBe('KEEP_DRAFT');
    expect(report.active).toBe(false);
    h.input.destroy();
  });
  it('keeps a delayed report prefix while a genuine enhanced ESC passes immediately', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    vi.useFakeTimers();
    const original = h.input.push;
    const report = deferCursorReport(h.input);
    h.input.push(Buffer.from('\x1b'));
    expect(h.text()).toBe('');
    vi.advanceTimersByTime(650);
    expect(h.text()).toBe('');
    h.input.push(Buffer.from('\x1b[27u'));
    expect(h.text()).toBe('\x1b');
    h.input.push(Buffer.from('[?12;34R'));
    expect(h.text()).toBe('\x1b');
    expect(report.active).toBe(false);
    expect(h.input.push).toBe(original);
    h.input.destroy();
  });
  it('preserves function keys, arrows and split UTF-8 while awaiting a report', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    const report = deferCursorReport(h.input);
    const bytes = Buffer.from('中文\x1b[1;2R\x1b[A');
    h.input.push(bytes.subarray(0, 2)); h.input.push(bytes.subarray(2));
    h.input.push(Buffer.from('\x1b[?17;1R'));
    expect(Buffer.concat(h.chunks)).toEqual(bytes);
    expect(report.active).toBe(false);
    h.input.destroy();
  });
  it('returns an unconfirmed ordinary prefix on explicit cancellation or EOF', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    const report = deferCursorReport(h.input);
    h.input.push(Buffer.from('\x1b'));
    report.cancel();
    expect(h.text()).toBe('\x1b');
    const next = deferCursorReport(h.input);
    h.input.push(Buffer.from('\x1b[')); h.input.push(null);
    expect(h.text()).toBe('\x1b\x1b[');
    expect(next.active).toBe(false);
    h.input.destroy();
  });
  it('keeps existing buffered input before bytes replayed from the raw TTY', async () => {
    const input = new Readable({ read() {} });
    input.push(Buffer.from('EARLIER'));
    const report = deferCursorReport(input);
    report.replay(Buffer.from('LATER\x1b[?12;'));
    const chunks: Buffer[] = [];
    input.on('data', chunk => chunks.push(Buffer.from(chunk)));
    input.push(Buffer.from('34RTAIL'));
    await new Promise(resolve => setImmediate(resolve));
    expect(Buffer.concat(chunks).toString()).toBe('EARLIERLATERTAIL');
    input.destroy();
  });
  it('retains confirmed report state beyond a deadline, then releases its hook on completion/EOF', async () => {
    const h = inputHarness(); await new Promise(resolve => setImmediate(resolve));
    vi.useFakeTimers();
    const original = h.input.push;
    const report = deferCursorReport(h.input);
    h.input.push(Buffer.from('draft\x1b[?12;'));
    vi.advanceTimersByTime(500);
    expect(h.text()).toBe('draft');
    expect(report.active).toBe(true);
    h.input.push(Buffer.from('34Rtail'));
    expect(h.text()).toBe('drafttail');
    expect(h.input.push).toBe(original);
    expect(report.active).toBe(false);
    const next = deferCursorReport(h.input);
    h.input.push(null);
    expect(next.active).toBe(false);
    expect(h.input.push).toBe(original);
    h.input.destroy();
  });
});
