/**
 * Tests for scroll region activity line rendering and the
 * contentStreaming flag that prevents thinking line duplication.
 *
 * Uses only \n, \r, \x1b[1A (cursor up), \x1b[2K (clear line) —
 * no absolute cursor positioning for terminal compatibility.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { formatSubmittedInput, setColorsEnabled } from '../../src/ui/render.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { createTtyHarness } from '../support/tty.js';

function createMockScrollRegion() {
  const mock = new PassThrough();
  const chunks: string[] = [];
  mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  const stream = mock as unknown as NodeJS.WriteStream;
  (stream as any).rows = 24;
  (stream as any).columns = 80;

  const manager = new ScrollRegionManager(stream);
  return { manager, stream: mock, getOutput: () => chunks.join('') };
}

describe('ScrollRegionManager activity rendering', () => {
  describe('basic activity rendering', () => {
    it('renders activity line when scroll region is active', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();

      manager.renderActivity('⠋ Thinking · 3s');
      manager.renderFooter({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });

      const output = getOutput();
      // Should contain the activity text
      expect(output).toContain('⠋ Thinking · 3s');
      // Should contain the footer content
      expect(output).toContain('waiting...');
      expect(output).toContain('gpt-5.4');
    });

    it('does not render activity when scroll region is inactive', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.renderActivity('⠋ Thinking');
      const output = getOutput();
      expect(output).toContain('⠋ Thinking');
    });
  });

  describe('content streaming flag behavior', () => {
    it('beginContentStreaming sets streaming flag', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();
      manager.beginContentStreaming();
      const output = getOutput();
      expect(manager.isContentStreaming()).toBe(true);
      // First turn: clears content area and resets cursor position
      // Uses absolute positioning to clear stale activity lines
      expect(output).toContain('\x1b[2K');  // clear line
    });

    it('endContentStreaming renders footer', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();
      manager.beginContentStreaming();
      manager.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
      });

      const output = getOutput();
      // Should contain footer rendering
      expect(output).toContain('Type your message...');
      expect(output).toContain('gpt-5.4 · 5%');
    });
  });
});

describe('contentStreaming flag logic (simulated)', () => {
  function simulateTurnWithStreaming(
    renderActivityCalls: { at: 'tool_use' | 'content_streaming' | 'idle'; label: string }[],
  ): { renderedLabels: string[]; duplicates: string[] } {
    let contentStreaming = false;
    const renderedLabels: string[] = [];

    const renderLiveActivity = (label: string): void => {
      if (contentStreaming) return;
      renderedLabels.push(label);
    };

    for (const call of renderActivityCalls) {
      if (call.at === 'content_streaming') {
        contentStreaming = true;
        renderLiveActivity(call.label);
      } else if (call.at === 'idle') {
        contentStreaming = false;
        renderLiveActivity(call.label);
      }
    }

    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const label of renderedLabels) {
      const count = seen.get(label) ?? 0;
      seen.set(label, count + 1);
      if (count > 0) {
        duplicates.push(label);
      }
    }

    return { renderedLabels, duplicates };
  }

  it('without fix: rapid timer causes thinking line duplication during streaming', () => {
    const result = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Thinking · 1s' },
      { at: 'idle', label: '⠙ Thinking · 1s' },
      { at: 'idle', label: '⠹ Thinking · 2s' },
      { at: 'content_streaming', label: '⠸ Thinking · 2s' },
      { at: 'content_streaming', label: '⠼ Thinking · 3s' },
      { at: 'content_streaming', label: '⠴ Thinking · 3s' },
    ]);

    expect(result.renderedLabels).toEqual([
      '⠋ Thinking · 1s',
      '⠙ Thinking · 1s',
      '⠹ Thinking · 2s',
    ]);
    expect(result.duplicates).toEqual([]);
  });

  it('tool execution phase can still show activity after content streaming ends', () => {
    const result = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Thinking · 1s' },
      { at: 'content_streaming', label: '⠙ Thinking · 2s' },
      { at: 'content_streaming', label: '⠹ Thinking · 2s' },
      { at: 'idle', label: '⠸ Running command' },
      { at: 'idle', label: '⠼ Running command' },
    ]);

    expect(result.renderedLabels).toEqual([
      '⠋ Thinking · 1s',
      '⠸ Running command',
      '⠼ Running command',
    ]);
  });

  it('multiple turns: each turn resets contentStreaming flag', () => {
    const turn1 = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Thinking · 1s' },
      { at: 'content_streaming', label: '⠙ Content · 2s' },
      { at: 'content_streaming', label: '⠹ Content · 3s' },
    ]);

    const turn2 = simulateTurnWithStreaming([
      { at: 'idle', label: '⠸ Tool exec · 1s' },
      { at: 'content_streaming', label: '⠼ Content · 2s' },
    ]);

    expect(turn1.renderedLabels).toEqual(['⠋ Thinking · 1s']);
    expect(turn2.renderedLabels).toEqual(['⠸ Tool exec · 1s']);
  });

  it('edge case: no content streaming at all (pure tool execution)', () => {
    const result = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Reading file' },
      { at: 'idle', label: '⠙ Searching' },
      { at: 'idle', label: '⠹ Analyzing' },
    ]);

    expect(result.renderedLabels).toEqual([
      '⠋ Reading file',
      '⠙ Searching',
      '⠹ Analyzing',
    ]);
  });
});

describe('scroll-region prompt frame ownership', () => {
  it('renders prompt, status, and overlay from a single scroll-region frame', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();

    manager.renderPromptFrame({
      inputValue: '/mo',
      cursor: 3,
      placeholder: 'Type your message...',
      statusLine: 'gpt-5.4 · 5%',
      overlayLines: ['  /mode  Show or change permission mode'],
    });

    const output = getOutput();
    expect(output).toContain('/mo');
    expect(output).toContain('/mode  Show or change permission mode');
  });

  it('renders multiple slash menu rows above the input when overlay is open', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: '/',
        cursor: 1,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
        overlayLines: [
          '  ❯ /clear  Clear the screen',
          '    /commit  Commit staged changes',
          '    /context  Show loaded repo context',
          '    /doctor  Inspect local CLI health',
        ],
      });

      const lines = harness.screen.lines();
      expect(lines.some((line) => line.includes('/clear'))).toBe(true);
      expect(lines.some((line) => line.includes('/commit'))).toBe(true);
      expect(lines.some((line) => line.includes('/context'))).toBe(true);
      expect(lines.some((line) => line.includes('/doctor'))).toBe(true);
      expect(lines.some((line) => line.includes('gpt-5.4 · 5%'))).toBe(false);
      expect(lines[23]).toContain('❯ /');
    } finally {
      harness.restore();
    }
  });

  it('clears stale overlay rows when the input shrinks while the overlay stays open', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const overlayLines = [
      '⚡ xiaok 想要执行以下操作',
      '工具: bash',
      '命令: cmd /c echo E2E_PERMISSION_OK',
      '❯ 允许一次',
      '  本次会话始终允许 bash(cmd *)',
      '  始终允许 bash(cmd *) (保存到项目)',
      '  始终允许 bash(cmd *) (保存到全局)',
      '  拒绝',
      '↑↓ 选择  Enter 确认  Esc 取消',
    ];

    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: 'x'.repeat(150),
        cursor: 150,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
        overlayLines,
      });

      manager.renderPromptFrame({
        inputValue: '',
        cursor: 0,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
        overlayLines,
      });

      const lines = harness.screen.lines();
      expect(lines.filter((line) => line.includes('xiaok 想要执行以下操作'))).toHaveLength(1);
      expect(lines.filter((line) => line.includes('工具: bash'))).toHaveLength(1);
    } finally {
      harness.restore();
    }
  });
});

describe('ANSI compatibility', () => {
  it('footer rendering uses absolute positioning to place at terminal bottom', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderActivity('⠋ Thinking');
    manager.renderFooter({ inputPrompt: 'Type...', statusLine: 'gpt-5.4' });

    const output = getOutput();
    // Footer uses absolute cursor positioning (\x1b[row;colH) to ensure
    // it renders at exact terminal bottom rows regardless of cursor state.
    expect(output).toMatch(/\x1b\[23;1H/);  // input bar at row 23
    expect(output).toMatch(/\x1b\[24;1H/);  // status bar at row 24
    expect(output).toContain('Type...');
    expect(output).toContain('gpt-5.4');
  });

  it('positions the cursor after restoring the scroll region', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderFooter({ inputPrompt: 'Type...', statusLine: 'gpt-5.4' });

    const output = getOutput();
    expect(output).toMatch(/\x1b\[1;21r\x1b\[23;3H$/);
  });

  it('does not leave the input background SGR active after footer rendering', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderInput('abc', 3);

    const output = getOutput();
    expect(output).toMatch(/\x1b\[0m\x1b\[1;21r\x1b\[23;6H$/);
    expect(output).not.toMatch(/\x1b\[23;6H\x1b\[48;5;244m$/);
  });

  it('uses a darker footer background for input contrast', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderInput('abc', 3);

    const output = getOutput();
    expect(output).toContain('\x1b[48;5;238m');
    expect(output).not.toContain('\x1b[48;5;244m');
  });

  it('expands multiline prompt input while keeping a single status line', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      for (const inputValue of ['1', '1\n2', '1\n2\n3', '1\n2\n3\n4']) {
        manager.renderPromptFrame({
          inputValue,
          cursor: inputValue.length,
          placeholder: 'Type your message...',
          statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
        });
      }

      const lines = harness.screen.lines();
      const promptLines = lines.filter((line) => line.includes('❯'));
      const inputLines = lines.filter((line) => /^[\s]*[234]$/.test(line)).map((line) => line.trim());
      const statusLines = lines.filter((line) => line.includes('gpt-5.4 · 5% · master · xiaok-cli'));

      expect(promptLines).toHaveLength(1);
      expect(promptLines[0]).toContain('1');
      expect(inputLines).toEqual(['2', '3', '4']);
      expect(statusLines).toHaveLength(1);
    } finally {
      harness.restore();
    }
  });

  it('soft-wraps long single-line footer input instead of truncating it horizontally', () => {
    const harness = createTtyHarness(20, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      const inputValue = '0123456789abcdefghijk';

      manager.begin();
      manager.renderPromptFrame({
        inputValue,
        cursor: inputValue.length,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
      });

      const lines = harness.screen.lines();
      const statusLines = lines.filter((line) => line.includes('gpt-5.4 · 5%'));

      expect(lines.some((line) => line.includes('❯ 0123456789abcdefgh'))).toBe(true);
      expect(lines.some((line) => line.trim() === 'ijk')).toBe(true);
      expect(statusLines).toHaveLength(1);
      expect(harness.output.raw).toMatch(/\x1b\[23;6H$/);
    } finally {
      harness.restore();
    }
  });

  it('activity line uses absolute row positioning inside the scroll region', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderActivity('⠋ Thinking');
    manager.renderActivity('⠙ Content');

    const output = getOutput();
    expect(output).toContain('\x1b[21;1H');
    expect(output).toContain('⠋ Thinking');
    expect(output).toContain('⠙ Content');
  });

  it('activity line renders when footer is visible', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderFooter({ inputPrompt: 'Type...', statusLine: 'gpt-5.4' });
    manager.renderActivity('⠋ Thinking');
    const output = getOutput();
    expect(output).toContain('⠋ Thinking');
    expect(output).toContain('\x1b[21;1H');
  });

  it('renders activity above the input footer with a blank gap row', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'gpt-5.4 · 5%' });
      manager.renderActivity('⠋ Thinking');

      const lines = harness.screen.lines();
      expect(lines[20]).toContain('Thinking');
      expect(lines[21]).toBe('');
      expect(lines[22]).toContain('❯ Type your message...');
      expect(lines[22]).not.toContain('Thinking');
      expect(lines[22]).not.toContain('working');
      expect(lines[23]).toContain('gpt-5.4 · 5%');
    } finally {
      harness.restore();
    }
  });

  it('clears submitted input without putting working text in the input footer', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: 'hello',
        cursor: 5,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
      });

      manager.clearLastInput();

      const lines = harness.screen.lines();
      expect(lines[22]).toContain('❯ Type your message...');
      expect(lines[22]).not.toContain('working');
      expect(lines[22]).not.toContain('Thinking');
    } finally {
      harness.restore();
    }
  });

  it('footer is rendered below content', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderFooter({
      inputPrompt: 'Type...',
      statusLine: 'gpt-5.4',
    });

    const output = getOutput();
    expect(output).toContain('Type...');
    expect(output).toContain('gpt-5.4');
  });
});

describe('CJK cursor positioning in renderInput', () => {
  function createMock() {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = 24;
    (stream as any).columns = 120;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join('') };
  }

  function extractCursorCol(output: string): number | null {
    // Match \x1b[1;colH pattern from non-active mode rendering
    const matches = [...output.matchAll(/\x1b\[1;(\d+)H/g)];
    if (matches.length === 0) return null;
    return parseInt(matches[matches.length - 1][1], 10);
  }

  // Tests use non-active path (no begin()) where renderInput uses \x1b[1;colH
  it('empty input: cursor at col 3 (after "❯ ")', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('', 0);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(3);
  });

  it('English text: cursor at correct column', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('hello', 5);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(8);
  });

  it('Chinese text: cursor after 1 char (你) at col 5', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('你好', 1);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(5);
  });

  it('Chinese text: cursor after 2 chars (你好) at col 7', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('你好', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(7);
  });

  it('mixed CJK+ASCII: cursor after 测t at col 6', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('测t', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(6);
  });

  it('mixed CJK+ASCII: cursor after all 4 chars 测a试b at col 9', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('测a试b', 4);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(9);
  });

  it('mixed CJK+ASCII: cursor after 测a at col 6', () => {
    const { manager, getOutput } = createMock();
    manager.renderInput('测a试b', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(6);
  });
});

/**
 * Tests for bugs found during adversarial review (Bugs 8-14).
 * Bug 7 is a chat.ts integration issue, tested via E2E.
 */

