import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/types.js';

const loadConfigMock = vi.fn();
const probeApiKeyMock = vi.fn();

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: loadConfigMock,
  getConfigPath: () => '/tmp/xiaok-test-config.json',
}));

vi.mock('../../src/ai/providers/key-probe.js', () => ({
  probeApiKey: probeApiKeyMock,
}));

const { runCheckKeysCommand } = await import('../../src/commands/doctor.js');

function createConfig(overrides: Partial<Config['providers']> = {}): Config {
  return {
    schemaVersion: 2,
    defaultProvider: 'anthropic',
    defaultModelId: 'anthropic-default',
    providers: { ...overrides },
    models: {},
    defaultMode: 'interactive',
    channels: {},
  };
}

const ALL_ENV_PREFIXES = ['XIAOK_ANTHROPIC', 'XIAOK_CLAUDE', 'XIAOK_OPENAI', 'XIAOK_KIMI', 'XIAOK_DEEPSEEK', 'XIAOK_GLM', 'XIAOK_MINIMAX', 'XIAOK_GEMINI'];
const ALL_STANDARD_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY', 'DEEPSEEK_API_KEY', 'GLM_API_KEY', 'MINIMAX_API_KEY', 'GEMINI_API_KEY'];

function clearAllProviderEnvVars(): void {
  for (const prefix of ALL_ENV_PREFIXES) {
    delete process.env[`${prefix}_API_KEY`];
  }
  for (const name of ALL_STANDARD_ENV_VARS) {
    delete process.env[name];
  }
}

describe('runCheckKeysCommand', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    clearAllProviderEnvVars();
    loadConfigMock.mockReset();
    probeApiKeyMock.mockReset();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('reports no candidates found when nothing is configured', async () => {
    loadConfigMock.mockResolvedValue(createConfig());

    const output = await runCheckKeysCommand();

    expect(output).toContain('未发现任何候选 API Key');
    expect(probeApiKeyMock).not.toHaveBeenCalled();
  });

  it('masks the key value and labels the source and validation status', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-1234567890abcdef';
    loadConfigMock.mockResolvedValue(createConfig());
    probeApiKeyMock.mockResolvedValue({ status: 'valid' });

    const output = await runCheckKeysCommand();

    expect(output).toContain('Anthropic');
    expect(output).toContain('标准环境变量');
    expect(output).toContain('ANTHROPIC_API_KEY');
    expect(output).toContain('✓ 可用');
    expect(output).not.toContain('sk-ant-1234567890abcdef');
    expect(output).toContain('sk-a...cdef');
  });

  it('labels invalid keys distinctly from valid ones', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-1234567890abcdef';
    loadConfigMock.mockResolvedValue(createConfig());
    probeApiKeyMock.mockResolvedValue({ status: 'invalid', httpStatus: 401 });

    const output = await runCheckKeysCommand();

    expect(output).toContain('✗ 无效');
  });

  it('surfaces network errors without claiming validity', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-1234567890abcdef';
    loadConfigMock.mockResolvedValue(createConfig());
    probeApiKeyMock.mockResolvedValue({ status: 'network_error', detail: 'timeout' });

    const output = await runCheckKeysCommand();

    expect(output).toContain('无法确认');
    expect(output).toContain('timeout');
  });
});
