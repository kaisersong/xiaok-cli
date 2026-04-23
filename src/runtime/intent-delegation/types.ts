import type {
  IntentLedgerRecord,
  IntentPlanDraft,
  IntentStageDraft,
  IntentStageRecord,
  PlannedStep,
  RiskTier,
  StageArtifactRecord,
  StepStatus,
} from '../../ai/intent-delegation/types.js';

export type {
  IntentLedgerRecord,
  IntentPlanDraft,
  IntentStageDraft,
  IntentStageRecord,
  PlannedStep,
  RiskTier,
  StageArtifactRecord,
  StepStatus,
};

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

export function createIntentLedgerRecord(plan: IntentPlanDraft, now = Date.now()): IntentLedgerRecord {
  const stages = cloneStageDrafts(plan.stages, plan);
  const activeStage = stages[0];
  const steps = activeStage ? cloneSteps(activeStage.steps) : cloneSteps(plan.steps);
  return {
    intentId: plan.intentId,
    instanceId: plan.instanceId,
    sessionId: plan.sessionId,
    rawIntent: plan.rawIntent,
    normalizedIntent: plan.normalizedIntent,
    providedSourcePaths: [...(plan.providedSourcePaths ?? [])],
    intentType: plan.intentType,
    deliverable: plan.deliverable,
    finalDeliverable: plan.finalDeliverable,
    explicitConstraints: [...plan.explicitConstraints],
    delegationBoundary: [...plan.delegationBoundary],
    riskTier: plan.riskTier,
    intentMode: plan.intentMode,
    segmentationConfidence: plan.segmentationConfidence,
    templateId: plan.templateId,
    stages,
    activeStageId: activeStage?.stageId ?? `${plan.intentId}:stage:unknown`,
    artifacts: [],
    steps,
    activeStepId: activeStage?.activeStepId ?? steps[0]?.stepId ?? `${plan.intentId}:step:unknown`,
    overallStatus: 'drafting_plan',
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneIntentRecord(record: IntentLedgerRecord): IntentLedgerRecord {
  const stages = cloneStages(
    record.stages,
    {
      intentId: record.intentId,
      intentType: record.intentType,
      deliverable: record.finalDeliverable || record.deliverable,
      templateId: record.templateId,
      riskTier: record.riskTier,
      steps: record.steps,
      activeStepId: record.activeStepId,
    },
  );
  const activeStageId = record.activeStageId ?? stages[0]?.stageId ?? `${record.intentId}:stage:1`;
  return {
    ...record,
    providedSourcePaths: [...(record.providedSourcePaths ?? [])],
    explicitConstraints: [...record.explicitConstraints],
    delegationBoundary: [...record.delegationBoundary],
    finalDeliverable: record.finalDeliverable ?? record.deliverable,
    intentMode: record.intentMode ?? (stages.length > 1 ? 'multi_stage' : 'single_stage'),
    segmentationConfidence: record.segmentationConfidence ?? (stages.length > 1 ? 'medium' : 'low'),
    stages,
    activeStageId,
    artifacts: cloneArtifacts(record.artifacts),
    steps: cloneSteps(record.steps),
    salvageSummary: record.salvageSummary ? [...record.salvageSummary] : undefined,
  };
}

export function cloneSessionIntentLedger(ledger: SessionIntentLedger): SessionIntentLedger {
  return {
    ...ledger,
    latestPlan: ledger.latestPlan ? cloneIntentRecord(ledger.latestPlan) : null,
    intents: ledger.intents.map(cloneIntentRecord),
    breadcrumbs: ledger.breadcrumbs.map((entry) => ({ ...entry })),
    receipt: ledger.receipt ? { ...ledger.receipt } : null,
    salvage: ledger.salvage ? { ...ledger.salvage, summary: [...ledger.salvage.summary] } : null,
    ownership: { ...ledger.ownership },
  };
}

export function rekeySessionIntentLedger(ledger: SessionIntentLedger, sessionId: string): SessionIntentLedger {
  const cloned = cloneSessionIntentLedger(ledger);
  return {
    ...cloned,
    sessionId,
    latestPlan: cloned.latestPlan
      ? {
          ...cloned.latestPlan,
          sessionId,
        }
      : null,
    intents: cloned.intents.map((intent) => ({
      ...intent,
      sessionId,
    })),
  };
}

export function createEmptySessionIntentLedger(sessionId: string, now = Date.now()): SessionIntentLedger {
  return {
    sessionId,
    activeIntentId: undefined,
    latestPlan: null,
    intents: [],
    breadcrumbs: [],
    receipt: null,
    salvage: null,
    ownership: {
      state: 'released',
      updatedAt: now,
    },
    updatedAt: now,
  };
}

export function resolveActiveRiskTier(ledger: SessionIntentLedger): RiskTier | null {
  const activeIntent = ledger.activeIntentId
    ? ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId)
    : undefined;
  if (!activeIntent) {
    return null;
  }

  const activeStage = activeIntent.stages.find((stage) => stage.stageId === activeIntent.activeStageId);
  const activeStep = activeIntent.steps.find((step) => step.stepId === activeIntent.activeStepId)
    ?? activeStage?.steps.find((step) => step.stepId === activeIntent.activeStepId);
  return activeStep?.riskTier ?? activeStage?.riskTier ?? activeIntent.riskTier;
}

function cloneSteps(steps: PlannedStep[]): PlannedStep[] {
  return steps.map((step) => ({
    ...step,
    dependsOn: [...step.dependsOn],
  }));
}

function cloneStageDrafts(
  stages: IntentStageDraft[] | undefined,
  legacyPlan?: Pick<IntentPlanDraft, 'intentId' | 'intentType' | 'deliverable' | 'templateId' | 'riskTier' | 'steps'>,
): IntentStageRecord[] {
  const effectiveStages = stages && stages.length > 0
    ? stages
    : legacyPlan
      ? [{
          stageId: `${legacyPlan.intentId}:stage:1`,
          order: 0,
          label: `生成${legacyPlan.deliverable}`,
          intentType: legacyPlan.intentType,
          deliverable: legacyPlan.deliverable,
          templateId: legacyPlan.templateId,
          riskTier: legacyPlan.riskTier,
          dependsOnStageIds: [],
          steps: legacyPlan.steps,
        } satisfies IntentStageDraft]
      : [];

  return effectiveStages.map((stage) => ({
    ...stage,
    dependsOnStageIds: [...stage.dependsOnStageIds],
    steps: cloneSteps(stage.steps),
    status: 'planned',
    activeStepId: stage.steps[0]?.stepId ?? `${stage.stageId}:step:unknown`,
    structuralValidation: 'pending',
    semanticValidation: 'pending',
    needsFreshContextHandoff: stage.order > 0,
  }));
}

function cloneStages(
  stages: IntentStageRecord[] | undefined,
  legacyRecord?: Pick<IntentLedgerRecord, 'intentId' | 'intentType' | 'deliverable' | 'templateId' | 'riskTier' | 'steps' | 'activeStepId'>,
): IntentStageRecord[] {
  const effectiveStages = stages && stages.length > 0
    ? stages
    : legacyRecord
      ? [{
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
        } satisfies IntentStageRecord]
      : [];

  return effectiveStages.map((stage) => ({
    ...stage,
    dependsOnStageIds: [...stage.dependsOnStageIds],
    steps: cloneSteps(stage.steps),
  }));
}

function cloneArtifacts(artifacts: StageArtifactRecord[] | undefined): StageArtifactRecord[] | undefined {
  return artifacts?.map((artifact) => ({ ...artifact }));
}
