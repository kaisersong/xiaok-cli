import { describe, expect, it } from 'vitest';
import { buildTerminalFrame } from '../../src/ui/terminal-frame.js';

describe('terminal-frame', () => {
  it('renders prompt and input into one frame with cursor metadata', () => {
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '为什么没有调用kai-report-creator', cursorOffset: 25, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    // Prompt line now has background color and ❯ symbol
    expect(frame.lines[0]).toMatch(/❯.*为什么没有调用kai-report-creator/);
    // Cursor column: 2 (for "❯ ") + 32 (display width of Chinese input at offset 25)
    // Chinese chars are 2 columns each, so 8 Chinese = 16 cols + 17 ASCII = 17 cols = 33 total display width
    // But cursorOffset 25 means end of string, which is 32 display columns
    expect(frame.cursor).toEqual({ line: 0, column: 34 });
  });

  it('renders permission modal above the prompt region', () => {
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: 'hello', cursorOffset: 5, history: [] },
      footerLines: [],
      overlay: null,
      modal: {
        type: 'permission',
        toolName: 'write',
        targetLines: ['文件: /tmp/demo.txt'],
        options: ['允许一次', '拒绝'],
        selectedIndex: 0,
      },
      focusTarget: 'modal',
      terminalSize: { columns: 80, rows: 24 },
    });

    expect(frame.lines.some((line) => line.includes('工具:'))).toBe(true);
    // Note: ❯ is in the prompt line (with background), not a separate indicator
    expect(frame.lines.some((line) => line.includes('❯'))).toBe(true);
  });

  it('renders footer status below the prompt when there is no overlay', () => {
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '', cursorOffset: 0, history: [] },
      footerLines: ['  xiaok-cli · claude-sonnet-4 · 1%'],
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    // Prompt line now has background color and ❯ symbol
    expect(frame.lines.length).toBe(2);
    expect(frame.lines[0]).toMatch(/\x1b\[48;5;238m.*❯/);
    expect(frame.lines[1]).toBe('  xiaok-cli · claude-sonnet-4 · 1%');
    // Cursor should be at column 2 (after "❯ ")
    expect(frame.cursor).toEqual({ line: 0, column: 2 });
  });

  it('suppresses footer status when an overlay is visible', () => {
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '/c', cursorOffset: 2, history: [] },
      footerLines: ['  xiaok-cli · claude-sonnet-4 · 1%'],
      overlay: {
        type: 'lines',
        lines: ['  /clear  Clear the screen'],
      },
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    expect(frame.lines.length).toBe(2);
    // Prompt line has background and styled ❯, followed by /c
    expect(frame.lines[0]).toMatch(/❯.*\/c/);
    expect(frame.lines[1]).toBe('  /clear  Clear the screen');
    // Cursor should be at column 4 (after "❯ /c")
    expect(frame.cursor).toEqual({ line: 0, column: 4 });
  });
});
