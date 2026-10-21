import type { MetadataSessionQueryId } from './metadata-session-query-manifest.js';
/** Closed lookup catalogue over original producer projections. These are read
 * descriptions only: neither an SQL input port nor source/ownership authority. */
export interface MetadataSessionRelationDefinition {
    readonly queryId: MetadataSessionQueryId;
    readonly whereEqual: readonly string[];
    readonly orderBy: readonly string[];
    readonly rowidTieBreak: true;
    readonly cardinality: 'zero-or-one' | 'many';
    readonly boundKeyTypes: readonly 'text'[];
}
export declare const metadataSessionRelationManifest: Readonly<{
    readonly "groups:group": {
        readonly queryId: "groups:groups";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["group_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:message": {
        readonly queryId: "groups:messages";
        readonly whereEqual: readonly ["message_id"];
        readonly orderBy: readonly ["message_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:event": {
        readonly queryId: "groups:events";
        readonly whereEqual: readonly ["group_id", "seq"];
        readonly orderBy: readonly ["group_id", "seq"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text", "text"];
    };
    readonly "groups:content": {
        readonly queryId: "groups:contents";
        readonly whereEqual: readonly ["content_id"];
        readonly orderBy: readonly ["content_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-agents": {
        readonly queryId: "groups:agents";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["agent_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-events": {
        readonly queryId: "groups:events";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["seq"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-messages": {
        readonly queryId: "groups:messages";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["message_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-contents": {
        readonly queryId: "groups:contents";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["content_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-operations": {
        readonly queryId: "groups:operations";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["operation_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-root_turns": {
        readonly queryId: "groups:root_turns";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["source_task_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "groups:group-managed_resources": {
        readonly queryId: "groups:managed_resources";
        readonly whereEqual: readonly ["group_id"];
        readonly orderBy: readonly ["resource_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:candidate-verification-sessions": {
        readonly queryId: "loop:loop_verification_sessions";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:definition": {
        readonly queryId: "loop:loop_definitions";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run": {
        readonly queryId: "loop:loop_runs";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:stage": {
        readonly queryId: "loop:loop_stages";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:assistant-profile": {
        readonly queryId: "loop:assistant_profiles";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:assistant-member": {
        readonly queryId: "loop:assistant_candidates";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:constraint": {
        readonly queryId: "loop:loop_learned_constraints";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:expectation": {
        readonly queryId: "completion:completion_expectations";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:evidence": {
        readonly queryId: "completion:completion_evidence";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:completion-record": {
        readonly queryId: "completion:completion_records";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:template": {
        readonly queryId: "loop:user_loop_templates";
        readonly whereEqual: readonly ["loop_id"];
        readonly orderBy: readonly ["loop_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:configuration": {
        readonly queryId: "loop:loop_publication_configs";
        readonly whereEqual: readonly ["loop_id"];
        readonly orderBy: readonly ["loop_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:basis": {
        readonly queryId: "loop:loop_run_publication_basis";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["run_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:producer-result": {
        readonly queryId: "loop:loop_producer_results";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["run_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:projection-origin": {
        readonly queryId: "loop:loop_projection_origins";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["run_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:publication-candidate": {
        readonly queryId: "loop:loop_publication_candidates";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["candidate_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:native-attempt": {
        readonly queryId: "loop:loop_native_attempts";
        readonly whereEqual: readonly ["attempt_id"];
        readonly orderBy: readonly ["attempt_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:verification-session": {
        readonly queryId: "loop:loop_verification_sessions";
        readonly whereEqual: readonly ["id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:execution-result": {
        readonly queryId: "loop:loop_stage_execution_results";
        readonly whereEqual: readonly ["stage_id"];
        readonly orderBy: readonly ["stage_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:verification-execution": {
        readonly queryId: "loop:loop_verification_executions";
        readonly whereEqual: readonly ["session_record_id"];
        readonly orderBy: readonly ["session_record_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:promotion-intent": {
        readonly queryId: "loop:assistant_promotion_intents";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["candidate_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "zero-or-one";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run-stages": {
        readonly queryId: "loop:loop_stages";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run-members": {
        readonly queryId: "loop:assistant_candidates";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run-candidates": {
        readonly queryId: "loop:loop_publication_candidates";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["candidate_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run-execution-results": {
        readonly queryId: "loop:loop_stage_execution_results";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["stage_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:candidate-members": {
        readonly queryId: "loop:loop_publication_candidate_members";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["assistant_candidate_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:candidate-native-history": {
        readonly queryId: "loop:loop_native_attempts";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["ordinal", "attempt_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:candidate-publication-history": {
        readonly queryId: "loop:loop_publication_attempts";
        readonly whereEqual: readonly ["candidate_id"];
        readonly orderBy: readonly ["sequence", "attempt_id"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
    readonly "loop:run-projection-history": {
        readonly queryId: "loop:loop_projection_generations";
        readonly whereEqual: readonly ["run_id"];
        readonly orderBy: readonly ["generation"];
        readonly rowidTieBreak: true;
        readonly cardinality: "many";
        readonly boundKeyTypes: readonly ["text"];
    };
}>;
export type MetadataSessionRelationId = keyof typeof metadataSessionRelationManifest;
