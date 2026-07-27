import { describe, expect, it } from 'vitest';
import {
  buildOpenAIHarnessContext,
  KIMI_K3_CODING_OPENAI_HARNESS_PROFILE,
  observeReasoningDialect,
  resolveKimiHarnessFeatureFlags,
  resolveModelHarnessProfile,
  type AdapterBindingIdentity,
  type OpenAIAdapterInit,
  type ReasoningDialectState,
} from '../../../src/ai/providers/model-harness-profile.js';

describe('resolveModelHarnessProfile', () => {
  const identity: AdapterBindingIdentity = {
    providerId: 'kimi',
    providerType: 'first_party',
    protocol: 'openai_legacy',
    canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
    wireModel: 'k3',
    capabilities: ['tools', 'thinking'],
  };

  it.each([
    ['canonical endpoint', 'https://api.kimi.com/coding/v1'],
    ['trailing slash', 'https://api.kimi.com/coding/v1/'],
    ['uppercase host', 'https://API.KIMI.COM/coding/v1'],
    ['explicit default port', 'https://api.kimi.com:443/coding/v1'],
  ])(
    'selects the strict Kimi K3 coding profile for the parsed-equivalent %s',
    (_label, canonicalBaseUrl) => {
      expect(resolveModelHarnessProfile({
        ...identity,
        canonicalBaseUrl,
      }).id).toBe('kimi-k3-coding-openai');
    },
  );

  it('selects a distinct strict profile for the official k3-256k model', () => {
    expect(resolveModelHarnessProfile({
      ...identity,
      wireModel: 'k3-256k',
    }).id).toBe('kimi-k3-256k-coding-openai');
  });

  it.each([
    ['wrong provider id', { providerId: 'moonshot' }],
    ['custom Kimi provider', { providerType: 'custom' }],
    ['Kimi K2.7 model', { wireModel: 'kimi-k2.7' }],
    ['wrong protocol', { protocol: 'openai_responses' }],
    ['lookalike host', { canonicalBaseUrl: 'https://api.kimi.com.evil.example/coding/v1' }],
    ['non-default port', { canonicalBaseUrl: 'https://api.kimi.com:444/coding/v1' }],
    ['query string', { canonicalBaseUrl: 'https://api.kimi.com/coding/v1?mode=test' }],
    ['fragment', { canonicalBaseUrl: 'https://api.kimi.com/coding/v1#test' }],
    ['userinfo', { canonicalBaseUrl: 'https://user@api.kimi.com/coding/v1' }],
    ['missing URL', { canonicalBaseUrl: undefined }],
    ['invalid URL', { canonicalBaseUrl: 'not a URL' }],
  ] as const)('uses the generic profile for %s', (_label, override) => {
    expect(resolveModelHarnessProfile({ ...identity, ...override } as AdapterBindingIdentity).id)
      .toBe('generic-openai');
  });

  it('resolves a profile without reading process.env', () => {
    const originalEnv = process.env;
    let profileId: string | undefined;

    try {
      process.env = new Proxy(
        { ...originalEnv },
        {
          get() {
            throw new Error('resolveModelHarnessProfile must not read process.env');
          },
        },
      );
      profileId = resolveModelHarnessProfile(identity).id;
    } finally {
      process.env = originalEnv;
    }

    expect(profileId).toBe('kimi-k3-coding-openai');
  });

  it.each([
    ['uppercase host', 'https://API.KIMI.COM/coding/v1'],
    ['trailing slash', 'https://api.kimi.com/coding/v1/'],
    ['explicit default port', 'https://api.kimi.com:443/coding/v1'],
  ])(
    'canonicalizes the parsed-equivalent %s before profile selection and fingerprinting',
    (_label, baseUrl) => {
      const flags = resolveKimiHarnessFeatureFlags({});
      const equivalent = buildOpenAIHarnessContext({
        identity: {
          ...identity,
          canonicalBaseUrl: baseUrl,
        },
        flags,
      });
      const canonical = buildOpenAIHarnessContext({
        identity,
        flags,
      });

      expect(equivalent.identity.canonicalBaseUrl)
        .toBe('https://api.kimi.com/coding/v1');
      expect(equivalent.profile.id).toBe('kimi-k3-coding-openai');
      expect(equivalent.identityFingerprint).toBe(canonical.identityFingerprint);
    },
  );
});

