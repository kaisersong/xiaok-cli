import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createCompletionBoundary} from '../../../src/runtime/verification/completion-boundary.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createReceiverReplySigner,createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
const H='a'.repeat(64),owner={profileId:'p',ownerKind:'task' as const,ownerId:'task'},peer={uid:501,gid:20,auditSessionId:7};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'completion-boundary-')),keys=generateKeyPairSync('ed25519'),receipt={};let now=1000;
 const options={root,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'r',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'controller',verifierHash:H,keyId:'key',serviceEpoch:'boot1',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now+1,evidenceHash:H}),assertVerifiedPayload:()=>{ /* Real payload store is covered by its integration suite. */ },assertQualified:()=>{},quiescence:{assertQuiescent:(actual:unknown)=>{if(actual!==receipt)throw Error('no_physical_receipt');}}}};
 const boundary=createCompletionBoundary(options),registration={owner,migrationEpoch:1,obligations:[{obligationId:'o',predicateId:'original',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['content']}]};
 boundary.authority.service.registerObligations(registration,{requestSource:'user',authorization:boundary.authority.host.issueAuthorization({owner,method:'registerObligations',payload:registration,requestSource:'user',principalId:'fixture',expiresAt:2000})});
 return {root,options,boundary,receipt,keys,setNow:(value:number)=>{now=value;},close:()=>{boundary.close();rmSync(root,{recursive:true,force:true});}};
}
it('checks actual persistent owner ACL and kernel login session before every read',()=>{
 const f=fixture();try{
  const grant=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  const inspect=()=>f.boundary.invoke('completion.inspect',{owner,readGrant:grant},peer);
  expect(inspect()).toMatchObject({owner,obligationCount:1,currentVerification:'needs_revalidation'});
  expect(()=>f.boundary.invoke('completion.inspect',{owner,readGrant:grant},{...peer,auditSessionId:8})).toThrow(/scope/);
  expect(()=>f.boundary.invoke('completion.inspect',{owner:{...owner,ownerId:'else'},readGrant:grant},peer)).toThrow(/scope/);
  expect(()=>f.boundary.invoke('completion.inspect',{owner,readGrant:{...grant,secret:'0'.repeat(64)}},peer)).toThrow(/scope/);
  f.boundary.host.revokeOwnerPrincipal({owner,peer});expect(inspect).toThrow(/scope/);
  const fresh=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  expect(f.boundary.invoke('completion.inspect',{owner,readGrant:fresh},peer)).toMatchObject({owner});
  f.setNow(1999);expect(()=>f.boundary.invoke('completion.inspect',{owner,readGrant:fresh},peer)).toThrow(/scope/);
 }finally{f.close();}
});
it('never upgrades material-shaped, old-epoch or unknown-owner scopes into completion access',()=>{
 const f=fixture();try{
  const grant=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  expect(()=>f.boundary.host.issueReadScope({owner:{...owner,ownerId:'missing'},peer,expiresAt:2000})).toThrow(/owner/);
  f.boundary.close();const restarted=createCompletionBoundary({...f.options,authority:{...f.options.authority,serviceEpoch:'boot2'}});
  try{expect(()=>restarted.invoke('completion.inspect',{owner,readGrant:grant},peer)).toThrow(/scope/);}finally{restarted.close();}
 }finally{f.close();}
});

