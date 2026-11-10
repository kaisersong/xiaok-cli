import {dshFail as fail,dshInteger,dshDigest,dshId,dshHash,parseDshInput,dshAdd as add} from './harness-dsh-budget-data.mjs';
const json=JSON.stringify,parse=JSON.parse;
export const WORK_ESCROW_PROFILE='harness_dsh_work_escrow_v1';
export const WORK_SCHEMA_SQL=`CREATE TABLE dsh_budget_work_policies (
 account_id TEXT PRIMARY KEY REFERENCES dsh_budget_accounts(account_id),
 max_active_works INTEGER NOT NULL CHECK(typeof(max_active_works)='integer' AND max_active_works BETWEEN 0 AND 1000000000000),
 max_draft_requests INTEGER NOT NULL CHECK(typeof(max_draft_requests)='integer' AND max_draft_requests BETWEEN 0 AND 1000000000000),
 authority_hash TEXT NOT NULL CHECK(length(authority_hash)=64 AND authority_hash NOT GLOB '*[^0-9a-f]*'),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE dsh_budget_work_reservations (
 reservation_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES dsh_budget_accounts(account_id),
 binding_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation=1),
 scope_json TEXT NOT NULL, scope_hash TEXT NOT NULL,
 thread_json TEXT NOT NULL, thread_hash TEXT NOT NULL,
 initial_tokens INTEGER NOT NULL CHECK(typeof(initial_tokens)='integer' AND initial_tokens BETWEEN 1 AND 1000000000000),
 initial_cost INTEGER NOT NULL CHECK(typeof(initial_cost)='integer' AND initial_cost BETWEEN 1 AND 1000000000000),
 max_draft_requests INTEGER NOT NULL CHECK(typeof(max_draft_requests)='integer' AND max_draft_requests BETWEEN 1 AND 1000000000000),
 deadline INTEGER NOT NULL CHECK(typeof(deadline)='integer' AND deadline BETWEEN 0 AND 1000000000000000),
 birth_hash TEXT NOT NULL,
 UNIQUE(account_id,binding_id)
);
CREATE TABLE dsh_budget_work_heads (
 reservation_id TEXT PRIMARY KEY REFERENCES dsh_budget_work_reservations(reservation_id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 1000000000000),
 state TEXT NOT NULL CHECK(state IN ('reserved','bound','closing','closed','unknown')),
 owner_work_id TEXT,
 available_tokens INTEGER NOT NULL CHECK(typeof(available_tokens)='integer' AND available_tokens>=0 AND available_tokens<=9007199254740991),
 available_cost INTEGER NOT NULL CHECK(typeof(available_cost)='integer' AND available_cost>=0 AND available_cost<=9007199254740991),
 held_tokens INTEGER NOT NULL CHECK(typeof(held_tokens)='integer' AND held_tokens>=0 AND held_tokens<=9007199254740991),
 held_cost INTEGER NOT NULL CHECK(typeof(held_cost)='integer' AND held_cost>=0 AND held_cost<=9007199254740991),
 spent_tokens INTEGER NOT NULL CHECK(typeof(spent_tokens)='integer' AND spent_tokens>=0 AND spent_tokens<=9007199254740991),
 spent_cost INTEGER NOT NULL CHECK(typeof(spent_cost)='integer' AND spent_cost>=0 AND spent_cost<=9007199254740991),
 released_tokens INTEGER NOT NULL CHECK(typeof(released_tokens)='integer' AND released_tokens>=0 AND released_tokens<=9007199254740991),
 released_cost INTEGER NOT NULL CHECK(typeof(released_cost)='integer' AND released_cost>=0 AND released_cost<=9007199254740991),
 overrun_tokens INTEGER NOT NULL CHECK(typeof(overrun_tokens)='integer' AND overrun_tokens>=0 AND overrun_tokens<=9007199254740991),
 overrun_cost INTEGER NOT NULL CHECK(typeof(overrun_cost)='integer' AND overrun_cost>=0 AND overrun_cost<=9007199254740991),
 next_sequence INTEGER NOT NULL CHECK(typeof(next_sequence)='integer' AND next_sequence BETWEEN 1 AND 1000000000000),
 charged_requests INTEGER NOT NULL CHECK(typeof(charged_requests)='integer' AND charged_requests BETWEEN 0 AND 1000000000000),
 closure_receipt_hash TEXT,
 CHECK(state<>'bound' OR owner_work_id IS NOT NULL),
 CHECK(state<>'closed' OR (available_tokens=0 AND available_cost=0 AND held_tokens=0 AND held_cost=0 AND closure_receipt_hash IS NOT NULL))
);
CREATE TABLE dsh_budget_work_attempts (
 account_id TEXT NOT NULL, operation_key TEXT NOT NULL,
 attempt_sequence INTEGER NOT NULL,
 reservation_id TEXT NOT NULL REFERENCES dsh_budget_work_reservations(reservation_id),
 work_sequence INTEGER NOT NULL CHECK(typeof(work_sequence)='integer' AND work_sequence BETWEEN 1 AND 1000000000000),
 charged INTEGER NOT NULL CHECK(charged IN (0,1)),
 PRIMARY KEY(account_id,operation_key,attempt_sequence),
 UNIQUE(reservation_id,work_sequence),
 FOREIGN KEY(account_id,operation_key,attempt_sequence) REFERENCES dsh_budget_attempts(account_id,operation_key,attempt_sequence)
);
CREATE TABLE dsh_budget_command_attestations (
 attestation_id TEXT PRIMARY KEY,
 reservation_id TEXT NOT NULL REFERENCES dsh_budget_work_reservations(reservation_id),
 operation_key TEXT NOT NULL,
 semantic_payload_hash TEXT NOT NULL,
 assessment_ref TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('draft_admission','draft_prepare')),
 issuer_domain TEXT NOT NULL,
 authority_hash TEXT NOT NULL,
 owner_epoch INTEGER NOT NULL CHECK(typeof(owner_epoch)='integer' AND owner_epoch>=1),
 valid_until INTEGER NOT NULL CHECK(typeof(valid_until)='integer' AND valid_until BETWEEN 0 AND 1000000000000000),
 payload_hash TEXT NOT NULL,
 UNIQUE(reservation_id,operation_key,purpose)
);
CREATE TABLE dsh_budget_command_receipts (
 attestation_id TEXT PRIMARY KEY REFERENCES dsh_budget_command_attestations(attestation_id),
 result TEXT NOT NULL CHECK(result IN ('applied','blocked','no_effect')),
 owner_work_id TEXT,
 command_id TEXT NOT NULL,
 receipt_json TEXT NOT NULL,
 receipt_hash TEXT NOT NULL
);
CREATE TABLE dsh_budget_work_closures (
 reservation_id TEXT PRIMARY KEY REFERENCES dsh_budget_work_reservations(reservation_id),
 closure_id TEXT NOT NULL UNIQUE,
 receipt_json TEXT NOT NULL,
 receipt_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX dsh_budget_work_heads_owner ON dsh_budget_work_heads(owner_work_id) WHERE owner_work_id IS NOT NULL;
CREATE INDEX dsh_budget_work_heads_state ON dsh_budget_work_heads(state);
CREATE INDEX dsh_budget_work_attempts_reservation ON dsh_budget_work_attempts(reservation_id,work_sequence);
CREATE TRIGGER dsh_v3_dsh_budget_accounts_insert BEFORE INSERT ON dsh_budget_accounts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_accounts_update BEFORE UPDATE ON dsh_budget_accounts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_accounts_delete BEFORE DELETE ON dsh_budget_accounts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_operations_insert BEFORE INSERT ON dsh_budget_operations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_operations_update BEFORE UPDATE ON dsh_budget_operations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_operations_delete BEFORE DELETE ON dsh_budget_operations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_attempts_insert BEFORE INSERT ON dsh_budget_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_attempts_update BEFORE UPDATE ON dsh_budget_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_attempts_delete BEFORE DELETE ON dsh_budget_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_policies_insert BEFORE INSERT ON dsh_budget_work_policies
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_policies_update BEFORE UPDATE ON dsh_budget_work_policies
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_policies_delete BEFORE DELETE ON dsh_budget_work_policies
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_reservations_insert BEFORE INSERT ON dsh_budget_work_reservations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_reservations_update BEFORE UPDATE ON dsh_budget_work_reservations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_reservations_delete BEFORE DELETE ON dsh_budget_work_reservations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_heads_insert BEFORE INSERT ON dsh_budget_work_heads
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_heads_update BEFORE UPDATE ON dsh_budget_work_heads
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_heads_delete BEFORE DELETE ON dsh_budget_work_heads
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_attempts_insert BEFORE INSERT ON dsh_budget_work_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_attempts_update BEFORE UPDATE ON dsh_budget_work_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_attempts_delete BEFORE DELETE ON dsh_budget_work_attempts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_attestations_insert BEFORE INSERT ON dsh_budget_command_attestations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_attestations_update BEFORE UPDATE ON dsh_budget_command_attestations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_attestations_delete BEFORE DELETE ON dsh_budget_command_attestations
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_receipts_insert BEFORE INSERT ON dsh_budget_command_receipts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_receipts_update BEFORE UPDATE ON dsh_budget_command_receipts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_command_receipts_delete BEFORE DELETE ON dsh_budget_command_receipts
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_closures_insert BEFORE INSERT ON dsh_budget_work_closures
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_closures_update BEFORE UPDATE ON dsh_budget_work_closures
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_closures_delete BEFORE DELETE ON dsh_budget_work_closures
BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v3() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;
CREATE TRIGGER dsh_v3_dsh_budget_work_policies_immutable_update BEFORE UPDATE ON dsh_budget_work_policies
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_work_policies_immutable_delete BEFORE DELETE ON dsh_budget_work_policies
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_work_reservations_immutable_update BEFORE UPDATE ON dsh_budget_work_reservations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_work_reservations_immutable_delete BEFORE DELETE ON dsh_budget_work_reservations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_command_attestations_immutable_update BEFORE UPDATE ON dsh_budget_command_attestations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_command_attestations_immutable_delete BEFORE DELETE ON dsh_budget_command_attestations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_command_receipts_immutable_update BEFORE UPDATE ON dsh_budget_command_receipts
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_command_receipts_immutable_delete BEFORE DELETE ON dsh_budget_command_receipts
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_work_closures_immutable_update BEFORE UPDATE ON dsh_budget_work_closures
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_work_closures_immutable_delete BEFORE DELETE ON dsh_budget_work_closures
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_operations_immutable_update BEFORE UPDATE ON dsh_budget_operations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_dsh_budget_operations_immutable_delete BEFORE DELETE ON dsh_budget_operations
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_work_head_transition BEFORE UPDATE ON dsh_budget_work_heads
WHEN NEW.reservation_id IS NOT OLD.reservation_id OR NEW.revision<>OLD.revision+1
 OR (OLD.state='closed' AND NEW.state<>'closed')
 OR (OLD.owner_work_id IS NOT NULL AND NEW.owner_work_id IS NOT OLD.owner_work_id)
 OR NEW.spent_tokens<OLD.spent_tokens OR NEW.spent_cost<OLD.spent_cost
 OR NEW.released_tokens<OLD.released_tokens OR NEW.released_cost<OLD.released_cost
 OR NEW.overrun_tokens<OLD.overrun_tokens OR NEW.overrun_cost<OLD.overrun_cost
 OR NEW.next_sequence<OLD.next_sequence
BEGIN SELECT RAISE(ABORT,'dsh_work_transition'); END;
CREATE TRIGGER dsh_v3_work_head_no_delete BEFORE DELETE ON dsh_budget_work_heads
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_v3_work_attempt_transition BEFORE UPDATE ON dsh_budget_work_attempts
WHEN NEW.account_id IS NOT OLD.account_id OR NEW.operation_key IS NOT OLD.operation_key
 OR NEW.attempt_sequence IS NOT OLD.attempt_sequence OR NEW.reservation_id IS NOT OLD.reservation_id
 OR NEW.work_sequence IS NOT OLD.work_sequence OR NOT (OLD.charged=1 AND NEW.charged=0)
 OR NOT EXISTS (SELECT 1 FROM dsh_budget_attempts a WHERE a.account_id=OLD.account_id AND a.operation_key=OLD.operation_key AND a.attempt_sequence=OLD.attempt_sequence AND a.state='not_sent')
BEGIN SELECT RAISE(ABORT,'dsh_work_attempt_transition'); END;
CREATE TRIGGER dsh_v3_work_attempt_no_delete BEFORE DELETE ON dsh_budget_work_attempts
BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;`;

