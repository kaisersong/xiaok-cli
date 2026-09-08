import { validateArtifactStructure } from '../../quality/artifact-structure.js';
export type CompletionKind = 'answer' | 'file_artifact' | 'command_action' | 'project_update' | 'log_diagnostic' | 'blocked';
export interface CompletionExpectation {
    ownerKind: 'task' | 'loop_stage' | 'loop_run' | 'project' | 'goal';
    ownerId: string;
    expectedKinds: CompletionKind[];
    source: 'task_spec' | 'tool_schema' | 'scheduler_executor_contract' | 'loop_stage_contract' | 'kswarm_deliverable_type' | 'goal_criterion' | 'legacy_classifier';
    confidence: 'explicit' | 'inferred' | 'legacy';
}
export interface CompletionEvidenceRecord {
    ownerKind: CompletionExpectation['ownerKind'];
    ownerId: string;
    kind: CompletionKind;
    summary: string;
    uri?: string;
    metadata?: Record<string, unknown>;
}
export type EvidenceValidationFailure = 'evidence_missing' | 'evidence_kind_mismatch' | 'validation_failed';
export interface EvidenceValidationResult {
    ok: boolean;
    failureKind?: EvidenceValidationFailure;
    message?: string;
    warning?: string;
}
export declare function mergeCompletionExpectations(expectations: CompletionExpectation[]): CompletionExpectation | undefined;
export declare function completionEvidenceFlow(input: {
    ownerKind: CompletionExpectation['ownerKind'];
    ownerId: string;
    targetStatus: string;
    expectation?: CompletionExpectation;
    evidence?: CompletionEvidenceRecord[];
}): EvidenceFlow;
export type CompletionEvidenceInput = Parameters<typeof completionEvidenceFlow>[0];
export type EvidenceEffect = {
    kind: 'exists' | 'realpath' | 'lstat';
    path: string;
} | {
    kind: 'structure';
    path: string;
    structuralKind: 'pdf' | 'pptx';
};
export type EvidenceEffectResult = boolean | string | {
    isSymbolicLink(): boolean;
} | ReturnType<typeof validateArtifactStructure>;
type EvidenceFlow = Generator<EvidenceEffect, EvidenceValidationResult, EvidenceEffectResult>;
/** One rule flow, with distinct synchronous and asynchronous effect interpreters. */
export declare function validateCompletionEvidence(input: CompletionEvidenceInput): EvidenceValidationResult;
export {};
