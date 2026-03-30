import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CAPABILITIES,
  resolveModelCapabilities,
} from '../../../src/ai/runtime/model-capabilities.js';

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
});
