import { describe, expect, it } from 'vitest';
import { decideCompactionCandidate } from '../../../src/runtime/sol-pi/compaction-policy.js';

const eligible = {
  trigger: 'subtask_boundary', runtimeConfirmedCompletion: true,
  pendingApproval: false, unpairedToolCalls: 0, pendingMailboxClaim: false,
  sourceRevision: 4, currentRevision: 4, replaceableMessages: 8, remainingBudget: 1,
  remainingRequestsLowerBound: 3, currency: 'USD', savingsPerRequestLowerBound: 0.02,
  summaryCostUpperBound: 0.01, cacheRebuildCostUpperBound: 0.01,
  recallCostUpperBound: 0.01, uncertaintyMarginUpperBound: 0.01,
  providerContractVerified: true, anchorsComplete: true,
} as const;
const decide = (changes: Record<string, unknown> = {}) => decideCompactionCandidate({ ...eligible, ...changes } as never);
describe('SoL-Pi semantic compaction candidate pure policy', () => {
  it('leaves existing threshold owner responsible, including when semantic data is unavailable', () => {
    expect(decideCompactionCandidate({ trigger: 'threshold' } as never)).toMatchObject({ action: 'delegate-existing-threshold' });
  });
  it('can only produce a candidate when conservative savings exceed all costs', () => {
    expect(decide()).toMatchObject({ action: 'compact-candidate' });
  });
  const unsafe = [
    { runtimeConfirmedCompletion: false }, { pendingApproval: true }, { unpairedToolCalls: 1 },
    { pendingMailboxClaim: true }, { currentRevision: 5 }, { replaceableMessages: 0 },
    { remainingBudget: 0 }, { providerContractVerified: false }, { anchorsComplete: false },
    { remainingRequestsLowerBound: 0 }, { currency: '' },
  ];
  for (const changes of unsafe) it(`skips unsafe boundary ${JSON.stringify(changes)}`, () => {
    expect(decide(changes)).toMatchObject({ action: 'skip' });
  });
  for (const field of ['remainingRequestsLowerBound', 'savingsPerRequestLowerBound', 'summaryCostUpperBound',
    'cacheRebuildCostUpperBound', 'recallCostUpperBound', 'uncertaintyMarginUpperBound']) {
    for (const value of [null, undefined, NaN, Infinity, -1]) it(`skips unknown/invalid ${field}=${String(value)}`, () => {
      expect(decide({ [field]: value })).toMatchObject({ action: 'skip' });
    });
  }
  for (const field of ['sourceRevision', 'currentRevision', 'replaceableMessages', 'remainingBudget', 'remainingRequestsLowerBound', 'unpairedToolCalls']) {
    it(`rejects noninteger ${field}`, () => expect(decide({ [field]: 0.5 })).toMatchObject({ action: 'skip' }));
  }
  it('rejects break-even and loss, preserving strict economic inequality', () => {
    expect(decide({ remainingRequestsLowerBound: 2 })).toMatchObject({ action: 'skip' });
    expect(decide({ remainingRequestsLowerBound: 1 })).toMatchObject({ action: 'skip' });
  });
  it('does not allow overflow to imply positive benefit', () => {
    expect(decide({ savingsPerRequestLowerBound: Number.MAX_VALUE })).toMatchObject({ action: 'skip' });
    expect(decide({ cacheRebuildCostUpperBound: Number.MAX_VALUE, summaryCostUpperBound: Number.MAX_VALUE })).toMatchObject({ action: 'skip' });
  });
  it('rejects unknown trigger', () => expect(decide({ trigger: 'unknown' })).toMatchObject({ action: 'skip' }));
  for (const field of ['runtimeConfirmedCompletion', 'providerContractVerified', 'anchorsComplete', 'pendingApproval', 'pendingMailboxClaim']) {
    it(`rejects truthy string for ${field}`, () => expect(decide({ [field]: 'false' })).toMatchObject({ action: 'skip' }));
  }
  it('does not mutate caller owned facts', () => {
    const facts = Object.freeze({ ...eligible });
    decideCompactionCandidate(facts);
    expect(facts).toEqual(eligible);
  });
});
