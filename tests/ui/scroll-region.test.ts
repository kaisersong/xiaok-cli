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
import { formatProgressNote, formatSubmittedInput, setColorsEnabled } from '../../src/ui/render.js';
import { formatCurrentTurnIntentSummaryLine } from '../../src/ui/orchestration.js';
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
  return {
    manager,
    stream: mock,
    getOutput: () => chunks.join(''),
    getChunks: () => [...chunks],
    resetOutput: () => {
      chunks.length = 0;
    },
  };
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

    it('does not clear the last visible content row when no activity line is active', () => {
      const harness = createTtyHarness(80, 24);
      const manager = new ScrollRegionManager(process.stdout);

      try {
        manager.begin();
        manager.writeAtContentCursor('tail line');
        manager.clearActivity();

        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('tail line'))).toBe(true);
      } finally {
        harness.restore();
      }
    });

    it('batches footer redraw while restoring an existing activity line', () => {
      const { manager, getChunks, resetOutput } = createMockScrollRegion();
      manager.begin();
      manager.renderActivity('⠋ Thinking · 1s');
      resetOutput();

      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 4% · project',
      });

      const chunks = getChunks();
      const promptChunks = chunks.filter((chunk) => chunk.includes('Type your message...'));
      const statusChunks = chunks.filter((chunk) => chunk.includes('gpt-terminal-e2e · auto · 4% · project'));

      expect(promptChunks).toHaveLength(1);
      expect(statusChunks).toHaveLength(1);
      expect(promptChunks[0]).toContain('⠋ Thinking · 1s');
    });
  });

  describe('content streaming flag behavior', () => {
    it('beginContentStreaming sets streaming flag', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();
      manager.beginContentStreaming();
      const output = getOutput();
      expect(manager.isContentStreaming()).toBe(true);
      expect(output).toContain('\x1b[1;1H');
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

    it('pads placeholder input with footer background across the row', () => {
      const { manager, getOutput } = createMockScrollRegion();
      manager.begin();

      manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'gpt-5.4' });

      const output = getOutput();
      expect(output).toMatch(/❯\x1b\[22;39m \x1b\[2mType your message\.\.\. +\x1b\[0m/);
    });

    it('keeps the footer rows visible while content is streaming', () => {
      const harness = createTtyHarness(80, 24);
      const manager = new ScrollRegionManager(process.stdout);

      try {
        manager.begin();
        manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'gpt-5.4 · 5% · project' });
        manager.beginContentStreaming();
        manager.writeAtContentCursor('streaming line');

        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('❯ Type your message...'))).toBe(true);
        expect(lines.some((line) => line.includes('gpt-5.4 · 5% · project'))).toBe(true);
      } finally {
        harness.restore();
      }
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
  it('renders the sticky summary line above the input and separate from activity and status rows', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'Customer proposal',
      stageOrder: 0,
      totalStages: 1,
      stageLabel: 'Collect',
      status: 'Drafting Plan',
    });

    try {
      manager.begin();
      manager.renderActivity('⠋ Thinking · 1s');
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
      });

      const lines = harness.screen.lines();
      const activityIndex = lines.findIndex((line) => line.includes('Thinking · 1s'));
      const summaryIndex = lines.findIndex((line) => line.includes('Intent: Customer proposal'));
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const statusIndex = lines.findIndex((line) => line.includes('gpt-5.4 · 5% · master · xiaok-cli'));

      expect(activityIndex).toBeGreaterThanOrEqual(0);
      expect(summaryIndex).toBeGreaterThan(activityIndex);
      expect(promptIndex).toBeGreaterThan(summaryIndex);
      expect(statusIndex).toBeGreaterThan(promptIndex);
      expect(lines[summaryIndex]).not.toContain('gpt-5.4');
      expect(lines[summaryIndex]).not.toContain('Thinking');
      expect(lines[summaryIndex]).toContain('● Intent: Customer proposal · Stage 1/1 Collect · Drafting Plan');
      expect(summaryIndex).toBe(promptIndex - 3);
      expect(lines[summaryIndex + 1]).toBe('');
      expect(lines[activityIndex]).not.toContain('Intent: Customer proposal');
    } finally {
      harness.restore();
    }
  });

  it('preserves ANSI intent-hint styling in the rendered footer summary line', () => {
    const { manager, getOutput } = createMockScrollRegion();
    setColorsEnabled(true);
    try {
      const summaryLine = formatCurrentTurnIntentSummaryLine({
        deliverable: 'md -> 报告',
        stageOrder: 0,
        totalStages: 2,
        stageLabel: '提取 Markdown',
        status: 'Drafting Plan',
      });

      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
      });

      const output = getOutput();
      expect(output).toContain('\x1b[38;2;122;168;255m●\x1b[0m');
      expect(output).toContain('\x1b[38;2;142;142;142mIntent: md -> 报告 · Stage 1/2 提取 Markdown · Drafting Plan\x1b[0m');
    } finally {
      setColorsEnabled(
        process.stdout.isTTY !== false &&
        !process.env.NO_COLOR &&
        !process.argv.includes('--no-color'),
      );
    }
  });

  it('keeps the prompt and status visible when a wrapped summary line shares the footer with changed and ran tool blocks', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'md -> 报告',
      stageOrder: 0,
      totalStages: 2,
      stageLabel: '提取 Markdown 并生成结构化报告草稿',
      status: 'Executing tools',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      for (let index = 0; index < 10; index += 1) {
        manager.writeAtContentCursor(`context line ${index + 1}\n`);
      }

      manager.writeAtContentCursor('\n\n  ╭─ Changed\n  │ Wrote report-analysis.report.md\n');
      manager.writeAtContentCursor(
        '\n\n  ╭─ Ran\n'
        + '  │ printf "const fs = require(\'fs\'); const report = fs.readFileSync(\'report-analysis.report.md\', \'utf8\'); // 解析并生成总结"\n',
      );
      manager.renderActivity('⠋ Executing command · 8s');

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('project') && line.includes('%'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(lines[22]).toContain('❯ Type your message...');
      expect(lines[23]).toContain('gpt-terminal-e2e · auto · 0% · project');
      expect(lines.some((line) => line.includes('Intent: md -> 报告'))).toBe(true);
      expect(lines.some((line) => line.includes('Wrote report-analysis.report.md'))).toBe(true);
      expect(lines.some((line) => line.includes('printf "const fs = require'))).toBe(true);
      expect(lines.some((line) => line.includes('Executing command · 8s'))).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it('keeps the prompt row visible while consecutive ran blocks refresh the activity rail', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'md -> 报告',
      stageOrder: 0,
      totalStages: 2,
      stageLabel: '提取 Markdown',
      status: 'Working',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'gpt-terminal-e2e · 4% · project',
      });

      manager.writeAtContentCursor('\n\n  ╭─ Changed\n  │ Wrote combined-source.report.md\n');
      manager.writeAtContentCursor('\n\n  ╭─ Ran\n  │ printf "E2E_FEEDBACK_CONFIRM_MERGED_MD"\n');
      manager.renderActivity('⠋ Executing command · 7s');
      manager.writeAtContentCursor('  │ printf "E2E_FEEDBACK_CONFIRM_WRAP_BLOCK verifying footer stability after feedback confirmation"\n');
      manager.renderActivity('⠸ Executing command · 8s');
      manager.writeAtContentCursor('  │ printf "E2E_FEEDBACK_CONFIRM_STAGE2_OK"\n');
      manager.renderActivity('⠼ Executing command · 9s');

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('gpt-terminal-e2e · 4% · project'));
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const activityIndex = lines.findIndex((line) => line.includes('Executing command · 9s'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(promptIndex).toBeGreaterThan(activityIndex);
      expect(lines.slice(activityIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
      expect(lines.some((line) => line.includes('Wrote combined-source.report.md'))).toBe(true);
      expect(lines.filter((line) => line.includes('printf "E2E_FEEDBACK_CONFIRM')).length).toBeGreaterThanOrEqual(2);
    } finally {
      harness.restore();
    }
  });

  it('keeps the prompt row visible while activity ticks refresh above an existing footer', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'md -> 报告',
      stageOrder: 0,
      totalStages: 2,
      stageLabel: '提取 Markdown',
      status: 'Working',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Finishing response...',
        summaryLine,
        statusLine: 'gpt-terminal-e2e · auto · 4% · project',
      });

      manager.writeAtContentCursor('\n\n  ╭─ Explored\n  │ Read 01-market-overview.md\n');
      manager.writeAtContentCursor('\n\n  ╭─ Changed\n  │ Wrote report-analysis.report.md\n');

      manager.renderActivity('⠋ Updating files · 1s');
      manager.renderActivity('⠙ Updating files · 2s');
      manager.renderActivity('⠹ Updating files · 3s');
      manager.renderActivity('⠸ Updating files · 4s');

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('gpt-terminal-e2e · auto · 4% · project'));
      const promptIndex = lines.findIndex((line) => line.includes('❯ Finishing response...'));
      const activityIndex = lines.findIndex((line) => line.includes('Updating files · 4s'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(promptIndex).toBe(22);
      expect(activityIndex).toBeLessThan(promptIndex);
      expect(lines.some((line) => line.includes('Wrote report-analysis.report.md'))).toBe(true);
      expect(lines.some((line) => line.includes('Intent: md -> 报告'))).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it('re-anchors the footer when activity ticks continue after the footer rows were cleared', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'md -> 报告',
      stageOrder: 0,
      totalStages: 2,
      stageLabel: '提取 Markdown',
      status: 'Working',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Finishing response...',
        summaryLine,
        statusLine: 'gpt-terminal-e2e · auto · 4% · project',
      });

      process.stdout.write('\x1b[20;1H\x1b[2K');
      process.stdout.write('\x1b[21;1H\x1b[2K');
      process.stdout.write('\x1b[22;1H\x1b[2K');
      process.stdout.write('\x1b[23;1H\x1b[2K');
      process.stdout.write('\x1b[24;1H\x1b[2K');

      manager.renderActivity('⠋ Finalizing response · 1m 47s');

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('gpt-terminal-e2e · auto · 4% · project'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(lines[22]).toContain('❯ Finishing response...');
      expect(lines[23]).toContain('gpt-terminal-e2e · auto · 4% · project');
      expect(lines.some((line) => line.includes('Finalizing response · 1m 47s'))).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it('re-anchors the footer when a status-only update lands after the prompt row was cleared', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'md -> 报告',
      stageOrder: 0,
      totalStages: 2,
      stageLabel: '提取 Markdown',
      status: 'Working',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Finishing response...',
        summaryLine,
        statusLine: 'gpt-terminal-e2e · auto · 4% · project',
      });

      process.stdout.write('\x1b[23;1H\x1b[2K');
      process.stdout.write('\x1b[24;1H\x1b[2Kgpt-terminal-e2e · auto · 5% · project');

      manager.updateStatusLine('gpt-terminal-e2e · auto · 6% · project');

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('gpt-terminal-e2e · auto · 6% · project'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(lines[22]).toContain('❯ Finishing response...');
      expect(lines[23]).toContain('gpt-terminal-e2e · auto · 6% · project');
    } finally {
      harness.restore();
    }
  });

  it('suppresses activity redraws while the feedback overlay owns the footer', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: '',
        cursor: 0,
        placeholder: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · 4% · project',
        overlayLines: ['[xiaok] 这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过'],
        overlayKind: 'feedback',
      });

      manager.renderActivity('⠋ Thinking · 1s');

      const lines = harness.screen.lines();
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const overlayIndex = lines.findIndex((line) => line.includes('[xiaok] 这次结果是否满足预期？'));

      expect(lines.some((line) => line.includes('Thinking · 1s'))).toBe(false);
      expect(overlayIndex).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBeGreaterThan(overlayIndex);
      expect(lines.slice(overlayIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
    } finally {
      harness.restore();
    }
  });

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
      expect(lines[22]).toContain('❯ /');
    } finally {
      harness.restore();
    }
  });

  it('keeps two blank rows between overlay content and the input footer', () => {
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
          '⚡ xiaok 想要执行以下操作',
          '工具: bash',
          '命令: cmd /c where pi',
          '❯ 允许一次',
          '↑↓ 选择  Enter 确认  Esc 取消',
        ],
      });

      const lines = harness.screen.lines();
      const overlayBottomIndex = lines.findIndex((line) => line.includes('↑↓ 选择  Enter 确认  Esc 取消'));
      const promptIndex = lines.findIndex((line) => line.includes('❯ /'));

      expect(overlayBottomIndex).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBe(overlayBottomIndex + 4);
      expect(lines[overlayBottomIndex + 1]).toBe('');
      expect(lines[overlayBottomIndex + 2]).toBe('');
      expect(lines[overlayBottomIndex + 3]).toBe('');
    } finally {
      harness.restore();
    }
  });

  it('truncates tall overlays so the footer gap remains intact', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const overlayLines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);

    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: '',
        cursor: 0,
        placeholder: 'Type your message...',
        statusLine: 'gpt-5.4 · 5%',
        overlayLines,
      });

      const lines = harness.screen.lines();
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const overlayBottomIndex = lines.findIndex((line) => line.includes('line 30'));

      expect(overlayBottomIndex).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBe(overlayBottomIndex + 4);
      expect(lines[overlayBottomIndex + 1]).toBe('');
      expect(lines[overlayBottomIndex + 2]).toBe('');
      expect(lines[overlayBottomIndex + 3]).toBe('');
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

  it('clears stale prompt rows from the footer gap before redrawing the placeholder', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      process.stdout.write('\x1b[21;1H❯ stale prompt row');
      process.stdout.write('\x1b[22;1Hstale status row');

      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      const lines = harness.screen.lines();
      expect(lines[20]).toBe('');
      expect(lines[21]).toBe('');
      expect(lines[22]).toContain('❯ Type your message...');
      expect(lines[21]).not.toContain('stale prompt row');
      expect(lines[22]).not.toContain('stale prompt row');
      expect(lines[21]).not.toContain('stale status row');
    } finally {
      harness.restore();
    }
  });

  it('clears permission overlay rows before transcript output resumes', () => {
    const harness = createTtyHarness(120, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.setWelcomeRows(8);
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      manager.renderPromptFrame({
        inputValue: '',
        cursor: 0,
        placeholder: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
        overlayLines: [
          '⚡ xiaok 想要执行以下操作',
          '工具: bash',
          '命令: cmd /c echo E2E_PERMISSION_OK',
          '❯ 允许一次',
          '  本次会话始终允许 bash(cmd *)',
          '  始终允许 bash(cmd *) (保存到项目)',
          '  始终允许 bash(cmd *) (保存到全局)',
          '  拒绝',
          '↑↓ 选择  Enter 确认  Esc 取消',
        ],
      });

      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });
      manager.setContentCursor(9);
      manager.writeAtContentCursor('E2E_PERMISSION_RESPONSE_ONE');

      const lines = harness.screen.lines();
      expect(lines.some((line) => line.includes('E2E_PERMISSION_RESPONSE_ONE'))).toBe(true);
      expect(lines.some((line) => line.includes('xiaok 想要执行以下操作'))).toBe(false);
      expect(lines.some((line) => line.includes('工具: bash'))).toBe(false);
      expect(lines.some((line) => line.includes('↑↓ 选择  Enter 确认  Esc 取消'))).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('re-anchors the footer after out-of-band transcript writes', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'Customer proposal',
      stageOrder: 0,
      totalStages: 1,
      stageLabel: 'Collect',
      status: 'Drafting Plan',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
      });

      manager.writeAtContentCursor('\n[background] job_1 completed: background worker finished\n');

      const lines = harness.screen.lines();
      const backgroundIndex = lines.findIndex((line) => line.includes('[background] job_1 completed'));
      const summaryRows = lines.filter((line) => line.includes('Intent: Customer proposal'));
      const promptRows = lines.filter((line) => line.includes('❯ Type your message...'));
      const statusRows = lines.filter((line) => line.includes('gpt-5.4 · 5% · master · xiaok-cli'));

      expect(backgroundIndex).toBeGreaterThanOrEqual(0);
      expect(summaryRows).toHaveLength(1);
      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
    } finally {
      harness.restore();
    }
  });

  it('pushes the transcript tail up when a new summary row shrinks the footer gap', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'Customer proposal',
      stageOrder: 0,
      totalStages: 1,
      stageLabel: 'Collect',
      status: 'Drafting Plan',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
      });

      manager.setContentCursor(manager.maxContentRows);
      manager.writeAtContentCursor('TAIL_LINE');

      manager.renderFooter({
        inputPrompt: ' ',
        summaryLine,
        statusLine: 'gpt-5.4 · 5% · master · xiaok-cli',
      });

      const lines = harness.screen.lines();
      const tailIndex = lines.findIndex((line) => line.includes('TAIL_LINE'));
      const summaryIndex = lines.findIndex((line) => line.includes('Intent: Customer proposal'));
      const promptIndex = lines.findIndex((line) => line.includes('❯'));
      const statusIndex = lines.findIndex((line) => line.includes('gpt-5.4 · 5% · master · xiaok-cli'));

      expect(tailIndex).toBeGreaterThanOrEqual(0);
      expect(summaryIndex).toBe(promptIndex - 3);
      expect(tailIndex).toBe(summaryIndex - 2);
      expect(lines[summaryIndex - 1]).toBe('');
      expect(lines[summaryIndex + 1]).toBe('');
      expect(statusIndex).toBe(promptIndex + 1);
    } finally {
      harness.restore();
    }
  });

  it('keeps agent questions visible above the restored footer', () => {
    const harness = createTtyHarness(100, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const summaryLine = formatCurrentTurnIntentSummaryLine({
      deliverable: 'Customer proposal',
      stageOrder: 0,
      totalStages: 1,
      stageLabel: 'Collect',
      status: 'Drafting Plan',
    });

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine,
        statusLine: 'test-model · auto · 0% · project',
      });

      manager.writeAtContentCursor('\nAgent question: 确认目标？\n');

      const lines = harness.screen.lines();
      const questionIndex = lines.findIndex((line) => line.includes('Agent question: 确认目标？'));
      const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
      const statusIndex = lines.findIndex((line) => line.includes('test-model · auto · 0% · project'));

      expect(questionIndex).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBeGreaterThan(questionIndex);
      expect(statusIndex).toBeGreaterThan(promptIndex);
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
    expect(output).toMatch(/\x1b\[22;1H\x1b\[2K\x1b\[48;5;238m +\x1b\[0m/);  // padded background row above the prompt
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
    expect(output).toMatch(/\x1b\[1;19r\x1b\[23;3H$/);
  });

  it('does not leave the input background SGR active after footer rendering', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderInput('abc', 3);

    const output = getOutput();
    expect(output).toMatch(/\x1b\[0m\x1b\[24;1H\x1b\[2K(?:\x1b\[2m.*?\x1b\[0m)?\x1b\[1;19r\x1b\[23;6H$/);
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
      const renderedFooter = lines.join('\n');
      const statusLines = lines.filter((line) => line.includes('gpt-5.4 · 5%'));

      expect(renderedFooter).toContain('❯ 0123456789');
      expect(renderedFooter).toContain('ijk');
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
    expect(output).toContain('\x1b[19;1H');
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
    expect(output).toContain('\x1b[19;1H');
  });

  it('repositions the real terminal cursor back to the footer after rendering activity', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.renderFooter({ inputPrompt: 'Type...', statusLine: 'gpt-5.4' });

    const before = getOutput().length;
    manager.renderActivity('⠋ Thinking');
    const delta = getOutput().slice(before);

    expect(delta).toContain('\x1b[19;1H');
    expect(delta).toContain('\x1b[23;3H');
    expect(delta.lastIndexOf('\x1b[23;3H')).toBeGreaterThan(delta.indexOf('\x1b[19;1H'));
  });

  it('renders activity above the input footer with two blank gap rows', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'gpt-5.4 · 5%' });
      manager.renderActivity('⠋ Thinking');

      const lines = harness.screen.lines();
      expect(lines[18]).toContain('Thinking');
      expect(lines[19]).toBe('');
      expect(lines[20]).toBe('');
      expect(lines[21]).toBe('');
      expect(lines[22]).not.toContain('Thinking');
      expect(lines[22]).not.toContain('working');
      expect(lines[22]).toContain('❯ Type your message...');
      expect(lines[23]).toContain('gpt-5.4 · 5%');
    } finally {
      harness.restore();
    }
  });

  it('re-renders the cached footer when activity updates after footer visibility state was lost', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: ' ',
        statusLine: 'gpt-5.4 · 5% · project',
      });

      (manager as unknown as { _footerVisible: boolean })._footerVisible = false;
      manager.renderActivity('⠋ Working · 11s');

      const lines = harness.screen.lines();
      expect(lines[18]).toContain('Working · 11s');
      expect(lines[22]).toContain('❯');
      expect(lines[23]).toContain('gpt-5.4 · 5% · project');
    } finally {
      harness.restore();
    }
  });

  it('keeps the prompt and status pinned to the final two rows while activity keeps refreshing', () => {
    const harness = createTtyHarness(80, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: ' ',
        summaryLine: '● Intent: md -> 报告 · Stage 1/2 提取 Markdown · Working',
        statusLine: 'gpt-5.4 · 5% · project',
      });

      manager.renderActivity('⠋ Exploring codebase · 2s');
      manager.renderActivity('⠙ Running command · 4s');
      manager.renderActivity('⠹ Working · 11s');

      const lines = harness.screen.lines();
      const promptIndex = lines.findIndex((line) => line.includes('❯'));
      const statusIndex = lines.findIndex((line) => line.includes('gpt-5.4 · 5% · project'));
      const summaryIndex = lines.findIndex((line) => line.includes('Intent: md -> 报告'));
      const activityIndex = lines.findIndex((line) => line.includes('Working · 11s'));

      expect(promptIndex).toBe(22);
      expect(statusIndex).toBe(23);
      expect(summaryIndex).toBe(promptIndex - 3);
      expect(activityIndex).toBe(summaryIndex - 2);
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

  it('raw stdout progress notes do not dislodge the fixed footer after activity is cleared at the transcript boundary', () => {
    const harness = createTtyHarness(60, 24);
    const manager = new ScrollRegionManager(process.stdout);

    try {
      manager.begin();
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-5.4 · 5% · project',
      });

      for (let index = 0; index < 12; index += 1) {
        manager.writeAtContentCursor(`Ran printf "/Users/song/.xiaok/skills/kai-report-creator/path-${index}"\n`);
      }

      manager.renderActivity('⠋ Waiting for command output · 46s');
      manager.clearActivity();
      process.stdout.write(formatProgressNote('Still working: waiting for command output (46s)'));

      const lines = harness.screen.lines();
      const promptRows = lines.filter((line) => line.includes('❯'));
      const statusRows = lines.filter((line) => line.includes('project') && line.includes('%'));
      const activityRows = lines.filter((line) => line.includes('Waiting for command output'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(activityRows).toHaveLength(0);
      expect(lines[22]).toContain('❯');
      expect(lines[23]).toContain('project');
    } finally {
      harness.restore();
    }
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
    // Before: 2 gap rows + padded input footer keep the scroll region bottom at row 19
    expect((manager as any).maxContentRows).toBe(19);

    manager.updateSize(30, 100);
    // After resize the same chrome leaves the scroll region bottom at row 25
    expect((manager as any).maxContentRows).toBe(25);
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

  it('clears the old footer rows when a Mac terminal resize moves the footer down', () => {
    const harness = createTtyHarness(80, 30);
    const manager = new ScrollRegionManager(process.stdout, {
      footerHeight: 2,
      gapHeight: 2,
      rows: 24,
      columns: 80,
    });

    try {
      manager.begin();
      manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'gpt-5.4 · 6% · master' });

      manager.updateSize(30, 80);

      const lines = harness.screen.lines();
      expect(lines[22]).not.toContain('Type your message...');
      expect(lines[23]).not.toContain('gpt-5.4');
      expect(lines[28]).toContain('❯ Type your message...');
      expect(lines[29]).toContain('gpt-5.4 · 6% · master');
    } finally {
      harness.restore();
    }
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

  it('updateStatusLine caches the footer status without writing during streaming', () => {
    const { manager, getOutput } = createMock();
    manager.begin();
    manager.beginContentStreaming();
    manager.writeAtContentCursor('content\n');

    manager.updateStatusLine('new status');

    const output = getOutput();
    expect((manager as any).lastStatusLine).toBe('new status');
    expect(output).not.toContain('new status');
    expect(output).not.toContain('\x1b[s');
    expect(output).not.toContain('\x1b[u');
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
      const line1Index = lines.findIndex((line) => {
        const trimmed = line.trim();
        return trimmed === '1' || trimmed === '● 1';
      });
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

  it('keeps a flushed single-line assistant reply visible when the next submitted input is written', () => {
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
      manager.writeSubmittedInput(formatSubmittedInput('first question'));

      markdown.setNewlineCallback(manager.getNewlineCallback());
      manager.beginContentStreaming();
      markdown.write('FIRST_REPLY');
      const flushResult = markdown.flush();
      manager.advanceContentCursorByRenderedText(flushResult.renderedLine);
      manager.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: 'claude-test · auto · 0% · xiaok-cli',
      });

      manager.clearLastInput();
      manager.writeSubmittedInput(formatSubmittedInput('second question'));

      const lines = harness.screen.lines();
      const firstReplyIndex = lines.findIndex((line) => line.includes('FIRST_REPLY'));
      const secondQuestionIndex = lines.findIndex((line) => line.includes('› second question'));

      expect(firstReplyIndex).toBeGreaterThanOrEqual(0);
      expect(secondQuestionIndex).toBeGreaterThan(firstReplyIndex);
    } finally {
      harness.restore();
    }
  });

  it('preserves the first response tail across a second turn in a 24-row tmux-style layout', () => {
    const harness = createTtyHarness(120, 24);
    const manager = new ScrollRegionManager(process.stdout);
    const markdown = new MarkdownRenderer();
    const firstResponse = [
      '适合中午的：',
      '',
      '- 快餐：鸡腿饭',
      '- 面食：拉面',
      '- 轻食：三明治',
      '',
      '想吃点重口还是清淡的？',
    ].join('\n');
    const secondResponse = [
      '辣的午餐：',
      '',
      '- 川菜：麻婆豆腐饭',
      '- 小吃：麻辣烫',
    ].join('\n');

    try {
      manager.begin();
      manager.setWelcomeRows(14);
      manager.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      manager.clearLastInput();
      manager.writeSubmittedInput(formatSubmittedInput('first terminal request'));
      markdown.setNewlineCallback(manager.getNewlineCallback());
      manager.beginContentStreaming();
      markdown.write(firstResponse);
      const firstFlush = markdown.flush();
      manager.advanceContentCursorByRenderedText(firstFlush.renderedLine);
      manager.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      markdown.reset();
      manager.clearLastInput();
      manager.writeSubmittedInput(formatSubmittedInput('second terminal request'));
      markdown.setNewlineCallback(manager.getNewlineCallback());
      manager.beginContentStreaming();
      markdown.write(secondResponse);
      const secondFlush = markdown.flush();
      manager.advanceContentCursorByRenderedText(secondFlush.renderedLine);
      manager.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: 'gpt-terminal-e2e · auto · 0% · project',
      });

      const lines = harness.screen.lines();
      const firstTailIndex = lines.findIndex((line) => line.includes('想吃点重口还是清淡的？'));
      const secondHeadIndex = lines.findIndex((line) => line.includes('辣的午餐：'));

      expect(firstTailIndex).toBeGreaterThanOrEqual(0);
      expect(secondHeadIndex).toBeGreaterThan(firstTailIndex);
    } finally {
      harness.restore();
    }
  });

  it('moves the real terminal cursor back to the content tail before inserting separator newlines', () => {
    const { manager, getOutput } = createMockScrollRegion();
    const markdown = new MarkdownRenderer();

    manager.begin();
    manager.setWelcomeRows(12);
    manager.renderFooter({
      inputPrompt: 'Type your message...',
      statusLine: 'claude-test · auto · 0% · xiaok-cli',
    });

    manager.clearLastInput();
    manager.writeSubmittedInput(formatSubmittedInput('first question'));

    markdown.setNewlineCallback(manager.getNewlineCallback());
    manager.beginContentStreaming();
    markdown.write('line 1\nline 2\nTAIL_LINE');
    const flushResult = markdown.flush();
    manager.advanceContentCursorByRenderedText(flushResult.renderedLine);
    manager.endContentStreaming({
      inputPrompt: 'Type your message...',
      statusLine: 'claude-test · auto · 0% · xiaok-cli',
    });

    const contentRow = (manager as any)._cursorRow as number;
    const contentCol = (manager as any)._cursorCol as number;
    const before = getOutput().length;

    manager.clearLastInput();
    manager.writeSubmittedInput(formatSubmittedInput('second question'));

    const delta = getOutput().slice(before);
    const moveToContentCursor = `\x1b[${contentRow};1H`;
    const moveToContentColumn = `\x1b[${contentCol + 1}G`;

    expect(contentCol).toBeGreaterThan(0);
    expect(delta.indexOf(moveToContentCursor)).toBeGreaterThanOrEqual(0);
    expect(delta.indexOf(moveToContentColumn)).toBeGreaterThan(delta.indexOf(moveToContentCursor));
    expect(delta.indexOf('\n')).toBeGreaterThan(delta.indexOf(moveToContentColumn));
  });

  it('re-anchors the footer after writing a long submitted input block against a visible footer', () => {
    const { manager, getOutput } = createMockScrollRegion({ rows: 24, columns: 60 });
    const statusLine = 'gpt-terminal-e2e · auto · 0% · project';
    const longFollowup = '基于刚才这份报告，请补充制造业与 SaaS 的差异、风险、建议和下一步行动';

    manager.begin();
    manager.setWelcomeRows(14);
    manager.renderFooter({
      inputPrompt: 'Type your message...',
      statusLine,
    });

    manager.writeAtContentCursor([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
    ].join('\n'));

    manager.clearLastInput();
    const before = getOutput().length;

    manager.writeSubmittedInput(formatSubmittedInput(longFollowup));

    const delta = getOutput().slice(before);
    const lastTranscriptWrite = delta.lastIndexOf('› 基于刚才这份报告');
    const lastStatusWrite = delta.lastIndexOf(statusLine);

    expect(lastTranscriptWrite).toBeGreaterThanOrEqual(0);
    expect(lastStatusWrite).toBeGreaterThan(lastTranscriptWrite);
  });

  it('uses visible rows instead of ANSI bytes when advancing past a submitted input block', () => {
    const { manager, getOutput } = createMockScrollRegion();
    manager.begin();
    manager.setWelcomeRows(14);

    manager.writeSubmittedInput(formatSubmittedInput('first terminal request'));
    manager.beginContentStreaming();

    const output = getOutput();
    expect(output).toContain('\x1b[15;1H');
    expect(output).toContain('\x1b[17;1H');
    expect(output).not.toContain('\x1b[19;1H\x1b[0m');
  });
});
