export declare const LOOP_SOURCE_SCHEMAS: Readonly<{
    readonly loop: readonly [{
        readonly type: "index";
        readonly name: "idx_assistant_candidates_run";
        readonly tbl_name: "assistant_candidates";
        readonly sql: "CREATE INDEX idx_assistant_candidates_run on assistant_candidates(run_id)";
    }, {
        readonly type: "index";
        readonly name: "idx_assistant_candidates_status_created";
        readonly tbl_name: "assistant_candidates";
        readonly sql: "CREATE INDEX idx_assistant_candidates_status_created on assistant_candidates(status, created_at)";
    }, {
        readonly type: "index";
        readonly name: "idx_constraints_loop_active";
        readonly tbl_name: "loop_learned_constraints";
        readonly sql: "CREATE INDEX idx_constraints_loop_active on loop_learned_constraints(loop_id, active)";
    }, {
        readonly type: "index";
        readonly name: "idx_loop_definitions_status";
        readonly tbl_name: "loop_definitions";
        readonly sql: "CREATE INDEX idx_loop_definitions_status on loop_definitions(status)";
    }, {
        readonly type: "index";
        readonly name: "idx_loop_runs_loop_started";
        readonly tbl_name: "loop_runs";
        readonly sql: "CREATE INDEX idx_loop_runs_loop_started on loop_runs(loop_id, started_at)";
    }, {
        readonly type: "index";
        readonly name: "idx_loop_runs_stale";
        readonly tbl_name: "loop_runs";
        readonly sql: "CREATE INDEX idx_loop_runs_stale on loop_runs(status, started_at, updated_at)";
    }, {
        readonly type: "index";
        readonly name: "idx_loop_runs_success_logical_key";
        readonly tbl_name: "loop_runs";
        readonly sql: "CREATE UNIQUE INDEX idx_loop_runs_success_logical_key on loop_runs(loop_id, logical_run_key) where status = 'success' and logical_run_key is not null";
    }, {
        readonly type: "index";
        readonly name: "idx_loop_stages_run";
        readonly tbl_name: "loop_stages";
        readonly sql: "CREATE INDEX idx_loop_stages_run on loop_stages(run_id, created_at)";
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_assistant_candidates_1";
        readonly tbl_name: "assistant_candidates";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_assistant_profiles_1";
        readonly tbl_name: "assistant_profiles";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_assistant_promotion_intents_1";
        readonly tbl_name: "assistant_promotion_intents";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_automation_store_metadata_1";
        readonly tbl_name: "automation_store_metadata";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_artifact_exports_1";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_artifact_exports_2";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_definitions_1";
        readonly tbl_name: "loop_definitions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_learned_constraints_1";
        readonly tbl_name: "loop_learned_constraints";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_native_attempts_1";
        readonly tbl_name: "loop_native_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_native_attempts_2";
        readonly tbl_name: "loop_native_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_native_attempts_3";
        readonly tbl_name: "loop_native_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_native_attempts_4";
        readonly tbl_name: "loop_native_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_producer_results_1";
        readonly tbl_name: "loop_producer_results";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_projection_generations_1";
        readonly tbl_name: "loop_projection_generations";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_projection_origins_1";
        readonly tbl_name: "loop_projection_origins";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_attempts_1";
        readonly tbl_name: "loop_publication_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_attempts_2";
        readonly tbl_name: "loop_publication_attempts";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_candidate_members_1";
        readonly tbl_name: "loop_publication_candidate_members";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_candidates_1";
        readonly tbl_name: "loop_publication_candidates";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_candidates_2";
        readonly tbl_name: "loop_publication_candidates";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_publication_configs_1";
        readonly tbl_name: "loop_publication_configs";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_run_publication_basis_1";
        readonly tbl_name: "loop_run_publication_basis";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_runs_1";
        readonly tbl_name: "loop_runs";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_stage_execution_results_1";
        readonly tbl_name: "loop_stage_execution_results";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_stages_1";
        readonly tbl_name: "loop_stages";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_executions_1";
        readonly tbl_name: "loop_verification_executions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_executions_2";
        readonly tbl_name: "loop_verification_executions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_1";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_2";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_3";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_4";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_5";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_loop_verification_sessions_6";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_user_loop_templates_1";
        readonly tbl_name: "user_loop_templates";
        readonly sql: null;
    }, {
        readonly type: "table";
        readonly name: "assistant_candidates";
        readonly tbl_name: "assistant_candidates";
        readonly sql: "CREATE TABLE assistant_candidates ( id text primary key, run_id text not null, kind text not null, title text not null, content text not null, scope text not null, project_id text, confidence real not null, evidence_refs_json text not null, dedupe_key text not null, status text not null, target_kind text, target_id text, accepted_target_ref text, created_at integer not null, decided_at integer, foreign key(run_id) references loop_runs(id) )";
    }, {
        readonly type: "table";
        readonly name: "assistant_profiles";
        readonly tbl_name: "assistant_profiles";
        readonly sql: "CREATE TABLE assistant_profiles ( id text primary key, status text not null, locale text not null, time_zone text not null, evening_time text not null, morning_time text not null, workdays_json text not null, quiet_hours_json text not null, data_scopes_json text not null, created_at integer not null, updated_at integer not null )";
    }, {
        readonly type: "table";
        readonly name: "assistant_promotion_intents";
        readonly tbl_name: "assistant_promotion_intents";
        readonly sql: "CREATE TABLE assistant_promotion_intents ( candidate_id text primary key references assistant_candidates(id),revision integer not null,record_json text not null )";
    }, {
        readonly type: "table";
        readonly name: "automation_store_metadata";
        readonly tbl_name: "automation_store_metadata";
        readonly sql: "CREATE TABLE automation_store_metadata ( key text primary key, value integer not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_artifact_exports";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: "CREATE TABLE loop_artifact_exports ( sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), parent_device TEXT NOT NULL,parent_inode TEXT NOT NULL,temporary_name TEXT NOT NULL, record_json TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(parent_device,parent_inode,temporary_name))";
    }, {
        readonly type: "table";
        readonly name: "loop_definitions";
        readonly tbl_name: "loop_definitions";
        readonly sql: "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_learned_constraints";
        readonly tbl_name: "loop_learned_constraints";
        readonly sql: "CREATE TABLE loop_learned_constraints ( id text primary key, loop_id text not null, source text not null, rule text not null, source_run_id text not null, failure_kind text, failure_reason text, active integer not null default 0, hit_count integer not null default 0, consecutive_ineffective_count integer not null default 0, created_at integer not null, updated_at integer not null, last_hit_at integer, superseded_by text, deactivation_reason text, extraction_context text, foreign key(loop_id) references loop_definitions(id) )";
    }, {
        readonly type: "table";
        readonly name: "loop_native_attempts";
        readonly tbl_name: "loop_native_attempts";
        readonly sql: "CREATE TABLE \"loop_native_attempts\" ( attempt_id text primary key, candidate_id text not null references loop_publication_candidates(candidate_id), revision integer not null, ordinal integer not null, original_source text not null, binding_hash text not null, source_vector_hash text not null, configuration_revision integer not null, definition_hash text not null, enrollment_request_id text unique, application_request_id text not null unique, phase text not null, created_at integer not null, updated_at integer not null, kind text not null default 'enrollment-and-application', enrollment_source_attempt_id text references loop_native_attempts(attempt_id), reauthorizes_attempt_id text references loop_native_attempts(attempt_id), unique(candidate_id,ordinal), CHECK ((kind='enrollment-and-application' AND enrollment_request_id IS NOT NULL AND enrollment_source_attempt_id IS NULL AND reauthorizes_attempt_id IS NULL) OR (kind='application-reauthorization' AND enrollment_request_id IS NULL AND enrollment_source_attempt_id IS NOT NULL AND reauthorizes_attempt_id IS NOT NULL)) )";
    }, {
        readonly type: "table";
        readonly name: "loop_producer_results";
        readonly tbl_name: "loop_producer_results";
        readonly sql: "CREATE TABLE loop_producer_results ( run_id text primary key references loop_runs(id), revision integer not null, body_json text not null, body_hash text not null, stage_id text references loop_stages(id), evidence_ids_json text not null, terminal_at integer not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_projection_generations";
        readonly tbl_name: "loop_projection_generations";
        readonly sql: "CREATE TABLE loop_projection_generations ( run_id text not null references loop_projection_origins(run_id), generation integer not null, generation_hash text not null, record_json text not null, primary key(run_id,generation) )";
    }, {
        readonly type: "table";
        readonly name: "loop_projection_origins";
        readonly tbl_name: "loop_projection_origins";
        readonly sql: "CREATE TABLE loop_projection_origins ( run_id text primary key references loop_runs(id), origin_hash text not null, record_json text not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_publication_attempts";
        readonly tbl_name: "loop_publication_attempts";
        readonly sql: "CREATE TABLE loop_publication_attempts ( attempt_id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id), candidate_id text not null references loop_publication_candidates(candidate_id), sequence integer not null, revision integer not null, record_json text not null, unique(candidate_id,sequence) )";
    }, {
        readonly type: "table";
        readonly name: "loop_publication_candidate_members";
        readonly tbl_name: "loop_publication_candidate_members";
        readonly sql: "CREATE TABLE loop_publication_candidate_members ( candidate_id text not null references loop_publication_candidates(candidate_id), assistant_candidate_id text not null references assistant_candidates(id), original_row_json text not null, primary key(candidate_id,assistant_candidate_id) )";
    }, {
        readonly type: "table";
        readonly name: "loop_publication_candidates";
        readonly tbl_name: "loop_publication_candidates";
        readonly sql: "CREATE TABLE loop_publication_candidates ( candidate_id text primary key, run_id text not null references loop_runs(id), stage_id text references loop_stages(id), subject_key text not null, revision integer not null, binding_json text not null, binding_hash text not null, source_vector_hash text not null, publication_state text not null, created_at integer not null, unique(subject_key,revision) )";
    }, {
        readonly type: "table";
        readonly name: "loop_publication_configs";
        readonly tbl_name: "loop_publication_configs";
        readonly sql: "CREATE TABLE loop_publication_configs ( loop_id text primary key references loop_definitions(id), revision integer not null, configuration_json text not null, created_at integer not null, updated_at integer not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_run_publication_basis";
        readonly tbl_name: "loop_run_publication_basis";
        readonly sql: "CREATE TABLE loop_run_publication_basis ( run_id text primary key references loop_runs(id), basis_json text not null, basis_hash text not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_runs";
        readonly tbl_name: "loop_runs";
        readonly sql: "CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, duration_ms integer default 0, logical_run_key text, foreign key(loop_id) references loop_definitions(id) )";
    }, {
        readonly type: "table";
        readonly name: "loop_stage_execution_results";
        readonly tbl_name: "loop_stage_execution_results";
        readonly sql: "CREATE TABLE loop_stage_execution_results ( stage_id text primary key references loop_stages(id), run_id text not null references loop_runs(id), revision integer not null, body_json text not null, body_hash text not null, task_snapshot_json text not null, task_snapshot_hash text not null, evidence_ids_json text not null, terminal_at integer not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_stages";
        readonly tbl_name: "loop_stages";
        readonly sql: "CREATE TABLE loop_stages ( id text primary key, run_id text not null, loop_id text not null, stage_kind text not null, status text not null, started_at integer, finished_at integer, evidence_ids_json text not null default '[]', summary text, failure_kind text, message text, metadata_json text not null default '{}', created_at integer not null, updated_at integer not null, foreign key(run_id) references loop_runs(id), foreign key(loop_id) references loop_definitions(id) )";
    }, {
        readonly type: "table";
        readonly name: "loop_verification_executions";
        readonly tbl_name: "loop_verification_executions";
        readonly sql: "CREATE TABLE loop_verification_executions ( id text primary key, session_record_id text not null unique references loop_verification_sessions(id), revision integer not null, record_json text not null )";
    }, {
        readonly type: "table";
        readonly name: "loop_verification_sessions";
        readonly tbl_name: "loop_verification_sessions";
        readonly sql: "CREATE TABLE loop_verification_sessions ( id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id), candidate_id text not null references loop_publication_candidates(candidate_id), obligation_id text not null, session_id text not null unique, operation_id text not null unique, validation_invocation_id text not null unique, enrollment_request_id text not null unique, phase text not null, revision integer not null, created_at integer not null, updated_at integer not null, unique(native_attempt_id,obligation_id) )";
    }, {
        readonly type: "table";
        readonly name: "sqlite_sequence";
        readonly tbl_name: "sqlite_sequence";
        readonly sql: "CREATE TABLE sqlite_sequence(name,seq)";
    }, {
        readonly type: "table";
        readonly name: "user_loop_templates";
        readonly tbl_name: "user_loop_templates";
        readonly sql: "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, contract_schema_version text, created_at integer not null, updated_at integer not null, foreign key(loop_id) references loop_definitions(id) )";
    }, {
        readonly type: "trigger";
        readonly name: "loop_artifact_export_immutable";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: "CREATE TRIGGER loop_artifact_export_immutable BEFORE UPDATE ON loop_artifact_exports WHEN NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.parent_device IS NOT OLD.parent_device OR NEW.parent_inode IS NOT OLD.parent_inode OR NEW.temporary_name IS NOT OLD.temporary_name BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END";
    }, {
        readonly type: "trigger";
        readonly name: "loop_artifact_export_no_delete";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: "CREATE TRIGGER loop_artifact_export_no_delete BEFORE DELETE ON loop_artifact_exports BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END";
    }, {
        readonly type: "trigger";
        readonly name: "loop_artifact_export_no_replace";
        readonly tbl_name: "loop_artifact_exports";
        readonly sql: "CREATE TRIGGER loop_artifact_export_no_replace BEFORE INSERT ON loop_artifact_exports WHEN (NEW.sequence != -1 AND NEW.sequence <= (SELECT COALESCE(MAX(sequence),0) FROM loop_artifact_exports)) OR EXISTS(SELECT 1 FROM loop_artifact_exports WHERE id=NEW.id OR sequence=NEW.sequence OR (parent_device=NEW.parent_device AND parent_inode=NEW.parent_inode AND temporary_name=NEW.temporary_name)) BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END";
    }];
    readonly completion: readonly [{
        readonly type: "index";
        readonly name: "idx_completion_evidence_owner";
        readonly tbl_name: "completion_evidence";
        readonly sql: "CREATE INDEX idx_completion_evidence_owner on completion_evidence(owner_kind, owner_id, orphaned_at)";
    }, {
        readonly type: "index";
        readonly name: "idx_completion_expectations_owner";
        readonly tbl_name: "completion_expectations";
        readonly sql: "CREATE INDEX idx_completion_expectations_owner on completion_expectations(owner_kind, owner_id)";
    }, {
        readonly type: "index";
        readonly name: "idx_completion_records_filter";
        readonly tbl_name: "completion_records";
        readonly sql: "CREATE INDEX idx_completion_records_filter on completion_records(owner_kind, owner_id, status, created_at)";
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_completion_evidence_1";
        readonly tbl_name: "completion_evidence";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_completion_expectations_1";
        readonly tbl_name: "completion_expectations";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_completion_expectations_2";
        readonly tbl_name: "completion_expectations";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_completion_records_1";
        readonly tbl_name: "completion_records";
        readonly sql: null;
    }, {
        readonly type: "table";
        readonly name: "completion_evidence";
        readonly tbl_name: "completion_evidence";
        readonly sql: "CREATE TABLE completion_evidence ( id text primary key, schema_version integer not null, owner_kind text not null, owner_id text not null, kind text not null, summary text not null, uri text, metadata_json text not null, created_at integer not null, orphaned_at integer )";
    }, {
        readonly type: "table";
        readonly name: "completion_expectations";
        readonly tbl_name: "completion_expectations";
        readonly sql: "CREATE TABLE completion_expectations ( id text primary key, schema_version integer not null, owner_kind text not null, owner_id text not null, expected_kinds_json text not null, source text not null, confidence text not null, metadata_json text not null, created_at integer not null, updated_at integer not null, unique(owner_kind, owner_id) )";
    }, {
        readonly type: "table";
        readonly name: "completion_records";
        readonly tbl_name: "completion_records";
        readonly sql: "CREATE TABLE completion_records ( id text primary key, owner_kind text not null, owner_id text not null, status text not null, ok integer not null, failure_kind text, message text, expectation_id text, evidence_ids_json text not null, created_at integer not null )";
    }];
    readonly scanner: readonly [{
        readonly type: "index";
        readonly name: "idx_evidence_anomalies_owner";
        readonly tbl_name: "evidence_anomalies";
        readonly sql: "CREATE INDEX idx_evidence_anomalies_owner on evidence_anomalies(loop_id, owner_kind, owner_id)";
    }, {
        readonly type: "index";
        readonly name: "idx_evidence_anomalies_status";
        readonly tbl_name: "evidence_anomalies";
        readonly sql: "CREATE INDEX idx_evidence_anomalies_status on evidence_anomalies(loop_id, status, last_seen_at)";
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_evidence_anomalies_1";
        readonly tbl_name: "evidence_anomalies";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_evidence_anomalies_2";
        readonly tbl_name: "evidence_anomalies";
        readonly sql: null;
    }, {
        readonly type: "table";
        readonly name: "evidence_anomalies";
        readonly tbl_name: "evidence_anomalies";
        readonly sql: "CREATE TABLE evidence_anomalies ( id text primary key, loop_id text not null, owner_kind text not null, owner_id text not null, kind text not null, status text not null, first_seen_at integer not null, last_seen_at integer not null, last_resolved_at integer, seen_count integer not null, ignored_until integer, message text not null, evidence_ids_json text not null, metadata_json text not null default '{}', unique(loop_id, owner_kind, owner_id, kind) )";
    }];
}>;
export declare const LOOP_SOURCE_MIGRATED_TABLES: Readonly<{
    readonly loop_definitions: readonly ["CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', deleted_at integer, delete_reason text)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, delete_reason text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', deleted_at integer)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, deleted_at integer, created_at integer not null, updated_at integer not null , origin text not null default 'built_in', delete_reason text)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null , origin text not null default 'built_in')", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, created_at integer not null, updated_at integer not null , deleted_at integer, delete_reason text)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, delete_reason text, created_at integer not null, updated_at integer not null , deleted_at integer)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, created_at integer not null, updated_at integer not null , delete_reason text)", "CREATE TABLE loop_definitions ( id text primary key, title text not null, description text not null, status text not null, origin text not null default 'built_in', active_run_id text, deleted_at integer, delete_reason text, created_at integer not null, updated_at integer not null )"];
    readonly loop_runs: readonly ["CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, duration_ms integer default 0, logical_run_key text, foreign key(loop_id) references loop_definitions(id) )", "CREATE TABLE loop_runs ( id text primary key, loop_id text not null, status text not null, trigger_json text not null, evidence_ids_json text not null, started_at integer not null, finished_at integer, updated_at integer not null, failure_kind text, message text, summary text, next_action_kind text, next_action_summary text, logical_run_key text, duration_ms integer default 0, foreign key(loop_id) references loop_definitions(id) )"];
    readonly user_loop_templates: readonly ["CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, contract_schema_version text, created_at integer not null, updated_at integer not null, foreign key(loop_id) references loop_definitions(id) )", "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_json text, created_at integer not null, updated_at integer not null, contract_schema_version text, foreign key(loop_id) references loop_definitions(id) )", "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, contract_schema_version text, created_at integer not null, updated_at integer not null, contract_json text, foreign key(loop_id) references loop_definitions(id) )", "CREATE TABLE user_loop_templates ( loop_id text primary key, kind text not null, prompt text not null, output_directory text not null, output_file_name text not null, schedule_action_id text, schedule_enabled integer not null default 0, schedule_trigger_json text, auto_run_approved integer not null default 0, created_at integer not null, updated_at integer not null, contract_json text, contract_schema_version text, foreign key(loop_id) references loop_definitions(id) )"];
}>;
export declare const LOOP_SOURCE_COLUMN_TYPES: Readonly<{
    readonly assistant_candidates: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "title";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "content";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "scope";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "project_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "confidence";
        readonly type: "REAL";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "evidence_refs_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "dedupe_key";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "target_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "target_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "accepted_target_ref";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "decided_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly assistant_profiles: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "locale";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "time_zone";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "evening_time";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "morning_time";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "workdays_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "quiet_hours_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "data_scopes_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly assistant_promotion_intents: readonly [{
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly automation_store_metadata: readonly [{
        readonly name: "key";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "value";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_artifact_exports: readonly [{
        readonly name: "sequence";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "parent_device";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "parent_inode";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "temporary_name";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_definitions: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "title";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "description";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "origin";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "active_run_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "deleted_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "delete_reason";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_learned_constraints: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "source";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "rule";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "source_run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "failure_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "failure_reason";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "active";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "hit_count";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "consecutive_ineffective_count";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "last_hit_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "superseded_by";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "deactivation_reason";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "extraction_context";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly loop_native_attempts: readonly [{
        readonly name: "attempt_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "ordinal";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "original_source";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "binding_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "source_vector_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "configuration_revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "definition_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "enrollment_request_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "application_request_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "phase";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "enrollment_source_attempt_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "reauthorizes_attempt_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly loop_producer_results: readonly [{
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "body_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "body_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "stage_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "terminal_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_projection_generations: readonly [{
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 1;
    }, {
        readonly name: "generation";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 2;
    }, {
        readonly name: "generation_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_projection_origins: readonly [{
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "origin_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_publication_attempts: readonly [{
        readonly name: "attempt_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "native_attempt_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "sequence";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_publication_candidate_members: readonly [{
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 1;
    }, {
        readonly name: "assistant_candidate_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 2;
    }, {
        readonly name: "original_row_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_publication_candidates: readonly [{
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "stage_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "subject_key";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "binding_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "binding_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "source_vector_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "publication_state";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_publication_configs: readonly [{
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "configuration_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_run_publication_basis: readonly [{
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "basis_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "basis_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_runs: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "trigger_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "started_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "finished_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "failure_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "message";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "summary";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "next_action_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "next_action_summary";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "duration_ms";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "logical_run_key";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly loop_stage_execution_results: readonly [{
        readonly name: "stage_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "body_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "body_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "task_snapshot_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "task_snapshot_hash";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "terminal_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_stages: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "run_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "stage_kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "started_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "finished_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "summary";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "failure_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "message";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "metadata_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_verification_executions: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "session_record_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "record_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly loop_verification_sessions: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "native_attempt_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "candidate_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "obligation_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "session_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "operation_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "validation_invocation_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "enrollment_request_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "phase";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly sqlite_sequence: readonly [{
        readonly name: "name";
        readonly type: "";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "seq";
        readonly type: "";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly user_loop_templates: readonly [{
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "prompt";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "output_directory";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "output_file_name";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "schedule_action_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "schedule_enabled";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "schedule_trigger_json";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "auto_run_approved";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "contract_json";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "contract_schema_version";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly completion_evidence: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "schema_version";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "summary";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "uri";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "metadata_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "orphaned_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }];
    readonly completion_expectations: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "schema_version";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "expected_kinds_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "source";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "confidence";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "metadata_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "updated_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly completion_records: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "owner_kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "ok";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "failure_kind";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "message";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "expectation_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "created_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }];
    readonly evidence_anomalies: readonly [{
        readonly name: "id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly pk: 1;
    }, {
        readonly name: "loop_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "owner_id";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "kind";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "status";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "first_seen_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "last_seen_at";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "last_resolved_at";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "seen_count";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "ignored_until";
        readonly type: "INTEGER";
        readonly notnull: 0;
        readonly pk: 0;
    }, {
        readonly name: "message";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "evidence_ids_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }, {
        readonly name: "metadata_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly pk: 0;
    }];
}>;
