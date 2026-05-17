import type { IntentLedgerRecord, StageArtifactRecord, StepStatus } from './types.js';
import { createIntentLedgerRecord as createIntentLedgerRecordFromPlan } from './types.js';
export declare function createIntentLedgerRecord(plan: Parameters<typeof createIntentLedgerRecordFromPlan>[0], now?: number): IntentLedgerRecord;
export declare function activateIntentStep(intent: IntentLedgerRecord, stepId: string, now?: number): IntentLedgerRecord;
export declare function applyIntentStepUpdate(intent: IntentLedgerRecord, input: {
    stepId: string;
    status: Extract<StepStatus, 'running' | 'blocked' | 'completed' | 'failed'>;
    now?: number;
}): IntentLedgerRecord;
export declare function recordStageArtifact(intent: IntentLedgerRecord, artifact: StageArtifactRecord, now?: number): IntentLedgerRecord;
