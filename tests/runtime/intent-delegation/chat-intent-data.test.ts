import { describe, it, expect } from 'vitest';
import {
  readNativeLookupRows, readNativeJournalLength, readNativeLookupSubjects,
  readNativeOriginalIntent, readIntentText, assertContinuationPlanData,
  readActiveIntentPlanningData,
} from '../../../src/runtime/intent-delegation/chat-intent-data.js';
import type { StoredIntentRecordInput } from '../../../src/runtime/intent-delegation/stored-intent-clone.js';

// Scripted public DATA only; not a registered task/contract, SDK or execution grant.
function fixture(): StoredIntentRecordInput {
  const step = { stepId: 's', key: 'k', order: 0, role: 'compose', skillName: null,
    dependsOn: [], status: 'planned', riskTier: 'low' };
  return { intentId: 'i', instanceId: 'unit', sessionId: 'session', rawIntent: 'write',
    normalizedIntent: 'write', intentType: 'generate', deliverable: 'report',
    explicitConstraints: [], delegationBoundary: [], riskTier: 'low', templateId: 't',
    steps: [step], activeStepId: 's', overallStatus: 'executing', attemptCount: 0,
    createdAt: 0, updatedAt: 0, finalDeliverable: 'report', intentMode: 'single_stage',
    segmentationConfidence: 'low', activeStageId: 'stage',
    stages: [{ stageId: 'stage', order: 0, label: 'stage', intentType: 'generate',
      deliverable: 'report', templateId: 't', riskTier: 'low', dependsOnStageIds: [], steps: [step] }] };
}
describe('Raw Chat public DATA reads', () => {
  it.each([{value: undefined}, {value: null}])('preserves absent native journal %#', ({value}) => {
    expect(readNativeLookupRows(value)).toBeUndefined();
    expect(readNativeJournalLength(value)).toBeUndefined();
  });
  it.each([{value: []}, {value: [{intentId: 'i'}]}])('keeps original rows and length %#', ({value}) => {
    expect(readNativeLookupRows(value)).toBe(value);
    expect(readNativeJournalLength(value)).toBe(value.length);
  });
  it.each([{value: {}}, {value: 'x'}, {value: 1}, {value: false}])('rejects nonarray journal %#', ({value}) => {
    expect(() => readNativeLookupRows(value)).toThrow('intent_chat_data:nativeContracts');
    expect(() => readNativeJournalLength(value)).toThrow('intent_chat_data:nativeContracts');
  });
  it.each([{value: [null]}, {value: [undefined]}, {value: [1]}])('does not turn malformed rows into absent %#', ({value}) => {
    expect(() => readNativeLookupRows(value)).toThrow('intent_chat_data:nativeContract');
  });
  it('does not inspect row properties in the length-only query', () => {
    const value = [{get intentId() { throw Error('not a length read'); }}];
    expect(readNativeJournalLength(value)).toBe(1);
  });
  it('returns the same subject and attempts containers', () => {
    const value = [{attempts: [{phase: 'enrolled'}]}];
    expect(readNativeLookupSubjects(value)).toBe(value);
    expect(readNativeLookupSubjects(value)[0].attempts).toBe(value[0].attempts);
  });
  it.each([{value: undefined}, {value: {}}, {value: [null]},
    {value: [{attempts: null}]}, {value: [{attempts: [null]}]}])('rejects malformed selected subjects %#', ({value}) => {
    expect(() => readNativeLookupSubjects(value)).toThrow();
  });
  it('only reads original draft text and does not validate/issue a contract', () => {
    expect(readNativeOriginalIntent({rawIntent: 'original', arbitraryHistory: {review: true}})).toBe('original');
    expect(() => readNativeOriginalIntent({rawIntent: 3})).toThrow('originalDraft.rawIntent');
  });
  it('preserves the actual string receipt value', () => {
    expect(readIntentText('', 'receipt')).toBe('');
    expect(readIntentText('same', 'receipt')).toBe('same');
    expect(() => readIntentText(1, 'receipt')).toThrow('receipt');
  });
  it('validates the public plan subset while preserving unknown history and reference identity', () => {
    const record = fixture(); record.producerReports = {future: 'retained'};
    const stages = record.stages, steps = record.steps, reports = record.producerReports;
    assertContinuationPlanData(record);
    expect(record.stages).toBe(stages); expect(record.steps).toBe(steps);
    expect(record.producerReports).toBe(reports);
  });
  it.each([
    {change: (r: StoredIntentRecordInput) => { r.intentType = 'review'; }},
    {change: (r: StoredIntentRecordInput) => { r.intentMode = 'future'; }},
    {change: (r: StoredIntentRecordInput) => { r.segmentationConfidence = {}; }},
    {change: (r: StoredIntentRecordInput) => { r.finalDeliverable = 1; }},
    {change: (r: StoredIntentRecordInput) => { r.stages = undefined; }},
    {change: (r: StoredIntentRecordInput) => { r.steps[0].role = 'review'; }},
  ])('rejects rather than remaps malformed selected plan %#', ({change}) => {
    const record = fixture(); change(record); const before = structuredClone(record);
    expect(() => assertContinuationPlanData(record)).toThrow('intent_chat_data:continuationPlan');
    expect(record).toEqual(before);
  });
  it('preserves an explicitly empty stage list; no legacy fallback is invented', () => {
    const record = fixture(); record.stages = []; assertContinuationPlanData(record);
    expect(record.stages).toEqual([]);
  });
  it('projects exactly the original planner four fields without Modern/authority', () => {
    const value = {intentId: 'i', deliverable: 'report', intentType: 'generate', templateId: 't', unrelated: 'retained only on original'};
    expect(readActiveIntentPlanningData(value)).toEqual({intentId: 'i', deliverable: 'report', intentType: 'generate', templateId: 't'});
    expect(value.unrelated).toBe('retained only on original');
  });
  it.each([{intentType: 'review', templateId: 't'}, {intentType: 'generate', templateId: 1}])('does not invent planner defaults %#', (fields) => {
    expect(() => readActiveIntentPlanningData({intentId: 'i', deliverable: 'report', ...fields})).toThrow('activeIntentPlanning');
  });
});
