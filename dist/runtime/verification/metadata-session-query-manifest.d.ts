export declare const METADATA_SESSION_QUERIES: Readonly<{
    readonly "groups:thread_bindings-v1-0": {
        readonly table: "thread_bindings";
        readonly columns: readonly ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision"];
    };
    readonly "groups:thread_bindings-v1-1": {
        readonly table: "thread_bindings";
        readonly columns: readonly ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state"];
    };
    readonly "groups:thread_bindings-v1-2": {
        readonly table: "thread_bindings";
        readonly columns: readonly ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state", "delete_json"];
    };
    readonly "groups:agents": {
        readonly table: "agents";
        readonly columns: readonly ["group_id", "agent_id", "parent_id", "created_at", "data_json", "logical_bytes"];
    };
    readonly "groups:boot_owners": {
        readonly table: "boot_owners";
        readonly columns: readonly ["boot_id", "owner_pid", "state"];
    };
    readonly "groups:contents": {
        readonly table: "contents";
        readonly columns: readonly ["content_id", "group_id", "agent_id", "data_json", "logical_bytes"];
    };
    readonly "groups:events": {
        readonly table: "events";
        readonly columns: readonly ["group_id", "seq", "event_id", "agent_id", "data_json", "logical_bytes"];
    };
    readonly "groups:groups": {
        readonly table: "groups";
        readonly columns: readonly ["group_id", "thread_id", "boot_id", "historical_only", "created_at", "byte_usage", "data_json", "logical_bytes"];
    };
    readonly "groups:managed_resources": {
        readonly table: "managed_resources";
        readonly columns: readonly ["resource_id", "group_id", "agent_id", "data_json", "logical_bytes"];
    };
    readonly "groups:messages": {
        readonly table: "messages";
        readonly columns: readonly ["message_id", "group_id", "sender_kind", "sender_agent_id", "sender_actor_id", "receiver_id", "delivery_state", "claim_id", "turn_id", "created_at", "data_json", "logical_bytes"];
    };
    readonly "groups:operations": {
        readonly table: "operations";
        readonly columns: readonly ["group_id", "operation_id", "data_json", "logical_bytes"];
    };
    readonly "groups:root_turns": {
        readonly table: "root_turns";
        readonly columns: readonly ["source_task_id", "group_id", "preparation_id", "boot_id", "data_json", "logical_bytes"];
    };
    readonly "groups:thread_bindings": {
        readonly table: "thread_bindings";
        readonly columns: readonly ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state", "delete_json", "pending_approval_count"];
    };
    readonly "groups:workspace_execution_authorizations": {
        readonly table: "workspace_execution_authorizations";
        readonly columns: readonly ["profile_id", "workspace_id", "permission_revision", "execution_allowed", "updated_at", "actor_id", "last_receipt_json"];
    };
    readonly "codex-native:codex_native_sessions": {
        readonly table: "codex_native_sessions";
        readonly columns: readonly ["id", "owner", "native_id", "snapshot"];
    };
    readonly "codex-routes:settings": {
        readonly table: "settings";
        readonly columns: readonly ["key", "value"];
    };
    readonly "codex-routes:threads": {
        readonly table: "threads";
        readonly columns: readonly ["id", "native_id"];
    };
    readonly "codex-routes:routes": {
        readonly table: "routes";
        readonly columns: readonly ["task_id", "thread_id"];
    };
    readonly "loop:sqlite_sequence": {
        readonly table: "sqlite_sequence";
        readonly columns: readonly ["name", "seq"];
    };
    readonly "loop:assistant_candidates": {
        readonly table: "assistant_candidates";
        readonly columns: readonly ["id", "run_id", "kind", "title", "content", "scope", "project_id", "confidence", "evidence_refs_json", "dedupe_key", "status", "target_kind", "target_id", "accepted_target_ref", "created_at", "decided_at"];
    };
    readonly "loop:assistant_profiles": {
        readonly table: "assistant_profiles";
        readonly columns: readonly ["id", "status", "locale", "time_zone", "evening_time", "morning_time", "workdays_json", "quiet_hours_json", "data_scopes_json", "created_at", "updated_at"];
    };
    readonly "loop:assistant_promotion_intents": {
        readonly table: "assistant_promotion_intents";
        readonly columns: readonly ["candidate_id", "revision", "record_json"];
    };
    readonly "loop:automation_store_metadata": {
        readonly table: "automation_store_metadata";
        readonly columns: readonly ["key", "value"];
    };
    readonly "loop:loop_artifact_exports": {
        readonly table: "loop_artifact_exports";
        readonly columns: readonly ["sequence", "id", "revision", "parent_device", "parent_inode", "temporary_name", "record_json", "record_hash"];
    };
    readonly "loop:loop_definitions": {
        readonly table: "loop_definitions";
        readonly columns: readonly ["id", "title", "description", "status", "origin", "active_run_id", "deleted_at", "delete_reason", "created_at", "updated_at"];
    };
    readonly "loop:loop_learned_constraints": {
        readonly table: "loop_learned_constraints";
        readonly columns: readonly ["id", "loop_id", "source", "rule", "source_run_id", "failure_kind", "failure_reason", "active", "hit_count", "consecutive_ineffective_count", "created_at", "updated_at", "last_hit_at", "superseded_by", "deactivation_reason", "extraction_context"];
    };
    readonly "loop:loop_native_attempts": {
        readonly table: "loop_native_attempts";
        readonly columns: readonly ["attempt_id", "candidate_id", "revision", "ordinal", "original_source", "binding_hash", "source_vector_hash", "configuration_revision", "definition_hash", "enrollment_request_id", "application_request_id", "phase", "created_at", "updated_at", "kind", "enrollment_source_attempt_id", "reauthorizes_attempt_id"];
    };
    readonly "loop:loop_producer_results": {
        readonly table: "loop_producer_results";
        readonly columns: readonly ["run_id", "revision", "body_json", "body_hash", "stage_id", "evidence_ids_json", "terminal_at"];
    };
    readonly "loop:loop_projection_generations": {
        readonly table: "loop_projection_generations";
        readonly columns: readonly ["run_id", "generation", "generation_hash", "record_json"];
    };
    readonly "loop:loop_projection_origins": {
        readonly table: "loop_projection_origins";
        readonly columns: readonly ["run_id", "origin_hash", "record_json"];
    };
    readonly "loop:loop_publication_attempts": {
        readonly table: "loop_publication_attempts";
        readonly columns: readonly ["attempt_id", "native_attempt_id", "candidate_id", "sequence", "revision", "record_json"];
    };
    readonly "loop:loop_publication_candidate_members": {
        readonly table: "loop_publication_candidate_members";
        readonly columns: readonly ["candidate_id", "assistant_candidate_id", "original_row_json"];
    };
    readonly "loop:loop_publication_candidates": {
        readonly table: "loop_publication_candidates";
        readonly columns: readonly ["candidate_id", "run_id", "stage_id", "subject_key", "revision", "binding_json", "binding_hash", "source_vector_hash", "publication_state", "created_at"];
    };
    readonly "loop:loop_publication_configs": {
        readonly table: "loop_publication_configs";
        readonly columns: readonly ["loop_id", "revision", "configuration_json", "created_at", "updated_at"];
    };
    readonly "loop:loop_run_publication_basis": {
        readonly table: "loop_run_publication_basis";
        readonly columns: readonly ["run_id", "basis_json", "basis_hash"];
    };
    readonly "loop:loop_runs": {
        readonly table: "loop_runs";
        readonly columns: readonly ["id", "loop_id", "status", "trigger_json", "evidence_ids_json", "started_at", "finished_at", "updated_at", "failure_kind", "message", "summary", "next_action_kind", "next_action_summary", "duration_ms", "logical_run_key"];
    };
    readonly "loop:loop_stage_execution_results": {
        readonly table: "loop_stage_execution_results";
        readonly columns: readonly ["stage_id", "run_id", "revision", "body_json", "body_hash", "task_snapshot_json", "task_snapshot_hash", "evidence_ids_json", "terminal_at"];
    };
    readonly "loop:loop_stages": {
        readonly table: "loop_stages";
        readonly columns: readonly ["id", "run_id", "loop_id", "stage_kind", "status", "started_at", "finished_at", "evidence_ids_json", "summary", "failure_kind", "message", "metadata_json", "created_at", "updated_at"];
    };
    readonly "loop:loop_verification_executions": {
        readonly table: "loop_verification_executions";
        readonly columns: readonly ["id", "session_record_id", "revision", "record_json"];
    };
    readonly "loop:loop_verification_sessions": {
        readonly table: "loop_verification_sessions";
        readonly columns: readonly ["id", "native_attempt_id", "candidate_id", "obligation_id", "session_id", "operation_id", "validation_invocation_id", "enrollment_request_id", "phase", "revision", "created_at", "updated_at"];
    };
    readonly "loop:user_loop_templates": {
        readonly table: "user_loop_templates";
        readonly columns: readonly ["loop_id", "kind", "prompt", "output_directory", "output_file_name", "schedule_action_id", "schedule_enabled", "schedule_trigger_json", "auto_run_approved", "contract_json", "contract_schema_version", "created_at", "updated_at"];
    };
    readonly "completion:completion_evidence": {
        readonly table: "completion_evidence";
        readonly columns: readonly ["id", "schema_version", "owner_kind", "owner_id", "kind", "summary", "uri", "metadata_json", "created_at", "orphaned_at"];
    };
    readonly "completion:completion_expectations": {
        readonly table: "completion_expectations";
        readonly columns: readonly ["id", "schema_version", "owner_kind", "owner_id", "expected_kinds_json", "source", "confidence", "metadata_json", "created_at", "updated_at"];
    };
    readonly "completion:completion_records": {
        readonly table: "completion_records";
        readonly columns: readonly ["id", "owner_kind", "owner_id", "status", "ok", "failure_kind", "message", "expectation_id", "evidence_ids_json", "created_at"];
    };
    readonly "artifactScanner:evidence_anomalies": {
        readonly table: "evidence_anomalies";
        readonly columns: readonly ["id", "loop_id", "owner_kind", "owner_id", "kind", "status", "first_seen_at", "last_seen_at", "last_resolved_at", "seen_count", "ignored_until", "message", "evidence_ids_json", "metadata_json"];
    };
    readonly "healthScanner:evidence_anomalies": {
        readonly table: "evidence_anomalies";
        readonly columns: readonly ["id", "loop_id", "owner_kind", "owner_id", "kind", "status", "first_seen_at", "last_seen_at", "last_resolved_at", "seen_count", "ignored_until", "message", "evidence_ids_json", "metadata_json"];
    };
    readonly "goal:goal_completion_intents": {
        readonly table: "goal_completion_intents";
        readonly columns: readonly ["intent_id", "goal_id", "epoch", "turn_id", "revision", "intent_json"];
    };
    readonly "goal:goal_events": {
        readonly table: "goal_events";
        readonly columns: readonly ["event_id", "session_id", "goal_id", "revision", "event_json", "recorded_at"];
    };
    readonly "goal:goal_evidence": {
        readonly table: "goal_evidence";
        readonly columns: readonly ["evidence_id", "goal_id", "epoch", "goal_turn_id", "evidence_json", "recorded_at"];
    };
    readonly "goal:goal_publication_attempts": {
        readonly table: "goal_publication_attempts";
        readonly columns: readonly ["attempt_id", "intent_id", "goal_id", "sequence", "revision", "attempt_json"];
    };
    readonly "goal:goal_sessions": {
        readonly table: "goal_sessions";
        readonly columns: readonly ["session_id", "current_goal_id", "updated_at"];
    };
    readonly "goal:goal_thread_context_tasks": {
        readonly table: "goal_thread_context_tasks";
        readonly columns: readonly ["context_id", "goal_id", "thread_id", "task_id", "ordinal", "recorded_at"];
    };
    readonly "goal:goal_thread_tasks": {
        readonly table: "goal_thread_tasks";
        readonly columns: readonly ["binding_id", "goal_id", "epoch", "goal_turn_id", "thread_id", "task_id", "origin", "ordinal", "attached_at"];
    };
    readonly "goal:goal_turns": {
        readonly table: "goal_turns";
        readonly columns: readonly ["goal_id", "epoch", "turn_id", "turn_json", "recorded_at"];
    };
    readonly "goal:goals": {
        readonly table: "goals";
        readonly columns: readonly ["goal_id", "session_id", "revision", "epoch", "state_json", "created_at", "updated_at"];
    };
    readonly "session:session_messages": {
        readonly table: "session_messages";
        readonly columns: readonly ["message_id", "session_id", "message_index", "role", "content_json", "text_content"];
    };
    readonly "session:session_meta": {
        readonly table: "session_meta";
        readonly columns: readonly ["key", "value"];
    };
    readonly "session:session_migrations": {
        readonly table: "session_migrations";
        readonly columns: readonly ["session_id", "marker_json"];
    };
    readonly "session:sessions": {
        readonly table: "sessions";
        readonly columns: readonly ["session_id", "cwd", "model", "created_at", "updated_at", "forked_from_session_id", "lineage_json", "usage_json", "compactions_json", "prompt_snapshot_id", "memory_refs_json", "approval_refs_json", "background_job_refs_json", "semantic_compaction_json", "compound_operations_json", "store_revision", "history_digest", "execution_protected", "intent_delegation_json", "skill_eval_json", "skill_execution_json", "protected_observation_closure_json"];
    };
    readonly "session:session_messages_fts": {
        readonly table: "session_messages_fts";
        readonly columns: readonly ["rowid", "session_id", "message_index", "text_content"];
    };
    readonly "session:sqlite_sequence": {
        readonly table: "sqlite_sequence";
        readonly columns: readonly ["name", "seq"];
    };
}>;
export type MetadataSessionQueryId = keyof typeof METADATA_SESSION_QUERIES;
