import { describe, expect, it, vi } from 'vitest';
import { normalizeDecisionChoice, requestDecisionChoice, substituteBoundaryDecision } from '../../src/runtime/evals/jev-decision-experiment.js';
import { createIntentBoundaryResolver } from '../../src/ai/intent-delegation/boundary-resolver.js';
import { DEFAULT_INTENT_BOUNDARY_CONFIG } from '../../src/types.js';

const criteria = { answer_directly: 'Consultation', create_intent: 'Deliverable', ask_clarification: 'Missing goal' };
const payload = (choice = 'answer_directly', probabilities: Record<string, number> = { answer_directly: .95, create_intent: .03, ask_clarification: .02 }) => ({
  model: 'jev-test', usage: { input_tokens: 10, output_tokens: 2 }, answers: { decision: { type: 'choice', choice, confidence: .9, probabilities } },
});
const ok = () => normalizeDecisionChoice(payload(), criteria);
const fallback = () => ({ kind: 'answer_directly' as const, confidence: .95, reason: 'original-llm' });

describe('opt-in SystemOne decision experiment', () => {
  it('retains typed decision, real model and usage', () => expect(ok()).toMatchObject({ status: 'ok', choice: 'answer_directly', model: 'jev-test', usage: { input_tokens: 10, output_tokens: 2 } }));
  it('rejects unknown selected option', () => expect(normalizeDecisionChoice(payload('foreign'), criteria).status).toBe('unavailable'));
  it('rejects a choice that is not the distribution winner', () => expect(normalizeDecisionChoice(payload('create_intent'), criteria).status).toBe('unavailable'));
  it('rejects missing, extra and nonfinite probabilities', () => {
    for (const probabilities of [{ answer_directly: .95 }, { answer_directly: .95, create_intent: .03, ask_clarification: .02, other: 0 }, { answer_directly: NaN, create_intent: .03, ask_clarification: .02 }])
      expect(normalizeDecisionChoice(payload('answer_directly', probabilities), criteria).status).toBe('unavailable');
  });
  it('rejects invalid total probability and extra answers', () => {
    expect(normalizeDecisionChoice(payload('answer_directly', { answer_directly: .8, create_intent: .03, ask_clarification: .02 }), criteria).status).toBe('unavailable');
    const p = payload(); Object.assign(p.answers, { foreign: p.answers.decision });
    expect(normalizeDecisionChoice(p, criteria).status).toBe('unavailable');
  });
  it('does not fetch without key or with oversized state', async () => {
    const fetchImpl = vi.fn();
    for (const [apiKey, state] of [['', 'ok'], ['key', 'a'.repeat(9000)]]) {
      const r = await requestDecisionChoice({ apiKey, state, criteria, instructions: 'Choose', fetchImpl });
      expect(r.status).toBe('unavailable');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('calls the transport and parses its actual response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload())));
    expect(await requestDecisionChoice({ apiKey: 'test', state: { input: 'Only discuss' }, criteria, instructions: 'Choose', fetchImpl })).toMatchObject({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes and discards vendor error text', async () => {
    expect((await requestDecisionChoice({ apiKey: 'test', state: '', criteria, instructions: 'Choose', fetchImpl: async () => new Response('a'.repeat(66000)) })).reason).toBe('response-limit');
    expect(await requestDecisionChoice({ apiKey: 'test', state: '', criteria, instructions: 'Choose', fetchImpl: async () => new Response('sensitive-provider-text', { status: 429 }) })).toEqual({ status: 'unavailable', reason: 'http-429', usage: null });
  });
  it('binds accepted answer without an LLM fallback through the real resolver', async () => {
    const original = vi.fn(async () => fallback());
    const resolver = createIntentBoundaryResolver({ config: { ...DEFAULT_INTENT_BOUNDARY_CONFIG, llmClassifier: 'ambiguous_only' },
      llmClassify: async () => substituteBoundaryDecision({ request: async () => ok(), fallback: original }) });
    expect(await resolver.resolve({ input: '分析一下', sessionId: 's', instanceId: 'i', cwd: '.', skills: [] })).toMatchObject({ kind: 'non_intent', reason: 'jev-accepted' });
    expect(original).not.toHaveBeenCalled();
  });
  it('does not invoke either model for a definite rule result', async () => {
    const llmClassify = vi.fn();
    const resolver = createIntentBoundaryResolver({ config: { ...DEFAULT_INTENT_BOUNDARY_CONFIG, llmClassifier: 'ambiguous_only' }, llmClassify });
    await resolver.resolve({ input: '你好', sessionId: 's', instanceId: 'i', cwd: '.', skills: [] });
    expect(llmClassify).not.toHaveBeenCalled();
  });
  it('falls back exactly once when generation fields are required', async () => {
    const original = vi.fn(async () => fallback());
    await substituteBoundaryDecision({ request: async () => normalizeDecisionChoice(payload('create_intent', { answer_directly: .01, create_intent: .98, ask_clarification: .01 }), criteria), fallback: original });
    expect(original).toHaveBeenCalledTimes(1);
  });
  it('falls back exactly once on uncertain or unavailable answer', async () => {
    for (const request of [async () => ({ ...ok(), confidence: .1 }), async () => ({ status: 'unavailable' as const, reason: 'timeout', usage: null })]) {
      const original = vi.fn(async () => fallback());
      expect(await substituteBoundaryDecision({ request, fallback: original })).toMatchObject({ reason: 'original-llm' });
      expect(original).toHaveBeenCalledTimes(1);
    }
  });
  it('uses a fixed existing clarification template, not generated text', async () => {
    const original = vi.fn(async () => fallback());
    expect(await substituteBoundaryDecision({ request: async () => normalizeDecisionChoice(payload('ask_clarification', { answer_directly: .01, create_intent: .01, ask_clarification: .98 }), criteria), fallback: original })).toMatchObject({ kind: 'ask_clarification', question: '你希望我直接分析回答，还是生成一个具体交付物？' });
    expect(original).not.toHaveBeenCalled();
  });
  it('propagates cancellation before consumption, never starts fallback', async () => {
    const controller = new AbortController(); const original = vi.fn(async () => fallback());
    await expect(substituteBoundaryDecision({ signal: controller.signal, request: async () => { controller.abort(); return ok(); }, fallback: original })).rejects.toThrow();
    expect(original).not.toHaveBeenCalled();
  });
});
