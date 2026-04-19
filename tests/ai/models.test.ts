import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAdapter } from '../../src/ai/models.js';
import type { Config, LegacyConfig } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

const BASE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  providers: {
    anthropic: {
      type: 'first_party',
      protocol: 'anthropic',
      apiKey: 'sk-claude',
      baseUrl: 'https://api.anthropic.com',
    },
  },
  models: {
    'anthropic-default': {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      label: 'Anthropic Default',
    },
  },
};

describe('createAdapter', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('creates ClaudeAdapter for the default anthropic model id', () => {
    const adapter = createAdapter(BASE_CONFIG);
    expect(adapter.constructor.name).toBe('ClaudeAdapter');
  });

  it('creates OpenAIAdapter for a selected openai model id', () => {
    const config: Config = {
      ...BASE_CONFIG,
      defaultProvider: 'openai',
      defaultModelId: 'openai-default',
      providers: {
        openai: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
        },
      },
      models: {
        'openai-default': {
          provider: 'openai',
          model: 'gpt-4o',
          label: 'OpenAI Default',
        },
      },
    };
    const adapter = createAdapter(config);
    expect(adapter.constructor.name).toBe('OpenAIAdapter');
  });

  it('prefers env var over config apiKey', () => {
    process.env.XIAOK_ANTHROPIC_API_KEY = 'env-key';
    // Should not throw; env key takes precedence
    const adapter = createAdapter({
      ...BASE_CONFIG,
      providers: {
        anthropic: {
          type: 'first_party',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
      },
    });
    expect(adapter).toBeTruthy();
    delete process.env.XIAOK_ANTHROPIC_API_KEY;
  });

  it('throws when no apiKey configured for anthropic', () => {
    expect(() => createAdapter({
      ...BASE_CONFIG,
      providers: {
        anthropic: {
          type: 'first_party',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
      },
    }))
      .toThrow(/API Key/);
  });

  it('throws when custom provider has no baseUrl', () => {
    const config: Config = {
      ...BASE_CONFIG,
      defaultProvider: 'custom-default',
      defaultModelId: 'custom-default-model',
      providers: {
        'custom-default': {
          type: 'custom',
          protocol: 'openai_legacy',
          apiKey: 'k',
          baseUrl: '',
        },
      },
      models: {
        'custom-default-model': {
          provider: 'custom-default',
          model: 'default',
          label: 'Custom Default',
        },
      },
    };
    expect(() => createAdapter(config)).toThrow(/baseUrl/);
  });

  it('does not accept XIAOK_API_KEY (unprefixed)', () => {
    process.env.XIAOK_API_KEY = 'generic-key';
    expect(() => createAdapter({
      ...BASE_CONFIG,
      providers: {
        anthropic: {
          type: 'first_party',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
      },
    }))
      .toThrow(/API Key/); // should still throw — unprefixed var not used
    delete process.env.XIAOK_API_KEY;
  });

  it('routes v1 claude-compatible custom endpoints to ClaudeAdapter', () => {
    const config: LegacyConfig = {
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'http://ccr.client.yzjop.com/claude-code',
          apiKey: 'sk-custom',
          model: 'sonnet4.6',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };

    const adapter = createAdapter(config);

    expect(adapter.constructor.name).toBe('ClaudeAdapter');
  });

  it('keeps v1 gpt-style custom endpoints on OpenAIAdapter', () => {
    const config: LegacyConfig = {
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://cc.sub.258000.sbs',
          apiKey: 'sk-custom',
          model: 'gpt-5.4',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };

    const adapter = createAdapter(config);

    expect(adapter.constructor.name).toBe('OpenAIAdapter');
  });

  it('routes gemini provider profiles to OpenAIResponsesAdapter', () => {
    const config: Config = {
      ...BASE_CONFIG,
      defaultProvider: 'gemini',
      defaultModelId: 'gemini-default',
      providers: {
        gemini: {
          type: 'first_party',
          protocol: 'openai_responses',
          apiKey: 'sk-gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
      },
      models: {
        'gemini-default': {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          label: 'Gemini Default',
        },
      },
    };

    const adapter = createAdapter(config);
    expect(adapter.constructor.name).toBe('OpenAIResponsesAdapter');
  });
});
