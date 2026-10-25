// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const leaf=vi.hoisted(()=>({call:vi.fn(),route:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:leaf.call,callSync(){throw Error('unused');}},applicationTransport:{call:leaf.call},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>leaf.route}));
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'unavailable'})}));
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { FileGoalNativeJournal } from '../../../src/runtime/goal/native-mutation-journal.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn();});beforeEach(()=>{leaf.call.mockReset();});
const definition={version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'main-native-goal-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const store=new SqliteGoalStore(join(root,'goals.db'));cleanups.push(()=>store.close());const journal=new FileGoalNativeJournal(root);
 let taskSequence=0; const host={prepareTask:vi.fn(async()=>({taskId:`task_${++taskSequence}`})),startTask:vi.fn(async()=>{}),cancelTask:vi.fn(async()=>{})};
 const options={store,nativeJournal:journal,taskHost:host,instanceId:'main',now:()=>10};const coordinator=new DesktopGoalCoordinator(options);cleanups.push(()=>coordinator.stopAccepting());
 let enrollment:any,application:any,enrolled=false,bound=false,remoteEpoch:number|undefined;const owner=()=>({profileId:'profile',ownerKind:'goal',ownerId:journal.load('thread')[0].target.goalId});leaf.route={kind:'unavailable',reason:'migration_authority_unavailable'};
 const base={version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}};
 const observation=()=>({state:'active',current:{binding:application.canonicalReview.binding,bindingHash:application.canonicalReview.bindingHash,revision:1},pendingTransitionId:null});
 async function transport(method:string,payload:any):Promise<any>{
  if(method==='completion.prepare-owner-request'){const {requestId,...proposal}=payload;enrollment={challengeId:'enroll',canonicalReview:{...base,purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}};return {created:true,challenge:enrollment};}
  if(method==='completion.authorize-owner'){enrolled=true;leaf.route={kind:'protected-unregistered',authorityId:'authority',owner:owner()};return {owner:owner(),readGrant:{id:'read',secret:'a'.repeat(64)}};}
  if(method==='completion.recover-owner-request')return enrolled?{state:'committed',owner:owner(),challenge:enrollment}:enrollment?{state:'not_approved',challenge:enrollment}:{state:'not_prepared'};
  if(method==='application.prepareRequest'){application={challengeId:'apply',alreadyCommitted:false,canonicalReview:{...base,purpose:'completion-application-binding',challengeId:'apply',requestSource:'user',owner:owner(),registrationHash:'a'.repeat(64),previousBindingHash:null,binding:payload.binding,bindingHash:goalApplicationBindingHash(payload.binding)}};return {created:true,challenge:application};}
  if(method==='application.authorize'){bound=true;remoteEpoch=undefined;return observation();}
  if(method==='application.recoverRequest')return bound?{state:'committed',challengePhase:'committed',challenge:{...application,alreadyCommitted:true},observation:{...observation(),pendingTarget:null}}:application?{state:'not_approved',challengePhase:'not_approved',challenge:application}:{state:'not_prepared'};
  if(method==='application.inspect'){const current=bound?observation():null;if(current&&remoteEpoch!==undefined){const binding={...current.current.binding,epoch:remoteEpoch};current.current={binding,bindingHash:goalApplicationBindingHash(binding),revision:remoteEpoch};}return current?{...current,pendingTarget:null}:{state:'unbound',current:null,pendingTransitionId:null,pendingTarget:null};}
  throw Error(`unexpected ${method}`);
 }
 leaf.call.mockImplementation(transport);const input={threadId:'thread',objective:'original',expectedEvidenceKinds:['file_artifact' as const],verificationDefinition:definition};
 return {root,store,journal,host,coordinator,options,input,transport,advanceRemote(epoch:number){remoteEpoch=epoch;},unbind(){bound=false;}};
}
it('first unregistered profile completes both native stages before preparing and requires exact attachment ack before SDK',async()=>{
 const f=fixture(),entered=deferred<void>(),release=deferred<void>();leaf.call.mockImplementation(async(m,p)=>{if(m==='completion.authorize-owner'){entered.resolve();await release.promise;}return f.transport(m,p);});const running=f.coordinator.createGoal(f.input);await entered.promise;expect(await f.store.load('thread')).toBeNull();expect(f.host.prepareTask).not.toHaveBeenCalled();expect(await f.coordinator.getGoalNativeMutation('thread')).toMatchObject({status:'enrolling'});release.resolve();const result=await running;expect(result.goal.activation).toBe('armed');expect(f.journal.load('thread')[0].status).toBe('applied');expect(f.host.startTask).not.toHaveBeenCalled();await f.coordinator.ackGoalTaskAttached({threadId:'thread',attachmentId:result.preparedTask.attachmentId});expect(f.host.startTask).toHaveBeenCalledTimes(1);
});
it('missing original definition fails closed before any native or Goal write',async()=>{const f=fixture();const {verificationDefinition,...input}=f.input;await expect(f.coordinator.createGoal(input)).rejects.toThrow(/definition/);expect(leaf.call).not.toHaveBeenCalled();expect(await f.store.load('thread')).toBeNull();});
it('cancel remains responsive before any Goal exists and late native reply cannot create or prepare',async()=>{
 const f=fixture(),entered=deferred<void>(),release=deferred<void>();leaf.call.mockImplementation(async(m,p)=>{if(m==='completion.authorize-owner'){entered.resolve();await release.promise;}return f.transport(m,p);});const running=f.coordinator.createGoal(f.input);void running.catch(()=>{});await entered.promise;expect(await f.coordinator.cancelGoalNativeMutation({threadId:'thread',requestSource:'user'})).toMatchObject({status:'retired'});release.resolve();await expect(running).rejects.toThrow();expect(await f.store.load('thread')).toBeNull();expect(f.host.prepareTask).not.toHaveBeenCalled();
});
it('shutdown census waits for the actual native operation and rejects late activation',async()=>{
 const f=fixture(),entered=deferred<void>(),release=deferred<void>();leaf.call.mockImplementation(async(m,p)=>{if(m==='application.authorize'){entered.resolve();await release.promise;}return f.transport(m,p);});const running=f.coordinator.createGoal(f.input);void running.catch(()=>{});await entered.promise;f.coordinator.stopAccepting();expect(await f.coordinator.drainShutdown(1)).toBe(false);release.resolve();await expect(running).rejects.toThrow();expect(await f.coordinator.drainShutdown(100)).toBe(true);expect(f.host.prepareTask).not.toHaveBeenCalled();expect(await f.store.load('thread')).toBeNull();
});
it('fresh application check at attachment acknowledgement blocks an application invalidated after cache commit',async()=>{const f=fixture(),result=await f.coordinator.createGoal(f.input);f.unbind();await expect(f.coordinator.ackGoalTaskAttached({threadId:'thread',attachmentId:result.preparedTask.attachmentId})).rejects.toThrow(/application/);expect(f.host.startTask).not.toHaveBeenCalled();});
it('restart recovers enrollment only; explicit user continue starts application and task preparation',async()=>{
 const f=fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner')throw Error('reply lost');return result;});await expect(f.coordinator.createGoal(f.input)).rejects.toThrow('reply lost');f.coordinator.stopAccepting();leaf.call.mockImplementation(f.transport);const restarted=new DesktopGoalCoordinator(f.options);cleanups.push(()=>restarted.stopAccepting());expect(await restarted.recoverGoalNativeMutation({threadId:'thread',requestSource:'user'})).toMatchObject({mutation:{status:'enrolled'},goal:null});expect(f.host.prepareTask).not.toHaveBeenCalled();const result=await restarted.continueGoalNativeMutation({threadId:'thread',requestSource:'user'});expect(result.goal.activation).toBe('armed');expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(1);
});
it('pause completes during a held ACK application read and stale ACK never starts the SDK',async()=>{
 const f=fixture(),created=await f.coordinator.createGoal(f.input),entered=deferred<void>(),release=deferred<void>();
 leaf.call.mockImplementation(async(m,p)=>{if(m==='application.inspect'){entered.resolve();await release.promise;}return f.transport(m,p);});
 const ack=f.coordinator.ackGoalTaskAttached({threadId:'thread',attachmentId:created.preparedTask.attachmentId});void ack.catch(()=>{});await entered.promise;
 let paused=false;const pause=f.coordinator.pauseGoal({threadId:'thread'}).then(()=>{paused=true;});
 try{await vi.waitFor(()=>expect(paused).toBe(true),{timeout:500});}finally{release.resolve();await pause;}
 await expect(ack).rejects.toThrow();expect(f.host.startTask).not.toHaveBeenCalled();
});

