import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {it,expect} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {businessApplicationBindingHash} from '../../../src/runtime/verification/business-application-binding.js';
import {goalRegistrationHash} from '../../../src/runtime/verification/owner-enrollment-review.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7},hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const binding={version:1 as const,kind:'goal' as const,sessionId:'session',goalId:'goal',epoch:1,objective:'original goal',completionCriterion:null,expectedEvidenceKinds:['answer' as const]};
async function fixture(sessionOnly=false){
 const root=mkdtempSync(join(tmpdir(),'application-authority-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});let domain='clock',time=1000,approvals=0,account='11111111-AAAA-BBBB-CCCC-555555555555',hook:undefined|(()=>Promise<void>),enrollmentHook:undefined|(()=>Promise<void>);
 const clock=()=>({domainId:domain,qualificationEpoch:1,lowerBound:time,upperBound:time+1,evidenceHash:H});
 const resolvePrincipal=(p:typeof peer)=>({...p,accountGeneration:account,source:'macos-local-generateduid' as const});
 const makeComposition=(db:typeof database)=>createVerificationCompletionComposition({root,database:db,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}},enrollment:{resolvePrincipal,approve:async(r:any)=>{await enrollmentHook?.();return {uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(json(r))};},profilePublication:createProfileIndexPublisher({root:markers,database:db,authorityId:'authority',assertCurrent(){}})},recipePorts:{assertFailedRunComplete(){throw Error('unused');},assertCurrent(){},async readArtifact(){return Buffer.from('result');},async runBlackbox(){throw Error('unused');},async readFailedRun(){throw Error('unused');}}});
 const composition=makeComposition(database);
 const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:H,structure:'utf8'}]};
 const proposal={enrollment:sessionOnly?{ownerKind:'goal',ownerId:'goal',goalSessionId:'session',invocations:[]}:{ownerKind:'goal',ownerId:'goal',invocations:[{sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'validation'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner'}}};
 const enrolled=await composition.public.invoke('completion.prepare-owner',proposal,peer) as any;
 const {owner}=await composition.public.invoke('completion.authorize-owner',{challengeId:enrolled.challengeId},peer) as any;
 const options={database,authorityId:'authority',completion:composition,clock,assertCurrent(){},resolvePrincipal,async approve(review:any){approvals++;await hook?.();return {uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}};
 const authority=createApplicationBindingAuthority(options);
 return {root,database,composition,options,proposal,owner,authority,approvals:()=>approvals,setHook(h:typeof hook){hook=h;},setEnrollmentHook(h:typeof enrollmentHook){enrollmentHook=h;},advance(){time+=300001;},requalifyClock(){domain='new-qualified-clock';},reopenDatabase(){authority.close();composition.close();database.close();const db=openPrivateVerificationDatabase(root),composed=makeComposition(db),reopened=createApplicationBindingAuthority({...options,database:db,completion:composed});return {database:db,authority:reopened,close(){reopened.close();composed.close();db.close();}};},changeAccount(){account='99999999-AAAA-BBBB-CCCC-555555555555';},close(){authority.close();composition.close();if(database.open)database.close();rmSync(root,{recursive:true,force:true});}};
}
it('uses original committed registration, binds native-approved identity once, and never labels it execution success',async()=>{
 const f=await fixture();try{
  const prepared=f.authority.prepare({requestSource:'user',binding},peer);
  expect(f.authority.inspect({ownerKind:'goal',ownerId:'goal'},peer).state).toBe('unbound');
  const actual=await f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal);
  expect(actual).toMatchObject({state:'active',current:{binding,revision:1}});
  expect(f.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).toBe('needs_revalidation');
  await expect(f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal)).rejects.toThrow(/consumed/);
  expect(f.approvals()).toBe(1);
  expect(f.authority.prepare({requestSource:'user',binding},peer)).toMatchObject({challengeId:prepared.challengeId,alreadyCommitted:true});
  expect(f.approvals()).toBe(1);
  const reopened=createApplicationBindingAuthority(f.options);try{expect(reopened.reconcile({requestSource:'user',challengeId:prepared.challengeId},peer)).toEqual(actual);expect(f.approvals()).toBe(1);}finally{reopened.close();}
 }finally{f.close();}
});
it('rejects non-user mutation, foreign peer/session and stale native deadline without new binding',async()=>{
 const f=await fixture();try{
  expect(()=>f.authority.prepare({requestSource:'agent',binding},peer)).toThrow(/source/);
  expect(()=>f.authority.prepare({requestSource:'user',binding:{...binding,sessionId:'foreign'}},peer)).toThrow(/session/);
  const p=f.authority.prepare({requestSource:'user',binding},peer);
  await expect(f.authority.authorize({requestSource:'agent',challengeId:p.challengeId},peer,new AbortController().signal)).rejects.toThrow(/source/);
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challengeId},{...peer,auditSessionId:8},new AbortController().signal)).rejects.toThrow();
  f.setHook(async()=>{f.advance();});
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal)).rejects.toThrow(/deadline/);
  expect(f.composition.privateHost.authorityHost.inspectApplication(f.owner).state).toBe('unbound');
 }finally{f.close();}
});
it('invalidates the original owner before replacing with a strictly later Goal epoch',async()=>{
 const f=await fixture();try{
  const p=f.authority.prepare({requestSource:'user',binding},peer);await f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal);
  expect(()=>f.authority.prepare({requestSource:'user',binding:{...binding,objective:'replacement'}},peer)).toThrow(/epoch/);
  const next=f.authority.prepare({requestSource:'user',binding:{...binding,epoch:2,objective:'replacement'}},peer);
  const replaced=await f.authority.authorize({requestSource:'user',challengeId:next.challengeId},peer,new AbortController().signal);
  expect(replaced).toMatchObject({state:'active',current:{revision:2,binding:{epoch:2,objective:'replacement'}}});
  expect(f.database.prepare('SELECT count(*) n FROM verification_application_history').get()).toEqual({n:2});
 }finally{f.close();}
});

