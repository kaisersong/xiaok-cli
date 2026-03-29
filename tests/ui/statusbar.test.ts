import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusBar } from '../../src/ui/statusbar.js';

describe('StatusBar', () => {
  let statusBar: StatusBar;
  let originalIsTTY: boolean | undefined;
  let originalRows: number | undefined;
  let originalColumns: number | undefined;
  let stderrOutput: string;

  beforeEach(() => {
    statusBar = new StatusBar();
    originalIsTTY = process.stdout.isTTY;
    originalRows = process.stdout.rows;
    originalColumns = process.stdout.columns;

    // Mock TTY environment
    process.stdout.isTTY = true;
    process.stdout.rows = 24;
    process.stdout.columns = 80;

    // Capture stderr output
    stderrOutput = '';
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      stderrOutput += chunk;
      return true;
    }) as any;
  });

  afterEach(() => {
    if (originalIsTTY !== undefined) {
      process.stdout.isTTY = originalIsTTY;
    }
    if (originalRows !== undefined) {
      process.stdout.rows = originalRows;
    }
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    }
  });

  describe('init', () => {
    it('should set scroll region from line 1 to rows-3', () => {
      // Need to capture stderr before init and ensure NO_COLOR is not set
      delete process.env.NO_COLOR;
      process.stdout.isTTY = true;

      let capturedOutput = '';
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        capturedOutput += chunk;
        return true;
      }) as any;

      // Create new instance after setting up environment
      const bar = new StatusBar();
      bar.init('claude-opus-4-6', 'test123');

      process.stderr.write = originalWrite;

      // Should set scroll region: ESC[1;21r (line 1 to line 21, leaving 3 lines for separator/input/status)
      expect(capturedOutput).toContain('\x1b[1;21r');
    });

    it('should render status bar after init', () => {
      statusBar.init('claude-opus-4-6', 'test123');

      // Should position cursor at last row and render
      expect(stderrOutput).toContain('\x1b[24;1H');
      expect(stderrOutput).toContain('claude-opus-4-6');
      expect(stderrOutput).toContain('test123');
    });

    it('should handle different terminal sizes', () => {
      process.stdout.rows = 40;
      stderrOutput = '';

      statusBar.init('gpt-4o', 'abc456');

      // Should set scroll region to line 1 to 37 (40 - 3)
      expect(stderrOutput).toContain('\x1b[1;37r');
      // Should position at line 40
      expect(stderrOutput).toContain('\x1b[40;1H');
    });
  });

  describe('render', () => {
    beforeEach(() => {
      statusBar.init('claude-opus-4-6', 'test123');
      stderrOutput = ''; // Clear init output
    });

    it('should position status bar at bottom row', () => {
      statusBar.render();

      expect(stderrOutput).toContain('\x1b[24;1H');
    });

    it('should clear line before rendering', () => {
      statusBar.render();

      // Should contain clear line sequence
      expect(stderrOutput).toContain('\x1b[K');
    });

    it('should display model name', () => {
      statusBar.render();

      expect(stderrOutput).toContain('claude-opus-4-6');
    });

    it('should display session id', () => {
      statusBar.render();

      expect(stderrOutput).toContain('test123');
    });

    it('should display token usage', () => {
      statusBar.update({ inputTokens: 1234, outputTokens: 5678 });
      stderrOutput = '';

      statusBar.render();

      // Total tokens: 6912, displayed as 6.9k
      expect(stderrOutput).toContain('6.9k tokens');
    });

    it('should update model name', () => {
      statusBar.updateModel('gpt-4o');
      stderrOutput = '';

      statusBar.render();

      expect(stderrOutput).toContain('gpt-4o');
      expect(stderrOutput).not.toContain('claude-opus-4-6');
    });
  });

  describe('destroy', () => {
    it('should reset scroll region', () => {
      statusBar.init('claude-opus-4-6', 'test123');
      stderrOutput = '';

      statusBar.destroy();

      // Should reset scroll region: ESC[r
      expect(stderrOutput).toContain('\x1b[r');
    });

    it('should clear status bar line', () => {
      statusBar.init('claude-opus-4-6', 'test123');
      stderrOutput = '';

      statusBar.destroy();

      expect(stderrOutput).toContain('\x1b[24;1H');
      expect(stderrOutput).toContain('\x1b[K');
    });
  });
});
