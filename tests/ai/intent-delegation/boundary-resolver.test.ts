import { describe, expect, it, vi } from 'vitest';
import { createIntentBoundaryResolver } from '../../../src/ai/intent-delegation/boundary-resolver.js';

const baseInput = {
  input: '帮我分析一下这个方向',
  instanceId: 'inst',
  sessionId: 'sess',
  cwd: '/tmp/project',
  skills: [],
};

const baseConfig = {
  llmClassifier: 'off' as const,
  ambiguousFallback: 'legacy_validator' as const,
  confidenceThreshold: 0.75,
  falseNegativeClarifyThreshold: 0.85,
  timeoutMs: 1500,
  maxInputTokens: 200,
  maxOutputTokens: 100,
};

describe('intent boundary resolver', () => {
  it('uses legacy validator when LLM is off', async () => {
    const resolver = createIntentBoundaryResolver({ config: baseConfig });
    const result = await resolver.resolve(baseInput);

    expect(['non_intent', 'intent', 'clarify']).toContain(result.kind);
    expect(result.source).not.toBe('llm');
  });

  it('records shadow divergence without changing the real decision', async () => {
    const events: unknown[] = [];
    const resolver = createIntentBoundaryResolver({
      config: { ...baseConfig, llmClassifier: 'shadow' },
      llmClassify: vi.fn(async () => ({
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'shadow',
      })),
      emitDebug: (event) => events.push(event),
    });

    const result = await resolver.resolve(baseInput);

    expect(result.source).not.toBe('llm');
    expect(events.some((event) => JSON.stringify(event).includes('shadowDecision'))).toBe(true);
  });

  it('uses active LLM decision in ambiguous_only mode', async () => {
    const resolver = createIntentBoundaryResolver({
      config: { ...baseConfig, llmClassifier: 'ambiguous_only' },
      llmClassify: vi.fn(async () => ({
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'active',
      })),
    });

    const result = await resolver.resolve(baseInput);

    expect(result).toMatchObject({ kind: 'intent', source: 'llm' });
  });

  it('passes the concrete rule ambiguity to the LLM classifier', async () => {
    const llmClassify = vi.fn(async () => ({
      kind: 'answer_directly' as const,
      confidence: 0.95,
      reason: 'mock',
    }));
    const resolver = createIntentBoundaryResolver({
      config: { ...baseConfig, llmClassifier: 'ambiguous_only' },
      llmClassify,
    });

    await resolver.resolve(baseInput);

    expect(llmClassify).toHaveBeenCalledWith(
      expect.objectContaining({ input: baseInput.input }),
      expect.objectContaining({
        kind: 'ambiguous',
        ambiguityType: 'verb_no_output',
      }),
    );
  });

  it('applies the configured LLM confidence threshold before creating intent', async () => {
    const resolver = createIntentBoundaryResolver({
      config: { ...baseConfig, llmClassifier: 'ambiguous_only', confidenceThreshold: 0.95 },
      llmClassify: vi.fn(async () => ({
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'active',
      })),
    });

    const result = await resolver.resolve(baseInput);

    expect(result).toMatchObject({
      kind: 'non_intent',
      reason: 'low_confidence_create_intent',
      source: 'llm',
    });
  });

  it('limits repeated clarification prompts', async () => {
    const resolver = createIntentBoundaryResolver({
      config: { ...baseConfig, llmClassifier: 'ambiguous_only' },
      llmClassify: vi.fn(async () => ({
        kind: 'ask_clarification',
        confidence: 0.9,
        question: '要生成什么？',
        reason: 'mock',
      })),
    });

    await expect(resolver.resolve(baseInput)).resolves.toMatchObject({ kind: 'clarify' });
    await expect(resolver.resolve(baseInput)).resolves.toMatchObject({ kind: 'clarify' });
    await expect(resolver.resolve(baseInput)).resolves.toMatchObject({
      kind: 'non_intent',
      reason: 'clarification_limit_reached',
    });
  });
});
