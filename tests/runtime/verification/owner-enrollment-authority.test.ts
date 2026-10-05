import {it,expect} from 'vitest';
it('namespace: ordinary owner cannot hide pending main migration behind an empty TEMP table',async()=>{
 const f=fixture();try{const prepared=f.authority.prepare(proposal(),peer),result=await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal);f.database.exec('CREATE TABLE main.migration_publication_intents(owner_key TEXT PRIMARY KEY,state TEXT,published INTEGER,marker_json TEXT)');f.database.prepare('INSERT INTO main.migration_publication_intents VALUES(?,?,?,?)').run(json(result.owner),'pending',0,'{}');f.database.exec('CREATE TEMP TABLE migration_publication_intents AS SELECT * FROM main.migration_publication_intents WHERE 0');const before=f.database.prepare('SELECT * FROM main.completion_access_grants ORDER BY id').all();expect(()=>f.authority.openOwner({ownerKind:'task',ownerId:'task'},peer)).toThrow('enrollment_migration_pending');expect(f.database.prepare('SELECT * FROM main.completion_access_grants ORDER BY id').all()).toEqual(before);}finally{f.close();}
});
import {authorizeOwnerEnrollment} from '../../../src/runtime/verification/owner-enrollment-authorization.js';import {createHash,generateKeyPairSync} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createCompletionBoundary} from '../../../src/runtime/verification/completion-boundary.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createOwnerEnrollmentAuthority} from '../../../src/runtime/verification/owner-enrollment-authority.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const peer={uid:501,gid:20,auditSessionId:7},H='a'.repeat(64),sha=(x:unknown)=>createHash('sha256').update(json(x)).digest('hex');
const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};
function proposal(){const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:H,structure:'utf8' as const}]};return {enrollment:{ownerKind:'task' as const,ownerId:'task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:sha(recipe),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}}};}
function fixture(existingRoot?:string){
 const root=existingRoot??mkdtempSync(join(tmpdir(),'enrollment-authority-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755,recursive:true});let now=1000,approvals=0,expireDuringApproval=false;let approvalHook:((review:any)=>Promise<void>)|undefined;
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now+1,evidenceHash:H});
 const completion=createCompletionBoundary({root,database,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified:()=>{},quiescence:{assertQuiescent:()=>{}}}});
 const profilePublication=createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent:()=>{}});
 const options={database,completion,authorityId:'authority',clock,profilePublication,resolvePrincipal:(p:typeof peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),approve:async(review:any)=>{approvals++;await approvalHook?.(review);if(expireDuringApproval)now=review.deadline.validUntil;return {uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:sha(review)};}};
 const authority=createOwnerEnrollmentAuthority(options);
 return {root,database,completion,options,authority,setApprovalHook(hook:typeof approvalHook){approvalHook=hook;},approvals:()=>approvals,advance:()=>{now+=300001;},expire:()=>{expireDuringApproval=true;},close:()=>{authority.close();completion.close();database.close();rmSync(root,{recursive:true,force:true});}};
}
it('consumes a native challenge once and enrolls exact original obligations without minting a pass',async()=>{
 const f=fixture();try{
  const prepared=f.authority.prepare(proposal(),peer),signal=new AbortController().signal;
  await expect(f.authority.authorize(prepared.challengeId,{...peer,auditSessionId:8},signal)).rejects.toThrow(/principal/);expect(f.approvals()).toBe(0);
  const result=await f.authority.authorize(prepared.challengeId,peer,signal);
  expect(f.completion.invoke('completion.inspect',{owner:result.owner,readGrant:result.readGrant},peer)).toMatchObject({currentVerification:'needs_revalidation',obligationCount:1});
  expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(result.owner));
  await expect(f.authority.authorize(prepared.challengeId,peer,signal)).rejects.toThrow(/consumed/);expect(f.approvals()).toBe(1);
 }finally{f.close();}
});
it('does not restore authorization after UI expiry or permit caller outer rollback',async()=>{
 const f=fixture();try{
  const prepared=f.authority.prepare(proposal(),peer),signal=new AbortController().signal;let pending!:Promise<unknown>;
  f.database.transaction(()=>{pending=f.authority.authorize(prepared.challengeId,peer,signal);})();await expect(pending).rejects.toThrow(/outer_transaction/);expect(f.approvals()).toBe(0);
  f.expire();await expect(f.authority.authorize(prepared.challengeId,peer,signal)).rejects.toThrow(/deadline/);expect(f.approvals()).toBe(1);
  expect(f.database.prepare('SELECT count(*) n FROM verification_owners').get()).toEqual({n:0});
 }finally{f.close();}
});
it('pins the original registration across partial profile success and refuses a weaker replacement on recovery',async()=>{
 const f=fixture();try{
  const prepared=f.authority.prepare(proposal(),peer),signal=new AbortController().signal;
  f.database.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON mandatory_observation_checks BEGIN SELECT RAISE(ABORT,'registration_disk_failure'); END");
  await expect(f.authority.authorize(prepared.challengeId,peer,signal)).rejects.toThrow('registration_disk_failure');
  expect(f.database.prepare('SELECT state FROM verification_profiles').get()).toEqual({state:'pending'});expect(f.database.prepare('SELECT count(*) n FROM verification_owners').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT committed FROM owner_enrollment_intents').get()).toEqual({committed:0});
  const weaker=proposal();weaker.registration.obligations[0].recipe.checks[0].sha256='b'.repeat(64);weaker.registration.obligations[0].obligation.definitionHash=sha(weaker.registration.obligations[0].recipe);
  const extended=proposal(),extra=structuredClone(extended.registration.obligations[0]);extra.obligation.obligationId='extra';extended.registration.obligations.push(extra);expect(()=>f.authority.prepare(extended,peer)).toThrow(/immutable/);
  expect(()=>f.authority.prepare(weaker,peer)).toThrow(/immutable/);expect(f.approvals()).toBe(1);
  f.database.exec('DROP TRIGGER fail_registration');const fresh=f.authority.prepare(proposal(),peer),result=await f.authority.authorize(fresh.challengeId,peer,signal);expect(f.completion.authority.service.inspectOwner(result.owner)?.obligationCount).toBe(1);
  expect(f.database.prepare('SELECT committed FROM owner_enrollment_intents').get()).toEqual({committed:1});
  expect(f.authority.readApprovedRecipe(result.owner,'original')).toEqual(proposal().registration.obligations[0].recipe);
 }finally{f.close();}
});

it('retires expired challenge bodies without making old identifiers reusable',()=>{
 const f=fixture();try{
  for(let round=0;round<5;round++){for(let i=0;i<64;i++)f.authority.prepare(proposal(),peer);f.advance();}
  f.authority.prepare(proposal(),peer);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:1});
 }finally{f.close();}
});
it('rejects an old native reply after another lifetime retires its in-flight challenge',async()=>{
 const f=fixture();let release!:(reply:any)=>void,review:any;
 const old=createOwnerEnrollmentAuthority({...f.options,approve:r=>{review=r;return new Promise(resolve=>{release=resolve;});}});
 const next=createOwnerEnrollmentAuthority(f.options);
 try{
  const prepared=old.prepare(proposal(),peer),pending=old.authorize(prepared.challengeId,peer,new AbortController().signal);
  next.prepare(proposal(),peer);
  release({uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:sha(review)});
  await expect(pending).rejects.toThrow(/challenge/);
  expect(f.database.prepare('SELECT count(*) n FROM verification_owners').get()).toEqual({n:0});
 }finally{old.close();next.close();f.close();}
});

