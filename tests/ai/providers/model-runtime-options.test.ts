import { describe, expect, it } from 'vitest';
import {
  isOfficialKimiK3OpenAIEndpoint,
  resolveModelRuntimeOptions,
} from '../../../src/ai/providers/model-runtime-options.js';
import type {
  ModelRuntimeConstraints,
  ModelRuntimeOptions,
} from '../../../src/ai/providers/types.js';

const KIMI_K3_OPENAI_ENDPOINT = 'https://api.kimi.com/coding/v1';

describe('isOfficialKimiK3OpenAIEndpoint', () => {
  it('accepts parsed equivalents of the official HTTPS endpoint', () => {
    for (const endpoint of [
      KIMI_K3_OPENAI_ENDPOINT,
      `${KIMI_K3_OPENAI_ENDPOINT}/`,
      'https://api.kimi.com:443/coding/v1',
      'https://API.KIMI.COM/coding/v1/',
    ]) {
      expect(isOfficialKimiK3OpenAIEndpoint(endpoint), endpoint).toBe(true);
    }

    for (const endpoint of [
      'http://api.kimi.com/coding/v1',
      'https://api.kimi.com:444/coding/v1',
      'https://api.kimi.com.evil.test/coding/v1',
      'https://api.kimi.com/coding-proxy/v1',
      'https://proxy.example.com/v1',
      'https://api.kimi.com/coding/v1?mode=proxy',
      'https://api.kimi.com/coding/v1#fragment',
      'https://user@api.kimi.com/coding/v1',
      'not a URL',
    ]) {
      expect(isOfficialKimiK3OpenAIEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe('resolveModelRuntimeOptions', () => {
  it('applies K3 defaults and constraints to the exact official OpenAI endpoint', () => {
    expect(resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
    })).toEqual({
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
  });

  it('applies the same strict runtime policy to k3-256k', () => {
    expect(resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3-256k',
    })).toEqual({
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
  });

  it('lets configured options override catalog options and K3 defaults', () => {
    const result = resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: `${KIMI_K3_OPENAI_ENDPOINT}/`,
      wireModel: 'k3',
      catalogOptions: {
        contextLimit: 524_288,
        reasoningEffort: 'max',
      },
      configuredOptions: {
        contextLimit: 1_048_576,
        reasoningEffort: 'low',
      },
    });

    expect(result.runtimeOptions).toEqual({
      contextLimit: 1_048_576,
      reasoningEffort: 'low',
    });
  });

  it('merges catalog and configured options for models without a fallback', () => {
    expect(resolveModelRuntimeOptions({
      protocol: 'anthropic',
      wireModel: 'custom-model',
      catalogOptions: {
        contextLimit: 128_000,
        reasoningEffort: 'high',
      },
      configuredOptions: {
        reasoningEffort: 'low',
      },
    })).toEqual({
      runtimeOptions: {
        contextLimit: 128_000,
        reasoningEffort: 'low',
      },
    });
  });

  it.each([
    0,
    -1,
    1.5,
    1_048_577,
  ])('rejects invalid K3 contextLimit %s', (contextLimit) => {
    expect(() => resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
      configuredOptions: { contextLimit },
    })).toThrow(/contextLimit/);
  });

  it('rejects a reasoning effort outside the K3 constraints', () => {
    expect(() => resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
      configuredOptions: {
        reasoningEffort: 'medium',
      } as unknown as ModelRuntimeOptions,
    })).toThrow(/reasoningEffort/);
  });

  it('does not let catalog constraints raise the official K3 context limit', () => {
    expect(() => resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
      catalogConstraints: {
        maxContextLimit: 2_000_000,
      },
      configuredOptions: {
        contextLimit: 1_500_000,
      },
    })).toThrow('contextLimit must not exceed 1048576');
  });

  it('intersects catalog reasoning efforts with the official K3 efforts', () => {
    const result = resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
      catalogConstraints: {
        reasoningEfforts: ['low', 'medium'],
      } as unknown as ModelRuntimeConstraints,
      configuredOptions: {
        reasoningEffort: 'low',
      },
    });

    expect(result.runtimeConstraints?.reasoningEfforts).toEqual(['low']);
  });

  it.each([
    ['anthropic protocol', 'anthropic', KIMI_K3_OPENAI_ENDPOINT, 'k3'],
    ['HTTP endpoint', 'openai_legacy', 'http://api.kimi.com/coding/v1', 'k3'],
    ['lookalike host', 'openai_legacy', 'https://api.kimi.com.evil.test/coding/v1', 'k3'],
    ['coding proxy path', 'openai_legacy', 'https://api.kimi.com/coding-proxy/v1', 'k3'],
    ['custom endpoint', 'openai_legacy', 'https://proxy.example.com/v1', 'k3'],
    ['K2.7 model', 'openai_legacy', KIMI_K3_OPENAI_ENDPOINT, 'kimi-k2.7'],
    ['case-mismatched model', 'openai_legacy', KIMI_K3_OPENAI_ENDPOINT, 'K3'],
  ] as const)('does not apply K3 defaults for %s', (_label, protocol, baseUrl, wireModel) => {
    expect(resolveModelRuntimeOptions({
      protocol,
      baseUrl,
      wireModel,
    })).toEqual({});
  });

  it('preserves provider-neutral configured options for a same-named K3 model', () => {
    expect(resolveModelRuntimeOptions({
      protocol: 'openai_legacy',
      baseUrl: 'https://proxy.example.com/v1',
      wireModel: 'k3',
      configuredOptions: {
        contextLimit: 128_000,
        reasoningEffort: 'low',
      },
    })).toEqual({
      runtimeOptions: {
        contextLimit: 128_000,
        reasoningEffort: 'low',
      },
    });
  });

  it('does not mutate nested inputs and clones returned options and constraints', () => {
    const catalogOptions: ModelRuntimeOptions = {
      contextLimit: 524_288,
      reasoningEffort: 'max',
    };
    const configuredOptions: ModelRuntimeOptions = {
      reasoningEffort: 'low',
    };
    const reasoningEfforts: ModelRuntimeConstraints['reasoningEfforts'] = ['low', 'high'];
    const catalogConstraints: ModelRuntimeConstraints = {
      maxContextLimit: 1_048_576,
      reasoningEfforts,
    };
    const input = {
      protocol: 'openai_legacy' as const,
      baseUrl: KIMI_K3_OPENAI_ENDPOINT,
      wireModel: 'k3',
      catalogOptions,
      catalogConstraints,
      configuredOptions,
    };
    const snapshot = structuredClone(input);

    const first = resolveModelRuntimeOptions(input);
    const second = resolveModelRuntimeOptions(input);

    expect(input).toEqual(snapshot);
    expect(first.runtimeOptions).toEqual({
      contextLimit: 524_288,
      reasoningEffort: 'low',
    });
    expect(first.runtimeConstraints).toEqual(catalogConstraints);
    expect(first.runtimeOptions).not.toBe(catalogOptions);
    expect(first.runtimeOptions).not.toBe(configuredOptions);
    expect(first.runtimeConstraints).not.toBe(catalogConstraints);
    expect(first.runtimeConstraints?.reasoningEfforts).not.toBe(reasoningEfforts);
    expect(first.runtimeOptions).not.toBe(second.runtimeOptions);
    expect(first.runtimeConstraints).not.toBe(second.runtimeConstraints);
    expect(first.runtimeConstraints?.reasoningEfforts).not.toBe(second.runtimeConstraints?.reasoningEfforts);
  });
});
