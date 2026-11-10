import {parseMandateProjection} from '../admission/parse.js';
import { canonicalVerificationJson } from "../verification/protocol.js";
import {
  DSH_A_PROFILE,
  DSH_A_DIGEST,
  dshAHash,
  dshAFields,
  dshABinding,
  dshASourceKey,
  dshARevision,
} from "./dsh-admission-data.js";

/** Original groups.sqlite child protocol only; none of these data values grant
 * Native Main, provider, budget, model, Host or runtime authority. */
export const DSH_A_AUTHORITY_PROFILE = "main_dsh_admission_authority_v1";
export const DSH_A_AUTHORITY_DIGEST =
  "a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549";
export const DSH_A_AUTHORITY_FUNCTION = "xiaok_main_dsh_admission_authority_v1";
export const DSH_A_AUTHORITY_OPERATION_FUNCTION =
  "xiaok_main_dsh_admission_operation_v1";
export const DSH_A_AUTHORITY_DDL = `-- A6 new tables only. Existing A1 schema5 inherited verbatim; migration floor swap is specified in exact-contract.md.

-- All FOREIGN KEY actions default NO ACTION. No CASCADE; no generic operation/payload registry.

PRAGMA foreign_keys=ON;

CREATE TABLE dsh_a_profile_migrations(
  migration_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  from_version INTEGER NOT NULL CHECK(from_version=5),
  from_profile TEXT NOT NULL,
  from_digest TEXT NOT NULL,
  to_version INTEGER NOT NULL CHECK(to_version=6),
  to_profile TEXT NOT NULL,
  to_digest TEXT NOT NULL,
  ddl_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0)
);

CREATE TABLE dsh_a_domains(
  scope_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  budget_owner_id TEXT,
  budget_account_id TEXT,
  budget_unit_profile TEXT,
  authority_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1),
  revision INTEGER NOT NULL CHECK(revision>=1),
  state TEXT NOT NULL CHECK(state IN ('off','pending_baseline','active','narrowing')),
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  CHECK((budget_owner_id IS NULL AND budget_account_id IS NULL AND budget_unit_profile IS NULL AND state IN ('off','pending_baseline')) OR (budget_owner_id IS NOT NULL AND length(budget_owner_id)>0 AND budget_account_id IS NOT NULL AND length(budget_account_id)>0 AND budget_unit_profile='dsh_budget_usd_micros_v1')),
  UNIQUE(profile_id,workspace_id)
);

CREATE TABLE dsh_a_source_configurations(
 binding_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 scope_id TEXT NOT NULL,
 configuration_hash TEXT NOT NULL,
 data_json TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
 PRIMARY KEY(binding_id,revision),
 FOREIGN KEY(binding_id) REFERENCES dsh_a_source_bindings(binding_id),
 FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id)
);
CREATE TABLE dsh_a_source_configuration_heads(
 binding_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>=1),
 data_json TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
 FOREIGN KEY(binding_id,revision) REFERENCES dsh_a_source_configurations(binding_id,revision)
);

CREATE TABLE dsh_a_owner_domains(
  scope_id TEXT NOT NULL,
  owner_domain TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('work','egress_gate','active_pointer')),
  registration_ref TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,owner_domain),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id)
);

CREATE TABLE dsh_a_mandates(
  scope_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  mandate_revision INTEGER NOT NULL CHECK(mandate_revision>=1),
  source_binding_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,mandate_id,mandate_revision),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id),
  FOREIGN KEY(source_binding_id) REFERENCES dsh_a_source_bindings(binding_id)
);

CREATE TABLE dsh_a_mandate_heads(
  scope_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  mandate_revision INTEGER NOT NULL CHECK(mandate_revision>=1),
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,mandate_id),
  FOREIGN KEY(scope_id,mandate_id,mandate_revision) REFERENCES dsh_a_mandates(scope_id,mandate_id,mandate_revision)
);

CREATE TABLE dsh_a_control_operations(
  scope_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  control_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('policy','leaf')),
  axis_or_leaf TEXT NOT NULL CHECK(axis_or_leaf IN ('mode','mandate','egress','privacy','readonly','source_auth')),
  target_epoch INTEGER NOT NULL CHECK(target_epoch>=1),
  previous_revision INTEGER NOT NULL CHECK(previous_revision>=0),
  canonical_hash TEXT NOT NULL,
  domains_hash TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,operation_id),
  UNIQUE(scope_id,semantic_key),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id)
);

CREATE TABLE dsh_a_control_targets(
  scope_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  owner_domain TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,operation_id,owner_domain),
  FOREIGN KEY(scope_id,operation_id) REFERENCES dsh_a_control_operations(scope_id,operation_id),
  FOREIGN KEY(scope_id,owner_domain) REFERENCES dsh_a_owner_domains(scope_id,owner_domain)
);

CREATE TABLE dsh_a_control_heads(
  scope_id TEXT NOT NULL,
  control_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('policy','leaf')),
  axis_or_leaf TEXT NOT NULL CHECK(axis_or_leaf IN ('mode','mandate','egress','privacy','readonly','source_auth')),
  epoch INTEGER NOT NULL CHECK(epoch>=1),
  revision INTEGER NOT NULL CHECK(revision>=1),
  operation_id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,control_id),
  UNIQUE(scope_id,scope_key,record_kind,axis_or_leaf),
  FOREIGN KEY(scope_id,operation_id) REFERENCES dsh_a_control_operations(scope_id,operation_id)
);

CREATE TABLE dsh_a_control_domain_receipts(
  scope_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  owner_domain TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,operation_id,owner_domain),
  UNIQUE(scope_id,owner_domain,receipt_id),
  FOREIGN KEY(scope_id,operation_id,owner_domain) REFERENCES dsh_a_control_targets(scope_id,operation_id,owner_domain)
);

CREATE TABLE dsh_a_windows(
  scope_id TEXT NOT NULL,
  source_binding_id TEXT NOT NULL,
  prefix_mode_hash TEXT NOT NULL,
  window_id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,source_binding_id,prefix_mode_hash),
  UNIQUE(scope_id,window_id),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id),
  FOREIGN KEY(source_binding_id) REFERENCES dsh_a_source_bindings(binding_id)
);

CREATE TABLE dsh_a_assessment_attempts(
  scope_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  assessment_version INTEGER NOT NULL CHECK(assessment_version IN (1,2)),
  attempt_id TEXT NOT NULL,
  proof_version INTEGER NOT NULL CHECK(proof_version>=1),
  mandate_revision INTEGER NOT NULL CHECK(mandate_revision>=1),
  previous_selection_revision INTEGER NOT NULL CHECK(previous_selection_revision IN (0,1)),
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,input_id,mandate_id,assessment_version),
  UNIQUE(scope_id,attempt_id),
  FOREIGN KEY(scope_id,mandate_id,mandate_revision) REFERENCES dsh_a_mandates(scope_id,mandate_id,mandate_revision),
  FOREIGN KEY(input_id,proof_version) REFERENCES dsh_a_input_proofs(input_id,proof_version)
);

CREATE TABLE dsh_a_assessment_candidates(
  scope_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,candidate_id),
  UNIQUE(scope_id,attempt_id,output_hash),
  FOREIGN KEY(scope_id,attempt_id) REFERENCES dsh_a_assessment_attempts(scope_id,attempt_id)
);

CREATE TABLE dsh_a_assessments(
  scope_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  assessment_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,assessment_id),
  UNIQUE(scope_id,attempt_id),
  UNIQUE(scope_id,candidate_id),
  FOREIGN KEY(scope_id,candidate_id) REFERENCES dsh_a_assessment_candidates(scope_id,candidate_id),
  FOREIGN KEY(scope_id,attempt_id) REFERENCES dsh_a_assessment_attempts(scope_id,attempt_id)
);

CREATE TABLE dsh_a_selections(
  scope_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  assessment_version INTEGER NOT NULL CHECK(assessment_version IN (1,2)),
  assessment_id TEXT NOT NULL,
  previous_selection_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,input_id,mandate_id,assessment_version),
  UNIQUE(scope_id,assessment_id),
  FOREIGN KEY(scope_id,assessment_id) REFERENCES dsh_a_assessments(scope_id,assessment_id),
  FOREIGN KEY(scope_id,input_id,mandate_id,assessment_version) REFERENCES dsh_a_assessment_attempts(scope_id,input_id,mandate_id,assessment_version)
);

CREATE TABLE dsh_a_selection_heads(
  scope_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision IN (1,2)),
  assessment_version INTEGER NOT NULL CHECK(assessment_version=revision),
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,input_id,mandate_id),
  FOREIGN KEY(scope_id,input_id,mandate_id,assessment_version) REFERENCES dsh_a_selections(scope_id,input_id,mandate_id,assessment_version)
);

CREATE TABLE dsh_a_decisions(
  scope_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  mandate_revision INTEGER NOT NULL CHECK(mandate_revision>=1),
  evaluated_snapshot_hash TEXT NOT NULL,
  assessment_version INTEGER CHECK(assessment_version IN (1,2)),
  supersedes_decision_id TEXT,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,decision_id),
  UNIQUE(scope_id,input_id,mandate_id,policy_version,mandate_revision,evaluated_snapshot_hash),
  FOREIGN KEY(input_id) REFERENCES dsh_a_inbox(input_id),
  FOREIGN KEY(scope_id,mandate_id,mandate_revision) REFERENCES dsh_a_mandates(scope_id,mandate_id,mandate_revision),
  FOREIGN KEY(scope_id,input_id,mandate_id,assessment_version) REFERENCES dsh_a_selections(scope_id,input_id,mandate_id,assessment_version),
  FOREIGN KEY(scope_id,supersedes_decision_id) REFERENCES dsh_a_decisions(scope_id,decision_id)
);

CREATE TABLE dsh_a_work_bindings(
  scope_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  source_binding_id TEXT NOT NULL,
  stable_thread_key TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation=1),
  mandate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  transport_kind TEXT NOT NULL CHECK(transport_kind IN ('reserved','bound')),
  create_command_id TEXT NOT NULL,
  canonical_initial_input_id TEXT NOT NULL,
  canonical_manifest_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,binding_id),
  UNIQUE(scope_id,stable_thread_key,generation),
  UNIQUE(scope_id,create_command_id),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id),
  FOREIGN KEY(source_binding_id) REFERENCES dsh_a_source_bindings(binding_id),
  FOREIGN KEY(canonical_initial_input_id) REFERENCES dsh_a_inbox(input_id),
  FOREIGN KEY(scope_id,create_command_id) REFERENCES dsh_a_command_outbox(scope_id,command_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE dsh_a_command_outbox(
  scope_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  command_class TEXT NOT NULL CHECK(command_class IN ('generating','narrowing')),
  operation_key TEXT NOT NULL,
  attempt_hash TEXT NOT NULL,
  semantic_hash TEXT NOT NULL,
  decision_id TEXT,
  target_domain TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,command_id),
  FOREIGN KEY(scope_id,binding_id) REFERENCES dsh_a_work_bindings(scope_id,binding_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(input_id) REFERENCES dsh_a_inbox(input_id),
  FOREIGN KEY(scope_id,decision_id) REFERENCES dsh_a_decisions(scope_id,decision_id),
  FOREIGN KEY(scope_id,target_domain) REFERENCES dsh_a_owner_domains(scope_id,owner_domain)
);

CREATE TABLE dsh_a_delivery_heads(
  scope_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','leased','unknown','receipt_observed','fenced')),
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,command_id),
  FOREIGN KEY(scope_id,command_id) REFERENCES dsh_a_command_outbox(scope_id,command_id)
);

CREATE TABLE dsh_a_owner_receipts(
  scope_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,command_id),
  UNIQUE(scope_id,receipt_id),
  FOREIGN KEY(scope_id,command_id) REFERENCES dsh_a_command_outbox(scope_id,command_id)
);

CREATE TABLE dsh_a_source_control_receipts(
  scope_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  proof_version INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('observed_only','invalidation_only','needs_review')),
  command_id TEXT,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,input_id,proof_version),
  FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id),
  FOREIGN KEY(input_id,proof_version) REFERENCES dsh_a_input_proofs(input_id,proof_version),
  FOREIGN KEY(scope_id,command_id) REFERENCES dsh_a_command_outbox(scope_id,command_id)
);

CREATE TABLE dsh_a_shadow_results(
  scope_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  mandate_revision INTEGER NOT NULL,
  evaluated_snapshot_hash TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(typeof(data_json)='text'),
  body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64),
  logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
  PRIMARY KEY(scope_id,input_id,mandate_id,policy_version,mandate_revision,evaluated_snapshot_hash),
  FOREIGN KEY(input_id) REFERENCES dsh_a_inbox(input_id),
  FOREIGN KEY(scope_id,mandate_id,mandate_revision) REFERENCES dsh_a_mandates(scope_id,mandate_id,mandate_revision)
);

CREATE INDEX dsh_a_commands_by_binding ON dsh_a_command_outbox(scope_id,binding_id,command_id);

CREATE INDEX dsh_a_commands_by_input ON dsh_a_command_outbox(scope_id,input_id,command_id);

CREATE INDEX dsh_a_attempts_by_input_mandate ON dsh_a_assessment_attempts(scope_id,input_id,mandate_id,assessment_version);

CREATE INDEX dsh_a_controls_by_scope ON dsh_a_control_heads(scope_id,scope_key,record_kind,axis_or_leaf);

CREATE TRIGGER dsh_a6_profile_migrations_no_delete BEFORE DELETE ON dsh_a_profile_migrations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_profile_migrations_no_update BEFORE UPDATE ON dsh_a_profile_migrations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_domains_no_delete BEFORE DELETE ON dsh_a_domains BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_domains_head_update BEFORE UPDATE ON dsh_a_domains BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'authority' OR NEW.profile_id IS NOT OLD.profile_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.principal_id IS NOT OLD.principal_id OR (OLD.budget_owner_id IS NOT NULL AND (NEW.budget_owner_id IS NOT OLD.budget_owner_id OR NEW.budget_account_id IS NOT OLD.budget_account_id OR NEW.budget_unit_profile IS NOT OLD.budget_unit_profile)) OR NEW.authority_id IS NOT OLD.authority_id OR NEW.authority_epoch < OLD.authority_epoch THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_owner_domains_no_delete BEFORE DELETE ON dsh_a_owner_domains BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_owner_domains_no_update BEFORE UPDATE ON dsh_a_owner_domains BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_mandates_no_delete BEFORE DELETE ON dsh_a_mandates BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_mandates_no_update BEFORE UPDATE ON dsh_a_mandates BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_mandate_heads_no_delete BEFORE DELETE ON dsh_a_mandate_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_mandate_heads_head_update BEFORE UPDATE ON dsh_a_mandate_heads BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.mandate_id IS NOT OLD.mandate_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'mandate' OR NEW.mandate_revision != OLD.mandate_revision+1 THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_control_operations_no_delete BEFORE DELETE ON dsh_a_control_operations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_operations_no_update BEFORE UPDATE ON dsh_a_control_operations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_targets_no_delete BEFORE DELETE ON dsh_a_control_targets BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_targets_no_update BEFORE UPDATE ON dsh_a_control_targets BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_heads_no_delete BEFORE DELETE ON dsh_a_control_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_heads_head_update BEFORE UPDATE ON dsh_a_control_heads BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.control_id IS NOT OLD.control_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'control' OR NEW.scope_key IS NOT OLD.scope_key OR NEW.record_kind IS NOT OLD.record_kind OR NEW.axis_or_leaf IS NOT OLD.axis_or_leaf OR NEW.epoch <= OLD.epoch THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_control_domain_receipts_no_delete BEFORE DELETE ON dsh_a_control_domain_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_control_domain_receipts_no_update BEFORE UPDATE ON dsh_a_control_domain_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_windows_no_delete BEFORE DELETE ON dsh_a_windows BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_windows_no_update BEFORE UPDATE ON dsh_a_windows BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessment_attempts_no_delete BEFORE DELETE ON dsh_a_assessment_attempts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessment_attempts_no_update BEFORE UPDATE ON dsh_a_assessment_attempts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessment_candidates_no_delete BEFORE DELETE ON dsh_a_assessment_candidates BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessment_candidates_no_update BEFORE UPDATE ON dsh_a_assessment_candidates BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessments_no_delete BEFORE DELETE ON dsh_a_assessments BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_assessments_no_update BEFORE UPDATE ON dsh_a_assessments BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_selections_no_delete BEFORE DELETE ON dsh_a_selections BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_selections_no_update BEFORE UPDATE ON dsh_a_selections BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_selection_heads_no_delete BEFORE DELETE ON dsh_a_selection_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_selection_heads_head_update BEFORE UPDATE ON dsh_a_selection_heads BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.input_id IS NOT OLD.input_id OR NEW.mandate_id IS NOT OLD.mandate_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'select' OR OLD.assessment_version != 1 OR NEW.assessment_version != 2 THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_decisions_no_delete BEFORE DELETE ON dsh_a_decisions BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_decisions_no_update BEFORE UPDATE ON dsh_a_decisions BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_work_bindings_no_delete BEFORE DELETE ON dsh_a_work_bindings BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_work_bindings_head_update BEFORE UPDATE ON dsh_a_work_bindings BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.binding_id IS NOT OLD.binding_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'receipt' OR NEW.source_binding_id IS NOT OLD.source_binding_id OR NEW.stable_thread_key IS NOT OLD.stable_thread_key OR NEW.generation IS NOT OLD.generation OR NEW.mandate_id IS NOT OLD.mandate_id OR NEW.create_command_id IS NOT OLD.create_command_id OR NEW.canonical_initial_input_id IS NOT OLD.canonical_initial_input_id OR NEW.canonical_manifest_hash IS NOT OLD.canonical_manifest_hash OR OLD.transport_kind != 'reserved' OR NEW.transport_kind != 'bound' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_command_outbox_no_delete BEFORE DELETE ON dsh_a_command_outbox BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_command_outbox_no_update BEFORE UPDATE ON dsh_a_command_outbox BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_delivery_heads_no_delete BEFORE DELETE ON dsh_a_delivery_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_delivery_heads_head_update BEFORE UPDATE ON dsh_a_delivery_heads BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.command_id IS NOT OLD.command_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'delivery' OR NEW.fencing_token < OLD.fencing_token OR OLD.delivery_state='receipt_observed' AND NEW.delivery_state!='receipt_observed' OR OLD.delivery_state='fenced' AND NEW.delivery_state NOT IN ('fenced','receipt_observed') THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TRIGGER dsh_a6_owner_receipts_no_delete BEFORE DELETE ON dsh_a_owner_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_owner_receipts_no_update BEFORE UPDATE ON dsh_a_owner_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_source_control_receipts_no_delete BEFORE DELETE ON dsh_a_source_control_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_source_control_receipts_no_update BEFORE UPDATE ON dsh_a_source_control_receipts BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_shadow_results_no_delete BEFORE DELETE ON dsh_a_shadow_results BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_shadow_results_no_update BEFORE UPDATE ON dsh_a_shadow_results BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_profile_migrations_insert_writer BEFORE INSERT ON dsh_a_profile_migrations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_profile_migrations_update_writer BEFORE UPDATE ON dsh_a_profile_migrations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_profile_migrations_delete_writer BEFORE DELETE ON dsh_a_profile_migrations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_domains_insert_writer BEFORE INSERT ON dsh_a_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_domains_update_writer BEFORE UPDATE ON dsh_a_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_domains_delete_writer BEFORE DELETE ON dsh_a_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_domains_insert_writer BEFORE INSERT ON dsh_a_owner_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_domains_update_writer BEFORE UPDATE ON dsh_a_owner_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_domains_delete_writer BEFORE DELETE ON dsh_a_owner_domains BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandates_insert_writer BEFORE INSERT ON dsh_a_mandates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandates_update_writer BEFORE UPDATE ON dsh_a_mandates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandates_delete_writer BEFORE DELETE ON dsh_a_mandates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandate_heads_insert_writer BEFORE INSERT ON dsh_a_mandate_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandate_heads_update_writer BEFORE UPDATE ON dsh_a_mandate_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_mandate_heads_delete_writer BEFORE DELETE ON dsh_a_mandate_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_operations_insert_writer BEFORE INSERT ON dsh_a_control_operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_operations_update_writer BEFORE UPDATE ON dsh_a_control_operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_operations_delete_writer BEFORE DELETE ON dsh_a_control_operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_targets_insert_writer BEFORE INSERT ON dsh_a_control_targets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_targets_update_writer BEFORE UPDATE ON dsh_a_control_targets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_targets_delete_writer BEFORE DELETE ON dsh_a_control_targets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_heads_insert_writer BEFORE INSERT ON dsh_a_control_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_heads_update_writer BEFORE UPDATE ON dsh_a_control_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_heads_delete_writer BEFORE DELETE ON dsh_a_control_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_domain_receipts_insert_writer BEFORE INSERT ON dsh_a_control_domain_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_domain_receipts_update_writer BEFORE UPDATE ON dsh_a_control_domain_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_control_domain_receipts_delete_writer BEFORE DELETE ON dsh_a_control_domain_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_windows_insert_writer BEFORE INSERT ON dsh_a_windows BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_windows_update_writer BEFORE UPDATE ON dsh_a_windows BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_windows_delete_writer BEFORE DELETE ON dsh_a_windows BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_attempts_insert_writer BEFORE INSERT ON dsh_a_assessment_attempts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_attempts_update_writer BEFORE UPDATE ON dsh_a_assessment_attempts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_attempts_delete_writer BEFORE DELETE ON dsh_a_assessment_attempts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_candidates_insert_writer BEFORE INSERT ON dsh_a_assessment_candidates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_candidates_update_writer BEFORE UPDATE ON dsh_a_assessment_candidates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessment_candidates_delete_writer BEFORE DELETE ON dsh_a_assessment_candidates BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessments_insert_writer BEFORE INSERT ON dsh_a_assessments BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessments_update_writer BEFORE UPDATE ON dsh_a_assessments BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_assessments_delete_writer BEFORE DELETE ON dsh_a_assessments BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selections_insert_writer BEFORE INSERT ON dsh_a_selections BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selections_update_writer BEFORE UPDATE ON dsh_a_selections BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selections_delete_writer BEFORE DELETE ON dsh_a_selections BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selection_heads_insert_writer BEFORE INSERT ON dsh_a_selection_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selection_heads_update_writer BEFORE UPDATE ON dsh_a_selection_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_selection_heads_delete_writer BEFORE DELETE ON dsh_a_selection_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_decisions_insert_writer BEFORE INSERT ON dsh_a_decisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_decisions_update_writer BEFORE UPDATE ON dsh_a_decisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_decisions_delete_writer BEFORE DELETE ON dsh_a_decisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_work_bindings_insert_writer BEFORE INSERT ON dsh_a_work_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_work_bindings_update_writer BEFORE UPDATE ON dsh_a_work_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_work_bindings_delete_writer BEFORE DELETE ON dsh_a_work_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_command_outbox_insert_writer BEFORE INSERT ON dsh_a_command_outbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_command_outbox_update_writer BEFORE UPDATE ON dsh_a_command_outbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_command_outbox_delete_writer BEFORE DELETE ON dsh_a_command_outbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_delivery_heads_insert_writer BEFORE INSERT ON dsh_a_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_delivery_heads_update_writer BEFORE UPDATE ON dsh_a_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_delivery_heads_delete_writer BEFORE DELETE ON dsh_a_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_receipts_insert_writer BEFORE INSERT ON dsh_a_owner_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_receipts_update_writer BEFORE UPDATE ON dsh_a_owner_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_owner_receipts_delete_writer BEFORE DELETE ON dsh_a_owner_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_source_control_receipts_insert_writer BEFORE INSERT ON dsh_a_source_control_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_source_control_receipts_update_writer BEFORE UPDATE ON dsh_a_source_control_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_source_control_receipts_delete_writer BEFORE DELETE ON dsh_a_source_control_receipts BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_shadow_results_insert_writer BEFORE INSERT ON dsh_a_shadow_results BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_shadow_results_update_writer BEFORE UPDATE ON dsh_a_shadow_results BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;

CREATE TRIGGER dsh_a6_shadow_results_delete_writer BEFORE DELETE ON dsh_a_shadow_results BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;


CREATE TABLE dsh_a_source_binding_revisions(binding_id TEXT NOT NULL, binding_revision INTEGER NOT NULL CHECK(binding_revision>=1), source_key TEXT NOT NULL, data_json TEXT NOT NULL CHECK(typeof(data_json)='text'), body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64), logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0), PRIMARY KEY(binding_id,binding_revision), FOREIGN KEY(binding_id) REFERENCES dsh_a_source_bindings(binding_id));

CREATE TABLE dsh_a_control_delivery_heads(scope_id TEXT NOT NULL, operation_id TEXT NOT NULL, owner_domain TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), fencing_token INTEGER NOT NULL CHECK(fencing_token>=1), delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','leased','unknown','receipt_observed')), data_json TEXT NOT NULL CHECK(typeof(data_json)='text'), body_hash TEXT NOT NULL CHECK(typeof(body_hash)='text' AND length(body_hash)=64), logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0), PRIMARY KEY(scope_id,operation_id,owner_domain), FOREIGN KEY(scope_id,operation_id,owner_domain) REFERENCES dsh_a_control_targets(scope_id,operation_id,owner_domain));
CREATE TRIGGER dsh_a6_source_binding_revisions_insert_writer BEFORE INSERT ON dsh_a_source_binding_revisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_binding_revisions_update_writer BEFORE UPDATE ON dsh_a_source_binding_revisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_binding_revisions_delete_writer BEFORE DELETE ON dsh_a_source_binding_revisions BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_binding_revisions_no_delete BEFORE DELETE ON dsh_a_source_binding_revisions BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_source_binding_revisions_no_update BEFORE UPDATE ON dsh_a_source_binding_revisions BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_control_delivery_heads_insert_writer BEFORE INSERT ON dsh_a_control_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_control_delivery_heads_update_writer BEFORE UPDATE ON dsh_a_control_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_control_delivery_heads_delete_writer BEFORE DELETE ON dsh_a_control_delivery_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_control_delivery_heads_no_delete BEFORE DELETE ON dsh_a_control_delivery_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_control_delivery_heads_head_update BEFORE UPDATE ON dsh_a_control_delivery_heads BEGIN SELECT CASE WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_domain IS NOT OLD.owner_domain OR NEW.revision != OLD.revision+1 OR NEW.fencing_token < OLD.fencing_token OR xiaok_main_dsh_admission_operation_v1() IS NOT 'delivery' OR (OLD.delivery_state='receipt_observed' AND NEW.delivery_state!='receipt_observed') THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

-- Complete original inherited table guard replacement. These names come from exact schema5.
CREATE TRIGGER dsh_a6_inherited_activity_members_insert_writer BEFORE INSERT ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_activity_members_update_writer BEFORE UPDATE ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_activity_members_delete_writer BEFORE DELETE ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_activity_runs_insert_writer BEFORE INSERT ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_activity_runs_update_writer BEFORE UPDATE ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_activity_runs_delete_writer BEFORE DELETE ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_agents_insert_writer BEFORE INSERT ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_agents_update_writer BEFORE UPDATE ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_agents_delete_writer BEFORE DELETE ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_boot_owners_insert_writer BEFORE INSERT ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_boot_owners_update_writer BEFORE UPDATE ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_boot_owners_delete_writer BEFORE DELETE ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_contents_insert_writer BEFORE INSERT ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_contents_update_writer BEFORE UPDATE ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_contents_delete_writer BEFORE DELETE ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_inbox_insert_writer BEFORE INSERT ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_inbox_update_writer BEFORE UPDATE ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_inbox_delete_writer BEFORE DELETE ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_input_proofs_insert_writer BEFORE INSERT ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_input_proofs_update_writer BEFORE UPDATE ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_input_proofs_delete_writer BEFORE DELETE ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_object_heads_insert_writer BEFORE INSERT ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_object_heads_update_writer BEFORE UPDATE ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_object_heads_delete_writer BEFORE DELETE ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_profile_insert_writer BEFORE INSERT ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_profile_update_writer BEFORE UPDATE ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_profile_delete_writer BEFORE DELETE ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_source_bindings_insert_writer BEFORE INSERT ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_source_bindings_update_writer BEFORE UPDATE ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_source_bindings_delete_writer BEFORE DELETE ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_events_insert_writer BEFORE INSERT ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_events_update_writer BEFORE UPDATE ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_events_delete_writer BEFORE DELETE ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_groups_insert_writer BEFORE INSERT ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_groups_update_writer BEFORE UPDATE ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_groups_delete_writer BEFORE DELETE ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_managed_resources_insert_writer BEFORE INSERT ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_managed_resources_update_writer BEFORE UPDATE ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_managed_resources_delete_writer BEFORE DELETE ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_messages_insert_writer BEFORE INSERT ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_messages_update_writer BEFORE UPDATE ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_messages_delete_writer BEFORE DELETE ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_operations_insert_writer BEFORE INSERT ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_operations_update_writer BEFORE UPDATE ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_operations_delete_writer BEFORE DELETE ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_root_turns_insert_writer BEFORE INSERT ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_root_turns_update_writer BEFORE UPDATE ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_root_turns_delete_writer BEFORE DELETE ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_thread_bindings_insert_writer BEFORE INSERT ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_thread_bindings_update_writer BEFORE UPDATE ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_thread_bindings_delete_writer BEFORE DELETE ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_workspace_execution_authorizations_insert_writer BEFORE INSERT ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_workspace_execution_authorizations_update_writer BEFORE UPDATE ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_workspace_execution_authorizations_delete_writer BEFORE DELETE ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_profile_no_update BEFORE UPDATE ON dsh_a_profile BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_profile_no_delete BEFORE DELETE ON dsh_a_profile BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_inbox_no_update BEFORE UPDATE ON dsh_a_inbox BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_inbox_no_delete BEFORE DELETE ON dsh_a_inbox BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_input_proofs_no_update BEFORE UPDATE ON dsh_a_input_proofs BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_dsh_a_input_proofs_no_delete BEFORE DELETE ON dsh_a_input_proofs BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

-- Original A1 mutable heads retain the same owner; operation 'source' is private.
CREATE TRIGGER dsh_a6_inherited_source_binding_head_update BEFORE UPDATE ON dsh_a_source_bindings BEGIN SELECT CASE WHEN NEW.binding_id IS NOT OLD.binding_id OR NEW.source_key IS NOT OLD.source_key OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'source' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;
CREATE TRIGGER dsh_a6_inherited_source_binding_no_delete BEFORE DELETE ON dsh_a_source_bindings BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_inherited_object_head_update BEFORE UPDATE ON dsh_a_object_heads BEGIN SELECT CASE WHEN NEW.object_id IS NOT OLD.object_id OR NEW.binding_id IS NOT OLD.binding_id OR NEW.revision != OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'source' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;
CREATE TRIGGER dsh_a6_inherited_object_head_no_delete BEFORE DELETE ON dsh_a_object_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;

CREATE TRIGGER dsh_a6_dsh_a_source_configurations_insert_writer BEFORE INSERT ON dsh_a_source_configurations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configurations_update_writer BEFORE UPDATE ON dsh_a_source_configurations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configurations_delete_writer BEFORE DELETE ON dsh_a_source_configurations BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configurations_update_deny BEFORE UPDATE ON dsh_a_source_configurations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_configurations_delete_deny BEFORE DELETE ON dsh_a_source_configurations BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_configuration_heads_insert_writer BEFORE INSERT ON dsh_a_source_configuration_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configuration_heads_update_writer BEFORE UPDATE ON dsh_a_source_configuration_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configuration_heads_delete_writer BEFORE DELETE ON dsh_a_source_configuration_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_configuration_heads_delete_deny BEFORE DELETE ON dsh_a_source_configuration_heads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_source_configuration_cas BEFORE UPDATE ON dsh_a_source_configuration_heads BEGIN SELECT CASE WHEN NEW.binding_id IS NOT OLD.binding_id OR NEW.revision!=OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'control' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TABLE dsh_a_source_setups(
 setup_id TEXT PRIMARY KEY,
 scope_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 configuration_hash TEXT NOT NULL,
 data_json TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
 FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id)
);
CREATE TRIGGER dsh_a6_source_setups_insert_writer BEFORE INSERT ON dsh_a_source_setups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_setups_update_writer BEFORE UPDATE ON dsh_a_source_setups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_setups_delete_writer BEFORE DELETE ON dsh_a_source_setups BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_source_setups_no_delete BEFORE DELETE ON dsh_a_source_setups BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_source_setups_cas BEFORE UPDATE ON dsh_a_source_setups BEGIN SELECT CASE WHEN NEW.setup_id IS NOT OLD.setup_id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.revision!=OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'control' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;


CREATE TABLE dsh_a_source_scans(scan_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL,binding_revision INTEGER NOT NULL CHECK(binding_revision>=1),read_set_id TEXT NOT NULL,body_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),FOREIGN KEY(binding_id,binding_revision) REFERENCES dsh_a_source_binding_revisions(binding_id,binding_revision));
CREATE TABLE dsh_a_source_reads(attempt_id TEXT PRIMARY KEY,scan_id TEXT NOT NULL REFERENCES dsh_a_source_scans(scan_id),plan_hash TEXT NOT NULL,body_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0));
CREATE TABLE dsh_a_source_snapshots(snapshot_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),read_attempt_id TEXT NOT NULL REFERENCES dsh_a_source_reads(attempt_id),entry_index INTEGER NOT NULL CHECK(entry_index>=0),role TEXT NOT NULL CHECK(role IN ('current','event_payload')),content_hash TEXT NOT NULL,body_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),UNIQUE(read_attempt_id,entry_index,role));
CREATE TABLE dsh_a_source_read_sets(read_set_id TEXT PRIMARY KEY,scan_id TEXT NOT NULL UNIQUE REFERENCES dsh_a_source_scans(scan_id),binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),body_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0));
CREATE TABLE dsh_a_source_content_checkpoints(binding_id TEXT PRIMARY KEY REFERENCES dsh_a_source_bindings(binding_id),revision INTEGER NOT NULL CHECK(revision>=1),scan_id TEXT NOT NULL REFERENCES dsh_a_source_scans(scan_id),read_set_id TEXT NOT NULL REFERENCES dsh_a_source_read_sets(read_set_id),body_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0));
CREATE TRIGGER dsh_a6_dsh_a_source_scans_insert_writer BEFORE INSERT ON dsh_a_source_scans BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_scans_update_writer BEFORE UPDATE ON dsh_a_source_scans BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_scans_delete_writer BEFORE DELETE ON dsh_a_source_scans BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_scans_update_deny BEFORE UPDATE ON dsh_a_source_scans BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_scans_delete_deny BEFORE DELETE ON dsh_a_source_scans BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_reads_insert_writer BEFORE INSERT ON dsh_a_source_reads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_reads_update_writer BEFORE UPDATE ON dsh_a_source_reads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_reads_delete_writer BEFORE DELETE ON dsh_a_source_reads BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_reads_update_deny BEFORE UPDATE ON dsh_a_source_reads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_reads_delete_deny BEFORE DELETE ON dsh_a_source_reads BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_snapshots_insert_writer BEFORE INSERT ON dsh_a_source_snapshots BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_snapshots_update_writer BEFORE UPDATE ON dsh_a_source_snapshots BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_snapshots_delete_writer BEFORE DELETE ON dsh_a_source_snapshots BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_snapshots_update_deny BEFORE UPDATE ON dsh_a_source_snapshots BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_snapshots_delete_deny BEFORE DELETE ON dsh_a_source_snapshots BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_read_sets_insert_writer BEFORE INSERT ON dsh_a_source_read_sets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_read_sets_update_writer BEFORE UPDATE ON dsh_a_source_read_sets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_read_sets_delete_writer BEFORE DELETE ON dsh_a_source_read_sets BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_read_sets_update_deny BEFORE UPDATE ON dsh_a_source_read_sets BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_read_sets_delete_deny BEFORE DELETE ON dsh_a_source_read_sets BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_dsh_a_source_content_checkpoints_insert_writer BEFORE INSERT ON dsh_a_source_content_checkpoints BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_content_checkpoints_update_writer BEFORE UPDATE ON dsh_a_source_content_checkpoints BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_content_checkpoints_delete_writer BEFORE DELETE ON dsh_a_source_content_checkpoints BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_dsh_a_source_content_checkpoints_delete_deny BEFORE DELETE ON dsh_a_source_content_checkpoints BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_source_checkpoint_cas BEFORE UPDATE ON dsh_a_source_content_checkpoints BEGIN SELECT CASE WHEN NEW.binding_id IS NOT OLD.binding_id OR NEW.revision!=OLD.revision+1 OR xiaok_main_dsh_admission_operation_v1() IS NOT 'source' THEN RAISE(ABORT,'dsh_a_head_transition') END; END;

CREATE TABLE dsh_a_budget_account_memberships(
 scope_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 mandate_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 unit_profile TEXT NOT NULL CHECK(unit_profile='dsh_budget_usd_micros_v1'),
 origin_digest TEXT NOT NULL,
 data_json TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0),
 PRIMARY KEY(scope_id,account_id),
 UNIQUE(scope_id,mandate_id),
 FOREIGN KEY(scope_id) REFERENCES dsh_a_domains(scope_id)
);
CREATE TRIGGER dsh_a6_budget_membership_insert BEFORE INSERT ON dsh_a_budget_account_memberships BEGIN SELECT CASE WHEN xiaok_main_dsh_admission_authority_v1() IS NOT 'a980038ab17cc12e7035926a8759964bfebdd219918c17c69b06a368f99a7549' THEN RAISE(ABORT,'dsh_a_writer_required') END; END;
CREATE TRIGGER dsh_a6_budget_membership_update BEFORE UPDATE ON dsh_a_budget_account_memberships BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
CREATE TRIGGER dsh_a6_budget_membership_delete BEFORE DELETE ON dsh_a_budget_account_memberships BEGIN SELECT RAISE(ABORT,'dsh_a_immutable'); END;
`;
export const DSH_A_AUTHORITY_TABLES = Object.freeze(["dsh_a_profile_migrations", "dsh_a_domains", "dsh_a_source_configurations", "dsh_a_source_configuration_heads", "dsh_a_owner_domains", "dsh_a_mandates", "dsh_a_mandate_heads", "dsh_a_control_operations", "dsh_a_control_targets", "dsh_a_control_heads", "dsh_a_control_domain_receipts", "dsh_a_windows", "dsh_a_assessment_attempts", "dsh_a_assessment_candidates", "dsh_a_assessments", "dsh_a_selections", "dsh_a_selection_heads", "dsh_a_decisions", "dsh_a_work_bindings", "dsh_a_command_outbox", "dsh_a_delivery_heads", "dsh_a_owner_receipts", "dsh_a_source_control_receipts", "dsh_a_shadow_results", "dsh_a_source_binding_revisions", "dsh_a_control_delivery_heads", "dsh_a_source_setups", "dsh_a_source_scans", "dsh_a_source_reads", "dsh_a_source_snapshots", "dsh_a_source_read_sets", "dsh_a_source_content_checkpoints", "dsh_a_budget_account_memberships"] as const);
export const DSH_A_OLD_GUARDS = Object.freeze([
  "dsh_a_guard_activity_members_delete",
  "dsh_a_guard_activity_members_insert",
  "dsh_a_guard_activity_members_update",
  "dsh_a_guard_activity_runs_delete",
  "dsh_a_guard_activity_runs_insert",
  "dsh_a_guard_activity_runs_update",
  "dsh_a_guard_agents_delete",
  "dsh_a_guard_agents_insert",
  "dsh_a_guard_agents_update",
  "dsh_a_guard_boot_owners_delete",
  "dsh_a_guard_boot_owners_insert",
  "dsh_a_guard_boot_owners_update",
  "dsh_a_guard_contents_delete",
  "dsh_a_guard_contents_insert",
  "dsh_a_guard_contents_update",
  "dsh_a_guard_dsh_a_inbox_delete",
  "dsh_a_guard_dsh_a_inbox_insert",
  "dsh_a_guard_dsh_a_inbox_update",
  "dsh_a_guard_dsh_a_input_proofs_delete",
  "dsh_a_guard_dsh_a_input_proofs_insert",
  "dsh_a_guard_dsh_a_input_proofs_update",
  "dsh_a_guard_dsh_a_object_heads_delete",
  "dsh_a_guard_dsh_a_object_heads_insert",
  "dsh_a_guard_dsh_a_object_heads_update",
  "dsh_a_guard_dsh_a_profile_delete",
  "dsh_a_guard_dsh_a_profile_insert",
  "dsh_a_guard_dsh_a_profile_update",
  "dsh_a_guard_dsh_a_source_bindings_delete",
  "dsh_a_guard_dsh_a_source_bindings_insert",
  "dsh_a_guard_dsh_a_source_bindings_update",
  "dsh_a_guard_events_delete",
  "dsh_a_guard_events_insert",
  "dsh_a_guard_events_update",
  "dsh_a_guard_groups_delete",
  "dsh_a_guard_groups_insert",
  "dsh_a_guard_groups_update",
  "dsh_a_guard_managed_resources_delete",
  "dsh_a_guard_managed_resources_insert",
  "dsh_a_guard_managed_resources_update",
  "dsh_a_guard_messages_delete",
  "dsh_a_guard_messages_insert",
  "dsh_a_guard_messages_update",
  "dsh_a_guard_operations_delete",
  "dsh_a_guard_operations_insert",
  "dsh_a_guard_operations_update",
  "dsh_a_guard_root_turns_delete",
  "dsh_a_guard_root_turns_insert",
  "dsh_a_guard_root_turns_update",
  "dsh_a_guard_thread_bindings_delete",
  "dsh_a_guard_thread_bindings_insert",
  "dsh_a_guard_thread_bindings_update",
  "dsh_a_guard_workspace_execution_authorizations_delete",
  "dsh_a_guard_workspace_execution_authorizations_insert",
  "dsh_a_guard_workspace_execution_authorizations_update",
] as const);
export const DSH_A_AUTHORITY_TEMPLATE_HASH =
  "f1fe9830a375fbfa4ca6f93f8090256bc99579fcb85ffc5fa1643a77a8d743bf";