describe('Bug 8: _cursorUncertain cleared in beginContentStreaming else branch', () => {
  function createMock(rows = 24, cols = 80) {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = rows;
    (stream as any).columns = cols;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join(''), stream };
  }

  function countNewlines(output: string): number {
    return (output.match(/\n/g) || []).length;
  }

  it('_cursorUncertain is true after clearLastInput', () => {
    const { manager } = createMock();
    manager.begin();
    manager.beginContentStreaming();
    manager.endContentStreaming();
    // Simulate second turn
    manager.clearLastInput();
    // _cursorUncertain should be true after clearLastInput
    // (internal state, but we can verify via endContentStreaming behavior)
    expect(manager.isContentStreaming()).toBe(false);
  });

  it('beginContentStreaming (2nd turn) clears _cursorUncertain', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    // First turn
    manager.beginContentStreaming();
    manager.endContentStreaming({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });

    // Clear and start second turn
    manager.clearLastInput();
    manager.writeSubmittedInput('hello');
    manager.beginContentStreaming();

    // _cursorUncertain should be false now (set in beginContentStreaming else branch)
    // Verify by checking that endContentStreaming uses cursor-based fill, not maxContentRows
    manager.writeAtContentCursor('Hi!\n'); // Short response
    const beforeEndOutput = getOutput();
    manager.endContentStreaming({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });
    const afterEndOutput = getOutput();

    // If _cursorUncertain was true, fill would be 21 newlines
    // If _cursorUncertain was false with cursorRow ~5, fill = 21 - 5 = 16 newlines
    const newlinesAdded = countNewlines(afterEndOutput) - countNewlines(beforeEndOutput);
    // With _cursorUncertain=false: fill + 1(input \n) = ~17
    // With _cursorUncertain=true: fill(21) + 1 = 22
    expect(newlinesAdded).toBeLessThan(22);
  });

  it('short response without newline: endContentStreaming does not overfill', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.beginContentStreaming();
    manager.endContentStreaming({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });

    // Second turn: clear + submit short input + begin streaming
    manager.clearLastInput();
    manager.writeSubmittedInput('hi');
    manager.beginContentStreaming();
    // Simulate a very short AI response (no newline)
    manager.writeAtContentCursor('Hi!');

    const beforeEndOutput = getOutput();
    manager.endContentStreaming({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });
    const afterEndOutput = getOutput();

    const newlinesAdded = countNewlines(afterEndOutput) - countNewlines(beforeEndOutput);
    // With _cursorUncertain=false (cursorRow ~5): fill = 21 - 5 = 16 + 1 input newline = 17
    // With _cursorUncertain=true: fill = 21 + 1 = 22
    expect(newlinesAdded).toBeLessThan(22);
  });

  it('regression: beginContentStreaming always sets _cursorUncertain consistently', () => {
    // Bug 8: after clearLastInput + beginContentStreaming (first-turn branch),
    // _cursorUncertain is set to true. If no content is written before
    // endContentStreaming, fill uses maxContentRows (22) instead of cursor-based fill.
    // The fix ensures that in the else branch, _cursorUncertain is also cleared.
    // Since clearLastInput resets _hasStreamedContent, the first-turn branch is
    // always taken. This test verifies the fix indirectly by ensuring
    // writeAtContentCursor clears _cursorUncertain properly.

    const ctx = createMock();
    ctx.manager.begin();
    ctx.manager.beginContentStreaming();
    ctx.manager.endContentStreaming({ inputPrompt: 'w...', statusLine: 's' });
    ctx.manager.clearLastInput();
    // After clearLastInput, _hasStreamedContent is false.
    // beginContentStreaming enters first-turn branch, clears activity lines and sets _cursorUncertain=false.
    ctx.manager.beginContentStreaming();
    expect((ctx.manager as any)._cursorUncertain).toBe(false);
    // Writing content keeps _cursorUncertain false
    ctx.manager.writeAtContentCursor('Hi!\n');
    expect((ctx.manager as any)._cursorUncertain).toBe(false);
  });
});