it('replacement observes an already advanced remote epoch before reserving the next immutable target',async()=>{
 const f=fixture();await f.coordinator.createGoal(f.input);await f.coordinator.pauseGoal({threadId:'thread'});f.advanceRemote(9);
 const result=await f.coordinator.replaceGoal({...f.input,objective:'replacement'});expect(result.goal.state.epoch).toBe(10);expect(f.journal.load('thread')[1].target.epoch).toBe(10);expect(result.goal.activation).toBe('armed');
});
it('pending replacement cannot be bypassed by resume or ordinary user task admission',async()=>{
 const f=fixture();await f.coordinator.createGoal(f.input);await f.coordinator.pauseGoal({threadId:'thread'});
 const entered=deferred<void>(),release=deferred<void>();leaf.call.mockImplementation(async(m,p)=>{if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return f.transport(m,p);});
 const replacement=f.coordinator.replaceGoal({...f.input,objective:'replacement'});void replacement.catch(()=>{});await entered.promise;
 try{await expect(f.coordinator.resumeGoal({threadId:'thread'})).rejects.toThrow(/native_mutation_pending/);await expect(f.coordinator.admitUserTask({input:'bypass',context:{threadId:'thread'}} as any)).rejects.toThrow(/native_mutation_pending/);expect(f.host.startTask).not.toHaveBeenCalled();}
 finally{await f.coordinator.cancelGoalNativeMutation({threadId:'thread',requestSource:'user'});release.resolve();await replacement.catch(()=>{});}
});
it('native cancel after local activation also retires the pending attachment task',async()=>{
 const f=fixture(),created=await f.coordinator.createGoal(f.input);expect(f.host.cancelTask).not.toHaveBeenCalled();await f.coordinator.cancelGoalNativeMutation({threadId:'thread',requestSource:'user'});expect(f.host.cancelTask).toHaveBeenCalledWith(created.preparedTask.taskId,'goal_native_cancelled');expect(f.host.startTask).not.toHaveBeenCalled();
});
it.each(['stop','disarm','permission'].flatMap(kind=>['create','recover'].map(mode=>({kind,mode}))))('native $mode projection rechecks $kind at the actual SQLite commit boundary',async ({kind,mode})=>{
 const f=fixture();let permission=1;
 (f.options as any).multiAgent={getExecutionAuthorization:()=>({permissionRevision:permission}),assertExecutionAdmission(_thread:string,expected:number){if(expected!==permission)throw Error('permission_changed');},async assertThreadAdmission(){},async goalReadiness(){return {ready:true};}};
 const original=f.store.commit.bind(f.store);
 const write=vi.spyOn(f.store,'commit');
 if(mode==='recover'){write.mockRejectedValueOnce(Error('cache gap'));await expect(f.coordinator.createGoal(f.input)).rejects.toThrow('cache gap');expect(f.journal.load('thread')[0].status).toBe('ready');}
 write.mockImplementation(async input=>{
  if(kind==='stop')f.coordinator.stopAccepting();else if(kind==='disarm')f.coordinator.disarmAll();else permission++;
  return original(input);
 });
 await expect(mode==='create'?f.coordinator.createGoal(f.input):f.coordinator.recoverGoalNativeMutation({threadId:'thread',requestSource:'user'})).rejects.toThrow();
 expect(await f.store.load('thread')).toBeNull();expect(f.host.prepareTask).not.toHaveBeenCalled();
});

it('ordinary thread compatibility does not weaken explicit native APIs or hide valid-ID corruption',async()=>{
 const f=fixture(),threadId='\u0001'.repeat(256);
 await expect(f.coordinator.getGoalNativeMutation(threadId)).rejects.toThrow('goal_native_journal_id');
 await expect(f.coordinator.continueGoalNativeMutation({threadId,requestSource:'user'})).rejects.toThrow('goal_native_journal_id');
 await expect(f.coordinator.recoverGoalNativeMutation({threadId,requestSource:'user'})).rejects.toThrow('goal_native_journal_id');
 await expect(f.coordinator.cancelGoalNativeMutation({threadId,requestSource:'user'})).rejects.toThrow('goal_native_journal_id');
 const read=vi.spyOn(f.journal,'load').mockImplementation(()=>{throw Error('actual_journal_corruption');});
 await expect(f.coordinator.admitUserTask({input:'ordinary',context:{threadId:'legal-thread'}} as any)).rejects.toThrow('actual_journal_corruption');expect(read).toHaveBeenCalledWith('legal-thread');expect(f.host.startTask).not.toHaveBeenCalled();
});