// The original ledger calls this kernel inside its existing transaction. It
// owns no connection, queue, Source, lock or independent balance.
export function createDshWorkEscrow({one,all,run,ownerId,profileId,workspaceId,pending,bump,accountingAttempt,isFinalized}) {
    const head=id=>one('SELECT * FROM dsh_budget_work_heads WHERE reservation_id=?',id);
    const birth=id=>one('SELECT * FROM dsh_budget_work_reservations WHERE reservation_id=?',id);
    const edges=id=>all('SELECT * FROM dsh_budget_work_attempts WHERE reservation_id=? ORDER BY work_sequence',id);
    const actual=edge=>{const row=one('SELECT * FROM dsh_budget_attempts WHERE account_id=? AND operation_key=? AND attempt_sequence=?',edge.account_id,edge.operation_key,edge.attempt_sequence);return row?accountingAttempt(row):row;};
    const receipts=id=>all('SELECT c.* FROM dsh_budget_command_receipts c JOIN dsh_budget_command_attestations a USING(attestation_id) WHERE a.reservation_id=? ORDER BY c.attestation_id',id);
    const usage=id=>{
        const out=[],rows=edges(id);
        for(let i=0;i<rows.length;i++)out.push(one('SELECT * FROM dsh_budget_attempts WHERE account_id=? AND operation_key=? AND attempt_sequence=?',rows[i].account_id,rows[i].operation_key,rows[i].attempt_sequence));
        return out;
    };
    const rowHash=(domain,value)=>dshDigest(domain,value);
    const workId=(accountId,bindingId)=>'dsh-budget-work:'+rowHash('dsh-budget-work-id-v1',{ownerId,accountId,bindingId});
    function birthData(r) {
        return {accountId:r.account_id,bindingId:r.binding_id,generation:r.generation,scope:parse(r.scope_json),thread:parse(r.thread_json),initialTokens:r.initial_tokens,initialCostMicros:r.initial_cost,deadline:r.deadline,maxDraftRequestsPerWork:r.max_draft_requests};
    }
    function attestationData(r) {
        return {attestationId:r.attestation_id,reservationId:r.reservation_id,operationKey:r.operation_key,semanticPayloadHash:r.semantic_payload_hash,assessmentRef:r.assessment_ref,purpose:r.purpose,issuerDomain:r.issuer_domain,authorityHash:r.authority_hash,ownerEpoch:r.owner_epoch,validUntil:r.valid_until};
    }
    function historicalUsageMatches(expected,reservationId){
        const rows=usage(reservationId);
        if(rowHash('dsh-budget-work-usage-v1',rows)===expected)return true;
        // Read-only compatibility for an original schema-three closure. The
        // later accounting migration adds one DEFAULT 'actual' column; it may
        // not rewrite that already-immutable closure or its original bytes.
        const legacy=[];
        for(let i=0;i<rows.length;i++){
            if(rows[i].cost_basis!=='actual')return false;
            const row={...rows[i]};delete row.cost_basis;legacy.push(row);
        }
        return rowHash('dsh-budget-work-usage-v1',legacy)===expected;
    }
    function graphAccount(ac) {
        const policy=one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',ac.account_id);
        if(policy) {
            const v=parseDshInput('work_policy',{accountId:policy.account_id,maxActiveWorks:policy.max_active_works,maxDraftRequestsPerWork:policy.max_draft_requests});
            if(policy.authority_hash!==ac.authority_hash||policy.payload_hash!==rowHash('dsh-budget-work-policy-v1',v))fail('dsh_budget_corrupt');
        }
        let availableTokens=0,availableCost=0;
        const births=all('SELECT * FROM dsh_budget_work_reservations WHERE account_id=? ORDER BY reservation_id',ac.account_id);
        for(let i=0;i<births.length;i++) {
            const r=births[i],h=head(r.reservation_id),v=birthData(r);
            if(!policy||!h||r.reservation_id!==workId(ac.account_id,r.binding_id)||r.birth_hash!==rowHash('dsh-budget-work-birth-v1',v))fail('dsh_budget_corrupt');
            // Reuse the one production closed-input parser, including actual B's
            // seven-field ThreadKey. This is data integrity, never Source auth.
            parseDshInput('work_reserve',{accountId:v.accountId,bindingId:v.bindingId,generation:v.generation,scope:v.scope,thread:v.thread,initialTokens:v.initialTokens,initialCostMicros:v.initialCostMicros,deadline:v.deadline,command:{operationKey:'graph',semanticPayloadHash:'0'.repeat(64),assessmentRef:'graph',purpose:'draft_admission'}});
            if(v.scope.profileId!==profileId||v.scope.workspaceId!==workspaceId||v.thread.tenantId!==ac.tenant_id||v.thread.workspaceId!==workspaceId||r.scope_hash!==rowHash('dsh-budget-work-scope-v1',v.scope)||r.thread_hash!==rowHash('dsh-budget-work-thread-v1',v.thread)||r.deadline>ac.valid_until||r.max_draft_requests!==policy.max_draft_requests)fail('dsh_budget_corrupt');
            const numeric=['revision','available_tokens','available_cost','held_tokens','held_cost','spent_tokens','spent_cost','released_tokens','released_cost','overrun_tokens','overrun_cost','next_sequence','charged_requests'];
            for(let n=0;n<numeric.length;n++)dshInteger(h[numeric[n]],numeric[n]==='revision'||numeric[n]==='next_sequence'?1:0,Number.MAX_SAFE_INTEGER);
            if(h.state!=='reserved'&&h.state!=='bound'&&h.state!=='closing'&&h.state!=='closed'&&h.state!=='unknown')fail('dsh_budget_corrupt');
            if(h.owner_work_id!==null)dshId(h.owner_work_id);
            if(h.state==='bound'&&h.owner_work_id===null)fail('dsh_budget_corrupt');
            let heldTokens=0,heldCost=0,spentTokens=0,spentCost=0,charged=0;
            const children=edges(r.reservation_id);
            for(let j=0;j<children.length;j++) {
                const e=children[j],a=actual(e),op=a&&one('SELECT * FROM dsh_budget_operations WHERE account_id=? AND operation_key=?',e.account_id,e.operation_key);
                if(!a||e.account_id!==ac.account_id||!op||op.purpose!=='draft'||op.work_id!==h.owner_work_id||e.work_sequence!==j+1||e.charged!==(a.state==='not_sent'?0:1))fail('dsh_budget_corrupt');
                if(pending(a)){heldTokens=add(heldTokens,a.max_tokens);heldCost=add(heldCost,a.max_cost);}
                if(a.state==='settled'){spentTokens=add(spentTokens,a.actual_tokens);spentCost=add(spentCost,a.actual_cost);}
                charged+=e.charged;
            }
            if(h.next_sequence!==children.length+1||h.charged_requests!==charged||charged>r.max_draft_requests||h.held_tokens!==heldTokens||h.held_cost!==heldCost||h.spent_tokens!==spentTokens||h.spent_cost!==spentCost)fail('dsh_budget_corrupt');
            for(const unit of ['tokens','cost'])if(add(add(h['available_'+unit],h['held_'+unit]),add(h['spent_'+unit],h['released_'+unit]))!==add(r['initial_'+unit],h['overrun_'+unit]))fail('dsh_budget_corrupt');
            const ats=all('SELECT * FROM dsh_budget_command_attestations WHERE reservation_id=?',r.reservation_id);
            if(!ats.length)fail('dsh_budget_corrupt');
            for(let j=0;j<ats.length;j++) {
                const a=ats[j];dshId(a.attestation_id);dshInteger(a.owner_epoch,1);dshHash(a.semantic_payload_hash);dshId(a.operation_key);dshId(a.assessment_ref);
                if(a.issuer_domain!==ac.account_id||a.authority_hash!==ac.authority_hash||a.valid_until!==r.deadline||a.purpose!=='draft_admission'&&a.purpose!=='draft_prepare'||a.attestation_id!=='dsh-budget-attestation:'+rowHash('dsh-budget-attestation-id-v1',{reservationId:r.reservation_id,operationKey:a.operation_key,purpose:a.purpose})||a.payload_hash!==rowHash('dsh-budget-attestation-v1',attestationData(a)))fail('dsh_budget_corrupt');
                const c=one('SELECT * FROM dsh_budget_command_receipts WHERE attestation_id=?',a.attestation_id);
                if(c) {
                    const data=parseDshInput('work_bind',parse(c.receipt_json));
                    if(data.attestationId!==a.attestation_id||data.reservationId!==r.reservation_id||data.accountId!==ac.account_id||data.operationKey!==a.operation_key||data.semanticPayloadHash!==a.semantic_payload_hash||data.result!==c.result||data.ownerWorkId!==c.owner_work_id||data.commandId!==c.command_id||c.receipt_hash!==rowHash('dsh-budget-command-receipt-v1',data)||c.result==='applied'&&h.owner_work_id!==c.owner_work_id)fail('dsh_budget_corrupt');
                }
            }
            const closure=one('SELECT * FROM dsh_budget_work_closures WHERE reservation_id=?',r.reservation_id);
            if(closure) {
                const c=parseDshInput('work_close',parse(closure.receipt_json));
                if(h.state!=='closed'||c.reservationId!==r.reservation_id||c.accountId!==ac.account_id||c.ownerWorkId!==h.owner_work_id||c.closureId!==closure.closure_id||closure.receipt_hash!==rowHash('dsh-budget-work-closure-v1',c)||h.closure_receipt_hash!==closure.receipt_hash||c.commandReceiptsHash!==rowHash('dsh-budget-work-command-receipts-v1',receipts(r.reservation_id))||!historicalUsageMatches(c.usageHash,r.reservation_id))fail('dsh_budget_corrupt');
            } else if(h.state==='closed'||h.closure_receipt_hash!==null)fail('dsh_budget_corrupt');
            availableTokens=add(availableTokens,h.available_tokens);availableCost=add(availableCost,h.available_cost);
        }
        return {availableTokens,availableCost};
    }
    function configure(v,a) {
        const hash=rowHash('dsh-budget-work-policy-v1',v),prior=one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',v.accountId);
        if(prior){if(prior.payload_hash!==hash||prior.authority_hash!==a.authorityHash)fail('dsh_work_policy_conflict');return prior;}
        run('INSERT INTO dsh_budget_work_policies VALUES(?,?,?,?,?)',v.accountId,v.maxActiveWorks,v.maxDraftRequestsPerWork,a.authorityHash,hash);
        return one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',v.accountId);
    }
    function reserve(v,a,ac,now,epoch) {
        if(v.scope.profileId!==profileId||v.scope.workspaceId!==workspaceId||v.thread.workspaceId!==workspaceId||v.thread.tenantId!==a.tenantId)fail('dsh_account_forbidden');
        const policy=one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',v.accountId);
        if(!policy)fail('dsh_work_policy_required');
        const id=workId(v.accountId,v.bindingId),old=birth(id);
        const data={accountId:v.accountId,bindingId:v.bindingId,generation:v.generation,scope:v.scope,thread:v.thread,initialTokens:v.initialTokens,initialCostMicros:v.initialCostMicros,deadline:v.deadline,maxDraftRequestsPerWork:policy.max_draft_requests};
        const hash=rowHash('dsh-budget-work-birth-v1',data);
        if(old&&old.birth_hash!==hash)fail('dsh_work_reservation_conflict');
        if(!old) {
            if(v.command.purpose!=='draft_admission')fail('dsh_work_reservation_required');
            if(ac.status!=='active'||now>=ac.valid_until||now>=v.deadline||v.deadline>ac.valid_until)fail('dsh_budget_expired');
            if(!policy.max_draft_requests)fail('dsh_work_draft_requests_exhausted');
            if(one("SELECT COUNT(*) AS count FROM dsh_budget_work_heads h JOIN dsh_budget_work_reservations r USING(reservation_id) WHERE r.account_id=? AND h.state<>'closed'",v.accountId).count>=policy.max_active_works)fail('dsh_work_slots_exhausted');
            if(add(add(ac.held_tokens,ac.spent_tokens),v.initialTokens)>ac.token_limit||add(add(ac.held_cost,ac.spent_cost),v.initialCostMicros)>ac.cost_limit)fail('dsh_budget_insufficient');
            run('INSERT INTO dsh_budget_work_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,v.accountId,v.bindingId,1,json(v.scope),rowHash('dsh-budget-work-scope-v1',v.scope),json(v.thread),rowHash('dsh-budget-work-thread-v1',v.thread),v.initialTokens,v.initialCostMicros,policy.max_draft_requests,v.deadline,hash);
            run("INSERT INTO dsh_budget_work_heads VALUES(?,1,'reserved',NULL,?,?,0,0,0,0,0,0,0,0,1,0,NULL)",id,v.initialTokens,v.initialCostMicros);
            run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens+?,held_cost=held_cost+? WHERE account_id=?',v.initialTokens,v.initialCostMicros,v.accountId);bump(v.accountId);
        }
        const attestationId='dsh-budget-attestation:'+rowHash('dsh-budget-attestation-id-v1',{reservationId:id,operationKey:v.command.operationKey,purpose:v.command.purpose});
        let at=one('SELECT * FROM dsh_budget_command_attestations WHERE attestation_id=?',attestationId),disposition='existing';
        if(at) {
            if(at.semantic_payload_hash!==v.command.semanticPayloadHash||at.assessment_ref!==v.command.assessmentRef||at.authority_hash!==a.authorityHash)fail('dsh_work_command_conflict');
        } else {
            const h=head(id);
            if(ac.status!=='active'||now>=v.deadline||h.state==='closed'||h.state==='unknown'||h.state==='closing')fail('dsh_work_reservation_unavailable');
            if(v.command.purpose==='draft_prepare'&&h.owner_work_id===null)fail('dsh_work_reservation_required');
            const raw={attestationId,reservationId:id,operationKey:v.command.operationKey,semanticPayloadHash:v.command.semanticPayloadHash,assessmentRef:v.command.assessmentRef,purpose:v.command.purpose,issuerDomain:v.accountId,authorityHash:a.authorityHash,ownerEpoch:epoch,validUntil:v.deadline};
            run('INSERT INTO dsh_budget_command_attestations VALUES(?,?,?,?,?,?,?,?,?,?,?)',attestationId,id,raw.operationKey,raw.semanticPayloadHash,raw.assessmentRef,raw.purpose,raw.issuerDomain,raw.authorityHash,epoch,v.deadline,rowHash('dsh-budget-attestation-v1',raw));
            disposition='newly_reserved';at=one('SELECT * FROM dsh_budget_command_attestations WHERE attestation_id=?',attestationId);
        }
        return {schemaVersion:1,kind:'work_reservation_receipt',disposition,reservation:birth(id),head:head(id),attestation:at};
    }
    function bind(v) {
        const r=birth(v.reservationId),h=r&&head(v.reservationId),at=one('SELECT * FROM dsh_budget_command_attestations WHERE attestation_id=?',v.attestationId);
        if(!r||r.account_id!==v.accountId||!h||!at||at.reservation_id!==r.reservation_id||at.operation_key!==v.operationKey||at.semantic_payload_hash!==v.semanticPayloadHash)fail('dsh_work_receipt_forbidden');
        const hash=rowHash('dsh-budget-command-receipt-v1',v),old=one('SELECT * FROM dsh_budget_command_receipts WHERE attestation_id=?',v.attestationId);
        if(old){if(old.receipt_hash!==hash)fail('dsh_work_receipt_conflict');return h;}
        if(h.state==='closed'||h.state==='closing')fail('dsh_work_reservation_unavailable');
        if(v.result==='applied'&&h.owner_work_id!==null&&h.owner_work_id!==v.ownerWorkId)fail('dsh_work_receipt_conflict');
        run('INSERT INTO dsh_budget_command_receipts VALUES(?,?,?,?,?,?)',v.attestationId,v.result,v.ownerWorkId,v.commandId,json(v),hash);
        if(v.result==='applied'&&h.owner_work_id===null)run("UPDATE dsh_budget_work_heads SET revision=revision+1,state=?,owner_work_id=? WHERE reservation_id=?",h.state==='unknown'?'unknown':'bound',v.ownerWorkId,r.reservation_id);
        bump(v.accountId);return head(v.reservationId);
    }
    function allocate(ac,op,at) {
        const policy=one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',ac.account_id);
        if(op.purpose!=='draft'||!policy)return null;
        const h=one('SELECT * FROM dsh_budget_work_heads WHERE owner_work_id=?',op.workId),r=h&&birth(h.reservation_id);
        if(!h||!r||r.account_id!==ac.account_id)fail('dsh_work_reservation_required');
        if(isFinalized?.(r.reservation_id,op.operationKey))fail('dsh_draft_usage_finalized');
        if(h.state!=='bound'||op.deadline>r.deadline)fail('dsh_work_reservation_unavailable');
        if(h.charged_requests>=r.max_draft_requests)fail('dsh_work_draft_requests_exhausted');
        if(h.available_tokens<at.maxTokens||h.available_cost<at.maxCostMicros)fail('dsh_work_budget_insufficient');
        return h;
    }
    function allocated(h,v) {
        run('INSERT INTO dsh_budget_work_attempts VALUES(?,?,?,?,?,1)',v.accountId,v.operation.operationKey,v.attempt.sequence,h.reservation_id,h.next_sequence);
        run('UPDATE dsh_budget_work_heads SET revision=revision+1,available_tokens=available_tokens-?,available_cost=available_cost-?,held_tokens=held_tokens+?,held_cost=held_cost+?,next_sequence=next_sequence+1,charged_requests=charged_requests+1 WHERE reservation_id=?',v.attempt.maxTokens,v.attempt.maxCostMicros,v.attempt.maxTokens,v.attempt.maxCostMicros,h.reservation_id);
    }
    function edge(t){return one('SELECT * FROM dsh_budget_work_attempts WHERE account_id=? AND operation_key=? AND attempt_sequence=?',t.account_id,t.operation_key,t.attempt_sequence);}
    function settled(t,v) {
        const e=edge(t);if(!e)return null;
        const h=head(e.reservation_id);
        const debitTokens=Math.min(h.available_tokens,Math.max(0,v.actualTokens-t.max_tokens)),debitCost=Math.min(h.available_cost,Math.max(0,v.actualCostMicros-t.max_cost));
        const refundTokens=Math.max(0,t.max_tokens-v.actualTokens),refundCost=Math.max(0,t.max_cost-v.actualCostMicros);
        const overrun=v.actualTokens>t.max_tokens||v.actualCostMicros>t.max_cost;
        run("UPDATE dsh_budget_work_heads SET revision=revision+1,state=?,held_tokens=held_tokens-?,held_cost=held_cost-?,available_tokens=available_tokens+?-?,available_cost=available_cost+?-?,spent_tokens=spent_tokens+?,spent_cost=spent_cost+?,overrun_tokens=overrun_tokens+?,overrun_cost=overrun_cost+? WHERE reservation_id=?",overrun?'closing':h.state,t.max_tokens,t.max_cost,refundTokens,debitTokens,refundCost,debitCost,v.actualTokens,v.actualCostMicros,Math.max(0,v.actualTokens-t.max_tokens-debitTokens),Math.max(0,v.actualCostMicros-t.max_cost-debitCost),e.reservation_id);
        return {heldTokens:v.actualTokens>t.max_tokens?t.max_tokens+debitTokens:v.actualTokens,heldCost:v.actualCostMicros>t.max_cost?t.max_cost+debitCost:v.actualCostMicros};
    }
    function recovered(t) {
        const e=edge(t);if(!e)return false;
        run('UPDATE dsh_budget_work_attempts SET charged=0 WHERE account_id=? AND operation_key=? AND attempt_sequence=?',e.account_id,e.operation_key,e.attempt_sequence);
        run('UPDATE dsh_budget_work_heads SET revision=revision+1,available_tokens=available_tokens+?,available_cost=available_cost+?,held_tokens=held_tokens-?,held_cost=held_cost-?,charged_requests=charged_requests-1 WHERE reservation_id=?',t.max_tokens,t.max_cost,t.max_tokens,t.max_cost,e.reservation_id);return true;
    }
    function recoverHeads() {run("UPDATE dsh_budget_work_heads SET revision=revision+1,state='unknown' WHERE state<>'closed' AND state<>'unknown'");}
    function close(v) {
        const r=birth(v.reservationId),h=r&&head(v.reservationId);
        if(!r||r.account_id!==v.accountId||!h||h.owner_work_id!==v.ownerWorkId)fail('dsh_work_receipt_forbidden');
        const hash=rowHash('dsh-budget-work-closure-v1',v),old=one('SELECT * FROM dsh_budget_work_closures WHERE reservation_id=?',v.reservationId);
        if(old){if(old.receipt_hash!==hash)fail('dsh_work_receipt_conflict');return h;}
        if(h.state==='unknown'||h.held_tokens||h.held_cost)fail('dsh_work_outcome_unknown');
        const ats=all('SELECT * FROM dsh_budget_command_attestations WHERE reservation_id=?',v.reservationId),rs=receipts(v.reservationId);
        if(ats.length!==rs.length||v.commandReceiptsHash!==rowHash('dsh-budget-work-command-receipts-v1',rs)||v.usageHash!==rowHash('dsh-budget-work-usage-v1',usage(v.reservationId)))fail('dsh_work_outcome_unknown');
        run('INSERT INTO dsh_budget_work_closures VALUES(?,?,?,?)',v.reservationId,v.closureId,json(v),hash);
        run("UPDATE dsh_budget_work_heads SET revision=revision+1,state='closed',released_tokens=released_tokens+available_tokens,released_cost=released_cost+available_cost,available_tokens=0,available_cost=0,closure_receipt_hash=? WHERE reservation_id=?",hash,v.reservationId);
        run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens-?,held_cost=held_cost-? WHERE account_id=?',h.available_tokens,h.available_cost,v.accountId);bump(v.accountId);return head(v.reservationId);
    }
    function snapshot(v) {
        const reservation=one('SELECT * FROM dsh_budget_work_reservations WHERE account_id=? AND binding_id=? AND generation=?',v.accountId,v.bindingId,v.generation);
        if(!reservation)return {state:'not_observed',reservation:null,head:null,attestation:null,commandReceipt:null,closureBasis:null};
        const attestation=one('SELECT * FROM dsh_budget_command_attestations WHERE reservation_id=? AND operation_key=? AND purpose=?',reservation.reservation_id,v.operationKey,v.purpose);
        if(attestation&&attestation.semantic_payload_hash!==v.semanticPayloadHash)fail('dsh_work_receipt_conflict');
        return {state:'observed',reservation,head:head(reservation.reservation_id),attestation:attestation??null,commandReceipt:attestation?one('SELECT * FROM dsh_budget_command_receipts WHERE attestation_id=?',attestation.attestation_id)??null:null,closureBasis:{commandReceiptsHash:rowHash('dsh-budget-work-command-receipts-v1',receipts(reservation.reservation_id)),usageHash:rowHash('dsh-budget-work-usage-v1',usage(reservation.reservation_id))}};
    }
    function capacity(accountId) {
        const policy=one('SELECT * FROM dsh_budget_work_policies WHERE account_id=?',accountId);
        if(!policy)return null;
        const active=one("SELECT COUNT(*) AS n FROM dsh_budget_work_heads h JOIN dsh_budget_work_reservations r USING(reservation_id) WHERE r.account_id=? AND h.state!='closed'",accountId);
        dshInteger(active.n);dshInteger(policy.max_active_works);dshInteger(policy.max_draft_requests);
        return {maxActiveWorks:policy.max_active_works,maxDraftRequestsPerWork:policy.max_draft_requests,activeWorks:active.n};
    }
    return {graphAccount,configure,reserve,bind,allocate,allocated,settled,recovered,recoverHeads,close,edge,capacity,snapshot};
}