it('keeps a durable pending target after pointer-write failure, requires fresh approval after expiry, and never silently changes target',async()=>{
 const f=await fixture();try{
  const prepared=f.authority.prepare({requestSource:'user',binding},peer);
  f.database.exec("CREATE TRIGGER reject_goal_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'binding disk failure'); END");
  await expect(f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal)).rejects.toThrow('binding disk failure');
  expect(f.authority.inspect({ownerKind:'goal',ownerId:'goal'},peer)).toMatchObject({state:'pending',pendingTarget:binding});
  expect(()=>f.composition.privateHost.authorityHost.registerSubject({owner:f.owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:400000,manifest:[{path:'source',sha256:H,size:1,role:'source'}]})).toThrow(/pending/);
  f.advance();f.database.exec('DROP TRIGGER reject_goal_binding');
  expect(()=>f.authority.reconcile({requestSource:'user',challengeId:prepared.challengeId},peer)).toThrow(/deadline/);
  expect(()=>f.authority.prepare({requestSource:'user',binding:{...binding,objective:'different target'}},peer)).toThrow(/pending_target/);
  const reapproved=f.authority.prepare({requestSource:'user',binding},peer);
  expect(f.approvals()).toBe(1);
  const result=await f.authority.authorize({requestSource:'user',challengeId:reapproved.challengeId},peer,new AbortController().signal);
  expect(result).toMatchObject({state:'active',current:{binding,revision:1}});
  expect(f.approvals()).toBe(2);
 }finally{f.close();}
});
it('does not accept an old native callback after an explicit challenge from a new service lifetime',async()=>{
 const f=await fixture();let release!:()=>void,reached!:()=>void;
 const entered=new Promise<void>(resolve=>{reached=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
 f.setHook(async()=>{reached();await hold;});
 const p=f.authority.prepare({requestSource:'user',binding},peer),work=f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal);
 let next:ReturnType<typeof createApplicationBindingAuthority>|undefined;
 try{
  await entered;next=createApplicationBindingAuthority(f.options);const fresh=next.prepare({requestSource:'user',binding},peer);
  release();await expect(work).rejects.toThrow(/consumed/);
  expect(next.inspect({ownerKind:'goal',ownerId:'goal'},peer).state).toBe('unbound');
  f.setHook(undefined);expect(await next.authorize({requestSource:'user',challengeId:fresh.challengeId},peer,new AbortController().signal)).toMatchObject({state:'active'});
 }finally{release();await work.catch(()=>{});next?.close();f.close();}
});
it('rejects copied composition objects and a changed actual account before binding',async()=>{
 const f=await fixture();try{
  expect(()=>createApplicationBindingAuthority({...f.options,completion:{...f.composition}})).toThrow();
  const p=f.authority.prepare({requestSource:'user',binding},peer);f.setHook(async()=>{f.changeAccount();});
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal)).rejects.toThrow(/principal/);
  expect(f.composition.privateHost.authorityHost.inspectApplication(f.owner).state).toBe('unbound');
 }finally{f.close();}
});