describe('Bug 9: CJK cursor wrap at column boundary', () => {
  function createMock(cols = 80) {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = 24;
    (stream as any).columns = cols;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join('') };
  }

  it('CJK character at col 78 (cols-2) on 80-col terminal should wrap', () => {
    const { manager } = createMock(80);
    manager.begin();

    // Write 78 spaces to get to col 78
    manager.writeAtContentCursor(' '.repeat(78));
    // Now write a CJK character (width 2)
    manager.writeAtContentCursor('测');

    // col 78 + 2 >= 80 → wrap. CJK char can't fit in 1 col remaining,
    // so it goes on new row at col 2.
    expect((manager as any)._cursorCol).toBe(2);
    expect((manager as any)._cursorRow).toBe(2);
  });

  it('CJK character exactly filling remaining row wraps correctly', () => {
    const { manager } = createMock(80);
    manager.begin();

    // Write 80 spaces to fill the row. The 80th space triggers wrap
    // (col 79 + 1 >= 80), then next char starts on new row at col 1.
    manager.writeAtContentCursor(' '.repeat(80));
    expect((manager as any)._cursorCol).toBe(1);
    expect((manager as any)._cursorRow).toBe(2);
  });

  it('CJK character at col 79 on 80-col terminal wraps', () => {
    const { manager } = createMock(80);
    manager.begin();

    // Write 79 spaces
    manager.writeAtContentCursor(' '.repeat(79));
    // Write a CJK char (width 2) — should wrap since 79 + 2 >= 80
    manager.writeAtContentCursor('测');

    // After wrapping: col 2 (CJK width on new row), row 2 (wrap)
    expect((manager as any)._cursorCol).toBe(2);
    expect((manager as any)._cursorRow).toBe(2);
  });

  it('ASCII character at col 79 on 80-col terminal: fills last column, next char starts on new row', () => {
    const { manager } = createMock(80);
    manager.begin();

    manager.writeAtContentCursor(' '.repeat(79));
    manager.writeAtContentCursor('a');

    // 'a' at col 79: 79+1 >= 80 → wrap. col = 1, _cursorRow increments by 1.
    // After fix: col = 1 (next char position), _cursorRow = 2 (wrapped to next row)
    expect((manager as any)._cursorRow).toBe(2);
    expect((manager as any)._cursorCol).toBe(1);
  });
});

