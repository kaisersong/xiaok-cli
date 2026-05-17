import type { MessageBlock } from '../types.js';
import type { SessionIntentLedger } from '../runtime/intent-delegation/types.js';
export declare function formatCurrentIntentSummaryLine(ledger: SessionIntentLedger | null | undefined, instanceId: string): string;
export declare function formatCurrentTurnIntentSummaryLine(input: {
    deliverable: string;
    stageOrder: number;
    totalStages: number;
    stageLabel: string;
    skillNames?: string[];
    status: string;
}): string;
export declare function buildIntentReminderBlock(ledger: SessionIntentLedger | null | undefined, instanceId: string): MessageBlock | undefined;
export declare function formatIntentCreatedTranscriptBlock(ledger: SessionIntentLedger | null | undefined, intentId: string): string;
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
