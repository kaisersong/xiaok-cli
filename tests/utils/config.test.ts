// tests/utils/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig, getConfigPath } from '../../src/utils/config.js';
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

  it('returns DEFAULT_CONFIG when no config file exists', async () => {
    const config = await loadConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.defaultModel).toBe('claude');
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

    expect(config.models.claude?.apiKey).toBe('test-key');
    expect(config.models.claude?.model).toBe(DEFAULT_CONFIG.models.claude?.model);
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
    expect(loaded.contextBudget).toBe(2000);
  });
});
