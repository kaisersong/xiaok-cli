export type MaterialRole = 'customer_material' | 'product_material' | 'template_material' | 'unknown';
export type MaterialRoleSource = 'user' | 'auto';
export type MaterialParseStatus = 'pending' | 'parsed' | 'unsupported' | 'failed';

export interface MaterialRecord {
  materialId: string;
  taskId: string;
  originalName: string;
  workspacePath: string;
  extractedTextPath?: string;
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

export type ArtifactKind = 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'html' | 'image' | 'text' | 'a2ui' | 'other';

export interface ArtifactSummary {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  previewAvailable: boolean;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceMaterialIds?: string[];
  creator?: string; // e.g. "agent", "skill:report", "tool:Write"
}

export interface TaskResult {
  summary: string;
  artifacts: ArtifactSummary[];
  structuredOutput?: Record<string, unknown>;
  assumptions?: string[];
  nextSteps?: string[];
  degraded?: boolean;
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
  | { type: 'task_cancelled'; taskId: string; reason: string; partialText?: string }
  | { type: 'result'; result: TaskResult }
  | { type: 'artifact_recorded'; artifactId: string; kind: string; label: string; filePath: string; previewAvailable: boolean; turnId: string; creator?: string; mimeType?: string }
  | { type: 'salvage'; salvage: SalvageSummary }
  | { type: 'error'; message: string }
  // Canvas events (appended, do not replace existing progress events)
  | { type: 'canvas_tool_call'; toolName: string; input: unknown; toolUseId: string; eventId: string; ts?: number; displayInputSummary?: string }
  | { type: 'canvas_tool_result'; toolName: string; toolUseId: string; ok: boolean; response: string; eventId: string; ts?: number }
  | { type: 'canvas_file_changed'; filePath: string; change: 'add' | 'change' | 'unlink'; eventId: string }
  // TaskPanel progress (from report_progress tool)
  | { type: 'progress_plan_reported'; steps: PlanStep[] };

export type TaskSnapshotStatus = 'understanding' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';
export type TaskPermissionMode = 'plan' | 'auto' | 'default';
export type TaskContextSkipReason = 'missing' | 'invalid' | 'non_terminal' | 'self' | 'too_old';

export interface TaskCreateContext {
  threadId?: string;
  taskIds?: string[];
}

export interface TaskContextSkip {
  taskId: string;
  reason: TaskContextSkipReason;
}

export interface TaskContextAudit {
  threadId?: string;
  taskIds: string[];
  loadedTaskIds: string[];
  skipped: TaskContextSkip[];
}

export interface TaskCreateInput {
  prompt: string;
  materials: Array<{ materialId: string; role?: MaterialRole }>;
  permissionMode?: TaskPermissionMode;
  watchdogMs?: number;
  maxToolLoopIterations?: number;
  context?: TaskCreateContext;
}

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
  context?: TaskContextAudit;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveTaskRef {
  taskId: string;
}

export interface TaskRuntimeHost {
  createTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  subscribeTask(taskId: string, options?: { sinceIndex?: number }): AsyncIterable<DesktopTaskEvent>;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
  getActiveTasks(): Promise<ActiveTaskRef[]>;
  /** @deprecated Use getActiveTasks() */
  getActiveTask(): Promise<ActiveTaskRef | null>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
}
