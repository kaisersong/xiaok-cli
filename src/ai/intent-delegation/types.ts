export interface TaskSkillHints {
  taskGoals: string[];
  inputKinds: string[];
  outputKinds: string[];
  examples: string[];
}

export interface TaskSkillMatch {
  skill: {
    name: string;
    description: string;
    whenToUse?: string;
    taskHints: TaskSkillHints;
  };
  score: number;
  reasons: string[];
}

export type IntentType = 'generate' | 'revise' | 'summarize' | 'analyze';

export type RiskTier = 'low' | 'medium' | 'high';

export type IntentMode = 'single_stage' | 'multi_stage';

export type SegmentationConfidence = 'low' | 'medium' | 'high';

export type StepRole =
  | 'collect'
  | 'inspect_current'
  | 'normalize'
  | 'identify_delta'
  | 'extract'
  | 'compare'
  | 'compose'
  | 'rewrite'
  | 'structure'
  | 'conclude'
  | 'validate'
  | 'finalize';

export type StepStatus =
  | 'planned'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface TemplateStep {
  key: string;
  role: StepRole;
  label: string;
  required: boolean;
  defaultRiskTier?: RiskTier;
  fallbackRoles?: StepRole[];
}

export interface DelegationTemplate {
  id: string;
  intentType: IntentType;
  label: string;
  steps: TemplateStep[];
}

export interface PlannedStep {
  stepId: string;
  key: string;
  order: number;
  role: StepRole;
  skillName: string | null;
  dependsOn: string[];
  status: StepStatus;
  riskTier: RiskTier;
}

export type StageStatus =
  | 'planned'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ArtifactKind =
  | 'markdown'
  | 'report'
  | 'slides'
  | 'summary'
  | 'analysis'
  | 'document'
  | 'unknown';

export type ArtifactStorage = 'inline' | 'file_ref';

export type ValidationState = 'pending' | 'passed' | 'failed';

export interface IntentStageDraft {
  stageId: string;
  order: number;
  label: string;
  intentType: IntentType;
  deliverable: string;
  templateId: string;
  riskTier: RiskTier;
  dependsOnStageIds: string[];
  steps: PlannedStep[];
}

export interface IntentStageRecord extends IntentStageDraft {
  status: StageStatus;
  activeStepId: string;
  latestArtifactId?: string;
  structuralValidation: ValidationState;
  semanticValidation: ValidationState;
  needsFreshContextHandoff: boolean;
}

export interface StageArtifactRecord {
  artifactId: string;
  stageId: string;
  kind: ArtifactKind;
  storage: ArtifactStorage;
  label: string;
  path?: string;
  inlineValue?: string;
  summary?: string;
  structuralValidation: ValidationState;
  semanticValidation: ValidationState;
  createdAt: number;
}

export interface IntentPlanDraft {
  instanceId: string;
  intentId: string;
  sessionId: string;
  rawIntent: string;
  normalizedIntent: string;
  providedSourcePaths?: string[];
  intentType: IntentType;
  deliverable: string;
  finalDeliverable: string;
  explicitConstraints: string[];
  delegationBoundary: string[];
  riskTier: RiskTier;
  intentMode: IntentMode;
  segmentationConfidence: SegmentationConfidence;
  templateId: string;
  stages: IntentStageDraft[];
  steps: PlannedStep[];
  continuationMode: 'new_intent' | 'continue_active' | 'clarify';
}

export interface IntentLedgerRecord {
  intentId: string;
  instanceId: string;
  sessionId: string;
  rawIntent: string;
  normalizedIntent: string;
  providedSourcePaths?: string[];
  intentType: IntentType;
  deliverable: string;
  finalDeliverable: string;
  explicitConstraints: string[];
  delegationBoundary: string[];
  riskTier: RiskTier;
  intentMode: IntentMode;
  segmentationConfidence: SegmentationConfidence;
  templateId: string;
  stages: IntentStageRecord[];
  activeStageId: string;
  artifacts?: StageArtifactRecord[];
  steps: PlannedStep[];
  activeStepId: string;
  overallStatus:
    | 'drafting_plan'
    | 'executing'
    | 'waiting_user'
    | 'recovering'
    | 'completed'
    | 'failed'
    | 'cancelled';
  attemptCount: number;
  latestBreadcrumb?: string;
  latestReceipt?: string;
  blockedReason?: string;
  salvageSummary?: string[];
  createdAt: number;
  updatedAt: number;
}
