import type { LoopApplicationBinding } from '../verification/loop-application-binding.js';
import type { GoalVerificationDefinition } from '../goal/verification-definition.js';
export type LoopRunStatus = 'running' | 'success' | 'failed' | 'blocked';
export type LoopStageStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
export type LoopStageKind = 'scan' | 'execute' | 'verify';
export type LoopRunFailureKind = 'executor_crash' | 'executor_failed' | 'validation_failed' | 'evidence_missing' | 'evidence_kind_mismatch' | 'unknown';
export type AssistantCandidateKind = 'memory' | 'knowledge' | 'follow_up';
export type AssistantCandidateStatus = 'staged' | 'pending' | 'accepting' | 'accepted' | 'rejected' | 'superseded' | 'accept_failed';
export interface AssistantEvidenceRef {
    kind: string;
    id: string;
}
export interface AssistantCandidate {
    id: string;
    runId: string;
    kind: AssistantCandidateKind;
    title: string;
    content: string;
    scope: 'global' | 'project';
    projectId?: string;
    confidence: number;
    evidenceRefs: AssistantEvidenceRef[];
    dedupeKey: string;
    status: AssistantCandidateStatus;
    targetKind?: 'memory' | 'knowledge' | 'follow_up';
    targetId?: string;
    acceptedTargetRef?: string;
    createdAt: number;
    decidedAt?: number;
}
export interface LoopRunRow {
    id: string;
    loop_id: string;
    status: LoopRunStatus;
    trigger_json: string;
    logical_run_key: string | null;
    evidence_ids_json: string;
    started_at: number;
    finished_at: number | null;
    updated_at: number;
    failure_kind: LoopRunFailureKind | null;
    message: string | null;
    summary: string | null;
    next_action_kind: string | null;
    next_action_summary: string | null;
}
export interface AssistantCandidateRow {
    id: string;
    run_id: string;
    kind: AssistantCandidate['kind'];
    title: string;
    content: string;
    scope: AssistantCandidate['scope'];
    project_id: string | null;
    confidence: number;
    evidence_refs_json: string;
    dedupe_key: string;
    status: AssistantCandidateStatus;
    target_kind: AssistantCandidate['targetKind'] | null;
    target_id: string | null;
    accepted_target_ref: string | null;
    created_at: number;
    decided_at: number | null;
}
export interface LoopStageRow {
    id: string;
    run_id: string;
    loop_id: string;
    stage_kind: LoopStageKind;
    status: LoopStageStatus;
    started_at: number | null;
    finished_at: number | null;
    evidence_ids_json: string;
    summary: string | null;
    failure_kind: LoopRunFailureKind | null;
    message: string | null;
    metadata_json: string;
    created_at: number;
    updated_at: number;
}
export interface StoredLoopPublicationCandidate {
    candidateId: string;
    runId: string;
    stageId: string | null;
    binding: Readonly<LoopApplicationBinding>;
    bindingHash: string;
    sourceVectorHash: string;
    publicationState: 'captured';
    createdAt: number;
}
export type LoopNativePhase = 'reserved' | 'enrolling' | 'enrolled' | 'binding' | 'ready' | 'retired' | 'needs_reauthorization' | 'stale';
interface LoopNativeAttemptBase {
    attemptId: string;
    candidateId: string;
    revision: number;
    ordinal: number;
    originalSource: 'user';
    bindingHash: string;
    sourceVectorHash: string;
    configurationRevision: number;
    definitionHash: string;
    applicationRequestId: string;
    phase: LoopNativePhase;
    createdAt: number;
    updatedAt: number;
}
export type LoopNativeAttempt = LoopNativeAttemptBase & ({
    kind: 'enrollment-and-application';
    enrollmentRequestId: string;
    enrollmentSourceAttemptId: null;
    reauthorizesAttemptId: null;
} | {
    kind: 'application-reauthorization';
    enrollmentRequestId: null;
    enrollmentSourceAttemptId: string;
    reauthorizesAttemptId: string;
});
export interface LoopVerificationSession {
    id: string;
    nativeAttemptId: string;
    candidateId: string;
    obligationId: string;
    sessionId: string;
    operationId: string;
    validationInvocationId: string;
    enrollmentRequestId: string;
    phase: 'reserved' | 'session_ready' | 'enrolling' | 'enrolled' | 'retired' | 'stale';
    revision: number;
    createdAt: number;
    updatedAt: number;
}
export interface AssistantPromotionTargetInput {
    candidateId: string;
    loopRunId: string;
    targetId: string;
    title: string;
    content: string;
    scope: 'global' | 'project';
    projectId?: string;
    projectCwd?: string;
    collectionId?: string;
    provenance: {
        kind: 'assistant_candidate';
        candidateId: string;
        loopRunId: string;
        evidenceRefs: Array<{
            kind: string;
            id: string;
        }>;
    };
}
export interface ArtifactExportFileIdentity {
    readonly device: string;
    readonly inode: string;
}
export interface ArtifactExportOutcome {
    readonly status: 'completed' | 'failed' | 'unknown';
    readonly committed: boolean | null;
    readonly cleanup: 'none' | 'removed' | 'unknown';
    readonly error: string | null;
}
export interface LoopNativeAttemptTarget {
    attempt: Readonly<LoopNativeAttempt>;
    binding: Readonly<LoopApplicationBinding>;
    definition: Readonly<GoalVerificationDefinition>;
}
export {};
