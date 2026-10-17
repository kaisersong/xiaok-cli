import type { IntentLedgerRecord, PlannedStep } from '../../ai/intent-delegation/types.js';
import type { IntentLedgerRecordInput, SessionIntentLedger } from './types.js';

// Storage shapes describe the fields the existing clone consumes, not execution admission.
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

// Required outer keys do not claim that preserved stored enums or supplied stages are modern.
export interface NormalizedStoredIntentRecord extends Omit<StoredIntentRecordInput,
  'finalDeliverable' | 'intentMode' | 'segmentationConfidence' | 'stages' | 'activeStageId'
  | 'executionTerminals' | 'providedSourcePaths' | 'artifacts' | 'salvageSummary'> {
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
  salvage: { summary: string[] } | null;
  ownership: { state?: unknown; ownerInstanceId?: unknown; previousOwnerInstanceId?: unknown; updatedAt?: unknown };
  updatedAt: number;
  verificationExecutions?: unknown;
  publicationCandidates?: unknown;
  nativeContracts?: unknown;
}

export interface NormalizedStoredSessionIntentLedger extends Omit<StoredSessionIntentLedgerInput, 'latestPlan' | 'intents'> {
  latestPlan: NormalizedStoredIntentRecord | null;
  intents: NormalizedStoredIntentRecord[];
}

// A data observation only: false is not proof of modern shape, authority or executable admission.
export function hasStoredReviewValue(ledger: StoredSessionIntentLedgerInput): boolean {
  const records = [...ledger.intents, ...(ledger.latestPlan ? [ledger.latestPlan] : [])];
  return records.some(record => record.intentType === 'review'
    || record.steps.some(step => step.role === 'review')
    || record.stages?.some(stage => stage.intentType === 'review'
      || stage.steps.some(step => step.role === 'review')));
}

// Public DATA projections only; a spread clone never promises a caller's class or nominal identity.
export function cloneIntentSteps(steps: PlannedStep[]): PlannedStep[];
export function cloneIntentSteps(steps: StoredStepInput[]): StoredStepInput[];
export function cloneIntentSteps(steps: StoredStepInput[]): StoredStepInput[] {
  return steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] }));
}

function cloneStoredStages(stages: StoredStageInput[] | null | undefined, legacyRecord: {
  intentId: string; intentType: unknown; deliverable: unknown; templateId: unknown;
  riskTier: unknown; steps: StoredStepInput[]; activeStepId: unknown;
}): StoredStageInput[] {
  const effectiveStages = stages && stages.length > 0
    ? stages
    : [{
        stageId: `${legacyRecord.intentId}:stage:1`,
        order: 0,
        label: `生成${legacyRecord.deliverable}`,
        intentType: legacyRecord.intentType,
        deliverable: legacyRecord.deliverable,
        templateId: legacyRecord.templateId,
        riskTier: legacyRecord.riskTier,
        dependsOnStageIds: [],
        steps: legacyRecord.steps,
        status: 'planned',
        activeStepId: legacyRecord.activeStepId,
        structuralValidation: 'pending',
        semanticValidation: 'pending',
        needsFreshContextHandoff: false,
      }];
  return effectiveStages.map((stage) => ({
    ...stage,
    dependsOnStageIds: [...stage.dependsOnStageIds],
    steps: cloneIntentSteps(stage.steps),
  }));
}

export function cloneStoredIntentRecord(record: IntentLedgerRecordInput): IntentLedgerRecord;
export function cloneStoredIntentRecord(record: StoredIntentRecordInput): NormalizedStoredIntentRecord;
export function cloneStoredIntentRecord(record: StoredIntentRecordInput): NormalizedStoredIntentRecord {
  const stages = cloneStoredStages(record.stages, {
    intentId: record.intentId,
    intentType: record.intentType,
    deliverable: record.finalDeliverable || record.deliverable,
    templateId: record.templateId,
    riskTier: record.riskTier,
    steps: record.steps,
    activeStepId: record.activeStepId,
  });
  const activeStageId = record.activeStageId ?? stages[0]?.stageId ?? `${record.intentId}:stage:1`;
  return {
    ...record,
    executionTerminals: record.executionTerminals?.map(terminal => ({ ...terminal })),
    providedSourcePaths: [...(record.providedSourcePaths ?? [])],
    explicitConstraints: [...record.explicitConstraints],
    delegationBoundary: [...record.delegationBoundary],
    finalDeliverable: record.finalDeliverable ?? record.deliverable,
    intentMode: record.intentMode ?? (stages.length > 1 ? 'multi_stage' : 'single_stage'),
    segmentationConfidence: record.segmentationConfidence ?? (stages.length > 1 ? 'medium' : 'low'),
    stages,
    activeStageId,
    artifacts: record.artifacts?.map(artifact => ({ ...artifact })),
    steps: cloneIntentSteps(record.steps),
    salvageSummary: record.salvageSummary ? [...record.salvageSummary] : undefined,
  };
}

export function cloneStoredSessionIntentLedger(ledger: SessionIntentLedger): SessionIntentLedger;
export function cloneStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput): NormalizedStoredSessionIntentLedger;
export function cloneStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput): NormalizedStoredSessionIntentLedger {
  return {
    ...ledger,
    ...(ledger.verificationExecutions === undefined ? {} : { verificationExecutions: structuredClone(ledger.verificationExecutions) }),
    ...(ledger.publicationCandidates === undefined ? {} : { publicationCandidates: structuredClone(ledger.publicationCandidates) }),
    ...(ledger.nativeContracts === undefined ? {} : { nativeContracts: structuredClone(ledger.nativeContracts) }),
    latestPlan: ledger.latestPlan ? cloneStoredIntentRecord(ledger.latestPlan) : null,
    intents: ledger.intents.map(record => cloneStoredIntentRecord(record)),
    breadcrumbs: ledger.breadcrumbs.map(entry => ({ ...entry })),
    receipt: ledger.receipt ? { ...ledger.receipt } : null,
    salvage: ledger.salvage ? { ...ledger.salvage, summary: [...ledger.salvage.summary] } : null,
    ownership: { ...ledger.ownership },
  };
}

export function rekeyStoredSessionIntentLedger(ledger: SessionIntentLedger, sessionId: string): SessionIntentLedger;
export function rekeyStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput, sessionId: string): NormalizedStoredSessionIntentLedger;
export function rekeyStoredSessionIntentLedger(ledger: StoredSessionIntentLedgerInput, sessionId: string): NormalizedStoredSessionIntentLedger {
  const cloned = cloneStoredSessionIntentLedger(ledger);
  return {
    ...cloned,
    sessionId,
    latestPlan: cloned.latestPlan ? { ...cloned.latestPlan, sessionId } : null,
    intents: cloned.intents.map(intent => ({ ...intent, sessionId })),
  };
}
