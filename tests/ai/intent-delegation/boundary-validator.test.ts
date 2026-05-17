import { describe, expect, it } from 'vitest';
import { validateBoundaryDecision } from '../../../src/ai/intent-delegation/boundary-validator.js';
import type { IntentBoundaryInput } from '../../../src/ai/intent-delegation/boundary-types.js';

const input: IntentBoundaryInput = {
  input: '帮我生成报告',
  instanceId: 'inst',
  sessionId: 'sess',
  cwd: '/tmp/project',
  skills: [],
};

describe('intent boundary validator', () => {
  it('rejects vague deliverables from LLM decisions', () => {
    for (const deliverable of ['交付物', '结果', 'output', '产出物', '分析结果']) {
      const result = validateBoundaryDecision(input, {
        source: 'llm',
        decision: {
          kind: 'create_intent',
          confidence: 0.9,
          intentType: 'analyze',
          deliverables: [deliverable],
          constraints: [],
          reason: 'mock',
        },
      });

      expect(result).toMatchObject({ kind: 'non_intent' });
    }
  });

  it('rejects unsupported runtime intent types', () => {
    const result = validateBoundaryDecision(input, {
      source: 'llm',
      decision: {
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'deep_research' as never,
        deliverables: ['报告'],
        constraints: [],
        reason: 'mock',
      },
    });

    expect(result).toMatchObject({ kind: 'non_intent' });
  });

  it('allows concrete report deliverables', () => {
    const result = validateBoundaryDecision(input, {
      source: 'llm',
      decision: {
        kind: 'create_intent',
        confidence: 0.9,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'mock',
      },
    });

    expect(result).toMatchObject({
      kind: 'intent',
      plan: {
        deliverable: '报告',
        intentType: 'generate',
      },
    });
  });

  it('turns low-confidence answer_directly with intent hint into clarification', () => {
    const result = validateBoundaryDecision(input, {
      source: 'llm',
      ruleDecision: {
        kind: 'ambiguous',
        ambiguityType: 'implicit_workflow',
        reason: 'mock',
        plannerHint: { prefersIntent: true, deliverables: ['报告'], reason: 'mock' },
      },
      decision: {
        kind: 'answer_directly',
        confidence: 0.6,
        reason: 'mock',
      },
    });

    expect(result).toMatchObject({ kind: 'clarify' });
  });

  it('rejects low-confidence create_intent decisions without an intent hint', () => {
    const result = validateBoundaryDecision(input, {
      source: 'llm',
      decision: {
        kind: 'create_intent',
        confidence: 0.4,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'mock',
      },
    });

    expect(result).toMatchObject({
      kind: 'non_intent',
      reason: 'low_confidence_create_intent',
    });
  });

  it('clarifies low-confidence create_intent decisions when rules prefer intent', () => {
    const result = validateBoundaryDecision(input, {
      source: 'llm',
      ruleDecision: {
        kind: 'ambiguous',
        ambiguityType: 'implicit_workflow',
        reason: 'mock',
        plannerHint: { prefersIntent: true, deliverables: ['报告'], reason: 'mock' },
      },
      decision: {
        kind: 'create_intent',
        confidence: 0.4,
        intentType: 'generate',
        deliverables: ['报告'],
        constraints: [],
        reason: 'mock',
      },
    });

    expect(result).toMatchObject({
      kind: 'clarify',
      reason: 'low_confidence_create_intent_guard',
    });
  });

  it('validates rule definite_intent through the same concrete deliverable gate', () => {
    const result = validateBoundaryDecision(input, {
      source: 'rule',
      ruleDecision: {
        kind: 'definite_intent',
        reason: 'explicit_deliverable',
        plannerHint: {
          intentType: 'generate',
          deliverables: ['报告'],
          prefersIntent: true,
          reason: 'test',
        },
      },
      decision: { kind: 'rule_intent', reason: 'explicit_deliverable' },
    });

    expect(result).toMatchObject({ kind: 'intent' });
  });
});
