import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const leaf=vi.hoisted(()=>({call:vi.fn(),route:undefined as any}));
vi.mock('../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:leaf.call,callSync(){throw Error('unused');}},applicationTransport:{call:leaf.call},dispose(){}})}));
vi.mock('../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>leaf.route}));
import { CliGoalNativeHost, readGoalVerificationFile } from '../../src/commands/chat-goal-native.js';
import { FileGoalStore } from '../../src/runtime/goal/file-store.js';
import { FileGoalNativeJournal } from '../../src/runtime/goal/native-mutation-journal.js';
import { goalApplicationBindingHash } from '../../src/runtime/verification/goal-application-binding.js';
const roots:string[]=[];
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
beforeEach(()=>{leaf.call.mockReset();leaf.route={kind:'ordinary'};});
const definition={version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]};
function root(){const p=mkdtempSync(join(tmpdir(),'cli-goal-native-'));roots.push(p);return p;}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {resolve,promise};}
function fixture(){
 const path=root(),store=new FileGoalStore(path),journal=new FileGoalNativeJournal(path),ownership={assertOwned:vi.fn()};
 const host=new CliGoalNativeHost({store,journal,ownership,sessionId:'session',instanceId:'instance'});
 let enrolled=false,bound=false,enrollment:any,application:any;const methods:string[]=[];
 const owner=()=>({profileId:'profile',ownerKind:'goal',ownerId:enrollment?.canonicalReview.enrollment.ownerId??journal.load('session').at(-1)!.target.goalId});
 const base={version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}};
 const observation=()=>{const binding=application?.canonicalReview.binding??journal.load('session').at(-1)!.target;return {state:'active',current:{binding,bindingHash:goalApplicationBindingHash(binding),revision:1},pendingTransitionId:null,pendingTarget:null};};
 async function transport(method:string,payload:any){methods.push(method);
  if(method==='completion.prepare-owner-request'){const {requestId,...proposal}=payload;enrollment={challengeId:'enroll',canonicalReview:{...base,purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}};return {created:true,challenge:enrollment};}
  if(method==='completion.authorize-owner'){enrolled=true;leaf.route={kind:'protected-unregistered',authorityId:'authority',owner:owner()};return {owner:owner(),readGrant:{id:'read',secret:'a'.repeat(64)}};}
  if(method==='completion.recover-owner-request')return enrolled?{state:'committed',owner:owner(),challenge:enrollment}:enrollment?{state:'not_approved',challenge:enrollment}:{state:'not_prepared'};
  if(method==='application.prepareRequest'){application={challengeId:'apply',alreadyCommitted:false,canonicalReview:{...base,purpose:'completion-application-binding',challengeId:'apply',requestSource:'user',owner:owner(),registrationHash:'a'.repeat(64),previousBindingHash:null,binding:payload.binding,bindingHash:goalApplicationBindingHash(payload.binding)}};return {created:true,challenge:application};}
  if(method==='application.authorize'){bound=true;const {pendingTarget,...reply}=observation();return reply;}
  if(method==='application.recoverRequest')return bound?{state:'committed',challengePhase:'committed',challenge:{...application,alreadyCommitted:true},observation:observation()}:application?{state:'not_approved',challengePhase:'not_approved',challenge:application}:{state:'not_prepared'};
  if(method==='application.inspect')return observation();
  throw Error(`unexpected ${method}`);
 }
 leaf.call.mockImplementation(transport);
 return {host,path,store,journal,ownership,transport,methods};
}
const input={objective:'original',expectedEvidenceKinds:['file_artifact'] as const};
function create(f:ReturnType<typeof fixture>){return f.host.create('create',{...input,expectedEvidenceKinds:[...input.expectedEvidenceKinds]},definition);}
it('reads one bounded regular UTF8 file and freezes the original definition',()=>{
 const p=join(root(),'definition.json');writeFileSync(p,JSON.stringify(definition));const value=readGoalVerificationFile(p);writeFileSync(p,'{}');expect(value).toEqual(definition);expect(Object.isFrozen(value.obligations)).toBe(true);
 for(const bytes of [Buffer.from([0xff]),Buffer.alloc(65537,32),Buffer.from('{}')]){writeFileSync(p,bytes);expect(()=>readGoalVerificationFile(p)).toThrow();}
 const link=p+'.link';symlinkSync(p,link);expect(()=>readGoalVerificationFile(link)).toThrow();expect(()=>readGoalVerificationFile(root())).toThrow();
});
it('uses actual fixed clients and file store; native success only commits a disarmed cache',async()=>{
 const f=fixture(),result=await create(f);expect(result.goal?.objective).toBe('original');expect(result.mutation.status).toBe('applied');expect((await f.store.load('session'))?.state.turnsUsed).toBe(0);expect(f.methods.filter(m=>m.includes('authorize'))).toEqual(['completion.authorize-owner','application.authorize']);
});
it.each(['completion.prepare-owner-request','completion.authorize-owner','application.prepareRequest','application.authorize'])('reopens a lost %s reply without another authorization or implicit next phase',async(method)=>{
 const f=fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m===method)throw Error('lost');return result;});await expect(create(f)).rejects.toThrow('lost');
 const count=f.methods.filter(m=>m.includes('authorize')).length;leaf.call.mockImplementation(f.transport);
 const host=new CliGoalNativeHost({store:new FileGoalStore(f.path),journal:new FileGoalNativeJournal(f.path),ownership:f.ownership,sessionId:'session',instanceId:'next'});
 const result=await host.recover();expect(f.methods.filter(m=>m.includes('authorize'))).toHaveLength(count);
 expect(result.mutation.status).toBe(method==='completion.authorize-owner'?'enrolled':method==='application.authorize'?'applied':'retired');
 expect(result.goal?.turnsUsed??0).toBe(0);
 if(method==='completion.authorize-owner'){expect(f.methods).not.toContain('application.prepareRequest');expect((await host.continue()).mutation.status).toBe('applied');}
});
it('close invalidates original admission immediately and waits for actual work before draining',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});
 const work=create(f);await entered.promise;let drained=false;const close=f.host.close().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);await expect(create(f)).rejects.toThrow(/closed|busy/);release.resolve();await expect(work).rejects.toThrow();await close;expect(drained).toBe(true);expect(f.methods).not.toContain('completion.authorize-owner');expect(await f.store.load('session')).toBeNull();
});
it('physical close preserves an original held native client failure instead of accepting a matching abort message',async()=>{
 const f=fixture(),entered=deferred(),release=deferred(),failure=Error('goal_native_mutation_superseded');
 leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;throw failure;}return result;});
 const work=create(f);void work.catch(()=>{});await entered.promise;const closing=f.host.close();let settled=false;const physical=Promise.resolve().then(()=>f.host.waitForClosedResources());void physical.then(()=>settled=true,()=>settled=true);try{await Promise.resolve();expect(settled).toBe(false);}finally{release.resolve();}await expect(work).rejects.toBe(failure);await closing;await expect(physical).rejects.toMatchObject({errors:[failure]});
});
it('physical close retains an already settled original Goal native failure consumed by UI',async()=>{
 const f=fixture(),entered=deferred(),release=deferred(),failure=Error('goal_native_mutation_superseded');
 leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;throw failure;}return result;});
 const work=create(f);void work.catch(()=>{});await entered.promise;release.resolve();await expect(work).rejects.toBe(failure);await f.host.close();await expect(f.host.waitForClosedResources()).rejects.toMatchObject({errors:[failure]});
});
it('cancel remains callable during a held prepare, seals its draft and prevents late activation',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});
 const work=create(f);await entered.promise;expect((await f.host.cancel()).mutation.status).toBe('retired');release.resolve();await expect(work).rejects.toThrow();expect(await f.store.load('session')).toBeNull();expect(f.methods).not.toContain('completion.authorize-owner');
});
it('refuses a concurrent new mutation and resume admission while an original draft is pending',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});
 const work=create(f);await entered.promise;await expect(create(f)).rejects.toThrow(/busy|pending/);expect(()=>f.host.assertNoPending()).toThrow(/pending/);release.resolve();await work;expect(()=>f.host.assertNoPending()).not.toThrow();
});
it('native fork reserves the actual source definition without activation, then explicitly continues under a new owner',async()=>{
 const f=fixture();const original=await create(f),sourceState=original.goal!;
 const {goalRegistrationHash}=await import('../../src/runtime/verification/owner-enrollment-review.js');
 const {goalVerificationRegistration}=await import('../../src/runtime/goal/verification-definition.js');
 const binding=f.journal.load('session')[0].target,registration=goalVerificationRegistration(definition),owner=leaf.route.owner;
 const snapshot={source:{authorityId:'authority',owner,sessionId:'session',applicationHash:goalApplicationBindingHash(binding),registrationHash:goalRegistrationHash(registration),obligationSetHash:'b'.repeat(64),dependencies:[]},registration,application:binding};
 const originalTransport=f.transport;
 leaf.call.mockImplementation(async(m,p)=>m==='completion.read-goal-fork-source'?snapshot:originalTransport(m,p));
 const fork=new CliGoalNativeHost({store:f.store,journal:f.journal,ownership:f.ownership,sessionId:'fork-session',instanceId:'fork-instance'});
 const before=f.methods.length,result=await fork.reserveFork('session');expect(result.goal).toBeNull();expect(result.mutation.kind).toBe('fork');expect(result.mutation.status).toBe('reserved');expect(result.mutation.target.goalId).not.toBe(sourceState.goalId);expect(result.mutation.definition).toEqual(definition);expect(f.methods.length).toBe(before);expect(await f.store.load('fork-session')).toBeNull();expect(()=>fork.assertNoPending()).toThrow(/pending/);
 const {goalNativeCandidate,parseGoalNativeMutation}=await import('../../src/runtime/goal/native-mutation-journal.js');const weakened=structuredClone(result.mutation);(weakened.definition.obligations[0] as any).predicateVersion='weaker';expect(()=>parseGoalNativeMutation(weakened)).toThrow(/fork/);const changedApplication=structuredClone(result.mutation);(changedApplication.target as any).objective='different';expect(()=>parseGoalNativeMutation(changedApplication)).toThrow(/fork/);expect(goalNativeCandidate(result.mutation)).toMatchObject({forkedFromGoalId:sourceState.goalId,turnsUsed:0,tokensUsed:0,epoch:1,status:'active'});
 const committed=await fork.continue();expect(committed.mutation.status).toBe('applied');expect(committed.goal).toMatchObject({forkedFromGoalId:sourceState.goalId,sessionId:'fork-session',turnsUsed:0,tokensUsed:0,epoch:1});expect((await f.store.load('fork-session'))?.evidence).toEqual([]);expect((await f.store.load('session'))?.state).toEqual(sourceState);
 const extended=structuredClone(definition);extended.obligations.push({...structuredClone(extended.obligations[0]),obligationId:'additional'});const replaced=await fork.create('replace',{objective:'fork replacement',expectedEvidenceKinds:['file_artifact']},extended);expect(replaced.mutation.forkSource).toEqual(result.mutation.forkSource);expect(replaced.goal).toMatchObject({forkedFromGoalId:sourceState.goalId,epoch:2});
});
it('fork refuses a local source that differs from the authority application and never derives weaker obligations',async()=>{
 const f=fixture();await create(f);const fork=new CliGoalNativeHost({store:f.store,journal:f.journal,ownership:f.ownership,sessionId:'fork-session',instanceId:'fork-instance'});
 leaf.call.mockImplementation(async(m)=>{if(m==='completion.read-goal-fork-source')return {source:'forged'};throw Error('unexpected');});
 await expect(fork.reserveFork('session')).rejects.toThrow();expect(f.journal.load('fork-session')).toEqual([]);expect(await f.store.load('fork-session')).toBeNull();
});
