export type CompletionKind = 'answer' | 'file_artifact' | 'command_action' | 'project_update' | 'log_diagnostic' | 'blocked';
export interface CompletionExpectation {
    ownerKind: 'task' | 'loop_stage' | 'loop_run' | 'project';
    ownerId: string;
    expectedKinds: CompletionKind[];
    source: 'task_spec' | 'tool_schema' | 'scheduler_executor_contract' | 'loop_stage_contract' | 'kswarm_deliverable_type' | 'legacy_classifier';
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
}
export declare function mergeCompletionExpectations(expectations: CompletionExpectation[]): CompletionExpectation | undefined;
export declare function validateCompletionEvidence(input: {
    ownerKind: CompletionExpectation['ownerKind'];
    ownerId: string;
    targetStatus: string;
    expectation?: CompletionExpectation;
    evidence?: CompletionEvidenceRecord[];
}): EvidenceValidationResult;
