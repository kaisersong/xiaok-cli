import { describe, expect, it } from 'vitest';
import { classifyIntentBoundaryByRules } from '../../../src/ai/intent-delegation/boundary-classifier.js';

const baseInput = {
  instanceId: 'inst',
  sessionId: 'sess',
  cwd: '/tmp/project',
  skills: [],
};

describe('rule intent boundary classifier', () => {
  it('keeps slash commands out of intent mode', () => {
    expect(classifyIntentBoundaryByRules({ ...baseInput, input: '/plan' })).toMatchObject({
      kind: 'definite_non_intent',
    });
  });

  it('keeps ordinary analysis research prompts out of intent mode', () => {
    expect(classifyIntentBoundaryByRules({
      ...baseInput,
      input: '分析ChatGPT最近一月的产品更新动态',
    })).toMatchObject({
      kind: 'definite_non_intent',
    });
  });

  it('treats explicit report requests as definite intent', () => {
    expect(classifyIntentBoundaryByRules({
      ...baseInput,
      input: '把这篇文档生成报告 /Users/song/Downloads/demo.pdf',
    })).toMatchObject({
      kind: 'definite_intent',
      plannerHint: {
        deliverables: expect.arrayContaining(['报告']),
        prefersIntent: true,
      },
    });
  });

  it('marks action verbs without a concrete output as ambiguous', () => {
    expect(classifyIntentBoundaryByRules({
      ...baseInput,
      input: '帮我分析一下这个方向',
    })).toMatchObject({
      kind: 'ambiguous',
      ambiguityType: 'verb_no_output',
    });
  });

  it('marks material context without a concrete directive as ambiguous', () => {
    expect(classifyIntentBoundaryByRules({
      ...baseInput,
      input: '基于这些内容看看有什么机会',
    })).toMatchObject({
      kind: 'ambiguous',
      ambiguityType: 'material_no_directive',
    });
  });

  it('treats active continuation as definite intent', () => {
    expect(classifyIntentBoundaryByRules({
      ...baseInput,
      input: '继续',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
    })).toMatchObject({
      kind: 'definite_intent',
    });
  });
});
