import Database from 'better-sqlite3';
import {withIntentSqlParsingContext} from '../../../src/runtime/verification/intent-sql-parsing-context.js';
import {afterEach,expect,it} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createCompletionBoundary} from '../../../src/runtime/verification/completion-boundary.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createOwnerEnrollmentAuthority} from '../../../src/runtime/verification/owner-enrollment-authority.js';
import {authorizeOwnerEnrollment} from '../../../src/runtime/verification/owner-enrollment-authorization.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {parseIntentBusinessContract} from '../../../src/runtime/verification/intent-business-contract.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {goalVerificationRegistration} from '../../../src/runtime/goal/verification-definition.js';
const H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7},account='11111111-AAAA-BBBB-CCCC-555555555555';
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
const definition=()=>({version:1,obligations:[{obligationId:'original',predicateId:'original-content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.md',sha256:H,structure:'utf8'}]}}]});
function contract(){const result=createIntentPlan({instanceId:'host',sessionId:'actual-session',input:'请写报告，然后生成幻灯片',skills:[]});if(result.kind!=='plan')throw Error('fixture');const {instanceId,continuationMode,steps,...plan}=result.plan;return parseIntentBusinessContract({version:1,...plan,verification:definition(),stages:plan.stages.map(stage=>({...stage,steps:stage.steps.map(({status,...step})=>step),verification:definition()}))});}
function fixture(publishHook?:(database:ReturnType<typeof openPrivateVerificationDatabase>)=>void,options?:{trace:(sql:string)=>void}){
 const root=mkdtempSync(join(tmpdir(),'intent-enrollment-')),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');let database=options?new Database(join(root,'authority.sqlite'),{verbose:options.trace}):openPrivateVerificationDatabase(root);const observations={clock:0,principal:0,qualified:0};mkdirSync(markers,{mode:0o755});let approvals=0,hook:((review:any)=>void|Promise<void>)|undefined;
 const clock=()=>{observations.clock++;return {domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H};};
 const makeCompletion=()=>createCompletionBoundary({root,database,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified:()=>{observations.qualified++;},quiescence:{assertQuiescent:()=>{}}}});
 let completion=makeCompletion();
 const makeAuthority=()=>createOwnerEnrollmentAuthority({database,completion,authorityId:'authority',clock,profilePublication:(()=>{const publisher=createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent:()=>{}});return {...publisher,publish(index:any){publisher.publish(index);publishHook?.(database);}};})(),resolvePrincipal:p=>{observations.principal++;return {...p,accountGeneration:account,source:'macos-local-generateduid'};},approve:async review=>{approvals++;await hook?.(review);return authorizeOwnerEnrollment(review,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock,resolveAccount:async()=>account,approve:async({reviewBytes})=>createHash('sha256').update(reviewBytes).digest('hex')});}});
 let authority=makeAuthority();
 cleanups.push(()=>{authority.close();completion.close();database.close();rmSync(root,{recursive:true,force:true});});
 const value=contract(),subject=(stageId:string|null)=>({version:1 as const,sessionId:value.sessionId,intentId:value.intentId,stageId});
 const proposal=(stageId:string|null)=>({enrollment:{...intentHostSubjectOwner(subject(stageId)),intentContract:{subject:subject(stageId),contract:value},invocations:[]},registration:goalVerificationRegistration(stageId===null?value.verification:value.stages.find(s=>s.stageId===stageId)!.verification)});
 async function enroll(stageId:string|null){const p=proposal(stageId),r=authority.prepare(p as any,peer);return authority.authorize(r.challengeId,peer,new AbortController().signal);}
 return{root,observations,get database(){return database;},get completion(){return completion;},get authority(){return authority;},reopen(){authority.close();completion.close();database.close();database=openPrivateVerificationDatabase(root);completion=makeCompletion();authority=makeAuthority();},value,subject,proposal,enroll,approvals:()=>approvals,hook:(next:typeof hook)=>hook=next};
}
it('real native enrollment commits exact predecessor and parent edges while every proof remains unsatisfied',async()=>{
 const f=fixture();expect(f.value.stages).toHaveLength(2);const first=await f.enroll(f.value.stages[0].stageId),second=await f.enroll(f.value.stages[1].stageId),parent=await f.enroll(null);
 expect(f.approvals()).toBe(3);expect(f.completion.authority.service.inspectOwner(first.owner)).toMatchObject({obligationCount:1,currentVerification:'needs_revalidation'});expect(f.completion.authority.service.inspectOwner(second.owner)).toMatchObject({obligationCount:2,currentVerification:'needs_revalidation'});expect(f.completion.authority.service.inspectOwner(parent.owner)).toMatchObject({obligationCount:3,currentVerification:'needs_revalidation'});
 const edges=f.database.prepare('SELECT parent_key,child_key FROM verification_owner_dependencies ORDER BY parent_key,child_key').all();expect(edges).toHaveLength(3);
 const read=(f.authority as any).readIntentApplicationRegistration(parent.owner,peer,f.subject(null));expect(read.contract).toEqual(f.value);expect(read.owner).toEqual(parent.owner);
 expect(f.database.prepare('SELECT count(*) n FROM verification_registered_invocations').get()).toEqual({n:0});
});
it('refuses a missing real predecessor or incomplete parent without opening native approval',()=>{
 const f=fixture();expect(()=>f.authority.prepare(f.proposal(f.value.stages[1].stageId) as any,peer)).toThrow();expect(()=>f.authority.prepare(f.proposal(null) as any,peer)).toThrow();expect(f.approvals()).toBe(0);
});
it('denies generic native enrollment of a reserved intent identity without an original contract receipt',()=>{
 const f=fixture(),original=f.proposal(f.value.stages[0].stageId);const {intentContract,...rest}=original.enrollment;
 expect(()=>f.authority.prepare({...original,enrollment:{...rest,invocations:[{sessionIdentity:'actual-session',compoundOperationId:'compound',validationInvocationId:'validation'}]}},peer)).toThrow();expect(f.approvals()).toBe(0);
});
it('requires all original contract obligations instead of accepting changed expected output',()=>{
 const f=fixture(),p:any=structuredClone(f.proposal(f.value.stages[0].stageId)),changed=definition();changed.obligations[0].recipe.checks[0].sha256='b'.repeat(64);p.registration=goalVerificationRegistration(changed);
 expect(()=>f.authority.prepare(p,peer)).toThrow();expect(f.approvals()).toBe(0);
});
it('partial stage contract never opens material or recipe admission before the parent graph exists',async()=>{
 const f=fixture(),stage=await f.enroll(f.value.stages[0].stageId);
 expect(()=>f.authority.openOwner({ownerKind:stage.owner.ownerKind,ownerId:stage.owner.ownerId},peer)).toThrow();
 expect(()=>f.authority.readApprovedRecipe(stage.owner,'original')).toThrow();
 const p=f.proposal(f.value.stages[0].stageId),{intentContract,...enrollment}=p.enrollment;
 expect(()=>f.authority.prepare({...p,enrollment:{...enrollment,invocations:[{sessionIdentity:f.value.sessionId,compoundOperationId:'actual-operation',validationInvocationId:'actual-validation'}]}},peer)).toThrow();
 expect(f.approvals()).toBe(1);
});
it('later real invocation resolves the exact same owner only after the full original native graph',async()=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);await f.enroll(f.value.stages[1].stageId);await f.enroll(null);
 const p=f.proposal(f.value.stages[0].stageId),{intentContract,...enrollment}=p.enrollment,invocation={sessionIdentity:f.value.sessionId,compoundOperationId:'actual-operation',validationInvocationId:'actual-validation'};
 const prepared=f.authority.prepare({...p,enrollment:{...enrollment,invocations:[invocation]}},peer),result=await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal);
 expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(result.owner));expect(()=>f.authority.resolveOwnerKey({...peer,uid:502},invocation)).toThrow();
 expect(()=>f.authority.resolveOwnerKey(peer,{...invocation,validationInvocationId:'foreign'})).toThrow();expect(f.approvals()).toBe(4);
});
it('a changed actual predecessor during native approval cannot commit the next stage',async()=>{
 const f=fixture(),first=await f.enroll(f.value.stages[0].stageId);f.hook(()=>{f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}' WHERE owner_key=?").run(json(first.owner));});
 await expect(f.enroll(f.value.stages[1].stageId)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:1});
});
it('request lookup preserves the original committed native fact and does not repeat approval',async()=>{
 const f=fixture(),request={requestId:'original-request',...f.proposal(f.value.stages[0].stageId)};
 const prepared=f.authority.prepareRequest(request as any,peer);await f.authority.authorize(prepared.challenge.challengeId,peer,new AbortController().signal);
 const recovered=f.authority.recoverRequest(request as any,peer);expect(recovered.state).toBe('committed');expect(f.approvals()).toBe(1);
});
it('a SQLite tail trigger which rewrites a dependency rolls back the current enrollment',async()=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);
 f.database.exec("CREATE TRIGGER corrupt_intent_edge AFTER UPDATE OF state ON verification_registered_owners WHEN NEW.state='active' BEGIN DELETE FROM verification_owner_dependencies; END");
 await expect(f.enroll(f.value.stages[1].stageId)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:1});
});

