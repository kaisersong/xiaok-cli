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
    it('should store model and session id', () => {
      statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');

      const line = statusBar.getStatusLine();
      expect(line).toContain('claude-opus-4-6');
      expect(line).toContain('test123');
    });

    it('should store mode if provided', () => {
      statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli', 'auto');

      const line = statusBar.getStatusLine();
      expect(line).toContain('[auto]');
    });

    it('should not show mode badge for default mode', () => {
      statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');

      const line = statusBar.getStatusLine();
      expect(line).not.toContain('[default]');
    });
  });

  describe('render', () => {
    beforeEach(() => {
      statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');
      stdoutOutput = ''; // Clear init output
    });

    it('should write status line to stdout', () => {
      statusBar.render();

      expect(stdoutOutput).toContain('claude-opus-4-6');
      expect(stdoutOutput).toContain('test123');
    });

    it('should include project name', () => {
      statusBar.render();

      expect(stdoutOutput).toContain('xiaok-cli');
    });

    it('should display model name', () => {
      statusBar.render();

      expect(stdoutOutput).toContain('claude-opus-4-6');
    });

    it('should display session id', () => {
      statusBar.render();

      expect(stdoutOutput).toContain('test123');
    });

    it('should display context percentage when budget is set', () => {
      statusBar.update({ inputTokens: 1234, outputTokens: 5678, budget: 100000 });
      stdoutOutput = '';

      statusBar.render();

      // Total tokens: 6912, budget: 100000, percentage: 7%
      expect(stdoutOutput).toContain('7%');
    });

    it('should not display percentage when budget is not set', () => {
      statusBar.update({ inputTokens: 1234, outputTokens: 5678 });
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).not.toContain('%');
    });

    it('should update model name', () => {
      statusBar.updateModel('gpt-4o');
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).toContain('gpt-4o');
      expect(stdoutOutput).not.toContain('claude-opus-4-6');
    });

    it('should display git branch when set', () => {
      statusBar.updateBranch('main');
      stdoutOutput = '';

      statusBar.render();

      expect(stdoutOutput).toContain('main');
    });

    it('should not display branch when not set', () => {
      statusBar.render();

      expect(stdoutOutput).toContain('claude-opus-4-6');
      expect(stdoutOutput).toContain('xiaok-cli');
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
    it('should return empty string when not TTY', () => {
      process.stdout.isTTY = false;
      const bar = new StatusBar();
      bar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');

      expect(bar.getStatusLine()).toBe('');
    });

    it('should return empty string when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const bar = new StatusBar();
      bar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');

      expect(bar.getStatusLine()).toBe('');
    });
  });
});