export const DSH_A_AUTHORITY_SQL_HASH =
  "0575f75170b20ce046d8fa58d0b540a427c1829b08be8fb8de7d374138454895";

export type DshAuthoritySchemaRow = Readonly<{
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}>;
const define = Object.defineProperty;
const freeze = Object.freeze;
const authorityOwn = Object.hasOwn;
const trim = Function.prototype.call.bind(String.prototype.trim) as (
  text: string,
) => string;
const split = Function.prototype.call.bind(String.prototype.split) as (
  text: string,
  separator: string,
) => string[];
const exec = Function.prototype.call.bind(RegExp.prototype.exec) as (
  pattern: RegExp,
  text: string,
) => RegExpExecArray | null;
const sort = Function.prototype.call.bind(Array.prototype.sort) as (
  rows: DshAuthoritySchemaRow[],
  compare: (a: DshAuthoritySchemaRow, b: DshAuthoritySchemaRow) => number,
) => void;
const append = <T>(list: T[], value: T) =>
  define(list, list.length, {
    __proto__: null,
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  } as PropertyDescriptor);

// Compile the fixed source DDL into comparison facts, never execute caller SQL.
// sqlite_master omits the final semicolon and supplies automatic PK/UNIQUE indexes.
function authoritySchemaDelta(): readonly DshAuthoritySchemaRow[] {
  const lines = split(DSH_A_AUTHORITY_DDL, "\n");
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line[0] === "-" && line[1] === "-") continue;
    text += line + "\n";
  }
  const starts = /(?:^|\n)(CREATE (?:TABLE|INDEX|TRIGGER) )/g;
  const offsets: number[] = [];
  for (;;) {
    const row = exec(starts, text);
    if (!row) break;
    append(offsets, row.index + (row[0]![0] === "\n" ? 1 : 0));
  }
  const result: DshAuthoritySchemaRow[] = [];
  for (let i = 0; i < offsets.length; i++) {
    let statement = trim(text.slice(offsets[i], offsets[i + 1] ?? text.length));
    if (statement[statement.length - 1] === ";")
      statement = statement.slice(0, -1);
    const match = exec(
      /^CREATE (TABLE|INDEX|TRIGGER) ([a-zA-Z0-9_]+)/,
      statement,
    );
    if (!match) throw Error("DSH_A_SCHEMA_DESCRIPTOR_INVALID");
    const kind = match[1]!.toLowerCase(),
      name = match[2]!;
    let table = name;
    if (kind !== "table") {
      const target = exec(/\bON ([a-zA-Z0-9_]+)/, statement);
      if (!target) throw Error("DSH_A_SCHEMA_DESCRIPTOR_INVALID");
      table = target[1]!;
    }
    append(
      result,
      freeze({ type: kind, name, tbl_name: table, sql: statement }),
    );
    if (kind === "table") {
      const constraints = /\b(?:PRIMARY KEY|UNIQUE)\b/g;
      let ordinal = 0;
      while (exec(constraints, statement)) {
        ordinal++;
        append(
          result,
          freeze({
            type: "index",
            name: "sqlite_autoindex_" + name + "_" + ordinal,
            tbl_name: name,
            sql: null,
          }),
        );
      }
    }
  }
  return freeze(result);
}
const authorityDelta = authoritySchemaDelta();