it('durably locates original request without recreating native authority, and seals its original challenge', async () => {
 const f=await fixture();try {
  const request={requestSource:'user' as const,requestId:'original-request',binding};
  const first=f.authority.prepareRequest(request,peer);
  expect(first.created).toBe(true);
  expect(f.authority.prepareRequest(request,peer)).toEqual({...first,created:false});
  expect(f.authority.lookupRequest(request,peer)).toMatchObject({state:'pending',challengePhase:'prepared',challenge:first.challenge});
  expect(()=>f.authority.lookupRequest({...request,binding:{...binding,objective:'changed'}},peer)).toThrow();
  expect(()=>f.authority.lookupRequest(request,{...peer,auditSessionId:8})).toThrow();
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'not_approved',challengePhase:'not_approved'});
  await expect(f.authority.authorize({requestSource:'user',challengeId:first.challenge.challengeId},peer,new AbortController().signal)).rejects.toThrow(/consumed/);
  expect(f.approvals()).toBe(0);
  const reopened=createApplicationBindingAuthority(f.options);try {expect(reopened.lookupRequest(request,peer).state).toBe('not_approved');}finally {reopened.close();}
 }finally {f.close();}
});
it('absent recovery fences late prepare and historical committed recovery never claims a newer binding',async()=>{
 const f=await fixture();try {
  const request={requestSource:'user' as const,requestId:'missing',binding};
  expect(f.authority.lookupRequest(request,peer)).toEqual({state:'absent'});
  expect(f.authority.recoverRequest(request,peer)).toEqual({state:'not_prepared'});
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow(/not_prepared/);
  const retry={...request,requestId:'new-explicit-request'},prepared=f.authority.prepareRequest(retry,peer);
  await f.authority.authorize({requestSource:'user',challengeId:prepared.challenge.challengeId},peer,new AbortController().signal);
  const next=f.authority.prepare({requestSource:'user',binding:{...binding,epoch:2,objective:'new epoch'}},peer);
  await f.authority.authorize({requestSource:'user',challengeId:next.challengeId},peer,new AbortController().signal);
  expect(f.authority.recoverRequest(retry,peer)).toMatchObject({state:'committed',challengePhase:'committed',challenge:{canonicalReview:{binding}},observation:{current:{binding:{epoch:2}}}});
  expect(f.approvals()).toBe(2);
 }finally{f.close();}
});
it('recover during the real native wait seals the legacy authorize sibling before its late callback',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});
 f.setHook(async()=>{entered();await hold;});
 const request={requestSource:'user' as const,requestId:'held-request',binding};
 const prepared=f.authority.prepareRequest(request,peer),work=f.authority.authorize({requestSource:'user',challengeId:prepared.challenge.challengeId},peer,new AbortController().signal);
 try {await reached;expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'not_approved',challengePhase:'not_approved'});release();await expect(work).rejects.toThrow(/consumed/);expect(f.authority.inspect({ownerKind:'goal',ownerId:'goal'},peer).state).toBe('unbound');expect(f.approvals()).toBe(1);}
 finally{release();await work.catch(()=>{});f.close();}
});
it.each(['same-lifetime','expired','restarted','clock-requalified'] as const)('approved fence survives %s and recovery never replays native',async mode=>{
 const f=await fixture();let reopened:ReturnType<typeof createApplicationBindingAuthority>|undefined;
 try {
  const request={requestSource:'user' as const,requestId:'pending-fence',binding},p=f.authority.prepareRequest(request,peer);
  f.database.exec("CREATE TRIGGER reject_request_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'binding disk failure'); END");
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challenge.challengeId},peer,new AbortController().signal)).rejects.toThrow('binding disk failure');
  expect(f.authority.lookupRequest(request,peer)).toMatchObject({state:'pending',challengePhase:'approved',observation:{state:'pending',pendingTarget:binding}});
  f.database.exec('DROP TRIGGER reject_request_binding');
  if(mode==='expired')f.advance();
  if(mode==='clock-requalified')f.requalifyClock();
  if(mode==='restarted'){f.authority.close();reopened=createApplicationBindingAuthority(f.options);}
  const authority=reopened??f.authority,result=authority.recoverRequest(request,peer),needsApproval=mode==='expired'||mode==='clock-requalified';
  expect(result).toMatchObject({state:needsApproval?'reauthorization_required':'committed',challengePhase:needsApproval?'approved':'committed'});
  expect(f.approvals()).toBe(1);
  if(needsApproval){
   expect(()=>authority.reconcile({requestSource:'user',challengeId:p.challenge.challengeId},peer)).toThrow(/deadline|reauthorization/);
   expect(authority.inspect({ownerKind:'goal',ownerId:'goal'},peer)).toMatchObject({state:'pending',pendingTarget:binding});
   const retry=authority.prepareRequest({...request,requestId:'explicit-reauthorization'},peer);
   await authority.authorize({requestSource:'user',challengeId:retry.challenge.challengeId},peer,new AbortController().signal);
   expect(authority.recoverRequest(request,peer).observation).toMatchObject({state:'active',current:{binding}});
   expect(f.approvals()).toBe(2);
  }
 }finally{reopened?.close();f.close();}
});
it('request identities remain tied to actual account and user-only prepare',async()=>{
 const f=await fixture();try{
  const request={requestSource:'user' as const,requestId:'account-bound',binding};
  expect(()=>f.authority.prepareRequest({...request,requestSource:'scheduler'},peer)).toThrow(/source/);
  f.authority.prepareRequest(request,peer);f.changeAccount();
  expect(()=>f.authority.lookupRequest(request,peer)).toThrow(/principal/);
  expect(()=>f.authority.recoverRequest(request,peer)).toThrow(/principal/);
 }finally{f.close();}
});
it('the real enrollment FINAL refuses R2 while R1 is pending; original request remains recoverable',async()=>{
 const f=await fixture();try{
  const request={requestSource:'user' as const,requestId:'registration-extension',binding},p=f.authority.prepareRequest(request,peer);
  f.database.exec("CREATE TRIGGER reject_registration_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'binding disk failure'); END");
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challenge.challengeId},peer,new AbortController().signal)).rejects.toThrow();
  f.database.exec('DROP TRIGGER reject_registration_binding');
  const next=structuredClone(f.proposal);next.registration.obligations.push({...next.registration.obligations[0]!,obligation:{...next.registration.obligations[0]!.obligation,obligationId:'appended-obligation'}});
  const challenge=await f.composition.public.invoke('completion.prepare-owner',next,peer) as {challengeId:string};
  await expect(f.composition.public.invoke('completion.authorize-owner',{challengeId:challenge.challengeId},peer)).rejects.toThrow('verification_invalidation_pending');
  expect(f.authority.lookupRequest(request,peer)).toMatchObject({state:'pending',challengePhase:'approved',observation:{state:'pending',pendingTarget:binding}});
  expect(f.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',challengePhase:'committed',observation:{state:'active',current:{binding}}});
  expect(f.approvals()).toBe(1);
 }finally{f.close();}
});
it('rolls back the challenge with a failed request mapping and shares the legacy/request capacity',async()=>{
 const f=await fixture();try{
  const request={requestSource:'user' as const,requestId:'mapping-failure',binding};
  f.database.exec("CREATE TRIGGER reject_application_request BEFORE INSERT ON goal_application_requests BEGIN SELECT RAISE(ABORT,'request disk failure'); END");
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow('request disk failure');
  expect(f.database.prepare('SELECT count(*) n FROM goal_application_challenges').get()).toEqual({n:0});
  expect(f.authority.lookupRequest(request,peer).state).toBe('absent');
  f.database.exec('DROP TRIGGER reject_application_request');
  f.authority.recoverRequest({...request,requestId:'seed-tombstone'},peer);
  const seed=f.database.prepare('SELECT * FROM goal_application_requests').get() as {principal_json:string;binding_json:string};
  const insert=f.database.prepare('INSERT INTO goal_application_requests VALUES(?,?,?,NULL)');
  f.database.transaction(()=>{for(let i=1;i<4096;i++)insert.run(`capacity-${i}`,seed.principal_json,seed.binding_json);})();
  expect(()=>f.authority.prepare({requestSource:'user',binding},peer)).toThrow(/capacity/);
  expect(()=>f.authority.prepareRequest(request,peer)).toThrow(/capacity/);
  expect(()=>f.authority.recoverRequest(request,peer)).toThrow(/capacity/);
  expect(f.authority.recoverRequest({...request,requestId:'seed-tombstone'},peer)).toEqual({state:'not_prepared'});
 }finally{f.close();}
});
it('routes original requests through the actual signed public daemon and fixed application router',async()=>{
 const f=await fixture(),keys=generateKeyPairSync('ed25519'),socketPath=join(f.root,'request.sock');let current=true,renewals=0;
 const router=createControllerApplicationRouting({application:f.authority,assertCurrent(){if(!current)throw Error('host_revoked');},async renew(){renewals++;}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:keys.privateKey,allowedUserIds:[peer.uid],acceptPeer:()=>peer,
  invoke:(method,payload,actualPeer,signal)=>router.invoke(method,payload,actualPeer,signal)});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync(){throw Error('unused');}});
 try{
  const request={requestSource:'user',requestId:'signed-request',binding};
  const prepared=await client.applicationTransport.call('application.prepareRequest',request) as {challenge:{challengeId:string}};
  expect(await client.applicationTransport.call('application.lookupRequest',request)).toMatchObject({state:'pending',challenge:{challengeId:prepared.challenge.challengeId}});
  await expect(client.applicationTransport.call('application.recoverRequest',{...request,owner:'injected'})).rejects.toThrow();
  expect(await client.applicationTransport.call('application.recoverRequest',request)).toMatchObject({state:'not_approved'});
  await expect(client.applicationTransport.call('application.authorize',{requestSource:'user',challengeId:prepared.challenge.challengeId})).rejects.toThrow();
  expect(f.approvals()).toBe(0);expect(renewals).toBe(5);
  await expect(router.invoke('application.delete',{},peer,new AbortController().signal)).rejects.toThrow(/method/);expect(renewals).toBe(5);
  current=false;await expect(client.applicationTransport.call('application.lookupRequest',request)).rejects.toThrow();
 }finally{client.dispose();await server.close();f.close();}
});
it('routes and captures all seven application methods before renewal across the actual authority boundary',async()=>{
 const durableSnapshot=(database:any)=>({
  requests:database.prepare('SELECT * FROM goal_application_requests ORDER BY request_id').all(),
  challenges:database.prepare('SELECT * FROM goal_application_challenges ORDER BY id').all(),
  clock:database.prepare('SELECT * FROM goal_application_clock ORDER BY domain_id,qualification_epoch').all(),
  transitions:database.prepare('SELECT * FROM verification_application_transitions ORDER BY transition_id').all(),
  history:database.prepare('SELECT * FROM verification_application_history ORDER BY owner_key,revision').all(),
  pointers:database.prepare('SELECT * FROM verification_application_pointers ORDER BY owner_key').all(),
 });
 for(const method of ['prepare','prepareRequest','lookupRequest','recoverRequest','authorize','inspect','reconcile'] as const){
  const f=await fixture();let renewals=0,currentChecks=0,releaseRenew!:()=>void,enteredRenew!:()=>void;const held=new Promise<void>(r=>{releaseRenew=r}),entered=new Promise<void>(r=>{enteredRenew=r;}),calls:string[]=[],countedApplication={prepare:(...args:any[])=>{calls.push('prepare');return f.authority.prepare(...args)},prepareRequest:(...args:any[])=>{calls.push('prepareRequest');return f.authority.prepareRequest(...args)},lookupRequest:(...args:any[])=>{calls.push('lookupRequest');return f.authority.lookupRequest(...args)},recoverRequest:(...args:any[])=>{calls.push('recoverRequest');return f.authority.recoverRequest(...args)},authorize:(...args:any[])=>{calls.push('authorize');return f.authority.authorize(...args)},inspect:(...args:any[])=>{calls.push('inspect');return f.authority.inspect(...args)},reconcile:(...args:any[])=>{calls.push('reconcile');return f.authority.reconcile(...args)}},router=createControllerApplicationRouting({application:countedApplication as any,assertCurrent(){currentChecks++;},async renew(){renewals++;enteredRenew();await held;}}),signal=new AbortController().signal;
  try{
   const request={requestSource:'user',requestId:`router-${method}`,binding:structuredClone(binding)};let payload:any,preparedChallengeId:string|undefined;
   if(method==='prepare')payload={requestSource:'user',binding:structuredClone(binding)};
   if(method==='prepareRequest')payload=structuredClone(request);
   if(method==='lookupRequest'||method==='recoverRequest'){payload=structuredClone(request);f.authority.recoverRequest(structuredClone(request),peer);}
   if(method==='inspect')payload={ownerKind:'goal',ownerId:'goal'};
   if(method==='authorize'||method==='reconcile'){const prepared=f.authority.prepare({requestSource:'user',binding},peer);preparedChallengeId=prepared.challengeId;if(method==='reconcile')await f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal);payload={requestSource:'user',challengeId:prepared.challengeId};}
   const before=durableSnapshot(f.database),approvalsBefore=f.approvals(),expectedRegistrationHash=goalRegistrationHash(f.proposal.registration),routedPeer={...peer};const pending=router.invoke(`application.${method}`,payload,routedPeer,signal);await entered;for(const key of ['binding','requestId','challengeId','ownerId'])if(Object.hasOwn(payload,key)){if(key==='binding')payload.binding.objective='mutated-after-call';else payload[key]='mutated-after-call';}routedPeer.uid=999;releaseRenew();const result=await pending;expect(calls).toEqual([method]);expect(renewals).toBe(1);expect(currentChecks).toBe(2);
   if(method==='prepare')expect((result as any).canonicalReview.binding.objective).toBe(binding.objective);
   if(method==='prepareRequest')expect((result as any).challenge.canonicalReview.binding.objective).toBe(binding.objective);
   if(method==='lookupRequest')expect(result).toMatchObject({state:'not_prepared'});
   if(method==='recoverRequest')expect(result).toMatchObject({state:'not_prepared'});
   if(method==='inspect')expect(result).toMatchObject({state:'unbound'});
   if(method==='reconcile')expect(result).toMatchObject({state:'active'});
   if(method==='authorize')expect(result).toMatchObject({state:'active'});
   const after=durableSnapshot(f.database),expected=structuredClone(before),originalRequest=after.requests.find((row:any)=>row.request_id===request.requestId),mutatedRequest=after.requests.find((row:any)=>row.request_id==='mutated-after-call');
   const challengeId=method==='prepare'?(result as any).challengeId:method==='prepareRequest'?(result as any).challenge?.challengeId:preparedChallengeId;
   const challengeAfter=challengeId?after.challenges.find((row:any)=>row.id===challengeId):undefined;
   if(method==='prepareRequest'){
    const principal={uid:peer.uid,gid:peer.gid,auditSessionId:peer.auditSessionId,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'};
    expect(originalRequest).toEqual({request_id:request.requestId,principal_json:json(principal),binding_json:json(binding),challenge_id:challengeId});
   }
   if(method==='lookupRequest'||method==='recoverRequest'){expect(originalRequest).toBeDefined();expect(mutatedRequest).toBeUndefined();}
   if(method==='prepare'||method==='prepareRequest'){
    expect(after.challenges.length-before.challenges.length).toBe(1);
    const review=JSON.parse(challengeAfter!.review_json);
    const expectedReview={version:1,purpose:'completion-application-binding',authorityId:'authority',challengeId,principal:{uid:peer.uid,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',auditSessionId:peer.auditSessionId},requestSource:'user',owner:{profileId:f.owner.profileId,ownerKind:'goal',ownerId:'goal'},registrationHash:expectedRegistrationHash,previousBindingHash:null,binding,bindingHash:businessApplicationBindingHash(binding),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:301000}};
    expect(review).toEqual(expectedReview);
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(challengeAfter).toEqual({id:challengeId,principal:json(peer),boot:expect.stringMatching(uuid),state:'prepared',review_json:json(expectedReview),transition_id:expect.stringMatching(uuid)});
    expected.challenges.push(challengeAfter!);
   }else if(method==='authorize'){
    const committed={...before.challenges.find((row:any)=>row.id===challengeId),state:'committed'};
    expect(challengeAfter).toEqual(committed);expected.challenges=before.challenges.map((row:any)=>row.id===challengeId?committed:row);
   }else expect(after.challenges).toEqual(before.challenges);
   if(method==='prepareRequest'){expect(after.requests.length-before.requests.length).toBe(1);expected.requests.push(originalRequest!);}else expect(after.requests).toEqual(before.requests);
   if(method==='authorize'){
    expect(after.transitions.length-before.transitions.length).toBe(1);
    const challengeRow=challengeAfter!,review=JSON.parse(challengeRow.review_json),transition=after.transitions.find((row:any)=>row.transition_id===challengeRow.transition_id),ownerKey=json(review.owner),bindingJson=json(binding),bindingHash=businessApplicationBindingHash(binding);
    const expectedTransition={transition_id:challengeRow.transition_id,owner_key:ownerKey,previous_hash:null,binding_json:bindingJson,registration_hash:expectedRegistrationHash,state:'committed'};
    expect(transition).toEqual(expectedTransition);expected.transitions.push(expectedTransition);
    expect(after.history.length-before.history.length).toBe(1);
    const expectedHistory={owner_key:ownerKey,revision:1,binding_hash:bindingHash,binding_json:bindingJson,registration_hash:expectedRegistrationHash};
    expect(after.history).toContainEqual(expectedHistory);expected.history.push(expectedHistory);
    const expectedPointer={owner_key:ownerKey,current_json:json({binding,bindingHash,revision:1}),pending_id:null};
    expect(after.pointers).toContainEqual(expectedPointer);expected.pointers=before.pointers.filter((row:any)=>row.owner_key!==ownerKey).concat(expectedPointer);
    expect(after.pointers.filter((row:any)=>row.owner_key!==ownerKey)).toEqual(before.pointers.filter((row:any)=>row.owner_key!==ownerKey));expect(f.approvals()-approvalsBefore).toBe(1);
   }else{expect(after.transitions).toEqual(before.transitions);expect(after.history).toEqual(before.history);expect(after.pointers).toEqual(before.pointers);expect(f.approvals()-approvalsBefore).toBe(0);}
   if(method==='prepare'||method==='prepareRequest'){expected.clock=[{domain_id:'clock',qualification_epoch:1,last_lower:1000}];expect(after.clock).toEqual(expected.clock);}else expect(after.clock).toEqual(before.clock);
   for(const key of ['requests','challenges','clock','transitions','history','pointers'] as const)expected[key].sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   expect(after).toEqual(expected);
  }finally{releaseRenew();f.close();}
 }
});
it('keeps abort-before and abort-after-renew ahead of authority and durable side effects',async()=>{
 const durableSnapshot=(database:any)=>({challenges:database.prepare('SELECT * FROM goal_application_challenges ORDER BY id').all(),requests:database.prepare('SELECT * FROM goal_application_requests ORDER BY request_id').all(),clock:database.prepare('SELECT * FROM goal_application_clock ORDER BY domain_id,qualification_epoch').all(),transitions:database.prepare('SELECT * FROM verification_application_transitions ORDER BY transition_id').all(),history:database.prepare('SELECT * FROM verification_application_history ORDER BY owner_key,revision').all(),pointers:database.prepare('SELECT * FROM verification_application_pointers ORDER BY owner_key').all()});
 const f=await fixture();try{
  for(const phase of ['before','after'] as const){let renewals=0,currentChecks=0,authorityCalls=0;const countedApplication={prepare:(...a:any[])=>{authorityCalls++;return f.authority.prepare(...a)},prepareRequest:(...a:any[])=>{authorityCalls++;return f.authority.prepareRequest(...a)},lookupRequest:(...a:any[])=>{authorityCalls++;return f.authority.lookupRequest(...a)},recoverRequest:(...a:any[])=>{authorityCalls++;return f.authority.recoverRequest(...a)},authorize:(...a:any[])=>{authorityCalls++;return f.authority.authorize(...a)},inspect:(...a:any[])=>{authorityCalls++;return f.authority.inspect(...a)},reconcile:(...a:any[])=>{authorityCalls++;return f.authority.reconcile(...a)}};const controller=new AbortController(),router=createControllerApplicationRouting({application:countedApplication as any,assertCurrent(){currentChecks++;},async renew(){renewals++;if(phase==='after')controller.abort();}});if(phase==='before')controller.abort();const before=durableSnapshot(f.database),approvalsBefore=f.approvals();await expect(router.invoke('application.prepareRequest',{requestSource:'user',requestId:`abort-${phase}`,binding:structuredClone(binding)},peer,controller.signal)).rejects.toThrow();expect(renewals).toBe(phase==='before'?0:1);expect(currentChecks).toBe(phase==='before'?0:1);expect(authorityCalls).toBe(0);expect(f.approvals()).toBe(approvalsBefore);expect(durableSnapshot(f.database)).toEqual(before);}
 }finally{f.close();}
});
it.each(['approved','committed'] as const)('actual SQLite close/reopen preserves %s request and unapproved/absent fences without native replay',async phase=>{
 const f=await fixture();let reopened:ReturnType<typeof f.reopenDatabase>|undefined;
 try{
  const request={requestSource:'user' as const,requestId:'closed-db',binding};
  f.authority.recoverRequest({...request,requestId:'missing-before-close'},peer);
  f.authority.prepareRequest({...request,requestId:'sealed-before-close'},peer);
  f.authority.recoverRequest({...request,requestId:'sealed-before-close'},peer);
  const p=f.authority.prepareRequest(request,peer);
  if(phase==='approved')f.database.exec("CREATE TRIGGER close_before_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'binding disk failure'); END");
  const work=f.authority.authorize({requestSource:'user',challengeId:p.challenge.challengeId},peer,new AbortController().signal);
  if(phase==='approved')await expect(work).rejects.toThrow('binding disk failure');else await work;
  reopened=f.reopenDatabase();if(phase==='approved')reopened.database.exec('DROP TRIGGER close_before_binding');
  expect(reopened.authority.recoverRequest(request,peer)).toMatchObject({state:'committed',observation:{state:'active',current:{binding}}});
  expect(reopened.authority.recoverRequest({...request,requestId:'missing-before-close'},peer)).toEqual({state:'not_prepared'});
  expect(reopened.authority.recoverRequest({...request,requestId:'sealed-before-close'},peer)).toMatchObject({state:'not_approved'});
  expect(f.approvals()).toBe(1);
 }finally{reopened?.close();f.close();}
});
it('the fixed router captures the original request before qualification awaits',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;
 const hold=new Promise<void>(r=>{release=r;}),reached=new Promise<void>(r=>{entered=r;});
 const router=createControllerApplicationRouting({application:f.authority,assertCurrent(){},async renew(){entered();await hold;}});
 const request={requestSource:'user',requestId:'captured-before-renew',binding:structuredClone(binding)};
 const work=router.invoke('application.prepareRequest',request,peer,new AbortController().signal);
 try{await reached;request.binding.objective='late changed request';release();const result=await work;expect(result).toMatchObject({challenge:{canonicalReview:{binding}}});}
 finally{release();await work.catch(()=>{});f.close();}
});

it('binds a newly approved Goal session before any actual validation invocation exists',async()=>{
 const f=await fixture(true);try{
  expect(f.database.prepare('SELECT count(*) n FROM verification_registered_invocations').get()).toEqual({n:0});
  const original=f.authority.prepareRequest({requestSource:'user',requestId:'new-goal-application',binding},peer);
  const result=await f.authority.authorize({requestSource:'user',challengeId:original.challenge.challengeId},peer,new AbortController().signal);
  expect(result).toMatchObject({state:'active',current:{binding}});expect(f.approvals()).toBe(1);
  expect(f.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).toBe('needs_revalidation');
  expect(()=>f.composition.privateHost.enrollment.resolveOwnerKey(peer,{sessionIdentity:'session',compoundOperationId:'invented',validationInvocationId:'invented'})).toThrow(/invocation/);
 }finally{f.close();}
});
it.each(['active','pending'] as const)('preserves legacy %s application session when first explicit enrollment is attempted',async phase=>{
 const f=await fixture(),signal=new AbortController().signal;try{
  const original=f.authority.prepare({requestSource:'user',binding},peer);
  if(phase==='pending')f.database.exec("CREATE TRIGGER hold_session_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'session_binding_failure'); END");
  const start=f.authority.authorize({requestSource:'user',challengeId:original.challengeId},peer,signal);
  if(phase==='pending'){await expect(start).rejects.toThrow('session_binding_failure');expect(f.authority.inspect({ownerKind:'goal',ownerId:'goal'},peer)).toMatchObject({state:'pending',pendingTarget:binding});}else await start;
  const proposal={...f.proposal,enrollment:{ownerKind:'goal',ownerId:'goal',goalSessionId:'other-session',invocations:[]}};
  expect(()=>f.composition.public.invoke('completion.prepare-owner',proposal,peer)).toThrow('enrollment_goal_session_changed');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_goal_sessions').get()).toEqual({n:0});
  if(phase==='pending'){f.database.exec('DROP TRIGGER hold_session_binding');expect(f.authority.reconcile({requestSource:'user',challengeId:original.challengeId},peer)).toMatchObject({state:'active',current:{binding}});}
  const same={...proposal,enrollment:{...proposal.enrollment,goalSessionId:'session'}};
  const challenge=await f.composition.public.invoke('completion.prepare-owner',same,peer) as any;await f.composition.public.invoke('completion.authorize-owner',{challengeId:challenge.challengeId},peer,signal);
  expect(f.authority.inspect({ownerKind:'goal',ownerId:'goal'},peer)).toMatchObject({state:'active',current:{binding}});expect(f.approvals()).toBe(1);
 }finally{f.close();}
});
it('rejects late Goal session enrollment if a conflicting legacy application became pending during native review',async()=>{
 const f=await fixture(),signal=new AbortController().signal;let release!:()=>void,reached!:()=>void;
 const entered=new Promise<void>(resolve=>{reached=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
 let pending:Promise<unknown>|undefined;try{
  const request={requestId:'late-session',...f.proposal,enrollment:{ownerKind:'goal',ownerId:'goal',goalSessionId:'other-session',invocations:[]}};
  const prepared=await f.composition.public.invoke('completion.prepare-owner-request',request,peer) as any;
  f.setEnrollmentHook(async()=>{reached();await hold;});pending=Promise.resolve(f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challenge.challengeId},peer,signal));
  await entered;const original=f.authority.prepare({requestSource:'user',binding},peer);
  f.database.exec("CREATE TRIGGER hold_late_session BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'session_binding_failure'); END");
  await expect(f.authority.authorize({requestSource:'user',challengeId:original.challengeId},peer,signal)).rejects.toThrow('session_binding_failure');
  release();await expect(pending).rejects.toThrow('enrollment_goal_session_changed');
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_goal_sessions').get()).toEqual({n:0});
  expect(await f.composition.public.invoke('completion.recover-owner-request',request,peer)).toMatchObject({state:'not_approved'});
  f.database.exec('DROP TRIGGER hold_late_session');expect(f.authority.reconcile({requestSource:'user',challengeId:original.challengeId},peer)).toMatchObject({state:'active',current:{binding}});expect(f.approvals()).toBe(1);
 }finally{release?.();await pending?.catch(()=>{});f.close();}
});

async function activeForkSource(){
 const f=await fixture(true),p=f.authority.prepare({requestSource:'user',binding},peer);
 await f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal);return f;
}
const forkQuery={ownerKind:'goal' as const,ownerId:'goal',sessionId:'session'};
function forkProposal(raw:any){const snapshot=structuredClone(raw);return {enrollment:{ownerKind:'goal',ownerId:'forked',goalSessionId:'fork-session',invocations:[]},registration:{migrationEpoch:1,obligations:snapshot.registration.obligations,source:{kind:'new-owner',fork:snapshot.source}}};}
it('reads actual source registration and application only for the authenticated original Goal session',async()=>{
 const f=await activeForkSource();try{
  const snapshot=f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer) as any;
  expect(snapshot.registration).toEqual(f.proposal.registration);expect(snapshot.application).toEqual(binding);expect(snapshot.source).toMatchObject({authorityId:'authority',owner:f.owner,sessionId:'session',dependencies:[]});
  expect(()=>f.composition.public.invoke('completion.read-goal-fork-source' as any,{...forkQuery,sessionId:'foreign'},peer)).toThrow(/session/);
  expect(()=>f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,{...peer,uid:502})).toThrow();
  expect(()=>f.composition.public.invoke('completion.read-goal-fork-source' as any,{...forkQuery,profileId:'caller'},peer)).toThrow();
 }finally{f.close();}
});
it('fork copies all actual original obligations and dependency edges without inheriting old proof or satisfaction',async()=>{
 const f=await activeForkSource();try{
  const childProposal={...structuredClone(f.proposal),enrollment:{ownerKind:'goal',ownerId:'child',goalSessionId:'child-session',invocations:[]}};
  childProposal.registration.obligations[0].obligation.obligationId='child-original';
  const cp=await f.composition.public.invoke('completion.prepare-owner',childProposal,peer) as any;
  const child=await f.composition.public.invoke('completion.authorize-owner',{challengeId:cp.challengeId},peer) as any;
  const payload={owner:f.owner,child:child.owner};const authorization=f.composition.privateHost.authorityHost.issueAuthorization({owner:f.owner,method:'registerOwnerDependency',payload,requestSource:'user',principalId:json(peer),expiresAt:300000});
  f.composition.privateHost.authorityService.registerOwnerDependency(payload,{requestSource:'user',authorization});
  const snapshot=f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer) as any;expect(snapshot.source.dependencies).toEqual([child.owner]);
  const proposal=forkProposal(snapshot),prepared=await f.composition.public.invoke('completion.prepare-owner-request',{requestId:'fork-original',...proposal},peer) as any;
  const result=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challenge.challengeId},peer) as any;
  expect(result.owner.ownerId).toBe('forked');expect(f.composition.privateHost.authorityService.inspectOwner(result.owner)).toMatchObject({obligationCount:2,currentVerification:'needs_revalidation'});
  expect(f.database.prepare('SELECT child_key FROM verification_owner_dependencies WHERE parent_key=?').all(json(result.owner))).toEqual([{child_key:json(child.owner)}]);
  expect(f.database.prepare('SELECT count(*) n FROM obligation_attempts WHERE owner_key=?').get(json(result.owner))).toEqual({n:0});
 }finally{f.close();}
});
it('fork source fingerprints and original obligation bytes cannot be supplied as weaker caller definitions',async()=>{
 const f=await activeForkSource();try{
  const snapshot=f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer) as any;
  const changed=forkProposal(snapshot);changed.registration.obligations[0].obligation.predicateVersion='weaker';
  expect(()=>f.composition.public.invoke('completion.prepare-owner',changed,peer)).toThrow(/fork/);
  const forged=forkProposal(f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer));forged.registration.source.fork.registrationHash='b'.repeat(64);
  expect(()=>f.composition.public.invoke('completion.prepare-owner',forged,peer)).toThrow(/fork/);
 }finally{f.close();}
});
it.each(['append','application'] as const)('source %s during native fork approval rejects the original FINAL without target registration',async(mode)=>{
 const f=await activeForkSource();try{
  const snapshot=f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer),proposal=forkProposal(snapshot);
  const prepared=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any;
  f.setEnrollmentHook(async()=>{f.setEnrollmentHook(undefined);if(mode==='append'){
   const expanded=structuredClone(f.proposal),extra=structuredClone(expanded.registration.obligations[0]);extra.obligation.obligationId='extra';expanded.registration.obligations.push(extra);
   const p=await f.composition.public.invoke('completion.prepare-owner',expanded,peer) as any;await f.composition.public.invoke('completion.authorize-owner',{challengeId:p.challengeId},peer);
  }else{const p=f.authority.prepare({requestSource:'user',binding:{...binding,epoch:2}},peer);await f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal);}});
  await expect(f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},peer)).rejects.toThrow(/fork/);
  expect(f.database.prepare("SELECT count(*) n FROM verification_registered_owners WHERE json_extract(owner_key,'$.ownerId')='forked'").get()).toEqual({n:0});
 }finally{f.close();}
});
it('a committed fork can append its own obligations after the source evolves; recovery retains its original lineage',async()=>{
 const f=await activeForkSource();try{
  const snapshot=f.composition.public.invoke('completion.read-goal-fork-source' as any,forkQuery,peer),proposal=forkProposal(snapshot),request={requestId:'fork-original',...proposal};
  const p=await f.composition.public.invoke('completion.prepare-owner-request',request,peer) as any;await f.composition.public.invoke('completion.authorize-owner',{challengeId:p.challenge.challengeId},peer);
  const source=f.authority.prepare({requestSource:'user',binding:{...binding,epoch:2}},peer);await f.authority.authorize({requestSource:'user',challengeId:source.challengeId},peer,new AbortController().signal);
  const expanded=structuredClone(proposal),extra=structuredClone(expanded.registration.obligations[0]);extra.obligation.obligationId='extra';expanded.registration.obligations.push(extra);
  const next=await f.composition.public.invoke('completion.prepare-owner',expanded,peer) as any;const result=await f.composition.public.invoke('completion.authorize-owner',{challengeId:next.challengeId},peer) as any;
  expect(f.composition.privateHost.authorityService.inspectOwner(result.owner)?.obligationCount).toBe(2);expect(await f.composition.public.invoke('completion.recover-owner-request',request,peer)).toMatchObject({state:'committed'});
 }finally{f.close();}
});
it('reads and enrolls a fork through real signed socket transport, fixed operation routing and the original request client',async()=>{
 const {createControllerOperationRouting}=await import('../../../src/runtime/verification/controller-operation-routing.js');
 const {createOwnerEnrollmentClient}=await import('../../../src/runtime/verification/completion-client.js');
 const f=await activeForkSource(),keys=generateKeyPairSync('ed25519'),socketPath=join(f.root,'fork.sock');
 const unused=()=>{throw Error('unused');};
 const routing=createControllerOperationRouting({assertCurrent(){},async renew(){},completion:f.composition.public,
  publication:{prepare:unused,approve:unused,reconcile:unused,recoverExpired:unused,observeOwner:unused,readOwnerPayload:unused},verification:{prepare:unused,dispatch:unused},execution:{invoke:unused}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'forkepoch',privateKey:keys.privateKey,allowedUserIds:[peer.uid],acceptPeer:()=>peer,invoke:(method,payload,actualPeer,signal)=>routing.invoke(method,payload,actualPeer,signal)});
 const signed=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync:unused});
 try{
  const client=createOwnerEnrollmentClient(signed.completionTransport),source=await client.readGoalForkSource(forkQuery),request={requestId:'signed-fork',...forkProposal(source)};
  const prepared=await client.prepareRequest(request as any);expect(prepared.challenge.canonicalReview.registration.source).toEqual({kind:'new-owner',fork:source.source});
  expect((await client.authorize(prepared.challenge)).owner.ownerId).toBe('forked');expect((await client.recoverRequest(request as any)).state).toBe('committed');
  await expect(client.readGoalForkSource({...forkQuery,sessionId:'wrong'})).rejects.toThrow();
 }finally{signed.dispose();await server.close();f.close();}
});

