export interface HarnessOptimizationConfig {
  schemaVersion: 1; enabled: boolean; mode: 'none' | 'probe';
  configRevision: number; publicGeneration: number; researchGeneration: number;
  probeBudget: { tokens: number; requests: number; timeoutMs: number };
  maxExtraRequestTokensPerUtcDay: number; maxExtraRequestsPerUtcDay: number;
  maxGuidanceTokensPerUtcDay: number; maxTotalOptimizationTokensPerUtcDay: number;
}
export interface HarnessResearchManifest {
  id: string; ownerId: string; profileId: string; workspaceId: string;
  behaviorFingerprint: string; bindingHash: string; executionKind: 'probe' | 'formal-evaluation';
  expiresAt: number; machineBoundMs: number;
  perRun: { tokens: number; requests: number; timeoutMs: number };
  steps: Array<{ id: string; bodyHash: string; tokens: number; timeoutMs: number }>;
}
export interface HarnessUserContext { requestSource?: string; principalId?: string }
export interface HarnessAttemptTicket {
  invocationId: string; runId: string; bodyHash: string; ownerId: string; ownerEpoch: number;
  researchGeneration: number; nonce: string;
  latestSendAt: number; utcDay: string;
}
export interface HarnessOptimizationState {
  status: 'ready' | 'unavailable'; publicStatus: 'unavailable'; reason?: string;
  ownerId?: string; ownerEpoch?: number; config?: HarnessOptimizationConfig; recoveryGuard?: boolean;
  dispatchBlocked?: boolean;
  highWaterMark?: number;
  closeOperations?: Array<{ operationId: string; phase: 'working' | 'closed' | 'failed'; journalAcknowledged: boolean }>;
}
export interface HarnessBudgetSnapshot {
  usedTokens: number; reservedTokens: number; usedRequests: number; reservedRequests: number;
}
