import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CAPABILITIES,
  buildPromptCacheSegments,
  resolveModelCapabilities,
} from '../../../src/ai/runtime/model-capabilities.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';

describe('model capabilities', () => {
  it('uses extended context and prompt caching for Claude Opus models', () => {
    const capabilities = resolveModelCapabilities('claude-opus-4-6');

    expect(capabilities.contextLimit).toBe(1_000_000);
    expect(capabilities.compactThreshold).toBe(0.85);
    expect(capabilities.supportsPromptCaching).toBe(true);
  });

  it('uses Claude mid-tier defaults for Sonnet and Haiku families', () => {
    expect(resolveModelCapabilities('claude-sonnet-4-5').contextLimit).toBe(200_000);
    expect(resolveModelCapabilities('claude-3-5-haiku-latest').contextLimit).toBe(200_000);
  });

  it('supports image input only for DeepSeek V4 Flash Vision Exp', () => {
    expect(resolveModelCapabilities('deepseek-v4-pro').supportsImageInput).toBe(false);
    expect(resolveModelCapabilities('deepseek-v4-flash').supportsImageInput).toBe(false);
    expect(resolveModelCapabilities('deepseek-v4-flash-vision-exp').supportsImageInput).toBe(true);
  });

  it('falls back to conservative defaults for unknown models', () => {
    const capabilities = resolveModelCapabilities('custom-model');

    expect(capabilities).toEqual(DEFAULT_MODEL_CAPABILITIES);
  });

  it('allows adapter-provided overrides to win over inferred defaults', () => {
    const capabilities = resolveModelCapabilities({
      getModelName: () => 'claude-opus-4-6',
      getCapabilities: () => ({
        contextLimit: 4096,
        compactThreshold: 0.5,
        supportsPromptCaching: false,
      }),
      stream: async function* () {
        yield { type: 'done' } as const;
      },
    });

    expect(capabilities.contextLimit).toBe(4096);
    expect(capabilities.compactThreshold).toBe(0.5);
    expect(capabilities.supportsPromptCaching).toBe(false);
  });

  it('exposes effective K3 context through adapter capabilities while preserving capability flags', () => {
    const adapter = createAdapterFromBinding({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k3',
      wireModel: 'k3',
      protocol: 'openai_legacy',
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking', 'image_in'],
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
    });

    expect(resolveModelCapabilities(adapter)).toMatchObject({
      contextLimit: 1_048_576,
      supportsImageInput: true,
    });
  });
});

describe('buildPromptCacheSegments', () => {
  it('emits a single text block without cache_control when given a raw string', () => {
    const result = buildPromptCacheSegments('hello world', [], []);
    expect(result.systemPrompt).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(result.systemPrompt[0]).not.toHaveProperty('cache_control');
  });

  it('marks cacheable single segment with cache_control', () => {
    const result = buildPromptCacheSegments(
      [{ text: 'cacheable system', cacheable: true }],
      [],
      [],
    );
    expect(result.systemPrompt).toEqual([
      { type: 'text', text: 'cacheable system', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('omits cache_control on a non-cacheable single segment', () => {
    const result = buildPromptCacheSegments(
      [{ text: 'dynamic system', cacheable: false }],
      [],
      [],
    );
    expect(result.systemPrompt).toEqual([{ type: 'text', text: 'dynamic system' }]);
  });

  it('preserves per-segment cacheable flags across multi-block prompt', () => {
    const result = buildPromptCacheSegments(
      [
        { text: 'static', cacheable: true },
        { text: 'dynamic', cacheable: false },
      ],
      [],
      [],
    );
    expect(result.systemPrompt).toEqual([
      { type: 'text', text: 'static', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'dynamic' },
    ]);
  });

  it('filters out empty segment text', () => {
    const result = buildPromptCacheSegments(
      [
        { text: '', cacheable: true },
        { text: 'real', cacheable: true },
      ],
      [],
      [],
    );
    expect(result.systemPrompt).toEqual([
      { type: 'text', text: 'real', cache_control: { type: 'ephemeral' } },
    ]);
  });
});
