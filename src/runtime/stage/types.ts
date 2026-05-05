/**
 * Stage execution types for skill execution with context-aware subagent triggering.
 *
 * A stage is a user-visible step in the intent decomposition
 * (e.g., "generate report", "create slides").
 *
 * Each stage executes a single skill. If context is tight, the
 * stage is delegated to a subagent with clean context.
 */

export interface StageDef {
  id: string;
  title: string;
  skill: string;
  inputFiles?: string[];
}

export interface StageTiming {
  totalMs: number;
  contextCheckMs: number;
  subagentSpawnMs: number;
  subagentExecMs: number;
  skillLoadMs: number;
  skillExecMs: number;
  artifactReadMs: number;
}

export interface DebugEvent {
  timestamp: number;
  phase: string;
  stage?: string;
  detail: string;
  durationMs?: number;
  level: 'info' | 'warn' | 'error';
}

export interface StageResult {
  stage: StageDef;
  status: 'completed' | 'failed' | 'skipped';
  artifactPath?: string;
  timing: StageTiming;
  debugEvents: DebugEvent[];
  error?: string;
  contextCheck?: {
    usagePercent: number;
    estimatedNeeded: number;
    available: number;
    needsSubagent: boolean;
  };
}

export interface StageExecutionResult {
  stages: StageDef[];
  results: StageResult[];
  debugEvents: DebugEvent[];
}

export interface StageOutput {
  stages: StageDef[];
  results: StageResult[];
  debugEvents: DebugEvent[];
}
