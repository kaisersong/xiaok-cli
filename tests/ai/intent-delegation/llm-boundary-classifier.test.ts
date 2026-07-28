import { describe, expect, it } from 'vitest';
import {
  classifyBoundaryWithLlm,
  createAdapterBoundaryInvoker,
} from '../../../src/ai/intent-delegation/llm-boundary-classifier.js';
import type { ModelAdapter } from '../../../src/types.js';

const input = {
  input: '帮我分析一下这个方向',
  sessionId: 'sess',
  instanceId: 'inst',
  cwd: '/tmp/project',
  providedSourcePaths: [],
  ruleDecision: {
    kind: 'ambiguous' as const,
    ambiguityType: 'verb_no_output' as const,
    reason: 'mock',
  },
};

describe('llm boundary classifier', () => {
  it('keeps the real classifier side request affinity-free and drains usage before a pending error', async () => {
    const sentinel = new Error('classifier pending error');
    let argumentCount = 0;
    let capturedOptions: unknown = 'not-called';
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: function (_messages, _tools, _systemPrompt, options) {
        argumentCount = arguments.length;
        capturedOptions = options;
        return (async function* () {
          yield {
            type: 'usage' as const,
            usage: { inputTokens: 7, outputTokens: 1 },
          };
          throw sentinel;
        })();
      },
    };
    const invoker = createAdapterBoundaryInvoker(adapter, {
      llmClassifier: 'ambiguous_only',
      ambiguousFallback: 'answer_directly',
      confidenceThreshold: 0.8,
      falseNegativeClarifyThreshold: 0.5,
      timeoutMs: 100,
      maxInputTokens: 1_000,
      maxOutputTokens: 200,
    });

    await expect(invoker.invoke('classify this')).rejects.toBe(sentinel);
    expect(argumentCount).toBe(3);
    expect(capturedOptions).toBeUndefined();
  });

  it('parses valid JSON decisions', async () => {
    const result = await classifyBoundaryWithLlm(input, {
      timeoutMs: 100,
      invoke: async () => JSON.stringify({
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'user requested deliverable',
      }),
    });

    expect(result).toMatchObject({ kind: 'create_intent', deliverables: ['报告'] });
  });

  it('degrades malformed JSON to answer_directly', async () => {
    const result = await classifyBoundaryWithLlm(input, {
      timeoutMs: 100,
      invoke: async () => 'not json',
    });

    expect(result).toMatchObject({ kind: 'answer_directly', reason: 'invalid_json' });
  });

  it('rejects unsupported extra stages field', async () => {
    const result = await classifyBoundaryWithLlm(input, {
      timeoutMs: 100,
      invoke: async () => JSON.stringify({
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        stages: ['收集', '撰写'],
        reason: 'mock',
      }),
    });

    expect(result).toMatchObject({ kind: 'answer_directly', reason: 'schema_invalid' });
  });

  it('degrades timeout to answer_directly', async () => {
    const result = await classifyBoundaryWithLlm(input, {
      timeoutMs: 1,
      invoke: () => new Promise((resolve) => setTimeout(() => resolve('{}'), 20)),
    });

    expect(result).toMatchObject({ kind: 'answer_directly', reason: 'timeout_or_invoke_error' });
  });
});
