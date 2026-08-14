import { describe, expect, it, vi } from 'vitest';
import {
  completeAssistantJson,
  validateEveningReflection,
  validateMorningBriefing,
} from '../../electron/assistant-llm.js';

describe('assistant no-tool structured LLM', () => {
  it('uses the narrow completion port and validates the production schema', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        summary: '完成两项关键工作。',
        candidates: [{
          kind: 'memory',
          title: '偏好简洁汇报',
          content: '用户偏好先给结论。',
          scope: 'global',
          confidence: 0.92,
          evidenceRefs: [{ kind: 'task', id: 'task-1' }],
          dedupeKey: 'memory:concise-reporting',
        }],
      }),
    });

    const result = await completeAssistantJson({
      port: { complete },
      systemPrompt: 'Return JSON.',
      snapshot: { items: [], dropped: {}, from: 0, to: 1, timeZone: 'UTC' },
      validate: validateEveningReflection,
      maxTokens: 500,
    });

    expect(result.candidates).toHaveLength(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'fast', temperature: 0 }));
  });

  it.each([
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'global', confidence: 1, evidenceRefs: [], dedupeKey: 'k' }] }, 'evidence'],
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'private', confidence: 1, evidenceRefs: [{ kind: 'task', id: '1' }], dedupeKey: 'k' }] }, 'scope'],
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'global', confidence: 2, evidenceRefs: [{ kind: 'task', id: '1' }], dedupeKey: 'k' }] }, 'confidence'],
  ])('rejects invalid evening candidate output: %s', (value, message) => {
    expect(() => validateEveningReflection(value)).toThrow(message);
  });

  it('caps morning recommendations at three without fabricating filler', () => {
    expect(validateMorningBriefing({ recommendations: [] }).recommendations).toEqual([]);
    expect(() => validateMorningBriefing({
      recommendations: Array.from({ length: 4 }, (_, index) => ({
        title: `item-${index}`,
        reasonCode: 'due_task',
        evidenceRefs: [{ kind: 'task', id: `task-${index}` }],
      })),
    })).toThrow('three');
  });

  it('fails closed on malformed JSON', async () => {
    await expect(completeAssistantJson({
      port: { complete: vi.fn().mockResolvedValue({ text: 'not-json' }) },
      systemPrompt: 'Return JSON.',
      snapshot: {},
      validate: validateEveningReflection,
      maxTokens: 500,
    })).rejects.toThrow('assistant_json_invalid');
  });
});
