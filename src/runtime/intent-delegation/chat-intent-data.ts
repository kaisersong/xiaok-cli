import type { IntentPlanDraft, IntentStageDraft, PlannedStep } from '../../ai/intent-delegation/types.js';
import type { StoredIntentRecordInput } from './stored-intent-clone.js';

// Public DATA reads only; these checks do not issue execution identity or authority.
export interface NativeLookupRowData {
  readonly intentId?: unknown;
  readonly subjects?: unknown;
  readonly originalDraft?: unknown;
}
interface SubjectLookupData { readonly attempts: { readonly phase?: unknown }[] }
function dataObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fail(field: string): never { throw new TypeError('intent_chat_data:' + field); }
function nativeRows(value: unknown): asserts value is NativeLookupRowData[] {
  if (!Array.isArray(value)) fail('nativeContracts');
  for (let i = 0; i < value.length; i++) if (!dataObject(value[i])) fail('nativeContract');
}
export function readNativeLookupRows(value: unknown): NativeLookupRowData[] | undefined {
  if (value === undefined || value === null) return undefined;
  nativeRows(value); return value;
}
export function readNativeJournalLength(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail('nativeContracts');
  return value.length;
}
function subjectRows(value: unknown): asserts value is SubjectLookupData[] {
  if (!Array.isArray(value)) fail('subjects');
  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i];
    if (!dataObject(row) || !Array.isArray(row.attempts)) fail('subject');
    for (let j = 0; j < row.attempts.length; j++) if (!dataObject(row.attempts[j])) fail('attempt');
  }
}
export function readNativeLookupSubjects(value: unknown): SubjectLookupData[] {
  subjectRows(value); return value;
}
export function readNativeOriginalIntent(value: unknown): string {
  if (!dataObject(value) || typeof value.rawIntent !== 'string') fail('originalDraft.rawIntent');
  return value.rawIntent;
}
export function readIntentText(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(field);
  return value;
}
function strings(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) if (typeof value[i] !== 'string') return false;
  return true;
}
function intentType(value: unknown): value is IntentPlanDraft['intentType'] {
  return value === 'generate' || value === 'revise' || value === 'summarize' || value === 'analyze';
}
function risk(value: unknown): value is IntentPlanDraft['riskTier'] {
  return value === 'low' || value === 'medium' || value === 'high';
}
function step(value: unknown): value is PlannedStep {
  if (!dataObject(value) || typeof value.stepId !== 'string' || typeof value.key !== 'string'
    || typeof value.order !== 'number' || !strings(value.dependsOn)
    || value.skillName !== null && typeof value.skillName !== 'string' || !risk(value.riskTier)) return false;
  const roles: readonly unknown[] = ['collect','inspect_current','normalize','identify_delta','extract','compare','compose','rewrite','structure','conclude','validate','finalize'];
  const statuses: readonly unknown[] = ['planned','running','blocked','completed','skipped','failed'];
  return roles.includes(value.role) && statuses.includes(value.status);
}
function steps(value: unknown): value is PlannedStep[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) if (!step(value[i])) return false;
  return true;
}
function stage(value: unknown): value is IntentStageDraft {
  return dataObject(value) && typeof value.stageId === 'string' && typeof value.order === 'number'
    && typeof value.label === 'string' && intentType(value.intentType) && typeof value.deliverable === 'string'
    && typeof value.templateId === 'string' && risk(value.riskTier) && strings(value.dependsOnStageIds) && steps(value.steps);
}
// Only the public plan subset used by the existing lexical continuation is proved.
// Unknown history, report fields, stage status and the whole ledger remain Raw.
export function assertContinuationPlanData(record: StoredIntentRecordInput): asserts record is StoredIntentRecordInput & Omit<IntentPlanDraft, 'continuationMode'> {
  if (typeof record.instanceId !== 'string' || typeof record.intentId !== 'string' || typeof record.sessionId !== 'string'
    || typeof record.rawIntent !== 'string' || typeof record.normalizedIntent !== 'string'
    || typeof record.deliverable !== 'string' || typeof record.finalDeliverable !== 'string'
    || !intentType(record.intentType) || !risk(record.riskTier) || !risk(record.segmentationConfidence)
    || record.intentMode !== 'single_stage' && record.intentMode !== 'multi_stage'
    || typeof record.templateId !== 'string' || !strings(record.explicitConstraints) || !strings(record.delegationBoundary)
    || record.providedSourcePaths !== undefined && !strings(record.providedSourcePaths) || !steps(record.steps)
    || !Array.isArray(record.stages)) fail('continuationPlan');
  for (let i = 0; i < record.stages.length; i++) if (!stage(record.stages[i])) fail('continuationStage');
}

export function readActiveIntentPlanningData(value: { intentId: string; deliverable: string; intentType: unknown; templateId: unknown }): { intentId: string; deliverable: string; intentType: IntentPlanDraft['intentType']; templateId: string } {
  if (!intentType(value.intentType) || typeof value.templateId !== 'string') fail('activeIntentPlanning');
  return { intentId: value.intentId, deliverable: value.deliverable, intentType: value.intentType, templateId: value.templateId };
}
