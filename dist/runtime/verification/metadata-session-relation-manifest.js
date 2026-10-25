const definitions = {
    "groups:group": { "queryId": "groups:groups", "whereEqual": ["group_id"], "orderBy": ["group_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "groups:message": { "queryId": "groups:messages", "whereEqual": ["message_id"], "orderBy": ["message_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "groups:event": { "queryId": "groups:events", "whereEqual": ["group_id", "seq"], "orderBy": ["group_id", "seq"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text", "text"] },
    "groups:content": { "queryId": "groups:contents", "whereEqual": ["content_id"], "orderBy": ["content_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "groups:group-agents": { "queryId": "groups:agents", "whereEqual": ["group_id"], "orderBy": ["agent_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-events": { "queryId": "groups:events", "whereEqual": ["group_id"], "orderBy": ["seq"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-messages": { "queryId": "groups:messages", "whereEqual": ["group_id"], "orderBy": ["message_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-contents": { "queryId": "groups:contents", "whereEqual": ["group_id"], "orderBy": ["content_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-operations": { "queryId": "groups:operations", "whereEqual": ["group_id"], "orderBy": ["operation_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-root_turns": { "queryId": "groups:root_turns", "whereEqual": ["group_id"], "orderBy": ["source_task_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "groups:group-managed_resources": { "queryId": "groups:managed_resources", "whereEqual": ["group_id"], "orderBy": ["resource_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:candidate-verification-sessions": { "queryId": "loop:loop_verification_sessions", "whereEqual": ["candidate_id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:definition": { "queryId": "loop:loop_definitions", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:run": { "queryId": "loop:loop_runs", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:stage": { "queryId": "loop:loop_stages", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:assistant-profile": { "queryId": "loop:assistant_profiles", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:assistant-member": { "queryId": "loop:assistant_candidates", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:constraint": { "queryId": "loop:loop_learned_constraints", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:expectation": { "queryId": "completion:completion_expectations", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:evidence": { "queryId": "completion:completion_evidence", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:completion-record": { "queryId": "completion:completion_records", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:template": { "queryId": "loop:user_loop_templates", "whereEqual": ["loop_id"], "orderBy": ["loop_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:configuration": { "queryId": "loop:loop_publication_configs", "whereEqual": ["loop_id"], "orderBy": ["loop_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:basis": { "queryId": "loop:loop_run_publication_basis", "whereEqual": ["run_id"], "orderBy": ["run_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:producer-result": { "queryId": "loop:loop_producer_results", "whereEqual": ["run_id"], "orderBy": ["run_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:projection-origin": { "queryId": "loop:loop_projection_origins", "whereEqual": ["run_id"], "orderBy": ["run_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:publication-candidate": { "queryId": "loop:loop_publication_candidates", "whereEqual": ["candidate_id"], "orderBy": ["candidate_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:native-attempt": { "queryId": "loop:loop_native_attempts", "whereEqual": ["attempt_id"], "orderBy": ["attempt_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:verification-session": { "queryId": "loop:loop_verification_sessions", "whereEqual": ["id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:execution-result": { "queryId": "loop:loop_stage_execution_results", "whereEqual": ["stage_id"], "orderBy": ["stage_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:verification-execution": { "queryId": "loop:loop_verification_executions", "whereEqual": ["session_record_id"], "orderBy": ["session_record_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:promotion-intent": { "queryId": "loop:assistant_promotion_intents", "whereEqual": ["candidate_id"], "orderBy": ["candidate_id"], "rowidTieBreak": true, "cardinality": "zero-or-one", "boundKeyTypes": ["text"] },
    "loop:run-stages": { "queryId": "loop:loop_stages", "whereEqual": ["run_id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:run-members": { "queryId": "loop:assistant_candidates", "whereEqual": ["run_id"], "orderBy": ["id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:run-candidates": { "queryId": "loop:loop_publication_candidates", "whereEqual": ["run_id"], "orderBy": ["candidate_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:run-execution-results": { "queryId": "loop:loop_stage_execution_results", "whereEqual": ["run_id"], "orderBy": ["stage_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:candidate-members": { "queryId": "loop:loop_publication_candidate_members", "whereEqual": ["candidate_id"], "orderBy": ["assistant_candidate_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:candidate-native-history": { "queryId": "loop:loop_native_attempts", "whereEqual": ["candidate_id"], "orderBy": ["ordinal", "attempt_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:candidate-publication-history": { "queryId": "loop:loop_publication_attempts", "whereEqual": ["candidate_id"], "orderBy": ["sequence", "attempt_id"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
    "loop:run-projection-history": { "queryId": "loop:loop_projection_generations", "whereEqual": ["run_id"], "orderBy": ["generation"], "rowidTieBreak": true, "cardinality": "many", "boundKeyTypes": ["text"] },
};
for (const relation of Object.values(definitions)) {
    Object.freeze(relation.whereEqual);
    Object.freeze(relation.orderBy);
    Object.freeze(relation.boundKeyTypes);
    Object.freeze(relation);
}
export const metadataSessionRelationManifest = Object.freeze(definitions);
