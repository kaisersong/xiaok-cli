import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const remote=vi.hoisted(()=>({route:undefined as any,observation:undefined as any,dispose:vi.fn()}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>remote.route}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({applicationTransport:{async call(){return structuredClone(remote.observation);}},dispose:remote.dispose})}));
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { SqliteGoalStore } from '../../../desktop/electron/goal-store-sqlite.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { FileGoalNativeJournal, goalNativeCandidate } from '../../../src/runtime/goal/native-mutation-journal.js';
import { authorizeGoalNativeProjection } from '../../../src/runtime/goal/native-mutation-projection.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
import type { GoalCommitInput, GoalStore } from '../../../src/runtime/goal/types.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn();});beforeEach(()=>{remote.route={kind:'ordinary'};remote.dispose.mockReset();});
const definition={version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]};
for(const kind of ['memory','file','sqlite'] as const){
 async function fixture(){const root=mkdtempSync(join(tmpdir(),'goal-native-projection-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const store:GoalStore=kind==='memory'?new InMemoryGoalStore():kind==='file'?new FileGoalStore(root):new SqliteGoalStore(join(root,'goals.db'));if(store instanceof SqliteGoalStore)cleanups.push(()=>store.close());
 const journal=new FileGoalNativeJournal(root),service=new GoalService({store,nativeJournal:journal,ownership:{assertOwned(){}},now:()=>10});
 let row=await service.reserveNativeMutation({sessionId:'session',instanceId:'instance',requestSource:'user',expectedRevision:null},{kind:'create',input:{objective:'original',expectedEvidenceKinds:['file_artifact']},definition});
 for(const status of ['enrolling','enrolled','binding','ready'] as const){const next={...row,status,revision:row.revision+1};journal.put({sessionId:'session',requestSource:'user',expectedRevision:row.revision,next});row=next;}
 const owner={profileId:'profile',ownerKind:'goal',ownerId:row.target.goalId};remote.route={kind:'protected-unregistered',owner,authorityId:'authority'};remote.observation={state:'active',current:{binding:row.target,bindingHash:goalApplicationBindingHash(row.target),revision:1},pendingTransitionId:null,pendingTarget:null};
 const input:GoalCommitInput={sessionId:'session',expectedRevision:null,next:goalNativeCandidate(row),events:[],turns:[],evidence:[]};return {store,journal,service,row,input};}
 it.skipIf(process.platform==='win32')(`${kind}: raw protected create and copied tickets cannot activate, original actual-observation projection commits once`,async()=>{
  const f=await fixture();await expect(f.store.commit(f.input)).rejects.toThrow(/native_projection/);const allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row);
  await expect(f.store.commit({...allowed,nativeProjection:{...allowed.nativeProjection}})).rejects.toThrow(/native_projection/);
  await f.store.commit(allowed);expect((await f.store.load('session'))?.state).toEqual(f.input.next);await expect(f.store.commit({...allowed,expectedRevision:1})).rejects.toThrow();
 });
 it.skipIf(process.platform==='win32')(`${kind}: altered commit burns original token even when revision has not changed`,async()=>{
  const f=await fixture(),allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row);await expect(f.store.commit({...allowed,next:{...allowed.next,objective:'injected'}})).rejects.toThrow(/native_projection/);await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);expect(await f.store.load('session')).toBeNull();
 });
 it.skipIf(process.platform==='win32')(`${kind}: public ready record, wrong active binding and counter changes cannot authorize projection`,async()=>{
  const f=await fixture();remote.observation={state:'unbound',current:null,pendingTransitionId:null,pendingTarget:null};await expect(authorizeGoalNativeProjection(f.store,f.input,f.row)).rejects.toThrow();
  remote.observation={state:'active',current:{binding:{...f.row.target,epoch:2},bindingHash:goalApplicationBindingHash({...f.row.target,epoch:2}),revision:2},pendingTransitionId:null,pendingTarget:null};await expect(authorizeGoalNativeProjection(f.store,f.input,f.row)).rejects.toThrow();
  await expect(authorizeGoalNativeProjection(f.store,{...f.input,next:{...f.input.next,tokensUsed:99}},f.row)).rejects.toThrow();
 });
 it.skipIf(process.platform==='win32')(`${kind}: one store cannot spend another store's ticket or persist a change after owner route drift`,async()=>{
  const f=await fixture(),allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row);const other=new InMemoryGoalStore();await expect(other.commit(allowed)).rejects.toThrow(/native_projection/);await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);
  const next=await authorizeGoalNativeProjection(f.store,f.input,f.row);remote.route={kind:'ordinary'};await expect(f.store.commit(next)).rejects.toThrow(/native_projection/);
 });
 it.skipIf(process.platform==='win32')(`${kind}: same-binding pause remains valid but raw replacement cannot bypass the new-owner gate`,async()=>{
  const f=await fixture();await f.store.commit(await authorizeGoalNativeProjection(f.store,f.input,f.row));const ctx={sessionId:'session',instanceId:'instance',requestSource:'user' as const,expectedRevision:1};await expect(f.service.pause(ctx,'user')).resolves.toMatchObject({status:'paused'});
  await expect(f.service.replace({...ctx,expectedRevision:2},{objective:'replacement',expectedEvidenceKinds:['file_artifact']})).rejects.toThrow(/native_projection/);expect((await f.store.load('session'))?.state.objective).toBe('original');
 });
 it.skipIf(process.platform==='win32')(`${kind}: clone failure burns a native ticket before any store transaction`,async()=>{
  const f=await fixture(),allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row);await expect(f.store.commit({...allowed,events:[()=>undefined]} as any)).rejects.toThrow();await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);expect(await f.store.load('session')).toBeNull();
 });
 it.skipIf(process.platform==='win32')(`${kind}: service commits only the original ready draft once`,async()=>{
  const f=await fixture();const prepared=await f.service.prepareNativeMutationCommit({sessionId:'session',instanceId:'instance',requestSource:'user',expectedRevision:null},f.row.id);expect(await f.store.load('session')).toBeNull();expect(await prepared.commit()).toEqual(f.input.next);expect(f.journal.load('session')[0].status).toBe('applied');await expect(prepared.commit()).rejects.toThrow(/consumed/);
 });
 it.skipIf(process.platform==='win32')(`${kind}: restart after Goal commit but before journal applied repairs only the journal`,async()=>{
  const f=await fixture();await f.store.commit(await authorizeGoalNativeProjection(f.store,f.input,f.row));expect(f.journal.load('session')[0].status).toBe('ready');const before=await f.store.load('session');const recovered=await f.service.recoverNativeMutationCommit({sessionId:'session',instanceId:'instance',requestSource:'runtime',expectedRevision:1},f.row.id);expect(recovered).toEqual(f.input.next);expect(await f.store.load('session')).toEqual(before);expect(f.journal.load('session')[0].status).toBe('applied');
 });
 it.skipIf(process.platform==='win32')(`${kind}: crashgap recovery refuses changed local usage and unbound remote application`,async()=>{
  const f=await fixture();await f.store.commit(await authorizeGoalNativeProjection(f.store,f.input,f.row));remote.observation={state:'unbound',current:null,pendingTransitionId:null,pendingTarget:null};const ctx={sessionId:'session',instanceId:'instance',requestSource:'runtime' as const,expectedRevision:1};await expect(f.service.recoverNativeMutationCommit(ctx,f.row.id)).rejects.toThrow();expect(f.journal.load('session')[0].status).toBe('ready');
  await f.service.recordTurn(ctx,{turnId:'turn',tokensUsed:5,activeWallClockMs:1});await expect(f.service.recoverNativeMutationCommit({...ctx,expectedRevision:2},f.row.id)).rejects.toThrow();expect((await f.store.load('session'))?.state.tokensUsed).toBe(5);
 });

 it.skipIf(process.platform==='win32')(`${kind}: a throwing completion-ticket accessor cannot preserve a native ticket`,async()=>{
  const f=await fixture(),allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row);const broken={...allowed,get completionProjection(): object {throw Error('accessor');}};await expect(f.store.commit(broken)).rejects.toThrow();await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);
 });

 it.skipIf(process.platform==='win32')(`${kind}: cancellation after signed observation prevents consuming the original cache projection`,async()=>{
  const f=await fixture(),controller=new AbortController();const allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row,controller.signal);controller.abort(Error('cancelled before store lock'));await expect(f.store.commit(allowed)).rejects.toThrow('cancelled before store lock');expect(await f.store.load('session')).toBeNull();await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);
 });

 it.skipIf(process.platform==='win32')(`${kind}: restrictive host admission is rechecked synchronously inside the consuming store`,async()=>{
  const f=await fixture();let current=true;const check=()=>{if(!current)throw Error('host revoked');};
  const allowed=await authorizeGoalNativeProjection(f.store,f.input,f.row,undefined,check);current=false;
  await expect(f.store.commit(allowed)).rejects.toThrow('host revoked');expect(await f.store.load('session')).toBeNull();
  current=true;await expect(f.store.commit(allowed)).rejects.toThrow(/native_projection/);
  let asynchronous=false;const lateAsync=()=>asynchronous?Promise.resolve():undefined;
  const second=await authorizeGoalNativeProjection(f.store,f.input,f.row,undefined,lateAsync);asynchronous=true;
  await expect(f.store.commit(second)).rejects.toThrow(/admission_sync/);expect(await f.store.load('session')).toBeNull();
 });

}
