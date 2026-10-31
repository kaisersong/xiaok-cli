import type { IntentLedgerRecord, StageArtifactRecord, StepStatus } from './types.js';
import { createIntentLedgerRecord as createIntentLedgerRecordFromPlan } from './types.js';
import type { StoredIntentRecordInput, NormalizedStoredIntentRecord } from './stored-intent-clone.js';
type IntentStepUpdateDataInput = {
    stepId: string;
    status: Extract<StepStatus, 'running' | 'blocked' | 'completed' | 'failed'>;
    now?: number;
};
export declare function createIntentLedgerRecord(plan: Parameters<typeof createIntentLedgerRecordFromPlan>[0], now?: number): IntentLedgerRecord;
export declare function activateIntentStep(intent: IntentLedgerRecord, stepId: string, now?: number): IntentLedgerRecord;
export declare function activateIntentStep(intent: StoredIntentRecordInput, stepId: string, now?: number): NormalizedStoredIntentRecord;
export declare function applyIntentStepUpdate(intent: IntentLedgerRecord, input: IntentStepUpdateDataInput): IntentLedgerRecord;
export declare function applyIntentStepUpdate(intent: StoredIntentRecordInput, input: IntentStepUpdateDataInput): NormalizedStoredIntentRecord;
export declare function recordStageArtifact(intent: IntentLedgerRecord, artifact: StageArtifactRecord, now?: number): IntentLedgerRecord;
export declare function recordStageArtifact(intent: StoredIntentRecordInput, artifact: StageArtifactRecord, now?: number): NormalizedStoredIntentRecord;
export {};