it('true SQLite close and reopen reads the original completed graph and does not repeat native approval',async()=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);await f.enroll(f.value.stages[1].stageId);const parent=await f.enroll(null);
 const before=f.authority.readIntentContract(f.subject(null),peer);f.reopen();
 expect(f.authority.readIntentContract(f.subject(null),peer)).toEqual(before);expect(f.approvals()).toBe(3);
 expect(f.authority.openOwner({ownerKind:'intent',ownerId:parent.owner.ownerId},peer).owner).toEqual(parent.owner);
});
it('rejects nested symbol and accessor contract input before any native or challenge row',()=>{
 const f=fixture(),p:any=structuredClone(f.proposal(f.value.stages[0].stageId));let reads=0;
 p.enrollment.intentContract.contract[Symbol('hidden')]=true;
 expect(()=>f.authority.prepare(p,peer)).toThrow();delete p.enrollment.intentContract.contract[Object.getOwnPropertySymbols(p.enrollment.intentContract.contract)[0]];
 Object.defineProperty(p.enrollment.intentContract.contract,'rawIntent',{get(){reads++;return 'changed';},enumerable:true});
 expect(()=>f.authority.prepare(p,peer)).toThrow();expect(reads).toBe(0);expect(f.approvals()).toBe(0);
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
});

