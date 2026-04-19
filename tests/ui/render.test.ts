import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  formatProgressNote,
  formatSubmittedInput,
  formatToolActivity,
  renderInputSeparator,
  renderInputPrompt,
  renderWelcomeScreen,
  setColorsEnabled,
  formatHistoryBlock,
  type HistoryMessageBlock,
} from '../../src/ui/render.js';

describe('renderInputSeparator', () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    }
  });

  it('should render separator with correct width for small terminal', () => {
    process.stdout.columns = 60;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be min(60 - 2, 100) = 58
    // Should contain 58 dashes plus newline
    expect(output).toContain('─'.repeat(58));
    expect(output).toMatch(/\n$/);
  });

  it('should render separator with correct width for large terminal', () => {
    process.stdout.columns = 120;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be min(120 - 2, 100) = 100
    expect(output).toContain('─'.repeat(100));
  });

  it('should cap separator width at 100', () => {
    process.stdout.columns = 200;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be capped at 100
    expect(output).toContain('─'.repeat(100));
    expect(output).not.toContain('─'.repeat(101));
  });
});

describe('renderInputPrompt', () => {
  it('should render only prompt without separator', () => {
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputPrompt();

    process.stdout.write = originalWrite;

    // Should only contain the > prompt, not the separator
    expect(output).toContain('>');
    expect(output).not.toContain('─');
    // Should NOT end with newline
    expect(output).not.toMatch(/\n$/);
  });
});

describe('formatSubmittedInput', () => {
  it('renders the submitted input as a distinct user block with full-width background', () => {
    setColorsEnabled(false);
    const output = formatSubmittedInput('安装 https://github.com/kaisersong/slide-creator 技能');

    // No longer has "You" label - just the input with › prefix and full-width background
    expect(output).toContain('›');
    expect(output).toContain('安装 https://github.com/kaisersong/slide-creator 技能');
    expect(output.match(/\n/g)?.length ?? 0).toBe(1);
    setColorsEnabled(true);
  });
});

describe('formatProgressNote', () => {
  it('renders subtle secondary status lines with a consistent gutter', () => {
    setColorsEnabled(false);
    expect(formatProgressNote('Still working: tracing code paths and references (48s)'))
      .toContain('  · Still working: tracing code paths and references (48s)\n');
    setColorsEnabled(true);
  });
});

describe('formatToolActivity', () => {
  it('formats web fetch with its target on a single line', () => {
    expect(formatToolActivity('web_fetch', { url: 'https://example.com/very/long/path' }, 120))
      .toBe('• 获取网页 https://example.com/very/long/path');
  });

  it('hides low-signal file inspection activity by default', () => {
    expect(formatToolActivity('read', { file_path: '/tmp/demo/README.md' }, 120)).toBe('');
    expect(formatToolActivity('glob', { pattern: '/tmp/demo/**/*.ts' }, 120)).toBe('');
    expect(formatToolActivity('tool_search', { query: 'select:skill,bash,read' }, 120)).toBe('');
    expect(formatToolActivity('skill', { name: 'kai-report-creator' }, 120)).toBe('');
  });

  it('hides exploratory bash commands by default', () => {
    const output = formatToolActivity('bash', { command: 'ls -la ~/.claude/skills && echo --- && test -d ~/.claude' }, 120);

    expect(output).toBe('');
  });

  it('keeps meaningful side-effect tool activity concise', () => {
    expect(formatToolActivity('write', { file_path: '/tmp/demo/report.md' }, 120))
      .toBe('• 写入文件 report.md');
    expect(formatToolActivity('bash', { command: 'python3 export-pptx.py slides.html slides.pptx' }, 120))
      .toBe('• 执行命令 导出 PPT');
  });

  it('supports localized human labels for tool activity', () => {
    const output = formatToolActivity('web_fetch', { url: 'https://example.com' }, 120, 'en');

    expect(output).toBe('• Fetch page https://example.com');
  });
});

