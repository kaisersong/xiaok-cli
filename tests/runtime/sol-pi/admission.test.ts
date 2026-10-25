import { describe, expect, it } from 'vitest';
import { evaluateSolPiAdmission } from '../../../src/runtime/sol-pi/admission.js';

const passed = { capability: 'passed', efficiency: 'passed', cost: 'passed', experience: 'passed', mechanism: 'passed' } as const;
describe('SoL-Pi candidate admission diagnostics', () => {
  it('cannot enable unavailable trusted receipt even with claimed passing gates', () => {
    expect(evaluateSolPiAdmission({ candidate: 'P3-R', gates: passed })).toEqual({
      candidate: 'P3-R', status: 'no-go', reasons: ['trusted_receipt_unavailable'], enableByDefault: false,
    });
  });
  it('does not turn passing P3-C gates into default enablement or trusted proof', () => {
    expect(evaluateSolPiAdmission({ candidate: 'P3-C', gates: passed })).toEqual({
      candidate: 'P3-C', status: 'eligible-for-experiment', reasons: [], enableByDefault: false,
    });
  });
  for (const gate of Object.keys(passed)) {
    it(`keeps ${gate} missing or inconclusive as inconclusive`, () => {
      const missing: Record<string, string> = { ...passed }; delete missing[gate];
      for (const gates of [missing, { ...passed, [gate]: 'inconclusive' }]) {
        expect(evaluateSolPiAdmission({ candidate: 'P3-C', gates } as never)).toMatchObject({ status: 'inconclusive', enableByDefault: false });
      }
    });
    it(`rejects failed ${gate}`, () => {
      expect(evaluateSolPiAdmission({ candidate: 'P3-C', gates: { ...passed, [gate]: 'failed' } } as never))
        .toMatchObject({ status: 'no-go', enableByDefault: false });
    });
  }
  it('rejects an unknown candidate', () => {
    expect(evaluateSolPiAdmission({ candidate: 'P4', gates: passed } as never))
      .toMatchObject({ status: 'no-go', reasons: ['unsupported_candidate'], enableByDefault: false });
  });
  it('does not treat arbitrary gate labels as passed', () => {
    expect(evaluateSolPiAdmission({ candidate: 'P3-C', gates: { ...passed, cost: 'unknown' } } as never))
      .toMatchObject({ status: 'inconclusive', enableByDefault: false });
  });
});
