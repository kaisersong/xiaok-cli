import type { MessageBlock } from '../types.js';
/** Only the DATA read by the three stored-intent presenters; never Modern or authority. */
export interface IntentPresentationRecordData {
    readonly intentId: unknown;
    readonly deliverable?: unknown;
    readonly finalDeliverable?: unknown;
    readonly overallStatus?: unknown;
    readonly activeStageId?: unknown;
    readonly stages?: unknown;
    readonly steps?: unknown;
    readonly riskTier?: unknown;
    readonly providedSourcePaths?: unknown;
    readonly delegationBoundary?: unknown;
    readonly explicitConstraints?: unknown;
    readonly latestBreadcrumb?: unknown;
}
export interface IntentPresentationLedgerData {
    readonly activeIntentId?: unknown;
    readonly ownership: {
        readonly ownerInstanceId?: unknown;
        readonly previousOwnerInstanceId?: unknown;
    };
    readonly intents: readonly IntentPresentationRecordData[];
}
export declare function formatCurrentIntentSummaryLine(ledger: IntentPresentationLedgerData | null | undefined, instanceId: string): string;
export declare function formatCurrentTurnIntentSummaryLine(input: {
    deliverable: string;
    stageOrder: number;
    totalStages: number;
    stageLabel: string;
    skillNames?: string[];
    status: string;
}): string;
export declare function buildIntentReminderBlock(ledger: IntentPresentationLedgerData | null | undefined, instanceId: string): MessageBlock | undefined;
export declare function formatIntentCreatedTranscriptBlock(ledger: Pick<IntentPresentationLedgerData, 'intents'> | null | undefined, intentId: string): string;
export declare function formatProgressTranscriptBlock(input: {
    stepId: string;
    status: 'running' | 'blocked' | 'completed' | 'failed';
    message: string;
}): string;
export declare function formatStageActivatedTranscriptBlock(input: {
    order: number;
    totalStages: number;
    label: string;
}): string;
export declare function formatIntentStageSummaryTranscriptBlock(input: {
    deliverable: string;
    stages: Array<{
        order: number;
        totalStages: number;
        label: string;
        skillNames?: string[];
        status: string;
    }>;
}): string;
export declare function formatReceiptTranscriptBlock(note: string): string;
export declare function formatSalvageTranscriptBlock(summary: string[], reason?: string): string;
