import { describe, expect, it } from 'vitest';
import { validateSemanticPolicy, computeSemanticRequestCostUpperBound } from '../../../src/runtime/sol-pi/semantic-policy.js';
const now = 100000;
const policy = () => ({ version: 1, mode: 'mechanism-experiment', currency: 'USD', maxCalls: 2,
  maxCostUnits: 50000000, maxOutputTokens: 2048, expiresAt: now + 60000,
  pricing: { source: 'https://api-docs.deepseek.com/quick_start/pricing', model: 'deepseek-flash',
    inputMissUnitsPerMillion: 300000000, inputHitUnitsPerMillion: 6000000,
    outputUnitsPerMillion: 1200000000, validUntil: now + 60000 } });
describe('explicit semantic policy and bounded costs', () => {
  it('freezes an explicit mode, computes exact conservative rounded money, and binds the price bytes', () => {
    const input = policy(); const result = validateSemanticPolicy(input, now, now + 120000);
    expect(result.mode).toBe('mechanism-experiment');
    expect(result.priceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(computeSemanticRequestCostUpperBound(result, 1, 1)).toBe(1500);
    input.pricing.outputUnitsPerMillion = 0;
    expect(result.pricing.outputUnitsPerMillion).toBe(1200000000);
  });
  it.each([
    { mode: 'enabled' }, { maxCalls: 0 }, { maxCalls: 257 }, { maxOutputTokens: 0 },
    { maxOutputTokens: 8193 }, { expiresAt: now }, { expiresAt: now + 130000 }, { maxCostUnits: Infinity },
    { currency: 'CNY' }, { trusted: true },
  ])('rejects unsafe policy fields %j', patch => {
    expect(() => validateSemanticPolicy({ ...policy(), ...patch }, now, now + 120000)).toThrow();
  });
  it('does not manufacture missing/expired pricing or accept higher cache hit rates', () => {
    for (const patch of [{ validUntil: now }, { inputHitUnitsPerMillion: 400000000 }, { outputUnitsPerMillion: null }, { model: 'other' }]) {
      expect(() => validateSemanticPolicy({ ...policy(), pricing: { ...policy().pricing, ...patch } }, now, now + 120000)).toThrow();
    }
  });
  it('rejects invalid counts and rounds fractional units upward', () => {
    const p = validateSemanticPolicy({ ...policy(), pricing: { ...policy().pricing, inputMissUnitsPerMillion: 300000001 } }, now, now + 120000);
    expect(computeSemanticRequestCostUpperBound(p, 1, 1)).toBe(1501);
    for (const count of [-1, NaN, Infinity, 1.5]) expect(() => computeSemanticRequestCostUpperBound(p, count, 1)).toThrow();
    expect(() => computeSemanticRequestCostUpperBound(p, 1, 2049)).toThrow();
  });
});

it('rejects user prices below reviewed provider peak costs',()=>{for(const key of ['inputMissUnitsPerMillion','outputUnitsPerMillion'])expect(()=>validateSemanticPolicy({...policy(),pricing:{...policy().pricing,[key]:1}},now,now+120000)).toThrow();});
