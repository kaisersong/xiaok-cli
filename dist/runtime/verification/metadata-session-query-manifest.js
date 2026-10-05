/** Fixed projections inventoried from actual production constructors. This is
 * neither a complete layout declaration nor source/session authority. */
const definitions = {
    "groups:thread_bindings-v1-0": { "table": "thread_bindings", "columns": ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision"] },
    "groups:thread_bindings-v1-1": { "table": "thread_bindings", "columns": ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state"] },
    "groups:thread_bindings-v1-2": { "table": "thread_bindings", "columns": ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state", "delete_json"] },
    "groups:agents": { "table": "agents", "columns": ["group_id", "agent_id", "parent_id", "created_at", "data_json", "logical_bytes"] },
    "groups:boot_owners": { "table": "boot_owners", "columns": ["boot_id", "owner_pid", "state"] },
    "groups:contents": { "table": "contents", "columns": ["content_id", "group_id", "agent_id", "data_json", "logical_bytes"] },
    "groups:events": { "table": "events", "columns": ["group_id", "seq", "event_id", "agent_id", "data_json", "logical_bytes"] },
    "groups:groups": { "table": "groups", "columns": ["group_id", "thread_id", "boot_id", "historical_only", "created_at", "byte_usage", "data_json", "logical_bytes"] },
    "groups:managed_resources": { "table": "managed_resources", "columns": ["resource_id", "group_id", "agent_id", "data_json", "logical_bytes"] },
    "groups:messages": { "table": "messages", "columns": ["message_id", "group_id", "sender_kind", "sender_agent_id", "sender_actor_id", "receiver_id", "delivery_state", "claim_id", "turn_id", "created_at", "data_json", "logical_bytes"] },
    "groups:operations": { "table": "operations", "columns": ["group_id", "operation_id", "data_json", "logical_bytes"] },
    "groups:root_turns": { "table": "root_turns", "columns": ["source_task_id", "group_id", "preparation_id", "boot_id", "data_json", "logical_bytes"] },
    "groups:thread_bindings": { "table": "thread_bindings", "columns": ["thread_id", "profile_id", "workspace_id", "cwd", "active_group_id", "thread_revision", "delete_state", "delete_json", "pending_approval_count"] },
    "groups:workspace_execution_authorizations": { "table": "workspace_execution_authorizations", "columns": ["profile_id", "workspace_id", "permission_revision", "execution_allowed", "updated_at", "actor_id", "last_receipt_json"] },
    "codex-native:codex_native_sessions": { "table": "codex_native_sessions", "columns": ["id", "owner", "native_id", "snapshot"] },
    "codex-routes:settings": { "table": "settings", "columns": ["key", "value"] },
    "codex-routes:threads": { "table": "threads", "columns": ["id", "native_id"] },
    "codex-routes:routes": { "table": "routes", "columns": ["task_id", "thread_id"] },
    "loop:sqlite_sequence": { "table": "sqlite_sequence", "columns": ["name", "seq"] },
    "loop:assistant_candidates": {
        "table": "assistant_candidates",
        "columns": [
            "id",
            "run_id",
            "kind",
            "title",
            "content",
            "scope",
            "project_id",
            "confidence",
            "evidence_refs_json",
            "dedupe_key",
            "status",
            "target_kind",
            "target_id",
            "accepted_target_ref",
            "created_at",
            "decided_at"
        ]
    },
    "loop:assistant_profiles": {
        "table": "assistant_profiles",
        "columns": [
            "id",
            "status",
            "locale",
            "time_zone",
            "evening_time",
            "morning_time",
            "workdays_json",
            "quiet_hours_json",
            "data_scopes_json",
            "created_at",
            "updated_at"
        ]
    },
    "loop:assistant_promotion_intents": {
        "table": "assistant_promotion_intents",
        "columns": [
            "candidate_id",
            "revision",
            "record_json"
        ]
    },
    "loop:automation_store_metadata": {
        "table": "automation_store_metadata",
        "columns": [
            "key",
            "value"
        ]
    },
    "loop:loop_artifact_exports": {
        "table": "loop_artifact_exports",
        "columns": [
            "sequence",
            "id",
            "revision",
            "parent_device",
            "parent_inode",
            "temporary_name",
            "record_json",
            "record_hash"
        ]
    },
    "loop:loop_definitions": {
        "table": "loop_definitions",
        "columns": [
            "id",
            "title",
            "description",
            "status",
            "origin",
            "active_run_id",
            "deleted_at",
            "delete_reason",
            "created_at",
            "updated_at"
        ]
    },
    "loop:loop_learned_constraints": {
        "table": "loop_learned_constraints",
        "columns": [
            "id",
            "loop_id",
            "source",
            "rule",
            "source_run_id",
            "failure_kind",
            "failure_reason",
            "active",
            "hit_count",
            "consecutive_ineffective_count",
            "created_at",
            "updated_at",
            "last_hit_at",
            "superseded_by",
            "deactivation_reason",
            "extraction_context"
        ]
    },
    "loop:loop_native_attempts": {
        "table": "loop_native_attempts",
        "columns": [
            "attempt_id",
            "candidate_id",
            "revision",
            "ordinal",
            "original_source",
            "binding_hash",
            "source_vector_hash",
            "configuration_revision",
            "definition_hash",
            "enrollment_request_id",
            "application_request_id",
            "phase",
            "created_at",
            "updated_at",
            "kind",
            "enrollment_source_attempt_id",
            "reauthorizes_attempt_id"
        ]
    },
    "loop:loop_producer_results": {
        "table": "loop_producer_results",
        "columns": [
            "run_id",
            "revision",
            "body_json",
            "body_hash",
            "stage_id",
            "evidence_ids_json",
            "terminal_at"
        ]
    },
    "loop:loop_projection_generations": {
        "table": "loop_projection_generations",
        "columns": [
            "run_id",
            "generation",
            "generation_hash",
            "record_json"
        ]
    },
    "loop:loop_projection_origins": {
        "table": "loop_projection_origins",
        "columns": [
            "run_id",
            "origin_hash",
            "record_json"
        ]
    },
    "loop:loop_publication_attempts": {
        "table": "loop_publication_attempts",
        "columns": [
            "attempt_id",
            "native_attempt_id",
            "candidate_id",
            "sequence",
            "revision",
            "record_json"
        ]
    },
    "loop:loop_publication_candidate_members": {
        "table": "loop_publication_candidate_members",
        "columns": [
            "candidate_id",
            "assistant_candidate_id",
            "original_row_json"
        ]
    },
    "loop:loop_publication_candidates": {
        "table": "loop_publication_candidates",
        "columns": [
            "candidate_id",
            "run_id",
            "stage_id",
            "subject_key",
            "revision",
            "binding_json",
            "binding_hash",
            "source_vector_hash",
            "publication_state",
            "created_at"
        ]
    },
    "loop:loop_publication_configs": {
        "table": "loop_publication_configs",
        "columns": [
            "loop_id",
            "revision",
            "configuration_json",
            "created_at",
            "updated_at"
        ]
    },
    "loop:loop_run_publication_basis": {
        "table": "loop_run_publication_basis",
        "columns": [
            "run_id",
            "basis_json",
            "basis_hash"
        ]
    },
    "loop:loop_runs": {
        "table": "loop_runs",
        "columns": [
            "id",
            "loop_id",
            "status",
            "trigger_json",
            "evidence_ids_json",
            "started_at",
            "finished_at",
            "updated_at",
            "failure_kind",
            "message",
            "summary",
            "next_action_kind",
            "next_action_summary",
            "duration_ms",
            "logical_run_key"
        ]
    },
    "loop:loop_stage_execution_results": {
        "table": "loop_stage_execution_results",
        "columns": [
            "stage_id",
            "run_id",
            "revision",
            "body_json",
            "body_hash",
            "task_snapshot_json",
            "task_snapshot_hash",
            "evidence_ids_json",
            "terminal_at"
        ]
    },
    "loop:loop_stages": {
        "table": "loop_stages",
        "columns": [
            "id",
            "run_id",
            "loop_id",
            "stage_kind",
            "status",
            "started_at",
            "finished_at",
            "evidence_ids_json",
            "summary",
            "failure_kind",
            "message",
            "metadata_json",
            "created_at",
            "updated_at"
        ]
    },
    "loop:loop_verification_executions": {
        "table": "loop_verification_executions",
        "columns": [
            "id",
            "session_record_id",
            "revision",
            "record_json"
        ]
    },
    "loop:loop_verification_sessions": {
        "table": "loop_verification_sessions",
        "columns": [
            "id",
            "native_attempt_id",
            "candidate_id",
            "obligation_id",
            "session_id",
            "operation_id",
            "validation_invocation_id",
            "enrollment_request_id",
            "phase",
            "revision",
            "created_at",
            "updated_at"
        ]
    },
    "loop:user_loop_templates": {
        "table": "user_loop_templates",
        "columns": [
            "loop_id",
            "kind",
            "prompt",
            "output_directory",
            "output_file_name",
            "schedule_action_id",
            "schedule_enabled",
            "schedule_trigger_json",
            "auto_run_approved",
            "contract_json",
            "contract_schema_version",
            "created_at",
            "updated_at"
        ]
    },
    "completion:completion_evidence": {
        "table": "completion_evidence",
        "columns": [
            "id",
            "schema_version",
            "owner_kind",
            "owner_id",
            "kind",
            "summary",
            "uri",
            "metadata_json",
            "created_at",
            "orphaned_at"
        ]
    },
    "completion:completion_expectations": {
        "table": "completion_expectations",
        "columns": [
            "id",
            "schema_version",
            "owner_kind",
            "owner_id",
            "expected_kinds_json",
            "source",
            "confidence",
            "metadata_json",
            "created_at",
            "updated_at"
        ]
    },
    "completion:completion_records": {
        "table": "completion_records",
        "columns": [
            "id",
            "owner_kind",
            "owner_id",
            "status",
            "ok",
            "failure_kind",
            "message",
            "expectation_id",
            "evidence_ids_json",
            "created_at"
        ]
    },
    "artifactScanner:evidence_anomalies": {
        "table": "evidence_anomalies",
        "columns": [
            "id",
            "loop_id",
            "owner_kind",
            "owner_id",
            "kind",
            "status",
            "first_seen_at",
            "last_seen_at",
            "last_resolved_at",
            "seen_count",
            "ignored_until",
            "message",
            "evidence_ids_json",
            "metadata_json"
        ]
    },
    "healthScanner:evidence_anomalies": {
        "table": "evidence_anomalies",
        "columns": [
            "id",
            "loop_id",
            "owner_kind",
            "owner_id",
            "kind",
            "status",
            "first_seen_at",
            "last_seen_at",
            "last_resolved_at",
            "seen_count",
            "ignored_until",
            "message",
            "evidence_ids_json",
            "metadata_json"
        ]
    },
    "goal:goal_completion_intents": {
        "table": "goal_completion_intents",
        "columns": [
            "intent_id",
            "goal_id",
            "epoch",
            "turn_id",
            "revision",
            "intent_json"
        ]
    },
    "goal:goal_events": {
        "table": "goal_events",
        "columns": [
            "event_id",
            "session_id",
            "goal_id",
            "revision",
            "event_json",
            "recorded_at"
        ]
    },
    "goal:goal_evidence": {
        "table": "goal_evidence",
        "columns": [
            "evidence_id",
            "goal_id",
            "epoch",
            "goal_turn_id",
            "evidence_json",
            "recorded_at"
        ]
    },
    "goal:goal_publication_attempts": {
        "table": "goal_publication_attempts",
        "columns": [
            "attempt_id",
            "intent_id",
            "goal_id",
            "sequence",
            "revision",
            "attempt_json"
        ]
    },
    "goal:goal_sessions": {
        "table": "goal_sessions",
        "columns": [
            "session_id",
            "current_goal_id",
            "updated_at"
        ]
    },
    "goal:goal_thread_context_tasks": {
        "table": "goal_thread_context_tasks",
        "columns": [
            "context_id",
            "goal_id",
            "thread_id",
            "task_id",
            "ordinal",
            "recorded_at"
        ]
    },
    "goal:goal_thread_tasks": {
        "table": "goal_thread_tasks",
        "columns": [
            "binding_id",
            "goal_id",
            "epoch",
            "goal_turn_id",
            "thread_id",
            "task_id",
            "origin",
            "ordinal",
            "attached_at"
        ]
    },
    "goal:goal_turns": {
        "table": "goal_turns",
        "columns": [
            "goal_id",
            "epoch",
            "turn_id",
            "turn_json",
            "recorded_at"
        ]
    },
    "goal:goals": {
        "table": "goals",
        "columns": [
            "goal_id",
            "session_id",
            "revision",
            "epoch",
            "state_json",
            "created_at",
            "updated_at"
        ]
    },
    "session:session_messages": {
        "table": "session_messages",
        "columns": [
            "message_id",
            "session_id",
            "message_index",
            "role",
            "content_json",
            "text_content"
        ]
    },
    "session:session_meta": {
        "table": "session_meta",
        "columns": [
            "key",
            "value"
        ]
    },
    "session:session_migrations": {
        "table": "session_migrations",
        "columns": [
            "session_id",
            "marker_json"
        ]
    },
    "session:sessions": {
        "table": "sessions",
        "columns": [
            "session_id",
            "cwd",
            "model",
            "created_at",
            "updated_at",
            "forked_from_session_id",
            "lineage_json",
            "usage_json",
            "compactions_json",
            "prompt_snapshot_id",
            "memory_refs_json",
            "approval_refs_json",
            "background_job_refs_json",
            "semantic_compaction_json",
            "compound_operations_json",
            "store_revision",
            "history_digest",
            "execution_protected",
            "intent_delegation_json",
            "skill_eval_json",
            "skill_execution_json",
            "protected_observation_closure_json"
        ]
    },
    "session:session_messages_fts": { "table": "session_messages_fts", "columns": ["rowid", "session_id", "message_index", "text_content"] },
    "session:sqlite_sequence": { "table": "sqlite_sequence", "columns": ["name", "seq"] }
};
for (const query of Object.values(definitions)) {
    Object.freeze(query.columns);
    Object.freeze(query);
}
export const METADATA_SESSION_QUERIES = Object.freeze(definitions);
