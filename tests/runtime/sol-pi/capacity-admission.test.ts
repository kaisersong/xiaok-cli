import { describe, expect, it, vi } from 'vitest';
import { createTestOnlyCapacityProfile, resolveProductionCapacityProfile, assertCapacityProfileReady,
  checkRequestCapacity, getCapacityProfileBudget, measureRequestCapacity } from '../../../src/runtime/sol-pi/capacity-admission.js';

const destination = 'https://test.example/v1/chat/completions';
const body = JSON.stringify({ model: 'fixture', max_tokens: 20, messages: [{ role: 'user', content: 'x' }], tools: [] });
function profile(overrides = {}) {
  return createTestOnlyCapacityProfile({ destination, model: 'fixture', windowTokens: 1000,
    outputLimitField: 'max_tokens', safetyMarginTokens: 10,
    countSerializedInput: (serializedBody: string) => Buffer.byteLength(serializedBody), ...overrides });
}
describe('whole serialized request capacity admission', () => {
  it('lets planner measure over-window body while actual dispatch still rejects', () => {
    const cap = profile({ windowTokens: 25 });
    expect(getCapacityProfileBudget(cap)).toEqual({ windowTokens: 25, outputLimitField: 'max_tokens', defaultOutputTokens: undefined, safetyMarginTokens: 10 });
    const measured = measureRequestCapacity(cap, { destination, model: 'fixture', serializedBody: body });
    expect(measured.actualOutputReserve).toBe(20);
    expect(measured.totalTokenUpperBound).toBeGreaterThan(25);
    expect(() => checkRequestCapacity(cap, { destination, model: 'fixture', serializedBody: body })).toThrow(/CONTEXT_BUDGET_EXCEEDED/);
    expect(() => getCapacityProfileBudget({} as never)).toThrow();
  });
  it('has no pretend production profile and refuses unknown/forged capability', () => {
    expect(resolveProductionCapacityProfile({ destination, model: 'deepseek-v4.1-flash-expires-on-0910' })).toBeUndefined();
    for (const unknown of [undefined, {}, { validationEvidenceId: 'looks-verified' }]) {
      expect(() => assertCapacityProfileReady(unknown as never, destination, 'fixture')).toThrow(/CAPACITY/);
    }
  });
  it('checks entire actual body including system/history/schema and actual output limit', () => {
    const count = vi.fn((serialized: string) => Buffer.byteLength(serialized));
    const cap = profile({ countSerializedInput: count });
    expect(checkRequestCapacity(cap, { destination, model: 'fixture', serializedBody: body }).totalTokenUpperBound).toBe(Buffer.byteLength(body) + 30);
    const huge = JSON.stringify({ ...JSON.parse(body), system: 's'.repeat(600), tools: [{ schema: 't'.repeat(600) }] });
    expect(() => checkRequestCapacity(cap, { destination, model: 'fixture', serializedBody: huge })).toThrow(/CONTEXT_BUDGET_EXCEEDED/);
    expect(count).toHaveBeenLastCalledWith(huge);
  });
  it('rejects missing output bound, mismatched model/destination and unknown body shapes', () => {
    const cap = profile();
    for (const serializedBody of ['{}', JSON.stringify({ model: 'fixture' }), JSON.stringify({ model: 'other', max_tokens: 20 }), body.replace('20', '-1'), JSON.stringify({ ...JSON.parse(body), max_completion_tokens: 5000 })]) {
      expect(() => checkRequestCapacity(cap, { destination, model: 'fixture', serializedBody })).toThrow();
    }
    expect(() => checkRequestCapacity(cap, { destination: 'https://other.example', model: 'fixture', serializedBody: body })).toThrow();
  });
  it('fails closed on unknown, async, throwing or invalid token bound', () => {
    for (const countSerializedInput of [() => NaN, () => -1, () => Infinity, () => Promise.resolve(1), () => { throw new Error('unknown'); }]) {
      const cap = profile({ countSerializedInput });
      expect(() => checkRequestCapacity(cap, { destination, model: 'fixture', serializedBody: body })).toThrow(/CAPACITY/);
    }
  });
});
