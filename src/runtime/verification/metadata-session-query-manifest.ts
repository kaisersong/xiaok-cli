/** Fixed projections inventoried from actual production constructors. This is
 * neither a complete layout declaration nor source/session authority. */
const definitions = {
  "groups:dsh_a_profile_migrations":{"table":"dsh_a_profile_migrations","columns":["migration_id","store_id","from_version","from_profile","from_digest","to_version","to_profile","to_digest","ddl_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_domains":{"table":"dsh_a_domains","columns":["scope_id","profile_id","workspace_id","principal_id","budget_owner_id","budget_account_id","budget_unit_profile","authority_id","authority_epoch","revision","state","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_configurations":{"table":"dsh_a_source_configurations","columns":["binding_id","revision","scope_id","configuration_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_configuration_heads":{"table":"dsh_a_source_configuration_heads","columns":["binding_id","revision","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_owner_domains":{"table":"dsh_a_owner_domains","columns":["scope_id","owner_domain","owner_kind","registration_ref","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_mandates":{"table":"dsh_a_mandates","columns":["scope_id","mandate_id","mandate_revision","source_binding_id","content_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_mandate_heads":{"table":"dsh_a_mandate_heads","columns":["scope_id","mandate_id","revision","mandate_revision","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_control_operations":{"table":"dsh_a_control_operations","columns":["scope_id","operation_id","control_id","scope_key","record_kind","axis_or_leaf","target_epoch","previous_revision","canonical_hash","domains_hash","semantic_key","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_control_targets":{"table":"dsh_a_control_targets","columns":["scope_id","operation_id","owner_domain","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_control_heads":{"table":"dsh_a_control_heads","columns":["scope_id","control_id","scope_key","record_kind","axis_or_leaf","epoch","revision","operation_id","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_control_domain_receipts":{"table":"dsh_a_control_domain_receipts","columns":["scope_id","operation_id","owner_domain","receipt_id","receipt_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_windows":{"table":"dsh_a_windows","columns":["scope_id","source_binding_id","prefix_mode_hash","window_id","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_assessment_attempts":{"table":"dsh_a_assessment_attempts","columns":["scope_id","input_id","mandate_id","assessment_version","attempt_id","proof_version","mandate_revision","previous_selection_revision","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_assessment_candidates":{"table":"dsh_a_assessment_candidates","columns":["scope_id","candidate_id","attempt_id","output_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_assessments":{"table":"dsh_a_assessments","columns":["scope_id","assessment_id","candidate_id","attempt_id","assessment_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_selections":{"table":"dsh_a_selections","columns":["scope_id","input_id","mandate_id","assessment_version","assessment_id","previous_selection_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_selection_heads":{"table":"dsh_a_selection_heads","columns":["scope_id","input_id","mandate_id","revision","assessment_version","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_decisions":{"table":"dsh_a_decisions","columns":["scope_id","decision_id","input_id","mandate_id","policy_version","mandate_revision","evaluated_snapshot_hash","assessment_version","supersedes_decision_id","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_work_bindings":{"table":"dsh_a_work_bindings","columns":["scope_id","binding_id","source_binding_id","stable_thread_key","generation","mandate_id","revision","transport_kind","create_command_id","canonical_initial_input_id","canonical_manifest_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_command_outbox":{"table":"dsh_a_command_outbox","columns":["scope_id","command_id","binding_id","input_id","command_class","operation_key","attempt_hash","semantic_hash","decision_id","target_domain","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_delivery_heads":{"table":"dsh_a_delivery_heads","columns":["scope_id","command_id","revision","fencing_token","delivery_state","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_owner_receipts":{"table":"dsh_a_owner_receipts","columns":["scope_id","command_id","receipt_id","receipt_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_control_receipts":{"table":"dsh_a_source_control_receipts","columns":["scope_id","input_id","proof_version","disposition","command_id","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_shadow_results":{"table":"dsh_a_shadow_results","columns":["scope_id","input_id","mandate_id","policy_version","mandate_revision","evaluated_snapshot_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_binding_revisions":{"table":"dsh_a_source_binding_revisions","columns":["binding_id","binding_revision","source_key","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_control_delivery_heads":{"table":"dsh_a_control_delivery_heads","columns":["scope_id","operation_id","owner_domain","revision","fencing_token","delivery_state","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_setups":{"table":"dsh_a_source_setups","columns":["setup_id","scope_id","revision","configuration_hash","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_source_scans":{"table":"dsh_a_source_scans","columns":["scan_id","binding_id","binding_revision","read_set_id","body_hash","data_json","logical_bytes"]},
  "groups:dsh_a_source_reads":{"table":"dsh_a_source_reads","columns":["attempt_id","scan_id","plan_hash","body_hash","data_json","logical_bytes"]},
  "groups:dsh_a_source_snapshots":{"table":"dsh_a_source_snapshots","columns":["snapshot_id","binding_id","read_attempt_id","entry_index","role","content_hash","body_hash","data_json","logical_bytes"]},
  "groups:dsh_a_source_read_sets":{"table":"dsh_a_source_read_sets","columns":["read_set_id","scan_id","binding_id","body_hash","data_json","logical_bytes"]},
  "groups:dsh_a_source_content_checkpoints":{"table":"dsh_a_source_content_checkpoints","columns":["binding_id","revision","scan_id","read_set_id","body_hash","data_json","logical_bytes"]},
  "groups:dsh_a_budget_account_memberships":{"table":"dsh_a_budget_account_memberships","columns":["scope_id","account_id","mandate_id","owner_id","unit_profile","origin_digest","data_json","body_hash","logical_bytes"]},
  "groups:dsh_a_profile":{"table":"dsh_a_profile","columns":["singleton","profile","digest","store_id"]},
  "groups:dsh_a_source_bindings":{"table":"dsh_a_source_bindings","columns":["binding_id","source_key","revision","data_json","logical_bytes"]},
  "groups:dsh_a_inbox":{"table":"dsh_a_inbox","columns":["input_id","input_key","binding_id","object_id","data_json","logical_bytes"]},
  "groups:dsh_a_input_proofs":{"table":"dsh_a_input_proofs","columns":["input_id","proof_version","proof_hash","data_json","logical_bytes"]},
  "groups:dsh_a_object_heads":{"table":"dsh_a_object_heads","columns":["object_id","binding_id","revision","data_json","logical_bytes"]},
  "groups:activity_runs": {"table":"activity_runs","columns":["run_id","group_id","data_json","logical_bytes"]},
  "groups:activity_members": {"table":"activity_members","columns":["run_id","member_id","group_id","data_json","logical_bytes"]},
  "groups:thread_bindings-v1-0": {"table":"thread_bindings","columns":["thread_id","profile_id","workspace_id","cwd","active_group_id","thread_revision"]},
  "groups:thread_bindings-v1-1": {"table":"thread_bindings","columns":["thread_id","profile_id","workspace_id","cwd","active_group_id","thread_revision","delete_state"]},
  "groups:thread_bindings-v1-2": {"table":"thread_bindings","columns":["thread_id","profile_id","workspace_id","cwd","active_group_id","thread_revision","delete_state","delete_json"]},

  "groups:agents": {"table":"agents","columns":["group_id","agent_id","parent_id","created_at","data_json","logical_bytes"]},
  "groups:boot_owners": {"table":"boot_owners","columns":["boot_id","owner_pid","state"]},
  "groups:contents": {"table":"contents","columns":["content_id","group_id","agent_id","data_json","logical_bytes"]},
  "groups:events": {"table":"events","columns":["group_id","seq","event_id","agent_id","data_json","logical_bytes"]},
  "groups:groups": {"table":"groups","columns":["group_id","thread_id","boot_id","historical_only","created_at","byte_usage","data_json","logical_bytes"]},
  "groups:managed_resources": {"table":"managed_resources","columns":["resource_id","group_id","agent_id","data_json","logical_bytes"]},
  "groups:messages": {"table":"messages","columns":["message_id","group_id","sender_kind","sender_agent_id","sender_actor_id","receiver_id","delivery_state","claim_id","turn_id","created_at","data_json","logical_bytes"]},
  "groups:operations": {"table":"operations","columns":["group_id","operation_id","data_json","logical_bytes"]},
  "groups:root_turns": {"table":"root_turns","columns":["source_task_id","group_id","preparation_id","boot_id","data_json","logical_bytes"]},
  "groups:thread_bindings": {"table":"thread_bindings","columns":["thread_id","profile_id","workspace_id","cwd","active_group_id","thread_revision","delete_state","delete_json","pending_approval_count"]},
  "groups:workspace_execution_authorizations": {"table":"workspace_execution_authorizations","columns":["profile_id","workspace_id","permission_revision","execution_allowed","updated_at","actor_id","last_receipt_json"]},

  "codex-native:codex_native_sessions": {"table":"codex_native_sessions","columns":["id","owner","native_id","snapshot"]},
  "codex-routes:settings": {"table":"settings","columns":["key","value"]},
  "codex-routes:threads": {"table":"threads","columns":["id","native_id"]},
  "codex-routes:routes": {"table":"routes","columns":["task_id","thread_id"]},
  "loop:sqlite_sequence": {"table":"sqlite_sequence","columns":["name","seq"]},
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
  }
  ,"session:session_messages_fts": {"table":"session_messages_fts","columns":["rowid","session_id","message_index","text_content"]}
  ,"session:sqlite_sequence": {"table":"sqlite_sequence","columns":["name","seq"]}
} as const;
for (const query of Object.values(definitions)) { Object.freeze(query.columns); Object.freeze(query); }
export const METADATA_SESSION_QUERIES = Object.freeze(definitions);
export type MetadataSessionQueryId = keyof typeof METADATA_SESSION_QUERIES;
