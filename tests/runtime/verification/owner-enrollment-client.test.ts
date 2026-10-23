import {it,expect,vi} from 'vitest';
import {createOwnerEnrollmentClient} from '../../../src/runtime/verification/completion-client.js';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const recipe={kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]};
const proposal={enrollment:{ownerKind:'task' as const,ownerId:'任务',invocations:[{sessionIdentity:'s',compoundOperationId:'c',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:createHash('sha256').update(json(recipe)).digest('hex'),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner'}}};
function review(){return {version:1,purpose:'completion-owner-enrollment',authorityId:'authority',challengeId:'challenge',principal:{uid:501,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',auditSessionId:7},profileSlot:'default',...proposal,deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}};}
it('binds the reviewed original request and uses a private local challenge on authorization',async()=>{
 let response:unknown={challengeId:'challenge',canonicalReview:review()};const call=vi.fn(async()=>response),client=createOwnerEnrollmentClient({call,callSync:()=>{throw Error('unused');}});
 const prepared=await client.prepare(proposal as any);expect(call).toHaveBeenLastCalledWith('completion.prepare-owner',proposal,undefined);
 await expect(client.authorize({...prepared})).rejects.toThrow(/challenge/);
 response={owner:{profileId:'p',ownerKind:'task',ownerId:'任务'},readGrant:{id:'read',secret:'a'.repeat(64)}};
 const result=await client.authorize(prepared);expect(result.owner.ownerId).toBe('任务');expect(call).toHaveBeenLastCalledWith('completion.authorize-owner',{challengeId:'challenge'},undefined);
 await expect(client.authorize(prepared)).rejects.toThrow(/challenge/);
});
it('rejects changed reviews and owner response rebinding and never retries a consumed approval',async()=>{
 let response:unknown={challengeId:'challenge',canonicalReview:{...review(),enrollment:{...proposal.enrollment,ownerId:'other'}}};const call=vi.fn(async()=>response),client=createOwnerEnrollmentClient({call,callSync:()=>null});
 await expect(client.prepare(proposal as any)).rejects.toThrow(/binding/);
 response={challengeId:'challenge',canonicalReview:review()};const prepared=await client.prepare(proposal as any);
 response={owner:{profileId:'p',ownerKind:'task',ownerId:'other'},readGrant:{id:'read',secret:'a'.repeat(64)}};await expect(client.authorize(prepared)).rejects.toThrow(/binding/);
 await expect(client.authorize(prepared)).rejects.toThrow(/challenge/);
});
it('opens a registered owner without accepting a caller-selected profile or changing its kind',async()=>{
 const {openCompletionClient}=await import('../../../src/runtime/verification/completion-client.js');
 let response:any={owner:{profileId:'actual',ownerKind:'task',ownerId:'任务'},readGrant:{id:'read',secret:'a'.repeat(64)}};const call=vi.fn(async()=>response),transport={call,callSync:()=>null};
 await openCompletionClient({ownerKind:'task',ownerId:'任务',transport});expect(call).toHaveBeenLastCalledWith('completion.open-owner',{ownerKind:'task',ownerId:'任务'},undefined);
 response={...response,owner:{...response.owner,ownerKind:'goal'}};await expect(openCompletionClient({ownerKind:'task',ownerId:'任务',transport})).rejects.toThrow(/binding/);
});
it('opens read access synchronously using only the read-only installed methods',async()=>{
 const {openCompletionClientSync}=await import('../../../src/runtime/verification/completion-client.js');const owner={profileId:'actual',ownerKind:'task' as const,ownerId:'one'};
 const callSync=vi.fn((method:string)=>method==='completion.open-owner'?{owner,readGrant:{id:'read',secret:'a'.repeat(64)}}:{owner,migrationEpoch:1,businessRevision:0,obligationSetRevision:1,obligationSetHash:'a'.repeat(64),obligationCount:1,currentVerification:'needs_revalidation'});
 const client=openCompletionClientSync({ownerKind:'task',ownerId:'one',transport:{call:async()=>null,callSync}});expect(client.inspectSync().currentVerification).toBe('needs_revalidation');expect(callSync).toHaveBeenNthCalledWith(1,'completion.open-owner',{ownerKind:'task',ownerId:'one'});
});
it('request duplicates, lookup and copied recovery challenges never regain fixed-client native tickets',async()=>{
 const challenge={challengeId:'challenge',canonicalReview:review()},request={requestId:'original',...proposal};
 let response:unknown={created:true,challenge};const call=vi.fn(async()=>response),client=createOwnerEnrollmentClient({call,callSync:()=>null});
 const first=await client.prepareRequest(request as any);
 response={created:false,challenge};const duplicate=await client.prepareRequest(request as any);
 await expect(client.authorize(duplicate.challenge)).rejects.toThrow(/challenge/);
 response={state:'mapped',challenge};const found=await client.lookupRequest(request as any);expect(found.state).toBe('mapped');
 await expect(client.authorize((found as any).challenge)).rejects.toThrow(/challenge/);
 await expect(client.authorize({...first.challenge})).rejects.toThrow(/challenge/);
 response={state:'not_approved',challenge};const retired=await client.recoverRequest(request as any);expect(retired.state).toBe('not_approved');
 call.mockRejectedValueOnce(Error('enrollment_challenge_consumed'));
 await expect(client.authorize(first.challenge)).rejects.toThrow(/consumed/);await expect(client.authorize(first.challenge)).rejects.toThrow(/challenge/);
});
it('strict recovery response accepts only terminal facts matching the full original enrollment',async()=>{
 const request={requestId:'original',...proposal};let response:unknown={state:'absent'};const client=createOwnerEnrollmentClient({call:async()=>response,callSync:()=>null});
 await expect(client.recoverRequest(request as any)).rejects.toThrow(/recovery/);
 response={state:'not_prepared',readGrant:{id:'fake'}};await expect(client.recoverRequest(request as any)).rejects.toThrow();
 response={state:'committed',owner:{profileId:'p',ownerKind:'task',ownerId:'other'},challenge:{challengeId:'challenge',canonicalReview:review()}};
 await expect(client.recoverRequest(request as any)).rejects.toThrow(/binding/);
});
it('binds fork reads to the original session and validates the full returned definition without issuing a native ticket',async()=>{
 const {goalApplicationBindingHash}=await import('../../../src/runtime/verification/goal-application-binding.js');
 const {goalRegistrationHash}=await import('../../../src/runtime/verification/owner-enrollment-review.js');
 const application={version:1 as const,kind:'goal' as const,goalId:'original',sessionId:'session',epoch:1,objective:'original',completionCriterion:null,expectedEvidenceKinds:['answer' as const]};
 const query={ownerKind:'goal' as const,ownerId:'original',sessionId:'session'},registration=structuredClone(proposal.registration);
 const source={authorityId:'authority',owner:{profileId:'profile',ownerKind:'goal',ownerId:'original'},sessionId:'session',applicationHash:goalApplicationBindingHash(application),registrationHash:goalRegistrationHash(registration as any),obligationSetHash:'b'.repeat(64),dependencies:[]};
 let response:any={source,registration,application};const call=vi.fn(async()=>response),client=createOwnerEnrollmentClient({call,callSync:()=>null});
 const result=await client.readGoalForkSource(query);expect(call).toHaveBeenCalledWith('completion.read-goal-fork-source',query,undefined);expect(Object.isFrozen(result.registration.obligations)).toBe(true);await expect(client.authorize(result)).rejects.toThrow(/challenge/);
 response={...response,source:{...source,sessionId:'foreign'}};await expect(client.readGoalForkSource(query)).rejects.toThrow(/binding/);
 response={source,registration:{...registration,obligations:[]},application};await expect(client.readGoalForkSource(query)).rejects.toThrow();
 await expect(client.readGoalForkSource({...query,profileId:'caller'} as any)).rejects.toThrow();
});
