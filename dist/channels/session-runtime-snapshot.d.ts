import type { SessionBinding } from './session-binding-store.js';
export interface SessionRuntimeSnapshotBackgroundJob {
    jobId: string;
    status: string;
    detail: string;
}
export interface SessionRuntimeSnapshotApproval {
    approvalId: string;
    summary: string;
}
export interface SessionRuntimeSnapshotInput {
    sessionId: string;
    binding?: SessionBinding | null;
    taskStatus: string;
    backgroundJobs: SessionRuntimeSnapshotBackgroundJob[];
    approvals: SessionRuntimeSnapshotApproval[];
    capabilityHealth: string;
}
export declare function formatSessionRuntimeSnapshot(input: SessionRuntimeSnapshotInput): string;