describe('model harness profile ownership', () => {
  it('does not duplicate binding identity or runtime fields on the selected profile', () => {
    const forbiddenKeys: readonly string[] = [
      'identity',
      'providerId',
      'providerType',
      'protocol',
      'endpoint',
      'baseUrl',
      'baseURL',
      'canonicalBaseUrl',
      'wireModel',
      'model',
      'capabilities',
      'runtimeOptions',
    ];
    const profileKeys = Object.keys(KIMI_K3_CODING_OPENAI_HARNESS_PROFILE);

    expect(profileKeys.filter((key) => forbiddenKeys.includes(key))).toEqual([]);
  });

  it('keeps OpenAIAdapterInit compile-time ownership on one required harness context', () => {
    const harnessContext = buildOpenAIHarnessContext({
      identity: {
        providerId: 'kimi',
        providerType: 'first_party',
        protocol: 'openai_legacy',
        canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
        wireModel: 'k3',
        capabilities: ['tools', 'thinking'],
      },
      flags: resolveKimiHarnessFeatureFlags({}),
    });
    const valid: OpenAIAdapterInit = {
      apiKey: 'sk-kimi',
      kimiCodingHeadersApplied: true,
      harnessContext,
    };

    // @ts-expect-error harnessContext is the required adapter identity contract.
    const missingHarness: OpenAIAdapterInit = {
      apiKey: 'sk-kimi',
      kimiCodingHeadersApplied: true,
    };
    const duplicateModel: OpenAIAdapterInit = {
      ...valid,
      // @ts-expect-error wire model belongs only to harnessContext.identity.
      model: 'k3',
    };
    const duplicateBaseUrl: OpenAIAdapterInit = {
      ...valid,
      // @ts-expect-error base URL belongs only to harnessContext.identity.
      baseURL: 'https://api.kimi.com/coding/v1',
    };
    const duplicateCapabilities: OpenAIAdapterInit = {
      ...valid,
      // @ts-expect-error capabilities belong only to harnessContext.identity.
      capabilities: ['tools', 'thinking'],
    };
    const duplicateRuntime: OpenAIAdapterInit = {
      ...valid,
      // @ts-expect-error runtime options belong only to harnessContext.
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
    };

    expect(valid.harnessContext).toBe(harnessContext);
    void missingHarness;
    void duplicateModel;
    void duplicateBaseUrl;
    void duplicateCapabilities;
    void duplicateRuntime;
  });
});

describe('resolveKimiHarnessFeatureFlags', () => {
  it('makes preserved reasoning mandatory while prompt cache remains opt-in', () => {
    const flags = resolveKimiHarnessFeatureFlags({});

    expect(flags).toEqual({
      normalizeToolSchema: true,
      normalizeUsage: true,
      omitEmptyAssistantContent: true,
      promptCacheKey: false,
      preservedThinking: true,
    });
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it('does not allow an environment override to disable mandatory replay', () => {
    expect(resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '1',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '0',
    })).toMatchObject({
      promptCacheKey: true,
      preservedThinking: true,
    });

    expect(resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: 'true',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: 'false',
    })).toMatchObject({
      promptCacheKey: false,
      preservedThinking: true,
    });
  });
});

describe('strict K3 reasoning serializer', () => {
  it('replays only official reasoning_content blocks and preserves explicit empty', () => {
    const serialize = KIMI_K3_CODING_OPENAI_HARNESS_PROFILE.serializeReasoning!;

    expect(serialize([
      {
        type: 'thinking',
        thinking: '',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning_content',
          fieldPresence: 'present',
        },
      },
      {
        type: 'thinking',
        thinking: ' ',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning_content',
          fieldPresence: 'present',
        },
      },
    ], 'reasoning', false)).toEqual({
      field: 'reasoning_content',
      value: ' ',
    });
  });

  it('does not synthesize reasoning_content for an assistant without an official block', () => {
    const serialize = KIMI_K3_CODING_OPENAI_HARNESS_PROFILE.serializeReasoning!;

    expect(serialize([
      { type: 'text', text: 'answer' },
    ], 'reasoning_content', true)).toBeUndefined();
  });

  it('rejects non-official thinking inside a strict assistant history', () => {
    const serialize = KIMI_K3_CODING_OPENAI_HARNESS_PROFILE.serializeReasoning!;

    expect(() => serialize([
      {
        type: 'thinking',
        thinking: 'alternate',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning',
          fieldPresence: 'present',
        },
      },
    ], 'reasoning_content', true)).toThrow('KIMI_REASONING_SOURCE_INVARIANT');
  });
});

