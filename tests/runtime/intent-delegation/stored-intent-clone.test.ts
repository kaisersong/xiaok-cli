import { describe, expect, it } from 'vitest';
import {
  cloneStoredIntentRecord,
  cloneStoredSessionIntentLedger,
  rekeyStoredSessionIntentLedger,
  hasStoredReviewValue,
} from '../../../src/runtime/intent-delegation/stored-intent-clone.js';
import { createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/types.js';
import type { LegacyIntentPlanDraft } from '../../../src/runtime/intent-delegation/types.js';

const collect = {
  stepId: 'intent_nested:step:collect', key: 'collect', order: 0, role: 'collect',
  skillName: null, dependsOn: [], status: 'planned', riskTier: 'medium',
};
const raw = {
  intentId: 'intent_nested', instanceId: 'inst_nested', sessionId: 'sess_nested',
  rawIntent: 'Write summary', normalizedIntent: 'write summary', intentType: 'generate',
  deliverable: 'summary', explicitConstraints: [], delegationBoundary: [], riskTier: 'medium',
  templateId: 'tpl_generate', steps: [collect], activeStepId: collect.stepId,
  overallStatus: 'drafting_plan', attemptCount: 1, createdAt: 100, updatedAt: 200,
};
const reviewStep = {
  ...collect, stepId: 'intent_secondary:step:review', key: 'review', role: 'review', riskTier: 'low',
};
const review = {
  ...raw, intentId: 'intent_secondary', instanceId: 'inst_secondary',
  rawIntent: 'Review summary', normalizedIntent: 'review summary', intentType: 'review',
  deliverable: 'review', templateId: 'tpl_review', riskTier: 'low',
  steps: [reviewStep], activeStepId: reviewStep.stepId, createdAt: 120,
};
const ledger = {
  instanceId: 'inst_nested', sessionId: 'sess_nested', activeIntentId: raw.intentId,
  latestPlan: raw, intents: [raw, review], breadcrumbs: [], receipt: null, salvage: null,
  ownership: { state: 'released', previousOwnerInstanceId: 'inst_nested', updatedAt: 200 },
  updatedAt: 200,
};

describe('stored intent clone using production fallback', () => {
  it('accepts the original missing-five record without prefilling the input', () => {
    const before = JSON.stringify(raw);
    const normalized = cloneStoredIntentRecord(raw);
    expect(normalized).toMatchObject({
      finalDeliverable: 'summary', intentMode: 'single_stage', segmentationConfidence: 'low',
      activeStageId: 'intent_nested:stage:1',
    });
    expect(normalized.stages).toEqual([expect.objectContaining({
      stageId: 'intent_nested:stage:1', intentType: 'generate', deliverable: 'summary',
      activeStepId: collect.stepId, status: 'planned', structuralValidation: 'pending',
      semanticValidation: 'pending', needsFreshContextHandoff: false,
    })]);
    expect(JSON.stringify(raw)).toBe(before);
    expect(Object.hasOwn(raw, 'stages')).toBe(false);
    expect(Object.hasOwn(raw, 'finalDeliverable')).toBe(false);
  });

  it('keeps review in the record, synthesized stage and both step copies', () => {
    const normalized = cloneStoredIntentRecord(review);
    expect(normalized.intentType).toBe('review');
    expect(normalized.steps[0]?.role).toBe('review');
    expect(normalized.stages[0]?.intentType).toBe('review');
    expect(normalized.stages[0]?.steps[0]?.role).toBe('review');
    expect(normalized.templateId).toBe('tpl_review');
    expect(normalized.finalDeliverable).toBe('review');
  });

  it('preserves independently supplied metadata while filling only the absent fields', () => {
    const normalized = cloneStoredIntentRecord({ ...raw, finalDeliverable: 'explicit final', activeStageId: 'kept-stage' });
    expect(normalized.finalDeliverable).toBe('explicit final');
    expect(normalized.activeStageId).toBe('kept-stage');
    expect(normalized.intentMode).toBe('single_stage');
    expect(normalized.segmentationConfidence).toBe('low');
    expect(normalized.stages[0]?.deliverable).toBe('explicit final');
  });

  it('uses the existing nullish fallback for each of the five fields', () => {
    const normalized = cloneStoredIntentRecord({
      ...raw, finalDeliverable: null, intentMode: null, segmentationConfidence: null,
      stages: null, activeStageId: null,
    });
    expect(normalized).toMatchObject({
      finalDeliverable: 'summary', intentMode: 'single_stage', segmentationConfidence: 'low',
      activeStageId: 'intent_nested:stage:1',
    });
    expect(normalized.stages).toHaveLength(1);
  });

  it.each([{ stages: undefined }, { stages: null }, { stages: [] }])('keeps the existing missing/empty stage branch for %j', ({ stages }) => {
    const normalized = cloneStoredIntentRecord({ ...raw, stages });
    expect(normalized.stages[0]?.stageId).toBe('intent_nested:stage:1');
    expect(normalized.stages).toHaveLength(1);
  });

  it('clones supplied partial stage data without inventing its missing status', () => {
    const supplied = {
      stageId: 'supplied', dependsOnStageIds: ['earlier'], steps: [reviewStep],
      intentType: 'stored-custom-stage', extraStage: { retained: true },
    };
    const normalized = cloneStoredIntentRecord({ ...raw, stages: [supplied] });
    expect(normalized.stages[0]).toMatchObject({
      stageId: 'supplied', intentType: 'stored-custom-stage', extraStage: { retained: true },
    });
    expect(Object.hasOwn(normalized.stages[0] ?? {}, 'status')).toBe(false);
    expect(normalized.stages[0]?.dependsOnStageIds).not.toBe(supplied.dependsOnStageIds);
    expect(normalized.stages[0]?.steps[0]?.dependsOn).not.toBe(reviewStep.dependsOn);
  });

  it('preserves unknown keys and enum values instead of rejecting or stripping them', () => {
    const input = {
      ...raw, intentType: 'stored-custom-kind', extra: { source: 'retained data' },
      steps: [{ ...collect, role: 'stored-custom-role', extraStep: 7 }],
    };
    const normalized = cloneStoredIntentRecord(input);
    expect(normalized).toMatchObject({ intentType: 'stored-custom-kind', extra: input.extra });
    expect(normalized.steps[0]).toMatchObject({ role: 'stored-custom-role', extraStep: 7 });
    expect(normalized.stages[0]?.intentType).toBe('stored-custom-kind');
  });

  it('preserves non-nullish values and the original stage-deliverable truthiness distinction', () => {
    const normalized = cloneStoredIntentRecord({
      ...raw, finalDeliverable: 0, intentMode: false, segmentationConfidence: 'old-confidence', activeStageId: '',
    });
    expect(normalized.finalDeliverable).toBe(0);
    expect(normalized.intentMode).toBe(false);
    expect(normalized.segmentationConfidence).toBe('old-confidence');
    expect(normalized.activeStageId).toBe('');
    expect(normalized.stages[0]?.deliverable).toBe('summary');
  });

  it('normalizes mixed modern and historical records without dropping or coalescing entries', () => {
    const plan: LegacyIntentPlanDraft = {
      instanceId: 'inst_modern', intentId: 'intent_modern', sessionId: 'sess_nested',
      rawIntent: 'modern control', normalizedIntent: 'modern control', intentType: 'generate',
      deliverable: 'modern control', explicitConstraints: [], delegationBoundary: [], riskTier: 'medium',
      templateId: 'tpl_generate', steps: [], continuationMode: 'new_intent',
    };
    const modern = createIntentLedgerRecord(plan, 100);
    const mixed = { ...ledger, latestPlan: raw, intents: [modern, raw, review] };
    const normalized = cloneStoredSessionIntentLedger(mixed);
    expect(normalized.intents.map(record => record.intentId)).toEqual(['intent_modern', 'intent_nested', 'intent_secondary']);
    expect(normalized.latestPlan?.intentId).toBe('intent_nested');
    expect(normalized.intents[2]?.intentType).toBe('review');
    expect(cloneStoredSessionIntentLedger(normalized)).toEqual(normalized);
  });

  it('rekeys only session identities while keeping the source and all original instance IDs', () => {
    const before = JSON.stringify(ledger);
    const forked = rekeyStoredSessionIntentLedger(ledger, 'sess_forked');
    expect(forked.sessionId).toBe('sess_forked');
    expect(forked.latestPlan?.sessionId).toBe('sess_forked');
    expect(forked.intents.map(record => record.sessionId)).toEqual(['sess_forked', 'sess_forked']);
    expect(forked.intents.map(record => record.instanceId)).toEqual(['inst_nested', 'inst_secondary']);
    expect(forked.intents[1]?.steps[0]?.role).toBe('review');
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it('keeps original auxiliary own keys and copies the known arrays', () => {
    const input = { ...raw, extraUndefined: undefined, providedSourcePaths: ['original'] };
    const normalized = cloneStoredIntentRecord(input);
    expect(Object.hasOwn(normalized, 'extraUndefined')).toBe(true);
    for (const key of ['executionTerminals', 'providedSourcePaths', 'artifacts', 'salvageSummary']) {
      expect(Object.hasOwn(normalized, key)).toBe(true);
    }
    expect(normalized.providedSourcePaths).toEqual(['original']);
    expect(normalized.providedSourcePaths).not.toBe(input.providedSourcePaths);
    expect(normalized.explicitConstraints).not.toBe(raw.explicitConstraints);
  });

  it('observes review across latestPlan, all records, supplied stages and steps without granting modern status', () => {
    expect(hasStoredReviewValue(ledger)).toBe(true);
    expect(hasStoredReviewValue({ ...ledger, latestPlan: review, intents: [raw] })).toBe(true);
    const stageOnly = { ...raw, stages: [{ stageId: 'stage', dependsOnStageIds: [], steps: [collect], intentType: 'review' }] };
    expect(hasStoredReviewValue({ ...ledger, latestPlan: null, intents: [stageOnly] })).toBe(true);
    const stepOnly = { ...raw, stages: [{ dependsOnStageIds: [], steps: [reviewStep] }] };
    expect(hasStoredReviewValue({ ...ledger, latestPlan: null, intents: [stepOnly] })).toBe(true);
    const unknown = { ...raw, intentType: 'stored-custom-kind' };
    expect(hasStoredReviewValue({ ...ledger, latestPlan: null, intents: [unknown] })).toBe(false);
  });
});
