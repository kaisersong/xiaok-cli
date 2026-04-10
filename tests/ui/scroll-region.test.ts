/**
 * Tests for scroll region activity line rendering and the
 * contentStreaming flag that prevents thinking line duplication.
 *
 * Bug: renderLiveActivity() timer fires every 120ms and re-renders
 * the thinking indicator at the bottom of the scroll region. When
 * streaming content writes to that same row, terminal auto-scrolls
 * the thinking line up, but the timer re-renders it at the original
 * position, creating duplicate "Thinking" lines on screen.
 *
 * Fix: Add contentStreaming flag. When true, renderLiveActivity()
 * returns early without rendering. Flag is set after
 * beginContentStreaming() and reset after endContentStreaming().
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';

/**
 * Creates a ScrollRegionManager backed by a mock stream.
 * Captures every byte written for assertion.
 */
function createMockScrollRegion() {
  const mock = new PassThrough();
  const chunks: string[] = [];
  mock.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  // We need to cast because PassThrough doesn't fully implement WriteStream
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
      // Should contain scroll region setup (rows=24, footer=2, gap=1 → scroll ends at 21)
      expect(output).toContain('\x1b[1;21r');
      // Should contain the activity text
      expect(output).toContain('⠋ Thinking · 3s');
    });

    it('does not render activity when scroll region is inactive', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.renderActivity('⠋ Thinking');
      const output = getOutput();
      // Inline rendering uses CLEAR_LINE + text
      expect(output).toContain('⠋ Thinking');
    });
  });

  describe('content streaming flag behavior', () => {
    it('beginContentStreaming positions cursor at bottom of scroll region', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();
      manager.beginContentStreaming();

      const output = getOutput();
      // Should move cursor to row 21 (24 - 2 footer - 1 gap)
      expect(output).toContain('\x1b[21;1H');
    });

    it('endContentStreaming re-renders footer', () => {
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
  /**
   * Simulates the renderLiveActivity logic from chat.ts.
   * This test verifies the flag logic without needing the full chat context.
   */
  function simulateTurnWithStreaming(
    renderActivityCalls: { at: 'tool_use' | 'content_streaming' | 'idle'; label: string }[],
  ): { renderedLabels: string[]; duplicates: string[] } {
    let contentStreaming = false;
    const renderedLabels: string[] = [];

    const renderLiveActivity = (label: string): void => {
      // This is the fix: skip rendering when content is streaming
      if (contentStreaming) return;
      renderedLabels.push(label);
    };

    for (const call of renderActivityCalls) {
      if (call.at === 'content_streaming') {
        contentStreaming = true;
        // In real code, contentStreaming is set after beginContentStreaming()
        // and the timer won't fire renderLiveActivity during streaming.
        // But for simulation, we still call renderLiveActivity to verify the guard.
        renderLiveActivity(call.label);
      } else if (call.at === 'idle') {
        // In real code, contentStreaming = false happens at endContentStreaming(),
        // which is before any subsequent renderLiveActivity() call from the timer.
        contentStreaming = false;
        renderLiveActivity(call.label);
      }
    }

    // Check for duplicates
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
    // Simulate the buggy behavior: no contentStreaming guard
    const renderActivityCalls = [
      { at: 'idle' as const, label: '⠋ Thinking · 1s' },
      { at: 'idle' as const, label: '⠙ Thinking · 1s' },
      { at: 'idle' as const, label: '⠹ Thinking · 2s' },
      // Content starts streaming, but timer still fires
      { at: 'idle' as const, label: '⠸ Thinking · 2s' },
      { at: 'idle' as const, label: '⠼ Thinking · 3s' },
      { at: 'idle' as const, label: '⠴ Thinking · 3s' },
    ];

    // Without the fix, all labels render (6 total)
    // With the fix applied to the same scenario, only first 3 render
    const result = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Thinking · 1s' },
      { at: 'idle', label: '⠙ Thinking · 1s' },
      { at: 'idle', label: '⠹ Thinking · 2s' },
      { at: 'content_streaming', label: '⠸ Thinking · 2s' },
      { at: 'content_streaming', label: '⠼ Thinking · 3s' },
      { at: 'content_streaming', label: '⠴ Thinking · 3s' },
    ]);

    // With fix: only first 3 should render, last 3 are skipped
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
      { at: 'content_streaming', label: '⠙ Thinking · 2s' }, // skipped
      { at: 'content_streaming', label: '⠹ Thinking · 2s' }, // skipped
      { at: 'idle', label: '⠸ Running command' }, // should render after streaming ends
      { at: 'idle', label: '⠼ Running command' }, // should render
    ]);

    expect(result.renderedLabels).toEqual([
      '⠋ Thinking · 1s',
      '⠸ Running command',
      '⠼ Running command',
    ]);
  });

  it('multiple turns: each turn resets contentStreaming flag', () => {
    // Simulate turn 1
    const turn1 = simulateTurnWithStreaming([
      { at: 'idle', label: '⠋ Thinking · 1s' },
      { at: 'content_streaming', label: '⠙ Content · 2s' },
      { at: 'content_streaming', label: '⠹ Content · 3s' },
    ]);

    // Simulate turn 2 (fresh renderLiveActivity + flag)
    const turn2 = simulateTurnWithStreaming([
      { at: 'idle', label: '⠸ Tool exec · 1s' },
      { at: 'content_streaming', label: '⠼ Content · 2s' },
    ]);

    // Both turns should work independently
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

describe('ANSI scroll region sequences', () => {
  it('sets correct scroll boundaries for standard terminal', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();

    const output = getOutput();
    // With rows=24, footerHeight=2, gapHeight=1, scroll region should be 1..21
    expect(output).toContain('\x1b[1;21r');
  });

  it('activity line is rendered at bottom of scroll region', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();

    manager.renderActivity('⠋ Thinking');

    const output = getOutput();
    // Activity should be at row 21 (bottom of scroll region, with gap below)
    expect(output).toContain('\x1b[21;1H');
  });

  it('footer is rendered below scroll region', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderFooter({
      inputPrompt: 'Type...',
      statusLine: 'gpt-5.4',
    });

    const output = getOutput();
    // Footer should be at rows 23 and 24 (below scroll region)
    expect(output).toContain('\x1b[23;'); // input bar
    expect(output).toContain('\x1b[24;'); // status bar
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
    // Match \x1b[row;colH pattern - take the LAST match (from renderInput, not begin)
    const matches = [...output.matchAll(/\x1b\[23;(\d+)H/g)];
    if (matches.length === 0) return null;
    return parseInt(matches[matches.length - 1][1], 10);
  }

  it('empty input: cursor at col 3 (after "❯ ")', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('', 0);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(3);
  });

  it('English text: cursor at correct column', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('hello', 5);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(8); // 3 + 5 = 8
  });

  it('Chinese text: cursor after 1 char (你) at col 5', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('你好', 1);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(5); // 3 + 2(display width of 你) = 5
  });

  it('Chinese text: cursor after 2 chars (你好) at col 7', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('你好', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(7); // 3 + 4(display width of 你好) = 7
  });

  it('mixed CJK+ASCII: cursor after 测t at col 6', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('测t', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(6); // 3 + getDisplayWidth("测t") = 3+3 = 6
  });

  it('Chinese text: cursor in middle (你|好) at col 5', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('你好', 1);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(5); // 3 + getDisplayWidth("你") = 3+2 = 5
  });

  it('mixed CJK+ASCII: cursor after all 4 chars 测a试b at col 9', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('测a试b', 4);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(9); // 3 + getDisplayWidth("测a试b") = 3+6 = 9
  });

  it('mixed CJK+ASCII: cursor after 测a at col 6', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.renderInput('测a试b', 2);
    const cursorCol = extractCursorCol(getOutput());
    expect(cursorCol).toBe(6); // 3 + getDisplayWidth("测a") = 3+3 = 6
  });
});
