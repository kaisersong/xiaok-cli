import { describe, expect, it } from 'vitest';
import { appendIntentToLedger, createEmptySessionIntentLedger, readLedger, recordBreadcrumbInLedger, recordReceiptInLedger, recordSalvageInLedger, saveDispatchedIntentInLedger, updateIntentInLedger } from '../../../src/runtime/intent-delegation/store.js';
import { createIntentLedgerRecord, resolveActiveRiskTier, type LegacyIntentPlanDraft } from '../../../src/runtime/intent-delegation/types.js';
import { cloneStoredSessionIntentLedger, type NormalizedStoredSessionIntentLedger, type StoredIntentRecordInput } from '../../../src/runtime/intent-delegation/stored-intent-clone.js';
import { assertSessionWriteOwnership, markSessionOwned, releaseSessionOwnership, resumeSessionOwnership, takeoverSessionOwnership } from '../../../src/runtime/intent-delegation/ownership.js';

// Synthetic DATA for actual pure exported reducers; not a host, grant or SDK invocation.
function plan(id: string): LegacyIntentPlanDraft {
  return { sessionId: 's', instanceId: 'owner', intentId: id, rawIntent: 'draft', normalizedIntent: 'draft', intentType: 'generate', deliverable: 'text', explicitConstraints: [], delegationBoundary: [], riskTier: 'high', templateId: 'tpl_generate', continuationMode: 'new_intent', steps: [{ stepId: id + ':step', key: 'compose', order: 0, role: 'compose', skillName: null, dependsOn: [], status: 'planned', riskTier: 'high' }] };
}
function mixed(): NormalizedStoredSessionIntentLedger {
  const primary = createIntentLedgerRecord(plan('active'), 1);
  const old = { ...primary, intentId: 'review', intentType: 'review', stages: null, finalDeliverable: undefined, intentMode: undefined, segmentationConfidence: undefined, steps: primary.steps.map(step => ({ ...step, role: 'review' })), opaqueNote: { preserve: true } };
  return cloneStoredSessionIntentLedger({ ...createEmptySessionIntentLedger('s', 1), instanceId: 'owner', activeIntentId: primary.intentId, latestPlan: primary, intents: [old, primary], ownership: { state: 'owned', ownerInstanceId: 'owner', updatedAt: 1 }, nativeContracts: { opaque: 'not-a-qualified-journal' }, publicationCandidates: ['opaque'], verificationExecutions: { old: true } });
}

