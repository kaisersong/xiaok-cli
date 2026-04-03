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

    expect(frame.lines[0]).toBe('> 为什么没有调用kai-report-creator');
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

    expect(frame.lines).toEqual([
      '> ',
      '  xiaok-cli · claude-sonnet-4 · 1%',
    ]);
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

    expect(frame.lines).toEqual([
      '> /c',
      '  /clear  Clear the screen',
    ]);
    expect(frame.cursor).toEqual({ line: 0, column: 4 });
  });
});
