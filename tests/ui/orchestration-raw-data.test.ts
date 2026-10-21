import { describe, expect, it } from 'vitest';
import {
  buildIntentReminderBlock, formatCurrentIntentSummaryLine,
  formatIntentCreatedTranscriptBlock, formatProgressTranscriptBlock,
  type IntentPresentationLedgerData, type IntentPresentationRecordData,
} from '../../src/ui/orchestration.js';
import { stripAnsi } from '../../src/ui/display-width.js';
import { cloneSessionIntentLedger } from '../../src/runtime/intent-delegation/types.js';
import type { StoredIntentRecordInput, StoredSessionIntentLedgerInput } from '../../src/runtime/intent-delegation/stored-intent-clone.js';

function record(patch: Partial<IntentPresentationRecordData> = {}): IntentPresentationRecordData {
  const value = {
    intentType: 'review', unknownExtension: { retained: true },
    intentId: 'selected', deliverable: 'Legacy review', finalDeliverable: 'Reviewed note',
    overallStatus: 'review', activeStageId: 's1', riskTier: 'legacy-risk',
    stages: [{ stageId: 's1', order: 0, label: 'Inspect', steps: [
      { skillName: 'generic_llm::collect', role: 'future_role' },
      { skillName: 99, role: 'review' }, { skillName: 'review-skill', role: 'unknown_role' },
    ] }],
    steps: [], providedSourcePaths: ['b.md', 'a.md'], delegationBoundary: ['own scope'],
    explicitConstraints: ['first', 'second'], latestBreadcrumb: 'Read source', ...patch,
  };
  return value;
}
function ledger(selected = record()): IntentPresentationLedgerData {
  return {
    activeIntentId: 'selected', ownership: { ownerInstanceId: 'owner' },
    intents: [selected, { intentId: 'unselected', overallStatus: {}, stages: 5, deliverable: [] }],
  };
}
function reminderText(input: IntentPresentationLedgerData): string {
  const block = buildIntentReminderBlock(input, 'owner');
  if (!block || block.type !== 'text') throw Error('expected_real_reminder');
  return block.text;
}

