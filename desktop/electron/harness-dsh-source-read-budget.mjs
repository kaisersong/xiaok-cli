import {types} from 'node:util';
import {dshRecord,dshInteger,dshId,dshHash,dshDigest,dshFail as fail} from './harness-dsh-budget-data.mjs';
const json=JSON.stringify,parse=JSON.parse,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy,lower=String.prototype.toLowerCase,apply=Reflect.apply;
export const SOURCE_READ_PROFILE='harness_dsh_source_resources_v1';
export const SOURCE_TENANT_PROFILE='harness_dsh_source_setup_tenant_v2';
const TABLES=['dsh_budget_accounts','dsh_budget_operations','dsh_budget_attempts','dsh_budget_work_policies','dsh_budget_work_reservations','dsh_budget_work_heads','dsh_budget_work_attempts','dsh_budget_command_attestations','dsh_budget_command_receipts','dsh_budget_work_closures','dsh_budget_source_accounts','dsh_budget_source_scans','dsh_budget_source_attempts','dsh_budget_source_identity_history'];
let guards='';
for(let i=0;i<TABLES.length;i++)for(const operation of ['INSERT','UPDATE','DELETE'])guards+=`\nCREATE TRIGGER dsh_v4_${TABLES[i]}_${operation.toLowerCase()} BEFORE ${operation} ON ${TABLES[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v4() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;
const tenantTables=[...TABLES,'dsh_budget_cost_accounting_receipts','dsh_budget_account_revisions','dsh_budget_draft_usage_receipts','dsh_budget_account_epochs','dsh_budget_source_tenant_transitions'];
let tenantGuards='';
const tenantOperations=['INSERT','UPDATE','DELETE'];
for(let i=0;i<tenantTables.length;i++)for(let j=0;j<tenantOperations.length;j++){
    const operation=tenantOperations[j];
    tenantGuards+=(tenantGuards?'\n':'')+`CREATE TRIGGER dsh_v9_${tenantTables[i]}_${apply(lower,operation,[])} BEFORE ${operation} ON ${tenantTables[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v9() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;
}
export const SOURCE_TENANT_SQL=`CREATE TABLE dsh_budget_source_tenant_transitions (
 account_id TEXT PRIMARY KEY REFERENCES dsh_budget_source_accounts(account_id),
 legacy_identity_json TEXT NOT NULL,legacy_identity_hash TEXT NOT NULL,legacy_source_key TEXT NOT NULL,
 target_identity_json TEXT NOT NULL,target_identity_hash TEXT NOT NULL,target_source_key TEXT NOT NULL,
 history_revision INTEGER NOT NULL CHECK(typeof(history_revision)='integer' AND history_revision>=2),
 migration_at INTEGER NOT NULL CHECK(typeof(migration_at)='integer' AND migration_at>=0),
 owner_epoch INTEGER NOT NULL CHECK(typeof(owner_epoch)='integer' AND owner_epoch>=1),
 previous_active_scan_id TEXT,receipt_hash TEXT NOT NULL
);
CREATE TRIGGER dsh_source_tenant_transition_immutable_update BEFORE UPDATE ON dsh_budget_source_tenant_transitions BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_source_tenant_transition_immutable_delete BEFORE DELETE ON dsh_budget_source_tenant_transitions BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
`+tenantGuards;
export const SOURCE_SCHEMA_SQL=`
CREATE TABLE dsh_budget_source_accounts (
 account_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 source_key TEXT NOT NULL UNIQUE,identity_kind TEXT NOT NULL CHECK(identity_kind IN ('source_setup','source_binding')),
 identity_json TEXT NOT NULL,identity_hash TEXT NOT NULL,active_scan_id TEXT,
 uncertain INTEGER NOT NULL CHECK(uncertain IN (0,1))
);
CREATE TABLE dsh_budget_source_identity_history (
 account_id TEXT NOT NULL REFERENCES dsh_budget_source_accounts(account_id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 identity_json TEXT NOT NULL,identity_hash TEXT NOT NULL,previous_hash TEXT NOT NULL,
 owner_epoch INTEGER NOT NULL CHECK(typeof(owner_epoch)='integer' AND owner_epoch>=1),
 PRIMARY KEY(account_id,revision)
);
CREATE TRIGGER dsh_source_identity_immutable_update BEFORE UPDATE ON dsh_budget_source_identity_history BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_source_identity_immutable_delete BEFORE DELETE ON dsh_budget_source_identity_history BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TABLE dsh_budget_source_scans (
 scan_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES dsh_budget_source_accounts(account_id),
 owner_epoch INTEGER NOT NULL CHECK(typeof(owner_epoch)='integer' AND owner_epoch>=1),
 started_at INTEGER NOT NULL,deadline INTEGER NOT NULL CHECK(deadline=started_at+30000),
 held_bytes INTEGER NOT NULL CHECK(typeof(held_bytes)='integer' AND held_bytes>=0),
 spent_bytes INTEGER NOT NULL CHECK(typeof(spent_bytes)='integer' AND spent_bytes>=0),
 spent_requests INTEGER NOT NULL CHECK(typeof(spent_requests)='integer' AND spent_requests>=0),
 held_requests INTEGER NOT NULL CHECK(typeof(held_requests)='integer' AND held_requests>=0),
 next_sequence INTEGER NOT NULL CHECK(typeof(next_sequence)='integer' AND next_sequence>=1),
 uncertain INTEGER NOT NULL CHECK(uncertain IN (0,1))
);
CREATE TABLE dsh_budget_source_attempts (
 attempt_id TEXT PRIMARY KEY,scan_id TEXT NOT NULL REFERENCES dsh_budget_source_scans(scan_id),
 request_sequence INTEGER NOT NULL CHECK(typeof(request_sequence)='integer' AND request_sequence>=1),
 request_digest TEXT NOT NULL,upper_bytes INTEGER NOT NULL CHECK(typeof(upper_bytes)='integer' AND upper_bytes BETWEEN 1 AND 1048576),
 state TEXT NOT NULL CHECK(state IN ('prepared','known','not_sent','unknown')),
 request_sent INTEGER CHECK(request_sent IN (0,1)),actual_bytes INTEGER CHECK(actual_bytes IS NULL OR (typeof(actual_bytes)='integer' AND actual_bytes>=0)),
 settlement_json TEXT,settlement_hash TEXT,
 UNIQUE(scan_id,request_sequence)
);`+guards;
export function parseSourceIdentity(raw) {
    const tag=dshRecordTag(raw);
    let v;
    if(tag==='source_binding') {
        v=dshRecord(raw,['kind','sourceBindingId','configurationRevision','credentialEpoch','providerAccountId','repositoryId']);
        dshId(v.sourceBindingId);dshInteger(v.configurationRevision,1);dshInteger(v.credentialEpoch,1);dshId(v.providerAccountId);dshId(v.repositoryId);
    } else if(tag==='source_setup') {
        const version=descriptor(raw,'identityVersion');
        v=dshRecord(raw,version?['kind','identityVersion','tenantId','setupId','candidateRepository']:['kind','setupId','candidateRepository']);dshId(v.setupId);
        if(version){if(v.identityVersion!==2)fail('dsh_source_authority_required');dshId(v.tenantId);}
        const repo=dshRecord(v.candidateRepository,['owner','name']);dshId(repo.owner);dshId(repo.name);
        v=version?{kind:v.kind,identityVersion:2,tenantId:v.tenantId,setupId:v.setupId,candidateRepository:repo}:{kind:v.kind,setupId:v.setupId,candidateRepository:repo};
    } else fail('dsh_source_authority_required');
    return v;
}
// No discriminator getter: exact member data is checked by dshRecord first.
function dshRecordTag(raw) {
    if(!raw||typeof raw!=='object'||isProxy(raw))fail('dsh_source_authority_required');
    const row=descriptor(raw,'kind');
    if(!row||!own(row,'value'))fail('dsh_source_authority_required');
    return row.value;
}
export function parseSourceReadInput(purpose,input) {
    let v;
    if(purpose==='source_read_scan') {
        v=dshRecord(input,['accountId','scanId']);dshId(v.accountId);dshId(v.scanId);
    } else if(purpose==='source_read_migrate') {
        v=dshRecord(input,['accountId']);dshId(v.accountId);
    } else if(purpose==='source_read_reserve') {
        v=dshRecord(input,['accountId','scanId','attemptId','requestDigest','responseBytesUpperBound']);
        dshId(v.accountId);dshId(v.scanId);dshId(v.attemptId);dshHash(v.requestDigest);dshInteger(v.responseBytesUpperBound,1,1048576);
    } else if(purpose==='source_read_settle') {
        v=dshRecord(input,['actualResponseBytes','requestSent','physicallyClosed','outcome']);
        if(v.actualResponseBytes!==null)dshInteger(v.actualResponseBytes,0,Number.MAX_SAFE_INTEGER);
        if(typeof v.requestSent!=='boolean'||typeof v.physicallyClosed!=='boolean'||v.outcome!=='known'&&v.outcome!=='unknown'||v.outcome==='known'&&v.actualResponseBytes===null)fail('dsh_source_budget_invalid');
    } else fail('dsh_source_budget_invalid');
    return v;
}
export function dshSourceReadCommandDigest(purpose,input){return dshDigest('dsh-source-read-command-v1',{purpose,input:parseSourceReadInput(purpose,input)});}
export function createSourceReadBudget({one,all,run,ownerId,profileId,workspaceId,hasTenantSchema=()=>false}) {
    const digest=(domain,value)=>dshDigest(domain,value);
    function identity(raw) {
        const value=parseSourceIdentity(raw),key=value.kind==='source_binding'?{kind:value.kind,id:value.sourceBindingId}:{kind:value.kind,owner:apply(lower,value.candidateRepository.owner,[]),name:apply(lower,value.candidateRepository.name,[])};
        const v2=value.kind==='source_setup'&&value.identityVersion===2;
        return {value,key:digest(v2?'dsh-budget-source-key-v2':'dsh-budget-source-key-v1',{ownerId,profileId,workspaceId,...(v2?{tenantId:value.tenantId}:{}),identity:key}),hash:digest(v2?'dsh-budget-source-identity-v2':'dsh-budget-source-identity-v1',value)};
    }
    function sameCandidate(left,right){return left.kind==='source_setup'&&right.kind==='source_setup'&&apply(lower,left.candidateRepository.owner,[])===apply(lower,right.candidateRepository.owner,[])&&apply(lower,left.candidateRepository.name,[])===apply(lower,right.candidateRepository.name,[]);}
    function transitionBody(row){
        return {accountId:row.account_id,legacyIdentityHash:row.legacy_identity_hash,legacySourceKey:row.legacy_source_key,
            targetIdentityHash:row.target_identity_hash,targetSourceKey:row.target_source_key,historyRevision:row.history_revision,
            migrationAt:row.migration_at,ownerEpoch:row.owner_epoch,previousActiveScanId:row.previous_active_scan_id};
    }
    function transition(a){
        const row=hasTenantSchema()?one('SELECT * FROM dsh_budget_source_tenant_transitions WHERE account_id=?',a.account_id):undefined;
        if(!row)return undefined;
        const prior=identity(parse(row.legacy_identity_json)),target=identity(parse(row.target_identity_json));
        dshInteger(row.history_revision,2);dshInteger(row.migration_at,0,1e15);dshInteger(row.owner_epoch,1);
        for(const name of ['legacy_identity_hash','legacy_source_key','target_identity_hash','target_source_key','receipt_hash'])dshHash(row[name]);
        if(row.previous_active_scan_id!==null)dshId(row.previous_active_scan_id);
        if(prior.value.kind!=='source_setup'||prior.value.identityVersion!==undefined||target.value.kind!=='source_setup'||target.value.identityVersion!==2||
            prior.value.setupId!==target.value.setupId||!sameCandidate(prior.value,target.value)||prior.hash!==row.legacy_identity_hash||prior.key!==row.legacy_source_key||
            target.hash!==row.target_identity_hash||target.key!==row.target_source_key||a.identity_hash!==target.hash||a.source_key!==target.key||
            row.receipt_hash!==digest('dsh-source-tenant-transition-v1',transitionBody(row)))fail('dsh_budget_corrupt');
        if(row.previous_active_scan_id!==null){
            const scan=one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',row.previous_active_scan_id);
            if(!scan||scan.account_id!==a.account_id||scan.held_requests||scan.held_bytes||scan.uncertain||scan.owner_epoch>row.owner_epoch||scan.owner_epoch===row.owner_epoch&&scan.deadline>row.migration_at)fail('dsh_budget_corrupt');
        }
        return row;
    }
    function account(accountId,raw) {
        const a=one('SELECT * FROM dsh_budget_source_accounts WHERE account_id=?',accountId),id=identity(raw);
        if(!a||a.source_key!==id.key||a.identity_hash!==id.hash||a.owner_id!==ownerId||a.profile_id!==profileId||a.workspace_id!==workspaceId)fail('dsh_source_account_forbidden');return a;
    }
    function graph() {
        for(const a of all('SELECT * FROM dsh_budget_source_accounts')) {
            const id=identity(parse(a.identity_json));
            if(a.owner_id!==ownerId||a.profile_id!==profileId||a.workspace_id!==workspaceId||a.identity_kind!==id.value.kind||a.identity_hash!==id.hash||a.source_key!==id.key||a.uncertain!==0&&a.uncertain!==1)fail('dsh_budget_corrupt');
            const history=all('SELECT * FROM dsh_budget_source_identity_history WHERE account_id=? ORDER BY revision',a.account_id);
            const moved=transition(a);
            if(moved&&(history.length!==moved.history_revision||history[history.length-2]?.identity_hash!==moved.legacy_identity_hash||history[history.length-1]?.identity_hash!==moved.target_identity_hash))fail('dsh_budget_corrupt');
            if(!history.length)fail('dsh_budget_corrupt');let previous='0'.repeat(64);
            for(let h=0;h<history.length;h++){
                const row=history[h],fact=identity(parse(row.identity_json));dshInteger(row.owner_epoch,1);
                if(row.revision!==h+1||row.previous_hash!==previous||row.identity_hash!==fact.hash||fact.key!==a.source_key&&!(moved&&row.revision<moved.history_revision&&fact.key===moved.legacy_source_key))fail('dsh_budget_corrupt');
                previous=row.identity_hash;
            }
            if(previous!==a.identity_hash)fail('dsh_budget_corrupt');
            let unknown=false;
            for(const s of all('SELECT * FROM dsh_budget_source_scans WHERE account_id=?',a.account_id)) {
                for(const field of ['owner_epoch','started_at','deadline','held_bytes','spent_bytes','spent_requests','held_requests','next_sequence'])dshInteger(s[field],field==='owner_epoch'||field==='next_sequence'?1:0,Number.MAX_SAFE_INTEGER);
                if(s.deadline!==s.started_at+30000||s.uncertain!==0&&s.uncertain!==1)fail('dsh_budget_corrupt');
                let heldBytes=0,spentBytes=0,heldRequests=0,spentRequests=0,uncertain=false;
                const rows=all('SELECT * FROM dsh_budget_source_attempts WHERE scan_id=? ORDER BY request_sequence',s.scan_id);
                for(let i=0;i<rows.length;i++) {
                    const r=rows[i];dshId(r.attempt_id);dshHash(r.request_digest);dshInteger(r.upper_bytes,1,1048576);
                    if(r.request_sequence!==i+1)fail('dsh_budget_corrupt');
                    if(r.state==='prepared'||r.state==='unknown'){heldBytes+=r.upper_bytes;heldRequests++;if(r.state==='unknown')uncertain=true;}
                    else if(r.state==='known'||r.state==='not_sent') {
                        const settlement=parseSourceReadInput('source_read_settle',parse(r.settlement_json));
                        if(settlement.physicallyClosed!==true||settlement.outcome!=='known'||settlement.actualResponseBytes!==r.actual_bytes||Number(settlement.requestSent)!==r.request_sent||r.settlement_hash!==digest('dsh-budget-source-settlement-v1',settlement)||r.state!==(settlement.requestSent?'known':'not_sent'))fail('dsh_budget_corrupt');
                        spentBytes+=r.actual_bytes;spentRequests+=r.request_sent;
                    } else fail('dsh_budget_corrupt');
                }
                if(s.next_sequence!==rows.length+1||s.held_bytes!==heldBytes||s.spent_bytes!==spentBytes||s.held_requests!==heldRequests||s.spent_requests!==spentRequests||uncertain&&!s.uncertain)fail('dsh_budget_corrupt');
                if(s.uncertain)unknown=true;
            }
            if(unknown&&!a.uncertain)fail('dsh_budget_corrupt');
            if(a.active_scan_id!==null&&!one('SELECT 1 FROM dsh_budget_source_scans WHERE account_id=? AND scan_id=?',a.account_id,a.active_scan_id))fail('dsh_budget_corrupt');
        }
    }
    function execute(purpose,input,rawIdentity,now,epoch,existing) {
        const v=parseSourceReadInput(purpose,input),id=identity(rawIdentity);
        if(purpose==='source_read_migrate'){
            if(id.value.kind!=='source_setup'||id.value.identityVersion!==2)fail('dsh_source_authority_required');
            const a=one('SELECT * FROM dsh_budget_source_accounts WHERE account_id=?',v.accountId);
            if(!a)return {disposition:'not_required',transition:null};
            if(a.owner_id!==ownerId||a.profile_id!==profileId||a.workspace_id!==workspaceId)fail('dsh_source_account_forbidden');
            if(a.identity_hash===id.hash&&a.source_key===id.key){const moved=transition(a);return {disposition:moved?'existing':'not_required',transition:moved??null};}
            // Reconstruct the old identity only from the current original
            // setup proof. The caller supplies no old hash, tenant or alias.
            const legacy=identity({kind:'source_setup',setupId:id.value.setupId,candidateRepository:id.value.candidateRepository});
            if(a.identity_kind!=='source_setup'||a.identity_hash!==legacy.hash||a.source_key!==legacy.key)fail('dsh_source_account_forbidden');
            const active=a.active_scan_id===null?undefined:one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',a.active_scan_id);
            if(a.uncertain||one('SELECT 1 FROM dsh_budget_source_scans WHERE account_id=? AND (held_requests>0 OR held_bytes>0 OR uncertain=1)',v.accountId)||
                active&&(active.owner_epoch>epoch||active.owner_epoch===epoch&&active.deadline>now))fail('dsh_source_migration_busy');
            if(one('SELECT 1 FROM dsh_budget_source_accounts WHERE source_key=?',id.key))fail('dsh_source_account_conflict');
            const revision=one('SELECT MAX(revision) AS revision FROM dsh_budget_source_identity_history WHERE account_id=?',v.accountId).revision+1;
            const row={account_id:v.accountId,legacy_identity_json:a.identity_json,legacy_identity_hash:a.identity_hash,legacy_source_key:a.source_key,
                target_identity_json:json(id.value),target_identity_hash:id.hash,target_source_key:id.key,history_revision:revision,migration_at:now,owner_epoch:epoch,previous_active_scan_id:a.active_scan_id};
            row.receipt_hash=digest('dsh-source-tenant-transition-v1',transitionBody(row));
            run('INSERT INTO dsh_budget_source_tenant_transitions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',row.account_id,row.legacy_identity_json,row.legacy_identity_hash,row.legacy_source_key,row.target_identity_json,row.target_identity_hash,row.target_source_key,row.history_revision,row.migration_at,row.owner_epoch,row.previous_active_scan_id,row.receipt_hash);
            run('INSERT INTO dsh_budget_source_identity_history VALUES(?,?,?,?,?,?)',v.accountId,revision,json(id.value),id.hash,a.identity_hash,epoch);
            const changed=run('UPDATE dsh_budget_source_accounts SET source_key=?,identity_json=?,identity_hash=?,active_scan_id=NULL WHERE account_id=? AND source_key=? AND identity_hash=?',id.key,json(id.value),id.hash,v.accountId,a.source_key,a.identity_hash);
            if(changed.changes!==1)fail('dsh_source_account_conflict');
            return {disposition:'migrated',transition:row};
        }
        if(purpose==='source_read_scan') {
            let a=one('SELECT * FROM dsh_budget_source_accounts WHERE account_id=?',v.accountId);
            if(!a) {
                const same=one('SELECT 1 FROM dsh_budget_source_accounts WHERE source_key=?',id.key);
                if(same)fail('dsh_source_account_conflict');
                // A new version/account must never escape an old source's held
                // resources. No tenant is inferred for historical v1 rows.
                if(id.value.kind==='source_setup')for(const row of all("SELECT identity_json FROM dsh_budget_source_accounts WHERE identity_kind='source_setup'")){
                    const prior=parseSourceIdentity(parse(row.identity_json));
                    if(sameCandidate(prior,id.value)&&(prior.identityVersion===2)!==(id.value.identityVersion===2))fail('dsh_source_legacy_migration_required');
                }
                run('INSERT INTO dsh_budget_source_accounts VALUES(?,?,?,?,?,?,?,?,NULL,0)',v.accountId,ownerId,profileId,workspaceId,id.key,id.value.kind,json(id.value),id.hash);
                run('INSERT INTO dsh_budget_source_identity_history VALUES(?,1,?,?,?,?)',v.accountId,json(id.value),id.hash,'0'.repeat(64),epoch);
                a=account(v.accountId,rawIdentity);
            } else {
                if(a.source_key!==id.key)fail('dsh_source_account_forbidden');
                if(a.identity_hash!==id.hash) {
                    if(a.uncertain||one('SELECT 1 FROM dsh_budget_source_scans WHERE account_id=? AND (held_requests>0 OR uncertain=1)',v.accountId))fail('dsh_source_budget_unconfirmed');
                    const old=parseSourceIdentity(parse(a.identity_json));
                    if(old.kind!=='source_binding'||id.value.kind!=='source_binding'||id.value.configurationRevision<=old.configurationRevision||id.value.credentialEpoch<old.credentialEpoch||id.value.credentialEpoch===old.credentialEpoch&&(id.value.providerAccountId!==old.providerAccountId||id.value.repositoryId!==old.repositoryId))fail('dsh_source_account_forbidden');
                    const prior=one('SELECT MAX(revision) AS revision FROM dsh_budget_source_identity_history WHERE account_id=?',v.accountId).revision;
                    run('INSERT INTO dsh_budget_source_identity_history VALUES(?,?,?,?,?,?)',v.accountId,prior+1,json(id.value),id.hash,a.identity_hash,epoch);
                    run('UPDATE dsh_budget_source_accounts SET identity_json=?,identity_hash=? WHERE account_id=? AND identity_hash=?',json(id.value),id.hash,v.accountId,a.identity_hash);
                }
                a=account(v.accountId,rawIdentity);
            }
            const old=one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',v.scanId);
            if(old){if(old.account_id!==v.accountId)fail('dsh_source_scan_conflict');return old;}
            if(a.uncertain||one('SELECT 1 FROM dsh_budget_source_scans WHERE account_id=? AND (held_requests>0 OR uncertain=1)',v.accountId))fail('dsh_source_budget_unconfirmed');
            run('INSERT INTO dsh_budget_source_scans VALUES(?,?,?,?,?,0,0,0,0,1,0)',v.scanId,v.accountId,epoch,now,now+30000);
            run('UPDATE dsh_budget_source_accounts SET active_scan_id=? WHERE account_id=?',v.scanId,v.accountId);return one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',v.scanId);
        }
        const accountId=purpose==='source_read_settle'?existing.accountId:v.accountId,scanId=purpose==='source_read_settle'?existing.scanId:v.scanId;
        const a=account(accountId,rawIdentity),s=one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',scanId);
        if(!s||s.account_id!==accountId)fail('dsh_source_scan_required');
        if(purpose==='source_read_reserve') {
            const old=one('SELECT * FROM dsh_budget_source_attempts WHERE attempt_id=?',v.attemptId);
            if(old){if(old.scan_id!==v.scanId||old.request_digest!==v.requestDigest||old.upper_bytes!==v.responseBytesUpperBound)fail('dsh_source_attempt_conflict');return {disposition:'existing',attempt:old,scan:s};}
            if(a.uncertain||s.uncertain||s.owner_epoch!==epoch||a.active_scan_id!==v.scanId)fail('dsh_source_budget_unconfirmed');
            if(now>=s.deadline)fail('dsh_source_budget_expired');
            if(s.held_requests+s.spent_requests>=64||s.held_bytes+s.spent_bytes+v.responseBytesUpperBound>4194304)fail('dsh_source_budget_exhausted');
            run("INSERT INTO dsh_budget_source_attempts VALUES(?,?,?,?,?,'prepared',NULL,NULL,NULL,NULL)",v.attemptId,v.scanId,s.next_sequence,v.requestDigest,v.responseBytesUpperBound);
            run('UPDATE dsh_budget_source_scans SET held_bytes=held_bytes+?,held_requests=held_requests+1,next_sequence=next_sequence+1 WHERE scan_id=?',v.responseBytesUpperBound,v.scanId);
            return {disposition:'newly_reserved',attempt:one('SELECT * FROM dsh_budget_source_attempts WHERE attempt_id=?',v.attemptId),scan:one('SELECT * FROM dsh_budget_source_scans WHERE scan_id=?',v.scanId)};
        }
        const row=one('SELECT * FROM dsh_budget_source_attempts WHERE attempt_id=?',existing.attemptId);
        if(!row||row.scan_id!==scanId||row.request_digest!==existing.requestDigest||row.upper_bytes!==existing.responseBytesUpperBound)fail('dsh_source_attempt_required');
        const hash=digest('dsh-budget-source-settlement-v1',v);
        if(row.state==='known'||row.state==='not_sent'){if(row.settlement_hash!==hash)fail('dsh_source_usage_conflict');return row;}
        if(row.state==='unknown')return row;
        if(v.outcome==='unknown'||!v.physicallyClosed||v.actualResponseBytes===null) {
            run("UPDATE dsh_budget_source_attempts SET state='unknown',settlement_json=?,settlement_hash=? WHERE attempt_id=?",json(v),hash,row.attempt_id);
            run('UPDATE dsh_budget_source_scans SET uncertain=1 WHERE scan_id=?',scanId);run('UPDATE dsh_budget_source_accounts SET uncertain=1 WHERE account_id=?',accountId);
        } else {
            run('UPDATE dsh_budget_source_attempts SET state=?,request_sent=?,actual_bytes=?,settlement_json=?,settlement_hash=? WHERE attempt_id=?',v.requestSent?'known':'not_sent',Number(v.requestSent),v.actualResponseBytes,json(v),hash,row.attempt_id);
            const over=v.actualResponseBytes>row.upper_bytes;
            run('UPDATE dsh_budget_source_scans SET held_bytes=held_bytes-?,held_requests=held_requests-1,spent_bytes=spent_bytes+?,spent_requests=spent_requests+?,uncertain=CASE WHEN ? THEN 1 ELSE uncertain END WHERE scan_id=?',row.upper_bytes,v.actualResponseBytes,Number(v.requestSent),over?1:0,scanId);
            if(over)run('UPDATE dsh_budget_source_accounts SET uncertain=1 WHERE account_id=?',accountId);
        }
        return one('SELECT * FROM dsh_budget_source_attempts WHERE attempt_id=?',row.attempt_id);
    }
    function recover() {
        const rows=all("SELECT a.attempt_id,a.scan_id,s.account_id FROM dsh_budget_source_attempts a JOIN dsh_budget_source_scans s USING(scan_id) WHERE a.state='prepared'");
        for(let i=0;i<rows.length;i++){const r=rows[i];run("UPDATE dsh_budget_source_attempts SET state='unknown' WHERE attempt_id=?",r.attempt_id);run('UPDATE dsh_budget_source_scans SET uncertain=1 WHERE scan_id=?',r.scan_id);run('UPDATE dsh_budget_source_accounts SET uncertain=1 WHERE account_id=?',r.account_id);}
    }
    return {execute,graph,recover};
}