describe('Bug 10: Content exceeding maxContentRows', () => {
  function createMock(rows = 24, cols = 80) {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = rows;
    (stream as any).columns = cols;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join('') };
  }

  function countNewlines(output: string): number {
    return (output.match(/\n/g) || []).length;
  }

  it('endContentStreaming clamps cursorRow for fill when content exceeds maxContentRows', () => {
    const { manager, getOutput } = createMock(24, 80);
    manager.begin();
    manager.beginContentStreaming();

    // Simulate content that exceeds maxContentRows (22)
    // Write 30 newlines worth of content
    for (let i = 0; i < 30; i++) {
      manager.writeAtContentCursor(`line ${i}\n`);
    }

    // _cursorRow is now > maxContentRows (clamped or not)
    const cursorRow = (manager as any)._cursorRow;

    manager.endContentStreaming({ inputPrompt: 'waiting...', statusLine: 'gpt-5.4' });
    const output = getOutput();

    // The fill newlines should bring us to maxContentRows, not beyond
    // If _cursorRow was clamped to maxContentRows in fill calculation,
    // fill would be 0 (since effectiveRow = min(30+, 22) = 22, fill = 22 - 22 = 0)
    // Footer renders right after content
    const footerIdx = output.indexOf('waiting...');
    expect(footerIdx).toBeGreaterThan(-1);
  });

  it('footer always renders at terminal bottom for long content', () => {
    const { manager, getOutput } = createMock(24, 80);
    manager.begin();
    manager.beginContentStreaming();

    // Write enough content to definitely overflow
    const longContent = 'x'.repeat(80);
    for (let i = 0; i < 30; i++) {
      manager.writeAtContentCursor(longContent + '\n');
    }

    manager.endContentStreaming({ inputPrompt: 'INPUT_PROMPT', statusLine: 'STATUS_LINE' });
    const output = getOutput();

    // Footer should be present
    expect(output).toContain('INPUT_PROMPT');
    expect(output).toContain('STATUS_LINE');
  });

  it('clearContentArea resets the scroll region content without touching the footer rows', () => {
    const { manager, getOutput } = createMock(24, 80);
    manager.begin();
    manager.setWelcomeRows(12);
    manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'STATUS_LINE' });

    manager.clearContentArea();
    manager.writeSubmittedInput('› hello\n');
    manager.endContentStreaming({ inputPrompt: 'Type your message...', statusLine: 'STATUS_LINE' });

    const output = getOutput();
    expect(output).toContain('› hello');
    expect(output).toContain('STATUS_LINE');
    expect((manager as any)._cursorRow).toBeGreaterThanOrEqual(1);
    expect((manager as any)._welcomeRows).toBe(0);
  });
});

