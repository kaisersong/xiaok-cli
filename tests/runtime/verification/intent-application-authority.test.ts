import {authorizeOwnerEnrollment} from '../../../src/runtime/verification/owner-enrollment-authorization.js';
import {afterEach,expect,it} from 'vitest';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {goalVerificationRegistration} from '../../../src/runtime/goal/verification-definition.js';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7},hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();});
async function fixture(large=false){
 const root=mkdtempSync(join(tmpdir(),'intent-application-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});let approvals=0,hook:(()=>void)|undefined;
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),resolvePrincipal=(p:typeof peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const});
 const composition=createVerificationCompletionComposition({root,database,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}},enrollment:{resolvePrincipal,approve:async(r:any)=>authorizeOwnerEnrollment(r,{authorityId:'authority',allowedUserIds:[peer.uid],signal:new AbortController().signal,clock,resolveAccount:async()=>'11111111-AAAA-BBBB-CCCC-555555555555',approve:async({reviewBytes})=>hash(reviewBytes)}),profilePublication:createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}})},recipePorts:{assertFailedRunComplete(){throw Error('unused');},assertCurrent(){},async readArtifact(){return Buffer.from('原文');},async runBlackbox(){throw Error('unused');},async readFailedRun(){throw Error('unused');}}});
 const raw=structuredClone(intentApplicationCandidate());if(large){raw.contract.normalizedIntent=randomBytes(42000).toString('base64');raw.body.summary=randomBytes(42000).toString('base64');}const contract=raw.contract;let owner:any;
 for(const stageId of [...contract.stages.map((s:any)=>s.stageId),null]){const subject={...raw.subject,stageId},proposal={enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract},invocations:[]},registration:goalVerificationRegistration(stageId===null?contract.verification:contract.stages.find((s:any)=>s.stageId===stageId).verification)};
 const challenge:any=await composition.public.invoke('completion.prepare-owner',proposal,peer),result:any=await composition.public.invoke('completion.authorize-owner',{challengeId:challenge.challengeId},peer);if(stageId===raw.subject.stageId)owner=result.owner;}
 const authority=createApplicationBindingAuthority({database,authorityId:'authority',completion:composition,clock,assertCurrent(){},resolvePrincipal,async approve(review){approvals++;hook?.();return {uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
 cleanups.push(()=>{authority.close();composition.close();database.close();rmSync(root,{recursive:true,force:true});});
 return {root,raw,database,composition,authority,owner,approvals:()=>approvals,hook:(h:typeof hook)=>hook=h};
}
it('binds a real original native Intent stage contract and preserves needs_revalidation',async()=>{
 const f=await fixture(),binding=createIntentApplicationBinding(f.raw),prepared=f.authority.prepare({requestSource:'user',binding} as any,peer);
 const actual=await f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal);
 expect(actual).toMatchObject({state:'active',current:{binding,revision:1}});expect(f.approvals()).toBe(1);
 expect(f.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).toBe('needs_revalidation');
 const request={requestSource:'user' as const,requestId:'original-active-request',binding};const duplicate=f.authority.prepareRequest(request as any,peer);expect(duplicate.created).toBe(true);
 expect(f.authority.recoverRequest({...request,requestSource:'scheduler'} as any,peer).state).toBe('committed');expect(f.approvals()).toBe(1);
});
it('refuses changing the original contract even before the first application binding',async()=>{
 const f=await fixture(),raw=structuredClone(f.raw);raw.contract.rawIntent+=' changed';
 expect(()=>f.authority.prepare({requestSource:'user',binding:createIntentApplicationBinding(raw)} as any,peer)).toThrow(/contract/);expect(f.approvals()).toBe(0);
});
it('a later candidate revision cannot replace the original business contract',async()=>{
 const f=await fixture(),binding=createIntentApplicationBinding(f.raw),prepared=f.authority.prepare({requestSource:'user',binding} as any,peer);await f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal);
 const raw=structuredClone(f.raw);raw.candidateRevision=2;raw.contract.explicitConstraints.push('changed');
 expect(()=>f.authority.prepare({requestSource:'user',binding:createIntentApplicationBinding(raw)} as any,peer)).toThrow(/contract/);expect(f.approvals()).toBe(1);
});
it('rechecks original complete graph after native before the actual application transition',async()=>{
 const f=await fixture(),prepared=f.authority.prepare({requestSource:'user',binding:createIntentApplicationBinding(f.raw)} as any,peer);
 f.hook(()=>{f.database.prepare("UPDATE mandatory_observation_checks SET definition_json='{}' WHERE owner_key<>?").run(json(f.owner));});
 await expect(f.authority.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal)).rejects.toThrow();
 expect(f.composition.privateHost.authorityHost.inspectApplication(f.owner).state).toBe('unbound');
});
it('actual authority refuses a hidden candidate field before the native challenge exists',async()=>{
 const f=await fixture(),binding:any=structuredClone(createIntentApplicationBinding(f.raw));binding.body[Symbol('hidden-authority')]=true;
 expect(()=>f.authority.prepare({requestSource:'user',binding},peer)).toThrow();expect(f.approvals()).toBe(0);
 expect(f.database.prepare('SELECT count(*) n FROM goal_application_challenges').get()).toEqual({n:0});
});

