import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  formatSubmittedInput,
  formatToolActivity,
  renderInputSeparator,
  renderInputPrompt,
  renderWelcomeScreen,
  setColorsEnabled,
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
  it('renders a single highlighted line without extra blank lines', () => {
    const output = formatSubmittedInput('安装 https://github.com/kaisersong/slide-creator 技能');

    expect(output).toContain('安装 https://github.com/kaisersong/slide-creator 技能');
    expect(output.match(/\n/g)?.length ?? 0).toBe(1);
  });
});

describe('formatToolActivity', () => {
  it('formats web fetch with its target on a single line', () => {
    expect(formatToolActivity('web_fetch', { url: 'https://example.com/very/long/path' }, 120))
      .toBe('• 获取网页 https://example.com/very/long/path');
  });

  it('formats bash with command preview and truncates long content', () => {
    const output = formatToolActivity('bash', { command: 'ls -la ~/.claude/skills && echo --- && test -d ~/.claude' }, 36);

    expect(output.startsWith('• 执行命令 ls -la ~/.claude/skills')).toBe(true);
    expect(output.endsWith('...')).toBe(true);
    expect(output.includes('\n')).toBe(false);
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

  it('renders version below the session info', () => {
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

    const sessionLineIndex = lines.findIndex((line) => line.includes('Session: session-123'));
    const versionLineIndex = lines.findIndex((line) => line.includes('Version: 0.1.4'));

    expect(sessionLineIndex).toBeGreaterThanOrEqual(0);
    expect(versionLineIndex).toBe(sessionLineIndex + 1);
  });
});
