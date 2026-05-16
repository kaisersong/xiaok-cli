import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { loadConfig } from '../../src/utils/config.js';
import { registerConfigCommands } from '../../src/commands/config.js';

function seedConfig(testDir: string, config: Record<string, unknown>): void {
  writeFileSync(join(testDir, 'config.json'), JSON.stringify(config, null, 2));
}

function freshProgram(): Command {
  const program = new Command();
  registerConfigCommands(program);
  return program;
}

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

  // ─── config set default-model ─────────────────────────────────────

  describe('config set default-model', () => {
    it('sets the default model id without mutating provider credentials', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'kimi',
        defaultModelId: 'kimi-coding',
        providers: {
          kimi: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'sk-kimi', baseUrl: 'https://api.kimi.com/coding/v1' },
        },
        models: {
          'kimi-coding': { provider: 'kimi', model: 'kimi-for-coding', label: 'Kimi Coding' },
          'kimi-k2-thinking': { provider: 'kimi', model: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'default-model', 'kimi-k2-thinking']);

      const updated = await loadConfig();
      expect(updated.defaultModelId).toBe('kimi-k2-thinking');
      expect(updated.defaultProvider).toBe('kimi');
      expect(updated.providers.kimi.apiKey).toBe('sk-kimi');
    });

    it('prints error for unknown model id', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'anthropic',
        defaultModelId: 'anthropic-default',
        providers: { anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' } },
        models: { 'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default' } },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'default-model', 'nonexistent']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('未知模型: nonexistent');
      const updated = await loadConfig();
      expect(updated.defaultModelId).toBe('anthropic-default');
    });
  });

  // ─── config set model ─────────────────────────────────────────────

  describe('config set model', () => {
    it('switches to existing model by modelId', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'anthropic',
        defaultModelId: 'anthropic-default',
        providers: { anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' } },
        models: {
          'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default' },
          'deepseek-default': { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'deepseek-default']);

      const updated = await loadConfig();
      expect(updated.defaultModelId).toBe('deepseek-default');
      expect(updated.defaultProvider).toBe('deepseek');
    });

    it('creates provider and default model from bare provider name', async () => {
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'deepseek']);

      const updated = await loadConfig();
      expect(updated.defaultProvider).toBe('deepseek');
      expect(updated.models['deepseek-default']).toMatchObject({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
      });
      expect(updated.providers.deepseek).toMatchObject({
        type: 'first_party',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.deepseek.com/v1',
      });
    });

    it('creates model from provider/model syntax', async () => {
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'gemini/gemini-2.5-pro']);

      const updated = await loadConfig();
      expect(updated.defaultProvider).toBe('gemini');
      expect(updated.defaultModelId).toBe('gemini-gemini-2-5-pro');
      expect(updated.models['gemini-gemini-2-5-pro']).toMatchObject({
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        label: 'gemini-2.5-pro',
      });
    });

    it('normalizes claude alias to anthropic', async () => {
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'claude']);

      const updated = await loadConfig();
      expect(updated.defaultProvider).toBe('anthropic');
    });

    it('sets --base-url and --api-key on provider', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'model', 'deepseek',
        '--base-url', 'https://custom.api.com/v1',
        '--api-key', 'sk-custom',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.deepseek.baseUrl).toBe('https://custom.api.com/v1');
      expect(updated.providers.deepseek.apiKey).toBe('sk-custom');
    });

    it('sets up custom provider with --base-url', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'model', 'custom/my-llm',
        '--base-url', 'https://my-llm.local/v1',
      ]);

      const updated = await loadConfig();
      expect(updated.defaultProvider).toBe('custom-default');
      expect(updated.providers['custom-default'].baseUrl).toBe('https://my-llm.local/v1');
      expect(updated.models['custom-default-my-llm']).toMatchObject({
        provider: 'custom-default',
        model: 'my-llm',
      });
    });

    it('errors when custom provider has no baseUrl', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'model', 'custom/my-llm',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('请先设置 baseUrl'),
      );
    });

    it('errors on unknown model input', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'model', 'totally-unknown-value',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('未知模型'),
      );
    });

    it('reuses existing model entry when provider already has a model', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'anthropic',
        defaultModelId: 'anthropic-default',
        providers: {
          anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
          deepseek: { type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-existing' },
        },
        models: {
          'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default' },
          'deepseek-default': { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'deepseek']);

      const updated = await loadConfig();
      expect(updated.defaultModelId).toBe('deepseek-default');
      expect(updated.providers.deepseek.apiKey).toBe('sk-existing');
    });
  });

  // ─── config set api-key ───────────────────────────────────────────

  describe('config set api-key', () => {
    it('updates provider api key on the provider catalog', async () => {
      seedConfig(testDir, {
        schemaVersion: 1,
        defaultModel: 'claude',
        models: { claude: { model: 'claude-opus-4-6' } },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-ant-new', '--provider', 'anthropic',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.anthropic.apiKey).toBe('sk-ant-new');
    });

    it('switches default provider when setting api-key for a different provider', async () => {
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

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-deep-new', '--provider', 'deepseek',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.deepseek.apiKey).toBe('sk-deep-new');
      expect(updated.defaultProvider).toBe('deepseek');
      expect(updated.defaultModelId).toBe('deepseek-default');
      expect(updated.models['deepseek-default']).toMatchObject({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
      });

      const logOutput = consoleLogSpy.mock.calls.map(([v]) => String(v)).join(' ');
      expect(logOutput).toContain('并切换为默认提供商');
    });

    it('does not switch provider when setting api-key for current default', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'anthropic',
        defaultModelId: 'anthropic-default',
        providers: {
          anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
        },
        models: {
          'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-ant-new', '--provider', 'anthropic',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.anthropic.apiKey).toBe('sk-ant-new');
      expect(updated.defaultProvider).toBe('anthropic');
      expect(updated.defaultModelId).toBe('anthropic-default');

      const logOutput = consoleLogSpy.mock.calls.map(([v]) => String(v)).join(' ');
      expect(logOutput).not.toContain('并切换为默认提供商');
    });

    it('uses default provider when --provider is omitted', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'deepseek',
        defaultModelId: 'deepseek-default',
        providers: {
          deepseek: { type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com/v1' },
        },
        models: {
          'deepseek-default': { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-ds-key',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.deepseek.apiKey).toBe('sk-ds-key');
      expect(updated.defaultProvider).toBe('deepseek');
    });

    it('normalizes --provider claude to anthropic', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'deepseek',
        defaultModelId: 'deepseek-default',
        providers: {
          deepseek: { type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds' },
        },
        models: {
          'deepseek-default': { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        },
        defaultMode: 'interactive',
        channels: {},
      });

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-ant-key', '--provider', 'claude',
      ]);

      const updated = await loadConfig();
      expect(updated.providers.anthropic.apiKey).toBe('sk-ant-key');
      expect(updated.defaultProvider).toBe('anthropic');
    });

    it('errors for custom-default without baseUrl', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'api-key', 'sk-custom', '--provider', 'custom',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('请先设置 baseUrl'),
      );
    });
  });

  // ─── config set yzj-* ─────────────────────────────────────────────

  describe('config set yzj-webhook-url', () => {
    it('sets yzj webhook url', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-url', 'https://example.com/hook',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.webhookUrl).toBe('https://example.com/hook');
      expect(consoleLogSpy).toHaveBeenCalledWith('已设置 channels.yzj.webhookUrl');
    });

    it('preserves existing yzj config', async () => {
      seedConfig(testDir, {
        schemaVersion: 2,
        defaultProvider: 'anthropic',
        defaultModelId: 'anthropic-default',
        providers: { anthropic: { type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' } },
        models: { 'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Anthropic Default' } },
        defaultMode: 'interactive',
        channels: { yzj: { secret: 'old-secret', webhookUrl: 'https://old.com' } },
      });

      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-url', 'https://new.com/hook',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.webhookUrl).toBe('https://new.com/hook');
      expect(updated.channels?.yzj?.secret).toBe('old-secret');
    });
  });

  describe('config set yzj-inbound-mode', () => {
    it('sets webhook mode', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-inbound-mode', 'webhook',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.inboundMode).toBe('webhook');
    });

    it('sets websocket mode', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-inbound-mode', 'websocket',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.inboundMode).toBe('websocket');
    });

    it('rejects invalid mode', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-inbound-mode', 'invalid',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith('inbound-mode 仅支持 webhook 或 websocket');
      const updated = await loadConfig();
      expect(updated.channels?.yzj?.inboundMode).toBeUndefined();
    });
  });

  describe('config set yzj-webhook-path', () => {
    it('sets webhook path', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-path', '/api/webhook',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.webhookPath).toBe('/api/webhook');
    });
  });

  describe('config set yzj-webhook-port', () => {
    it('sets webhook port', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-port', '8080',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.webhookPort).toBe(8080);
    });

    it('rejects non-integer port', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-port', 'abc',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith('webhook-port 必须是正整数');
    });

    it('rejects zero port', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-port', '0',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith('webhook-port 必须是正整数');
    });

    it('rejects negative port', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-webhook-port', '--', '-1',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith('webhook-port 必须是正整数');
    });
  });

  describe('config set yzj-secret', () => {
    it('sets yzj secret', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'yzj-secret', 'my-secret-key',
      ]);

      const updated = await loadConfig();
      expect(updated.channels?.yzj?.secret).toBe('my-secret-key');
    });
  });

  // ─── config get ────────────────────────────────────────────────────

  describe('config get', () => {
    const baseConfig = {
      schemaVersion: 2,
      defaultProvider: 'kimi',
      defaultModelId: 'kimi-coding',
      providers: {
        kimi: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'sk-kimi', baseUrl: 'https://api.kimi.com/coding/v1' },
      },
      models: {
        'kimi-coding': { provider: 'kimi', model: 'kimi-for-coding', label: 'Kimi Coding' },
      },
      defaultMode: 'interactive',
      channels: {
        yzj: {
          webhookUrl: 'https://hook.example.com',
          inboundMode: 'websocket',
          webhookPath: '/api/hook',
          webhookPort: 9090,
          secret: 's3cret',
        },
      },
    };

    it('prints current model info', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'model']);

      expect(consoleLogSpy).toHaveBeenCalledWith('kimi-coding (kimi/kimi-for-coding)');
    });

    it('prints model without details when model entry missing', async () => {
      seedConfig(testDir, { ...baseConfig, defaultModelId: 'missing-model' });
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'model']);

      expect(consoleLogSpy).toHaveBeenCalledWith('missing-model');
    });

    it('prints models catalog', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'models']);

      const output = consoleLogSpy.mock.calls.map(([v]) => String(v)).join('');
      expect(output).toContain('kimi-coding');
      expect(output).toContain('kimi-for-coding');
    });

    it('prints providers catalog', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'providers']);

      const output = consoleLogSpy.mock.calls.map(([v]) => String(v)).join('');
      expect(output).toContain('kimi');
      expect(output).toContain('openai_legacy');
    });

    it('prints yzj config', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj']);

      const output = consoleLogSpy.mock.calls.map(([v]) => String(v)).join('');
      expect(output).toContain('webhookUrl');
      expect(output).toContain('https://hook.example.com');
    });

    it('prints null for yzj when not configured', async () => {
      seedConfig(testDir, { ...baseConfig, channels: {} });
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj']);

      expect(consoleLogSpy).toHaveBeenCalledWith('null');
    });

    it('prints yzj.webhook-url', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj.webhook-url']);

      expect(consoleLogSpy).toHaveBeenCalledWith('https://hook.example.com');
    });

    it('prints yzj.inbound-mode', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj.inbound-mode']);

      expect(consoleLogSpy).toHaveBeenCalledWith('websocket');
    });

    it('prints yzj.webhook-path', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj.webhook-path']);

      expect(consoleLogSpy).toHaveBeenCalledWith('/api/hook');
    });

    it('prints yzj.webhook-port', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj.webhook-port']);

      expect(consoleLogSpy).toHaveBeenCalledWith(9090);
    });

    it('prints empty string for unset yzj keys', async () => {
      seedConfig(testDir, { ...baseConfig, channels: {} });
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'yzj.webhook-url']);

      expect(consoleLogSpy).toHaveBeenCalledWith('');
    });

    it('falls back to JSON for unknown top-level key', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'defaultMode']);

      expect(consoleLogSpy).toHaveBeenCalledWith('"interactive"');
    });

    it('prints null for missing top-level key', async () => {
      seedConfig(testDir, baseConfig);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'get', 'nonexistent']);

      expect(consoleLogSpy).toHaveBeenCalledWith('null');
    });
  });

  // ─── config persistence ────────────────────────────────────────────

  describe('config persistence', () => {
    it('writes valid JSON to config.json', async () => {
      await freshProgram().parseAsync([
        'node', 'xiaok', 'config', 'set', 'model', 'deepseek',
      ]);

      const raw = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
      expect(raw.defaultProvider).toBe('deepseek');
      expect(raw.schemaVersion).toBe(2);
    });

    it('multiple config set operations accumulate correctly', async () => {
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'model', 'deepseek']);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'yzj-webhook-url', 'https://hook.com']);
      await freshProgram().parseAsync(['node', 'xiaok', 'config', 'set', 'yzj-secret', 'abc123']);

      const updated = await loadConfig();
      expect(updated.defaultProvider).toBe('deepseek');
      expect(updated.channels?.yzj?.webhookUrl).toBe('https://hook.com');
      expect(updated.channels?.yzj?.secret).toBe('abc123');
    });
  });
});
