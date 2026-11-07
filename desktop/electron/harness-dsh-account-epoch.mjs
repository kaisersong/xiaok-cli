import {dshDigest,dshFail as fail,dshInteger,dshHash} from './harness-dsh-budget-data.mjs';
export const ACCOUNT_EPOCH_PROFILE='harness_dsh_account_authorization_epoch_v1';
const tables=[
 'dsh_budget_accounts','dsh_budget_operations','dsh_budget_attempts',
 'dsh_budget_work_policies','dsh_budget_work_reservations','dsh_budget_work_heads',
 'dsh_budget_work_attempts','dsh_budget_command_attestations','dsh_budget_command_receipts','dsh_budget_work_closures',
 'dsh_budget_source_accounts','dsh_budget_source_scans','dsh_budget_source_attempts','dsh_budget_source_identity_history',
 'dsh_budget_cost_accounting_receipts','dsh_budget_account_revisions','dsh_budget_draft_usage_receipts','dsh_budget_account_epochs',
];
let guards='';
for(let i=0;i<tables.length;i++)for(const op of ['INSERT','UPDATE','DELETE'])
 guards+=`\nCREATE TRIGGER dsh_v8_${tables[i]}_${op.toLowerCase()} BEFORE ${op} ON ${tables[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v8() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;
export const ACCOUNT_EPOCH_SQL=`
CREATE TABLE dsh_budget_account_epochs (
 account_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
 kind TEXT NOT NULL CHECK(kind IN ('anchor','revision')),owner_id TEXT NOT NULL,authority_hash TEXT NOT NULL,
 mandate_revision INTEGER NOT NULL CHECK(typeof(mandate_revision)='integer' AND mandate_revision>0),
 authorization_epoch INTEGER NOT NULL CHECK(typeof(authorization_epoch)='integer' AND authorization_epoch>0),
 account_revision INTEGER NOT NULL CHECK(typeof(account_revision)='integer' AND account_revision>0),
 revision_receipt_hash TEXT,previous_hash TEXT,receipt_hash TEXT NOT NULL,
 PRIMARY KEY(account_id,ordinal),UNIQUE(account_id,mandate_revision),
 FOREIGN KEY(account_id) REFERENCES dsh_budget_accounts(account_id)
);
CREATE TRIGGER dsh_account_epoch_immutable_update BEFORE UPDATE ON dsh_budget_account_epochs BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_account_epoch_immutable_delete BEFORE DELETE ON dsh_budget_account_epochs BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;`+guards;
function body(row){
 return {accountId:row.account_id,ordinal:row.ordinal,kind:row.kind,ownerId:row.owner_id,authorityHash:row.authority_hash,
  mandateRevision:row.mandate_revision,authorizationEpoch:row.authorization_epoch,accountRevision:row.account_revision,
  revisionReceiptHash:row.revision_receipt_hash,previousHash:row.previous_hash};
}
/** Immutable history in the one original ledger. Inputs come only from the
 * original account row and its authenticated revision transaction. */
export function createDshAccountEpochHistory({one,all,run}){
 function insert(row){
  run('INSERT INTO dsh_budget_account_epochs VALUES(?,?,?,?,?,?,?,?,?,?,?)',row.account_id,row.ordinal,row.kind,row.owner_id,row.authority_hash,row.mandate_revision,row.authorization_epoch,row.account_revision,row.revision_receipt_hash,row.previous_hash,dshDigest('dsh-account-epoch-v1',body(row)));
 }
 function anchor(account){
  const last=one('SELECT receipt_hash FROM dsh_budget_account_revisions WHERE account_id=? ORDER BY ordinal DESC LIMIT 1',account.account_id);
  insert({account_id:account.account_id,ordinal:0,kind:'anchor',owner_id:account.owner_id,authority_hash:account.authority_hash,
   mandate_revision:account.mandate_revision,authorization_epoch:account.authorization_epoch,account_revision:account.revision,
   revision_receipt_hash:last?.receipt_hash??null,previous_hash:null});
 }
 function advance(prior,authority,nextRevision,revisionHash){
  const previous=one('SELECT * FROM dsh_budget_account_epochs WHERE account_id=? ORDER BY ordinal DESC LIMIT 1',prior.account_id);
  if(!previous||previous.authorization_epoch!==prior.authorization_epoch||previous.mandate_revision!==prior.mandate_revision||authority.authorizationEpoch!==prior.authorization_epoch+1)fail('dsh_account_epoch_conflict');
  insert({account_id:prior.account_id,ordinal:previous.ordinal+1,kind:'revision',owner_id:prior.owner_id,authority_hash:prior.authority_hash,
   mandate_revision:authority.mandateRevision,authorization_epoch:authority.authorizationEpoch,account_revision:nextRevision,
   revision_receipt_hash:revisionHash,previous_hash:previous.receipt_hash});
 }
 function graph(account){
  const rows=all('SELECT * FROM dsh_budget_account_epochs WHERE account_id=? ORDER BY ordinal',account.account_id);
  if(!rows.length)fail('dsh_budget_corrupt');
  let previous;
  for(let i=0;i<rows.length;i++){
   const row=rows[i];dshInteger(row.ordinal);dshInteger(row.mandate_revision,1);dshInteger(row.authorization_epoch,1);dshInteger(row.account_revision,1);
   dshHash(row.authority_hash);dshHash(row.receipt_hash);
   if(row.ordinal!==i||row.owner_id!==account.owner_id||row.authority_hash!==account.authority_hash||row.receipt_hash!==dshDigest('dsh-account-epoch-v1',body(row)))fail('dsh_budget_corrupt');
   if(!previous){
    if(row.kind!=='anchor'||row.previous_hash!==null)fail('dsh_budget_corrupt');
    const original=all('SELECT * FROM dsh_budget_account_revisions WHERE account_id=? AND next_account_revision<=? ORDER BY ordinal',account.account_id,row.account_revision),last=original.length?original[original.length-1]:null;
    if(row.revision_receipt_hash!==(last?.receipt_hash??null)||last&&last.next_mandate_revision!==row.mandate_revision)fail('dsh_budget_corrupt');
   }else{
    dshHash(row.revision_receipt_hash);dshHash(row.previous_hash);
    const revision=one('SELECT * FROM dsh_budget_account_revisions WHERE account_id=? AND receipt_hash=?',account.account_id,row.revision_receipt_hash);
    if(row.kind!=='revision'||row.previous_hash!==previous.receipt_hash||row.authorization_epoch!==previous.authorization_epoch+1||row.mandate_revision<=previous.mandate_revision||!revision||revision.previous_mandate_revision!==previous.mandate_revision||revision.next_mandate_revision!==row.mandate_revision||revision.previous_account_revision<previous.account_revision||revision.next_account_revision!==row.account_revision)fail('dsh_budget_corrupt');
   }
   previous=row;
  }
  if(previous.authorization_epoch!==account.authorization_epoch||previous.mandate_revision!==account.mandate_revision||previous.account_revision>account.revision)fail('dsh_budget_corrupt');
 }
 return {anchor,advance,graph};
}