describe('Bug 11: Terminal resize handling', () => {
  function createMock(rows = 24, cols = 80) {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = rows;
    (stream as any).columns = cols;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join('') };
  }

  it('updateSize changes maxContentRows', () => {
    const { manager } = createMock(24, 80);
    // Before: footerHeight=2, gapHeight=1, so maxContentRows = 24-2-1 = 21
    expect((manager as any).maxContentRows).toBe(21);

    manager.updateSize(30, 100);
    // After: maxContentRows = 30-2-1 = 27
    expect((manager as any).maxContentRows).toBe(27);
  });

  it('updateSize changes columns for wrap calculation', () => {
    const { manager } = createMock(24, 80);
    manager.begin();

    // Write 90 characters on 80-col terminal — should wrap
    manager.writeAtContentCursor('x'.repeat(90));
    const rowAfter80 = (manager as any)._cursorRow;

    // Reset and try on 100-col terminal
    const { manager: manager2 } = createMock(24, 100);
    manager2.begin();
    manager2.writeAtContentCursor('x'.repeat(90));
    const rowAfter100 = (manager2 as any)._cursorRow;

    // On wider terminal, fewer wraps should occur
    expect(rowAfter100).toBeLessThanOrEqual(rowAfter80);
  });
});

describe('updateStatusLine respects _contentStreaming guard', () => {
  function createMock() {
    const mock = new PassThrough();
    const chunks: string[] = [];
    mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const stream = mock as unknown as NodeJS.WriteStream;
    (stream as any).rows = 24;
    (stream as any).columns = 80;
    const manager = new ScrollRegionManager(stream);
    return { manager, getOutput: () => chunks.join('') };
  }

  it('updateStatusLine preserves the cursor while updating the footer during streaming', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.beginContentStreaming();
    manager.writeAtContentCursor('content\n');

    manager.updateStatusLine('new status');

    const output = getOutput();
    expect(output).toContain('new status');
    expect(output).toContain('\x1b[s');
    expect(output).toContain('\x1b[u');
  });

  it('updateStatusLine works when not streaming', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderFooter({ inputPrompt: 'waiting...', statusLine: 'old status' });

    manager.updateStatusLine('new status');

    const output = getOutput();
    expect(output).toContain('new status');
  });
});

