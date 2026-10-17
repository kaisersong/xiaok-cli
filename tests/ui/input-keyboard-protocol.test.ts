import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputReader } from '../../src/ui/input.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { createTtyHarness } from '../support/tty.js';

const PUSH = '\x1b[>1u';
const POP = '\x1b[<u';
const originalOutputTty = process.stdout.isTTY;
beforeEach(() => { process.stdout.isTTY = true; });
afterEach(() => { process.stdout.isTTY = originalOutputTty; vi.restoreAllMocks(); });
const count = (text: string, sequence: string) => text.split(sequence).length - 1;

describe('InputReader enhanced keyboard ownership', () => {
  it('requests disambiguation while reading and restores it on submit', async () => {
    const h = createTtyHarness();
    const abort = new AbortController();
    const pending = new InputReader().read('> ', { signal: abort.signal });
    try {
      expect(count(h.output.raw, PUSH)).toBe(1);
      h.send('first'); h.send('\x1b[13;2u'); h.send('second'); h.send('\r');
      expect(await pending).toBe('first\nsecond');
      expect(count(h.output.raw, POP)).toBe(1);
    } finally { abort.abort(); await pending; h.restore(); }
  });

  it('pops for an external process, reacquires once on resume, and keeps the draft', async () => {
    const h = createTtyHarness();
    const abort = new AbortController();
    const reader = new InputReader();
    const pending = reader.read('> ', { signal: abort.signal });
    try {
      h.send('draft');
      const first = reader.suspendForExternalProcess();
      const nested = reader.suspendForExternalProcess();
      expect(count(h.output.raw, POP)).toBe(1);
      first.resume(); expect(count(h.output.raw, PUSH)).toBe(1);
      nested.resume(); nested.resume(); expect(count(h.output.raw, PUSH)).toBe(2);
      h.send('\x1b[13;2u'); h.send('next'); h.send('\r');
      expect(await pending).toBe('draft\nnext');
      expect(count(h.output.raw, POP)).toBe(2);
    } finally { abort.abort(); await pending; h.restore(); }
  });

  it('balances abort while suspended and does not reacquire a finished reader', async () => {
    const h = createTtyHarness();
    const abort = new AbortController();
    const reader = new InputReader();
    const pending = reader.read('> ', { signal: abort.signal });
    try {
      const external = reader.suspendForExternalProcess();
      abort.abort(); external.resume();
      expect(await pending).toBeNull();
      expect(count(h.output.raw, PUSH)).toBe(1);
      expect(count(h.output.raw, POP)).toBe(1);
    } finally { abort.abort(); await pending; h.restore(); }
  });

  it('balances busy capture pause/resume, read handoff and repeated stop', async () => {
    const h = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const capture = reader.startBusyCapture();
    const abort = new AbortController();
    try {
      h.send('first'); h.send('\x1b[13;2u'); h.send('second');
      expect(capture.getSnapshot().draft).toBe('first\nsecond');
      capture.pause(); capture.pause();
      expect(count(h.output.raw, POP)).toBe(1);
      capture.resume(); capture.resume();
      expect(count(h.output.raw, PUSH)).toBe(2);
      const pending = reader.read('> ', { signal: abort.signal });
      h.send('next'); h.send('\r'); expect(await pending).toBe('next');
      capture.stop(); capture.stop();
      expect(count(h.output.raw, PUSH)).toBe(3);
      expect(count(h.output.raw, POP)).toBe(3);
    } finally { abort.abort(); capture.stop(); h.restore(); }
  });

  it('does not emit keyboard protocol requests to redirected stdout', async () => {
    const h = createTtyHarness();
    process.stdout.isTTY = false;
    const pending = new InputReader().read('> ');
    h.send('plain'); h.send('\r');
    expect(await pending).toBe('plain');
    expect(h.output.raw).not.toContain(PUSH);
    expect(h.output.raw).not.toContain(POP);
    h.restore();
  });
});

describe('CSI-u equivalents use existing input actions', () => {
  it('keeps Ctrl+J, Ctrl+A, Backspace and Shift+Tab working', async () => {
    const h = createTtyHarness();
    const abort = new AbortController();
    const reader = new InputReader();
    const cycle = vi.fn(() => 'default' as const);
    reader.setModeCycleHandler(cycle);
    const pending = reader.read('> ', { signal: abort.signal });
    try {
      h.send('ab'); h.send('\x1b[97;5u'); h.send('X');
      h.send('\x1b[127u'); h.send('\x1b[101;5u');
      h.send('\x1b[106;5u'); h.send('next'); h.send('\x1b[9;2u'); h.send('\r');
      expect(await pending).toBe('ab\nnext');
      expect(cycle).toHaveBeenCalledOnce();
    } finally { abort.abort(); await pending; h.restore(); }
  });

  it.each(['read', 'busy'] as const)('routes encoded Ctrl+C to the interrupt owner (%s)', async mode => {
    const h = createTtyHarness();
    const abort = new AbortController();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const interrupt = vi.fn(); reader.setInterruptHandler(interrupt);
    const pending = mode === 'read' ? reader.read('> ', { signal: abort.signal }) : undefined;
    const capture = mode === 'busy' ? reader.startBusyCapture() : undefined;
    try {
      h.send('\x1b[99;5u'); expect(interrupt).toHaveBeenCalledOnce();
      h.send('draft');
      if (capture) expect(capture.getSnapshot().draft).toBe('draft');
    } finally { abort.abort(); await pending; capture?.stop(); h.restore(); }
  });
});


describe('mode change persistence failure', () => {
  it('keeps the draft and does not claim a rejected mode switch succeeded', async () => {
    const h = createTtyHarness();
    const reader = new InputReader();
    const cycle = vi.fn(() => null);
    reader.setModeCycleHandler(cycle);
    const abort = new AbortController();
    const pending = reader.read('> ', { signal: abort.signal });
    try {
      h.send('draft'); h.send('\x1b[Z');
      expect(cycle).toHaveBeenCalledOnce();
      expect(h.output.normalized).not.toContain('权限模式已切换为');
      h.send('next\r'); expect(await pending).toBe('draftnext');
    } finally { abort.abort(); await pending; h.restore(); }
  });
});
