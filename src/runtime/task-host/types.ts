export type MaterialRole = 'customer_material' | 'product_material' | 'template_material' | 'unknown';
export type MaterialRoleSource = 'user' | 'auto';
export type MaterialParseStatus = 'pending' | 'parsed' | 'unsupported' | 'failed';

export interface MaterialRecord {
  materialId: string;
  taskId: string;
  originalName: string;
  workspacePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  role: MaterialRole;
  roleSource: MaterialRoleSource;
  parseStatus: MaterialParseStatus;
  parseSummary?: string;
  errorMessage?: string;
  createdAt: number;
}

export interface MaterialView {
  materialId: string;
  originalName: string;
  role: MaterialRole;
  parseStatus: MaterialParseStatus;
  parseSummary?: string;
}

export type TaskType = 'sales_deck' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high';
export type PlanStepStatus = 'planned' | 'running' | 'completed' | 'blocked' | 'failed';

export interface PlanStep {
  id: string;
  label: string;
  status: PlanStepStatus;
}

export interface TaskUnderstandingInput {
  materialId: string;
  name: string;
  role: MaterialRole;
  parseStatus: MaterialParseStatus;
  parseSummary?: string;
}

export interface TaskUnderstanding {
  goal: string;
  deliverable: string;
  taskType: TaskType;
  audience: string;
  inputs: TaskUnderstandingInput[];
  missingInfo: string[];
  assumptions: string[];
  riskLevel: RiskLevel;
  suggestedPlan: PlanStep[];
  nextAction: string;
}

export interface NeedsUserQuestion {
  questionId: string;
  taskId: string;
  kind:
    | 'confirm_understanding'
    | 'missing_material'
    | 'material_role_correction'
    | 'assumption_approval'
    | 'freeform';
  prompt: string;
  choices?: Array<{ id: string; label: string }>;
  expectedAttachments?: MaterialRole[];
  staleAfterEventId?: string;
}

export type UserAnswer =
  | { questionId: string; type: 'choice'; choiceId: string }
  | { questionId: string; type: 'text'; text: string }
  | { questionId: string; type: 'materials'; materialIds: string[] }
  | { questionId: string; type: 'role_update'; materialId: string; role: MaterialRole };

export type ArtifactKind = 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'html' | 'image' | 'text' | 'other';

export interface ArtifactSummary {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  previewAvailable: boolean;
  sizeBytes?: number;
  sourceMaterialIds?: string[];
}

export interface TaskResult {
  summary: string;
  artifacts: ArtifactSummary[];
  assumptions?: string[];
  nextSteps?: string[];
}

export interface SalvageSummary {
  summary: string[];
  reason?: string;
}

export type DesktopTaskEvent =
  | { type: 'task_started'; taskId: string }
  | { type: 'understanding_updated'; understanding: TaskUnderstanding }
  | { type: 'plan_updated'; plan: PlanStep[] }
  | { type: 'progress'; message: string; stage?: string; eventId: string }
  | { type: 'assistant_delta'; delta: string; eventId: string }
  | { type: 'needs_user'; question: NeedsUserQuestion }
  | { type: 'result'; result: TaskResult }
  | { type: 'salvage'; salvage: SalvageSummary }
  | { type: 'error'; message: string };

export type TaskSnapshotStatus = 'understanding' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

export interface TaskSnapshot {
  taskId: string;
  sessionId: string;
  status: TaskSnapshotStatus;
  prompt: string;
  materials: MaterialView[];
  events: DesktopTaskEvent[];
  understanding?: TaskUnderstanding;
  result?: TaskResult;
  salvage?: SalvageSummary;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveTaskRef {
  taskId: string;
}

export interface TaskRuntimeHost {
  createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  subscribeTask(taskId: string): AsyncIterable<DesktopTaskEvent>;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getActiveTask(): Promise<ActiveTaskRef | null>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
}
