export type ActivitySource = 'kswarm' | 'task_host' | 'agent_group' | 'mcp';
export type WorkKind = 'accepted' | 'started' | 'heartbeat' | 'progress' | 'artifact_available' | 'blocked' | 'input_required' | 'completed' | 'failed' | 'cancelled';
export type WorkExecutionState = 'accepted' | 'queued' | 'running' | 'blocked' | 'input_required' | 'completed' | 'failed' | 'cancelled';
export type ReportingPreference = 'normal' | 'critical_only' | 'quiet';
export interface ActivityOrigin { profileId: string; threadId: string; workspaceId: string; actorId: string }
export interface WorkEvent {
  schemaVersion: 1; eventId: string; source: ActivitySource; logicalSourceId: string;
  sourceDataEpoch: string; transportGeneration: number; workId: string; runId?: string;
  sourceSequence?: number; sourceRevision?: string; kind: WorkKind;
  occurredAt?: number; receivedAt: number; businessOutcome?: 'unknown' | 'success' | 'error' | 'cancelled'; summary?: string; evidenceRefs: string[];
  executionStarted?: boolean;
}
export interface WorkBinding {
  operationId: string; watchId: string; source: ActivitySource; logicalSourceId: string;
  sourceDataEpoch: string; workId: string; runId?: string; actualExecutionThreadId?: string;
}
export interface WorkWatch extends WorkBinding {
  origin: ActivityOrigin; status: 'active' | 'stopped'; generation: number;
  preference: ReportingPreference; policyRevision: number; nextReportDueAt: number;
}
export interface WorkProjection {
  watchId: string; executionState: WorkExecutionState; businessOutcome: 'unknown' | 'success' | 'error' | 'cancelled';
  freshness: 'fresh' | 'reconnecting' | 'stale' | 'unavailable'; sourceSequence: number;
  revision: number; lastProgressAt: number | null; lastHeartbeatAt: number | null;
  lastReportAt: number | null; errorCode?: string; summary?: string; evidenceRefs: string[];
}
export interface ConversationActivity {
  activityId: string; localSeq: number; watchId: string; threadId: string;
  kind: WorkKind | 'report' | 'diagnostic'; at: number; projection: WorkProjection;
}
export interface McpInputForm {
  inputId: string; expectedDigest: string; prompt: string;
  fields: Array<{ key: string; title: string; type: 'text' | 'number' | 'boolean' | 'choice' | 'choices'; required: boolean; options?: string[] }>;
}