it('binds Unicode enrollment to the exact ASCII bytes reviewed by the native broker',async()=>{
 const f=fixture();const authority=createOwnerEnrollmentAuthority({...f.options,approve:review=>authorizeOwnerEnrollment(review,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock:f.options.clock,resolveAccount:async()=>f.options.resolvePrincipal(peer).accountGeneration,approve:async({reviewBytes})=>createHash('sha256').update(reviewBytes).digest('hex')})});
 try{const draft=proposal();draft.enrollment.ownerId='中文任务';const prepared=authority.prepare(draft,peer);const result=await authority.authorize(prepared.challengeId,peer,new AbortController().signal);expect(result.owner.ownerId).toBe('中文任务');}
 finally{authority.close();f.close();}
});
it('refreshes only read access for the current enrolled owner and denies pending migration or absent obligations',async()=>{
 const f=fixture();try{
  const prepared=f.authority.prepare(proposal(),peer),original=await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal),fresh=f.authority.openOwner({ownerKind:'task',ownerId:'task'},{...peer,auditSessionId:8});
  expect(fresh.owner).toEqual(original.owner);expect(fresh.readGrant.id).not.toBe(original.readGrant.id);
  expect(()=>f.completion.invoke('completion.inspect',fresh,peer)).toThrow(/scope/);
  expect(f.completion.invoke('completion.inspect',fresh,{...peer,auditSessionId:8})).toMatchObject({obligationCount:1,currentVerification:'needs_revalidation'});
  expect(()=>f.authority.openOwner({ownerKind:'task',ownerId:'missing'},peer)).toThrow();
  f.database.exec('CREATE TABLE migration_publication_intents(owner_key TEXT PRIMARY KEY,state TEXT,published INTEGER,marker_json TEXT)');
  f.database.prepare('INSERT INTO migration_publication_intents VALUES(?,?,?,?)').run(json(original.owner),'pending',1,'{}');
  expect(()=>f.authority.openOwner({ownerKind:'task',ownerId:'task'},peer)).toThrow(/migration/);
 }finally{f.close();}
});

it.each(['append','rollback','competing','edit','remove','reorder'] as const)('extends a committed native registration without replacing original obligations: %s',async mode=>{
 const f=fixture(),signal=new AbortController().signal;
 const extend=(base:ReturnType<typeof proposal>,name:string)=>{const result=structuredClone(base),entry=structuredClone(result.registration.obligations[0]);entry.obligation.obligationId=name;entry.obligation.predicateId=name;result.registration.obligations.push(entry);return result;};
 try{
  const initial=proposal(),review=f.authority.prepare(initial,peer),{owner}=await f.authority.authorize(review.challengeId,peer,signal),expanded=extend(initial,'diagnostic');
  if(mode==='edit'){expanded.registration.obligations[0].obligation.predicateVersion='2';expect(()=>f.authority.prepare(expanded,peer)).toThrow('immutable');return;}
  const next=f.authority.prepare(expanded,peer);
  if(mode==='rollback')f.database.exec("CREATE TRIGGER append_failure BEFORE INSERT ON mandatory_observation_checks WHEN NEW.obligation_id='diagnostic' BEGIN SELECT RAISE(ABORT,'append disk failure'); END");
  if(mode==='competing'){const other=f.authority.prepare(extend(initial,'other'),peer);await f.authority.authorize(other.challengeId,peer,signal);await expect(f.authority.authorize(next.challengeId,peer,signal)).rejects.toThrow('immutable');expect(f.completion.authority.service.inspectOwner(owner)?.obligationCount).toBe(2);expect(f.authority.readApprovedRecipe(owner,'other')).toEqual(initial.registration.obligations[0].recipe);return;}
  if(mode==='rollback'){await expect(f.authority.authorize(next.challengeId,peer,signal)).rejects.toThrow('append disk failure');expect(f.database.prepare('SELECT registration_json,committed FROM owner_enrollment_intents').get()).toEqual({registration_json:json(initial.registration),committed:1});expect(f.completion.authority.service.inspectOwner(owner)?.obligationCount).toBe(1);return;}
  const result=await f.authority.authorize(next.challengeId,peer,signal);expect(result.owner).toEqual(owner);expect(f.completion.authority.service.inspectOwner(owner)).toMatchObject({obligationCount:2,currentVerification:'needs_revalidation'});expect(f.authority.readApprovedRecipe(owner,'original')).toEqual(initial.registration.obligations[0].recipe);expect(f.authority.readApprovedRecipe(owner,'diagnostic')).toEqual(expanded.registration.obligations[1].recipe);
  if(mode==='remove')expect(()=>f.authority.prepare(initial,peer)).toThrow('immutable');
  if(mode==='reorder'){expanded.registration.obligations.reverse();expect(()=>f.authority.prepare(expanded,peer)).toThrow('immutable');}
 }finally{f.close();}
});

it('rejects an append whose original prefix changed while its native approval was awaiting',async()=>{
 const f=fixture(),signal=new AbortController().signal;let release!:()=>void;
 try{
  const initial=proposal(),first=f.authority.prepare(initial,peer);await f.authority.authorize(first.challengeId,peer,signal);
  const extend=(name:string)=>{const value=structuredClone(initial),entry=structuredClone(value.registration.obligations[0]);entry.obligation.obligationId=name;value.registration.obligations.push(entry);return value;};
  const slow=f.authority.prepare(extend('slow'),peer),fast=f.authority.prepare(extend('fast'),peer);
  f.setApprovalHook(async review=>{if(review.challengeId===slow.challengeId)await new Promise<void>(resolve=>{release=resolve;});});
  const awaiting=f.authority.authorize(slow.challengeId,peer,signal);await f.authority.authorize(fast.challengeId,peer,signal);release();
  await expect(awaiting).rejects.toThrow('immutable');
  const intent=f.database.prepare('SELECT registration_json,committed FROM owner_enrollment_intents').get() as any;
  expect(intent).toEqual({registration_json:json(extend('fast').registration),committed:1});
  expect(f.database.prepare('SELECT obligation_id FROM mandatory_observation_checks ORDER BY obligation_id').all()).toEqual([{obligation_id:'fast'},{obligation_id:'original'}]);
 }finally{release?.();f.close();}
});
it('exposes only actual current-boot live registration reviews without replaying GUI or treating expired rows as future approvals',()=>{const f=fixture();let next:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;try{const p=f.authority.prepare(proposal(),peer);expect(f.authority.getLiveSourceRegistrationReviews()).toEqual([p.canonicalReview]);expect(f.approvals()).toBe(0);next=createOwnerEnrollmentAuthority(f.options);expect(next.getLiveSourceRegistrationReviews()).toEqual([]);f.advance();expect(f.authority.getLiveSourceRegistrationReviews()).toEqual([]);expect(f.database.prepare('SELECT COUNT(*) n FROM owner_enrollment_challenges').get()).toEqual({n:1});}finally{next?.close();f.close();}});

