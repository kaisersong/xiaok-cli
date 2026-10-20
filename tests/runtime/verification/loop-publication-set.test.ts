import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';
import {createLoopApplicationBinding,type LoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex'),signal=()=>new AbortController().signal;
type Fixture=Awaited<ReturnType<typeof verifiedOperationFixture>>;
async function addStage(f:Fixture,runId='loop-run'){
 const old=f.composition.privateHost.authorityHost.inspectApplication(f.owner).current!.binding as LoopApplicationBinding;
 const subject={...old.subject,runId,stage:{stageId:'scan-'+runId,stageKind:'scan' as const}},requested=loopHostSubjectOwner(subject);
 const invocation={sessionIdentity:'stage-'+runId,compoundOperationId:'original',validationInvocationId:'original'};
 const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes'}]};
 const obligation={obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']};
 const registration={migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}};
 const enrollment=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...requested,loopSubject:subject,invocations:[]},registration},f.peer) as any;
 const {owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},f.peer) as any;
 const {triggerHash:_,contractHash:__,candidatePayloadHash:___,...base}=old;
 const binding=createLoopApplicationBinding({...base,subject,candidateId:'stage-'+runId});
 const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
 try{const challenge=application.prepare({requestSource:'user',binding},f.peer);await application.authorize({requestSource:'user',challengeId:challenge.challengeId},f.peer,signal());}finally{application.close();}
 const append=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...requested,invocations:[invocation]},registration},f.peer) as any;
 await f.composition.public.invoke('completion.authorize-owner',{challengeId:append.challengeId},f.peer);
 const input=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal());
 const grant=await f.material.authorize(input.challengeId,f.peer,signal()),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal());
 const prepared=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal());
 await f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal());
 return owner;
}
for(const mode of ['current','expired','different-run','duplicate','not-published','transition','guard-write','nonoverlap','guard-ddl','late-transition','closed','abort','wrong-peer'] as const)it(`checks original Loop publications together at one authority clock: ${mode}`,async()=>{
 const f=await verifiedOperationFixture('loop-application');let queries=0,expireAt:number|undefined,lateTransition=false;
 const receiver=await loopPublicationReceiver(f,{afterQuery(){if((expireAt!==undefined||lateTransition)&&++queries===2){if(expireAt!==undefined)f.setTime(expireAt);if(lateTransition){const active=f.composition.privateHost.authorityHost.inspectApplication(f.owner).current!;const {triggerHash:_,contractHash:__,candidatePayloadHash:___,...base}=active.binding as LoopApplicationBinding;const binding=createLoopApplicationBinding({...base,candidateId:'next',candidateRevision:2});f.composition.privateHost.authorityHost.beginApplicationTransition({owner:f.owner,transitionId:'replacement',previousBindingHash:active.bindingHash,binding,registrationHash:'a'.repeat(64)});}}}});
 try{
  if(mode==='nonoverlap')f.setTime(2000);
  const other=await addStage(f,mode==='different-run'?'another-run':'loop-run');
  const owners=[f.owner,other].map(({ownerKind,ownerId})=>({ownerKind,ownerId}));
  for(const owner of mode==='not-published'?[owners[0]]:owners){const c=receiver.publication.prepare({...owner,requestSource:'user'},f.peer);await receiver.publication.approve({challengeId:c.challengeId},f.peer,signal());}
  if(mode==='expired')f.setTime(10000);
  if(mode==='nonoverlap')expireAt=JSON.parse((f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE owner_key=?').get(json(f.owner)) as {tuple_json:string}).tuple_json).validUntil;
  if(mode==='duplicate')owners[1]=owners[0];
  if(mode==='transition')f.database.prepare("UPDATE verification_application_pointers SET pending_id='pending' WHERE owner_key=?").run(json(f.owner));
  if(mode==='guard-write'||mode==='guard-ddl'){let calls=0;
   const row=f.database.prepare('SELECT facts_json FROM obligation_attempts WHERE owner_key=?').get(json(f.owner)) as {facts_json:string},facts=JSON.parse(row.facts_json),before=f.database.prepare('SELECT * FROM verification_scope_guards').all();
   expect(()=>f.composition.privateHost.authorityHost.registerScopeGuard({owner:f.owner,scopeId:facts.requiredScopeId,revision:facts.scopeRevision},()=>{calls++;if(mode==='guard-ddl')f.database.exec('CREATE TABLE guard_ddl(id INTEGER)');else f.database.prepare('UPDATE verification_owners SET business_revision=business_revision WHERE owner_key=?').run(json(other));})).toThrow('scope_guard_brand');expect(calls).toBe(0);expect(f.database.prepare('SELECT * FROM verification_scope_guards').all()).toEqual(before);
  }
  if(mode==='late-transition')lateTransition=true;
  if(mode==='closed')await receiver.publication.close();
  const abort=new AbortController();if(mode==='abort')abort.abort();
  const observe=async()=>receiver.publication.observeLoopSet({owners},mode==='wrong-peer'?{...f.peer,uid:502}:f.peer,abort.signal);
  if(mode==='current'||mode==='guard-write'||mode==='guard-ddl'){
   const result=await observe();expect(result.clock.domainId).toBe('clock');expect(result.publications).toHaveLength(2);
   expect(result.publications.map(p=>p.owner)).toEqual([f.owner,other]);expect(Object.isFrozen(result.publications[0].application.binding)).toBe(true);
   expect(receiver.approvals).toBe(2);
  }else{await expect(observe()).rejects.toThrow();if(mode==='nonoverlap'){expect(queries).toBe(2);expect(f.composition.privateHost.authorityService.inspectOwner(other)?.currentVerification).toBe('valid');}}
 }finally{await receiver.close();await f.close();}
}, 18_000);
