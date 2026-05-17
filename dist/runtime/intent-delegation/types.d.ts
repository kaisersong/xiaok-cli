import type { IntentLedgerRecord, IntentPlanDraft, IntentStageDraft, IntentStageRecord, PlannedStep, RiskTier, StageArtifactRecord, StepStatus } from '../../ai/intent-delegation/types.js';
export type { IntentLedgerRecord, IntentPlanDraft, IntentStageDraft, IntentStageRecord, PlannedStep, RiskTier, StageArtifactRecord, StepStatus, };
export type SessionOwnershipState = 'owned' | 'released' | 'resume' | 'takeover';
export interface SessionOwnershipRecord {
    state: SessionOwnershipState;
    ownerInstanceId?: string;
    previousOwnerInstanceId?: string;
    updatedAt: number;
}
export interface IntentBreadcrumb {
    intentId: string;
    stepId: string;
    status: Extract<StepStatus, 'running' | 'blocked' | 'completed' | 'failed'>;
    message: string;
    createdAt: number;
}
export interface IntentReceipt {
    intentId: string;
    stepId: string;
    note: string;
    createdAt: number;
}
export interface IntentSalvage {
    intentId: string;
    summary: string[];
    reason?: string;
    createdAt: number;
}
export interface SessionIntentLedger {
    instanceId?: string;
    sessionId: string;
    activeIntentId?: string;
    latestPlan: IntentLedgerRecord | null;
    intents: IntentLedgerRecord[];
    breadcrumbs: IntentBreadcrumb[];
    receipt: IntentReceipt | null;
    salvage: IntentSalvage | null;
    ownership: SessionOwnershipRecord;
    updatedAt: number;
}
export interface UpdateIntentLedgerPatch {
    overallStatus?: IntentLedgerRecord['overallStatus'];
    blockedReason?: string | undefined;
    latestBreadcrumb?: string | undefined;
    latestReceipt?: string | undefined;
    salvageSummary?: string[] | undefined;
    activeStageId?: string;
    activeStepId?: string;
    attemptCount?: number;
    stages?: IntentStageRecord[];
    artifacts?: StageArtifactRecord[];
    steps?: PlannedStep[];
}
export interface RecordBreadcrumbInput {
    intentId: string;
    stepId: string;
    status: IntentBreadcrumb['status'];
    message: string;
    createdAt?: number;
}
export interface RecordReceiptInput {
    intentId: string;
    stepId: string;
    note: string;
    createdAt?: number;
}
export interface RecordSalvageInput {
    intentId: string;
    summary: string[];
    reason?: string;
    createdAt?: number;
}
export interface TakeoverSessionOptions {
    now?: number;
    confirmHighRisk?: boolean;
}
export declare function createIntentLedgerRecord(plan: IntentPlanDraft, now?: number): IntentLedgerRecord;
export declare function cloneIntentRecord(record: IntentLedgerRecord): IntentLedgerRecord;
export declare function cloneSessionIntentLedger(ledger: SessionIntentLedger): SessionIntentLedger;
export declare function rekeySessionIntentLedger(ledger: SessionIntentLedger, sessionId: string): SessionIntentLedger;
export declare function createEmptySessionIntentLedger(sessionId: string, now?: number): SessionIntentLedger;
export declare function resolveActiveRiskTier(ledger: SessionIntentLedger): RiskTier | null;
