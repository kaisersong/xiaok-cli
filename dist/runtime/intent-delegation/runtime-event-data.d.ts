import type { RuntimeEvent } from '../events.js';
type IntentEventType = 'intent_created' | 'stage_activated' | 'step_activated' | 'artifact_recorded' | 'breadcrumb_emitted' | 'receipt_emitted' | 'salvage_emitted';
export type IntentDataEvent = Extract<RuntimeEvent, {
    type: IntentEventType;
}>;
export interface UncheckedIntentEvent {
    readonly type: IntentEventType;
    readonly [key: string]: unknown;
}
/** Public event DATA only. Never accepts a whole ledger or supplies a producer/SDK grant. */
export declare function checkIntentEvent(event: UncheckedIntentEvent): IntentDataEvent;
export {};