it('binds a Goal application only to the actual committed registration and registered session', async () => {
 const f=fixture();try{
  const p=proposal(),goalProposal={...p,enrollment:{...p.enrollment,ownerKind:'goal' as const,ownerId:'goal'}};
  const prepared=f.authority.prepare(goalProposal,peer);
  await expect(f.authority.authorize(prepared.challengeId,peer,new AbortController().signal)).resolves.toHaveProperty('owner');
  const owner=f.authority.openOwner({ownerKind:'goal',ownerId:'goal'},peer).owner;
  const actual=f.authority.readApplicationRegistration(owner,peer,'s');
  expect(actual).toEqual({owner,registrationHash:createHash('sha256').update('xiaok-goal-original-registration-v1\0').update(json(goalProposal.registration)).digest('hex')});
  expect(()=>f.authority.readApplicationRegistration(owner,peer,'unregistered-session')).toThrow(/session/);
  expect(()=>f.authority.readApplicationRegistration(owner,{...peer,uid:502},'s')).toThrow();
  expect(()=>f.authority.readApplicationRegistration({...owner,profileId:'different'},peer,'s')).toThrow();
  f.database.prepare('UPDATE owner_enrollment_intents SET committed=0').run();
  expect(()=>f.authority.readApplicationRegistration(owner,peer,'s')).toThrow(/unapproved|uncommitted/);
 }finally{f.close();}
});

it.each(['application','invocation','capacity','activation'] as const)('never splices newly activated S2 with old R1 after failed R2 append: %s', async consumer => {
 const f=fixture();let reopened:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;const signal=new AbortController().signal;
 try {
  const base=proposal(),initial={...base,enrollment:{...base.enrollment,ownerKind:'goal' as const,ownerId:'goal'}};
  const prepared=f.authority.prepare(initial,peer),{owner}=await f.authority.authorize(prepared.challengeId,peer,signal);
  const expanded=structuredClone(initial),extra=structuredClone(expanded.registration.obligations[0]);extra.obligation.obligationId='extra';expanded.registration.obligations.push(extra);
  const second={sessionIdentity:'s2',compoundOperationId:'o2',validationInvocationId:'v2'};expanded.enrollment.invocations=[second];
  const next=f.authority.prepare(expanded,peer);
  f.database.exec("CREATE TRIGGER fail_new_session_registration BEFORE INSERT ON mandatory_observation_checks WHEN NEW.obligation_id='extra' BEGIN SELECT RAISE(ABORT,'append disk failure'); END");
  await expect(f.authority.authorize(next.challengeId,peer,signal)).rejects.toThrow('append disk failure');
  if(consumer==='application')expect(()=>f.authority.readApplicationRegistration(owner,peer,'s2')).toThrow();
  if(consumer==='invocation')expect(()=>f.authority.resolveOwnerKey(peer,second)).toThrow();
  if(consumer==='capacity')expect(()=>f.authority.createCapacityOwnerBinding(peer,second)).toThrow();
  if(consumer==='activation')expect(f.database.prepare('SELECT state FROM verification_registered_invocations WHERE invocation_json=?').get(json(second))).toEqual({state:'pending'});
  expect(f.authority.readApplicationRegistration(owner,peer,'s').registrationHash).toBe(createHash('sha256').update('xiaok-goal-original-registration-v1\0').update(json(initial.registration)).digest('hex'));
  f.authority.close();reopened=createOwnerEnrollmentAuthority(f.options);
  expect(()=>reopened!.readApplicationRegistration(owner,peer,'s2')).toThrow();expect(()=>reopened!.resolveOwnerKey(peer,second)).toThrow();
  f.database.exec('DROP TRIGGER fail_new_session_registration');
  const retry=reopened.prepare(expanded,peer);await reopened.authorize(retry.challengeId,peer,signal);
  expect(reopened.resolveOwnerKey(peer,second)).toBe(json(owner));
  expect(reopened.readApplicationRegistration(owner,peer,'s2').registrationHash).toBe(createHash('sha256').update('xiaok-goal-original-registration-v1\0').update(json(expanded.registration)).digest('hex'));
  expect(reopened.readApplicationRegistration(owner,peer,'s').registrationHash).toBe(reopened.readApplicationRegistration(owner,peer,'s2').registrationHash);
 }finally{reopened?.close();f.close();}
});

it('rolls back registration, invocation receipt and read scope when activation fails after the private commit callback',async()=>{
 const f=fixture(),signal=new AbortController().signal;
 try{
  const initial=proposal(),first=f.authority.prepare(initial,peer),{owner}=await f.authority.authorize(first.challengeId,peer,signal);
  const beforeGrants=f.database.prepare('SELECT count(*) n FROM completion_access_grants').get();
  const expanded=structuredClone(initial),extra=structuredClone(initial.registration.obligations[0]);extra.obligation.obligationId='extra';expanded.registration.obligations.push(extra);
  const second={sessionIdentity:'s2',compoundOperationId:'o2',validationInvocationId:'v2'};expanded.enrollment.invocations=[second];
  f.database.exec("CREATE TRIGGER fail_final_activation BEFORE UPDATE ON verification_registered_invocations WHEN NEW.invocation_json LIKE '%s2%' AND NEW.state='active' BEGIN SELECT RAISE(ABORT,'activation disk failure'); END");
  const next=f.authority.prepare(expanded,peer);await expect(f.authority.authorize(next.challengeId,peer,signal)).rejects.toThrow('activation disk failure');
  expect(f.database.prepare('SELECT registration_json,committed FROM owner_enrollment_intents').get()).toEqual({registration_json:json(initial.registration),committed:1});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:1});
  expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual(beforeGrants);
  expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(owner));expect(()=>f.authority.resolveOwnerKey(peer,second)).toThrow();
  await expect(f.authority.authorize(next.challengeId,peer,signal)).rejects.toThrow(/consumed/);
  f.database.exec('DROP TRIGGER fail_final_activation');const retry=f.authority.prepare(expanded,peer);await f.authority.authorize(retry.challengeId,peer,signal);
  expect(f.authority.resolveOwnerKey(peer,second)).toBe(json(owner));
 }finally{f.close();}
});
it('never infers a committed source receipt from legacy active rows; exact explicit native re-enrollment restores it',async()=>{
 const f=fixture(),signal=new AbortController().signal;let next:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;
 try{
  const base=proposal(),p={...base,enrollment:{...base.enrollment,ownerKind:'goal' as const,ownerId:'goal'}};
  const c=f.authority.prepare(p,peer),{owner}=await f.authority.authorize(c.challengeId,peer,signal);
  f.database.prepare('DELETE FROM owner_enrollment_invocation_receipts').run();f.authority.close();next=createOwnerEnrollmentAuthority(f.options);
  expect(()=>next!.readApplicationRegistration(owner,peer,'s')).toThrow(/uncommitted/);expect(()=>next!.resolveOwnerKey(peer,invocation)).toThrow(/uncommitted/);
  expect(()=>next!.createCapacityOwnerBinding(peer,invocation)).toThrow(/uncommitted/);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
  const retry=next.prepare(p,peer);await next.authorize(retry.challengeId,peer,signal);
  expect(next.readApplicationRegistration(owner,peer,'s').owner).toEqual(owner);expect(next.resolveOwnerKey(peer,invocation)).toBe(json(owner));
 }finally{next?.close();f.close();}
});

