import { afterEach, describe, expect, it } from 'vitest';
import { canMeasureTerminalCursor, normalizeEnhancedKeys, retainKeyboardProtocol } from '../../src/ui/keyboard-protocol.js';
import { createTtyHarness } from '../support/tty.js';

const outputTty = process.stdout.isTTY;
afterEach(() => { process.stdout.isTTY = outputTty; });

describe('keyboard protocol boundaries', () => {
  it('balances nested owners with one push/pop and idempotent release', () => {
    const h = createTtyHarness(); process.stdout.isTTY = true;
    const first = retainKeyboardProtocol(), second = retainKeyboardProtocol();
    try {
      expect(h.output.raw).toBe('\x1b[>1u');
      first(); first(); expect(h.output.raw).toBe('\x1b[>1u');
      second(); second(); expect(h.output.raw).toBe('\x1b[>1u\x1b[<u');
    } finally { first(); second(); h.restore(); }
  });

  it('does not negotiate when stdin is redirected', () => {
    const h = createTtyHarness(); process.stdout.isTTY = true; process.stdin.isTTY = false;
    try { retainKeyboardProtocol()(); expect(h.output.raw).toBe(''); }
    finally { h.restore(); }
  });

  it('requires a real disambiguated ESC and a current keyboard owner before cursor queries', () => {
    const h = createTtyHarness(); process.stdout.isTTY = true;
    const release = retainKeyboardProtocol();
    try {
      expect(canMeasureTerminalCursor()).toBe(false);
      normalizeEnhancedKeys(Buffer.from('\x1b[13u\x1b[120;9u'));
      expect(canMeasureTerminalCursor()).toBe(false);
      expect(normalizeEnhancedKeys(Buffer.from('\x1b')).toString()).toBe('\x1b');
      expect(canMeasureTerminalCursor()).toBe(false);
      normalizeEnhancedKeys(Buffer.from('\x1b[27u'));
      expect(canMeasureTerminalCursor()).toBe(true);
      release(); expect(canMeasureTerminalCursor()).toBe(false);
    } finally { release(); h.restore(); }
  });

  it.each([
    ['\x1b[27u', '\x1b'],
    ['\x1b[9u', '\t'],
    ['\x1b[13u', '\r'],
    ['\x1b[127u', '\x7f'],
    ['\x1b[9;2u', '\x1b[Z'],
    ['\x1b[118;5u', '\x16'],
    ['\x1b[111;5u', '\x0f'],
    ['\x1b[114;5u', '\x12'],
  ])('normalizes existing control action %j', (sequence, expected) => {
    expect(normalizeEnhancedKeys(Buffer.from(sequence)).toString()).toBe(expected);
  });

  it('preserves Shift+Enter, unknown chords, releases, text and split UTF-8 bytes', () => {
    const input = Buffer.concat([Buffer.from('\x1b[13;2u\x1b[13;2:3u\x1b[120;9u中文'), Buffer.from([0xe4, 0xbd])]);
    expect(normalizeEnhancedKeys(input)).toEqual(input);
  });
});
