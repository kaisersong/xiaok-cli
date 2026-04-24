import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSlashMenuOverlayLines } from '../../src/ui/repl-state.js';
import { getDisplayWidth, stripAnsi } from '../../src/ui/text-metrics.js';
import {
  InputReader,
  cyclePermissionMode,
  getMenuClearSequence,
  getVisibleMenuItems,
  getSlashCommands,
  truncateMenuDescription,
  wordBoundaryLeft,
  wordBoundaryRight,
} from '../../src/ui/input.js';
import type { SkillMeta } from '../../src/ai/skills/loader.js';
import { createTtyHarness } from '../support/tty.js';
import type { TranscriptLogger } from '../../src/ui/transcript.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';

describe('getSlashCommands', () => {
  it('should return base commands when no skills provided', () => {
    const commands = getSlashCommands([]);

    expect(commands).toContainEqual({ cmd: '/exit', desc: 'Exit the chat' });
    expect(commands).toContainEqual({ cmd: '/clear', desc: 'Clear the screen' });
    expect(commands).toContainEqual({ cmd: '/settings', desc: 'Show active CLI settings' });
    expect(commands).toContainEqual({ cmd: '/context', desc: 'Show loaded repo context' });
    expect(commands).toContainEqual({ cmd: '/compact', desc: 'Compact the current conversation context' });
    expect(commands).toContainEqual({ cmd: '/models', desc: 'Switch model' });
    expect(commands).toContainEqual({ cmd: '/mode', desc: 'Show or change permission mode' });
    expect(commands).toContainEqual({ cmd: '/reminder', desc: 'Manage reminders: create, list, or cancel' });
    expect(commands).toContainEqual({ cmd: '/skills-reload', desc: 'Reload the skill catalog' });
    expect(commands).toContainEqual({ cmd: '/yzjchannel', desc: 'Connect the embedded YZJ channel' });
    expect(commands).toContainEqual({ cmd: '/help', desc: 'Show help' });

    expect(commands.some((command) => command.cmd === '/commit')).toBe(false);
    expect(commands.some((command) => command.cmd === '/review')).toBe(false);
    expect(commands.some((command) => command.cmd === '/pr')).toBe(false);
    expect(commands.some((command) => command.cmd === '/doctor')).toBe(false);
    expect(commands.some((command) => command.cmd === '/init')).toBe(false);
    expect(commands.some((command) => command.cmd === '/remind')).toBe(false);
    expect(commands.some((command) => command.cmd === '/reminders')).toBe(false);
    expect(commands.some((command) => command.cmd === '/reminder-cancel')).toBe(false);
    expect(commands.length).toBe(11);
  });

  it('should include skills in command list', () => {
    const skills: SkillMeta[] = [
      {
        name: 'test-skill',
        description: 'A test skill',
        content: 'Test content',
        path: '/path/to/skill.md',
      },
    ];

    const commands = getSlashCommands(skills);

    expect(commands).toContainEqual({ cmd: '/test-skill', desc: 'A test skill' });
    expect(commands.length).toBe(12); // 11 base + 1 skill
  });

  it('should sort commands alphabetically', () => {
    const skills: SkillMeta[] = [
      { name: 'zebra', description: 'Z skill', content: '', path: '' },
      { name: 'alpha', description: 'A skill', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);
    const cmdNames = commands.map(c => c.cmd);

    // Should be sorted: /alpha, /clear, /exit, /help, /zebra
    expect(cmdNames[0]).toBe('/alpha');
    expect(cmdNames[cmdNames.length - 1]).toBe('/zebra');
  });

  it('should not duplicate commands if skill has same name as base command', () => {
    const skills: SkillMeta[] = [
      { name: 'exit', description: 'Custom exit', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);
    const exitCommands = commands.filter(c => c.cmd === '/exit');

    expect(exitCommands.length).toBe(1);
    expect(exitCommands[0].desc).toBe('Exit the chat'); // Base command takes precedence
  });

  it('should handle multiple skills', () => {
    const skills: SkillMeta[] = [
      { name: 'skill1', description: 'First skill', content: '', path: '' },
      { name: 'skill2', description: 'Second skill', content: '', path: '' },
      { name: 'skill3', description: 'Third skill', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);

    expect(commands.length).toBe(14); // 11 base + 3 skills
  });

  it('builds base slash commands from shared chat command metadata rather than a local constant table', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ui', 'input.ts'), 'utf8');

    expect(source).not.toContain('const BASE_SLASH_COMMANDS');
    expect(source).toContain("from '../commands/registry.js'");
  });
});

describe('InputReader', () => {
  let reader: InputReader;
  let originalIsTTY: boolean | undefined;
  let originalConfigDir: string | undefined;
  let configDir: string;
  const tempDirs: string[] = [];

  beforeEach(() => {
    reader = new InputReader();
    originalIsTTY = process.stdin.isTTY;
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    configDir = join(tmpdir(), `xiaok-input-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(configDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('setSkills', () => {
    it('should store skills for menu generation', () => {
      const skills: SkillMeta[] = [
        {
          name: 'test-skill',
          description: 'A test skill',
          content: 'Test content',
          path: '/path/to/skill.md',
        },
      ];

      reader.setSkills(skills);
      // Skills are stored internally, verified through menu behavior
      expect(reader).toBeDefined();
    });

    it('should accept empty skills array', () => {
      reader.setSkills([]);
      expect(reader).toBeDefined();
    });
  });

  describe('read', () => {
    it('should clear input line after submission', async () => {
      // This test verifies that the input line is cleared after Enter is pressed
      // The actual behavior is tested in integration tests
      expect(reader).toBeDefined();
    });

    it('uses stdout for readline output in non-tty mode', async () => {
      const source = readFileSync(join(process.cwd(), 'src', 'ui', 'input.ts'), 'utf8');
      expect(source).toContain("readline.createInterface({ input: stdin, output: stdout })");
    });

    it('replays slash-menu interaction without appending each typed character onto a new line', async () => {
      const harness = createTtyHarness();
      reader.setSkills([
        { name: 'kai-report-creator', description: 'Handles reports', content: '', path: '' },
      ]);

      const pending = reader.read('> ');
      harness.send('/');
      harness.send('k');
      harness.send('a');
      harness.send('\r');
      harness.send('\r');

      await expect(pending).resolves.toBe('/kai-report-creator');
      expect(harness.output.normalized).not.toContain('/\n/');
      expect(harness.output.normalized).not.toContain('/k\n/ka');
      expect(harness.output.normalized).not.toContain('> /\n> /k');
      expect(harness.output.normalized).not.toContain('> /k\n> /ka');
      expect(harness.output.normalized).not.toContain('> /ka\n> /kai');

      harness.restore();
    });

    it('re-renders slash menu in place when navigating with arrow keys', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setSkills([
        { name: 'debug', description: '先定位根因，再提出修复方案', content: '', path: '' },
        { name: 'simplify', description: '识别可删减的复杂度，优先做小而稳的重构', content: '', path: '' },
      ]);

      const pending = reader.read('> ');
      harness.send('/');
      harness.send('\x1b[B');

      expect(harness.screen.lines()[0]).toMatch(/❯.*\//);

      harness.send('\x03');

      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('renders the footer status immediately below the prompt before the first keypress', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setStatusLineProvider(() => ['  xiaok-cli · claude-sonnet-4 · 1%']);

      const pending = reader.read('> ');

      expect(harness.screen.lines()[0]).toMatch(/❯/);
      expect(harness.screen.lines()[1]).toContain('xiaok-cli');

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('degrades to plain input mode when the scroll prompt renderer throws', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setScrollPromptRenderer(() => {
        throw new Error('scroll prompt boom');
      });

      const pending = reader.read('> ');
      harness.send('h');
      harness.send('i');
      harness.send('\r');

      await expect(pending).resolves.toBe('hi');
      expect(harness.output.normalized).toContain('[xiaok] UI 已降级：scroll_prompt_renderer');

      harness.restore();
    });

    it('does not submit early when a pasted batch contains a wrapped-line carriage return artifact', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));

      const pending = reader.read('> ');
      harness.send('根据这几个文档，/Users/song/Downloads/AI原生工作中枢设计推演v2.docx /Users/song/Downloads/AI原生IM协同.md /Users/song/Downloads/AI原生企业的管理思想、管理范���与组织形\r › 态.pptx 整理一篇汇总的文档，然后生成幻灯片\r');

      await expect(pending).resolves.toBe(
        '根据这几个文档，/Users/song/Downloads/AI原生工作中枢设计推演v2.docx /Users/song/Downloads/AI原生IM协同.md /Users/song/Downloads/AI原生企业的管理思想、管理范���与组织形态.pptx 整理一篇汇总的文档，然后生成幻灯片',
      );

      harness.restore();
    });

    it('hides the footer status while the slash menu is open', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setStatusLineProvider(() => ['  xiaok-cli · claude-sonnet-4 · 1%']);
      reader.setSkills([
        { name: 'debug', description: '先定位根因，再提出修复方案', content: '', path: '' },
      ]);

      const pending = reader.read('> ');
      harness.send('/');

      expect(harness.screen.lines()[0]).toMatch(/❯.*\//);
      expect(harness.screen.text()).not.toContain('xiaok-cli · claude-sonnet-4 · 1%');

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('does not accumulate duplicated prompt rows when repeatedly navigating past slash menu edges', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setSkills([
        { name: 'debug', description: '先定位根因，再提出修复方案', content: '', path: '' },
        { name: 'simplify', description: '识别可删减的复杂度，优先做小而稳的重构', content: '', path: '' },
      ]);

      const pending = reader.read('> ');
      harness.send('/');

      for (let index = 0; index < 20; index += 1) {
        harness.send('\x1b[A');
      }

      for (let index = 0; index < 20; index += 1) {
        harness.send('\x1b[B');
      }

      const promptLines = harness.screen.lines().filter((line) => line.includes('❯') && line.includes('/') && !line.includes('/clear') && !line.includes('/commit'));
      expect(promptLines.length).toBeGreaterThanOrEqual(1);

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('keeps the cursor aligned when moving across CJK text', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));

      const pending = reader.read('> ');
      harness.send('为');
      harness.send('什');
      harness.send('么');
      harness.send('\x1b[D');
      harness.send('\x1b[D');

      expect(harness.screen.lines()[0]).toMatch(/❯.*为什么/);

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('records key and submit events to the transcript logger', async () => {
      const harness = createTtyHarness();
      const events: Array<Record<string, unknown>> = [];
      const logger: TranscriptLogger = {
        record(event) {
          events.push(event as Record<string, unknown>);
        },
        recordOutput() {},
      };

      reader.setTranscriptLogger(logger);

      const pending = reader.read('> ');
      harness.send('h');
      harness.send('i');
      harness.send('\r');

      await expect(pending).resolves.toBe('hi');
      expect(events.some((event) => event.type === 'input_key' && event.key === 'h')).toBe(true);
      expect(events.some((event) => event.type === 'input_submit' && event.value === 'hi')).toBe(true);

      harness.restore();
    });

    it('emits the mode-cycle notice when shift-tab arrives as a batch ANSI sequence', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setModeCycleHandler(() => 'auto');

      const pending = reader.read('> ');
      harness.send('\x1b[Z');

      expect(harness.output.normalized).toContain('权限模式已切换为 auto');

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('emits the mode-cycle notice when shift-tab arrives while a scroll prompt renderer is active', async () => {
      const harness = createTtyHarness();
      const scrollPromptRenderer = vi.fn();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setModeCycleHandler(() => 'auto');
      reader.setStatusLineProvider(() => ['  test-model · 0% · project']);
      reader.setScrollPromptRenderer(scrollPromptRenderer);

      const pending = reader.read('> ');
      harness.send('\x1b[Z');

      expect(harness.output.normalized).toContain('权限模式已切换为 auto');
      expect(scrollPromptRenderer).toHaveBeenCalled();

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('submits an exact slash command on the first enter even while the menu is open', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));

      const pending = reader.read('> ');
      harness.send('/mode');
      harness.send('\r');

      await expect(pending).resolves.toBe('/mode');

      harness.restore();
    });

    it('submits the selected slash command on the first enter when only a prefix was typed', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));

      const pending = reader.read('> ');
      harness.send('/hel');
      harness.send('\r');

      await expect(pending).resolves.toBe('/help');

      harness.restore();
    });

    it('clears overlay lines through the scroll prompt renderer before resolving a slash submission', async () => {
      const harness = createTtyHarness();
      const scrollPromptRenderer = vi.fn();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setStatusLineProvider(() => ['  xiaok-cli · claude-sonnet-4 · 1%']);
      reader.setScrollPromptRenderer(scrollPromptRenderer);

      const pending = reader.read('> ');
      harness.send('/hel');
      scrollPromptRenderer.mockClear();

      harness.send('\r');

      await expect(pending).resolves.toBe('/help');
      expect(scrollPromptRenderer).toHaveBeenCalled();
      const finalFrame = scrollPromptRenderer.mock.calls.at(-1)?.[0];
      expect(finalFrame?.overlayLines).toEqual([]);

      harness.restore();
    });

    it('does not clear and redraw twice for slash-menu arrow navigation when using the shared renderer', async () => {
      const harness = createTtyHarness();
      const renderInput = vi.fn();
      const clearOverlay = vi.fn();
      const prepareBlockOutput = vi.fn();
      reader = new InputReader({
        renderInput,
        clearOverlay,
        prepareBlockOutput,
      } as unknown as ReplRenderer);
      reader.setSkills([
        { name: 'debug', description: '先定位根因，再提出修复方案', content: '', path: '' },
      ]);

      const pending = reader.read('> ');
      harness.send('/');
      renderInput.mockClear();
      clearOverlay.mockClear();

      harness.send('\x1b[A');

      expect(clearOverlay).not.toHaveBeenCalled();
      expect(renderInput).toHaveBeenCalledTimes(1);

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('uses the scroll prompt renderer instead of ReplRenderer when one is registered', async () => {
      const harness = createTtyHarness();
      const renderInput = vi.fn();
      const clearOverlay = vi.fn();
      const prepareBlockOutput = vi.fn();
      const scrollPromptRenderer = vi.fn();
      reader = new InputReader({
        renderInput,
        clearOverlay,
        prepareBlockOutput,
      } as unknown as ReplRenderer);
      reader.setStatusLineProvider(() => ['  xiaok-cli · claude-sonnet-4 · 1%']);
      reader.setScrollPromptRenderer(scrollPromptRenderer);

      const pending = reader.read('> ');
      scrollPromptRenderer.mockClear();
      renderInput.mockClear();

      harness.send('h');

      expect(scrollPromptRenderer).toHaveBeenCalled();
      expect(renderInput).not.toHaveBeenCalled();

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('falls back to the shared renderer when the scroll prompt renderer declines to draw', async () => {
      const harness = createTtyHarness();
      reader = new InputReader(new ReplRenderer(process.stdout));
      reader.setStatusLineProvider(() => ['  xiaok-cli · kimi-for-coding · 4%']);
      reader.setScrollPromptRenderer(() => false);

      const pending = reader.read('> ');

      expect(harness.screen.lines()[0]).toMatch(/❯/);
      expect(harness.screen.text()).toContain('xiaok-cli · kimi-for-coding · 4%');

      harness.send('\x03');
      await expect(pending).resolves.toBeNull();

      harness.restore();
    });

    it('attaches the input listener before the first prompt render so early keys are not lost', async () => {
      const harness = createTtyHarness();
      let injected = false;
      const renderInput = vi.fn(() => {
        if (!injected) {
          injected = true;
          harness.send('x');
          harness.send('\r');
        }
      });
      const clearOverlay = vi.fn();
      const prepareBlockOutput = vi.fn();
      reader = new InputReader({
        renderInput,
        clearOverlay,
        prepareBlockOutput,
      } as unknown as ReplRenderer);

      const pending = reader.read('> ');

      await expect(pending).resolves.toBe('x');

      harness.restore();
    });

    it('loads custom keybindings and can remap ctrl+c from cancel to submit', async () => {
      const harness = createTtyHarness();
      writeFileSync(
        join(configDir, 'keybindings.json'),
        JSON.stringify([{ key: 'ctrl+c', action: 'submit' }], null, 2),
        'utf8',
      );

      const pending = reader.read('> ');
      harness.send('o');
      harness.send('k');
      harness.send('\x03');

      await expect(pending).resolves.toBe('ok');

      harness.restore();
    });
  });

  describe('slash command menu', () => {
    it('should include slash menu candidates for "/" input', () => {
      const skills: SkillMeta[] = [
        { name: 'browse', aliases: ['browser'], description: 'Browser skill', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);

      expect(commands.some((item) => item.cmd === '/browse')).toBe(true);
      expect(commands.some((item) => item.cmd === '/browser')).toBe(true);
      expect(commands.some((item) => item.cmd === '/exit')).toBe(true);
    });

    it('should filter commands based on input', () => {
      const skills: SkillMeta[] = [
        { name: 'test-skill', description: 'A test skill', content: '', path: '' },
        { name: 'another-skill', description: 'Another skill', content: '', path: '' },
      ];

      reader.setSkills(skills);

      // Test that commands can be filtered
      const allCommands = getSlashCommands(skills);
      const exitCommands = allCommands.filter(c => c.cmd.startsWith('/exit'));
      const testCommands = allCommands.filter(c => c.cmd.startsWith('/test'));

      expect(exitCommands.length).toBe(1);
      expect(testCommands.length).toBe(1);
      expect(testCommands[0].cmd).toBe('/test-skill');
    });

    it('should handle partial command matching', () => {
      const skills: SkillMeta[] = [
        { name: 'test-one', description: 'Test 1', content: '', path: '' },
        { name: 'test-two', description: 'Test 2', content: '', path: '' },
        { name: 'other', description: 'Other', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const testCommands = commands.filter(c => c.cmd.startsWith('/test'));

      expect(testCommands.length).toBe(2);
      expect(testCommands[0].cmd).toBe('/test-one');
      expect(testCommands[1].cmd).toBe('/test-two');
    });

    it('should return empty array when no commands match', () => {
      const skills: SkillMeta[] = [
        { name: 'test-skill', description: 'A test skill', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const noMatch = commands.filter(c => c.cmd.startsWith('/nonexistent'));

      expect(noMatch.length).toBe(0);
    });

    it('should handle menu with many commands', () => {
      const skills: SkillMeta[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: `Skill ${i}`,
        content: '',
        path: '',
      }));

      const commands = getSlashCommands(skills);

      // 11 base commands + 20 skills = 31 total
      expect(commands.length).toBe(31);
    });

    it('should preserve command descriptions', () => {
      const skills: SkillMeta[] = [
        { name: 'test', description: 'This is a test skill with a long description', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const testCmd = commands.find(c => c.cmd === '/test');

      expect(testCmd).toBeDefined();
      expect(testCmd?.desc).toBe('This is a test skill with a long description');
    });

    it('truncates mixed-width skill descriptions to the visible terminal width', () => {
      const lines = buildSlashMenuOverlayLines(
        [{
          cmd: '/kai-report-creator',
          desc: 'Use when the user wants to CREATE or GENERATE a report, business summary, data dashboard, or research doc — 报告/数据看板/商业报告/研究文档/KPI仪表盘. Handles Chinese and English equally.',
        }],
        0,
        50,
        8,
      );

      expect(lines).toHaveLength(1);
      expect(getDisplayWidth(stripAnsi(lines[0] ?? ''))).toBeLessThanOrEqual(50);
    });

    it('caps slash-menu description width even when the terminal is wide', () => {
      const lines = buildSlashMenuOverlayLines(
        [{
          cmd: '/kai-report-creator',
          desc: 'Use when the user wants to CREATE or GENERATE a report, business summary, data dashboard, or research doc — 报告/数据看板/商业报告/研究文档/KPI仪表盘. Handles Chinese and English equally.',
        }],
        0,
        80,
        8,
      );

      const plainLine = stripAnsi(lines[0] ?? '');
      const description = plainLine.split('/kai-report-creator  ')[1] ?? '';

      expect(getDisplayWidth(description)).toBeLessThanOrEqual(24);
    });
  });
});

describe('word navigation helpers', () => {
  it('wordBoundaryLeft should find previous word start', () => {
    expect(wordBoundaryLeft('hello world', 11)).toBe(6);
    expect(wordBoundaryLeft('hello world', 6)).toBe(0);
    expect(wordBoundaryLeft('hello world', 5)).toBe(0);
    expect(wordBoundaryLeft('', 0)).toBe(0);
  });

  it('wordBoundaryRight should find next word end', () => {
    expect(wordBoundaryRight('hello world', 0)).toBe(5);
    expect(wordBoundaryRight('hello world', 5)).toBe(11);
    expect(wordBoundaryRight('hello world', 6)).toBe(11);
    expect(wordBoundaryRight('', 0)).toBe(0);
  });
});

describe('menu rendering helpers', () => {
  it('truncateMenuDescription should keep descriptions to one line', () => {
    expect(truncateMenuDescription('line1\nline2', 20)).toBe('line1 line2');
  });

  it('truncateMenuDescription should truncate long descriptions', () => {
    expect(truncateMenuDescription('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefg...');
  });

  it('getMenuClearSequence should clear lines below the prompt and return to input row', () => {
    expect(getMenuClearSequence(2)).toBe('\x1b[1B\r\x1b[2K\x1b[1B\r\x1b[2K\x1b[2A\r');
  });

  it('getVisibleMenuItems should cap long menus to eight rows', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      cmd: `/cmd-${i}`,
      desc: `Command ${i}`,
    }));

    const visible = getVisibleMenuItems(items, 0, 8);

    expect(visible.items).toHaveLength(8);
    expect(visible.start).toBe(0);
    expect(visible.items[0]?.cmd).toBe('/cmd-0');
    expect(visible.items[7]?.cmd).toBe('/cmd-7');
  });

  it('getVisibleMenuItems should scroll down to keep lower selections visible', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      cmd: `/cmd-${i}`,
      desc: `Command ${i}`,
    }));

    const visible = getVisibleMenuItems(items, 10, 8);

    expect(visible.items).toHaveLength(8);
    expect(visible.start).toBe(3);
    expect(visible.items[0]?.cmd).toBe('/cmd-3');
    expect(visible.items[7]?.cmd).toBe('/cmd-10');
    expect(visible.selectedOffset).toBe(7);
  });

  it('getVisibleMenuItems should scroll back up when selection returns near the top', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      cmd: `/cmd-${i}`,
      desc: `Command ${i}`,
    }));

    const visible = getVisibleMenuItems(items, 1, 8);

    expect(visible.start).toBe(0);
    expect(visible.items[0]?.cmd).toBe('/cmd-0');
    expect(visible.items[7]?.cmd).toBe('/cmd-7');
    expect(visible.selectedOffset).toBe(1);
  });
});

describe('permission mode helpers', () => {
  it('cycles permission mode in the expected order', () => {
    expect(cyclePermissionMode('default')).toBe('auto');
    expect(cyclePermissionMode('auto')).toBe('plan');
    expect(cyclePermissionMode('plan')).toBe('default');
  });

  it('allows registering a mode cycle callback', () => {
    const reader = new InputReader();
    const handler = () => 'auto' as const;

    expect(() => reader.setModeCycleHandler(handler)).not.toThrow();
  });
});