async function forkMigration(f:Awaited<ReturnType<typeof activeForkSource>>){
 const {createMigrationMarkerJournal}=await import('../../../src/runtime/verification/migration-marker-journal.js');const token={};
 const migration=createMigrationMarkerJournal({root:join(f.root,'markers'),database:f.database,authorityId:'authority',assertCurrent(){},assertAuthorized(value){if(value!==token)throw Error('fixture-native-denied');}});
 const marker={version:1 as const,state:'pending' as const,authorityId:'authority',...f.owner,migrationId:'review-migration',sourceSessionId:'session',sourceStoreRevision:1,sourceSnapshotHash:H,migrationEpoch:1};
 migration.publishPending(marker,token);return {migration,marker,token};
}
it('pending migration blocks fork source and application registration just as original openOwner',async()=>{const f=await activeForkSource();try{
 await forkMigration(f);
 expect(()=>f.composition.public.invoke('completion.open-owner',{ownerKind:'goal',ownerId:'goal'},peer)).toThrow(/migration/);
 expect(()=>f.composition.public.invoke('completion.read-goal-fork-source',forkQuery,peer)).toThrow(/migration/);
 expect(()=>f.authority.prepare({requestSource:'user',binding:{...binding,epoch:2}},peer)).toThrow(/migration/);
}finally{f.close();}});
it('migration becoming pending during native fork approval blocks FINAL and writes no target receipt',async()=>{const f=await activeForkSource();try{
 const snapshot=f.composition.public.invoke('completion.read-goal-fork-source',forkQuery,peer),prepared:any=await f.composition.public.invoke('completion.prepare-owner',forkProposal(snapshot),peer);
 f.setEnrollmentHook(async()=>{f.setEnrollmentHook(undefined);await forkMigration(f);});
 await expect(f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},peer)).rejects.toThrow(/migration/);
 expect(f.database.prepare("SELECT count(*) n FROM owner_enrollment_goal_sessions WHERE goal_session_id='fork-session'").get()).toEqual({n:0});
}finally{f.close();}});
it('exact migrated publication permits fork read and enrollment after pending publication',async()=>{const f=await activeForkSource();try{
 const {migration,marker,token}=await forkMigration(f);migration.publishMigrated({...marker,state:'migrated',importReceiptHash:'b'.repeat(64)},token);
 expect(f.composition.public.invoke('completion.open-owner',{ownerKind:'goal',ownerId:'goal'},peer)).toMatchObject({owner:f.owner});
 const snapshot=f.composition.public.invoke('completion.read-goal-fork-source',forkQuery,peer),prepared:any=await f.composition.public.invoke('completion.prepare-owner',forkProposal(snapshot),peer);
 await expect(f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},peer)).resolves.toMatchObject({owner:{ownerId:'forked'}});
}finally{f.close();}});