it('request prepare reply loss finds the original challenge and recovery seals the legacy authorize sibling',async()=>{
 const f=fixture();try{
  const request={requestId:'request-one',...proposal()},first=f.authority.prepareRequest(request,peer);
  expect(first.created).toBe(true);expect(f.authority.prepareRequest(request,peer)).toEqual({...first,created:false});
  expect(f.authority.lookupRequest(request,peer)).toMatchObject({state:'mapped',challenge:first.challenge});
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'not_approved',challenge:first.challenge});
  await expect(f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow(/consumed/);
  expect(f.approvals()).toBe(0);expect(()=>f.authority.prepareRequest(request,peer)).toThrow(/retired/);
 }finally{f.close();}
});
it('request tombstone wins before prepare and rejects changed full tuple or principal',()=>{
 const f=fixture();try{
  const request={requestId:'never-sent',...proposal()};expect(f.authority.lookupRequest(request,peer)).toEqual({state:'absent'});
  expect(f.authority.recoverRequest(request,peer)).toEqual({state:'not_prepared'});
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow(/retired/);
  expect(()=>f.authority.lookupRequest({...request,enrollment:{...request.enrollment,ownerId:'other'}},peer)).toThrow(/binding/);
  expect(()=>f.authority.lookupRequest(request,{...peer,auditSessionId:8})).toThrow(/binding/);
  expect(f.approvals()).toBe(0);
 }finally{f.close();}
});
it('recover while real native approval is awaiting prevents its late FINAL commit and permits a new explicit request',async()=>{
 const f=fixture();let release!:()=>void;f.setApprovalHook(()=>new Promise<void>(resolve=>{release=resolve;}));
 try{
  const request={requestId:'awaiting',...proposal()},first=f.authority.prepareRequest(request,peer);
  const pending=f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal);void pending.catch(()=>{});
  expect(f.authority.recoverRequest(request,peer).state).toBe('not_approved');release();await expect(pending).rejects.toThrow(/consumed/);
  expect(f.database.prepare('SELECT count(*) n FROM verification_registered_invocations').get()).toEqual({n:0});
  f.setApprovalHook(undefined);const next=f.authority.prepareRequest({...request,requestId:'explicit-retry'},peer);
  const result=await f.authority.authorize(next.challenge.challengeId,peer,new AbortController().signal);
  expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(result.owner));expect(f.approvals()).toBe(2);
 }finally{release?.();f.close();}
});
it('committed request recovery survives authority restart, expired original deadline and append-only registration',async()=>{
 const f=fixture();let next:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;try{
  const request={requestId:'committed',...proposal()},first=f.authority.prepareRequest(request,peer);
  const result=await f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal);
  const extended=proposal(),extra=structuredClone(extended.registration.obligations[0]);extra.obligation.obligationId='appended';extended.registration.obligations.push(extra);
  const second=f.authority.prepare(extended,peer);await f.authority.authorize(second.challengeId,peer,new AbortController().signal);
  f.advance();f.authority.close();next=createOwnerEnrollmentAuthority(f.options);
  expect(next.recoverRequest(request,peer)).toMatchObject({state:'committed',owner:result.owner,challenge:first.challenge});
  expect(f.database.prepare('SELECT id FROM owner_enrollment_challenges WHERE id=?').get(first.challenge.challengeId)).toBeTruthy();
  expect(f.approvals()).toBe(2);
 }finally{next?.close();f.close();}
});
it('FINAL activation failure cannot retain request committed or an invocation receipt',async()=>{
 const f=fixture();try{
  const request={requestId:'final-fault',...proposal()},first=f.authority.prepareRequest(request,peer);
  f.database.exec("CREATE TRIGGER fail_request_final BEFORE UPDATE OF state ON verification_profiles WHEN NEW.state='active' BEGIN SELECT RAISE(ABORT,'final_activation_fault'); END");
  await expect(f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow('final_activation_fault');
  expect(f.authority.recoverRequest(request,peer).state).toBe('not_approved');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
  f.database.exec('DROP TRIGGER fail_request_final');const retry=f.authority.prepareRequest({...request,requestId:'final-retry'},peer);
  await f.authority.authorize(retry.challenge.challengeId,peer,new AbortController().signal);
 }finally{f.close();}
});
it('request persistence failure rolls back its challenge and every request API rejects outer transactions',()=>{
 const f=fixture();try{
  const request={requestId:'disk-fault',...proposal()};
  f.database.exec("CREATE TRIGGER fail_request BEFORE INSERT ON owner_enrollment_requests BEGIN SELECT RAISE(ABORT,'request_disk_fault'); END");
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow('request_disk_fault');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_requests').get()).toEqual({n:0});
  f.database.exec('DROP TRIGGER fail_request');
  for(const method of ['prepareRequest','lookupRequest','recoverRequest'] as const){expect(()=>f.database.transaction(()=>f.authority[method](request,peer))()).toThrow(/outer_transaction/);}
  expect(()=>f.authority.prepareRequest({...request,registration:{...request.registration,obligations:[]}},peer)).toThrow();
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_requests').get()).toEqual({n:0});
 }finally{f.close();}
});
it('legacy and mapped requests share active capacity without half mappings',()=>{
 const f=fixture();try{
  for(let i=0;i<63;i++)f.authority.prepare(proposal(),peer);
  f.authority.prepareRequest({requestId:'last-active',...proposal()},peer);
  expect(()=>f.authority.prepareRequest({requestId:'too-many',...proposal()},peer)).toThrow(/capacity/);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_requests').get()).toEqual({n:1});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:64});
 }finally{f.close();}
});
it('durable tombstones share the total capacity with mapped and legacy challenges',()=>{
 const f=fixture();try{
  const request={requestId:'tombstone',...proposal()};f.authority.recoverRequest(request,peer);
  const row=f.database.prepare('SELECT * FROM owner_enrollment_requests').get() as any;
  f.database.transaction(()=>{for(let i=0;i<4094;i++)f.database.prepare('INSERT INTO owner_enrollment_requests VALUES(?,?,?,?,?,?,?)').run('seeded-tombstone-'+i,row.principal_json,row.proposal_json,row.request_hash,null,'not_prepared',null);})();
  const last={...request,requestId:'last-mapped'};f.authority.prepareRequest(last,peer);
  expect(()=>f.authority.prepare(proposal(),peer)).toThrow(/capacity/);
  expect(()=>f.authority.recoverRequest({...request,requestId:'over-limit'},peer)).toThrow(/capacity/);
  expect(f.authority.recoverRequest(last,peer).state).toBe('not_approved');
  expect(f.authority.lookupRequest(request,peer)).toEqual({state:'not_prepared'});
 }finally{f.close();}
});
it('account and every original invocation and recipe byte stay bound during request recovery',()=>{
 const f=fixture();let next:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;try{
  const request={requestId:'bound',...proposal()};f.authority.prepareRequest(request,peer);
  const changed=structuredClone(request);changed.enrollment.invocations[0].validationInvocationId='different';
  expect(()=>f.authority.recoverRequest(changed,peer)).toThrow(/binding/);
  const recipe=structuredClone(request);recipe.registration.obligations[0].recipe.checks[0].sha256='b'.repeat(64);recipe.registration.obligations[0].obligation.definitionHash=sha(recipe.registration.obligations[0].recipe);
  expect(()=>f.authority.recoverRequest(recipe,peer)).toThrow(/binding/);
  next=createOwnerEnrollmentAuthority({...f.options,resolvePrincipal:p=>({...p,accountGeneration:'22222222-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const})});
  expect(()=>next!.lookupRequest(request,peer)).toThrow(/binding/);
  expect(f.authority.lookupRequest(request,peer).state).toBe('mapped');
 }finally{next?.close();f.close();}
});
it('actual database close and reopen retains committed history and absent/prepared recovery tombstones',async()=>{
 const f=fixture();let closed=false,next:ReturnType<typeof fixture>|undefined;
 try{
  const committed={requestId:'disk-committed',...proposal()},first=f.authority.prepareRequest(committed,peer);
  const result=await f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal);
  const absent={...committed,requestId:'disk-absent'},retired={...committed,requestId:'disk-retired'};
  f.authority.recoverRequest(absent,peer);f.authority.prepareRequest(retired,peer);f.authority.recoverRequest(retired,peer);
  f.authority.close();f.completion.close();f.database.close();closed=true;
  next=fixture(f.root);
  expect(next.authority.recoverRequest(committed,peer)).toMatchObject({state:'committed',owner:result.owner});
  expect(next.authority.lookupRequest(absent,peer)).toEqual({state:'not_prepared'});
  expect(next.authority.lookupRequest(retired,peer).state).toBe('not_approved');expect(next.approvals()).toBe(0);
 }finally{if(next)next.close();else if(!closed)f.close();else rmSync(f.root,{recursive:true,force:true});}
});
it('same authority recovery reentry during profile publication fences FINAL rather than enabling activation',async()=>{
 const f=fixture();let authority:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;try{
  const request={requestId:'profile-reentry',...proposal()},publish=f.options.profilePublication.publish;
  authority=createOwnerEnrollmentAuthority({...f.options,profilePublication:{...f.options.profilePublication,publish(index){publish(index);expect(authority!.recoverRequest(request,peer).state).toBe('not_approved');}}});
  const first=authority.prepareRequest(request,peer);
  await expect(authority.authorize(first.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow(/consumed/);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
  expect(authority.lookupRequest(request,peer).state).toBe('not_approved');
 }finally{authority?.close();f.close();}
});
it('actual SQLite FULL during request preparation leaves neither mapping nor challenge',()=>{
 const f=fixture();try{
  const request={requestId:'physical-full',...proposal()},recipe=request.registration.obligations[0].recipe;
  recipe.checks=Array.from({length:12},(_,i)=>({id:'check-'+i,path:'directory'+i+'/'+'x'.repeat(2000),sha256:H,structure:'utf8' as const}));
  request.registration.obligations[0].obligation.definitionHash=sha(recipe);request.registration.obligations[0].obligation.requiredCheckIds=recipe.checks.map(c=>c.id);
  f.database.pragma('max_page_count='+f.database.pragma('page_count',{simple:true}));
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow(/capacity/);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_requests').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
 }finally{f.close();}
});
it('a failure in the original final post-activation check rolls request committed back with activation',async()=>{
 const f=fixture();let authority:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;try{
  authority=createOwnerEnrollmentAuthority({...f.options,resolvePrincipal(p){
   if(f.database.inTransaction&&f.database.prepare("SELECT 1 FROM owner_enrollment_requests WHERE state='committed'").get()
    &&f.database.prepare("SELECT 1 FROM verification_profiles WHERE state='active'").get())throw Error('final_postcheck_failed');
   return f.options.resolvePrincipal(p);
  }});
  const request={requestId:'postcheck',...proposal()},first=authority.prepareRequest(request,peer);
  await expect(authority.authorize(first.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow('final_postcheck_failed');
  expect(authority.recoverRequest(request,peer).state).toBe('not_approved');
  expect(f.database.prepare("SELECT count(*) n FROM verification_registered_invocations WHERE state='active'").get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
 }finally{authority?.close();f.close();}
});

function goalSessionProposal(){return {...proposal(),enrollment:{ownerKind:'goal' as const,ownerId:'goal',goalSessionId:'thread',invocations:[]}};}
it('commits only the explicitly approved Goal session and leaves all execution invocation routes unavailable',async()=>{
 const f=fixture(),signal=new AbortController().signal;try{
  const request={requestId:'goal-session-request',...goalSessionProposal()};
  const prepared=f.authority.prepareRequest(request,peer);
  const result=await f.authority.authorize(prepared.challenge.challengeId,peer,signal);
  expect(f.authority.readApplicationRegistration(result.owner,peer,'thread').owner).toEqual(result.owner);
  expect(()=>f.authority.readApplicationRegistration(result.owner,peer,'runtime')).toThrow(/session/);
  expect(()=>f.authority.resolveOwnerKey(peer,{...invocation,sessionIdentity:'thread'})).toThrow(/invocation/);
  expect(()=>f.authority.createCapacityOwnerBinding(peer,{...invocation,sessionIdentity:'thread'})).toThrow(/invocation/);
  expect(f.database.prepare('SELECT count(*) n FROM verification_registered_invocations').get()).toEqual({n:0});
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner:result.owner});
  expect(()=>f.authority.prepare({...goalSessionProposal(),enrollment:{...goalSessionProposal().enrollment,goalSessionId:'other'}},peer)).toThrow(/session/);
  const real={...goalSessionProposal(),enrollment:{ownerKind:'goal' as const,ownerId:'goal',invocations:[{...invocation,sessionIdentity:'actual-runtime'}]}};
  const next=f.authority.prepare(real,peer);await f.authority.authorize(next.challengeId,peer,signal);
  expect(f.authority.resolveOwnerKey(peer,real.enrollment.invocations[0])).toBe(json(result.owner));
  expect(f.authority.readApplicationRegistration(result.owner,peer,'thread').owner).toEqual(result.owner);
  expect(()=>f.authority.readApplicationRegistration(result.owner,peer,'actual-runtime')).toThrow(/session/);
 }finally{f.close();}
});
it('atomically rolls back the Goal session receipt and request commit if FINAL owner activation fails',async()=>{
 const f=fixture(),signal=new AbortController().signal;try{
  const request={requestId:'session-rollback',...goalSessionProposal()},first=f.authority.prepareRequest(request,peer);
  f.database.exec("CREATE TRIGGER fail_goal_session_final BEFORE UPDATE ON verification_registered_owners WHEN NEW.state='active' BEGIN SELECT RAISE(ABORT,'activation_failure'); END");
  await expect(f.authority.authorize(first.challenge.challengeId,peer,signal)).rejects.toThrow('activation_failure');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_goal_sessions').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM mandatory_observation_checks').get()).toEqual({n:0});
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'not_approved'});
  f.database.exec('DROP TRIGGER fail_goal_session_final');
  const retry={...request,requestId:'session-retry'},second=f.authority.prepareRequest(retry,peer);
  await f.authority.authorize(second.challenge.challengeId,peer,signal);expect(f.authority.recoverRequest(retry,peer).state).toBe('committed');
 }finally{f.close();}
});
it('recovers historical Goal session enrollment after append-only obligations and detects a missing FINAL session receipt',async()=>{
 const f=fixture(),signal=new AbortController().signal;try{
  const request={requestId:'session-history',...goalSessionProposal()},first=f.authority.prepareRequest(request,peer);
  const {owner}=await f.authority.authorize(first.challenge.challengeId,peer,signal);
  const next={...goalSessionProposal(),enrollment:{ownerKind:'goal' as const,ownerId:'goal',invocations:[invocation]}};
  next.registration.obligations.push({...structuredClone(next.registration.obligations[0]),obligation:{...next.registration.obligations[0].obligation,obligationId:'added'}});
  const second=f.authority.prepare(next,peer);await f.authority.authorize(second.challengeId,peer,signal);
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner});
  expect(f.authority.readApplicationRegistration(owner,peer,'thread').owner).toEqual(owner);
  f.database.exec('DELETE FROM owner_enrollment_goal_sessions');
  expect(()=>f.authority.recoverRequest(request,peer)).toThrow(/receipt/);
 }finally{f.close();}
});
it('uses the original native review bytes for a Goal session with no execution authorization',async()=>{
 const f=fixture();let nativeBody:any;const authority=createOwnerEnrollmentAuthority({...f.options,approve:review=>authorizeOwnerEnrollment(review,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock:f.options.clock,resolveAccount:async()=>f.options.resolvePrincipal(peer).accountGeneration,approve:async({reviewBytes})=>{nativeBody=JSON.parse(reviewBytes.toString());return createHash('sha256').update(reviewBytes).digest('hex');}})});
 try{const input=goalSessionProposal();input.enrollment.goalSessionId='真实会话';const p=authority.prepare(input,peer);const result=await authority.authorize(p.challengeId,peer,new AbortController().signal);expect(nativeBody.enrollment).toEqual(input.enrollment);expect(authority.readApplicationRegistration(result.owner,peer,'真实会话').owner).toEqual(result.owner);}finally{authority.close();f.close();}
});