describe('real stored intent presenter DATA contract', () => {
  it('accepts legacy review strings, ignores role enums and preserves exact valid output', () => {
    const input = ledger();
    const before = structuredClone(input);
    expect(stripAnsi(formatCurrentIntentSummaryLine(input, 'owner')))
      .toBe('● Intent: Legacy review · Stage 1/1 Inspect · Review');
    expect(reminderText(input)).toBe([
      '<system-reminder>Intent run contract:', 'Goal chain: Legacy review',
      'Final deliverable: Reviewed note', 'Active stage: 1/1 Inspect', 'Risk: legacy-risk',
      'Provided sources: b.md | a.md', 'Preferred stage skills: Inspect -> review-skill',
      'Boundary: own scope', 'Latest progress: Read source',
      'Constraints (must follow): first; second</system-reminder>',
    ].join('\n'));
    expect(stripAnsi(formatIntentCreatedTranscriptBlock(input, 'selected')))
      .toBe('🤝 已理解，会帮你产出Reviewed note。\n来源：b.md | a.md\n边界：own scope\n');
    expect(input).toEqual(before);
  });
  it('retains lexical step-key fallback for a future/review name', () => {
    expect(stripAnsi(formatProgressTranscriptBlock({
      stepId: 'intent:step:future_review', status: 'running', message: 'kept',
    }))).toContain('Future Review · Running');
  });
  it('does not validate inactive/terminal data or other-owner display fields', () => {
    const bad = ledger(record({ overallStatus: {}, stages: 77, deliverable: false }));
    expect(formatCurrentIntentSummaryLine(bad, 'other')).toBe('');
    expect(buildIntentReminderBlock(bad, 'other')).toBeUndefined();
    expect(formatIntentCreatedTranscriptBlock(bad, 'missing')).toBe('');
    const terminal = ledger(record({ overallStatus: 'completed', stages: 77 }));
    expect(formatCurrentIntentSummaryLine(terminal, 'owner')).toBe('');
    expect(buildIntentReminderBlock(terminal, 'owner')).toBeUndefined();
  });
  it('created presenter needs no ownership and checks only the selected display fields', () => {
    const selected = record({ overallStatus: 17, riskTier: {}, stages: [
      { stageId: 's1', order: 'not-read', label: 'First' },
      { stageId: 's2', order: null, label: 'Second' },
    ] });
    expect(stripAnsi(formatIntentCreatedTranscriptBlock({ intents: [selected] }, 'selected')))
      .toBe('🤝 已理解，会先First，再Second。\n来源：b.md | a.md\n边界：own scope\n');
  });
  it('summary reads only the selected stage order/label, not an unmatched stage payload', () => {
    const input = ledger(record({ stages: [
      { stageId: 'other', order: {}, label: 17 },
      { stageId: 's1', order: 2, label: 'Selected' },
    ] }));
    expect(stripAnsi(formatCurrentIntentSummaryLine(input, 'owner')))
      .toContain('Stage 3/2 Selected');
  });
  it('keeps the preexisting display-only fallback without writing synthetic stages', () => {
    const input = ledger(record({ stages: [], activeStageId: undefined }));
    const before = structuredClone(input);
    expect(stripAnsi(formatCurrentIntentSummaryLine(input, 'owner')))
      .toContain('Stage 1/1 生成Reviewed note');
    expect(input).toEqual(before);
  });
  it.each([
    { order: NaN, expected: 'Stage NaN/1' },
    { order: Infinity, expected: 'Stage Infinity/1' },
    { order: -Infinity, expected: 'Stage -Infinity/1' },
    { order: -1, expected: 'Stage 0/1' },
    { order: 0.5, expected: 'Stage 1.5/1' },
  ])('retains original number arithmetic: $expected', ({ order, expected }) => {
    expect(stripAnsi(formatCurrentIntentSummaryLine(ledger(record({
      stages: [{ stageId: 's1', order, label: 'Number' }],
    })), 'owner'))).toContain(expected);
  });
  it.each([null, undefined])('retains nullish optional path/constraint fallback: %s', value => {
    const input = ledger(record({ providedSourcePaths: value, explicitConstraints: value }));
    const text = reminderText(input);
    expect(text).not.toContain('Provided sources:');
    expect(text).not.toContain('Constraints (must follow):');
  });
  it.each([
    { field: 'deliverable', value: 42, error: 'deliverable' },
    { field: 'finalDeliverable', value: {}, error: 'finalDeliverable' },
    { field: 'riskTier', value: 9, error: 'riskTier' },
    { field: 'providedSourcePaths', value: ['ok', 9], error: 'providedSourcePaths' },
    { field: 'delegationBoundary', value: 5, error: 'delegationBoundary' },
    { field: 'explicitConstraints', value: ['ok', false], error: 'explicitConstraints' },
    { field: 'latestBreadcrumb', value: 3, error: 'latestBreadcrumb' },
  ])('rejects the actually used reminder field $field', ({ field, value, error }) => {
    expect(() => reminderText(ledger(record({ [field]: value }))))
      .toThrow(`intent_presentation:${error}`);
  });
  it('rejects a nonstring summary status with an explicit DATA error', () => {
    expect(() => formatCurrentIntentSummaryLine(ledger(record({ overallStatus: 7 })), 'owner'))
      .toThrow('intent_presentation:overallStatus');
  });
  it('rejects string order rather than applying the original JS concatenation', () => {
    expect(() => formatCurrentIntentSummaryLine(ledger(record({
      stages: [{ stageId: 's1', order: '1', label: 'Stage' }],
    })), 'owner')).toThrow('intent_presentation:stage.order');
  });
  it('rejects a nonstring selected stage label', () => {
    expect(() => formatCurrentIntentSummaryLine(ledger(record({
      stages: [{ stageId: 's1', order: 0, label: 9 }],
    })), 'owner')).toThrow('intent_presentation:stage.label');
  });
  it('rejects a nonarray stage collection instead of silently fabricating display data', () => {
    expect(() => formatCurrentIntentSummaryLine(ledger(record({ stages: {} })), 'owner'))
      .toThrow('intent_presentation:stages');
  });
  it('does not validate status/order for the single-stage acknowledgement when unused', () => {
    const input = { intents: [record({ overallStatus: {}, stages: [{ stageId: 's1', order: 'unused' }] })] };
    expect(stripAnsi(formatIntentCreatedTranscriptBlock(input, 'selected'))).toContain('Reviewed note');
  });
  it('preserves the original summary-only nullish label fallback and rejects it when reminder actually interpolates it', () => {
    const input = ledger(record({ stages: [{ stageId: 's1', order: 0, label: null, steps: [] }] }));
    expect(stripAnsi(formatCurrentIntentSummaryLine(input, 'owner'))).toContain('Stage 1/1 Waiting');
    expect(() => reminderText(input)).toThrow('intent_presentation:stage.label');
  });
  it('rejects a nonstring id only when the existing fallback interpolates that id', () => {
    const input: IntentPresentationLedgerData = {
      ...ledger(), activeIntentId: 7,
      intents: [record({ intentId: 7, activeStageId: undefined, stages: [] })],
    };
    expect(() => formatCurrentIntentSummaryLine(input, 'owner')).toThrow('intent_presentation:intentId');
  });
});

