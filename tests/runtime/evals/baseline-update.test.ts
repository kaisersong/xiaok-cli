import { describe, expect, it } from 'vitest';
import { computeBaselineHash, validateBaselineUpdate } from '../../../src/runtime/evals/baseline.js';

describe('AHE-lite baseline updates', () => {
  it('computes stable baseline hashes', () => {
    expect(computeBaselineHash({ b: 2, a: 1 })).toBe(computeBaselineHash({ a: 1, b: 2 }));
    expect(computeBaselineHash({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects new critical or high failures without human override', () => {
    const result = validateBaselineUpdate({
      oldBaseline: { failures: [] },
      newBaseline: { failures: [{ category: 'empty_artifact', severity: 'critical' }] },
    });

    expect(result).toEqual({
      ok: false,
      errors: ['failureCategoryDelta:critical:empty_artifact'],
    });
  });

  it('allows high-risk baseline updates with a non-empty human override', () => {
    const result = validateBaselineUpdate({
      oldBaseline: { failures: [] },
      newBaseline: { failures: [{ category: 'empty_artifact', severity: 'critical' }] },
      manifestOverride: { actor: 'song', reason: 'known fixture change' },
    });

    expect(result).toEqual({ ok: true });
  });
});
