import type {RuntimeEvent} from '../events.js';

type IntentEventType = 'intent_created' | 'stage_activated' | 'step_activated' | 'artifact_recorded' | 'breadcrumb_emitted' | 'receipt_emitted' | 'salvage_emitted';
export type IntentDataEvent = Extract<RuntimeEvent, {type: IntentEventType}>;
export interface UncheckedIntentEvent {
  readonly type: IntentEventType;
  readonly [key: string]: unknown;
}
const fail: (field: string) => never = (field: string): never => { throw Error(`intent_runtime_event_data:${field}`); };
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(field);
  return value;
}
function number(value: unknown, field: string): number {
  // Public event fields promise number, not a new safe-integer/order policy.
  if (typeof value !== 'number') fail(field);
  return value;
}
function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}
function summary(value: unknown): string[] {
  if (!Array.isArray(value)) fail('summary');
  const entries: readonly unknown[] = value, result: string[] = [];
  for (let index = 0; index < entries.length; index += 1) result.push(text(entries[index], 'summary'));
  return result;
}

/** Public event DATA only. Never accepts a whole ledger or supplies a producer/SDK grant. */
export function checkIntentEvent(event: UncheckedIntentEvent): IntentDataEvent {
  const common = {sessionId: text(event.sessionId, 'sessionId'), turnId: text(event.turnId, 'turnId')};
  switch (event.type) {
    case 'intent_created': {
      const intentId = text(event.intentId, 'intentId'), templateId = text(event.templateId, 'templateId'), deliverable = text(event.deliverable, 'deliverable');
      const riskTier = event.riskTier;
      if (riskTier !== 'low' && riskTier !== 'medium' && riskTier !== 'high') fail('riskTier');
      return {type: 'intent_created', ...common, intentId, templateId, deliverable, riskTier};
    }
    case 'stage_activated':
      return {type: 'stage_activated', ...common, intentId: text(event.intentId, 'intentId'), stageId: text(event.stageId, 'stageId'), label: text(event.label, 'label'), order: number(event.order, 'order'), totalStages: number(event.totalStages, 'totalStages')};
    case 'step_activated':
      return {type: 'step_activated', ...common, intentId: text(event.intentId, 'intentId'), stepId: text(event.stepId, 'stepId')};
    case 'breadcrumb_emitted': {
      const intentId = text(event.intentId, 'intentId'), stepId = text(event.stepId, 'stepId'), status = event.status;
      if (status !== 'running' && status !== 'blocked' && status !== 'completed' && status !== 'failed') fail('status');
      return {type: 'breadcrumb_emitted', ...common, intentId, stepId, status, message: text(event.message, 'message')};
    }
    case 'receipt_emitted':
      return {type: 'receipt_emitted', ...common, intentId: text(event.intentId, 'intentId'), stepId: text(event.stepId, 'stepId'), note: text(event.note, 'note')};
    case 'salvage_emitted':
      return {type: 'salvage_emitted', ...common, intentId: text(event.intentId, 'intentId'), summary: summary(event.summary), ...(Object.hasOwn(event, 'reason') ? {reason: optionalText(event.reason, 'reason')} : {})};
    case 'artifact_recorded':
      return {type: 'artifact_recorded', ...common, intentId: text(event.intentId, 'intentId'), stageId: text(event.stageId, 'stageId'), artifactId: text(event.artifactId, 'artifactId'), label: text(event.label, 'label'), kind: text(event.kind, 'kind'), ...(Object.hasOwn(event, 'path') ? {path: optionalText(event.path, 'path')} : {}), ...(Object.hasOwn(event, 'creator') ? {creator: optionalText(event.creator, 'creator')} : {}), ...(Object.hasOwn(event, 'mimeType') ? {mimeType: optionalText(event.mimeType, 'mimeType')} : {})};
    default:
      return fail('type');
  }
}