async function enrolledLoop(f:Awaited<ReturnType<typeof fixture>>){
 const {createLoopApplicationBinding}=await import('../../../src/runtime/verification/loop-application-binding.js');
 const {loopHostSubjectOwner}=await import('../../../src/runtime/verification/loop-host-subject.js');
 const subject={kind:'loop-run' as const,loopId:'artifact-evidence-regression',runId:'loop-run',stage:null};
 const proposal={enrollment:{...loopHostSubjectOwner(subject),loopSubject:subject,invocations:[]},registration:structuredClone(f.proposal.registration)};
 const p=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any;
 const {owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:p.challengeId},peer) as any;
 const raw={version:1,kind:'loop',subject,candidateId:'original-batch',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,
 contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish original scan.',completionCriterion:'Verify the original complete report.'},
 body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original report.',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:0,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[]}};
 return {owner,proposal,raw,binding:createLoopApplicationBinding(raw),create:createLoopApplicationBinding};
}
it('binds a Loop candidate through original native registration and application without minting execution proof',async()=>{
 const f=await fixture();try{
  const loop=await enrolledLoop(f),request={requestSource:'user' as const,requestId:'loop-application',binding:loop.binding};
  const prepared=f.authority.prepareRequest(request as any,peer);
  expect(prepared.challenge.canonicalReview).toMatchObject({owner:loop.owner,binding:loop.binding});
  const result=await f.authority.authorize({requestSource:'user',challengeId:prepared.challenge.challengeId},peer,new AbortController().signal);
  expect(result).toMatchObject({state:'active',current:{binding:loop.binding,revision:1}});
  expect(f.authority.recoverRequest(request as any,peer)).toMatchObject({state:'committed',observation:result});
  expect(f.composition.privateHost.authorityService.inspectOwner(loop.owner)?.currentVerification).toBe('needs_revalidation');
  expect(()=>f.authority.prepare({requestSource:'user',binding:loop.create({...loop.raw,body:{...loop.raw.body,summary:'changed'}})} as any,peer)).toThrow(/epoch/);
  const next=loop.create({...loop.raw,candidateId:'next-batch',candidateRevision:2,body:{...loop.raw.body,summary:'Next report.'}});
  const p=f.authority.prepare({requestSource:'user',binding:next} as any,peer);await f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal);
  expect(f.authority.inspect({ownerKind:'loop',ownerId:loop.owner.ownerId} as any,peer)).toMatchObject({current:{binding:next,revision:2}});
 }finally{f.close();}
});
it('keeps Goal and Loop application challenges independent for the exact same ownerId string',async()=>{
 const f=await fixture();try{
  const loop=await enrolledLoop(f),proposal={enrollment:{ownerKind:'goal',ownerId:loop.owner.ownerId,goalSessionId:'collision-session',invocations:[]},registration:structuredClone(f.proposal.registration)};
  const enrollment=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any;await f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},peer);
  const goal={...binding,goalId:loop.owner.ownerId,sessionId:'collision-session'};
  const g=f.authority.prepare({requestSource:'user',binding:goal},peer),l=f.authority.prepare({requestSource:'user',binding:loop.binding} as any,peer);
  expect(g.challengeId).not.toBe(l.challengeId);
  await f.authority.authorize({requestSource:'user',challengeId:g.challengeId},peer,new AbortController().signal);
  await f.authority.authorize({requestSource:'user',challengeId:l.challengeId},peer,new AbortController().signal);
  expect(f.authority.inspect({ownerKind:'goal',ownerId:loop.owner.ownerId},peer)).toMatchObject({current:{binding:goal}});
  expect(f.authority.inspect({ownerKind:'loop',ownerId:loop.owner.ownerId} as any,peer)).toMatchObject({current:{binding:loop.binding}});
 }finally{f.close();}
});
it('leaves an approved Loop application pending on FINAL failure and recovers original request without native replay',async()=>{
 const f=await fixture();try{
  const loop=await enrolledLoop(f),request={requestSource:'user' as const,requestId:'loop-pending',binding:loop.binding},p=f.authority.prepareRequest(request as any,peer);
  f.database.exec("CREATE TRIGGER reject_loop_binding BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'loop disk failure'); END");
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challenge.challengeId},peer,new AbortController().signal)).rejects.toThrow('loop disk failure');
  expect(f.authority.lookupRequest(request as any,peer)).toMatchObject({state:'pending',challengePhase:'approved',observation:{state:'pending',pendingTarget:loop.binding}});
  f.database.exec('DROP TRIGGER reject_loop_binding');const next=createApplicationBindingAuthority(f.options);
  try{expect(next.recoverRequest(request as any,peer)).toMatchObject({state:'committed',observation:{current:{binding:loop.binding}}});expect(f.approvals()).toBe(1);}finally{next.close();}
 }finally{f.close();}
});
it('rechecks the Loop original subject receipt after native wait and denies wrong-source prepare',async()=>{
 const f=await fixture();try{
  const loop=await enrolledLoop(f);expect(()=>f.authority.prepare({requestSource:'agent',binding:loop.binding} as any,peer)).toThrow(/source/);
  const p=f.authority.prepare({requestSource:'user',binding:loop.binding} as any,peer);
  f.setHook(async()=>{f.database.exec('DELETE FROM owner_enrollment_loop_subjects');});
  await expect(f.authority.authorize({requestSource:'user',challengeId:p.challengeId},peer,new AbortController().signal)).rejects.toThrow(/loop_subject_receipt/);
  expect(f.composition.privateHost.authorityHost.inspectApplication(loop.owner).state).toBe('unbound');
 }finally{f.close();}
});