function ready(f:ReturnType<typeof fixture>,scopeExpiresAt=2000){
 const a=f.boundary.authority,subject=a.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});
 const payload={owner,obligationId:'o',expectedAttemptEpoch:0,sourceRunId:'run',runNonce:'nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
 const attempt=a.service.requestVerification(payload,{requestSource:'agent',authorization:a.host.issueAuthorization({owner,method:'requestVerification',payload,requestSource:'agent',principalId:'fixture',expiresAt:2000})});
 a.host.bindExecution(attempt.attemptId,{sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H});
 a.host.recordControllerResult(attempt.attemptId,{coreId:'core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt as never);
 const s=a.service.inspectOwner(owner)!;
 return {schemaVersion:1 as const,...owner,migrationEpoch:s.migrationEpoch,expectedBusinessRevision:s.businessRevision,obligationSetRevision:s.obligationSetRevision,obligationSetHash:s.obligationSetHash,obligations:a.service.getCurrentDependencies(owner),operationId:'settle',immutablePayloadHash:H,receiverId:'r',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'reservation',nonce:'nonce',notBefore:1000,validUntil:1400,clockDomainId:'clock',clockQualificationEpoch:1};
}
it('settles only an exact one-use scope; failed proof cannot restore the grant and read scopes cannot settle',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),readGrant=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  const issue=(method:'completion.settle'|'completion.authorize'='completion.settle')=>f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method,tuple,requestSource:'agent'});
  const payload={owner,tuple,requestSource:'agent',authorization:readGrant};
  expect(()=>f.boundary.invoke('completion.settle',payload,peer)).toThrow(/scope/);
  db.exec("CREATE TRIGGER reject_settlement BEFORE INSERT ON settlement_decisions BEGIN SELECT RAISE(ABORT,'injected_proof_failure'); END");
  const failed=issue();expect(()=>f.boundary.invoke('completion.settle',{...payload,authorization:failed},peer)).toThrow('injected_proof_failure');
  db.exec('DROP TRIGGER reject_settlement');
  expect(()=>f.boundary.invoke('completion.settle',{...payload,authorization:failed},peer)).toThrow(/scope/);
  expect(db.prepare('SELECT COUNT(*) n FROM publication_journal').get()).toEqual({n:0});
  const valid=issue();expect(()=>f.boundary.invoke('completion.settle',{...payload,requestSource:'user',authorization:valid},peer)).toThrow(/scope/);
  expect(f.boundary.invoke('completion.settle',{...payload,authorization:valid},peer)).toMatchObject({state:'committed',committedBusinessRevision:1});
  const q={owner,tuple,readGrant},challenge=f.boundary.invoke('completion.receiver-challenge',q,peer) as {challenge:string;fullTupleHash:string};
  expect(f.boundary.invoke('completion.receiver-challenge',q,peer)).toEqual(challenge);
  expect(f.boundary.invoke('completion.authorize',{...payload,authorization:issue('completion.authorize')},peer)).toMatchObject({reservation:'commit_authorized'});
  expect(()=>f.boundary.invoke('completion.receiver-reply',{...q,reply:{payload:{},signature:'bad'}},peer)).toThrow();
  const reply=createReceiverReplySigner({keyId:'receiver',receiverId:'r',receiverInstanceEpoch:1,privateKey:f.keys.privateKey}).sign(challenge,{status:'cancelled',fullTupleHash:challenge.fullTupleHash,objectRevision:1,reason:'user_cancelled',terminalRecordHash:H});
  expect(f.boundary.invoke('completion.receiver-reply',{...q,reply},peer)).toMatchObject({accepted:true});
 }finally{db.close();f.close();}
});
it('rechecks live scope at the actual proof commit, while failed publication never restores consumed authorization',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),authorization=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'});
  db.exec("CREATE TRIGGER revoke_at_settlement AFTER INSERT ON settlement_decisions BEGIN UPDATE completion_access_grants SET scope_epoch=999; END");
  expect(()=>f.boundary.invoke('completion.settle',{owner,tuple,requestSource:'agent',authorization},peer)).toThrow(/scope/);
  expect(db.prepare('SELECT COUNT(*) n FROM settlement_decisions').get()).toEqual({n:0});
  expect(db.prepare('SELECT COUNT(*) n FROM publication_journal').get()).toEqual({n:0});
  expect(db.prepare('SELECT state FROM completion_access_grants WHERE id=?').get(authorization.id)).toEqual({state:'consumed'});
 }finally{db.close();f.close();}
});
it('rechecks read scope before committing a signed receiver reply projection',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),readGrant=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  const authorization=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'});
  f.boundary.invoke('completion.settle',{owner,tuple,requestSource:'agent',authorization},peer);
  const query={owner,tuple,readGrant},challenge=f.boundary.invoke('completion.receiver-challenge',query,peer) as {challenge:string;fullTupleHash:string};
  const reply=createReceiverReplySigner({keyId:'receiver',receiverId:'r',receiverInstanceEpoch:1,privateKey:f.keys.privateKey}).sign(challenge,{status:'cancelled',fullTupleHash:challenge.fullTupleHash,objectRevision:1,reason:'user_cancelled',terminalRecordHash:H});
  const before=db.prepare('SELECT state_json,reply_json FROM publication_journal WHERE operation_id=?').get(tuple.operationId);
  db.exec('CREATE TRIGGER revoke_at_reply AFTER UPDATE ON publication_journal BEGIN UPDATE completion_access_grants SET scope_epoch=999; END');
  expect(()=>f.boundary.invoke('completion.receiver-reply',{...query,reply},peer)).toThrow(/scope/);
  expect(db.prepare('SELECT state_json,reply_json FROM publication_journal WHERE operation_id=?').get(tuple.operationId)).toEqual(before);
 }finally{db.close();f.close();}
});
it('retires expired read slots and archives expired mutation audit without restoring old handles',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),old=f.boundary.host.issueReadScope({owner,peer,expiresAt:1200});
  const mutation=f.boundary.host.issueMutation({owner,peer,expiresAt:1200,method:'completion.settle',tuple,requestSource:'agent'});
  f.setNow(1300);
  const fresh=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  expect(db.prepare('SELECT id FROM completion_access_grants WHERE id=?').get(old.id)).toBeUndefined();
  expect(db.prepare('SELECT id FROM completion_access_grants WHERE id=?').get(mutation.id)).toBeUndefined();
  expect(db.prepare('SELECT state FROM completion_access_audit WHERE id=?').get(mutation.id)).toEqual({state:'issued'});
  expect(()=>f.boundary.invoke('completion.inspect',{owner,readGrant:old},peer)).toThrow(/scope/);
  expect(f.boundary.invoke('completion.inspect',{owner,readGrant:fresh},peer)).toMatchObject({owner});
 }finally{db.close();f.close();}
});
it('never authorizes a receiver deadline later than the shortest proof deadline',()=>{
 const f=fixture();try{
  const tuple={...ready(f),validUntil:1600};
  const authorization=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'});
  expect(()=>f.boundary.invoke('completion.settle',{owner,tuple,requestSource:'agent',authorization},peer)).toThrow(/window|deadline/);
 }finally{f.close();}
});
it('preserves actual terminal execution facts after expiry without issuing a new valid proof',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),attemptId=tuple.obligations[0].activeAttemptId;
  f.setNow(1600);
  expect(()=>f.boundary.authority.host.recordControllerResult(attemptId,{coreId:'core',coreFinalRevision:2,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt as never)).not.toThrow();
  expect(db.prepare('SELECT state,proof_json FROM obligation_attempts WHERE attempt_id=?').get(attemptId)).toEqual({state:'terminal',proof_json:null});
  expect(db.prepare('SELECT revision FROM execution_facts_revisions WHERE attempt_id=? ORDER BY revision').all(attemptId)).toEqual([{revision:1},{revision:2}]);
  expect(f.boundary.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
 }finally{db.close();f.close();}
});

