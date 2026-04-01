import { describe, it, expect } from 'vitest';
import {
  buildPermissionRequest,
  deriveRule,
  formatPermissionDecisionSummary,
  formatPermissionPromptLines,
  showPermissionPrompt,
} from '../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../support/tty.js';
import type { TranscriptLogger } from '../../src/ui/transcript.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';

describe('permission-prompt', () => {
  describe('deriveRule', () => {
    it('derives bash rule from command', () => {
      expect(deriveRule('bash', { command: 'npm install express' })).toBe('bash(npm *)');
    });

    it('derives bash rule from single-word command', () => {
      expect(deriveRule('bash', { command: 'ls' })).toBe('bash(ls *)');
    });

    it('derives write rule from file_path', () => {
      expect(deriveRule('write', { file_path: 'src/utils/config.ts' })).toBe('write(src/utils/*)');
    });

    it('derives edit rule from file_path', () => {
      expect(deriveRule('edit', { file_path: 'src/index.ts' })).toBe('edit(src/*)');
    });

    it('falls back to bare tool name when no target', () => {
      expect(deriveRule('bash', {})).toBe('bash');
    });

    it('derives from path parameter', () => {
      expect(deriveRule('glob', { path: '/Users/song/projects/foo/bar.ts' })).toBe('glob(/Users/song/projects/foo/*)');
    });
  });

  describe('formatPermissionDecisionSummary', () => {
    it('does not echo allow decisions back into the transcript by default', () => {
      expect(formatPermissionDecisionSummary({ action: 'allow_once' })).toBe('');
      expect(formatPermissionDecisionSummary({ action: 'allow_session', rule: 'bash(ls *)' })).toBe('');
      expect(formatPermissionDecisionSummary({ action: 'allow_project', rule: 'bash(ls *)' })).toBe('');
      expect(formatPermissionDecisionSummary({ action: 'allow_global', rule: 'web_fetch' })).toBe('');
    });

    it('does not echo deny decisions back into the transcript by default', () => {
      expect(formatPermissionDecisionSummary({ action: 'deny' })).toBe('');
    });
  });

  describe('formatPermissionPromptLines', () => {
    it('renders a compact left-aligned prompt without leading blank lines', () => {
      const lines = formatPermissionPromptLines(
        'bash',
        { command: 'ls -la ~/.claude/skills && echo --- && test -d ~/.claude' },
        [
          { label: '允许一次', selected: true },
          { label: '始终允许 bash(ls *) (保存到全局)', selected: false },
        ],
      );

      expect(lines[0]).toContain('xiaok 想要执行以下操作');
      expect(lines[0]?.startsWith('  ')).toBe(false);
      expect(lines.some((line) => line === '')).toBe(false);
    });

    it('renders tool metadata as compact single-line key value rows', () => {
      const lines = formatPermissionPromptLines(
        'web_fetch',
        { path: 'https://example.com/deep/path' },
        [{ label: '允许一次', selected: true }],
      );

      expect(lines).toContain('工具: web_fetch');
      expect(lines).toContain('路径: https://example.com/deep/path');
    });

    it('collapses multiline command input into a single visible row', () => {
      const lines = formatPermissionPromptLines(
        'bash',
        { command: "python3 - <<'PY'\nimport importlib\nprint('ok')\nPY" },
        [{ label: '允许一次', selected: true }],
      );

      const commandLine = lines.find((line) => line.includes('命令:'));
      expect(commandLine).toBeDefined();
      expect(commandLine).toContain("python3 - <<'PY' import importlib print('ok') PY");
      expect(commandLine?.includes('\n')).toBe(false);
    });

    it('keeps the footer hint left-aligned and compact', () => {
      const lines = formatPermissionPromptLines(
        'bash',
        { command: 'ls' },
        [{ label: '允许一次', selected: true }],
      );

      expect(lines.at(-1)).toContain('↑↓ 选择  Enter 确认  Esc 取消');
      expect(lines.at(-1)?.startsWith('  ')).toBe(false);
    });

    it('supports english prompt copy without changing layout structure', () => {
      const lines = formatPermissionPromptLines(
        'bash',
        { command: 'ls' },
        [{ label: 'Allow once', selected: true }],
        'en',
      );

      expect(lines[0]).toContain('xiaok wants to run');
      expect(lines).toContain('Tool: bash');
      expect(lines).toContain('Command: ls');
      expect(lines.at(-1)).toContain('Up/Down select  Enter confirm  Esc cancel');
    });
  });

  describe('buildPermissionRequest', () => {
    it('builds one shared request shape for terminal and remote approval flows', () => {
      expect(buildPermissionRequest('bash', { command: 'git status' })).toMatchObject({
        toolName: 'bash',
        summary: expect.stringContaining('git status'),
      });
    });
  });

  describe('interactive replay', () => {
    it('re-renders the same approval block instead of accumulating duplicate rows while navigating', async () => {
      const harness = createTtyHarness();

      const pending = showPermissionPrompt('bash', { command: "python3 - <<'PY'\nimport importlib\nPY" });
      harness.send('\x1b[B');
      harness.send('\x1b[B');
      harness.send('\r');

      await expect(pending).resolves.toEqual({ action: 'allow_project', rule: 'bash(python3 *)' });

      const normalized = harness.output.normalized;
      const titleCount = normalized.split('xiaok 想要执行以下操作').length - 1;
      expect(titleCount).toBe(3);
      expect(normalized).not.toContain("命令: python3 - <<'PY'\nimport importlib\nPY");

      harness.restore();
    });

    it('records prompt navigation and final decision to the transcript logger', async () => {
      const harness = createTtyHarness();
      const events: Array<Record<string, unknown>> = [];
      const logger: TranscriptLogger = {
        record(event) {
          events.push(event as Record<string, unknown>);
        },
        recordOutput() {},
      };

      const pending = showPermissionPrompt('bash', { command: 'ls' }, { transcriptLogger: logger });
      harness.send('\x1b[B');
      harness.send('\r');

      await expect(pending).resolves.toEqual({ action: 'allow_session', rule: 'bash(ls *)' });
      expect(events.some((event) => event.type === 'permission_prompt_open')).toBe(true);
      expect(events.some((event) => event.type === 'permission_prompt_navigate' && event.direction === 'down')).toBe(true);
      expect(events.some((event) => event.type === 'permission_prompt_decision' && event.action === 'allow_session')).toBe(true);

      harness.restore();
    });

    it('re-renders the approval block in place when used with the shared repl renderer', async () => {
      const harness = createTtyHarness();
      const renderer = new ReplRenderer(process.stdout);

      renderer.renderInput({
        prompt: '> ',
        input: '写一个xiaok code介绍的md，然后生成',
        cursor: '写一个xiaok code介绍的md，然后生成'.length,
        overlayLines: [],
      });

      const pending = showPermissionPrompt(
        'write',
        { file_path: '/Users/song/projects/xiaok-code-intro.md' },
        { renderer },
      );

      harness.send('\x1b[B');
      harness.send('\x1b[B');

      expect(harness.screen.lines()).toEqual([
        '> 写一个xiaok code介绍的md，然后生成',
        '⚡ xiaok 想要执行以下操作',
        '工具: write',
        '文件: /Users/song/projects/xiaok-code-intro.md',
        '  允许一次',
        '  本次会话始终允许 write(/Users/song/projects/*)',
        '❯ 始终允许 write(/Users/song/projects/*) (保存到项目)',
        '  始终允许 write(/Users/song/projects/*) (保存到全局)',
        '  拒绝',
        '↑↓ 选择  Enter 确认  Esc 取消',
      ]);

      harness.send('\r');
      await expect(pending).resolves.toEqual({ action: 'allow_project', rule: 'write(/Users/song/projects/*)' });

      harness.restore();
    });

    it('preserves already submitted output when the renderer is in block-output mode', async () => {
      const harness = createTtyHarness();
      const renderer = new ReplRenderer(process.stdout);

      renderer.prepareBlockOutput();
      process.stdout.write('──────────────────────────────────────────────────────────────────────────────\n');
      process.stdout.write(' 用户输入内容 \n');

      const pending = showPermissionPrompt(
        'bash',
        { command: 'git status --short' },
        { renderer },
      );

      harness.send('\r');
      await expect(pending).resolves.toEqual({ action: 'allow_once' });

      const screen = harness.screen.text();
      expect(screen).toContain('用户输入内容');
      expect(screen).toContain('xiaok 想要执行以下操作');

      harness.restore();
    });
  });
});
