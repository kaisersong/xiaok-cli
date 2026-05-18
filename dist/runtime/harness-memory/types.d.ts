export type HarnessMemoryStatus = 'candidate' | 'active' | 'expired';
export interface HarnessMemoryScope {
    repo?: string;
    projectId?: string;
    runtime?: string;
}
export interface HarnessMemoryEvidence {
    traceBundlePath: string;
    evidenceIds: string[];
    sessionId?: string;
    projectId?: string;
    evalCaseId?: string;
}
export interface HarnessMemoryRecord {
    id: string;
    category: string;
    summary: string;
    scope: HarnessMemoryScope;
    status: HarnessMemoryStatus;
    evidence: HarnessMemoryEvidence[];
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    promotedBy?: 'human' | 'eval' | 'diagnoser';
    promotionReason?: string;
    expiredReason?: string;
}
