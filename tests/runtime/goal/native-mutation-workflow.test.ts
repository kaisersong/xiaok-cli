import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const leaf=vi.hoisted(()=>({call:vi.fn(),route:undefined as any,dispose:vi.fn()}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:leaf.call,callSync(){throw Error('unused');}},applicationTransport:{call:leaf.call},dispose:leaf.dispose})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>leaf.route}));
import { GoalService } from '../../../src/runtime/goal/service.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { FileGoalNativeJournal } from '../../../src/runtime/goal/native-mutation-journal.js';
import { createGoalNativeMutationWorkflow } from '../../../src/runtime/goal/native-mutation-workflow.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});beforeEach(()=>{leaf.call.mockReset();leaf.dispose.mockReset();});
const definition={version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};}
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'goal-native-flow-'));roots.push(root);const store=new InMemoryGoalStore(),journal=new FileGoalNativeJournal(root),ownership={assertOwned(){}};
 const service=new GoalService({store,nativeJournal:journal,ownership,now:()=>10});
 const row=await service.reserveNativeMutation({sessionId:'session',instanceId:'instance',requestSource:'user',expectedRevision:null},{kind:'create',input:{objective:'original',expectedEvidenceKinds:['file_artifact']},definition});
 const owner={profileId:'profile',ownerKind:'goal',ownerId:row.target.goalId};leaf.route={kind:'protected-unregistered',authorityId:'authority',owner};
 const base={version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}};
 let enrollment:any,application:any;let enrolled=false,bound=false;let admission=true;
 const observation=()=>({state:'active',current:{binding:row.target,bindingHash:goalApplicationBindingHash(row.target),revision:1},pendingTransitionId:null});
 async function transport(method:string,payload:any):Promise<any>{
  if(method==='completion.prepare-owner-request'){expect(journal.load('session')[0].status).toBe('enrolling');const {requestId,...proposal}=payload;expect(requestId).toBe(row.enrollmentRequestId);expect(proposal.enrollment).toEqual({ownerKind:'goal',ownerId:row.target.goalId,goalSessionId:'session',invocations:[]});enrollment={challengeId:'enroll',canonicalReview:{...base,purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}};return {created:true,challenge:enrollment};}
  if(method==='completion.authorize-owner'){expect(payload).toEqual({challengeId:'enroll'});enrolled=true;return {owner,readGrant:{id:'read',secret:'a'.repeat(64)}};}
  if(method==='completion.recover-owner-request')return enrolled?{state:'committed',owner,challenge:enrollment}:enrollment?{state:'not_approved',challenge:enrollment}:{state:'not_prepared'};
  if(method==='application.prepareRequest'){expect(journal.load('session')[0].status).toBe('binding');expect(payload.requestId).toBe(row.applicationRequestId);application={challengeId:'apply',alreadyCommitted:false,canonicalReview:{...base,purpose:'completion-application-binding',challengeId:'apply',requestSource:'user',owner,registrationHash:'a'.repeat(64),previousBindingHash:null,binding:row.target,bindingHash:goalApplicationBindingHash(row.target)}};return {created:true,challenge:application};}
  if(method==='application.authorize'){bound=true;return observation();}
  if(method==='application.recoverRequest')return bound?{state:'committed',challengePhase:'committed',challenge:{...application,alreadyCommitted:true},observation:{...observation(),pendingTarget:null}}:application?{state:'not_approved',challengePhase:'not_approved',challenge:application}:{state:'not_prepared'};
  throw Error(`unexpected ${method}`);
 }
 leaf.call.mockImplementation(transport);
 const options={store,journal,ownership,now:()=>20,assertAdmission(){if(!admission)throw Error('host closed');}};
 const workflow=createGoalNativeMutationWorkflow(options),input={sessionId:'session',mutationId:row.id,instanceId:'instance',requestSource:'user' as const,action:'advance' as const};
 return {root,store,journal,service,row,options,workflow,input,transport,close(){admission=false;},get enrolled(){return enrolled;}};
}
describe.skipIf(process.platform==='win32')('native Goal workflow with real fixed clients and leaf transport fixtures',()=>{
 it('persists original stages before both native calls and records ready without activating the Goal',async()=>{const f=await fixture();expect((await f.workflow.run(f.input)).status).toBe('ready');expect(await f.store.load('session')).toBeNull();expect(leaf.call.mock.calls.map(c=>c[0])).toEqual(['completion.prepare-owner-request','completion.authorize-owner','completion.recover-owner-request','application.prepareRequest','application.authorize','application.recoverRequest']);});
 it.each(['completion.prepare-owner-request','completion.authorize-owner','application.prepareRequest','application.authorize'])('recovers lost %s reply after reopening journal without repeating original native',async(method)=>{
  const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m===method)throw Error('reply lost');return result;});await expect(f.workflow.run(f.input)).rejects.toThrow('reply lost');
  leaf.call.mockImplementation(f.transport);const before=leaf.call.mock.calls.filter(c=>String(c[0]).includes('authorize')).length;
  const restarted=createGoalNativeMutationWorkflow({...f.options,journal:new FileGoalNativeJournal(f.root)});const recovered=await restarted.run({...f.input,requestSource:'scheduler',action:'recover'});
  expect(leaf.call.mock.calls.filter(c=>String(c[0]).includes('authorize'))).toHaveLength(before);
  expect(recovered.status).toBe(method==='completion.authorize-owner'?'enrolled':method==='application.authorize'?'ready':'retired');expect(await f.store.load('session')).toBeNull();
 });
 it('requires explicit user advance to start application after recovered enrollment',async()=>{
  const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner')throw Error('lost');return result;});await expect(f.workflow.run(f.input)).rejects.toThrow();leaf.call.mockImplementation(f.transport);
  expect((await f.workflow.run({...f.input,action:'recover',requestSource:'scheduler'})).status).toBe('enrolled');expect((await f.workflow.run({...f.input,action:'recover',requestSource:'scheduler'})).status).toBe('enrolled');
  expect(leaf.call.mock.calls.filter(c=>c[0]==='application.prepareRequest')).toHaveLength(0);expect((await f.workflow.run(f.input)).status).toBe('ready');
 });
 it.each(['agent','scheduler'])('rejects %s native advance before transport',async(requestSource)=>{const f=await fixture();await expect(f.workflow.run({...f.input,requestSource} as any)).rejects.toThrow(/source/);expect(leaf.call).not.toHaveBeenCalled();});
 it('does not call native after host revocation while prepare awaits and later recovery retires original',async()=>{
  const f=await fixture(),entered=deferred<void>(),release=deferred<void>();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});const running=f.workflow.run(f.input);await entered.promise;f.close();release.resolve();await expect(running).rejects.toThrow('host closed');expect(f.enrolled).toBe(false);
  leaf.call.mockImplementation(f.transport);expect((await f.workflow.run({...f.input,requestSource:'scheduler',action:'recover'})).status).toBe('retired');
 });
 it('leaves late enrollment commit as history and never starts application after original Goal basis changed',async()=>{
  const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner'){const route=leaf.route;leaf.route={kind:'ordinary'};try{await f.service.create({sessionId:'session',instanceId:'instance',requestSource:'user',expectedRevision:null},{objective:'concurrent',expectedEvidenceKinds:['answer']});}finally{leaf.route=route;}}return result;});expect((await f.workflow.run(f.input)).status).toBe('stale');expect(f.journal.load('session')[0].status).toBe('stale');expect(leaf.call.mock.calls.some(c=>c[0]==='application.prepareRequest')).toBe(false);expect((await f.store.load('session'))?.state.objective).toBe('concurrent');
 });
 it('does not reopen tickets for duplicate prepared requests',async()=>{const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);return m==='completion.prepare-owner-request'?{...result,created:false}:result;});expect((await f.workflow.run(f.input)).status).toBe('retired');expect(f.enrolled).toBe(false);});
 it('competing advance calls cannot prepare or authorize the same request twice',async()=>{
  const f=await fixture();const results=await Promise.allSettled([f.workflow.run(f.input),createGoalNativeMutationWorkflow(f.options).run(f.input)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.prepare-owner-request')).toHaveLength(1);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(1);
 });
 it('rejects asynchronous admission without opening a native request',async()=>{
  const f=await fixture(),workflow=createGoalNativeMutationWorkflow({...f.options,assertAdmission:async()=>{}});await expect(workflow.run(f.input)).rejects.toThrow('goal_native_admission_sync');expect(leaf.call).not.toHaveBeenCalled();expect(f.journal.load('session')[0].status).toBe('reserved');
 });
 it('a committed application reply for a different current target cannot produce ready',async()=>{
  const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='application.recoverRequest'){const binding={...f.row.target,epoch:2};result.observation.current={binding,bindingHash:goalApplicationBindingHash(binding),revision:2};}return result;});expect((await f.workflow.run(f.input)).status).toBe('stale');expect(await f.store.load('session')).toBeNull();
 });
 it('losing original ownership after prepare prevents native authorization',async()=>{
  const f=await fixture();let owned=true;const workflow=createGoalNativeMutationWorkflow({...f.options,ownership:{assertOwned(){if(!owned)throw Error('owner lost');}}});leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request')owned=false;return result;});await expect(workflow.run(f.input)).rejects.toThrow('owner lost');expect(f.enrolled).toBe(false);expect(f.journal.load('session')[0].status).toBe('enrolling');
 });

});
