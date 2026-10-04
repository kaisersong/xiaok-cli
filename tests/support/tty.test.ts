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

  it('optionally captures stderr writes into the same terminal replay', () => {
    harness = createTtyHarness(40, 4, { captureStderr: true });

    process.stdout.write('stdout');
    process.stderr.write('\r\x1b[2Kstderr');

    expect(harness.screen.lines()[0]).toBe('stderr');
  });

  it('models margin-contained graphics scrolling and leaves straddling placements stationary', () => {
    harness = createTtyHarness(40, 8);
    process.stdout.write('\x1b[1;5r\x1b[3;1H\x1b_Ga=T,C=1,i=1,c=2,r=2;QQ==\x1b\\');
    process.stdout.write('\x1b[5;1H\x1b_Ga=T,C=1,i=2,c=2,r=3;QQ==\x1b\\\n');
    expect(harness.screen.images()).toEqual([
      { id: 1, row: 2, column: 1, rows: 2, cols: 2 },
      { id: 2, row: 5, column: 1, rows: 3, cols: 2 },
    ]);
  });

  it('creates one placement only after the final Kitty chunk', () => {
    harness = createTtyHarness(40, 8);
    process.stdout.write('\x1b_Ga=T,C=1,i=3,c=2,r=2,m=1;QQ==\x1b\\');
    expect(harness.screen.images()).toEqual([]);
    process.stdout.write('\x1b_Gm=0;Qg==\x1b\\');
    expect(harness.screen.images()).toHaveLength(1);
  });
});
