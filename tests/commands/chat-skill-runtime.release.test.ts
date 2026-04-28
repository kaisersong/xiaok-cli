import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { Message, ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';

interface FakeAdapterCall {
  model: string;
  systemPrompt: string;
  toolNames: string[];
  lastUserText: string;
  lastToolResult: string;
}

const adapterCalls: FakeAdapterCall[] = [];

function resetAdapterState(): void {
  adapterCalls.length = 0;
}

function extractLastUserText(messages: Message[]): string {
  const lastUserWithText = [...messages].reverse().find((message) => {
    if (message.role !== 'user') {
      return false;
    }
    return message.content.some((block) => block.type === 'text' && !block.text.startsWith('<system-reminder>'));
  });
  if (!lastUserWithText) {
    return '';
  }

  return lastUserWithText.content
    .filter((block) => block.type === 'text' && !block.text.startsWith('<system-reminder>'))
    .map((block) => block.text)
    .join('\n');
}

function extractLastToolResult(messages: Message[]): string {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || !lastMessage.content.some((block) => block.type === 'tool_result')) {
    return '';
  }

  return lastMessage.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => block.content)
    .join('\n');
}

function createFakeAdapter(model = 'test-model'): ModelAdapter {
  return {
    getModelName() {
      return model;
    },
    async *stream(
      messages: Message[],
      tools: ToolDefinition[],
      systemPrompt: string,
    ): AsyncIterable<StreamChunk> {
      const lastUserText = extractLastUserText(messages);
      const lastToolResult = extractLastToolResult(messages);
      adapterCalls.push({
        model,
        systemPrompt,
        toolNames: tools.map((tool) => tool.name),
        lastUserText,
        lastToolResult,
      });

      if (!lastToolResult && lastUserText.includes('strict-release') && lastUserText.includes('skill_plan')) {
        yield {
          type: 'tool_use',
          id: 'tu_strict_release_read_1',
          name: 'read',
          input: {
            file_path: join(process.cwd(), '.xiaok', 'skills', 'strict-release', 'references', 'principles.md'),
          },
        };
        yield { type: 'done' };
        return;
      }

      if (!lastToolResult && lastUserText.includes('执行 skill "fork-strict-release"')) {
        yield {
          type: 'tool_use',
          id: 'tu_fork_strict_release_read_1',
          name: 'read',
          input: {
            file_path: join(process.cwd(), '.xiaok', 'skills', 'fork-strict-release', 'references', 'principles.md'),
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('# release principles') && lastUserText.includes('执行 skill "fork-strict-release"')) {
        yield {
          type: 'tool_use',
          id: 'tu_fork_strict_release_bash_1',
          name: 'bash',
          input: {
            command: `sh ${join(process.cwd(), '.xiaok', 'skills', 'fork-strict-release', 'scripts', 'check_release.sh')}`,
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('# release principles') && lastUserText.includes('skill_plan') && lastUserText.includes('strict-release')) {
        yield {
          type: 'tool_use',
          id: 'tu_strict_release_bash_1',
          name: 'bash',
          input: {
            command: `sh ${join(process.cwd(), '.xiaok', 'skills', 'strict-release', 'scripts', 'check_release.sh')}`,
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('smoke ok') && lastUserText.includes('执行 skill "fork-strict-release"')) {
        yield {
          type: 'text',
          delta: [
            'ready: yes',
            'blockers: none',
            'The branch is ready to ship.',
          ].join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('smoke ok')) {
        yield { type: 'text', delta: 'I reviewed the branch.' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('Continue the current strict skill. Do not restart from scratch.')) {
        yield {
          type: 'text',
          delta: [
            'ready: yes',
            'blockers: none',
            'The branch is ready to ship.',
          ].join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      yield { type: 'text', delta: `echo:${lastUserText || 'empty'}` };
      yield { type: 'done' };
    },
  };
}

function expectPromptVisible(harness: ReturnType<typeof createTtyHarness>): void {
  expect(harness.screen.lines().some((line) => line.includes('❯'))).toBe(true);
}

async function waitForInputTurnReady(harness: ReturnType<typeof createTtyHarness>): Promise<void> {
  await waitFor(() => {
    expectPromptVisible(harness);
    expect(harness.emitter.listenerCount('data')).toBeGreaterThan(0);
    const lines = harness.screen.lines();
    const hasLiveActivity = lines.some((line) => {
      const trimmed = line.trim();
      return /^(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])\s+(?:Thinking|Exploring codebase|Running command|Answering)\b/u.test(trimmed);
    });
    expect(hasLiveActivity).toBe(false);
  }, { timeoutMs: 3_000 });
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function writeStrictSkill(projectDir: string, skillName: string, options?: { forkAgent?: string }): void {
  mkdirSync(join(projectDir, '.xiaok', 'skills', skillName, 'references'), { recursive: true });
  mkdirSync(join(projectDir, '.xiaok', 'skills', skillName, 'scripts'), { recursive: true });
  writeFileSync(
    join(projectDir, '.xiaok', 'skills', skillName, 'references', 'principles.md'),
    '# release principles\nAlways state ready and blockers.\n',
  );
  writeFileSync(
    join(projectDir, '.xiaok', 'skills', skillName, 'scripts', 'check_release.sh'),
    'printf "smoke ok"\n',
  );
  writeFileSync(join(projectDir, '.xiaok', 'skills', skillName, 'SKILL.md'), [
    '---',
    `name: ${skillName}`,
    'description: Run a strict release readiness skill',
    'when-to-use: Use when a user asks for a strict release readiness answer.',
    'task-goals:',
    '  - verify one branch for release readiness',
    'examples:',
    '  - run the strict release check',
    ...(options?.forkAgent ? ['context: fork', `agent: ${options.forkAgent}`] : []),
    'required-references:',
    '  - references/principles.md',
    'required-scripts:',
    `  - sh ${join(projectDir, '.xiaok', 'skills', skillName, 'scripts', 'check_release.sh')}`,
    'required-steps:',
    '  - read_skill',
    '  - read_required_references',
    '  - run_required_scripts',
    '  - summarize_findings',
    'success-checks:',
    '  - must_mention_all: ready, blockers',
    '  - must_answer_yes_no: ready',
    'strict: true',
    '---',
    '# Goal',
    '',
    'Run the release check.',
    '',
    '## Success Criteria',
    '',
    '- State readiness clearly.',
  ].join('\n'));
}

vi.mock('../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => createFakeAdapter()),
}));

describe('chat skill runtime release validation', () => {
  const tempDirs: string[] = [];
  let originalConfigDir: string | undefined;
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    resetAdapterState();
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }

    vi.resetModules();
    vi.clearAllMocks();
    resetAdapterState();
  });

  it('auto-continues an inline strict slash skill until its success checks are satisfied', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-strict-skill-release-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeStrictSkill(projectDir, 'strict-release');
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--auto']);

      await waitForInputTurnReady(harness);

      harness.send('/strict-release');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('ready: yes');
        expect(harness.output.normalized).toContain('blockers: none');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;

      expect(adapterCalls.some((call) => call.lastUserText.includes('Continue the current strict skill. Do not restart from scratch.'))).toBe(true);
      expect(harness.output.normalized).not.toContain('Strict skill contract still incomplete');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('does not reopen continuation when a strict fork skill already satisfied its contract in the subagent', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-fork-strict-release-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(join(projectDir, '.xiaok', 'agents'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(projectDir, '.xiaok', 'agents', 'researcher.md'), [
      '---',
      'model: gpt-5.4',
      '---',
      'Run strict release checks in a forked agent.',
    ].join('\n'));
    writeStrictSkill(projectDir, 'fork-strict-release', { forkAgent: 'researcher' });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--auto']);

      await waitForInputTurnReady(harness);

      harness.send('/fork-strict-release');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('ready: yes');
        expect(harness.output.normalized).toContain('blockers: none');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;

      const forkPromptCalls = adapterCalls.filter((call) => call.lastUserText.includes('执行 skill "fork-strict-release"'));
      expect(forkPromptCalls).toHaveLength(3);
      expect(forkPromptCalls[0]?.lastToolResult ?? '').toBe('');
      expect(forkPromptCalls[1]?.lastToolResult ?? '').toContain('# release principles');
      expect(forkPromptCalls[1]?.lastToolResult ?? '').toContain('Always state ready and blockers.');
      expect(forkPromptCalls[2]?.lastToolResult ?? '').toContain('smoke ok');
      expect(
        adapterCalls
          .filter((call) => call.lastUserText.includes('Continue the current strict skill. Do not restart from scratch.'))
          .map((call) => call.lastUserText),
      ).toEqual([]);
      expect(harness.output.normalized).not.toContain('Strict skill contract still incomplete');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);
});
