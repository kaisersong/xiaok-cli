import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Console } from 'node:console';
import { Command } from 'commander';
import { registerConfigCommands } from '../../../src/commands/config.js';
import { loadConfig } from '../../../src/utils/config.js';
import { buildModelOptions } from '../../../src/ui/model-selector.js';
import { createTtyHarness } from '../../support/tty.js';
import { waitFor } from '../../support/wait-for.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { getSupportedModelReasoningEfforts } from '../../../src/ai/providers/model-reasoning-effort.js';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';
import { resolveModelHarnessProfile, buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import { isKimiK3DurableModel, assertKimiK3DurableResumeSupported } from '../../../src/ai/runtime/session-store/store.js';
import type { Config, Message } from '../../../src/types.js';

const endpoint = 'https://api.kimi.com/coding/v1';
const wire = 'kimi-for-coding';
const identity = { providerId: 'kimi', providerType: 'first_party' as const, protocol: 'openai_legacy' as const, canonicalBaseUrl: endpoint, capabilities: ['tools', 'thinking', 'image_in'] };
// Reuse the real Commander command and disk persistence, rather than synthesizing
// the model entry that the CLI/selector is supposed to save.
async function withConfigAccount(work: (configDir: string, projectDir: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-k28-entrypoints-'));
  const configDir = join(root, 'config');
  const projectDir = join(root, 'project');
  mkdirSync(configDir); mkdirSync(projectDir);
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = configDir;
  try { await work(configDir, projectDir); }
  finally {
    if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
    else process.env.XIAOK_CONFIG_DIR = previous;
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function setCliModel(model: string): Promise<void> {
  const program = new Command();
  registerConfigCommands(program);
  await program.parseAsync(['node', 'xiaok', 'config', 'set', 'model', `kimi/${model}`, '--api-key', 'fixture']);
}

function readSavedConfig(configDir: string): Config {
  return JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as Config;
}

async function collect(stream: AsyncIterable<unknown>) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }

describe('K2.8 Preview', () => {
  it('resolves the real CLI config set model saved entry with exact wire, vision and native effort', async () => {
    await withConfigAccount(async configDir => {
      await setCliModel(wire);
      const saved = readSavedConfig(configDir);
      const variant = getProviderProfile('kimi')!.availableModels!.find(model => model.model === wire)!;
      expect(saved.models[saved.defaultModelId]).toEqual({ provider: 'kimi', model: wire, label: variant.label, capabilities: variant.capabilities, runtimeOptions: variant.runtimeOptions });
      console.info('K2.8 CLI saved model shape', JSON.stringify(saved.models[saved.defaultModelId]));
      const input = await loadConfig(); const before = structuredClone(input);
      const binding = resolveRuntimeModelBinding(input);
      expect(binding.wireModel).toBe(wire);
      expect(binding.capabilities).toEqual(['tools', 'thinking', 'image_in']);
      expect(binding.runtimeOptions).toEqual({ contextLimit: 1_048_576, reasoningEffort: 'high' });
      expect(input).toEqual(before);
      expect(getProviderProfile('kimi')?.availableModels?.find(x => x.model === wire)?.runtimeConstraints)
        .toEqual({ maxContextLimit: 1_048_576, reasoningEfforts: ['low', 'high', 'max'] });
      expect(getProviderProfile('kimi')?.availableModels?.find(x => x.model === wire)?.label).toBe('Kimi K2.8 Preview');
      input.models[input.defaultModelId]!.runtimeOptions = { contextLimit: 262_144, reasoningEffort: 'max' };
      expect(resolveRuntimeModelBinding(input).runtimeOptions).toEqual({ contextLimit: 262_144, reasoningEffort: 'max' });
      for (const effort of ['low', 'high', 'max'] as const) {
        input.models[input.defaultModelId]!.runtimeOptions = { reasoningEffort: effort };
        expect(resolveRuntimeModelBinding(input).runtimeOptions?.reasoningEffort).toBe(effort);
      }
      input.models[input.defaultModelId]!.runtimeOptions = { reasoningEffort: 'none' };
      expect(() => resolveRuntimeModelBinding(input)).toThrow('reasoningEffort is not allowed');
      // The override checks above mutate only the reloaded in-memory config.
      expect(readSavedConfig(configDir)).toEqual(saved);
    });
  });
  it('preserves the generic transport and accepts existing durable assistant history', () => {
    expect(resolveModelHarnessProfile({ ...identity, wireModel: wire }).id).toBe('generic-openai');
    expect(isKimiK3DurableModel(wire)).toBe(false);
    expect(() => assertKimiK3DurableResumeSupported({ model: wire, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'old answer' }] }] })).not.toThrow();
  });
  it.each([
    { providerType: 'custom' as const }, { providerId: 'other' },
    { protocol: 'openai_responses' as const }, { wireModel: 'kimi-k2.8' },
    { canonicalBaseUrl: 'https://api.kimi.com.evil.example/coding/v1' },
    { canonicalBaseUrl: `${endpoint}?proxy=1` },
    { canonicalBaseUrl: 'https://api.moonshot.cn/v1' },
  ])('does not grant strict capability to unsupported identity %j', override => {
    const unsupported = { ...identity, wireModel: wire, ...override };
    expect(resolveModelHarnessProfile(unsupported).id).toBe('generic-openai');
    expect(getSupportedModelReasoningEfforts({ ...unsupported, baseUrl: unsupported.canonicalBaseUrl })).toEqual([]);
  });
  it.each(['low', 'high', 'max'] as const)('sends %s effort, image and tool history using the exact wire', async effort => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: true, harnessContext: buildOpenAIHarnessContext({ identity: { ...identity, wireModel: wire }, runtimeOptions: { reasoningEffort: effort }, flags: resolveKimiHarnessFeatureFlags({}) }) });
    const create = vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { reasoning_content: 'fixture reasoning', content: 'ok' }, finish_reason: 'stop' }] }; } }));
    (adapter as unknown as { client: unknown }).client = { chat: { completions: { create } } };
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'inspect fixture' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'fixture reasoning', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } }, { type: 'tool_use', id: 'fixture_call', name: 'echo', input: { value: 'ok' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture_call', content: 'ok' }] },
    ];
    await collect(streamDesktopTaskProviderConversation({ adapter, invocationId: 'fixture-invocation', messages, tools: [], systemPrompt: 'fixture', options: { reasoningMode: 'disabled' } }));
    expect(create).toHaveBeenCalledOnce();
    const request = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(request.model).toBe(wire);
    expect(request.reasoning_effort).toBe(effort);
    expect(request.thinking?.type).not.toBe('disabled');
    expect(request.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } });
    expect(request.messages[2].reasoning_content).toBe('fixture reasoning');
    expect(request.messages[2].tool_calls[0].id).toBe('fixture_call');
    expect(request.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'fixture_call', content: 'ok' });
  });
});


