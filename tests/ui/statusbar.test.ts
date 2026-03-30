import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StatusBar } from '../../src/ui/statusbar.js';

describe('StatusBar', () => {
  let statusBar: StatusBar;
  let originalIsTTY: boolean | undefined;
  let originalColumns: number | undefined;
  let stdoutOutput: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalColumns = process.stdout.columns;

    // Mock TTY environment
    process.stdout.isTTY = true;
    process.stdout.columns = 80;
    delete process.env.NO_COLOR;

    // Create instance after setting up environment
    statusBar = new StatusBar();

    // Capture stdout output
    stdoutOutput = '';
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutOutput += chunk;
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    if (originalIsTTY !== undefined) {
      process.stdout.isTTY = originalIsTTY;
    }
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    }
  });

  describe('init', () => {
    it('should store model name and path', () => {
      statusBar.init('claude-sonnet-4', 'test123', '/Users/song/projects/xiaok-cli');

      const line = statusBar.getStatusLine();
      expect(line).toContain('xiaok-cli'); // project name
      expect(line).toContain('claude-sonnet-4');
    });

    it('should format status line with Codex style', () => {
      statusBar.init('claude-sonnet-4', 'test123', '/Users/song/projects/xiaok-cli');
      statusBar.update({ inputTokens: 1000, outputTokens: 500, budget: 200000 });

      const line = statusBar.getStatusLine();

      // 新格式：projectName · model · percentage
      expect(line).toContain('xiaok-cli');
      expect(line).toContain('claude-sonnet-4');
      expect(line).toContain('1%');
      expect(line).toContain(' · ');
    });

    it('should replace HOME directory with ~', () => {
      const homeDir = process.env.HOME || '/Users/song';
      statusBar.init('gpt-4o', 'test123', `${homeDir}/projects/test`);
      statusBar.update({ inputTokens: 100, outputTokens: 100, budget: 200000 });

      const line = statusBar.getStatusLine();
      expect(line).toContain('test'); // project name
      expect(line).toContain('0%');
    });
  });

  describe('render', () => {
    beforeEach(() => {
      statusBar.init('claude-sonnet-4', 'test123', '/Users/song/projects/xiaok-cli');
      stdoutOutput = ''; // Clear init output
    });

    it('should write status line to stdout with Codex format', () => {
      statusBar.update({ inputTokens: 1000, outputTokens: 500, budget: 200000 });
      statusBar.render();

      expect(stdoutOutput).toContain('xiaok-cli');
      expect(stdoutOutput).toContain('claude-sonnet-4');
      expect(stdoutOutput).toContain('1%');
    });

    it('should display high token usage correctly', () => {
      statusBar.update({ inputTokens: 50000, outputTokens: 50000, budget: 200000 });
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).toContain('50%');
    });

    it('should display near-full token usage', () => {
      statusBar.update({ inputTokens: 190000, outputTokens: 9000, budget: 200000 });
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).toContain('100%');
    });

    it('should update model name', () => {
      statusBar.updateModel('gpt-4o');
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).toContain('gpt-4o');
      expect(stdoutOutput).not.toContain('claude-sonnet-4');
    });
  });

  describe('destroy', () => {
    it('should be a no-op in inline mode', () => {
      statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');
      stdoutOutput = '';

      statusBar.destroy();

      // Inline status bar destroy is a no-op
      expect(stdoutOutput).toBe('');
    });
  });

  describe('disabled state', () => {
    it('should always be enabled', () => {
      process.stdout.isTTY = false;
      const bar = new StatusBar();
      bar.init('claude-sonnet-4', 'test123', '/Users/song/projects/xiaok-cli');
      bar.update({ inputTokens: 1000, outputTokens: 500, budget: 200000 });

      const line = bar.getStatusLine();
      expect(line).toContain('xiaok-cli');
      expect(line).toContain('claude-sonnet-4');
      expect(line).toContain('1%');
    });
  });

  describe('branch display', () => {
    beforeEach(() => {
      statusBar.init('claude-opus-4-6', 'test123', '/Users/song/projects/xiaok-cli');
    });

    it('should display branch when set', () => {
      statusBar.updateBranch('main');
      const line = statusBar.getStatusLine();

      expect(line).toContain('xiaok-cli');
      expect(line).toContain('claude-opus-4-6');
      expect(line).toContain('main');
    });

    it('should not display branch when not set', () => {
      const line = statusBar.getStatusLine();

      expect(line).toContain('xiaok-cli');
      expect(line).toContain('claude-opus-4-6');
      expect(line).not.toContain('main');
    });
  });

  describe('mode display', () => {
    it('shows non-default mode in the status line', () => {
      statusBar.init('claude-opus-4-6', 'test123', '/Users/song/projects/xiaok-cli');
      statusBar.updateMode('plan');

      const line = statusBar.getStatusLine();

      expect(line).toContain('plan');
    });
  });
});
