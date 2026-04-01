import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAdapter } from '../../src/ai/models.js';
import type { Config } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

const BASE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  models: { claude: { model: 'claude-opus-4-6', apiKey: 'sk-claude' } },
};

describe('createAdapter', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('creates ClaudeAdapter when defaultModel is claude', () => {
    const adapter = createAdapter(BASE_CONFIG);
    expect(adapter.constructor.name).toBe('ClaudeAdapter');
  });

  it('creates OpenAIAdapter when defaultModel is openai', () => {
    const config: Config = { ...BASE_CONFIG, defaultModel: 'openai', models: { openai: { model: 'gpt-4o', apiKey: 'sk-openai' } } };
    const adapter = createAdapter(config);
    expect(adapter.constructor.name).toBe('OpenAIAdapter');
  });

  it('prefers env var over config apiKey', () => {
    process.env.XIAOK_CLAUDE_API_KEY = 'env-key';
    // Should not throw; env key takes precedence
    const adapter = createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } });
    expect(adapter).toBeTruthy();
    delete process.env.XIAOK_CLAUDE_API_KEY;
  });

  it('throws when no apiKey configured for claude', () => {
    expect(() => createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } }))
      .toThrow(/API Key/);
  });

  it('throws when custom model has no baseUrl', () => {
    const config: Config = { ...BASE_CONFIG, defaultModel: 'custom', models: { custom: { baseUrl: '', apiKey: 'k' } } };
    expect(() => createAdapter(config)).toThrow(/baseUrl/);
  });

  it('does not accept XIAOK_API_KEY (unprefixed)', () => {
    process.env.XIAOK_API_KEY = 'generic-key';
    expect(() => createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } }))
      .toThrow(/API Key/); // should still throw — unprefixed var not used
    delete process.env.XIAOK_API_KEY;
  });

  it('routes claude-compatible custom endpoints to ClaudeAdapter', () => {
    const config: Config = {
      ...BASE_CONFIG,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'http://ccr.client.yzjop.com/claude-code',
          apiKey: 'sk-custom',
          model: 'sonnet4.6',
        },
      },
    };

    const adapter = createAdapter(config);

    expect(adapter.constructor.name).toBe('ClaudeAdapter');
  });

  it('keeps gpt-style custom endpoints on OpenAIAdapter', () => {
    const config: Config = {
      ...BASE_CONFIG,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://cc.sub.258000.sbs',
          apiKey: 'sk-custom',
          model: 'gpt-5.4',
        },
      },
    };

    const adapter = createAdapter(config);

    expect(adapter.constructor.name).toBe('OpenAIAdapter');
  });
});
