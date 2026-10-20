import { createRequire } from 'node:module';
import type { Database } from 'better-sqlite3';
import { VERIFICATION_BUDGET } from './protocol.js';
// Capture the actual installed driver's error class; text properties alone
// cannot classify an ordinary callback error as settled SQLite exhaustion.
const NativeSqliteError=createRequire(import.meta.url)('better-sqlite3').SqliteError as typeof import('better-sqlite3').SqliteError;
const headroomNotReadyErrors=new WeakMap<object,Database>();
function headroomNotReady(database:Database,message:string,cause?:unknown):Error{const error=cause===undefined?Error(message):Error(message,{cause});headroomNotReadyErrors.set(error,database);return error;}
export function isVerificationHeadroomNotReady(error:unknown,database:Database):boolean{return !!error&&typeof error==='object'&&headroomNotReadyErrors.get(error)===database;}

/** Byte check for the shared control database. Whole-profile/archive reservation is a separate owner. */
export function assertVerificationDatabaseBudget(db: Database, options: { additionalBytes: number; limitBytes?: number }): void {
  const limit = options.limitBytes ?? VERIFICATION_BUDGET.controlDatabaseBytes;
  if (!Number.isSafeInteger(options.additionalBytes) || options.additionalBytes < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > VERIFICATION_BUDGET.controlDatabaseBytes) throw Error('verification_control_budget');
  let logicalBytes = 0, rows = 0, pendingCaptureBytes = 0, pendingUploadBytes = 0;
  for (const [table, columns, reserveTerminal = true] of [
    ['receiver_operations', ['tuple_json', 'payload', 'result_json']],
    ['receiver_uploads', ['operation_id','tuple_hash','tuple_json']],
    ['receiver_upload_chunks', ['operation_id','bytes','chunk_hash'], false],
    ['publication_journal', ['tuple_json', 'reply_json', 'state_json', 'challenge']],
    ['publication_request_tombstones', ['principal_key','request_id','request_json']],
    ['publication_prepare_requests', ['principal_key','request_id','request_json','challenge_id']],
    ['publication_operations', ['owner_key','principal','boot','state','review_json','payload_id','decision_json']],
    ['material_authority_challenges', ['record_json', 'state', 'secret_hash']],
    ['material_authority_requests', ['request_id','principal','owner_key','invocation_json','draft_json','challenge_id','state']],
    ['material_mount_plan_handoffs', ['authorization_id', 'handoff_id', 'record_json', 'state'], false],
    ['broker_staging_intents', ['record_json', 'state', 'scope_digest']],
    ['docker_runner_resources', ['resources_json']],
    ['verification_maintenance_handoffs', ['authority_id','origin_epoch','phase','claim_epoch','items_hash','close_attempt_id']],
    ['verification_maintenance_handoff_items', ['authority_id','origin_epoch','item_id','target_json','target_hash','outcome','evidence_hash']],
    ['execution_attempts', ['proposal_json', 'state', 'container_id']],
    ['controller_grants', ['principal_id', 'request_source', 'method', 'payload_hash', 'secret_hash', 'state']],
    ['completion_access_grants', ['owner_key', 'principal', 'secret_hash', 'service_epoch', 'method', 'payload_hash', 'source', 'state'], false],
    ['completion_access_audit', ['owner_key', 'principal', 'method', 'payload_hash', 'source', 'state'], false],
    ['completion_scope_epochs', ['owner_key', 'principal'], false],
    ['migration_publication_intents', ['owner_key', 'profile_id', 'marker_json', 'state'], false],
    ['verified_publication_payloads', ['owner_key', 'payload_hash', 'dependencies_json', 'payload'], false],
    ['verified_evaluation_retentions', ['attempt_id','owner_key','bundle_hash','bundle'], false],
    ['verification_source_bindings', ['attempt_id', 'binding_json', 'source_record_id'], false],
    ['receiver_business_completions', ['operation_id', 'owner_key', 'tuple_hash', 'payload_hash'], false],
    ['verification_operations', ['owner_key', 'principal', 'secret_hash', 'boot', 'state', 'record_json']],
    ['verification_prepare_requests', ['principal','request_id','query_json','request_json','state','operation_id']],
    ['verification_operation_results', ['operation_id','operation_record_hash','result_json','result_hash','attempt_core_hash','proof_id','attempt_proof_hash'], false],
    ['verification_archive_challenges', ['principal', 'boot', 'state', 'review_json'], false],
    ['verification_engine_bootstrap', ['record_json', 'state']],
    ['verification_engine_qualification', ['record_json']],
    ['verification_run_roots', ['path', 'identity_json']],
    ['verification_protected_runs', ['source_run_id','run_nonce','owner_key','invocation_json','state','archive_hash','allocation_json']],
    ['verification_run_producers', ['producer_id','source_run_id','parent_id','state']],
    ['verification_run_executions', ['execution_id','source_run_id','producer_id','expected_json','observation_json']],
    ['verification_execution_transcripts', ['owner_key', 'manifest_json', 'allocation_json', 'directory_json', 'state']],
    ['verification_transcript_root', ['identity_json'], false],
    ['verification_authority_pool', ['authority_id', 'pool_id'], false],
    ['shared_blob_issuers', ['resource_id','allocation_hash','record_json','record_hash'], false],
    ['shared_blob_bindings', ['resource_id','allocation_hash','binding_json'], false],
    ['controller_metadata_resources', ['resource_id', 'physical_identity', 'record_json'], false],
    ['controller_metadata_intents', ['request_id', 'resource_id', 'request_json', 'record_json'], false],
    ['metadata_prepare_archive_intents', ['intent_id','capture_key','record_json','fee_state'], false],
    ['metadata_prepare_archive_slots', ['stage_payload','ready_payload'], false],
    ['shared_capacity_session_attributions', ['operation_id','beneficiary_session_key','beneficiary_producer_key','physical_tuple_hash','attribution_json','attribution_hash'], false],
    ['shared_metadata_replacements', ['replacement_id','intent_id','request_hash','request_json','state'], false],
    ['shared_metadata_replacement_claims', ['operation_id','replacement_id','role'], false],
    ['shared_metadata_replacement_resource_claims', ['producer_key','resource_id','operation_id','replacement_id'], false],
    ['shared_metadata_replacement_commits', ['replacement_id','intent_id','request_hash','result_json','result_hash'], false],
    ['shared_capacity_transfers', ['operation_id','state','replacement_id','tuple_hash'], false],
    ['shared_metadata_replacement_consumptions', ['operation_id','replacement_id','role'], false],
    ['shared_capacity_identity', ['authority_id','pool_id'], false],
    ['shared_capacity_reservations', ['operation_id','session_key','producer_key','resource_id','tuple_hash','tuple_json','state'], false],
    ['goal_application_requests', ['request_id','principal_json','binding_json','challenge_id']],
    ['goal_application_challenges', ['id','principal','boot','state','review_json','transition_id']],
    ['goal_application_clock', ['domain_id'], false],
    ['owner_enrollment_clock', ['domain_id'], false],
    ['owner_enrollment_requests', ['request_id','principal_json','proposal_json','request_hash','challenge_id','state','owner_json'], false],
    ['owner_enrollment_invocation_receipts', ['owner_key','invocation_json','logical_owner_key','registration_json'], false],
    ['owner_enrollment_goal_sessions', ['logical_owner_key','owner_key','goal_session_id','registration_json'], false],
    ['owner_enrollment_intent_contracts', ['logical_owner_key','owner_key','contract_json','registration_json'], false],
    ['owner_enrollment_loop_subjects', ['logical_owner_key','owner_key','subject_json','registration_json'], false],
    ['owner_enrollment_kswarm_subjects', ['logical_owner_key','owner_key','subject_json','registration_json','invocations_json'], false],
    ['verification_storage_features', ['feature'], false],
    ['owner_enrollment_challenges', ['principal', 'boot', 'state', 'review_json']],
    ['owner_enrollment_intents', ['logical_owner_key', 'registration_json', 'loop_subject_json', 'intent_contract_json'], false],
    ['verification_profiles', ['account_id', 'profile_id', 'state'], false],
    ['verification_registered_owners', ['owner_key', 'state'], false],
    ['verification_registered_invocations', ['profile_id', 'invocation_json', 'owner_key', 'state'], false],
    ['verification_owners', ['owner_key'], false],
    ['verification_owner_dependencies', ['parent_key', 'child_key'], false],
    ['mandatory_observation_checks', ['owner_key', 'definition_json', 'active_attempt'], false],
    ['obligation_attempts', ['owner_key', 'facts_json', 'state', 'core_json', 'proof_json']],
    ['verification_audit', ['owner_key', 'method', 'principal', 'payload_hash'], false],
    ['settlement_decisions', ['owner_key', 'tuple_hash', 'tuple_json'], false],
    ['execution_facts_revisions', ['attempt_id', 'core_json'], false],
    ['verifier_proofs', ['attempt_id', 'proof_json'], false],
    ['proof_dependencies', ['proof_id', 'dependency_kind', 'dependency_id'], false],
    ['verification_artifact_batches', ['resource_id', 'owner_key', 'state', 'manifest_json'], false],
    ['verification_blob_reservations', ['profile_id', 'owner_key', 'resource_id', 'tuple_json', 'state'], false],
    ['verification_application_pointers', ['owner_key', 'current_json', 'pending_id'], false],
    ['verification_application_history', ['owner_key', 'binding_hash', 'binding_json', 'registration_hash'], false],
    ['verification_application_transitions', ['transition_id', 'owner_key', 'previous_hash', 'binding_json', 'registration_hash', 'state'], false],
    ['verification_scope_guards', ['owner_key', 'scope_id', 'guard_id', 'service_epoch'], false],
    ['verification_scopes', ['owner_key', 'scope_id'], false],
    ['verification_subjects', ['owner_key', 'manifest_json', 'content_root'], false],
    ['controller_grant_audit', ['principal_id', 'request_source', 'method', 'payload_hash', 'state'], false],
  ] as const) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    const present = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(x => x.name));
    const expression = columns.filter(c => present.has(c)).map(c => `COALESCE(LENGTH(CAST(${c} AS BLOB)),0)`).join('+') || '0';
    const usage = db.prepare(`SELECT COALESCE(SUM(${expression}),0) bytes,COUNT(*) count FROM ${table}`).get() as { bytes: number; count: number };
    logicalBytes += usage.bytes;
    if(table==='receiver_uploads' && present.has('total_bytes') && present.has('received_bytes')) {
      const pending=db.prepare('SELECT COALESCE(SUM(MAX(0,total_bytes-received_bytes)+1024*((MAX(0,total_bytes-received_bytes)+262143)/262144)),0) bytes FROM receiver_uploads').get() as {bytes:number};
      pendingUploadBytes += 2*pending.bytes;
    }
    if(table==='verification_run_executions' && present.has('observation_json') && present.has('expected_json')) {
      // Durable null members are future control-DB allocations, across all runs,
      // profiles and restarts. Every writer sees the same reservation. Two times
      // the logical bound retains the existing conservative page-growth policy.
      const maximumBase64=4*Math.ceil(4*1024**2/3)+4;
      const pending=db.prepare(`SELECT COALESCE(SUM(? + 2*LENGTH(CAST(expected_json AS BLOB)) + 1024),0) bytes FROM verification_run_executions WHERE observation_json IS NULL`).get(maximumBase64) as {bytes:number};
      pendingCaptureBytes += 2*pending.bytes;
    }
    if (reserveTerminal) rows += table === 'publication_journal'
      ? (db.prepare("SELECT COUNT(*) n FROM publication_journal WHERE json_extract(state_json,'$.reservation') NOT IN ('consumed','cancelled')").get() as {n:number}).n
      : usage.count;
  }
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const maximumPageCount = db.pragma('max_page_count', { simple: true }) as number;
  if (!Number.isSafeInteger(pageCount) || pageCount < 0 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 ||
      !Number.isSafeInteger(maximumPageCount) || maximumPageCount < 1 ||
      pageCount > maximumPageCount) throw Error('verification_control_budget');
  const allocatedBytes = pageCount * pageSize, physicalLimit = maximumPageCount * pageSize;
  if (!Number.isSafeInteger(allocatedBytes) || !Number.isSafeInteger(physicalLimit)) throw Error('verification_control_budget');
  // Keep bounded space for terminal replies/challenges on already admitted rows;
  // no eviction of unknown operations to make room. Page cap remains a final bound.
  const requiredBytes = Math.max(logicalBytes, allocatedBytes) + pendingCaptureBytes + pendingUploadBytes + options.additionalBytes * 2 + (rows + 1) * 4096;
  if (requiredBytes > limit) throw headroomNotReady(db,'verification_control_budget');
  if (requiredBytes > physicalLimit) throw headroomNotReady(db,'verification_capacity_exhausted');
}
export function runVerificationTransaction<T>(db: Database, work: () => T): T {
  try { return db.transaction(work).immediate(); }
  catch (error) {
    if ((error as { code?: unknown })?.code === 'SQLITE_FULL') {if(error instanceof NativeSqliteError&&db.open&&!db.inTransaction)throw headroomNotReady(db,'verification_capacity_exhausted',error);throw new Error('verification_capacity_exhausted', { cause: error });}
    throw error;
  }
}