import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {encodeControllerResponse} from '../../../src/runtime/verification/controller-response.js';
import {createOwnerEnrollmentClient} from '../../../src/runtime/verification/completion-client.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
function composedFixture(){
 const root=mkdtempSync(join(tmpdir(),'intent-composition-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});let approvals=0,onQualified:(()=>void)|undefined;
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H});
 const composition=createVerificationCompletionComposition({root,database,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){onQualified?.();},quiescence:{assertQuiescent(){}}},enrollment:{profilePublication:createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}}),resolvePrincipal:p=>({...p,accountGeneration:account,source:'macos-local-generateduid'}),async approve(review){approvals++;return authorizeOwnerEnrollment(review,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock,resolveAccount:async()=>account,approve:async({reviewBytes})=>createHash('sha256').update(reviewBytes).digest('hex')});}},recipePorts:{assertCurrent(){},async readArtifact(){throw Error('unused');},async runBlackbox(){throw Error('unused');},async readFailedRun(){throw Error('unused');},assertFailedRunComplete(){throw Error('unused');}}});
 const unused=()=>{throw Error('unexpected sibling');},router=createControllerOperationRouting({assertCurrent(){},async renew(){},completion:composition.public,verification:{prepare:unused,dispatch:unused},publication:{readOwnerPayload:unused,observeOwner:unused,recoverExpired:unused,prepare:unused,approve:unused,reconcile:unused},execution:{invoke:unused}});
 const transport=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTripSync:unused,async roundTrip(bytes){const request=JSON.parse(bytes.toString()),result=request.method==='controller.identity'?{serviceEpoch:'boot',requestTicket:H}:await router.invoke(request.method,request.payload,peer,new AbortController().signal);return encodeControllerResponse({domain:'xiaok.controller.response.v1',authorityId:'authority',serviceEpoch:'boot',nonce:request.nonce,method:request.method,requestHash:request.requestHash,result},keys.privateKey);}});
 const client=createOwnerEnrollmentClient(transport.completionTransport),value=contract(),subject=(stageId:string|null)=>({version:1 as const,sessionId:value.sessionId,intentId:value.intentId,stageId});
 async function enroll(stageId:string|null){const s=subject(stageId),request={requestId:`request-${stageId??'parent'}`,enrollment:{...intentHostSubjectOwner(s),intentContract:{subject:s,contract:value},invocations:[]},registration:goalVerificationRegistration(stageId===null?value.verification:value.stages.find(s=>s.stageId===stageId)!.verification)},prepared=await client.prepareRequest(request);await client.authorize(prepared.challenge);return client.recoverRequest(request);}
 cleanups.push(()=>{transport.dispose();composition.close();database.close();rmSync(root,{recursive:true,force:true});});return{database,composition,client,value,subject,enroll,approvals:()=>approvals,setQualified:(hook:typeof onQualified)=>onQualified=hook};
}
it('real signed controller and original router expose the committed contract without minting native replay',async()=>{
 const f=composedFixture();for(const s of f.value.stages)await f.enroll(s.stageId);await f.enroll(null);
 const observed=await f.client.readIntentContract({subject:f.subject(null)});expect(observed.contract).toEqual(f.value);expect(f.approvals()).toBe(3);expect(Object.isFrozen(observed.contract.stages)).toBe(true);
 await expect(f.client.authorize(observed as never)).rejects.toThrow();expect(f.approvals()).toBe(3);
 await expect(f.client.readIntentContract({subject:{...f.subject(null),intentId:'foreign'}})).rejects.toThrow();
});
it('actual composition enrollment wrapper refuses a qualification callback which changes graph facts on the final qualified read',async()=>{
 const f=composedFixture();for(const s of f.value.stages)await f.enroll(s.stageId);await f.enroll(null);
 let count=0;f.setQualified(()=>{count++;});f.composition.privateHost.enrollment.readIntentContract(f.subject(null),peer);const last=count;
 count=0;f.setQualified(()=>{if(++count===last)f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}'").run();});
 expect(()=>f.composition.privateHost.enrollment.readIntentContract(f.subject(null),peer)).toThrow();expect(count).toBe(last);
});
it('stage current reads fence the whole original parent graph, including a later sibling changed by the final qualified callback',async()=>{
 const f=composedFixture();for(const s of f.value.stages)await f.enroll(s.stageId);await f.enroll(null);
 const subject=f.subject(f.value.stages[0].stageId),sibling=intentHostSubjectOwner(f.subject(f.value.stages[1].stageId));let count=0;
 f.setQualified(()=>{count++;});f.composition.privateHost.enrollment.readIntentContract(subject,peer);const last=count;
 count=0;f.setQualified(()=>{if(++count===last)f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}' WHERE json_extract(owner_key,'$.ownerId')=?").run(sibling.ownerId);});
 expect(()=>f.composition.privateHost.enrollment.readIntentContract(subject,peer)).toThrow();
});
it('lost prepare reply is recoverable only as historical challenge; explicit new request obtains a new native approval',async()=>{
 const f=fixture(),request={requestId:'lost-prepare',...f.proposal(f.value.stages[0].stageId)},first=f.authority.prepareRequest(request as any,peer);
 expect(f.authority.lookupRequest(request as any,peer)).toMatchObject({state:'mapped',challenge:{challengeId:first.challenge.challengeId}});
 expect(f.authority.recoverRequest(request as any,peer).state).toBe('not_approved');
 await expect(f.authority.authorize(first.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();expect(f.approvals()).toBe(0);
 const fresh=f.authority.prepareRequest({...request,requestId:'explicit-user-retry'} as any,peer);expect(fresh.challenge.challengeId).not.toBe(first.challenge.challengeId);
 await f.authority.authorize(fresh.challenge.challengeId,peer,new AbortController().signal);expect(f.approvals()).toBe(1);
});
it('failed FINAL preserves pending contract but retries require a fresh native approval',async()=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);
 f.database.exec("CREATE TRIGGER fail_final BEFORE INSERT ON owner_enrollment_intent_contracts BEGIN SELECT RAISE(IGNORE); END");
 await expect(f.enroll(f.value.stages[1].stageId)).rejects.toThrow();expect(f.approvals()).toBe(2);
 f.database.exec('DROP TRIGGER fail_final');await f.enroll(f.value.stages[1].stageId);expect(f.approvals()).toBe(3);
 await f.enroll(null);expect(f.approvals()).toBe(4);expect(f.authority.readIntentContract(f.subject(null),peer).contract).toEqual(f.value);
});
it.each(['prepare','prepareRequest'] as const)('fixed signed client %s rejects hidden or executable contract input before any request',async method=>{
 const f=composedFixture(),subject=f.subject(f.value.stages[0].stageId),proposal:any={enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract:structuredClone(f.value)},invocations:[]},registration:goalVerificationRegistration(f.value.stages[0].verification)};
 if(method==='prepareRequest')proposal.requestId='malformed-contract';
 proposal.enrollment.intentContract.contract[Symbol('ignored')]='foreign';
 await expect(f.client[method](proposal)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
 delete proposal.enrollment.intentContract.contract[Object.getOwnPropertySymbols(proposal.enrollment.intentContract.contract)[0]];let reads=0;
 Object.defineProperty(proposal.enrollment.intentContract.contract,'rawIntent',{enumerable:true,get(){reads++;return 'different';}});
 await expect(f.client[method](proposal)).rejects.toThrow();expect(reads).toBe(0);expect(f.approvals()).toBe(0);
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
});
it('append FINAL cannot adopt sibling corruption caused by its own receipt write',async()=>{
 const f=fixture();for(const stage of f.value.stages)await f.enroll(stage.stageId);await f.enroll(null);
 const p=f.proposal(f.value.stages[0].stageId),{intentContract,...enrollment}=p.enrollment,sibling=intentHostSubjectOwner(f.subject(f.value.stages[1].stageId));
 f.database.exec(`CREATE TRIGGER sibling_at_receipt AFTER UPDATE ON owner_enrollment_intent_contracts BEGIN UPDATE mandatory_observation_checks SET definition_json='{}' WHERE json_extract(owner_key,'$.ownerId')='${sibling.ownerId}'; END`);
 const challenge=f.authority.prepare(p as any,peer);
 await expect(f.authority.authorize(challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
});
it('signed fixed contract read rejects subject symbols and getters before transport',async()=>{
 const f=composedFixture();for(const stage of f.value.stages)await f.enroll(stage.stageId);await f.enroll(null);const subject:any=f.subject(null);subject[Symbol('foreign')]=true;
 await expect(f.client.readIntentContract({subject})).rejects.toThrow();delete subject[Object.getOwnPropertySymbols(subject)[0]];let reads=0;
 Object.defineProperty(subject,'intentId',{get(){reads++;return f.value.intentId;},enumerable:true});
 await expect(f.client.readIntentContract({subject})).rejects.toThrow();expect(reads).toBe(0);
});
it.each(['business_revision','set_revision'] as const)('FINAL cannot adopt a receipt trigger change to its own %s',async field=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);
 f.database.exec(`CREATE TRIGGER own_at_receipt AFTER UPDATE ON owner_enrollment_intent_contracts BEGIN UPDATE verification_owners SET ${field}=${field}+100 WHERE owner_key=NEW.owner_key; END`);
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
});
it('legitimate explicit append preserves original contract and increments only the actual own obligation set',async()=>{
 const f=fixture();const first=await f.enroll(f.value.stages[0].stageId);await f.enroll(f.value.stages[1].stageId);const parent=await f.enroll(null);
 const proposal:any=structuredClone(f.proposal(f.value.stages[0].stageId)),additional=structuredClone(proposal.registration.obligations[0]);additional.obligation.obligationId='additional';proposal.registration.obligations.push(additional);
 const challenge=f.authority.prepare(proposal,peer);await f.authority.authorize(challenge.challengeId,peer,new AbortController().signal);
 expect(f.completion.authority.service.inspectOwner(first.owner)).toMatchObject({obligationCount:2,currentVerification:'needs_revalidation'});
 expect(f.completion.authority.service.inspectOwner(parent.owner)).toMatchObject({obligationCount:4,currentVerification:'needs_revalidation'});
 expect(f.authority.readIntentContract(f.subject(null),peer).contract).toEqual(f.value);expect(f.approvals()).toBe(4);
});
it('FINAL request row is derived before UPDATE and rejects a committed trigger which rewrites its immutable proposal',async()=>{
 const f=fixture(),request={requestId:'original-final-request',...f.proposal(f.value.stages[0].stageId)},prepared=f.authority.prepareRequest(request as any,peer);
 f.database.exec("CREATE TRIGGER corrupt_final_request AFTER UPDATE OF state ON owner_enrollment_requests WHEN NEW.state='committed' BEGIN UPDATE owner_enrollment_requests SET proposal_json='{}' WHERE request_id=NEW.request_id; END");
 await expect(f.authority.authorize(prepared.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:0});
});
it('native wait cannot rename the durable original request before FINAL captures its write basis',async()=>{
 const f=fixture(),request={requestId:'native-original-id',...f.proposal(f.value.stages[0].stageId)},prepared=f.authority.prepareRequest(request as any,peer);
 f.hook(()=>{f.database.prepare("UPDATE owner_enrollment_requests SET request_id='renamed-original-id' WHERE request_id=?").run(request.requestId);});
 await expect(f.authority.authorize(prepared.challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:0});
});
it('explicit same-contract native re-enrollment validates every already committed sibling before accepting a FINAL basis',async()=>{
 const f=fixture();for(const stage of f.value.stages)await f.enroll(stage.stageId);await f.enroll(null);const sibling=intentHostSubjectOwner(f.subject(f.value.stages[1].stageId));
 f.hook(()=>{f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}' WHERE json_extract(owner_key,'$.ownerId')=?").run(sibling.ownerId);});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
});
it.each(['business_revision','epoch','set_revision'] as const)('native wait cannot change its own original %s before a same-contract FINAL',async field=>{
 const f=fixture();const own=await f.enroll(f.value.stages[0].stageId);await f.enroll(f.value.stages[1].stageId);await f.enroll(null);
 f.hook(()=>{f.database.prepare(`UPDATE verification_owners SET ${field}=${field}+100 WHERE owner_key=?`).run(json(own.owner));});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
});

it('first fresh profile cannot adopt unrelated receipts inserted by the actual profile publication callback',async()=>{
 const f=fixture(db=>{const row=db.prepare('SELECT owner_key FROM verification_registered_owners').get() as {owner_key:string};db.prepare('INSERT OR IGNORE INTO owner_enrollment_goal_sessions VALUES(?,?,?,?)').run('foreign-receipt',row.owner_key,'foreign-session','{}');});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:0});
});
it('fresh profile publication cannot activate registry rows before the FINAL transaction',async()=>{
 const f=fixture(db=>{db.exec("UPDATE verification_profiles SET state='active';UPDATE verification_registered_owners SET state='active'");});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_intent_contracts').get()).toEqual({n:0});
});
it('reads the complete actual append-only registration for an original invocation without repeating the contract envelope',async()=>{
 const f=fixture();await f.enroll(f.value.stages[0].stageId);await f.enroll(f.value.stages[1].stageId);await f.enroll(null);
 const subject=f.subject(f.value.stages[0].stageId),original=f.proposal(subject.stageId),extended={...structuredClone(original),registration:{...structuredClone(original.registration),obligations:[...structuredClone(original.registration.obligations)]}};const additional=structuredClone(extended.registration.obligations[0]);additional.obligation.obligationId='additional';extended.registration.obligations.push(additional);
 const challenge=f.authority.prepare(extended,peer);await f.authority.authorize(challenge.challengeId,peer,new AbortController().signal);
 const current=(f.authority as any).readIntentRegistration(subject,peer);expect(current.registration).toEqual(extended.registration);expect(current.contract).toBeUndefined();expect(current.subject).toEqual(subject);expect(Object.isFrozen(current.registration.obligations)).toBe(true);
 const invocation={sessionIdentity:subject.sessionId,compoundOperationId:'actual-appended-operation',validationInvocationId:'actual-appended-validation'},proposal={enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:current.registration};
 const prepared=f.authority.prepare(proposal,peer),result=await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal);expect(f.authority.resolveOwnerKey(peer,invocation)).toBe(json(result.owner));expect(f.approvals()).toBe(5);
 expect(()=>(f.authority as any).readIntentRegistration(subject,{...peer,uid:502})).toThrow();
});
it('signed registration read preserves every current obligation and rejects partial original graphs',async()=>{
 const f=composedFixture(),subject=f.subject(f.value.stages[0].stageId);await f.enroll(subject.stageId);
 await expect((f.client as any).readIntentRegistration({subject})).rejects.toThrow();
 await f.enroll(f.value.stages[1].stageId);await f.enroll(null);
 const result=await (f.client as any).readIntentRegistration({subject});expect(result.registration).toEqual(goalVerificationRegistration(f.value.stages[0].verification));expect(result.subject).toEqual(subject);expect(result.contract).toBeUndefined();expect(f.approvals()).toBe(3);
 let getterReads=0;await expect((f.client as any).readIntentRegistration({get subject(){getterReads++;return subject;}})).rejects.toThrow();expect(getterReads).toBe(0);
});
it('registration read fences actual sibling graph mutations at the final qualification callback',async()=>{
 const f=composedFixture();for(const s of f.value.stages)await f.enroll(s.stageId);await f.enroll(null);const subject=f.subject(f.value.stages[0].stageId);let count=0;
 f.setQualified(()=>{count++;});f.composition.privateHost.enrollment.readIntentRegistration(subject,peer);const last=count;
 count=0;f.setQualified(()=>{if(++count===last)f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}'").run();});
 expect(()=>f.composition.privateHost.enrollment.readIntentRegistration(subject,peer)).toThrow();expect(count).toBe(last);
});
it('new registration parser rejects nested accessor and symbol metadata before serialization and binds every declared field',async()=>{
 const f=fixture();for(const s of f.value.stages)await f.enroll(s.stageId);await f.enroll(null);const actual=f.authority.readIntentRegistration(f.subject(null),peer),{parseIntentRegistrationObservation:parse}=await import('../../../src/runtime/verification/intent-contract-enrollment.js');expect(parse(actual)).toEqual(actual);
 for(const altered of [{...actual,owner:{...actual.owner,ownerId:'foreign'}},{...actual,registrationHash:'b'.repeat(64)},{...actual,extra:true},{...actual,contractHash:'invalid'}])expect(()=>parse(altered)).toThrow();
 let reads=0;const getter=structuredClone(actual);Object.defineProperty(getter.registration.obligations,'0',{get(){reads++;return actual.registration.obligations[0];},enumerable:true});expect(()=>parse(getter)).toThrow();expect(reads).toBe(0);
 const symbol=structuredClone(actual);Object.defineProperty(symbol.registration,Symbol('hidden'),{value:1});expect(()=>parse(symbol)).toThrow();
 const nonData=structuredClone(actual);Object.defineProperty(nonData.registration,'extra',{value:undefined});expect(()=>parse(nonData)).toThrow();
});

it.each(['own','sibling'] as const)('retains exact original contract row bytes through native FINAL: %s',async target=>{
 const f=fixture();const owners=[];for(const stage of f.value.stages)owners.push(await f.enroll(stage.stageId));await f.enroll(null);
 const key=json(owners[target==='own'?0:1]!.owner);
 f.hook(()=>{const row=f.database.prepare('SELECT contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(key) as {contract_json:string};f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(' '+row.contract_json,key);});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
});

it('keeps full original invocation rows in FINAL with several native-appended invocations',async()=>{
 const f=fixture();for(const stage of f.value.stages)await f.enroll(stage.stageId);await f.enroll(null);
 const p=f.proposal(f.value.stages[0].stageId),{intentContract,...enrollment}=p.enrollment;
 const invocations=['z','a','m'].map(k=>({sessionIdentity:f.value.sessionId,compoundOperationId:'operation-'+k,validationInvocationId:'validation-'+k}));
 for(const invocation of invocations){const prepared=f.authority.prepare({...p,enrollment:{...enrollment,invocations:[invocation]}},peer);await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal);}
 const before=f.database.prepare('SELECT * FROM verification_registered_invocations ORDER BY invocation_json').all();expect(before).toHaveLength(3);
 await f.enroll(f.value.stages[0].stageId);expect(f.database.prepare('SELECT * FROM verification_registered_invocations ORDER BY invocation_json').all()).toEqual(before);
 f.hook(()=>{f.database.prepare('UPDATE verification_registered_invocations SET invocation_json=? WHERE invocation_json=?').run(json({...invocations[0],validationInvocationId:'replacement'}),json(invocations[0]));});
 await expect(f.enroll(f.value.stages[0].stageId)).rejects.toThrow();
});

it.each(['parent','sibling','graph-outside'] as const)('R8 actual Intent stage fence includes full original contract and outside graph: %s',async target=>{const f=fixture(),first=await f.enroll(f.value.stages[0].stageId),sibling=await f.enroll(f.value.stages[1].stageId),parent=await f.enroll(null),outside={...first.owner,ownerKind:'task' as const,ownerId:'outside-original-intent'};f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(sibling.owner),json(outside));f.database.exec('DROP TABLE main.verification_application_history;CREATE TABLE main.verification_application_history(owner_key TEXT,future_value TEXT)');const changed=target==='parent'?parent.owner:target==='sibling'?sibling.owner:outside;f.database.prepare('INSERT INTO verification_application_history VALUES(?,?)').run(json(changed),'original');const fence=f.authority.captureRegistrationReadFence(first.owner);f.database.prepare('UPDATE verification_application_history SET future_value=? WHERE owner_key=?').run('changed',json(changed));expect(fence).toThrow('application_registration_changed');});


it('pure SQL reuse leaves actual unbranded SQL trace, complete read fences, callbacks and DML unchanged',async()=>{
 const trace:string[]=[],f=fixture(undefined,{trace:sql=>trace.push(sql)});for(const stage of f.value.stages)await f.enroll(stage.stageId);await f.enroll(null);
 const reset=()=>{trace.length=0;f.observations.clock=0;f.observations.principal=0;f.observations.qualified=0;};
 const changes=()=>((f.database.prepare('SELECT total_changes() AS count').get() as {count:number}).count);
 const before=changes();reset();const original=f.authority.readIntentContract(f.subject(null),peer),originalTrace=[...trace],originalCallbacks={...f.observations};const middle=changes();
 reset();const reused=withIntentSqlParsingContext(f.database,()=>f.authority.readIntentContract(f.subject(null),peer)),actualTrace=[...trace],actualCallbacks={...f.observations};const after=changes();
 expect(reused).toEqual(original);expect(actualTrace).toEqual(originalTrace);expect(actualCallbacks).toEqual(originalCallbacks);expect(actualCallbacks.clock).toBeGreaterThan(0);expect(actualCallbacks.principal).toBeGreaterThan(0);expect(middle-before).toBe(2);expect(after-middle).toBe(2);
 for(const table of ['verification_profiles','mandatory_observation_checks','verification_application_history','owner_enrollment_intent_contracts'])expect(originalTrace.filter(sql=>sql.includes('SELECT * FROM main.'+table)).length).toBeGreaterThanOrEqual(2);
});
