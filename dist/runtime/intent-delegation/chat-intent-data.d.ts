import type { IntentPlanDraft } from '../../ai/intent-delegation/types.js';
import type { StoredIntentRecordInput } from './stored-intent-clone.js';
export interface NativeLookupRowData {
    readonly intentId?: unknown;
    readonly subjects?: unknown;
    readonly originalDraft?: unknown;
}
interface SubjectLookupData {
    readonly attempts: {
        readonly phase?: unknown;
    }[];
}
export declare function readNativeLookupRows(value: unknown): NativeLookupRowData[] | undefined;
export declare function readNativeJournalLength(value: unknown): number | undefined;
export declare function readNativeLookupSubjects(value: unknown): SubjectLookupData[];
export declare function readNativeOriginalIntent(value: unknown): string;
export declare function readIntentText(value: unknown, field: string): string;
export declare function assertContinuationPlanData(record: StoredIntentRecordInput): asserts record is StoredIntentRecordInput & Omit<IntentPlanDraft, 'continuationMode'>;
export declare function readActiveIntentPlanningData(value: {
    intentId: string;
    deliverable: string;
    intentType: unknown;
    templateId: unknown;
}): {
    intentId: string;
    deliverable: string;
    intentType: IntentPlanDraft['intentType'];
    templateId: string;
};
export {};
