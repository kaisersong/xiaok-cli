import { describe, expect, it } from 'vitest';
import { applyIntentNativeMutation, intentNativeLedgerHash, type IntentNativeMutation } from '../../../src/runtime/intent-delegation/native-contract-journal.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/types.js';
import type { StoredIntentRecordInput, StoredSessionIntentLedgerInput } from '../../../src/runtime/intent-delegation/stored-intent-clone.js';
import type { StoredSessionSnapshot } from '../../../src/ai/runtime/session-store/stored-snapshot-types.js';
import type { PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';

// DATA-only reducer fixtures; they do not supply an actual Store lease or SDK approval.
const core = {
  sessionId: 'session', cwd: '/workspace', createdAt: 1, updatedAt: 1, lineage: ['session'],
  messages: [], usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [],
};
function record(intentId: string, risk: unknown): StoredIntentRecordInput {
  return {
    intentId, instanceId: 'owner-A', sessionId: 'session', rawIntent: 'old', normalizedIntent: 'old', intentType: intentId === 'secondary' ? 'review' : 'generate',
    deliverable: 'report', explicitConstraints: [], delegationBoundary: [], riskTier: risk, templateId: 'old-template',
    steps: [{ stepId: 's1', key: 'collect', order: 'opaque-order', role: intentId === 'secondary' ? 'review' : 'collect', skillName: null, dependsOn: [], status: 'old-status', riskTier: risk }],
    activeStepId: 's1', overallStatus: 'old-overall', attemptCount: 1, createdAt: 1, updatedAt: 1,
  };
}
function snapshot(risk: unknown): StoredSessionSnapshot {
  const primary = record('primary', risk), secondary = record('secondary', 'unknown-risk');
  return { ...core, intentDelegation: {
    sessionId: 'session', instanceId: 'owner-A', activeIntentId: 'primary', latestPlan: primary, intents: [primary, secondary],
    breadcrumbs: [], receipt: null, salvage: null, ownership: { state: 'owned', ownerInstanceId: 'owner-A', updatedAt: 1 }, updatedAt: 1,
    publicationCandidates: { opaque: true },
  } };
}
function ledgerOf(value: StoredSessionSnapshot): StoredSessionIntentLedgerInput {
  if (!value.intentDelegation) throw Error('fixture_ledger_missing');
  return value.intentDelegation;
}
type OwnershipAction = Extract<IntentNativeMutation, { nativeAction: 'ownership' }>;
function requestFor(value: StoredSessionSnapshot, action: OwnershipAction['action'], instanceId: string): OwnershipAction {
  return { nativeAction: 'ownership', action, sessionId: value.sessionId, instanceId, requestSource: 'user', now: 2,
    expectedLedgerHash: intentNativeLedgerHash(value.intentDelegation), confirmHighRisk: false };
}

describe('actual native journal reducer with truthful Stored input', () => {
  it('releases ownership without normalizing or dropping secondary history/journals', () => {
    const before = snapshot('low'), original = structuredClone(before);
    const after = applyIntentNativeMutation(before, requestFor(before, 'release', 'owner-A'));
    const data = ledgerOf(after), old = ledgerOf(before);
    expect(data.ownership).toEqual({ state: 'released', previousOwnerInstanceId: 'owner-A', updatedAt: 2 });
    expect(data.intents).toEqual(old.intents);
    expect(data.latestPlan).toEqual(old.latestPlan);
    expect(data.intents[1]?.intentType).toBe('review');
    expect(data.intents[1]?.steps[0]?.role).toBe('review');
    expect(data.publicationCandidates).toEqual({ opaque: true });
    expect(Object.hasOwn(data, 'nativeContracts')).toBe(false);
    for (const row of data.intents) {
      expect(Object.hasOwn(row, 'stages')).toBe(false);
      expect(Object.hasOwn(row, 'finalDeliverable')).toBe(false);
    }
    expect(before).toEqual(original);
    expect(after).not.toBe(before);
  });

  it('keeps the original foreign-owner rejection and leaves input untouched', () => {
    const before = snapshot('low'), original = structuredClone(before);
    expect(() => applyIntentNativeMutation(before, requestFor(before, 'release', 'owner-B'))).toThrow('cannot release session owned by owner-A');
    expect(before).toEqual(original);
  });

  it('resumes the original released-owner DATA while retaining raw records', () => {
    const before = snapshot('low');
    ledgerOf(before).ownership = { state: 'released', previousOwnerInstanceId: 'owner-A', updatedAt: 1 };
    const after = applyIntentNativeMutation(before, requestFor(before, 'resume', 'owner-A'));
    expect(ledgerOf(after).ownership.state).toBe('resume');
    expect(ledgerOf(after).ownership.ownerInstanceId).toBe('owner-A');
    expect(ledgerOf(after).intents).toEqual(ledgerOf(before).intents);
    const primary = ledgerOf(after).intents.find(row => row.intentId === 'primary');
    if (!primary) throw Error('primary_record_lost');
    expect(Object.hasOwn(primary, 'stages')).toBe(false);
  });

  it.each([false, true])('keeps original selected high-risk confirmation behavior: %s', confirmHighRisk => {
    const before = snapshot('high'), original = structuredClone(before);
    const action = { ...requestFor(before, 'takeover', 'owner-B'), confirmHighRisk };
    if (!confirmHighRisk) {
      expect(() => applyIntentNativeMutation(before, action)).toThrow('high-risk takeover requires explicit confirmation');
    } else {
      const after = applyIntentNativeMutation(before, action);
      expect(ledgerOf(after).ownership.ownerInstanceId).toBe('owner-B');
      expect(ledgerOf(after).ownership.previousOwnerInstanceId).toBe('owner-A');
      expect(ledgerOf(after).intents).toEqual(ledgerOf(before).intents);
      expect(ledgerOf(after).intents[1]?.intentType).toBe('review');
    }
    expect(before).toEqual(original);
  });

  it('keeps the existing stale-hash rejection', () => {
    const before = snapshot('low'), action = requestFor(before, 'release', 'owner-A');
    action.expectedLedgerHash = (action.expectedLedgerHash[0] === '0' ? '1' : '0') + action.expectedLedgerHash.slice(1);
    expect(() => applyIntentNativeMutation(before, action)).toThrow('intent_native_stale');
    expect(ledgerOf(before).ownership.state).toBe('owned');
  });

  it('keeps the original time check before ownership hash comparison', () => {
    const before = snapshot('low'), action = requestFor(before, 'release', 'owner-A');
    action.now = 0;
    action.expectedLedgerHash = 'wrong';
    expect(() => applyIntentNativeMutation(before, action)).toThrow('intent_native_time');
    expect(ledgerOf(before).ownership.state).toBe('owned');
  });

  it('preserves the modern input and modern return overload', () => {
    const ledger = createEmptySessionIntentLedger('session', 1);
    ledger.instanceId = 'owner-A';
    ledger.ownership = { state: 'owned', ownerInstanceId: 'owner-A', updatedAt: 1 };
    const before: PersistedSessionSnapshot = { ...core, intentDelegation: ledger };
    const after: PersistedSessionSnapshot = applyIntentNativeMutation(before, requestFor(before, 'release', 'owner-A'));
    expect(after.intentDelegation?.ownership.state).toBe('released');
    expect(after.intentDelegation?.intents).toEqual([]);
  });
});