// Original legacy DATA values from tests/ai/runtime/session-store.test.ts:617–717.
// No stages/finalDeliverable/intentMode/confidence fields are supplied here.
function originalPrimaryLegacyRecord(): StoredIntentRecordInput {
  return {
    intentId: 'intent_nested', instanceId: 'inst_nested', sessionId: 'sess_nested',
    rawIntent: 'Write summary', normalizedIntent: 'write summary', intentType: 'generate',
    deliverable: 'summary', explicitConstraints: [], delegationBoundary: [], riskTier: 'medium',
    templateId: 'tpl_generate', steps: [{
      stepId: 'intent_nested:step:collect', key: 'collect', order: 0, role: 'collect',
      skillName: null, dependsOn: [], status: 'planned', riskTier: 'medium',
    }],
    activeStepId: 'intent_nested:step:collect', overallStatus: 'drafting_plan',
    attemptCount: 1, createdAt: 100, updatedAt: 200,
  };
}
function originalSecondaryLegacyRecord(): StoredIntentRecordInput {
  return {
    intentId: 'intent_secondary', instanceId: 'inst_secondary', sessionId: 'sess_nested',
    rawIntent: 'Review summary', normalizedIntent: 'review summary', intentType: 'review',
    deliverable: 'review', explicitConstraints: [], delegationBoundary: [], riskTier: 'low',
    templateId: 'tpl_review', steps: [{
      stepId: 'intent_secondary:step:review', key: 'review', order: 0, role: 'review',
      skillName: null, dependsOn: [], status: 'planned', riskTier: 'low',
    }],
    activeStepId: 'intent_secondary:step:review', overallStatus: 'drafting_plan',
    attemptCount: 1, createdAt: 120, updatedAt: 200,
  };
}
function originalMissingLegacyLedger(): StoredSessionIntentLedgerInput {
  return {
    instanceId: 'inst_nested', sessionId: 'sess_nested', activeIntentId: 'intent_nested',
    latestPlan: originalPrimaryLegacyRecord(),
    intents: [originalPrimaryLegacyRecord(), originalSecondaryLegacyRecord()],
    breadcrumbs: [], receipt: null, salvage: null,
    ownership: { state: 'released', previousOwnerInstanceId: 'inst_nested', updatedAt: 200 },
    updatedAt: 200,
  };
}
// Direct presenter DATA: all other fields the real reminder reads are valid.
// finalDeliverable is absent; no record() helper pre-fills a Modern default.
function directMissingFinalPresenterData() {
  const selected: IntentPresentationRecordData = {
    intentId: 'direct_legacy', deliverable: 'Legacy note', overallStatus: 'review',
    activeStageId: 'legacy_stage', riskTier: 'low',
    stages: [{ stageId: 'legacy_stage', order: 0, label: 'Review', steps: [] }],
    delegationBoundary: [], explicitConstraints: [],
  };
  const input: IntentPresentationLedgerData = {
    activeIntentId: 'direct_legacy', ownership: { ownerInstanceId: 'owner' }, intents: [selected],
  };
  return { selected, input };
}