describe('K2.8 real selector persistence', () => {
  it('saves a catalog choice through chat /models and reloads 1M/high without synthesizing metadata', async () => {
    await withConfigAccount(async (configDir, projectDir) => {
      // Start from a different wire so the alias must be registered by /models.
      await setCliModel('kimi-k2.6');
      const initial = await loadConfig();
      expect(initial.models['kimi-for-coding']).toBeUndefined();
      const options = buildModelOptions(initial);
      const start = options.findIndex(model => model.id === initial.defaultModelId);
      const target = options.findIndex(model => model.id === 'kimi-for-coding');
      expect(start).toBeGreaterThanOrEqual(0);
      expect(target).toBeGreaterThanOrEqual(0);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
      const previousPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
      const previousActivity = process.env.XIAOK_CONVERSATION_ACTIVITY;
      process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
      process.env.XIAOK_CONVERSATION_ACTIVITY = '0';
      const harness = createTtyHarness(120, 40);
      const sigints = process.listeners('SIGINT');
      const resizes = process.stdout.listeners('resize');
      const originalConsole = globalThis.console;
      globalThis.console = new Console(process.stdout);
      let settled = false;
      let pending: Promise<unknown> | undefined;
      let finished: Promise<void> | undefined;
      try {
        const { registerChatCommands } = await import('../../../src/commands/chat.js');
        const program = new Command(); registerChatCommands(program);
        pending = program.parseAsync(['node', 'xiaok', 'chat']);
        finished = pending.then(() => { settled = true; }, () => { settled = true; });
        await waitFor(() => {
          expect(harness.screen.lines().some(line => line.trim() === '❯' || line.includes('❯ Type your message...'))).toBe(true);
          expect(harness.emitter.listenerCount('data')).toBeGreaterThan(0);
        }, { timeoutMs: 3_000 });
        harness.send('/models'); harness.send('\r');
        await waitFor(() => expect(harness.screen.text()).toContain('选择模型'), { timeoutMs: 3_000 });
        for (let index = start; index !== target; index = (index + 1) % options.length) harness.send('\x1b[B');
        harness.send('\r');
        await waitFor(() => expect(readSavedConfig(configDir).defaultModelId).toBe('kimi-for-coding'), { timeoutMs: 3_000 });
        const saved = readSavedConfig(configDir);
        const variant = getProviderProfile('kimi')!.availableModels!.find(model => model.model === wire)!;
        expect(saved.models[saved.defaultModelId]).toEqual({ provider: 'kimi', model: wire, label: variant.label, capabilities: variant.capabilities, runtimeOptions: variant.runtimeOptions });
        originalConsole.info('K2.8 selector saved model shape', JSON.stringify(saved.models[saved.defaultModelId]));
        const reloaded = await loadConfig();
        expect(resolveRuntimeModelBinding(reloaded)).toMatchObject({ wireModel: wire, capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'high' } });
        await waitFor(() => expect(harness.output.normalized).toContain('已切换到：[kimi]'), { timeoutMs: 3_000 });
        harness.send('/exit'); harness.send('\r');
        await pending;
      } finally {
        // Exit the real selector/input loop before restoring stdin or deleting files.
        try {
          if (pending && !settled) {
            harness.send('\x1b'); harness.send('\x15'); harness.send('\x04');
            await waitFor(() => expect(settled).toBe(true), { timeoutMs: 5_000 });
          }
          await finished;
        } finally {
          globalThis.console = originalConsole;
          for (const listener of process.listeners('SIGINT')) if (!sigints.includes(listener)) process.removeListener('SIGINT', listener);
          for (const listener of process.stdout.listeners('resize')) if (!resizes.includes(listener)) process.stdout.removeListener('resize', listener as () => void);
          harness.restore(); cwdSpy.mockRestore();
          if (previousPlugins === undefined) delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS; else process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = previousPlugins;
          if (previousActivity === undefined) delete process.env.XIAOK_CONVERSATION_ACTIVITY; else process.env.XIAOK_CONVERSATION_ACTIVITY = previousActivity;
        }
      }
    });
  });
});
