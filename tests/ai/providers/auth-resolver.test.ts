import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../../src/types.js';
import {
  listCandidateApiKeys,
  resolveProviderApiKey,
  resolveProviderTransport,
} from '../../../src/ai/providers/auth-resolver.js';

function createConfig(providerId: string, apiKey?: string): Config {
  return {
    schemaVersion: 2,
    defaultProvider: providerId,
    defaultModelId: `${providerId}-default`,
    providers: {
      [providerId]: {
        type: 'first_party',
        protocol: 'anthropic',
        ...(apiKey ? { apiKey } : {}),
      },
    },
    models: {},
    defaultMode: 'interactive',
    channels: {},
  };
}

describe('resolveProviderApiKey', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.XIAOK_ANTHROPIC_API_KEY;
    delete process.env.XIAOK_CLAUDE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('prefers XIAOK_<PREFIX>_API_KEY over standard env vars and config', () => {
    process.env.XIAOK_ANTHROPIC_API_KEY = 'sk-xiaok-env';
    process.env.ANTHROPIC_API_KEY = 'sk-standard-env';
    const config = createConfig('anthropic', 'sk-config');

    expect(resolveProviderApiKey(config, 'anthropic')).toBe('sk-xiaok-env');
  });

  it('falls back to standard env var (e.g. ANTHROPIC_API_KEY) when XIAOK_ prefix is not set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-standard-env';
    const config = createConfig('anthropic', 'sk-config');

    expect(resolveProviderApiKey(config, 'anthropic')).toBe('sk-standard-env');
  });

  it('checks all envPrefixes for standard env vars (anthropic also accepts CLAUDE_API_KEY)', () => {
    process.env.CLAUDE_API_KEY = 'sk-claude-env';
    const config = createConfig('anthropic', 'sk-config');

    expect(resolveProviderApiKey(config, 'anthropic')).toBe('sk-claude-env');
  });

  it('falls back to stored config apiKey when no env vars are set', () => {
    const config = createConfig('anthropic', 'sk-config');

    expect(resolveProviderApiKey(config, 'anthropic')).toBe('sk-config');
  });

  it('returns empty string when nothing is configured', () => {
    const config = createConfig('anthropic');

    expect(resolveProviderApiKey(config, 'anthropic')).toBe('');
  });
});

describe('listCandidateApiKeys', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.XIAOK_ANTHROPIC_API_KEY;
    delete process.env.XIAOK_CLAUDE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('lists all distinct candidates in priority order with correct source labels', () => {
    process.env.XIAOK_ANTHROPIC_API_KEY = 'sk-xiaok-env';
    process.env.ANTHROPIC_API_KEY = 'sk-standard-env';
    const config = createConfig('anthropic', 'sk-config');

    expect(listCandidateApiKeys(config, 'anthropic')).toEqual([
      { source: 'xiaok_env', envVarName: 'XIAOK_ANTHROPIC_API_KEY', apiKey: 'sk-xiaok-env' },
      { source: 'standard_env', envVarName: 'ANTHROPIC_API_KEY', apiKey: 'sk-standard-env' },
      { source: 'config', apiKey: 'sk-config' },
    ]);
  });

  it('deduplicates candidates that resolve to the same key value', () => {
    process.env.XIAOK_ANTHROPIC_API_KEY = 'sk-same';
    const config = createConfig('anthropic', 'sk-same');

    const candidates = listCandidateApiKeys(config, 'anthropic');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      source: 'xiaok_env',
      envVarName: 'XIAOK_ANTHROPIC_API_KEY',
      apiKey: 'sk-same',
    });
  });

  it('returns an empty array when there are no candidates', () => {
    const config = createConfig('anthropic');

    expect(listCandidateApiKeys(config, 'anthropic')).toEqual([]);
  });
});

describe('resolveProviderTransport', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.XIAOK_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('resolves apiKey via the same fallback chain as resolveProviderApiKey', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-standard-env';
    const config = createConfig('anthropic');

    const transport = resolveProviderTransport(config, 'anthropic');
    expect(transport.apiKey).toBe('sk-standard-env');
  });
});
