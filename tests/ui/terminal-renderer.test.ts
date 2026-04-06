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
    expect(frame.lines[0]).toMatch(/\x1b\[48;5;244m.*❯/);
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

  it('renders multiline input with correct cursor position', () => {
    // 输入 "第一行\n第二行" 光标在第二行末尾（offset=9）
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '第一行\n第二行', cursorOffset: 9, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    // 应该有两行输入
    expect(frame.lines.length).toBe(2);
    // 第一行包含 prompt
    expect(frame.lines[0]).toMatch(/❯.*第一行/);
    // 第二行是纯文本（无 prompt）
    expect(frame.lines[1]).toMatch(/第二行/);
    // 光标应该在第二行（line=1）
    expect(frame.cursor?.line).toBe(1);
    // 光标列应该是 "❯ " 的宽度 + "第二行" 的显示宽度（3个汉字=6列）
    // 但实际光标在 offset=9，即 "第一行\n第二行" 的末尾
    // 光标列 = 2 (prefix) + 6 (display width of "第二行") = 8
    expect(frame.cursor?.column).toBe(8);
  });

  it('renders multiline input with cursor in middle of second line', () => {
    // 输入 "第一行\n第二行" 光标在第二行开头（offset=4，即换行符后）
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '第一行\n第二行', cursorOffset: 4, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    // 光标应该在第二行（line=1）开头
    expect(frame.cursor?.line).toBe(1);
    // 光标列 = 2 (prefix) + 0 (光标在行首) = 2
    expect(frame.cursor?.column).toBe(2);
  });

  it('renders multiline input with cursor on first line', () => {
    // 输入 "第一行\n第二行" 光标在第一行末尾（offset=3）
    const frame = buildTerminalFrame({
      prompt: '> ',
      transcript: [],
      input: { value: '第一行\n第二行', cursorOffset: 3, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    });

    // 光标应该在第一行（line=0）
    expect(frame.cursor?.line).toBe(0);
    // 光标列 = 2 (prefix) + 6 (display width of "第一行") = 8
    expect(frame.cursor?.column).toBe(8);
  });
});
