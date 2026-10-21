import { describe, expect, it } from 'vitest';
import { rekeySessionIntentLedger, createEmptySessionIntentLedger, type SessionIntentLedger } from '../../../src/runtime/intent-delegation/types.js';
import type { StoredIntentRecordInput, StoredSessionIntentLedgerInput, NormalizedStoredSessionIntentLedger } from '../../../src/runtime/intent-delegation/stored-intent-clone.js';

// Plain Stored DATA only. These values are not a Store lease, profile or producer grant.
function row(intentId: string, intentType: unknown, role: unknown): StoredIntentRecordInput {
  return {
    intentId, instanceId: intentId === 'intent_primary' ? 'inst_primary' : 'inst_secondary', sessionId: 'sess_source',
    rawIntent: 'old input', normalizedIntent: 'old input', intentType, deliverable: 'summary',
    explicitConstraints: [], delegationBoundary: [], riskTier: 'legacy-risk', templateId: 'legacy-template',
    steps: [{ stepId: intentId + ':step', key: 'old-step', order: 0, role, skillName: null, dependsOn: [], status: 'legacy-status', riskTier: 'legacy-risk' }],
    activeStepId: intentId + ':step', overallStatus: 'legacy-overall', attemptCount: 1, createdAt: 100, updatedAt: 200,
  };
}
function stored(): StoredSessionIntentLedgerInput {
  const first = row('intent_primary', 'generate', 'collect'), second = row('intent_secondary', 'review', 'review');
  return { sessionId: 'sess_source', instanceId: 'inst_primary', activeIntentId: first.intentId, latestPlan: first, intents: [first, second],
    breadcrumbs: [], receipt: null, salvage: null,
    ownership: { state: 'released', previousOwnerInstanceId: 'inst_primary', updatedAt: 200 }, updatedAt: 200 };
}
function primary(value: StoredSessionIntentLedgerInput): StoredIntentRecordInput {
  const first = value.intents[0];
  if (!first) throw Error('fixture_primary_missing');
  return first;
}
const stageInputs: Array<'absent' | 'null' | 'empty'> = ['absent', 'null', 'empty'];

describe('actual public rekey wrapper with truthful Stored input', () => {
  it.each(stageInputs)('uses the existing fallback only through rekey for %s stages', mode => {
    const source = stored();
    if (mode !== 'absent') for (const item of source.intents) item.stages = mode === 'null' ? null : [];
    const before = structuredClone(source);
    for (const item of source.intents) {
      expect(Object.hasOwn(item, 'finalDeliverable')).toBe(false);
      expect(Object.hasOwn(item, 'intentMode')).toBe(false);
      expect(Object.hasOwn(item, 'segmentationConfidence')).toBe(false);
      expect(Object.hasOwn(item, 'activeStageId')).toBe(false);
      if (mode === 'absent') expect(Object.hasOwn(item, 'stages')).toBe(false);
      else expect(item.stages).toEqual(mode === 'null' ? null : []);
    }
    const after: NormalizedStoredSessionIntentLedger = rekeySessionIntentLedger(source, 'sess_fork');
    expect(after.sessionId).toBe('sess_fork');
    expect(after.latestPlan?.sessionId).toBe('sess_fork');
    expect(after.intents.map(item => item.sessionId)).toEqual(['sess_fork', 'sess_fork']);
    expect(after.intents.map(item => item.instanceId)).toEqual(['inst_primary', 'inst_secondary']);
    expect(after.ownership).toEqual(source.ownership);
    for (const item of after.intents) {
      expect(item.stages.length).toBe(1);
      expect(item.stages[0]?.stageId).toBe(item.intentId + ':stage:1');
      expect(item.activeStageId).toBe(item.intentId + ':stage:1');
      expect(item.finalDeliverable).toBe('summary');
      expect(item.intentMode).toBe('single_stage');
      expect(item.segmentationConfidence).toBe('low');
    }
    expect(after.intents[1]?.intentType).toBe('review');
    expect(after.intents[1]?.steps[0]?.role).toBe('review');
    expect(after.intents[1]?.stages[0]?.steps[0]?.role).toBe('review');
    expect(source).toEqual(before);
  });

  it('retains supplied stages and unknown scalar values without claiming they are modern', () => {
    const source = stored(), first = primary(source);
    first.stages = [{ stageId: 'provided-stage', dependsOnStageIds: [], steps: first.steps, intentType: 'review', status: 'legacy-stage-status' }];
    first.activeStageId = 'provided-stage';
    first.finalDeliverable = 'provided'; first.intentMode = 'legacy-mode'; first.segmentationConfidence = 'legacy-confidence';
    const before = structuredClone(source);
    const after: NormalizedStoredSessionIntentLedger = rekeySessionIntentLedger(source, 'sess_fork');
    expect(after.intents[0]?.stages).toEqual(first.stages);
    expect(after.intents[0]?.activeStageId).toBe('provided-stage');
    expect(after.intents[0]?.finalDeliverable).toBe('provided');
    expect(after.intents[0]?.intentMode).toBe('legacy-mode');
    expect(after.intents[0]?.segmentationConfidence).toBe('legacy-confidence');
    expect(after.intents[1]?.intentType).toBe('review');
    expect(source).toEqual(before);
  });

  it('keeps the original falsey metadata versus stage-label fallback distinction', () => {
    const source = stored();
    primary(source).finalDeliverable = 0;
    const after: NormalizedStoredSessionIntentLedger = rekeySessionIntentLedger(source, 'sess_fork');
    expect(after.intents[0]?.finalDeliverable).toBe(0);
    expect(after.intents[0]?.stages[0]?.deliverable).toBe('summary');
    expect(Object.hasOwn(primary(source), 'stages')).toBe(false);
    expect(primary(source).finalDeliverable).toBe(0);
  });

  it('keeps copied record, stage and latest-plan arrays independent of the source', () => {
    const source = stored(), first = primary(source), step = first.steps[0];
    if (!step) throw Error('fixture_step_missing');
    step.dependsOn.push('seed');
    const before = structuredClone(source);
    const after = rekeySessionIntentLedger(source, 'sess_fork');
    const changed = after.intents[0], changedStep = changed?.steps[0], changedStageStep = changed?.stages[0]?.steps[0];
    if (!changedStep || !changedStageStep) throw Error('rekey_step_missing');
    changedStep.dependsOn.push('after-only');
    expect(changedStageStep.dependsOn).toEqual(['seed']);
    expect(after.latestPlan?.steps[0]?.dependsOn).toEqual(['seed']);
    expect(step.dependsOn).toEqual(['seed']);
    expect(source).toEqual(before);
    expect(after).not.toBe(source);
  });

  it('preserves the modern input to modern return overload', () => {
    const source: SessionIntentLedger = createEmptySessionIntentLedger('sess_source', 200);
    const after: SessionIntentLedger = rekeySessionIntentLedger(source, 'sess_fork');
    expect(after.sessionId).toBe('sess_fork');
    expect(after.latestPlan).toBeNull();
    expect(after.intents).toEqual([]);
    expect(after.updatedAt).toBe(200);
    expect(source.sessionId).toBe('sess_source');
    expect(after).not.toBe(source);
  });
});
