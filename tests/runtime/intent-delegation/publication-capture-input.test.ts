import { describe, expect, it } from 'vitest';
import {
  applyIntentPublicationCapture, applyIntentPublicationMutation,
  type IntentPublicationCaptureMutation, type IntentPublicationCaptureSnapshot,
  type ReserveIntentPublicationInput,
} from '../../../src/runtime/intent-delegation/publication-candidate-journal.js';
import { intentNativeLedgerHash } from '../../../src/runtime/intent-delegation/native-contract-journal.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/types.js';
import type { PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';

// Intended reducer guard paths stop before installed-profile/route/SDK operations.
// Candidate module import and its side effects have not been executed or qualified.
// Fixture ownership IDs are reducer DATA, never an actual Store lease or approval.
function minimal(): IntentPublicationCaptureSnapshot {
  const ledger = createEmptySessionIntentLedger('session', 1);
  ledger.instanceId = 'owner-A';
  ledger.ownership = { state: 'owned', ownerInstanceId: 'owner-A', updatedAt: 1 };
  return { sessionId: 'session', intentDelegation: ledger, updatedAt: 1 };
}
function reserve(previous: IntentPublicationCaptureSnapshot): Extract<IntentPublicationCaptureMutation, { publicationAction: 'reserve' }> {
  return { publicationAction: 'reserve', sessionId: 'session', instanceId: 'owner-A',
    expectedLedgerHash: intentNativeLedgerHash(previous.intentDelegation), requestSource: 'user', now: 2,
    artifactSelections: [], fileObservations: [] };
}
function actions(previous: IntentPublicationCaptureSnapshot): Array<{ input: IntentPublicationCaptureMutation; error: string }> {
  const common: Pick<ReserveIntentPublicationInput, 'sessionId' | 'instanceId' | 'expectedLedgerHash' | 'requestSource' | 'now'> = {
    sessionId: 'session', instanceId: 'owner-A', expectedLedgerHash: intentNativeLedgerHash(previous.intentDelegation), requestSource: 'user', now: 2,
  };
  return [
    { input: { ...common, publicationAction: 'reserve', artifactSelections: [], fileObservations: [] }, error: 'intent_candidate_current' },
    { input: { ...common, publicationAction: 'reserve-parent', references: [], fileObservations: [] }, error: 'intent_candidate_current' },
    { input: { ...common, publicationAction: 'claim', candidateId: 'missing', expectedRequestId: 'request', expectedRevision: 1, route: '{}' }, error: 'intent_candidate_current' },
    { input: { ...common, publicationAction: 'retry', candidateId: 'missing', expectedRequestId: 'request', expectedRevision: 1 }, error: 'intent_candidate_current' },
    { input: { ...common, publicationAction: 'observe', candidateId: 'missing', expectedRequestId: 'request', expectedRevision: 1, observation: null, sourceChanged: true }, error: 'intent_candidate_stale' },
  ];
}

describe('production capture consumer accepts only the actual three-field snapshot', () => {
  it('reaches the original session error without a fabricated full snapshot', () => {
    const previous: IntentPublicationCaptureSnapshot = { sessionId: 'session', updatedAt: 1 };
    expect(Object.keys(previous)).toEqual(['sessionId', 'updatedAt']);
    expect(() => applyIntentPublicationCapture(previous, reserve(previous))).toThrow('intent_candidate_session');
    expect(Object.hasOwn(previous, 'messages')).toBe(false);
  });

  it('keeps session mismatch before ownership/hash checks', () => {
    const previous = minimal();
    previous.sessionId = 'other';
    expect(() => applyIntentPublicationCapture(previous, reserve(previous))).toThrow('intent_candidate_session');
  });

  it('retains whole-own-DATA capture validation before the session error', () => {
    const previous = { sessionId: 'session', updatedAt: 1, extension: new Date(0) };
    expect(() => applyIntentPublicationCapture(previous, reserve(previous))).toThrow('intent_commit_data');
    expect(previous.extension).toBeInstanceOf(Date);
  });

  it('keeps released ownership rejection before a stale hash', () => {
    const previous = minimal(), ledger = previous.intentDelegation;
    if (!ledger) throw Error('fixture_ledger_missing');
    ledger.ownership = { state: 'released', previousOwnerInstanceId: 'owner-A', updatedAt: 1 };
    const input = reserve(previous);
    input.expectedLedgerHash = 'wrong';
    expect(() => applyIntentPublicationCapture(previous, input)).toThrow('session ownership is released');
    expect(ledger.ownership.state).toBe('released');
  });

  it('keeps foreign owner rejection before a stale hash', () => {
    const previous = minimal(), input = reserve(previous);
    input.instanceId = 'owner-B';
    input.expectedLedgerHash = 'wrong';
    expect(() => applyIntentPublicationCapture(previous, input)).toThrow('session is owned by owner-A');
    expect(previous.intentDelegation?.ownership.ownerInstanceId).toBe('owner-A');
  });

  it('keeps stale hash rejection before the empty-current branch', () => {
    const previous = minimal(), input = reserve(previous);
    input.expectedLedgerHash = 'wrong';
    expect(() => applyIntentPublicationCapture(previous, input)).toThrow('intent_candidate_stale');
  });

  it.each(actions(minimal()))('retains the existing $input.publicationAction guard with no messages/default fill', ({ input, error }) => {
    const previous = minimal(), before = structuredClone(previous);
    expect(Object.keys(previous)).toEqual(['sessionId', 'intentDelegation', 'updatedAt']);
    const invoke = (): IntentPublicationCaptureSnapshot => applyIntentPublicationCapture(previous, input);
    expect(invoke).toThrow(error);
    expect(previous).toEqual(before);
    expect(Object.hasOwn(previous, 'messages')).toBe(false);
  });

  it('preserves the full modern overload and wrapper guard without projecting away other fields', () => {
    const data = minimal();
    const previous: PersistedSessionSnapshot = {
      ...data, cwd: '/workspace', createdAt: 1, lineage: ['session'], messages: [],
      usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [],
    };
    const before = structuredClone(previous), input = reserve(previous);
    const fromHelper = (): PersistedSessionSnapshot => applyIntentPublicationCapture(previous, input);
    const fromWrapper = (): PersistedSessionSnapshot => applyIntentPublicationMutation(previous, input);
    expect(fromHelper).toThrow('intent_candidate_current');
    expect(fromWrapper).toThrow('intent_candidate_current');
    expect(previous).toEqual(before);
  });
});
