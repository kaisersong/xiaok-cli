import { afterEach, describe, expect, it } from 'vitest';
import { createTtyHarness } from './tty.js';

describe('tty harness replay', () => {
  let harness: ReturnType<typeof createTtyHarness> | null = null;

  afterEach(() => {
    harness?.restore();
    harness = null;
  });

  it('replays absolute cursor positioning with row and column params', () => {
    harness = createTtyHarness(40, 4);

    process.stdout.write('top');
    process.stdout.write('\x1b[4;1Hbottom');

    expect(harness.screen.lines()[0]).toBe('top');
    expect(harness.screen.lines()[3]).toBe('bottom');
  });

  it('replays horizontal absolute cursor moves on the current row', () => {
    harness = createTtyHarness(40, 4);

    process.stdout.write('abcd');
    process.stdout.write('\x1b[2GZ');

    expect(harness.screen.lines()[0]).toBe('aZcd');
  });

  it('replays scroll regions so footer rows stay fixed while content scrolls', () => {
    harness = createTtyHarness(20, 6);

    process.stdout.write('\x1b[1;4r');
    process.stdout.write('\x1b[5;1Hfooter');
    process.stdout.write('\x1b[1;1H');

    for (let index = 1; index <= 6; index += 1) {
      process.stdout.write(`line ${index}\n`);
    }

    const lines = harness.screen.lines();
    expect(lines[0]).toContain('line 4');
    expect(lines[1]).toContain('line 5');
    expect(lines[2]).toContain('line 6');
    expect(lines[4]).toContain('footer');
  });
});