it('does not issue material authorization from a session-only Goal enrollment',async()=>{
 const {createMaterialAuthority}=await import('../../../src/runtime/verification/material-authority.js');
 const f=fixture(),signal=new AbortController().signal;let nativeMaterialApprovals=0;try{
  const p=f.authority.prepare(goalSessionProposal(),peer);await f.authority.authorize(p.challengeId,peer,signal);
  const material=createMaterialAuthority({database:f.database,engineBinding:{engineId:'engine',incarnation:'boot'},clock:f.options.clock,wallNow:()=>1000,resolveOwnerKey:f.authority.resolveOwnerKey,
   async inspectFile(){return {sha256:H,size:1,executable:false};},async approve(){nativeMaterialApprovals++;throw Error('unexpected_material_native');},async stage(){throw Error('unexpected_stage');},acceptPlan(){throw Error('unexpected_accept');},discardPlan(){throw Error('unexpected_discard');}});
  await expect(material.prepare({purpose:'isolated-command',invocation:{...invocation,sessionIdentity:'thread'},materials:[{path:'/workspace/original.txt',byteLimit:1}],exactCommand:{argv:['/bin/cat','original.txt'],cwdRelative:'.'},expiresAt:10000},peer,signal)).rejects.toThrow(/invocation/);
  expect(nativeMaterialApprovals).toBe(0);expect(f.database.prepare('SELECT count(*) n FROM material_authority_challenges').get()).toEqual({n:0});
 }finally{f.close();}
});
it('retains explicit Goal session receipts across actual SQLite close and reopen without replaying native',async()=>{
 const f=fixture();let closed=false,next:ReturnType<typeof fixture>|undefined;try{
  const request={requestId:'session-disk',...goalSessionProposal()},first=f.authority.prepareRequest(request,peer);const {owner}=await f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal);
  f.authority.close();f.completion.close();f.database.close();closed=true;next=fixture(f.root);
  expect(next.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner});
  expect(next.authority.readApplicationRegistration(owner,peer,'thread').owner).toEqual(owner);expect(next.approvals()).toBe(0);
  expect(()=>next!.authority.resolveOwnerKey(peer,{...invocation,sessionIdentity:'thread'})).toThrow(/invocation/);
 }finally{if(next)next.close();else if(!closed)f.close();else rmSync(f.root,{recursive:true,force:true});}
});