describe('real reminder missing-final compatibility policy', () => {
  it('rejects directly absent finalDeliverable instead of the old literal undefined reminder', () => {
    const { selected, input } = directMissingFinalPresenterData();
    const before = structuredClone(input);
    expect(Object.hasOwn(selected, 'finalDeliverable')).toBe(false);
    expect(() => buildIntentReminderBlock(input, 'owner'))
      .toThrow(new TypeError('intent_presentation:finalDeliverable'));
    expect(input).toEqual(before);
  });

  it('rejects own undefined finalDeliverable instead of the old literal undefined reminder', () => {
    const base = directMissingFinalPresenterData();
    const selected: IntentPresentationRecordData = { ...base.selected, finalDeliverable: undefined };
    const input: IntentPresentationLedgerData = { ...base.input, intents: [selected] };
    const before = structuredClone(input);
    expect(Object.hasOwn(selected, 'finalDeliverable')).toBe(true);
    expect(selected.finalDeliverable).toBeUndefined();
    expect(() => buildIntentReminderBlock(input, 'owner'))
      .toThrow(new TypeError('intent_presentation:finalDeliverable'));
    expect(input).toEqual(before);
  });

  it('uses the real existing public ledger clone before presenting missing-field legacy records without rewriting review or erasing unselected rows', () => {
    const raw = originalMissingLegacyLedger();
    const before = structuredClone(raw);
    for (const row of raw.intents) {
      expect(Object.hasOwn(row, 'finalDeliverable')).toBe(false);
      expect(Object.hasOwn(row, 'intentMode')).toBe(false);
      expect(Object.hasOwn(row, 'segmentationConfidence')).toBe(false);
      expect(Object.hasOwn(row, 'stages')).toBe(false);
    }
    // Real production entry: no test normalization/default implementation.
    const normalized = cloneSessionIntentLedger(raw);
    expect(raw).toEqual(before);
    expect(normalized.intents).toHaveLength(2);
    expect(normalized.intents.map(row => row.intentId)).toEqual(['intent_nested', 'intent_secondary']);
    expect(normalized.latestPlan?.intentId).toBe('intent_nested');
    expect(normalized.intents[0]?.finalDeliverable).toBe('summary');
    expect(normalized.intents[0]?.intentMode).toBe('single_stage');
    expect(normalized.intents[0]?.segmentationConfidence).toBe('low');
    expect(normalized.intents[0]?.stages[0]?.label).toBe('生成summary');
    expect(normalized.intents[1]?.intentType).toBe('review');
    expect(normalized.intents[1]?.steps[0]?.role).toBe('review');
    expect(normalized.intents[1]?.rawIntent).toBe('Review summary');
    const reminder = buildIntentReminderBlock(normalized, 'inst_nested');
    if (!reminder || reminder.type !== 'text') throw Error('expected_real_normalized_reminder');
    expect(reminder.text).toContain('Final deliverable: summary');
    expect(reminder.text).toContain('Active stage: 1/1 生成summary');
    expect(stripAnsi(formatCurrentIntentSummaryLine(normalized, 'inst_nested')))
      .toContain('Intent: summary · Stage 1/1 生成summary · Drafting Plan');
    // Change only a display selection in a full retained DATA ledger, not a hash,
    // persisted object, Modern claim, producer identity or execution authority.
    const reviewDisplay = { ...normalized, activeIntentId: 'intent_secondary' };
    const reviewReminder = buildIntentReminderBlock(reviewDisplay, 'inst_nested');
    if (!reviewReminder || reviewReminder.type !== 'text') throw Error('expected_real_review_reminder');
    expect(reviewReminder.text).toContain('Goal chain: review');
    expect(reviewReminder.text).toContain('Final deliverable: review');
    expect(reviewReminder.text).toContain('Active stage: 1/1 生成review');
    expect(reviewDisplay.intents).toBe(normalized.intents);
    expect(normalized.activeIntentId).toBe('intent_nested');
    expect(raw).toEqual(before);
  });
});