it.each(['prepare','prepareRequest','lookupRequest','recoverRequest'])('rejects raw symbols and nested Proxy before real authority %s side effects',async method=>{
 for(const mode of ['root-symbol','binding-symbol','nested-symbol','extra-proxy']){
  const f=await fixture();let traps=0;
  try{const raw:any={requestSource:'user',binding:structuredClone(binding),...(method==='prepare'?{}:{requestId:'strict-request'})};
   if(mode==='root-symbol')raw[Symbol('approval')]=true;
   else if(mode==='binding-symbol')raw.binding[Symbol('approval')]=true;
   else if(mode==='nested-symbol')raw.binding.expectedEvidenceKinds[Symbol('approval')]=true;
   else raw.extra=new Proxy({},{ownKeys(){traps++;throw Error('authority proxy trap');}});
   expect(()=>((f.authority as any)[method])(raw,peer)).toThrow();expect(traps).toBe(0);expect(f.approvals()).toBe(0);
   expect(f.database.prepare('SELECT count(*) n FROM goal_application_challenges').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM goal_application_requests').get()).toEqual({n:0});
  }finally{f.close();}
 }
});
it.each(['application.prepare','application.prepareRequest','application.lookupRequest','application.recoverRequest'])('fixed routing rejects raw data before renew/native/real authority: %s',async method=>{
 for(const mode of ['root-symbol','binding-symbol','nested-symbol','extra-proxy']){
  const f=await fixture();let renews=0,traps=0;
  try{const routing=createControllerApplicationRouting({application:f.authority,assertCurrent(){},async renew(){renews++;}}),raw:any={requestSource:'user',binding:structuredClone(binding),...(method==='application.prepare'?{}:{requestId:'strict-request'})};
   if(mode==='root-symbol')raw[Symbol('approval')]=true;else if(mode==='binding-symbol')raw.binding[Symbol('approval')]=true;else if(mode==='nested-symbol')raw.binding.expectedEvidenceKinds[Symbol('approval')]=true;else raw.extra=new Proxy({},{ownKeys(){traps++;throw Error('routing proxy trap');}});
   await expect(routing.invoke(method,raw,peer,new AbortController().signal)).rejects.toThrow();expect(traps).toBe(0);expect(renews).toBe(0);expect(f.approvals()).toBe(0);expect(f.database.prepare('SELECT count(*) n FROM goal_application_challenges').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM goal_application_requests').get()).toEqual({n:0});
  }finally{f.close();}
 }
});
it('signed application client retains original caller payload before its real identity round trip',async()=>{
 const f=await fixture(),keys=generateKeyPairSync('ed25519'),socketPath=join(f.root,'retained-client.sock');let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),routing=createControllerApplicationRouting({application:f.authority,assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[peer.uid],acceptPeer:()=>peer,invoke:(method,payload,p,signal)=>routing.invoke(method,payload,p,signal)});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(bytes,signal){if(JSON.parse(bytes.toString()).method==='controller.identity'){entered();await gate;}return callControllerIpc(socketPath,bytes,{signal});},roundTripSync(){throw Error('unused');}});
 try{const raw={requestSource:'user',requestId:'retained-request',binding:structuredClone(binding)},pending=client.applicationTransport.call('application.prepareRequest',raw);await ready;raw.binding.objective='later caller mutation';release();const result:any=await pending;expect(result.challenge.canonicalReview.binding.objective).toBe(binding.objective);expect(f.approvals()).toBe(0);}finally{release();client.dispose();await server.close();f.close();}
});
