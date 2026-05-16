import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../src/utils/config.js';
import { registerConfigCommands } from '../../src/commands/config.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';

function freshProgram(): Command {
  const program = new Command();
  registerConfigCommands(program);
  return program;
}

function seedConfig(testDir: string, config: Record<string, unknown>): void {
  writeFileSync(join(testDir, 'config.json'), JSON.stringify(config, null, 2));
}

describe('config persistence end-to-end', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('config set api-key persists and runtime resolves correctly', async () => {
    seedConfig(testDir, {
      schemaVersion: 2,
      defaultProvider: 'anthropic',
      defaultModelId: 'anthropic-default',
      providers: {
        anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
      },
      models: {
        'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default', capabilities: ['tools'] },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    // Step 1: Set api-key for deepseek (non-default provider)
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'api-key', 'sk-deepseek-test', '--provider', 'deepseek',
    ]);

    // Step 2: Verify config on disk
    const rawOnDisk = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(rawOnDisk.defaultProvider).toBe('deepseek');
    expect(rawOnDisk.providers.deepseek.apiKey).toBe('sk-deepseek-test');
    expect(rawOnDisk.models['deepseek-default']).toBeDefined();

    // Step 3: Reload config via loadConfig (simulates a new process)
    const reloaded = await loadConfig();
    expect(reloaded.defaultProvider).toBe('deepseek');
    expect(reloaded.providers.deepseek.apiKey).toBe('sk-deepseek-test');
    expect(reloaded.defaultModelId).toBe('deepseek-default');

    // Step 4: Verify runtime can resolve model binding (simulates app startup)
    const binding = resolveRuntimeModelBinding(reloaded);
    expect(binding.providerId).toBe('deepseek');
    expect(binding.apiKey).toBe('sk-deepseek-test');
    expect(binding.protocol).toBe('openai_legacy');
    expect(binding.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('full config workflow: set model → set api-key → runtime resolves', async () => {
    // Step 1: Set model to deepseek
    await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'deepseek']);

    // Step 2: Set api-key for current default (deepseek)
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'api-key', 'sk-my-deepseek',
    ]);

    // Step 3: Set yzj config
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'yzj-webhook-url', 'https://yzj.example.com/hook',
    ]);
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'yzj-secret', 'my-secret',
    ]);

    // Step 4: Verify full config state
    const cfg = await loadConfig();
    expect(cfg.defaultProvider).toBe('deepseek');
    expect(cfg.providers.deepseek.apiKey).toBe('sk-my-deepseek');
    expect(cfg.channels?.yzj?.webhookUrl).toBe('https://yzj.example.com/hook');
    expect(cfg.channels?.yzj?.secret).toBe('my-secret');

    // Step 5: Runtime resolves correctly
    const binding = resolveRuntimeModelBinding(cfg);
    expect(binding.providerId).toBe('deepseek');
    expect(binding.apiKey).toBe('sk-my-deepseek');
  });

  it('switching providers back and forth preserves both configs', async () => {
    // Start with deepseek
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'model', 'deepseek',
    ]);
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'api-key', 'sk-deep-1',
    ]);

    // Switch to anthropic
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'model', 'anthropic',
    ]);
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'api-key', 'sk-ant-1',
    ]);

    // Switch back to deepseek
    await freshProgram().parseAsync([
      'node', 'xiaok', 'config', 'set', 'model', 'deepseek',
    ]);

    const cfg = await loadConfig();
    expect(cfg.defaultProvider).toBe('deepseek');
    // Both API keys preserved
    expect(cfg.providers.deepseek.apiKey).toBe('sk-deep-1');
    expect(cfg.providers.anthropic.apiKey).toBe('sk-ant-1');

    // Runtime uses deepseek
    const binding = resolveRuntimeModelBinding(cfg);
    expect(binding.apiKey).toBe('sk-deep-1');
  });

  it('saveConfig and loadConfig round-trip preserves all fields', async () => {
    const original = {
      schemaVersion: 2 as const,
      defaultProvider: 'kimi' as const,
      defaultModelId: 'kimi-coding',
      providers: {
        kimi: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          apiKey: 'sk-kimi-test',
          baseUrl: 'https://api.kimi.com/coding/v1',
        },
      },
      models: {
        'kimi-coding': {
          provider: 'kimi',
          model: 'kimi-for-coding',
          label: 'Kimi Coding',
          capabilities: ['tools'],
        },
      },
      defaultMode: 'interactive' as const,
      channels: {
        yzj: {
          webhookUrl: 'https://hook.com',
          inboundMode: 'websocket' as const,
          webhookPath: '/api/hook',
          webhookPort: 9090,
          secret: 's3cret',
        },
      },
    };

    await saveConfig(original);
    const loaded = await loadConfig();

    expect(loaded.defaultProvider).toBe('kimi');
    expect(loaded.providers.kimi.apiKey).toBe('sk-kimi-test');
    expect(loaded.models['kimi-coding'].model).toBe('kimi-for-coding');
    expect(loaded.channels?.yzj?.webhookUrl).toBe('https://hook.com');
    expect(loaded.channels?.yzj?.webhookPort).toBe(9090);
    expect(loaded.channels?.yzj?.secret).toBe('s3cret');
  });
});