import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it.each([false,true])('actual signed socket/router preserves complete Intent contract and recovery without native replay; large=%s',async large=>{
 const f=await fixture(large),keys=generateKeyPairSync('ed25519'),socketPath=join(f.root,'application.sock'),router=createControllerApplicationRouting({application:f.authority,assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:keys.privateKey,allowedUserIds:[peer.uid],acceptPeer:()=>peer,invoke:(method,payload,p,signal)=>router.invoke(method,payload,p,signal)});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync(){throw Error('unused');}});
 try{const binding=createIntentApplicationBinding(f.raw);if(large)expect(Buffer.byteLength(json(binding))).toBeGreaterThan(100000);const request={requestSource:'user',requestId:'signed-intent-original',binding},prepared:any=await client.applicationTransport.call('application.prepareRequest',request);
 expect(prepared).toMatchObject({created:true,challenge:{canonicalReview:{binding}}});
 await client.applicationTransport.call('application.authorize',{requestSource:'user',challengeId:prepared.challenge.challengeId});
 expect(await client.applicationTransport.call('application.recoverRequest',{...request,requestSource:'scheduler'})).toMatchObject({state:'committed',observation:{state:'active',current:{binding}}});
 expect(await client.applicationTransport.call('application.inspect',intentHostSubjectOwner(binding.subject))).toMatchObject({state:'active',current:{binding}});
 expect(f.approvals()).toBe(1);await expect(client.applicationTransport.call('application.authorize',{requestSource:'user',challengeId:prepared.challenge.challengeId})).rejects.toThrow();expect(f.approvals()).toBe(1);
 }finally{client.dispose();await server.close();}
});
it('actual application cannot cycle A1 to B2 to the identical A1 binding during a publisher observation',async()=>{
 const f=await fixture(),a=createIntentApplicationBinding(f.raw),signal=new AbortController().signal;
 const first=f.authority.prepare({requestSource:'user',binding:a},peer);await f.authority.authorize({requestSource:'user',challengeId:first.challengeId},peer,signal);
 const raw=structuredClone(f.raw);raw.candidateRevision=2;raw.candidateId='candidate-B';const b=createIntentApplicationBinding(raw),second=f.authority.prepare({requestSource:'user',binding:b},peer);await f.authority.authorize({requestSource:'user',challengeId:second.challengeId},peer,signal);
 expect(()=>f.authority.prepare({requestSource:'user',binding:a},peer)).toThrow('application_operation_epoch');
 const thirdRaw=structuredClone(f.raw);thirdRaw.candidateRevision=3;const a3=createIntentApplicationBinding(thirdRaw),third=f.authority.prepare({requestSource:'user',binding:a3},peer);await f.authority.authorize({requestSource:'user',challengeId:third.challengeId},peer,signal);
 const current=f.composition.privateHost.authorityHost.inspectApplication(f.owner);expect(current.current?.binding).toEqual(a3);expect(current.current?.binding).not.toEqual(a);expect(current.current?.revision).toBe(3);expect(f.approvals()).toBe(3);
});
