import { describe, expect, it } from 'vitest';
import { computeSessionSnapshotHash } from '../../../src/ai/runtime/session-store/migration.js';
import { captureIntentSnapshot } from '../../../src/runtime/intent-delegation/intent-snapshot-data.js';
import { freezeIntentNativeLedger } from '../../../src/runtime/intent-delegation/native-contract-journal.js';
import { createEmptySessionIntentLedger, type SessionIntentLedger } from '../../../src/runtime/intent-delegation/types.js';
import type { PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';
import type { StoredSessionSnapshot } from '../../../src/ai/runtime/session-store/stored-snapshot-types.js';
import type { StoredSessionIntentLedgerInput, StoredIntentRecordInput } from '../../../src/runtime/intent-delegation/stored-intent-clone.js';

// Public JSON DATA only. Stored owner IDs are not a Store lease, actor/profile,
// execution grant or witness of SDK/physical retirement. No Store is constructed.
function rawFixture(): { snapshot: StoredSessionSnapshot; ledger: StoredSessionIntentLedgerInput } {
  const record: StoredIntentRecordInput = {
    intentId: 'legacy-intent', instanceId: 'stored-owner', sessionId: 'stored-session',
    rawIntent: 'keep legacy data', normalizedIntent: 'keep legacy data',
    intentType: 'review', deliverable: 'legacy report', explicitConstraints: [],
    delegationBoundary: [], riskTier: 'low', templateId: 'legacy-template',
    steps: [{ stepId: 'legacy-step', dependsOn: [], role: 'review' }],
    activeStepId: 'legacy-step', overallStatus: 'drafting_plan', attemptCount: 1,
    createdAt: 1, updatedAt: 1,
  };
  const ledger: StoredSessionIntentLedgerInput = {
    sessionId: 'stored-session', instanceId: 'stored-owner', activeIntentId: 'legacy-intent',
    latestPlan: record, intents: [record], breadcrumbs: [], receipt: null, salvage: null,
    ownership: { state: 'owned', ownerInstanceId: 'stored-owner', updatedAt: 1 }, updatedAt: 1,
  };
  const snapshot: StoredSessionSnapshot = {
    sessionId: 'stored-session', cwd: '/data-only', createdAt: 1, updatedAt: 1,
    lineage: ['stored-session'], messages: [], usage: { inputTokens: 0, outputTokens: 0 },
    compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [], intentDelegation: ledger,
  };
  return { snapshot, ledger };
}

describe('existing public DATA helpers support honest raw storage types', () => {
  it('captures the intent slot without modernizing legacy values or missing fields', () => {
    const { snapshot, ledger } = rawFixture();
    const captured: StoredSessionSnapshot = captureIntentSnapshot(snapshot);
    expect(captured).not.toBe(snapshot);
    expect(captured.intentDelegation).not.toBe(ledger);
    expect(captured.intentDelegation).toEqual(ledger);
    if (!captured.intentDelegation) throw Error('fixture_ledger_missing');
    expect(captured.intentDelegation.intents[0].intentType).toBe('review');
    expect(captured.intentDelegation.intents[0].steps[0].role).toBe('review');
    expect(Object.hasOwn(captured.intentDelegation.intents[0], 'stages')).toBe(false);
    captured.intentDelegation.intents[0].deliverable = 'changed copy';
    expect(ledger.intents[0].deliverable).toBe('legacy report');
    // This helper captures the intent slot, not the whole snapshot/message graph.
    expect(captured.messages).toBe(snapshot.messages);
  });

  it('rejects an intent-slot accessor before invoking its getter', () => {
    const { snapshot } = rawFixture(); let gets = 0;
    Object.defineProperty(snapshot, 'intentDelegation', { enumerable: true, get() { gets++; throw Error('must_not_run'); } });
    expect(() => captureIntentSnapshot(snapshot)).toThrow('intent_commit_accessor');
    expect(gets).toBe(0);
  });

  it('deep-freezes a captured raw ledger while leaving its caller input mutable', () => {
    const { ledger } = rawFixture();
    const frozen: StoredSessionSnapshot['intentDelegation'] = freezeIntentNativeLedger(ledger);
    if (!frozen) throw Error('fixture_ledger_missing');
    expect(frozen).toEqual(ledger);
    expect(frozen).not.toBe(ledger);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.intents)).toBe(true);
    expect(Object.isFrozen(frozen.intents[0].steps[0])).toBe(true);
    expect(Object.isFrozen(ledger)).toBe(false);
    expect(Object.hasOwn(frozen.intents[0], 'intentMode')).toBe(false);
  });

  it('rejects a nested raw-ledger accessor before invoking its getter', () => {
    const { ledger } = rawFixture(); let gets = 0;
    Object.defineProperty(ledger.intents[0], 'extension', { enumerable: true, get() { gets++; throw Error('must_not_run'); } });
    expect(() => freezeIntentNativeLedger(ledger)).toThrow('intent_commit_accessor');
    expect(gets).toBe(0);
  });

  it('hashes the full raw plain-data snapshot deterministically across key order', () => {
    const { snapshot } = rawFixture();
    const { intentDelegation, ...envelope } = snapshot;
    const reversed: StoredSessionSnapshot = { intentDelegation, ...envelope };
    const hash: string = computeSessionSnapshotHash(snapshot);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeSessionSnapshotHash(reversed)).toBe(hash);
    expect(snapshot.intentDelegation?.intents[0].intentType).toBe('review');
  });

  it('binds legacy intent data in the hash rather than only a selected modern view', () => {
    const { snapshot, ledger } = rawFixture();
    const before = computeSessionSnapshotHash(snapshot);
    ledger.intents.push({ ...ledger.intents[0], intentId: 'unselected-legacy', rawIntent: 'first value' });
    const withUnselected = computeSessionSnapshotHash(snapshot);
    ledger.intents[1].rawIntent = 'second value';
    expect(withUnselected).not.toBe(before);
    expect(computeSessionSnapshotHash(snapshot)).not.toBe(withUnselected);
  });

  it('retains the strict modern overloads without treating DATA as SDK identity', () => {
    const { snapshot } = rawFixture();
    const ledger = createEmptySessionIntentLedger('modern-data', 1);
    const modern: PersistedSessionSnapshot = { ...snapshot, sessionId: 'modern-data', intentDelegation: ledger };
    const captured: PersistedSessionSnapshot = captureIntentSnapshot(modern);
    const frozen: SessionIntentLedger | undefined = freezeIntentNativeLedger(ledger);
    const hash: string = computeSessionSnapshotHash(modern);
    expect(captured.intentDelegation).toEqual(ledger);
    expect(frozen).toEqual(ledger);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves undefined-ledger behavior without creating data or a grant', () => {
    const { snapshot } = rawFixture();
    delete snapshot.intentDelegation;
    expect(freezeIntentNativeLedger(undefined)).toBeUndefined();
    expect(captureIntentSnapshot(snapshot).intentDelegation).toBeUndefined();
  });
});
