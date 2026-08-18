import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { setColorsEnabled } from '../../src/ui/render.js';
import { writeAssistantTextChunkInOrder } from '../../src/commands/chat/assistant-streaming.js';
import { ensureStreamingPhaseInOrder } from '../../src/commands/chat/terminal-streaming-boundary.js';

/**
 * Expectations here are derived from the captured stdout byte stream, never from
 * a second copy of the wrap/width logic under test. Corpora are ASCII-only where
 * a width is asserted, so visible width equals character count and no width
 * table is needed.
 *
 * Out of scope by design (see the design doc): terminal resize during streaming.
 */

const ESC_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ABSOLUTE_POSITION = /\x1b\[[0-9]*(;[0-9]*)?[Hf]|\x1b\[[0-9]*G|\r/;

function visibleText(raw: string): string {
  return raw.replace(ESC_SEQUENCE, '');
}

/** Rows the terminal advances for the byte stream, counting only real newlines. */
function newlineCount(raw: string): number {
  return visibleText(raw).split('\n').length - 1;
}

/**
 * Columns occupied on the final line of the byte stream. Both CR and LF reset
 * the column; control characters occupy none. Corpora are ASCII so each
 * printable character is one column.
 */
function trailingColumns(raw: string): number {
  let columns = 0;
  for (const char of visibleText(raw)) {
    if (char === '\n' || char === '\r') {
      columns = 0;
      continue;
    }
    if (char < ' ') continue;
    columns += 1;
  }
  return columns;
}

/**
 * B3: once a non-blank character has been written on the current line, the
 * stream must not jump backwards (CR / CHA / CUP) and write more non-blank
 * characters onto it. That byte-level signature is exactly the "each chunk
 * overwrites the previous one from column 0" bug.
 */
function findBackwardOverwrite(raw: string): string | null {
  let index = 0;
  let wroteOnLine = false;
  let repositioned: string | null = null;

  while (index < raw.length) {
    if (raw[index] === '\x1b' || raw[index] === '\r') {
      ESC_SEQUENCE.lastIndex = 0;
      const tail = raw.slice(index);
      const match = raw[index] === '\r' ? ['\r'] : tail.match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      const token = match ? match[0] : raw[index];
      if (ABSOLUTE_POSITION.test(token) && wroteOnLine) {
        repositioned = token;
      }
      index += token.length;
      continue;
    }

    const char = raw[index];
    if (char === '\n') {
      wroteOnLine = false;
      repositioned = null;
      index += 1;
      continue;
    }

    if (char.trim() !== '') {
      if (repositioned) {
        return `${JSON.stringify(repositioned)} before writing ${JSON.stringify(char)}`;
      }
      wroteOnLine = true;
    }
    index += 1;
  }

  return null;
}

interface Harness {
  scrollRegion: ScrollRegionManager;
  md: MarkdownRenderer;
  writeChunk(delta: string): void;
  flush(): void;
  captured(): string;
  resetCapture(): void;
  cursorRow(): number;
  cursorCol(): number;
  scrollBottom(): number;
}

function createHarness(cols: number, rows: number): Harness {
  let raw = '';
  const stream = {
    columns: cols,
    rows,
    write: (chunk: string) => {
      raw += chunk;
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  const scrollRegion = new ScrollRegionManager(stream);
  const md = new MarkdownRenderer();
  const internals = scrollRegion as unknown as {
    _cursorRow: number;
    _cursorCol: number;
    getScrollBottom(): number;
  };

  process.stdout.columns = cols;
  process.stdout.write = ((chunk: any) => {
    raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;

  scrollRegion.begin();
  scrollRegion.writeAtContentCursor('history line\n');

  const phaseDeps = {
    scrollRegion,
    runtimeState: { enterStreamingContent: () => {} },
    turnLayout: { consumeAssistantLeadIn: () => '' },
    mdRenderer: md,
    stopLiveActivityTimer: () => {},
    writeFallback: (text: string) => {
      raw += text;
    },
  };

  return {
    scrollRegion,
    md,
    writeChunk(delta: string) {
      writeAssistantTextChunkInOrder(delta, {
        noteVisibleAssistantText: () => {},
        appendAssistantText: () => {},
        noteResponseStarted: () => {},
        appendStreamingSegment: () => {},
        ensureStreamingPhase: () => ensureStreamingPhaseInOrder(phaseDeps),
        writeMarkdown: (text) => md.write(text),
      });
    },
    flush() {
      md.flush();
    },
    captured: () => raw,
    resetCapture: () => {
      raw = '';
    },
    cursorRow: () => internals._cursorRow,
    cursorCol: () => internals._cursorCol,
    scrollBottom: () => internals.getScrollBottom(),
  };
}

function streamInChunks(harness: Harness, text: string, sizes = [1, 3, 2, 5, 1, 4]): void {
  let index = 0;
  let step = 0;
  while (index < text.length) {
    const size = sizes[step % sizes.length];
    harness.writeChunk(text.slice(index, index + size));
    index += size;
    step += 1;
  }
}

describe('streaming render fidelity', () => {
  let originalWrite: typeof process.stdout.write;
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    setColorsEnabled(false);
    originalWrite = process.stdout.write;
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.stdout.columns = originalColumns as number;
    process.stdout.rows = originalRows as number;
    setColorsEnabled(false);
  });

  it('B3: never repositions backwards into a line it already wrote', () => {
    const harness = createHarness(60, 24);
    harness.resetCapture();

    streamInChunks(harness, 'the quick brown fox jumps over the lazy dog and keeps running well past the wrap point\n');
    harness.flush();

    expect(findBackwardOverwrite(harness.captured())).toBeNull();
  });

  it('B2: cursor row accounting matches the newlines actually written', () => {
    const harness = createHarness(60, 24);
    const before = harness.cursorRow();
    harness.resetCapture();

    streamInChunks(harness, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho\n');
    harness.flush();

    const expected = Math.min(
      before + newlineCount(harness.captured()),
      harness.scrollBottom(),
    );
    expect(harness.cursorRow()).toBe(expected);
  });

  it('B1: cursor column after flush matches the trailing columns actually written', () => {
    const harness = createHarness(60, 24);
    harness.resetCapture();

    streamInChunks(harness, 'a partial tail line with no trailing newline');
    harness.flush();

    expect(harness.cursorCol()).toBe(trailingColumns(harness.captured()));
  });

  it('B7: accounting survives two flushes plus a continuation inside one phase', () => {
    const harness = createHarness(60, 24);
    harness.resetCapture();

    streamInChunks(harness, 'first paragraph of the answer that wraps across more than a single row\n');
    harness.flush();
    streamInChunks(harness, 'continuation written after the flush without ending the phase\n');
    harness.flush();

    const raw = harness.captured();
    expect(findBackwardOverwrite(raw)).toBeNull();
    expect(harness.cursorCol()).toBe(trailingColumns(raw));
  });

  it('B8: accounting survives repeated scroll region scrolling', () => {
    const harness = createHarness(44, 14);
    harness.resetCapture();

    for (let paragraph = 0; paragraph < 12; paragraph += 1) {
      streamInChunks(
        harness,
        `paragraph ${paragraph} of the streamed answer that is long enough to wrap onto several rows\n`,
      );
      harness.flush();
    }

    const raw = harness.captured();
    expect(newlineCount(raw)).toBeGreaterThan(14);
    expect(findBackwardOverwrite(raw)).toBeNull();
    expect(harness.cursorRow()).toBe(harness.scrollBottom());
  });

  it('B1/B2: a wrapped line advances one row per rendered row, not one per logical line', () => {
    const harness = createHarness(40, 24);
    const before = harness.cursorRow();
    harness.resetCapture();

    streamInChunks(harness, 'this single logical line is long enough that the renderer wraps it onto at least three separate rendered rows\n');
    harness.flush();

    const rowsWritten = newlineCount(harness.captured());
    expect(rowsWritten).toBeGreaterThan(1);
    expect(harness.cursorRow()).toBe(Math.min(before + rowsWritten, harness.scrollBottom()));
  });

  it('rebases the stream anchor when the region scrolls, so a later sync stays correct', () => {
    const harness = createHarness(44, 14);
    const internals = harness.scrollRegion as unknown as { _streamStartRow: number };

    // The anchor is recorded when the first chunk opens the streaming phase.
    streamInChunks(harness, 'row 0 of a streamed answer long enough to wrap\n');
    harness.flush();
    const anchorAtStart = internals._streamStartRow;
    expect(anchorAtStart).toBeGreaterThan(1);

    for (let paragraph = 1; paragraph < 10; paragraph += 1) {
      streamInChunks(harness, `row ${paragraph} of a streamed answer long enough to wrap\n`);
      harness.flush();
    }

    // The region scrolled, so the absolute anchor must have moved up with the
    // content instead of staying put.
    expect(internals._streamStartRow).toBeLessThan(anchorAtStart);

    harness.scrollRegion.syncContentCursorFromRenderedLines(['tail']);
    expect(harness.cursorRow()).toBeLessThanOrEqual(harness.scrollBottom());
  });

  it('syncs with deferred-wrap semantics: a full row does not wrap until one more column is needed', () => {
    const harness = createHarness(20, 24);

    harness.scrollRegion.syncContentCursorFromRenderedLines(['x'.repeat(20)]);
    const rowAfterExactFit = harness.cursorRow();
    expect(harness.cursorCol()).toBe(20);

    harness.scrollRegion.syncContentCursorFromRenderedLines(['x'.repeat(21)]);
    expect(harness.cursorRow()).toBe(rowAfterExactFit + 1);
    expect(harness.cursorCol()).toBe(1);
  });

  it('syncs a full-width glyph onto the next row instead of straddling the margin', () => {
    const harness = createHarness(20, 24);

    // 19 columns used, so the 2-column glyph cannot fit in the last column.
    harness.scrollRegion.syncContentCursorFromRenderedLines([`${'x'.repeat(19)}中`]);

    expect(harness.cursorCol()).toBe(2);
  });
});