describe('stored ledger pure read and targeted DATA operations', () => {
  it('keeps the original empty ledger read branch', () => {
    expect(readLedger({ sessionId: 's', updatedAt: 7, intentDelegation: undefined })).toEqual(createEmptySessionIntentLedger('s', 7));
  });
  it('reads mixed historical records and all opaque extensions without a modern gate', () => {
    const input = mixed(), before = structuredClone(input);
    const output = readLedger({ sessionId: 's', updatedAt: 1, intentDelegation: input });
    expect(output).toEqual(before);
    expect(input).toEqual(before);
    expect(output).not.toBe(input);
  });
  it('appends a real constructor record while retaining unrelated review history', () => {
    const input = mixed(), prior = structuredClone(input.intents[0]);
    const output = appendIntentToLedger(input, plan('new'), 9);
    expect(output.intents[0]).toEqual(prior);
    expect(output.latestPlan?.intentId).toBe('new');
    expect(output.intents.map(row => row.intentId)).toEqual(['review', 'active', 'new']);
    expect(output.nativeContracts).toEqual(input.nativeContracts);
  });
  it('updates only the selected record and summary', () => {
    const input = mixed(), prior = structuredClone(input.intents[0]);
    const output = updateIntentInLedger(input, 'active', { overallStatus: 'waiting_user', blockedReason: 'need input' }, 10);
    expect(output.intents[0]).toEqual(prior);
    expect(output.latestPlan).toMatchObject({ intentId: 'active', overallStatus: 'waiting_user', blockedReason: 'need input' });
    expect(output.verificationExecutions).toEqual(input.verificationExecutions);
  });
  it('retains the original dispatcher-owned patch refusal', () => {
    expect(() => updateIntentInLedger(mixed(), 'active', { steps: [] }, 10)).toThrow('dispatcher-owned fields');
  });
  it('retains missing selected-ID refusal', () => {
    expect(() => updateIntentInLedger(mixed(), 'missing', {}, 10)).toThrow('intent not found');
  });
  it('saves dispatched DATA with the original stored session and instance IDs', () => {
    const input = mixed(), record = createIntentLedgerRecord({ ...plan('active'), sessionId: 'wrong', instanceId: 'other' }, 11);
    const output = saveDispatchedIntentInLedger(input, record);
    expect(output.latestPlan).toMatchObject({ intentId: 'active', sessionId: 's', instanceId: 'owner' });
    expect(output.intents[0]).toEqual(input.intents[0]);
    expect(output.publicationCandidates).toEqual(input.publicationCandidates);
  });
  it('retains breadcrumb receipt and salvage mutation order and other history', () => {
    const input = mixed();
    const breadcrumb = recordBreadcrumbInLedger(input, { intentId: 'active', stepId: 'active:step', status: 'running', message: 'progress' }, 2);
    const receipt = recordReceiptInLedger(breadcrumb, { intentId: 'active', stepId: 'active:step', note: 'done' }, 3);
    const output = recordSalvageInLedger(receipt, { intentId: 'active', summary: ['kept'] }, 4);
    expect(output.breadcrumbs).toHaveLength(1);
    expect(output.receipt).toMatchObject({ note: 'done', createdAt: 3 });
    expect(output.salvage).toMatchObject({ summary: ['kept'], createdAt: 4 });
    expect(output.intents[0]).toEqual(input.intents[0]);
    expect(output.nativeContracts).toEqual(input.nativeContracts);
  });
  it('keeps ownership transitions and exact previous owner checks on mixed history', () => {
    const input = mixed(), released = releaseSessionOwnership(input, 'owner', 5);
    expect(() => markSessionOwned(released, 'other', 6)).toThrow('prior owner');
    const resumed = resumeSessionOwnership(released, 'owner', 6);
    expect(resumed.ownership).toMatchObject({ state: 'resume', ownerInstanceId: 'owner' });
    expect(resumed.intents).toEqual(input.intents);
  });
  it('retains default-deny ownership guard without validating secondary enums', () => {
    expect(() => assertSessionWriteOwnership(mixed(), 'other', 'write')).toThrow('owned by');
    expect(() => assertSessionWriteOwnership(mixed(), 'owner', 'write')).not.toThrow();
  });
  it('keeps active high-risk takeover confirmation and every opaque historical value', () => {
    const input = mixed();
    expect(resolveActiveRiskTier(input)).toBe('high');
    expect(() => takeoverSessionOwnership(input, 'other', { now: 8 })).toThrow('explicit confirmation');
    const output = takeoverSessionOwnership(input, 'other', { now: 8, confirmHighRisk: true });
    expect(output.ownership).toMatchObject({ state: 'takeover', ownerInstanceId: 'other' });
    expect(output.intents).toEqual(input.intents);
    expect(output.nativeContracts).toEqual(input.nativeContracts);
  });
  it('does not invent low risk from a preserved unknown active risk value', () => {
    const input = mixed(), active = input.intents.find(row => row.intentId === 'active');
    if (!active) throw new Error('fixture_active_missing');
    const changed: StoredIntentRecordInput = { ...active, steps: active.steps.map(step => ({ ...step, riskTier: 'historic-risk' })) };
    const output = cloneStoredSessionIntentLedger({ ...input, intents: input.intents.map(row => row.intentId === 'active' ? changed : row) });
    expect(resolveActiveRiskTier(output)).toBe('historic-risk');
    expect(output.intents[0]).toEqual(input.intents[0]);
  });
});
