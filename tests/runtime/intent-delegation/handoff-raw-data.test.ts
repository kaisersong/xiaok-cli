import { describe, expect, it } from 'vitest';
import {
  hasPendingFreshContextHandoff, resolveOwnedActiveIntent,
  type PendingHandoffLedgerData, type PendingHandoffIntentData,
} from '../../../src/runtime/intent-delegation/handoff.js';

function ledger(stages: unknown): PendingHandoffLedgerData<PendingHandoffIntentData> {
  return {
    activeIntentId: 'selected', ownership: { ownerInstanceId: 'owner' },
    intents: [
      { intentId: 'selected', activeStageId: 'stage', stages },
      { intentId: 'legacy-unselected', stages: 9 },
    ],
  };
}
describe('real pending handoff minimal DATA', () => {
  it.each([true, false])('returns only the actual selected boolean flag %s', flag => {
    const input = ledger([
      { stageId: 'other', needsFreshContextHandoff: 'unread' },
      { stageId: 'stage', needsFreshContextHandoff: flag, role: 'review', order: 'unused' },
    ]);
    const before = structuredClone(input);
    expect(hasPendingFreshContextHandoff(input, 'owner')).toBe(flag);
    expect(input).toEqual(before);
  });
  it('preserves owner selection before validating any stage payload', () => {
    const input = ledger(9);
    expect(hasPendingFreshContextHandoff(input, 'other')).toBe(false);
    expect(resolveOwnedActiveIntent(input, 'other')).toBeUndefined();
  });
  it('returns false for missing active stage without checking unmatched flags', () => {
    expect(hasPendingFreshContextHandoff(ledger([
      { stageId: 'other', needsFreshContextHandoff: { invalid: true } },
    ]), 'owner')).toBe(false);
  });
  it.each([undefined, null, {}, 'stages'])('rejects an invalid actually used stages array: %s', stages => {
    expect(() => hasPendingFreshContextHandoff(ledger(stages), 'owner')).toThrow('intent_handoff:stages');
  });
  it.each([undefined, null, 0, 1, 'true', {}])('rejects a nonboolean selected flag: %s', flag => {
    expect(() => hasPendingFreshContextHandoff(ledger([
      { stageId: 'stage', needsFreshContextHandoff: flag },
    ]), 'owner')).toThrow('intent_handoff:needsFreshContextHandoff');
  });
  it('returns the original selected DATA object without producing a Modern clone or grant', () => {
    const input = ledger([]);
    expect(resolveOwnedActiveIntent(input, 'owner')).toBe(input.intents[0]);
  });
});
