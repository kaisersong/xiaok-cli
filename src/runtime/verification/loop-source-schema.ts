/** Complete original constructor/migration sqlite_master comparison data.
 * Generated through actual Loop/Completion/scanner constructors; not SQL to execute. */
import {freezeCapturedData} from './captured-source-json.js';
export const LOOP_SOURCE_SCHEMAS = freezeCapturedData({
  "loop": [
    {
      "type": "index",
      "name": "idx_assistant_candidates_run",
      "tbl_name": "assistant_candidates",
      "sql": "CREATE INDEX idx_assistant_candidates_run on assistant_candidates(run_id)"
    },
    {
      "type": "index",
      "name": "idx_assistant_candidates_status_created",
      "tbl_name": "assistant_candidates",
      "sql": "CREATE INDEX idx_assistant_candidates_status_created on assistant_candidates(status, created_at)"
    },
    {
      "type": "index",
      "name": "idx_constraints_loop_active",
      "tbl_name": "loop_learned_constraints",
      "sql": "CREATE INDEX idx_constraints_loop_active on loop_learned_constraints(loop_id, active)"
    },
    {
      "type": "index",
      "name": "idx_loop_definitions_status",
      "tbl_name": "loop_definitions",
      "sql": "CREATE INDEX idx_loop_definitions_status on loop_definitions(status)"
    },
    {
      "type": "index",
      "name": "idx_loop_runs_loop_started",
      "tbl_name": "loop_runs",
      "sql": "CREATE INDEX idx_loop_runs_loop_started on loop_runs(loop_id, started_at)"
    },
    {
      "type": "index",
      "name": "idx_loop_runs_stale",
      "tbl_name": "loop_runs",
      "sql": "CREATE INDEX idx_loop_runs_stale on loop_runs(status, started_at, updated_at)"
    },
    {
      "type": "index",
      "name": "idx_loop_runs_success_logical_key",
      "tbl_name": "loop_runs",
      "sql": "CREATE UNIQUE INDEX idx_loop_runs_success_logical_key on loop_runs(loop_id, logical_run_key) where status = 'success' and logical_run_key is not null"
    },
    {
      "type": "index",
      "name": "idx_loop_stages_run",
      "tbl_name": "loop_stages",
      "sql": "CREATE INDEX idx_loop_stages_run on loop_stages(run_id, created_at)"
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_assistant_candidates_1",
      "tbl_name": "assistant_candidates",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_assistant_profiles_1",
      "tbl_name": "assistant_profiles",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_assistant_promotion_intents_1",
      "tbl_name": "assistant_promotion_intents",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_automation_store_metadata_1",
      "tbl_name": "automation_store_metadata",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_artifact_exports_1",
      "tbl_name": "loop_artifact_exports",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_artifact_exports_2",
      "tbl_name": "loop_artifact_exports",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_definitions_1",
      "tbl_name": "loop_definitions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_learned_constraints_1",
      "tbl_name": "loop_learned_constraints",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_native_attempts_1",
      "tbl_name": "loop_native_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_native_attempts_2",
      "tbl_name": "loop_native_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_native_attempts_3",
      "tbl_name": "loop_native_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_native_attempts_4",
      "tbl_name": "loop_native_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_producer_results_1",
      "tbl_name": "loop_producer_results",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_projection_generations_1",
      "tbl_name": "loop_projection_generations",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_projection_origins_1",
      "tbl_name": "loop_projection_origins",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_attempts_1",
      "tbl_name": "loop_publication_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_attempts_2",
      "tbl_name": "loop_publication_attempts",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_candidate_members_1",
      "tbl_name": "loop_publication_candidate_members",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_candidates_1",
      "tbl_name": "loop_publication_candidates",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_candidates_2",
      "tbl_name": "loop_publication_candidates",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_publication_configs_1",
      "tbl_name": "loop_publication_configs",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_run_publication_basis_1",
      "tbl_name": "loop_run_publication_basis",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_runs_1",
      "tbl_name": "loop_runs",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_stage_execution_results_1",
      "tbl_name": "loop_stage_execution_results",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_stages_1",
      "tbl_name": "loop_stages",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_executions_1",
      "tbl_name": "loop_verification_executions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_executions_2",
      "tbl_name": "loop_verification_executions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_1",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_2",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_3",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_4",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_5",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_loop_verification_sessions_6",
      "tbl_name": "loop_verification_sessions",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_user_loop_templates_1",
      "tbl_name": "user_loop_templates",
      "sql": null
    },
    {
      "type": "table",
      "name": "assistant_candidates",
      "tbl_name": "assistant_candidates",
      "sql": "CREATE TABLE assistant_candidates ( id text primary key, run_id text not null, kind text not null, title text not null, content text not null, scope text not null, project_id text, confidence real not null, evidence_refs_json text not null, dedupe_key text not null, status text not null, target_kind text, target_id text, accepted_target_ref text, created_at integer not null, decided_at integer, foreign key(run_id) references loop_runs(id) )"
    },
    {
      "type": "table",
      "name": "assistant_profiles",
      "tbl_name": "assistant_profiles",
      "sql": "CREATE TABLE assistant_profiles ( id text primary key, status text not null, locale text not null, time_zone text not null, evening_time text not null, morning_time text not null, workdays_json text not null, quiet_hours_json text not null, data_scopes_json text not null, created_at integer not null, updated_at integer not null )"
    },
    {
      "type": "table",
      "name": "assistant_promotion_intents",
      "tbl_name": "assistant_promotion_intents",
      "sql": "CREATE TABLE assistant_promotion_intents ( candidate_id text primary key references assistant_candidates(id),revision integer not null,record_json text not null )"
    },
    {
      "type": "table",
      "name": "automation_store_metadata",
      "tbl_name": "automation_store_metadata",
      "sql": "CREATE TABLE automation_store_metadata ( key text primary key, value integer not null )"
    },
    {
      "type": "table",
      "name": "loop_artifact_exports",
      "tbl_name": "loop_artifact_exports",
      "sql": "CREATE TABLE loop_artifact_exports ( sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), parent_device TEXT NOT NULL,parent_inode TEXT NOT NULL,temporary_name TEXT NOT NULL, record_json TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(parent_device,parent_inode,temporary_name))"
    },
    {
      "type": "table",
      "name": "loop_definitions",
      "tbl_name": "loop_definitions",
      "sql": "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null )"
    },
    {
      "type": "table",
      "name": "loop_learned_constraints",
      "tbl_name": "loop_learned_constraints",
      "sql": "CREATE TABLE loop_learned_constraints ( id text primary key, loop_id text not null, source text not null, rule text not null, source_run_id text not null, failure_kind text, failure_reason text, active integer not null default 0, hit_count integer not null default 0, consecutive_ineffective_count integer not null default 0, created_at integer not null, updated_at integer not null, last_hit_at integer, superseded_by text, deactivation_reason text, extraction_context text, foreign key(loop_id) references loop_definitions(id) )"
    },
    {
      "type": "table",
      "name": "loop_native_attempts",
      "tbl_name": "loop_native_attempts",
      "sql": "CREATE TABLE \"loop_native_attempts\" ( attempt_id text primary key, candidate_id text not null references loop_publication_candidates(candidate_id), revision integer not null, ordinal integer not null, original_source text not null, binding_hash text not null, source_vector_hash text not null, configuration_revision integer not null, definition_hash text not null, enrollment_request_id text unique, application_request_id text not null unique, phase text not null, created_at integer not null, updated_at integer not null, kind text not null default 'enrollment-and-application', enrollment_source_attempt_id text references loop_native_attempts(attempt_id), reauthorizes_attempt_id text references loop_native_attempts(attempt_id), unique(candidate_id,ordinal), CHECK ((kind='enrollment-and-application' AND enrollment_request_id IS NOT NULL AND enrollment_source_attempt_id IS NULL AND reauthorizes_attempt_id IS NULL) OR (kind='application-reauthorization' AND enrollment_request_id IS NULL AND enrollment_source_attempt_id IS NOT NULL AND reauthorizes_attempt_id IS NOT NULL)) )"
    },
    {
      "type": "table",
      "name": "loop_producer_results",
      "tbl_name": "loop_producer_results",
      "sql": "CREATE TABLE loop_producer_results ( run_id text primary key references loop_runs(id), revision integer not null, body_json text not null, body_hash text not null, stage_id text references loop_stages(id), evidence_ids_json text not null, terminal_at integer not null )"
    },
    {
      "type": "table",
      "name": "loop_projection_generations",
      "tbl_name": "loop_projection_generations",
      "sql": "CREATE TABLE loop_projection_generations ( run_id text not null references loop_projection_origins(run_id), generation integer not null, generation_hash text not null, record_json text not null, primary key(run_id,generation) )"
    },
    {
      "type": "table",
      "name": "loop_projection_origins",
      "tbl_name": "loop_projection_origins",
      "sql": "CREATE TABLE loop_projection_origins ( run_id text primary key references loop_runs(id), origin_hash text not null, record_json text not null )"
    },
    {
      "type": "table",
      "name": "loop_publication_attempts",
      "tbl_name": "loop_publication_attempts",
      "sql": "CREATE TABLE loop_publication_attempts ( attempt_id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id), candidate_id text not null references loop_publication_candidates(candidate_id), sequence integer not null, revision integer not null, record_json text not null, unique(candidate_id,sequence) )"
    },
    {
      "type": "table",
      "name": "loop_publication_candidate_members",
      "tbl_name": "loop_publication_candidate_members",
      "sql": "CREATE TABLE loop_publication_candidate_members ( candidate_id text not null references loop_publication_candidates(candidate_id), assistant_candidate_id text not null references assistant_candidates(id), original_row_json text not null, primary key(candidate_id,assistant_candidate_id) )"
    },
    {
      "type": "table",
      "name": "loop_publication_candidates",
      "tbl_name": "loop_publication_candidates",
      "sql": "CREATE TABLE loop_publication_candidates ( candidate_id text primary key, run_id text not null references loop_runs(id), stage_id text references loop_stages(id), subject_key text not null, revision integer not null, binding_json text not null, binding_hash text not null, source_vector_hash text not null, publication_state text not null, created_at integer not null, unique(subject_key,revision) )"
    },
    {
      "type": "table",
      "name": "loop_publication_configs",
      "tbl_name": "loop_publication_configs",
      "sql": "CREATE TABLE loop_publication_configs ( loop_id text primary key references loop_definitions(id), revision integer not null, configuration_json text not null, created_at integer not null, updated_at integer not null )"
    },
    {
      "type": "table",
      "name": "loop_run_publication_basis",
      "tbl_name": "loop_run_publication_basis",
      "sql": "CREATE TABLE loop_run_publication_basis ( run_id text primary key references loop_runs(id), basis_json text not null, basis_hash text not null )"
    },
    {
      "type": "table",
      "name": "loop_runs",
      "tbl_name": "loop_runs",
      "sql": "CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, duration_ms integer default 0, logical_run_key text, foreign key(loop_id) references loop_definitions(id) )"
    },
    {
      "type": "table",
      "name": "loop_stage_execution_results",
      "tbl_name": "loop_stage_execution_results",
      "sql": "CREATE TABLE loop_stage_execution_results ( stage_id text primary key references loop_stages(id), run_id text not null references loop_runs(id), revision integer not null, body_json text not null, body_hash text not null, task_snapshot_json text not null, task_snapshot_hash text not null, evidence_ids_json text not null, terminal_at integer not null )"
    },
    {
      "type": "table",
      "name": "loop_stages",
      "tbl_name": "loop_stages",
      "sql": "CREATE TABLE loop_stages ( id text primary key, run_id text not null, loop_id text not null, stage_kind text not null, status text not null, started_at integer, finished_at integer, evidence_ids_json text not null default '[]', summary text, failure_kind text, message text, metadata_json text not null default '{}', created_at integer not null, updated_at integer not null, foreign key(run_id) references loop_runs(id), foreign key(loop_id) references loop_definitions(id) )"
    },
    {
      "type": "table",
      "name": "loop_verification_executions",
      "tbl_name": "loop_verification_executions",
      "sql": "CREATE TABLE loop_verification_executions ( id text primary key, session_record_id text not null unique references loop_verification_sessions(id), revision integer not null, record_json text not null )"
    },
    {
      "type": "table",
      "name": "loop_verification_sessions",
      "tbl_name": "loop_verification_sessions",
      "sql": "CREATE TABLE loop_verification_sessions ( id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id), candidate_id text not null references loop_publication_candidates(candidate_id), obligation_id text not null, session_id text not null unique, operation_id text not null unique, validation_invocation_id text not null unique, enrollment_request_id text not null unique, phase text not null, revision integer not null, created_at integer not null, updated_at integer not null, unique(native_attempt_id,obligation_id) )"
    },
    {
      "type": "table",
      "name": "sqlite_sequence",
      "tbl_name": "sqlite_sequence",
      "sql": "CREATE TABLE sqlite_sequence(name,seq)"
    },
    {
      "type": "table",
      "name": "user_loop_templates",
      "tbl_name": "user_loop_templates",
      "sql": "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, contract_schema_version text, created_at integer not null, updated_at integer not null, foreign key(loop_id) references loop_definitions(id) )"
    },
    {
      "type": "trigger",
      "name": "loop_artifact_export_immutable",
      "tbl_name": "loop_artifact_exports",
      "sql": "CREATE TRIGGER loop_artifact_export_immutable BEFORE UPDATE ON loop_artifact_exports WHEN NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.parent_device IS NOT OLD.parent_device OR NEW.parent_inode IS NOT OLD.parent_inode OR NEW.temporary_name IS NOT OLD.temporary_name BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END"
    },
    {
      "type": "trigger",
      "name": "loop_artifact_export_no_delete",
      "tbl_name": "loop_artifact_exports",
      "sql": "CREATE TRIGGER loop_artifact_export_no_delete BEFORE DELETE ON loop_artifact_exports BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END"
    },
    {
      "type": "trigger",
      "name": "loop_artifact_export_no_replace",
      "tbl_name": "loop_artifact_exports",
      "sql": "CREATE TRIGGER loop_artifact_export_no_replace BEFORE INSERT ON loop_artifact_exports WHEN (NEW.sequence != -1 AND NEW.sequence <= (SELECT COALESCE(MAX(sequence),0) FROM loop_artifact_exports)) OR EXISTS(SELECT 1 FROM loop_artifact_exports WHERE id=NEW.id OR sequence=NEW.sequence OR (parent_device=NEW.parent_device AND parent_inode=NEW.parent_inode AND temporary_name=NEW.temporary_name)) BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END"
    }
  ],
  "completion": [
    {
      "type": "index",
      "name": "idx_completion_evidence_owner",
      "tbl_name": "completion_evidence",
      "sql": "CREATE INDEX idx_completion_evidence_owner on completion_evidence(owner_kind, owner_id, orphaned_at)"
    },
    {
      "type": "index",
      "name": "idx_completion_expectations_owner",
      "tbl_name": "completion_expectations",
      "sql": "CREATE INDEX idx_completion_expectations_owner on completion_expectations(owner_kind, owner_id)"
    },
    {
      "type": "index",
      "name": "idx_completion_records_filter",
      "tbl_name": "completion_records",
      "sql": "CREATE INDEX idx_completion_records_filter on completion_records(owner_kind, owner_id, status, created_at)"
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_completion_evidence_1",
      "tbl_name": "completion_evidence",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_completion_expectations_1",
      "tbl_name": "completion_expectations",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_completion_expectations_2",
      "tbl_name": "completion_expectations",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_completion_records_1",
      "tbl_name": "completion_records",
      "sql": null
    },
    {
      "type": "table",
      "name": "completion_evidence",
      "tbl_name": "completion_evidence",
      "sql": "CREATE TABLE completion_evidence ( id text primary key, schema_version integer not null, owner_kind text not null, owner_id text not null, kind text not null, summary text not null, uri text, metadata_json text not null, created_at integer not null, orphaned_at integer )"
    },
    {
      "type": "table",
      "name": "completion_expectations",
      "tbl_name": "completion_expectations",
      "sql": "CREATE TABLE completion_expectations ( id text primary key, schema_version integer not null, owner_kind text not null, owner_id text not null, expected_kinds_json text not null, source text not null, confidence text not null, metadata_json text not null, created_at integer not null, updated_at integer not null, unique(owner_kind, owner_id) )"
    },
    {
      "type": "table",
      "name": "completion_records",
      "tbl_name": "completion_records",
      "sql": "CREATE TABLE completion_records ( id text primary key, owner_kind text not null, owner_id text not null, status text not null, ok integer not null, failure_kind text, message text, expectation_id text, evidence_ids_json text not null, created_at integer not null )"
    }
  ],
  "scanner": [
    {
      "type": "index",
      "name": "idx_evidence_anomalies_owner",
      "tbl_name": "evidence_anomalies",
      "sql": "CREATE INDEX idx_evidence_anomalies_owner on evidence_anomalies(loop_id, owner_kind, owner_id)"
    },
    {
      "type": "index",
      "name": "idx_evidence_anomalies_status",
      "tbl_name": "evidence_anomalies",
      "sql": "CREATE INDEX idx_evidence_anomalies_status on evidence_anomalies(loop_id, status, last_seen_at)"
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_evidence_anomalies_1",
      "tbl_name": "evidence_anomalies",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_evidence_anomalies_2",
      "tbl_name": "evidence_anomalies",
      "sql": null
    },
    {
      "type": "table",
      "name": "evidence_anomalies",
      "tbl_name": "evidence_anomalies",
      "sql": "CREATE TABLE evidence_anomalies ( id text primary key, loop_id text not null, owner_kind text not null, owner_id text not null, kind text not null, status text not null, first_seen_at integer not null, last_seen_at integer not null, last_resolved_at integer, seen_count integer not null, ignored_until integer, message text not null, evidence_ids_json text not null, metadata_json text not null default '{}', unique(loop_id, owner_kind, owner_id, kind) )"
    }
  ]
} as const);
export const LOOP_SOURCE_MIGRATED_TABLES = freezeCapturedData({
  "loop_definitions": [
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', deleted_at integer, delete_reason text)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, delete_reason text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', deleted_at integer)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, deleted_at integer, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', delete_reason text)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in')",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, created_at integer not null, updated_at integer not null , deleted_at integer, delete_reason text)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, delete_reason text, created_at integer not null, updated_at integer not null , deleted_at integer)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, created_at integer not null, updated_at integer not null , delete_reason text)",
    "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null )"
  ],
  "loop_runs": [
    "CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, duration_ms integer default 0, logical_run_key text, foreign key(loop_id) references loop_definitions(id) )",
    "CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, logical_run_key text, duration_ms integer default 0, foreign key(loop_id) references loop_definitions(id) )"
  ],
  "user_loop_templates": [
    "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, contract_schema_version text, created_at integer not null, updated_at integer not null, foreign key(loop_id) references loop_definitions(id) )",
    "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, created_at integer not null, updated_at integer not null, contract_schema_version text, foreign key(loop_id) references loop_definitions(id) )",
    "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_schema_version text, created_at integer not null, updated_at integer not null, contract_json text, foreign key(loop_id) references loop_definitions(id) )",
    "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, created_at integer not null, updated_at integer not null, contract_json text, contract_schema_version text, foreign key(loop_id) references loop_definitions(id) )"
  ]
} as const);
export const LOOP_SOURCE_COLUMN_TYPES = freezeCapturedData({
  "assistant_candidates": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "title",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "content",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "scope",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "project_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "confidence",
      "type": "REAL",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "evidence_refs_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "dedupe_key",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "target_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "target_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "accepted_target_ref",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "decided_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    }
  ],
  "assistant_profiles": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "locale",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "time_zone",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "evening_time",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "morning_time",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "workdays_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "quiet_hours_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "data_scopes_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "assistant_promotion_intents": [
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "automation_store_metadata": [
    {
      "name": "key",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "value",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_artifact_exports": [
    {
      "name": "sequence",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "parent_device",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "parent_inode",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "temporary_name",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_definitions": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "title",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "description",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "origin",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "active_run_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "deleted_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "delete_reason",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_learned_constraints": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "source",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "rule",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "source_run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "failure_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "failure_reason",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "active",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "hit_count",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "consecutive_ineffective_count",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "last_hit_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "superseded_by",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "deactivation_reason",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "extraction_context",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    }
  ],
  "loop_native_attempts": [
    {
      "name": "attempt_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "ordinal",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "original_source",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "binding_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "source_vector_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "configuration_revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "definition_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "enrollment_request_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "application_request_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "phase",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "enrollment_source_attempt_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "reauthorizes_attempt_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    }
  ],
  "loop_producer_results": [
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "body_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "body_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "stage_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "terminal_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_projection_generations": [
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 1
    },
    {
      "name": "generation",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 2
    },
    {
      "name": "generation_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_projection_origins": [
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "origin_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_publication_attempts": [
    {
      "name": "attempt_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "native_attempt_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "sequence",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_publication_candidate_members": [
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 1
    },
    {
      "name": "assistant_candidate_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 2
    },
    {
      "name": "original_row_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_publication_candidates": [
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "stage_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "subject_key",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "binding_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "binding_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "source_vector_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "publication_state",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_publication_configs": [
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "configuration_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_run_publication_basis": [
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "basis_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "basis_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_runs": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "trigger_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "started_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "finished_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "failure_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "message",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "summary",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "next_action_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "next_action_summary",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "duration_ms",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "logical_run_key",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    }
  ],
  "loop_stage_execution_results": [
    {
      "name": "stage_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "body_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "body_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "task_snapshot_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "task_snapshot_hash",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "terminal_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_stages": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "run_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "stage_kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "started_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "finished_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "summary",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "failure_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "message",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "metadata_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_verification_executions": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "session_record_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "record_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ],
  "loop_verification_sessions": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "native_attempt_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "candidate_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "obligation_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "session_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "operation_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "validation_invocation_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "enrollment_request_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "phase",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "sqlite_sequence": [
    {
      "name": "name",
      "type": "",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "seq",
      "type": "",
      "notnull": 0,
      "pk": 0
    }
  ],
  "user_loop_templates": [
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "prompt",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "output_directory",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "output_file_name",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "schedule_action_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "schedule_enabled",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "schedule_trigger_json",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "auto_run_approved",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "contract_json",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "contract_schema_version",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "completion_evidence": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "schema_version",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "summary",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "uri",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "metadata_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "orphaned_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    }
  ],
  "completion_expectations": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "schema_version",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "expected_kinds_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "source",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "confidence",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "metadata_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "updated_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "completion_records": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "owner_kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "ok",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "failure_kind",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "message",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "expectation_id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "created_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    }
  ],
  "evidence_anomalies": [
    {
      "name": "id",
      "type": "TEXT",
      "notnull": 0,
      "pk": 1
    },
    {
      "name": "loop_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "owner_id",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "kind",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "status",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "first_seen_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "last_seen_at",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "last_resolved_at",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "seen_count",
      "type": "INTEGER",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "ignored_until",
      "type": "INTEGER",
      "notnull": 0,
      "pk": 0
    },
    {
      "name": "message",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "evidence_ids_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    },
    {
      "name": "metadata_json",
      "type": "TEXT",
      "notnull": 1,
      "pk": 0
    }
  ]
} as const);
