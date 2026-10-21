import type { IntentLedgerRecord, PlannedStep } from '../../ai/intent-delegation/types.js';
import type { IntentLedgerRecordInput, SessionIntentLedger } from './types.js';
export interface StoredStepInput {
    dependsOn: string[];
    stepId?: unknown;
    key?: unknown;
    order?: unknown;
    role?: unknown;
    skillName?: unknown;
    status?: unknown;
    riskTier?: unknown;
}
export interface StoredStageInput {
    dependsOnStageIds: string[];
    steps: StoredStepInput[];
    stageId?: unknown;
    order?: unknown;
    label?: unknown;
    intentType?: unknown;
    deliverable?: unknown;
    templateId?: unknown;
    riskTier?: unknown;
    status?: unknown;
    activeStepId?: unknown;
    latestArtifactId?: unknown;
    structuralValidation?: unknown;
    semanticValidation?: unknown;
    needsFreshContextHandoff?: unknown;
}
export interface StoredIntentRecordInput {
    intentId: string;
    instanceId: string;
    sessionId: string;
    rawIntent: string;
    normalizedIntent: string;
    intentType: unknown;
    deliverable: string;
    explicitConstraints: string[];
    delegationBoundary: string[];
    riskTier: unknown;
    templateId: unknown;
    steps: StoredStepInput[];
    activeStepId: unknown;
    overallStatus: unknown;
    attemptCount: number;
    createdAt: number;
    updatedAt: number;
    latestBreadcrumb?: unknown;
    latestReceipt?: unknown;
    blockedReason?: unknown;
    finalDeliverable?: unknown;
    intentMode?: unknown;
    segmentationConfidence?: unknown;
    stages?: StoredStageInput[] | null;
    activeStageId?: unknown;
    producerReports?: unknown;
    executionTerminals?: object[] | null;
    providedSourcePaths?: string[] | null;
    artifacts?: object[] | null;
    salvageSummary?: string[] | null;
}
export interface NormalizedStoredIntentRecord extends Omit<StoredIntentRecordInput, 'finalDeliverable' | 'intentMode' | 'segmentationConfidence' | 'stages' | 'activeStageId' | 'executionTerminals' | 'providedSourcePaths' | 'artifacts' | 'salvageSummary'> {
    finalDeliverable: unknown;
    intentMode: unknown;
    segmentationConfidence: unknown;
    stages: StoredStageInput[];
    activeStageId: unknown;
    executionTerminals?: object[];
    providedSourcePaths?: string[];
    artifacts?: object[];
    salvageSummary?: string[];
}
export interface StoredSessionIntentLedgerInput {
    sessionId: string;
    instanceId?: unknown;
    activeIntentId?: string;
    latestPlan: StoredIntentRecordInput | null;
    intents: StoredIntentRecordInput[];
    breadcrumbs: object[];
    receipt: object | null;
    salvage: {
        summary: string[];
    } | null;
    ownership: {
        state?: unknown;
        ownerInstanceId?: unknown;
        previousOwnerInstanceId?: unknown;
        updatedAt?: unknown;
    };
    updatedAt: number;
    verificationExecutions?: unknown;
    publicationCandidates?: unknown;
    nativeContracts?: unknown;
}
export interface NormalizedStoredSessionIntentLedger extends Omit<StoredSessionIntentLedgerInput, 'latestPlan' | 'intents'> {
    latestPlan: NormalizedStoredIntentRecord | null;
    intents: NormalizedStoredIntentRecord[];
}
export declare function hasStoredReviewValue(ledger: StoredSessionIntentLedgerInput): boolean;
export declare function cloneIntentSteps(steps: PlannedStep[]): PlannedStep[];
export declare function cloneIntentSteps(steps: StoredStepInput[]): StoredStepInput[];
export declare function cloneStoredIntentRecord(record: IntentLedgerRecordInput): IntentLedgerRecord;
export declare function cloneStoredIntentRecord(record: StoredIntentRecordInput): NormalizedStoredIntentRecord;
export declare function cloneStoredSessionIntentLedger(ledger: SessionIntentLedger): SessionIntentLedger;
export declare function cloneStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput): NormalizedStoredSessionIntentLedger;
export declare function rekeyStoredSessionIntentLedger(ledger: SessionIntentLedger, sessionId: string): SessionIntentLedger;
export declare function rekeyStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput, sessionId: string): NormalizedStoredSessionIntentLedger;
