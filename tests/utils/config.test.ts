import { OLD_MODEL_EFFORT_CONFIGS } from '../support/model-effort-compatibility.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
// tests/utils/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig, getConfigPath, getConfigDir } from '../../src/utils/config.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

describe('config', () => {
  let testDir: string;

  beforeEach(() => {
    // Use crypto random suffix to guarantee unique dir even if Date.now() repeats
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it.each(OLD_MODEL_EFFORT_CONFIGS)('loads and saves a strength-free old config without backup or loss: $name', async ({ config, wireModel, effort, contextLimit }) => {
    const path = getConfigPath();
    const oldContent = JSON.stringify(config, null, 2);
    writeFileSync(path, oldContent);
    const loaded = await loadConfig();
    const binding = resolveRuntimeModelBinding(loaded);
    expect(binding.wireModel).toBe(wireModel);
    expect(binding.runtimeOptions?.reasoningEffort).toBe(effort);
    expect(binding.runtimeOptions?.contextLimit).toBe(contextLimit);
    expect(readFileSync(path, 'utf8')).toBe(oldContent);
    expect(existsSync(path + '.bak')).toBe(false);
    await saveConfig(loaded);
    const reloaded = await loadConfig();
    expect(resolveRuntimeModelBinding(reloaded)).toEqual(binding);
    if (config.schemaVersion === 2) {
      expect(reloaded.providers).toEqual(config.providers);
      expect(reloaded.models).toEqual(config.models);
    }
  });

  it('returns DEFAULT_CONFIG when no config file exists', async () => {
    const config = await loadConfig();
    expect(config.schemaVersion).toBe(2);
    expect(config.defaultProvider).toBe('anthropic');
    expect(config.defaultModelId).toBe('anthropic-default');
  });

  it('reads and parses valid config file', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, contextBudget: 8000 })
    );
    const config = await loadConfig();
    expect(config.contextBudget).toBe(8000);
  });

  it('preserves nested default model config when file only overrides part of models', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultModel: 'claude',
        models: {
          claude: {
            apiKey: 'test-key',
          },
        },
        defaultMode: 'interactive',
        contextBudget: 4000,
      })
    );

    const config = await loadConfig();

    expect(config.providers.anthropic?.apiKey).toBe('test-key');
    expect(config.models['anthropic-default']?.model).toBe(DEFAULT_CONFIG.models['anthropic-default']?.model);
  });

  it('merges yzj channel config with defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultModel: 'claude',
        models: {
          claude: {
            model: 'claude-opus-4-6',
          },
        },
        defaultMode: 'interactive',
        contextBudget: 4000,
        channels: {
          yzj: {
            webhookUrl: 'https://www.yunzhijia.com/gateway/robot/webhook/send?yzjtype=12&yzjtoken=abc',
            webhookPort: 3100,
          },
        },
      })
    );

    const config = await loadConfig();

    expect(config.channels?.yzj?.webhookUrl).toContain('yzjtoken=abc');
    expect(config.channels?.yzj?.webhookPort).toBe(3100);
  });

  it('renames corrupt config to .bak and returns defaults', async () => {
    writeFileSync(join(testDir, 'config.json'), 'not valid json');
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('renames unknown schemaVersion config to .bak and returns defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ schemaVersion: 99, defaultModel: 'claude' })
    );
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('renames config with invalid defaultModel to .bak and returns defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ schemaVersion: 1, defaultModel: 'malicious_provider' })
    );
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('saveConfig writes valid JSON and loadConfig reads it back', async () => {
    const cfg = { ...DEFAULT_CONFIG, contextBudget: 2000 };
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect((loaded as typeof loaded & { contextBudget?: number }).contextBudget).toBe(2000);
  });

  it('provides default intent boundary settings', async () => {
    const config = await loadConfig();

    expect(config.intentBoundary).toEqual({
      llmClassifier: 'off',
      ambiguousFallback: 'legacy_validator',
      confidenceThreshold: 0.75,
      falseNegativeClarifyThreshold: 0.85,
      timeoutMs: 1500,
      maxInputTokens: 200,
      maxOutputTokens: 100,
    });
  });

  it('normalizes partial intent boundary settings', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        ...DEFAULT_CONFIG,
        intentBoundary: {
          llmClassifier: 'shadow',
          timeoutMs: 500,
        },
      }),
    );

    const config = await loadConfig();

    expect(config.intentBoundary).toEqual({
      llmClassifier: 'shadow',
      ambiguousFallback: 'legacy_validator',
      confidenceThreshold: 0.75,
      falseNegativeClarifyThreshold: 0.85,
      timeoutMs: 500,
      maxInputTokens: 200,
      maxOutputTokens: 100,
    });
  });
});

describe('getConfigDir', () => {
  const originalEnv = process.env.XIAOK_CONFIG_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalEnv;
    }
  });

  it('returns base dir when called without args', () => {
    process.env.XIAOK_CONFIG_DIR = '/tmp/xiaok-base';
    expect(getConfigDir()).toBe('/tmp/xiaok-base');
  });

  it('joins subdir under base', () => {
    process.env.XIAOK_CONFIG_DIR = '/tmp/xiaok-base';
    expect(getConfigDir('plugins')).toBe(join('/tmp/xiaok-base', 'plugins'));
    expect(getConfigDir('runtime')).toBe(join('/tmp/xiaok-base', 'runtime'));
  });

  it('respects XIAOK_CONFIG_DIR override for subdir', () => {
    process.env.XIAOK_CONFIG_DIR = '/custom/root';
    expect(getConfigDir('desktop')).toBe(join('/custom/root', 'desktop'));
  });

  describe.skipIf(process.platform === 'win32')('file permissions (config holds API keys)', () => {
    const modeOf = (p: string) => statSync(p).mode & 0o777;
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `xiaok-perm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });
      process.env.XIAOK_CONFIG_DIR = testDir;
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
      delete process.env.XIAOK_CONFIG_DIR;
    });

    it('creates config.json as 600 and the config dir as 700', async () => {
      rmSync(testDir, { recursive: true, force: true });
      await saveConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      expect(modeOf(getConfigPath())).toBe(0o600);
      expect(modeOf(getConfigDir())).toBe(0o700);
    });

    it('keeps config.json at 600 after every update', async () => {
      const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      await saveConfig(config);
      chmodSync(getConfigPath(), 0o644);
      await saveConfig({ ...config, contextBudget: 9000 });
      expect(modeOf(getConfigPath())).toBe(0o600);
      expect((await loadConfig()).contextBudget).toBe(9000);
    });

    it('tightens a legacy 644 config.json and 755 dir on load without changing content', async () => {
      const content = JSON.stringify(DEFAULT_CONFIG, null, 2);
      writeFileSync(getConfigPath(), content, { mode: 0o644 });
      chmodSync(getConfigPath(), 0o644);
      chmodSync(getConfigDir(), 0o755);
      await loadConfig();
      expect(modeOf(getConfigPath())).toBe(0o600);
      expect(modeOf(getConfigDir())).toBe(0o700);
      expect(readFileSync(getConfigPath(), 'utf8')).toBe(content);
    });

    it('writes the .bak of a corrupt config as 600', async () => {
      writeFileSync(getConfigPath(), '{ not json', { mode: 0o644 });
      chmodSync(getConfigPath(), 0o644);
      await loadConfig();
      expect(modeOf(getConfigPath() + '.bak')).toBe(0o600);
    });
  });
});
