import { type LoopHostSubject } from './loop-host-subject.js';
import { type LoopBusinessContract } from './loop-application-contract.js';
import { type PublishedArtifactSelection } from './published-artifact-selection.js';
export interface LoopArtifactDescriptor {
    selection: Readonly<PublishedArtifactSelection>;
    sha256: string;
    size: number;
}
export interface LoopCandidateEvidenceRef {
    kind: string;
    id: string;
}
export interface LoopAssistantCandidate {
    id: string;
    runId: string;
    kind: 'memory' | 'knowledge' | 'follow_up';
    title: string;
    content: string;
    scope: 'global' | 'project';
    projectId: string | null;
    confidence: number;
    evidenceRefs: readonly LoopCandidateEvidenceRef[];
    dedupeKey: string;
}
export interface LoopMorningRecommendation {
    title: string;
    reasonCode: string;
    evidenceRefs: readonly LoopCandidateEvidenceRef[];
}
export declare const LOOP_EVIDENCE_ANOMALY_KINDS: readonly ["completed_without_evidence", "artifact_kind_mismatch", "legacy_unclassified_completion", "source_unavailable", "validation_failed"];
export declare const LOOP_HEALTH_DIAGNOSTIC_KINDS: readonly ["service_not_running", "port_occupied_by_unknown_process", "health_unreachable", "health_http_error", "health_parse_error", "health_identity_mismatch", "health_capability_mismatch", "broker_unavailable", "spawn_path_missing", "spawn_exit", "source_hash_warning"];
export interface LoopDiagnosticAnomaly {
    id: string;
    ownerKind: 'task' | 'loop_stage' | 'loop_run' | 'project' | 'goal';
    ownerId: string;
    kind: typeof LOOP_EVIDENCE_ANOMALY_KINDS[number] | typeof LOOP_HEALTH_DIAGNOSTIC_KINDS[number];
    status: 'open' | 'resolved' | 'ignored';
    firstSeenAt: number;
    lastSeenAt: number;
    lastResolvedAt: number | null;
    seenCount: number;
    ignoredUntil: number | null;
    message: string;
    evidenceIds: readonly string[];
}
export type LoopDiagnostic = {
    kind: 'artifact-evidence-regression';
    scannedOwnerCount: number;
    openAnomalyCount: number;
    resolvedAnomalyCount: number;
    anomalies: readonly LoopDiagnosticAnomaly[];
} | {
    kind: 'kswarm-service-health';
    openAnomalyCount: number;
    resolvedAnomalyCount: number;
    anomalies: readonly LoopDiagnosticAnomaly[];
    diagnosticKinds: readonly string[];
    findings: readonly string[];
    suggestedActions: readonly string[];
    logPaths: readonly string[];
};
export type LoopCandidateBody = {
    kind: 'builtin-diagnostic';
    scanner: 'artifact-evidence-regression' | 'kswarm-service-health';
    observedAt: number;
    summary: string;
    nextActionKind: string;
    nextActionSummary: string | null;
    diagnostic: LoopDiagnostic;
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'user-template';
    taskId: string;
    executeStageId: string;
    verifyStageId: string;
    summary: string;
    evidenceIds: readonly string[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'user-template-execute';
    taskId: string;
    executeStageId: string;
    summary: string;
    evidenceIds: readonly string[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'assistant-evening';
    summary: string;
    candidates: readonly LoopAssistantCandidate[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'assistant-morning';
    recommendations: readonly LoopMorningRecommendation[];
    artifacts: readonly LoopArtifactDescriptor[];
};
export interface LoopApplicationBinding {
    version: 1;
    kind: 'loop';
    subject: Readonly<LoopHostSubject>;
    candidateId: string;
    candidateRevision: number;
    originalTriggerJson: string;
    triggerHash: string;
    logicalRunKey: string | null;
    contract: Readonly<LoopBusinessContract>;
    contractHash: string;
    body: Readonly<LoopCandidateBody>;
    candidatePayloadHash: string;
}
export type LoopApplicationCandidate = Omit<LoopApplicationBinding, 'triggerHash' | 'contractHash' | 'candidatePayloadHash'>;
/** Strict body value for a captured real subject and original business contract.
 * This creates no candidate identity, registration, or publication authority. */
export declare function parseLoopCandidateBody(raw: unknown, subject: unknown, contract: unknown): Readonly<LoopCandidateBody>;
/** Pure immutable proposal only. The actual LoopStore capture, native approval,
 * registered subject and receiver publication remain separate requirements. */
export declare function createLoopApplicationBinding(raw: unknown): Readonly<LoopApplicationBinding>;
export declare function parseLoopApplicationBinding(raw: unknown): Readonly<LoopApplicationBinding>;
export declare function loopApplicationBindingHash(raw: unknown): string;
