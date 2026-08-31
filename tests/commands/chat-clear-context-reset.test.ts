/**
 * Regression: /clear must clear the conversation context, not just the
 * screen. Before the fix, /clear only redrew the welcome page while the
 * status bar context percentage and the persisted session snapshot kept the
 * old history/usage — a real context leak, not a display artifact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import type { Message, ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { Console } from 'node:console';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';

vi.mock('../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => createEchoAdapter()),
}));

vi.mock('../../src/ui/model-selector.js', () => ({
  selectModel: vi.fn(async () => null),
}));

function createEchoAdapter(): ModelAdapter {
  return {
    getModelName() {
      return 'echo-test-model';
    },
    getCapabilities() {
      return { contextLimit: 8_000 };
    },
    async *stream(
      messages: Message[],
      _tools: ToolDefinition[],
      _systemPrompt: string,
    ): AsyncIterable<StreamChunk> {
      const lastUserText = [...messages].reverse()
        .find((message) => message.role === 'user')
        ?.content
        .filter((block) => block.type === 'text' && !block.text.startsWith('<system-reminder>'))
        .map((block) => (block as { text: string }).text)
        .join('\n') ?? '';
      yield { type: 'text', delta: `echo:${lastUserText}` };
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
      return /^(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])\s+(?:Thinking|Exploring codebase|Tracing references|Running command|Answering|Compacting context)\b/u.test(trimmed);
    });
    expect(hasLiveActivity).toBe(false);
  }, { timeoutMs: 3_000 });
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('chat /clear context reset', () => {
  const tempDirs: string[] = [];
  let originalConfigDir: string | undefined;
  let originalHome: string | undefined;
  let originalDisableGlobalPlugins: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    originalHome = process.env.HOME;
    originalDisableGlobalPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    const isolatedHome = join(tmpdir(), `xiaok-chat-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(isolatedHome, { recursive: true });
    tempDirs.push(isolatedHome);
    process.env.HOME = isolatedHome;
    process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalDisableGlobalPlugins === undefined) {
      delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    } else {
      process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = originalDisableGlobalPlugins;
    }

    for (const dir of tempDirs.splice(0)) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    vi.resetModules();
    vi.clearAllMocks();
  });

  it('/clear resets persisted history and usage, then new turns still work', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-clear-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
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

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(100, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    const readLatestSession = () => {
      const sessionsDir = join(configDir, 'sessions');
      const [sessionFile] = readdirSync(sessionsDir).filter((entry) => entry.endsWith('.json'));
      return JSON.parse(readFileSync(join(sessionsDir, sessionFile), 'utf8')) as {
        messages?: Array<{ role?: string }>;
        usage?: { inputTokens?: number; outputTokens?: number };
      };
    };

    try {
      // vitest intercepts global console.log, which would swallow the
      // welcome card before it reaches the tty harness; swap in a plain
      // Console bound to the (harness-wrapped) process.stdout instead.
      const vitestConsole = globalThis.console;
      globalThis.console = new Console(process.stdout) as unknown as Console;
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      // one real turn: history becomes non-empty
      harness.send('hi');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:hi');
      }, { timeoutMs: 5_000 });
      await waitForInputTurnReady(harness);

      await waitFor(() => {
        expect((readLatestSession().messages ?? []).length).toBeGreaterThan(0);
      }, { timeoutMs: 5_000 });

      harness.send('/clear');
      harness.send('\r');

      // the welcome page is redrawn after the screen clear
      await waitFor(() => {
        expect(harness.output.normalized).toContain('欢迎使用');
      }, { timeoutMs: 5_000 });

      // persisted snapshot is reset by the same command handling
      await waitFor(() => {
        const afterClear = readLatestSession();
        expect((afterClear.messages ?? []).length).toBe(0);
        expect(afterClear.usage?.inputTokens ?? 0).toBe(0);
        expect(afterClear.usage?.outputTokens ?? 0).toBe(0);
      }, { timeoutMs: 5_000 });

      // a fresh turn works against the cleared session
      await waitForInputTurnReady(harness);
      harness.send('again');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:again');
      }, { timeoutMs: 5_000 });
      await waitForInputTurnReady(harness);

      harness.send('/exit');
      harness.send('\r');
      await pending;
      globalThis.console = vitestConsole;
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
  }, 30_000);
});
