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

    it('extracts the project name from a Windows cwd instead of showing the full path', () => {
      statusBar.init('kimi-for-coding', 'test123', 'C:\\Users\\song\\AppData\\Local\\Temp\\xiaok-terminal-e2e-vn9vdd5o\\project');
      statusBar.update({ inputTokens: 100, outputTokens: 100, budget: 200000 });

      const line = statusBar.getStatusLine();
      expect(line).toContain('project');
      expect(line).not.toContain('C:\\Users\\song\\AppData\\Local\\Temp');
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

  describe('live activity', () => {
    beforeEach(() => {
      statusBar.init('claude-opus-4-6', 'test123', '/Users/song/projects/xiaok-cli');
      statusBar.update({ inputTokens: 1000, outputTokens: 500, budget: 200000 });
    });

    it('renders animated live activity with elapsed time while a run is active', () => {
      statusBar.beginActivity('Exploring codebase', 0);

      const line = statusBar.getLiveStatusLine(24_000, 1);

      expect(line).toContain('Digging through repo');
      expect(line).toContain('24s');
      expect(line).toContain('xiaok-cli');
      expect(line).toContain('claude-opus-4-6');
    });

    it('exposes the activity line for scroll-region renderers', () => {
      statusBar.beginActivity('Exploring codebase', 0);

      const line = statusBar.getActivityLine(24_000, 1);

      expect(line).toContain('Digging through repo');
      expect(line).toContain('24s');
      expect(line).not.toContain('xiaok-cli');
      expect(line).not.toContain('claude-opus-4-6');
    });

    it('suppresses live activity for very short operations to avoid flicker', () => {
      statusBar.beginActivity('Thinking', 0);

      expect(statusBar.getLiveStatusLine(300, 0)).toBe('');
      expect(statusBar.getLiveStatusLine(800, 0)).toContain('Thinking');
    });

    it('upgrades generic thinking copy during long waits', () => {
      statusBar.beginActivity('Thinking', 0);

      const line = statusBar.getLiveStatusLine(16_000, 0);

      expect(line).toContain('Still working');
      expect(line).toContain('16s');
    });

    it('reaches a finalizing stage for very long generic waits', () => {
      statusBar.beginActivity('Thinking', 0);

      const line = statusBar.getLiveStatusLine(95_000, 0);

      expect(line).toContain('Finalizing response');
      expect(line).toContain('1m 35s');
    });

    it('adds a deeper long-wait stage for repo exploration', () => {
      statusBar.beginActivity('Exploring codebase', 0);

      const line = statusBar.getLiveStatusLine(48_000, 0);

      expect(line).toContain('Tracing references');
      expect(line).toContain('48s');
    });

    it('adds a deeper long-wait stage for file updates', () => {
      statusBar.beginActivity('Updating files', 0);

      const line = statusBar.getLiveStatusLine(41_000, 0);

      expect(line).toContain('Finishing edits');
      expect(line).toContain('41s');
    });

    it('adds a deeper long-wait stage for verification', () => {
      statusBar.beginActivity('Running verification', 0);

      const line = statusBar.getLiveStatusLine(52_000, 0);

      expect(line).toContain('Checking for regressions');
      expect(line).toContain('52s');
    });

    it('adds long-wait stages for skill updates', () => {
      statusBar.beginActivity('Updating skills', 0);

      const line = statusBar.getLiveStatusLine(34_000, 0);

      expect(line).toContain('Refreshing skill catalog');
      expect(line).toContain('34s');
    });

    it('adds long-wait stages for presentation export', () => {
      statusBar.beginActivity('Exporting presentation', 0);

      const line = statusBar.getLiveStatusLine(22_000, 0);

      expect(line).toContain('Packaging slides');
      expect(line).toContain('22s');
    });

    it('adds long-wait stages for workspace inspection', () => {
      statusBar.beginActivity('Inspecting workspace', 0);

      const line = statusBar.getLiveStatusLine(37_000, 0);

      expect(line).toContain('Reviewing findings');
      expect(line).toContain('37s');
    });

    it('adds long-wait stages for local command execution', () => {
      statusBar.beginActivity('Running command', 0);

      const line = statusBar.getLiveStatusLine(24_000, 0);

      expect(line).toContain('Waiting for command output');
      expect(line).toContain('24s');
    });

    it('keeps generic work states feeling active during long waits', () => {
      statusBar.beginActivity('Working', 0);

      const line = statusBar.getLiveStatusLine(33_000, 0);

      expect(line).toContain('Making progress');
      expect(line).toContain('33s');
    });

    it('emits low-frequency reassurance copy for long-running exploration', () => {
      statusBar.beginActivity('Exploring codebase', 0);

      const tick = statusBar.getReassuranceTick(48_000, -1);

      expect(tick?.bucket).toBe(2);
      expect(tick?.line).toContain('Still working');
      expect(tick?.line).toContain('tracing code paths and references');
      expect(tick?.line).toContain('48s');
    });

    it('emits targeted reassurance copy for command execution', () => {
      statusBar.beginActivity('Running command', 0);

      const tick = statusBar.getReassuranceTick(44_000, -1);

      expect(tick?.bucket).toBe(2);
      expect(tick?.line).toContain('Still working');
      expect(tick?.line).toContain('waiting for command output');
      expect(tick?.line).toContain('44s');
    });

    it('does not emit duplicate reassurance for the same time bucket', () => {
      statusBar.beginActivity('Thinking', 0);

      expect(statusBar.getReassuranceTick(25_000, 1)).toBeNull();
    });

    it('stops rendering live activity after the run ends', () => {
      statusBar.beginActivity('Thinking', 0);
      statusBar.endActivity();

      expect(statusBar.getLiveStatusLine(10_000, 0)).toBe('');
    });

    it('captures an activity snapshot so paused UI flows can resume the same status', () => {
      statusBar.beginActivity('Thinking', 1_234);

      expect(statusBar.getActivitySnapshot()).toEqual({
        label: 'Thinking',
        startedAt: 1_234,
      });

      statusBar.endActivity();
      expect(statusBar.getActivitySnapshot()).toBeNull();
    });
  });
});