describe('reasoning dialect observation', () => {
  function state(): ReasoningDialectState {
    return { current: 'reasoning_content', learned: false };
  }

  it('learns an own empty reasoning_content field before display filtering', () => {
    const dialect = state();

    expect(observeReasoningDialect(dialect, {
      reasoning_content: '',
      reasoning: 'visible fallback',
    })).toEqual({});
    expect(dialect).toEqual({
      current: 'reasoning_content',
      learned: true,
    });
  });

  it('falls back from null reasoning_content to an own string reasoning field', () => {
    const dialect = state();

    expect(observeReasoningDialect(dialect, {
      reasoning_content: null,
      reasoning: '',
    })).toEqual({});
    expect(dialect).toEqual({
      current: 'reasoning',
      learned: true,
    });
  });

  it('prefers reasoning_content when both own fields are strings', () => {
    const dialect = state();

    observeReasoningDialect(dialect, {
      reasoning_content: 'primary',
      reasoning: 'secondary',
    });

    expect(dialect).toEqual({
      current: 'reasoning_content',
      learned: true,
    });
  });

  it('keeps the first observation and reports only conflicting field names', () => {
    const dialect = state();
    observeReasoningDialect(dialect, { reasoning: 'first private text' });

    expect(observeReasoningDialect(dialect, {
      reasoning_content: 'second private text',
    })).toEqual({
      conflict: {
        previous: 'reasoning',
        candidate: 'reasoning_content',
      },
    });
    expect(dialect).toEqual({
      current: 'reasoning',
      learned: true,
    });
  });

  it('keeps a learned dialect when a later delta has no reasoning field', () => {
    const dialect: ReasoningDialectState = {
      current: 'reasoning',
      learned: true,
    };

    expect(observeReasoningDialect(dialect, { content: 'answer' })).toEqual({});
    expect(dialect).toEqual({
      current: 'reasoning',
      learned: true,
    });
  });

  it('ignores absent fields, inherited properties, generic formats, and non-string values', () => {
    const cases: Record<string, unknown>[] = [
      {},
      Object.create({ reasoning_content: 'inherited' }) as Record<string, unknown>,
      { reasoning_details: [{ type: 'reasoning.text', text: 'generic' }] },
      { thinking: 'generic' },
      { reasoning_content: 0, reasoning: 'must not fall through' },
      { reasoning_content: undefined, reasoning: 'must not fall through' },
    ];

    for (const delta of cases) {
      const dialect = state();
      expect(observeReasoningDialect(dialect, delta)).toEqual({});
      expect(dialect).toEqual({
        current: 'reasoning_content',
        learned: false,
      });
    }
  });

  it('does not read inherited reasoning accessors', () => {
    const inheritedReads = {
      reasoning_content: 0,
      reasoning: 0,
    };
    const prototype = Object.defineProperties({}, {
      reasoning_content: {
        get() {
          inheritedReads.reasoning_content += 1;
          return 'inherited';
        },
      },
      reasoning: {
        get() {
          inheritedReads.reasoning += 1;
          return 'inherited';
        },
      },
    });
    const dialect = state();

    observeReasoningDialect(
      dialect,
      Object.create(prototype) as Record<string, unknown>,
    );

    expect(inheritedReads).toEqual({
      reasoning_content: 0,
      reasoning: 0,
    });
    expect(dialect).toEqual({
      current: 'reasoning_content',
      learned: false,
    });
  });

  it('uses an own reasoning field when reasoning_content exists only on the prototype', () => {
    const dialect = state();
    const delta = Object.assign(
      Object.create({ reasoning_content: 'inherited' }) as Record<string, unknown>,
      { reasoning: '' },
    );

    observeReasoningDialect(dialect, delta);

    expect(dialect).toEqual({
      current: 'reasoning',
      learned: true,
    });
  });
});

describe('model harness identity fingerprint', () => {
  const identity: AdapterBindingIdentity = {
    providerId: 'kimi',
    providerType: 'first_party',
    protocol: 'openai_legacy',
    canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
    wireModel: 'k3',
    capabilities: ['thinking', 'tools'],
  };
  const flags = resolveKimiHarnessFeatureFlags({});

  it('contains exactly the immutable identity tuple with sorted capabilities and profile id', () => {
    const capabilities = ['tools', 'thinking'];
    const context = buildOpenAIHarnessContext({
      identity: { ...identity, capabilities },
      flags,
    });

    expect(context.identityFingerprint).toBe(
      JSON.stringify([
        'kimi',
        'first_party',
        'openai_legacy',
        'https://api.kimi.com/coding/v1',
        'k3',
        ['thinking', 'tools'],
        'kimi-k3-coding-openai',
      ]),
    );
    expect(capabilities).toEqual(['tools', 'thinking']);
  });

  it('changes for the same wire model when capabilities differ', () => {
    const baseline = buildOpenAIHarnessContext({ identity, flags });
    const changed = buildOpenAIHarnessContext({
      identity: {
        ...identity,
        capabilities: ['thinking', 'tools', 'vision'],
      },
      flags,
    });

    expect(changed.identityFingerprint).not.toBe(baseline.identityFingerprint);
  });

  it('does not collide when one capability contains the list delimiter', () => {
    const combined = buildOpenAIHarnessContext({
      identity: {
        ...identity,
        capabilities: ['thinking,tools'],
      },
      flags,
    });
    const separate = buildOpenAIHarnessContext({
      identity: {
        ...identity,
        capabilities: ['thinking', 'tools'],
      },
      flags,
    });

    expect(combined.identityFingerprint).not.toBe(separate.identityFingerprint);
  });
});