it('intersects the actual scope expiry and cannot extend the same scope revision',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const original=ready(f,1200),tuple={...original,validUntil:1199};
  const proof=JSON.parse((db.prepare('SELECT proof_json FROM obligation_attempts WHERE attempt_id=?').get(tuple.obligations[0].activeAttemptId) as {proof_json:string}).proof_json);
  expect(proof.validUntil).toBe(1200);expect(proof.scopeExpiresAt).toBe(1200);
  expect(()=>f.boundary.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]})).toThrow(/scope_revision/);
  const tooLong={...tuple,validUntil:1300},longGrant=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple:tooLong,requestSource:'agent'});
  expect(()=>f.boundary.invoke('completion.settle',{owner,tuple:tooLong,authorization:longGrant,requestSource:'agent'},peer)).toThrow(/window/);
  const authorization=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'});
  expect(f.boundary.invoke('completion.settle',{owner,tuple,authorization,requestSource:'agent'},peer)).toMatchObject({state:'committed'});
  f.setNow(1200);expect(f.boundary.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
 }finally{db.close();f.close();}
});
it('borrows the actual host database for composition and never commits or closes its owner transaction',()=>{
 const f=fixture();f.boundary.close();const database=openPrivateVerificationDatabase(f.root);
 const boundary=createCompletionBoundary({...f.options,database});
 try{
  expect(()=>database.transaction(()=>boundary.invoke('completion.settle',{},peer))()).toThrow(/outer_transaction/);
  const before=database.prepare('SELECT count(*) n FROM completion_access_grants').get();
  expect(()=>database.transaction(()=>{boundary.host.issueReadScope({owner,peer,expiresAt:2000});throw Error('outer rollback');})()).toThrow('outer rollback');
  expect(database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual(before);
  boundary.close();expect(database.prepare('SELECT 1 n').get()).toEqual({n:1});
 }finally{boundary.close();database.close();f.close();}
});

it('rejects a semantically valid grant row which the actual boundary never issued',()=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const granted=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000}),secret='f'.repeat(64),known=db.prepare('SELECT * FROM completion_access_grants WHERE id=?').get(granted.id) as any;
  db.prepare('INSERT INTO completion_access_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('injected',createHash('sha256').update(secret).digest('hex'),known.owner_key,known.principal,known.scope_epoch,known.migration_epoch,known.service_epoch,known.expires_at,known.method,known.payload_hash,known.source,known.state);
  expect(()=>f.boundary.invoke('completion.inspect',{owner,readGrant:{id:'injected',secret}},peer)).toThrow(/scope/);
 }finally{db.close();f.close();}
});
it.each(['issue','consume','revoke'] as const)('rejects a trigger adding a second grant during the original %s writer',mode=>{
 const f=fixture(),db=openPrivateVerificationDatabase(f.root);try{
  const tuple=ready(f),read=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000}),authorization=mode==='consume'?f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'}):undefined;
  const event=mode==='issue'?'AFTER INSERT ON completion_access_grants':mode==='consume'?'AFTER UPDATE OF state ON completion_access_grants':'AFTER INSERT ON completion_scope_epochs';
  db.exec(`CREATE TRIGGER extra_grant ${event} BEGIN INSERT OR IGNORE INTO completion_access_grants SELECT 'injected',secret_hash,owner_key,principal,scope_epoch,migration_epoch,service_epoch,expires_at,method,payload_hash,source,state FROM completion_access_grants WHERE id='${read.id}'; END`);
  const run=()=>mode==='issue'?f.boundary.host.issueReadScope({owner,peer,expiresAt:2000}):mode==='revoke'?f.boundary.host.revokeOwnerPrincipal({owner,peer}):f.boundary.invoke('completion.settle',{owner,tuple,requestSource:'agent',authorization},peer);
  expect(run).toThrow(/completion_scope_write/);expect(db.prepare("SELECT id FROM completion_access_grants WHERE id='injected'").get()).toBeUndefined();
 }finally{db.close();f.close();}
});