async function loopProposal(stage: null|{stageId:string;stageKind:'scan'|'execute'|'verify'}=null){
 const {loopHostSubjectOwner}=await import('../../../src/runtime/verification/loop-host-subject.js');
 const loopSubject={kind:'loop-run' as const,loopId:'loop',runId:'run',stage};
 return {...proposal(),enrollment:{...loopHostSubjectOwner(loopSubject),loopSubject,invocations:[]}};
}
it.each([false,true])('registers actual Loop subject only, not execution or completion: stage=%s',async stage=>{
 const f=fixture();try{
  const input=await loopProposal(stage?{stageId:'stage',stageKind:'verify'}:null),request={requestId:'loop',...input};
  const first=f.authority.prepareRequest(request,peer),result=await f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal);
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner:result.owner});
  expect(f.database.prepare('SELECT subject_json FROM owner_enrollment_loop_subjects').get()).toEqual({subject_json:json(input.enrollment.loopSubject)});
  expect(f.database.prepare('SELECT count(*) n FROM verification_registered_invocations').get()).toEqual({n:0});
  expect(()=>f.authority.resolveOwnerKey(peer,invocation)).toThrow(/invocation/);
  expect(()=>f.authority.createCapacityOwnerBinding(peer,invocation)).toThrow(/invocation/);
  expect(f.completion.invoke('completion.inspect',result,peer)).toMatchObject({currentVerification:'needs_revalidation',obligationCount:1});
 }finally{f.close();}
});
it.each(['loopId','runId','stageKind'] as const)('rejects same mapped stage owner with changed full subject: %s',async field=>{
 const f=fixture();try{
  const input=await loopProposal({stageId:'stage',stageKind:'verify'}),p=f.authority.prepare(input,peer);
  await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  const changed=structuredClone(input);
  if(field==='stageKind')changed.enrollment.loopSubject.stage!.stageKind='execute';else changed.enrollment.loopSubject[field]='other';
  expect(()=>f.authority.prepare(changed,peer)).toThrow(/loop_subject/);
 }finally{f.close();}
});
it('checks Loop subject again after native wait before FINAL of two competing first registrations',async()=>{
 const f=fixture();let release!:()=>void;try{
  const first=await loopProposal(),other=structuredClone(first);other.enrollment.loopSubject.loopId='other-loop';
  const slow=f.authority.prepare(first,peer),fast=f.authority.prepare(other,peer);
  f.setApprovalHook(async review=>{if(review.challengeId===slow.challengeId)await new Promise<void>(resolve=>{release=resolve;});});
  const awaiting=f.authority.authorize(slow.challengeId,peer,new AbortController().signal);
  await f.authority.authorize(fast.challengeId,peer,new AbortController().signal);release();
  await expect(awaiting).rejects.toThrow(/loop_subject/);
  expect(f.database.prepare('SELECT subject_json FROM owner_enrollment_loop_subjects').get()).toEqual({subject_json:json(other.enrollment.loopSubject)});
 }finally{release?.();f.close();}
});
it('allows an actual invocation append while preserving the original Loop subject receipt and request',async()=>{
 const f=fixture();try{
  const input=await loopProposal(),request={requestId:'loop-history',...input},p=f.authority.prepareRequest(request,peer);
  const {owner}=await f.authority.authorize(p.challenge.challengeId,peer,new AbortController().signal);
  const next={...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  next.registration=structuredClone(input.registration);next.registration.obligations.push({...structuredClone(input.registration.obligations[0]),obligation:{...input.registration.obligations[0].obligation,obligationId:'extra'}});
  const q=f.authority.prepare(next,peer);await f.authority.authorize(q.challengeId,peer,new AbortController().signal);
  expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(owner));
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner});
  expect(f.database.prepare('SELECT subject_json FROM owner_enrollment_loop_subjects').get()).toEqual({subject_json:json(input.enrollment.loopSubject)});
 }finally{f.close();}
});
it.each(['active-no-intent','pending-no-intent','legacy-intent'] as const)('rejects retrofitting a Loop subject to an existing owner: %s',async mode=>{
 const f=fixture();try{
  const input=await loopProposal(),old={...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  const p=f.authority.prepare(old,peer);await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  if(mode!=='legacy-intent')f.database.exec('DELETE FROM owner_enrollment_intents');
  if(mode==='pending-no-intent')f.database.exec("UPDATE verification_registered_owners SET state='pending'");
  expect(()=>f.authority.prepare(input,peer)).toThrow(/loop_subject/);
 }finally{f.close();}
});
it('rolls back Loop FINAL receipt and retains exact originally approved subject for a fresh retry',async()=>{
 const f=fixture();try{
  const input=await loopProposal(),request={requestId:'loop-failure',...input},p=f.authority.prepareRequest(request,peer);
  f.database.exec("CREATE TRIGGER loop_final_failure BEFORE UPDATE ON verification_registered_owners WHEN NEW.state='active' BEGIN SELECT RAISE(ABORT,'loop_activation_failure'); END");
  await expect(f.authority.authorize(p.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow('loop_activation_failure');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_loop_subjects').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM mandatory_observation_checks').get()).toEqual({n:0});
  expect(f.authority.recoverRequest(request,peer).state).toBe('not_approved');
  const changed=structuredClone(input);changed.enrollment.loopSubject.loopId='replacement';expect(()=>f.authority.prepare(changed,peer)).toThrow(/loop_subject/);
  const plain={...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  expect(()=>f.authority.prepare(plain,peer)).toThrow(/loop_subject/);
  f.database.exec('DROP TRIGGER loop_final_failure');const q=f.authority.prepare(input,peer);
  await f.authority.authorize(q.challengeId,peer,new AbortController().signal);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_loop_subjects').get()).toEqual({n:1});
 }finally{f.close();}
});
it.each(['delete','subject','registration'] as const)('rejects Loop request recovery and plain invocation append with a broken receipt: %s',async mode=>{
 const f=fixture();try{
  const input=await loopProposal(),request={requestId:'loop-corrupt',...input},p=f.authority.prepareRequest(request,peer);
  await f.authority.authorize(p.challenge.challengeId,peer,new AbortController().signal);
  if(mode==='delete')f.database.exec('DELETE FROM owner_enrollment_loop_subjects');
  if(mode==='subject')f.database.prepare('UPDATE owner_enrollment_loop_subjects SET subject_json=?').run(json({...input.enrollment.loopSubject,loopId:'different'}));
  if(mode==='registration')f.database.prepare('UPDATE owner_enrollment_loop_subjects SET registration_json=?').run(json({...input.registration,obligations:[]}));
  expect(()=>f.authority.recoverRequest(request,peer)).toThrow(/receipt|loop_subject/);
  const plain={...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  expect(()=>f.authority.prepare(plain,peer)).toThrow(/receipt|loop_subject/);
 }finally{f.close();}
});
it('retains Loop full subject across actual SQLite reopen without native replay',async()=>{
 const f=fixture();let closed=false,next:ReturnType<typeof fixture>|undefined;try{
  const request={requestId:'loop-disk',...await loopProposal({stageId:'stage',stageKind:'verify'})},p=f.authority.prepareRequest(request,peer);
  const {owner}=await f.authority.authorize(p.challenge.challengeId,peer,new AbortController().signal);
  f.authority.close();f.completion.close();f.database.close();closed=true;next=fixture(f.root);
  expect(next.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',owner});expect(next.approvals()).toBe(0);
 }finally{if(next)next.close();else if(!closed)f.close();else rmSync(f.root,{recursive:true,force:true});}
});
it('sends exact Loop subject and original recipes to the native enrollment authorizer',async()=>{
 const f=fixture();let nativeBody:any;const authority=createOwnerEnrollmentAuthority({...f.options,approve:review=>authorizeOwnerEnrollment(review,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock:f.options.clock,resolveAccount:async()=>f.options.resolvePrincipal(peer).accountGeneration,approve:async({reviewBytes})=>{nativeBody=JSON.parse(reviewBytes.toString());return createHash('sha256').update(reviewBytes).digest('hex');}})});
 try{const input=await loopProposal();input.enrollment.loopSubject.loopId='实际循环';const p=authority.prepare(input,peer);await authority.authorize(p.challengeId,peer,new AbortController().signal);expect(nativeBody.enrollment).toEqual(input.enrollment);expect(nativeBody.registration).toEqual(input.registration);}finally{authority.close();f.close();}
});
it('blocks a previously prepared Loop subject if an ordinary invocation enrollment commits during native wait',async()=>{
 const f=fixture();let release!:()=>void;try{
  const input=await loopProposal(),slow=f.authority.prepare(input,peer);
  f.setApprovalHook(async review=>{if(review.challengeId===slow.challengeId)await new Promise<void>(resolve=>{release=resolve;});});
  const waiting=f.authority.authorize(slow.challengeId,peer,new AbortController().signal);
  const ordinary={...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  const next=f.authority.prepare(ordinary,peer);await f.authority.authorize(next.challengeId,peer,new AbortController().signal);release();
  await expect(waiting).rejects.toThrow(/loop_subject_legacy/);
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_loop_subjects').get()).toEqual({n:0});
 }finally{release?.();f.close();}
});
it('does not issue material authorization from a subject-only Loop registration',async()=>{
 const {createMaterialAuthority}=await import('../../../src/runtime/verification/material-authority.js');
 const f=fixture();let approvals=0;try{
  const input=await loopProposal(),p=f.authority.prepare(input,peer);await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  const material=createMaterialAuthority({database:f.database,engineBinding:{engineId:'engine',incarnation:'boot'},clock:f.options.clock,wallNow:()=>1000,resolveOwnerKey:f.authority.resolveOwnerKey,
   async inspectFile(){return {sha256:H,size:1,executable:false};},async approve(){approvals++;throw Error('unexpected_native');},async stage(){throw Error('unexpected_stage');},acceptPlan(){throw Error('unexpected_accept');},discardPlan(){throw Error('unexpected_discard');}});
  await expect(material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/original.txt',byteLimit:1}],exactCommand:{argv:['/bin/cat','original.txt'],cwdRelative:'.'},expiresAt:10000},peer,new AbortController().signal)).rejects.toThrow(/invocation/);
  expect(approvals).toBe(0);expect(f.database.prepare('SELECT count(*) n FROM material_authority_challenges').get()).toEqual({n:0});
 }finally{f.close();}
});
it('denies existing invocation and request consumers when their bound Loop subject receipt is lost',async()=>{
 const f=fixture();try{
  const input=await loopProposal(),p=f.authority.prepare(input,peer);await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  const request={requestId:'real-invocation',...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}};
  const q=f.authority.prepareRequest(request,peer),{owner}=await f.authority.authorize(q.challenge.challengeId,peer,new AbortController().signal);
  expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(owner));f.database.exec('DELETE FROM owner_enrollment_loop_subjects');
  expect(()=>f.authority.resolveOwnerKey(peer,invocation)).toThrow(/loop_subject_receipt/);
  expect(()=>f.authority.createCapacityOwnerBinding(peer,invocation)).toThrow(/loop_subject_receipt/);
  expect(()=>f.authority.recoverRequest(request,peer)).toThrow(/loop_subject_receipt/);
 }finally{f.close();}
});
it('cancels Loop native enrollment without reserving a subject or minting a receipt',async()=>{
 const f=fixture(),abort=new AbortController();try{
  const request={requestId:'loop-cancel',...await loopProposal()},p=f.authority.prepareRequest(request,peer);
  f.setApprovalHook(async()=>{abort.abort();});
  await expect(f.authority.authorize(p.challenge.challengeId,peer,abort.signal)).rejects.toThrow();
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intents').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_loop_subjects').get()).toEqual({n:0});
  expect(f.authority.recoverRequest(request,peer).state).toBe('not_approved');
 }finally{f.close();}
});
it('rolls back a subject registration at the shared subject row ceiling',async()=>{
 const f=fixture();try{
  const request={requestId:'loop-capacity',...await loopProposal()},p=f.authority.prepareRequest(request,peer);
  f.database.transaction(()=>{const insert=f.database.prepare('INSERT INTO owner_enrollment_loop_subjects VALUES(?,?,?,?)');for(let i=0;i<4096;i++)insert.run('logical-'+i,'owner-'+i,'{}','{}');})();
  await expect(f.authority.authorize(p.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow(/loop_subject_capacity/);
  expect(f.database.prepare('SELECT count(*) n FROM mandatory_observation_checks').get()).toEqual({n:0});
  expect(f.authority.recoverRequest(request,peer).state).toBe('not_approved');
 }finally{f.close();}
});
it('reads a Loop application registration only from the actual full subject receipt and unchanged mandatory rules',async()=>{
 const f=fixture();try{
  const input=await loopProposal({stageId:'stage',stageKind:'verify'}),p=f.authority.prepare(input,peer);
  const {owner}=await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  const read=(value=owner,subject=input.enrollment.loopSubject,currentPeer=peer)=>(f.authority as any).readLoopApplicationRegistration(value,currentPeer,subject);
  expect(read()).toMatchObject({owner,subject:input.enrollment.loopSubject,registrationHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(()=>read(owner,{...input.enrollment.loopSubject,loopId:'different'})).toThrow(/loop_subject/);
  expect(()=>read({...owner,profileId:'different'})).toThrow(/owner/);
  expect(()=>read(owner,input.enrollment.loopSubject,{...peer,uid:502})).toThrow();
  f.database.prepare('UPDATE mandatory_observation_checks SET definition_json=?').run('{}');expect(()=>read()).toThrow(/registration_changed/);
 }finally{f.close();}
});
it('does not infer a Loop application subject from an ordinary invocation registration',async()=>{
 const f=fixture();try{
  const input=await loopProposal(),p=f.authority.prepare({...input,enrollment:{ownerKind:input.enrollment.ownerKind,ownerId:input.enrollment.ownerId,invocations:[invocation]}},peer);
  const {owner}=await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  expect(()=>(f.authority as any).readLoopApplicationRegistration(owner,peer,input.enrollment.loopSubject)).toThrow(/loop_subject/);
 }finally{f.close();}
});
it('rejects pending migration and lost subject receipts in Loop application registration reads',async()=>{
 const f=fixture();try{
  const input=await loopProposal(),p=f.authority.prepare(input,peer),{owner}=await f.authority.authorize(p.challengeId,peer,new AbortController().signal);
  const read=()=>(f.authority as any).readLoopApplicationRegistration(owner,peer,input.enrollment.loopSubject);expect(read()).toHaveProperty('registrationHash');
  f.database.exec('CREATE TABLE migration_publication_intents(owner_key TEXT PRIMARY KEY,state TEXT,published INTEGER,marker_json TEXT)');
  f.database.prepare('INSERT INTO migration_publication_intents VALUES(?,?,?,?)').run(json(owner),'pending',1,'{}');expect(read).toThrow(/migration/);
  f.database.exec('DELETE FROM migration_publication_intents; DELETE FROM owner_enrollment_loop_subjects');expect(read).toThrow(/loop_subject_receipt/);
 }finally{f.close();}
});
it.each(['loop','goal','recipe','open-owner'] as const)('rejects changed mandatory facts in the final host clock callback: %s',async route=>{
 const f=fixture();let armed=false,calls=0,at=0;
 const authority=createOwnerEnrollmentAuthority({...f.options,clock(){calls++;if(armed&&calls===at)f.database.prepare('UPDATE mandatory_observation_checks SET definition_json=?').run('{}');return f.options.clock();}});
 try{
  const input=route==='loop'?await loopProposal():goalSessionProposal(),p=authority.prepare(input,peer),{owner}=await authority.authorize(p.challengeId,peer,new AbortController().signal);
  const read=()=>route==='loop'?authority.readLoopApplicationRegistration(owner,peer,(input.enrollment as any).loopSubject):route==='goal'?authority.readApplicationRegistration(owner,peer,'thread'):route==='recipe'?authority.readApprovedRecipe(owner,'original'):authority.openOwner({ownerKind:owner.ownerKind,ownerId:owner.ownerId},peer);
  calls=0;read();at=calls;expect(at).toBeGreaterThan(0);calls=0;armed=true;
  expect(read).toThrow(/registration_changed/);
 }finally{authority.close();f.close();}
});
it('rejects a changed pending native review set in the final host callback',()=>{
 const f=fixture();let armed=false,calls=0,at=0;
 const authority=createOwnerEnrollmentAuthority({...f.options,clock(){calls++;if(armed&&calls===at)f.database.prepare("UPDATE owner_enrollment_challenges SET state='retired'").run();return f.options.clock();}});
 try{authority.prepare(proposal(),peer);calls=0;authority.getLiveSourceRegistrationReviews();at=calls;calls=0;armed=true;expect(()=>authority.getLiveSourceRegistrationReviews()).toThrow(/registration_changed/);}finally{authority.close();f.close();}
});
