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
const clonedModels: string[] = [];

function resetAdapterState(): void {
  adapterCalls.length = 0;
  clonedModels.length = 0;
}

function extractLastUserText(messages: Message[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUser) {
    return '';
  }

  return lastUser.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function extractLastToolResult(messages: Message[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUser) {
    return '';
  }

  return lastUser.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => block.content)
    .join('\n');
}

function createFakeAdapter(model = 'test-model'): ModelAdapter & { cloneWithModel(nextModel: string): ModelAdapter } {
  return {
    getModelName() {
      return model;
    },
    cloneWithModel(nextModel: string) {
      clonedModels.push(nextModel);
      return createFakeAdapter(nextModel);
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

      if (lastToolResult.includes('background subagent queued:')) {
        yield { type: 'text', delta: '后台任务已安排，等待完成通知。' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('已确认')) {
        yield { type: 'text', delta: '收到回答: 已确认' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('"taskId": "task_1"')) {
        yield { type: 'text', delta: 'task created' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('执行 skill "fork-research"')) {
        yield { type: 'text', delta: `fork skill result via ${model}` };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('draft the rollout')) {
        yield { type: 'text', delta: `background worker finished via ${model}` };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('请后台规划')) {
        yield {
          type: 'tool_use',
          id: 'tu_background_1',
          name: 'subagent',
          input: {
            agent: 'planner',
            prompt: 'draft the rollout',
            background: true,
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('请先问我一句')) {
        yield {
          type: 'tool_use',
          id: 'tu_ask_user_1',
          name: 'ask_user',
          input: {
            question: '确认目标？',
            placeholder: '答案',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('创建任务并汇报')) {
        yield {
          type: 'tool_use',
          id: 'tu_task_create_1',
          name: 'task_create',
          input: {
            title: '跟进交互验证',
            details: '检查 ask_user/task 流',
          },
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

vi.mock('../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => createFakeAdapter()),
}));

describe('chat interactive runtime', () => {
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

  it('runs a fork skill through the interactive slash flow and honors the skill model override', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(join(projectDir, '.xiaok', 'skills'), { recursive: true });
    mkdirSync(join(projectDir, '.xiaok', 'agents'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
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
    writeFileSync(join(projectDir, '.xiaok', 'agents', 'researcher.md'), [
      '---',
      'model: gpt-5.4',
      '---',
      'Run research in a forked agent.',
    ].join('\n'));
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'fork-research.md'), [
      '---',
      'name: fork-research',
      'description: Run research in a forked agent',
      'context: fork',
      'agent: researcher',
      '---',
      'Return a concise research answer.',
    ].join('\n'));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitFor(() => {
        expectPromptVisible(harness);
      }, { timeoutMs: 3_000 });

      harness.send('/fork-research summarize findings');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('fork skill result via gpt-5.4');
      }, { timeoutMs: 3_000 });

      harness.send('/exit');
      harness.send('\r');
      await pending;

      expect(clonedModels).toContain('gpt-5.4');
      expect(adapterCalls.some((call) => call.lastUserText.includes('执行 skill "fork-research"'))).toBe(true);
      expect(harness.output.normalized).not.toContain('Error:');
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

  it('renders background subagent completion notices during an interactive chat turn', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(join(projectDir, '.xiaok', 'agents'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
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
    writeFileSync(join(projectDir, '.xiaok', 'agents', 'planner.md'), [
      '---',
      'background: true',
      'model: gpt-5.4',
      '---',
      'You plan work in the background.',
    ].join('\n'));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitFor(() => {
        expectPromptVisible(harness);
      }, { timeoutMs: 3_000 });

      harness.send('请后台规划');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('后台任务已安排，等待完成通知。');
      }, { timeoutMs: 3_000 });

      await waitFor(() => {
        expect(harness.output.normalized).toContain('[background] job_1 completed: background worker finished via gpt-5.4');
      }, { timeoutMs: 3_000 });

      harness.send('/exit');
      harness.send('\r');
      await pending;

      expect(clonedModels).toContain('gpt-5.4');
      expect(adapterCalls.some((call) => call.toolNames.includes('subagent') && call.lastUserText.includes('请后台规划'))).toBe(true);
      expect(harness.output.normalized).not.toContain('Error:');
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

  it('supports shift-tab mode cycling plus ask-user and task inspection flows in interactive chat', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
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

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitFor(() => {
        expectPromptVisible(harness);
      }, { timeoutMs: 3_000 });

      harness.send('\x1b[Z');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('权限模式已切换为 auto');
      }, { timeoutMs: 3_000 });

      harness.send('/mode');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('当前权限模式：auto');
      }, { timeoutMs: 3_000 });

      harness.send('请先问我一句');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('Agent question: 确认目标？');
      }, { timeoutMs: 3_000 });

      harness.send('已确认');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('收到回答: 已确认');
      }, { timeoutMs: 3_000 });

      harness.send('创建任务并汇报');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('task created');
      }, { timeoutMs: 3_000 });

      harness.send('/tasks');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('task_1 [queued] 跟进交互验证');
      }, { timeoutMs: 3_000 });

      harness.send('/task task_1');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('"taskId": "task_1"');
      }, { timeoutMs: 3_000 });

      harness.send('/exit');
      harness.send('\r');
      await pending;
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
  }, 15_000);
});