export function dshAuthoritySchema(
  base5: readonly DshAuthoritySchemaRow[],
): readonly DshAuthoritySchemaRow[] {
  const result: DshAuthoritySchemaRow[] = [];
  for (let i = 0; i < base5.length; i++) {
    const row = base5[i]!;
    let oldGuard = false;
    for (let j = 0; j < DSH_A_OLD_GUARDS.length; j++)
      if (row.name === DSH_A_OLD_GUARDS[j]) oldGuard = true;
    if (!oldGuard) append(result, row);
  }
  for (let i = 0; i < authorityDelta.length; i++)
    append(result, authorityDelta[i]!);
  sort(result, (a, b) =>
    a.type < b.type
      ? -1
      : a.type > b.type
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
  return freeze(result);
}

export function dshAuthorityRowHash(table: string, body: unknown): string {
  return dshAHash(["dsh-a-authority-row-v1", table, body]);
}
export function dshProfileAncestryHash(body: unknown): string {
  return dshAHash(["dsh-a-profile-ancestry-v1", body]);
}
export function assertDshProfileAncestry(
  body: unknown,
): asserts body is Record<string, unknown> {
  dshAFields(body, [
    "schemaVersion",
    "migrationId",
    "storeId",
    "fromVersion",
    "fromProfile",
    "fromDigest",
    "toVersion",
    "toProfile",
    "toDigest",
    "templateSqlHash",
    "expandedSqlHash",
  ]);
  if (
    body.fromProfile !== DSH_A_PROFILE ||
    body.fromDigest !== DSH_A_DIGEST ||
    typeof body.storeId !== "string" ||
    !exec(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      body.storeId,
    ) ||
    body.migrationId !==
      dshAHash([
        "dsh-a-profile-migration-v1",
        body.storeId,
        DSH_A_DIGEST,
        DSH_A_AUTHORITY_DIGEST,
      ]) ||
    body.schemaVersion !== 1 ||
    body.fromVersion !== 5 ||
    body.toVersion !== 6 ||
    body.toProfile !== DSH_A_AUTHORITY_PROFILE ||
    body.toDigest !== DSH_A_AUTHORITY_DIGEST ||
    body.templateSqlHash !== DSH_A_AUTHORITY_TEMPLATE_HASH ||
    body.expandedSqlHash !== DSH_A_AUTHORITY_SQL_HASH
  )
    throw Error("DSH_A_PROFILE_ANCESTRY_INVALID");
  canonicalVerificationJson(body);
}

export function assertDshBindingHistory(
  body: unknown,
): asserts body is Record<string, unknown> {
  dshAFields(body, [
    "schemaVersion",
    "bindingId",
    "bindingRevision",
    "sourceKey",
    "binding",
  ]);
  dshABinding(body.binding);
  dshARevision(body.bindingRevision);
  if (
    body.schemaVersion !== 1 ||
    body.bindingId !== body.binding.bindingId ||
    body.sourceKey !==
      dshASourceKey(
        body.binding.provider,
        body.binding.authScope as Record<string, unknown>,
      )
  )
    throw Error("DSH_A_BINDING_HISTORY_INVALID");
}

/** Legacy v1 rows were emitted only while Mandate epoch equalled the domain
 * issuer epoch. New v2 keeps that signer fact separate from Mandate revisions. */
export function dshMandateIssuerEpoch(body:Record<string,unknown>):number {
  dshAFields(body,['schemaVersion','scopeId','projection'],['issuerEpoch']);
  const document=parseMandateProjection(body.projection).document;
  const epoch=body.schemaVersion===1?document.authorizationEpoch:body.schemaVersion===2&&authorityOwn(body,'issuerEpoch')?body.issuerEpoch:undefined;
  dshARevision(epoch);
  if(body.schemaVersion===1&&authorityOwn(body,'issuerEpoch'))throw Error('DSH_A_MANDATE_ISSUER_INVALID');
  return epoch;
}