describe('renderWelcomeScreen', () => {
  let originalColumns: number | undefined;
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalConsoleLog = console.log;
    setColorsEnabled(false);
  });

  afterEach(() => {
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    }
    console.log = originalConsoleLog;
  });

  it('renders version below the session info in the original welcome layout', () => {
    process.stdout.columns = 100;

    const lines: string[] = [];
    console.log = ((...args: unknown[]) => {
      lines.push(args.join(' '));
    }) as typeof console.log;

    renderWelcomeScreen({
      model: 'gpt-5.4',
      cwd: '/Users/song/projects/xiaok-cli',
      sessionId: 'session-123',
      mode: 'default',
      version: '0.1.4',
    });

    const welcomeLineIndex = lines.findIndex((line) => line.includes('欢迎使用 xiaok code!'));
    const sessionLineIndex = lines.findIndex((line) => line.includes('Session: session-123'));
    const versionLineIndex = lines.findIndex((line) => line.includes('Version: 0.1.4'));

    expect(welcomeLineIndex).toBeGreaterThanOrEqual(0);
    expect(sessionLineIndex).toBeGreaterThanOrEqual(0);
    expect(versionLineIndex).toBe(sessionLineIndex + 1);
    // Logo is loaded from data/logo.txt which may not be available in test-dist
    // Skip logo assertion in test environment
  });

  it('does not emit carriage returns when loading the logo from a Windows CRLF file', () => {
    process.stdout.columns = 100;

    const lines: string[] = [];
    console.log = ((...args: unknown[]) => {
      lines.push(args.join(' '));
    }) as typeof console.log;

    renderWelcomeScreen({
      model: 'gpt-5.4',
      cwd: 'C:/Users/song',
      sessionId: 'session-crlf',
      mode: 'default',
      version: '0.6.0',
    });

    expect(lines.some((line) => line.includes('\r'))).toBe(false);
  });
});

describe('formatHistoryBlock', () => {
  beforeEach(() => {
    setColorsEnabled(false);
  });

  afterEach(() => {
    setColorsEnabled(true);
  });

  it('formats text blocks with submitted input styling', () => {
    const block: HistoryMessageBlock = { type: 'text', text: 'Hello world' };
    const output = formatHistoryBlock(block);

    expect(output).toContain('Hello world');
    expect(output).toContain('›');
  });

  it('formats thinking blocks as truncated summary', () => {
    const shortThinking: HistoryMessageBlock = { type: 'thinking', thinking: 'Short thought' };
    const shortOutput = formatHistoryBlock(shortThinking);

    expect(shortOutput).toContain('[Thinking]');
    expect(shortOutput).toContain('Short thought');

    const longThinking: HistoryMessageBlock = {
      type: 'thinking',
      thinking: 'This is a very long thinking block that should be truncated to 200 characters maximum because we do not want to show the entire thinking content in the history output as it would take up too much space and make the resume output cluttered and hard to read.',
    };
    const longOutput = formatHistoryBlock(longThinking);

    expect(longOutput).toContain('[Thinking]');
    expect(longOutput.length).toBeLessThan(300); // Should be truncated
    expect(longOutput).toContain('...');
  });

  it('formats tool_use blocks as activity summary', () => {
    const block: HistoryMessageBlock = {
      type: 'tool_use',
      id: 'tool-123',
      name: 'write',
      input: { file_path: '/tmp/test.md' },
    };
    const output = formatHistoryBlock(block);

    // Should show the tool activity summary
    expect(output).toContain('↳');
    expect(output).toContain('test.md');
  });

  it('formats tool_result blocks as truncated summary', () => {
    const shortResult: HistoryMessageBlock = {
      type: 'tool_result',
      tool_use_id: 'tool-123',
      content: 'Success',
    };
    const shortOutput = formatHistoryBlock(shortResult);

    expect(shortOutput).toContain('Tool result');
    expect(shortOutput).toContain('Success');
    expect(shortOutput).not.toContain('error');

    const errorResult: HistoryMessageBlock = {
      type: 'tool_result',
      tool_use_id: 'tool-123',
      content: 'Failed',
      is_error: true,
    };
    const errorOutput = formatHistoryBlock(errorResult);

    expect(errorOutput).toContain('error');

    const longResult: HistoryMessageBlock = {
      type: 'tool_result',
      tool_use_id: 'tool-123',
      content: 'This is a very long tool result that should be truncated to 100 characters maximum because we want to keep the history display concise and readable without overwhelming the user with too much output content from previous tool executions.',
    };
    const longOutput = formatHistoryBlock(longResult);

    expect(longOutput).toContain('...');
    // Should be truncated around 100 chars + prefix
    expect(longOutput.length).toBeLessThan(200);
  });

  it('formats image blocks as placeholder', () => {
    const block: HistoryMessageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    };
    const output = formatHistoryBlock(block);

    expect(output).toContain('[Image]');
    expect(output).toContain('↳');
  });

  it('returns empty string for unknown block types', () => {
    // Cast to bypass TypeScript - simulating unknown type
    const block = { type: 'unknown' } as HistoryMessageBlock;
    const output = formatHistoryBlock(block);

    expect(output).toBe('');
  });
});
