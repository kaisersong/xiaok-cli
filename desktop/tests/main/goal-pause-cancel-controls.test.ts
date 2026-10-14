// @vitest-environment node
// R32 source-before candidate: imports only existing real production registrar/services/coordinator.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/goal-pause-cancel',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:()=>{}},clipboard:{},dialog:{},shell:{}}));
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import type { DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import { methods, pauseCancelFixture, type Method, type Producer } from '../support/goal-pause-cancel-fixture.js';
const NativePromise=Promise;
const turn=()=>new NativePromise<void>(r=>setImmediate(r));
const cleanup:Array<()=>Promise<void>>=[];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(async()=>{const errors:unknown[]=[];try{for(const f of cleanup.splice(0)){try{await f();}catch(e){errors.push(e);}}}finally{vi.restoreAllMocks();}if(errors.length)throw new AggregateError(errors,'all_fixture_cleanup_failures');});
async function fixture(overrides:Partial<Record<Method,Producer>>={}){const f=await pauseCancelFixture(overrides);cleanup.push(f.close);return f;}
const projection=():DesktopGoalProjection=>({state:createGoalState({sessionId:'thread',objective:'Transport DTO only',expectedEvidenceKinds:['answer'],now:100}),activation:'disarmed',currentCompletion:{kind:'ordinary'}});
it.each(methods)('%s original whole coordinator/store produces full non-null DTO and real domain mutation',async method=>{
 const f=await fixture(),initial=await f.seed();
 const dto=await f.invoke(method,[{threadId:' thread ',ignoredData:'compat'}]);
 expect(dto.state).toMatchObject({goalId:initial.goalId,sessionId:'thread',status:method==='pause'?'paused':'cancelled',revision:initial.revision+1,terminalReason:method==='pause'?'user_paused':'user_cancelled'});
 expect(dto.activation).toBe('disarmed');expect(dto.currentCompletion).toEqual({kind:'ordinary'});
 expect((await f.store.load('thread'))?.state).toEqual(dto.state);
 expect(f.effects()).toBe(1);expect(f.forbiddenCalls()).toBe(0);expect(f.gate.outstanding).toBe(0);
 const entry=IPC_SCHEMA_REGISTRY.get('desktop:goal:'+method);expect(entry?.payloadMode).toBe('tuple');expect(entry?.sourceFile).toBe('desktop/electron/goal-pause-cancel-typed-ipc.ts');
});
it.each(methods)('%s keeps original invalid threadId and actual missing-document rejection',async method=>{
 const f=await fixture();for(const id of ['', ' '.repeat(3), 'x'.repeat(201), 4])await expect(f.invoke(method,[{threadId:id}])).rejects.toThrow('invalid_goal_thread_id');
 expect(f.effects()).toBe(0);await expect(f.invoke(method)).rejects.toThrow();expect(f.effects()).toBe(1);expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s exact tuple and capture deny before delegate/getter, including unknown ignored-field getter',async method=>{
 const f=await fixture();let reads=0;const hostile=Object.defineProperty({threadId:'thread'},'ignored',{enumerable:true,get(){reads++;throw Error('must_not_read');}});
 for(const args of [[],[{threadId:'thread'},0],[hostile],[new Proxy({threadId:'thread'},{get(){reads++;throw Error('proxy_read');}})]])await expect(f.invoke(method,args)).rejects.toThrow();
 expect(reads).toBe(0);expect(f.effects()).toBe(0);expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s Recorder allowed coarse but denied Main finer, childframe/foreign/destroyed denied',async method=>{
 const f=await fixture();
 for(const event of [{sender:f.recorder,senderFrame:f.frame},{sender:f.target,senderFrame:{url:f.frame.url}},{sender:{isDestroyed:()=>false,mainFrame:f.frame},senderFrame:f.frame}])await expect(f.invoke(method,[{threadId:'thread'}],event)).rejects.toThrow();
 f.revoke();await expect(f.invoke(method)).rejects.toThrow();expect(f.effects()).toBe(0);expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s close-before-call denies and holds accepted invocation through real producer JS settlement/drain',async method=>{
 let release!:(v:DesktopGoalProjection)=>void;const raw=new NativePromise<DesktopGoalProjection>(r=>{release=r;});
 const f=await fixture({[method]:()=>raw});const pending=f.invoke(method),owned=pending.then(()=>undefined,()=>undefined);
 let drain:Promise<boolean>|undefined;const dto=projection();
 try{
  await turn();expect(f.effects()).toBe(1);expect(f.gate.outstanding).toBe(1);
  f.gate.close();await expect(f.invoke(method)).rejects.toThrow();expect(f.effects()).toBe(1);
  let drained=false;drain=f.gate.drain(1500).then(v=>{drained=v;return v;});await turn();expect(drained).toBe(false);
  release(dto);await expect(pending).resolves.toEqual(dto);expect(await drain).toBe(true);expect(f.gate.outstanding).toBe(0);
 }finally{release(dto);await owned;if(drain)await drain;}
});
it.each(methods)('%s retains exact plain rejected Promise error identity and no orphan',async method=>{
 const error=Error('ordinary_domain_failure'),orphans:unknown[]=[];const onError=(e:unknown)=>{orphans.push(e);};process.on('unhandledRejection',onError);
 try{const f=await fixture({[method]:async()=>{throw error;}});await expect(f.invoke(method)).rejects.toBe(error);await turn();expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);}finally{process.off('unhandledRejection',onError);}
});
it.each(methods)('%s revoke while plain producer held denies output without inventing business rollback',async method=>{
 let release!:(v:DesktopGoalProjection)=>void;const raw=new NativePromise<DesktopGoalProjection>(r=>{release=r;});const f=await fixture({[method]:()=>raw});const pending=f.invoke(method),owned=pending.then(()=>undefined,()=>undefined);const dto=projection();
 try{await turn();f.revoke();release(dto);await expect(pending).rejects.toThrow();expect(f.effects()).toBe(1);expect(f.gate.outstanding).toBe(0);}finally{release(dto);await owned;}
});
it.each(methods)('%s hostile own Promise constructor rejected without getter; no raw.then read',async method=>{
 const raw=NativePromise.resolve(projection());let reads=0;Object.defineProperty(raw,'constructor',{configurable:true,get(){reads++;throw Error('own_ctor');}});
 const f=await fixture({[method]:()=>raw});await expect(f.invoke(method)).rejects.toThrow();expect(reads).toBe(0);expect(f.gate.outstanding).toBe(0);
 const expected=projection(),normal=NativePromise.resolve(expected);Object.defineProperty(normal,'then',{get(){reads++;throw Error('raw_then');}});
 const g=await fixture({[method]:()=>normal});await expect(g.invoke(method)).resolves.toEqual(expected);expect(reads).toBe(0);
});
it.each(methods)('%s full projection capture rejects hostile nested getter/foreign unknown field/missing schema without reads',async method=>{
 let reads=0;const bad=projection();Object.defineProperty(bad.state,'objective',{enumerable:true,get(){reads++;throw Error('dto_getter');}});
 for(const dto of [bad,{...projection(),extra:1},{...projection(),state:{...projection().state,budgetLimits:{}}}]){const f=await fixture({[method]:()=>NativePromise.resolve(dto as DesktopGoalProjection)});await expect(f.invoke(method)).rejects.toThrow();expect(f.gate.outstanding).toBe(0);}expect(reads).toBe(0);
});
// Freeze fixtures before global tamper. Caller observers are attached after descriptor restoration.
for(const method of methods)for(const outcome of ['fulfill','reject'] as const)for(const tamper of ['getter','value'] as const)it(`${method} ambient species ${tamper} ${outcome}: producer0/getter0/unhandled0`,async()=>{
 const f=await fixture({[method]:async()=>{if(outcome==='reject')throw Error('should_not_start');return projection();}});
 const original=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!;let reads=0;const orphans:unknown[]=[];const onError=(e:unknown)=>{orphans.push(e);};process.on('unhandledRejection',onError);
 let pending:Promise<DesktopGoalProjection>;
 try{Object.defineProperty(NativePromise,Symbol.species,tamper==='getter'?{configurable:true,get(){reads++;throw Error('species_getter');}}:{configurable:true,value:NativePromise});pending=f.invoke(method);}finally{Object.defineProperty(NativePromise,Symbol.species,original);}
 try{await expect(pending!).rejects.toThrow();await turn();expect(f.effects()).toBe(0);expect(reads).toBe(0);expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);}finally{process.off('unhandledRejection',onError);}
});

it.each(methods)('%s accepts every original projection optional field/protected display variant without turning it into authority',async method=>{
 const variants=[undefined,{kind:'ordinary'},{kind:'unavailable'},...['binding_required','binding_pending','binding_mismatch','needs_revalidation','publication_pending','verified'].map(state=>({kind:'protected',state}))];
 for(const observation of variants){const dto=projection();dto.state.forkedFromGoalId='original-parent';dto.state.completionCriterion='Original criterion';dto.state.pendingCompletionIntentId='display-selector';dto.state.blockerFingerprint='fingerprint';dto.state.budgetLimits={turnLimit:3,tokenLimit:100,activeWallClockLimitMs:1000};dto.waitingReason='children_need_attention';if(observation===undefined)delete dto.currentCompletion;else dto.currentCompletion=observation as DesktopGoalProjection['currentCompletion'];const f=await fixture({[method]:()=>NativePromise.resolve(dto)});await expect(f.invoke(method)).resolves.toEqual(dto);expect(f.forbiddenCalls()).toBe(0);expect(f.gate.outstanding).toBe(0);}
});