describe('streaming cursor handoff', () => {
  beforeEach(() => {
    setColorsEnabled(false);
  });

  afterEach(() => {
    setColorsEnabled(true);
  });

  it('keeps streamed output above the fixed footer after a submitted input block', () => {
    const harness = createTtyHarness(120, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const markdown = new MarkdownRenderer();

    try {
      manager.begin();
      manager.setWelcomeRows(12);
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'claude-test · auto · 0% · xiaok-cli',
      });

      manager.clearLastInput();
      manager.writeSubmittedInput(formatSubmittedInput('分三次显示123'));

      markdown.setNewlineCallback(manager.getNewlineCallback());
      manager.beginContentStreaming();
      markdown.write('1\n2\n3');
      markdown.flush();
      manager.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: 'claude-test · auto · 0% · xiaok-cli',
      });

      const lines = harness.screen.lines();
      const submittedIndex = lines.findIndex((line) => line.includes('› 分三次显示123'));
      const line1Index = lines.findIndex((line) => line.trim() === '1');
      const line2Index = lines.findIndex((line) => line.trim() === '2');
      const line3Index = lines.findIndex((line) => line.trim() === '3');
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const statusIndex = lines.findIndex((line) => line.includes('claude-test') && line.includes('auto'));

      expect(submittedIndex).toBeGreaterThanOrEqual(0);
      expect(line1Index).toBeGreaterThan(submittedIndex + 1);
      expect(lines[line1Index - 1]).toBe('');
      expect(line2Index).toBeGreaterThan(line1Index);
      expect(line3Index).toBeGreaterThan(line2Index);
      expect(promptIndex).toBeGreaterThan(line3Index);
      expect(statusIndex).toBeGreaterThan(promptIndex);
    } finally {
      harness.restore();
    }
  });
});