it('receiver replies refuse a borrowed outer transaction before reporting acceptance',()=>{
 const root=mkdtempSync(join(tmpdir(),'completion-borrowed-')),db=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519');
 const boundary=createCompletionBoundary({root,database:db,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'r',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'controller',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),assertQualified(){},quiescence:{assertQuiescent(){}}}});
 try{db.exec('BEGIN IMMEDIATE');expect(()=>boundary.invoke('completion.receiver-reply',{},peer)).toThrow('completion_outer_transaction');expect(db.inTransaction).toBe(true);db.exec('ROLLBACK');}finally{if(db.inTransaction)db.exec('ROLLBACK');boundary.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['foreign-peer','wrong-owner','revoked','missing-settlement'] as const)('both receiver handlers reject the original invalid read context: %s',mode=>{
 const f=fixture();try{
  const tuple=ready(f),readGrant=f.boundary.host.issueReadScope({owner,peer,expiresAt:2000});
  if(mode!=='missing-settlement'){const authorization=f.boundary.host.issueMutation({owner,peer,expiresAt:2000,method:'completion.settle',tuple,requestSource:'agent'});f.boundary.invoke('completion.settle',{owner,tuple,requestSource:'agent',authorization},peer);}
  if(mode==='revoked')f.boundary.host.revokeOwnerPrincipal({owner,peer});
  const query={owner:mode==='wrong-owner'?{...owner,ownerId:'foreign'}:owner,tuple,readGrant},actualPeer=mode==='foreign-peer'?{...peer,auditSessionId:8}:peer;
  for(const method of ['completion.receiver-challenge','completion.receiver-reply'] as const)expect(()=>f.boundary.invoke(method,{...query,...(method==='completion.receiver-reply'?{reply:{payload:{},signature:'bad'}}:{})},actualPeer)).toThrow(mode==='wrong-owner'?'completion_tuple_binding':mode==='missing-settlement'?'completion_challenge_missing':/scope/);
 }finally{f.close();}
});
