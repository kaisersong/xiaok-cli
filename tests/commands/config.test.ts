import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { loadConfig } from '../../src/utils/config.js';
import { registerConfigCommands } from '../../src/commands/config.js';

describe('config commands', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('sets the default model id without mutating provider credentials', async () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultProvider: 'kimi',
      defaultModelId: 'kimi-coding',
      providers: {
        kimi: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
        },
      },
      models: {
        'kimi-coding': {
          provider: 'kimi',
          model: 'kimi-for-coding',
          label: 'Kimi Coding',
        },
        'kimi-k2-thinking': {
          provider: 'kimi',
          model: 'kimi-k2-thinking',
          label: 'Kimi K2 Thinking',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    }, null, 2));

    const program = new Command();
    registerConfigCommands(program);
    await program.parseAsync(['node', 'xiaok', 'config', 'set', 'default-model', 'kimi-k2-thinking']);

    const updated = await loadConfig();
    expect(updated.defaultModelId).toBe('kimi-k2-thinking');
    expect(updated.defaultProvider).toBe('kimi');
    expect(updated.providers.kimi.apiKey).toBe('sk-kimi');
  });

  it('updates provider api key on the provider catalog', async () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: {
          model: 'claude-opus-4-6',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    }, null, 2));

    const program = new Command();
    registerConfigCommands(program);
    await program.parseAsync(['node', 'xiaok', 'config', 'set', 'api-key', 'sk-ant-new', '--provider', 'anthropic']);

    const updated = await loadConfig();
    expect(updated.providers.anthropic.apiKey).toBe('sk-ant-new');
    expect(updated.defaultProvider).toBe('anthropic');
  });

  it('creates a new model entry from provider/model and switches default model id', async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'gemini/gemini-2.5-pro']);

    const updated = await loadConfig();
    expect(updated.defaultProvider).toBe('gemini');
    expect(updated.defaultModelId).toBe('gemini-gemini-2-5-pro');
    expect(updated.providers.gemini).toMatchObject({
      type: 'first_party',
      protocol: 'openai_responses',
    });
    expect(updated.models['gemini-gemini-2-5-pro']).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      label: 'gemini-2.5-pro',
    });
  });

  it('prints provider and model catalogs through config get', async () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultProvider: 'kimi',
      defaultModelId: 'kimi-coding',
      providers: {
        kimi: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
        },
      },
      models: {
        'kimi-coding': {
          provider: 'kimi',
          model: 'kimi-for-coding',
          label: 'Kimi Coding',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    }, null, 2));

    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'xiaok', 'config', 'get', 'providers']);
    await program.parseAsync(['node', 'xiaok', 'config', 'get', 'models']);

    const output = consoleLogSpy.mock.calls.map(([value]) => String(value));
    expect(output.some((line) => line.includes('"kimi"') && line.includes('"protocol": "openai_legacy"'))).toBe(true);
    expect(output.some((line) => line.includes('"kimi-coding"') && line.includes('"model": "kimi-for-coding"'))).toBe(true);
  });
});
