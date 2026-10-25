import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GoalService, InMemoryGoalStore, type GoalMutationContext, type GoalInput } from '../../../src/runtime/goal/index.js';
import { FileGoalNativeJournal, goalNativeCandidate } from '../../../src/runtime/goal/native-mutation-journal.js';
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
const roots: string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function definition(){return {version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]};}
const input:GoalInput={objective:' original ',expectedEvidenceKinds:['file_artifact'],turnLimit:5};
const context=(expectedRevision:number|null):GoalMutationContext=>({sessionId:'session',instanceId:'owner',requestSource:'user',expectedRevision});
function fixture(){const root=mkdtempSync(join(tmpdir(),'goal-native-service-'));roots.push(root);const store=new InMemoryGoalStore(),nativeJournal=new FileGoalNativeJournal(root);let calls=0;let hook:((count:number)=>void|Promise<void>)|undefined;const service=new GoalService({store,nativeJournal,now:()=>100,ownership:{async assertOwned(){await hook?.(++calls);}}});return {store,nativeJournal,service,setHook(value:typeof hook){calls=0;hook=value;}};}
describe.skipIf(process.platform==='win32')('GoalService native reservation',()=>{
 it('durably reserves a normalized new draft without activating or changing the actual Goal store',async()=>{
  const f=fixture(),row=await f.service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition()});
  expect(row).toMatchObject({kind:'create',previous:null,revision:1,status:'reserved',target:{objective:'original',epoch:1,sessionId:'session'},createdAt:100});
  expect(row.enrollmentRequestId).not.toBe(row.applicationRequestId);expect(await f.store.load('session')).toBeNull();
  expect(f.nativeJournal.load('session')).toEqual([row]);expect(goalNativeCandidate(row)).toMatchObject({status:'active',revision:1,turnsUsed:0});
 });
 it('enforces user-only source and requires the host journal before any draft is written',async()=>{
  const f=fixture();for(const requestSource of ['agent','runtime','scheduler'] as const)await expect(f.service.reserveNativeMutation({...context(null),requestSource} as GoalMutationContext,{kind:'create',input,definition:definition()})).rejects.toThrow(/authorized/);
  const service=new GoalService({store:f.store,ownership:{assertOwned(){}}});await expect(service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition()})).rejects.toThrow('goal_native_journal_unavailable');expect(f.nativeJournal.load('session')).toEqual([]);
 });
 it('binds the entire persisted original state and deterministic replace candidate with observed remote epoch',async()=>{
  const f=fixture(),state=await f.service.create(context(null),input);const before=await f.store.load('session');
  const row=await f.service.reserveNativeMutation(context(state.revision),{kind:'replace',input:{...input,objective:'next'},definition:definition(),minimumEpoch:9});
  expect(row.previous?.stateHash).toBe(createHash('sha256').update(json(JSON.parse(JSON.stringify(state)))).digest('hex'));
  expect(row.target).toMatchObject({goalId:state.goalId,epoch:9,objective:'next'});expect(goalNativeCandidate(row)).toMatchObject({revision:2,epoch:9,createdAt:state.createdAt});expect(await f.store.load('session')).toEqual(before);
 });
 it('rejects stale revisions, active create, missing replacement, invalid epochs and absent definitions',async()=>{
  const f=fixture();await expect(f.service.reserveNativeMutation(context(1),{kind:'replace',input,definition:definition()})).rejects.toThrow();
  await expect(f.service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition(),minimumEpoch:2})).rejects.toThrow();
  const state=await f.service.create(context(null),input);
  for(const args of [{kind:'create',input,definition:definition()},{kind:'replace',input,definition:definition(),minimumEpoch:Infinity},{kind:'replace',input,definition:undefined}])await expect(f.service.reserveNativeMutation(context(state.revision),args as any)).rejects.toThrow();
  await expect(f.service.reserveNativeMutation(context(10),{kind:'replace',input,definition:definition()})).rejects.toThrow(/stale/);expect(f.nativeJournal.load('session')).toEqual([]);
 });
 it('captures definition, context, input and epoch before the first async owner callback',async()=>{
  const f=fixture(),state=await f.service.create(context(null),input),ctx=context(state.revision),args={kind:'replace' as const,input:{...input},definition:definition(),minimumEpoch:4};
  f.setHook(count=>{if(count===1){ctx.sessionId='other';args.input.objective='changed';args.minimumEpoch=99;args.definition.obligations[0].recipe.checks[0].sha256='b'.repeat(64);}});
  const row=await f.service.reserveNativeMutation(ctx,args);expect(row.sessionId).toBe('session');expect(row.target).toMatchObject({objective:'original',epoch:4});expect(row.definition).toEqual(definition());
 });
 it.each(['ownership','same-revision','new-revision'])('rejects %s changes after first ownership without adding a journal row',async(mode)=>{
  const f=fixture(),state=await f.service.create(context(null),input);f.setHook(count=>{if(count!==2)return;if(mode==='ownership')throw Error('ownership revoked');const doc=f.store.documents.get('session')!;doc.state.objective='concurrent';if(mode==='new-revision')doc.state.revision++;});
  await expect(f.service.reserveNativeMutation(context(state.revision),{kind:'replace',input,definition:definition()})).rejects.toThrow();expect(f.nativeJournal.load('session')).toEqual([]);
 });
 it('allows a new identity after cancelled Goal while recording its full original basis',async()=>{
  const f=fixture(),state=await f.service.create(context(null),input);await f.service.cancel(context(state.revision),'user');const row=await f.service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition()});expect(row.target.goalId).not.toBe(state.goalId);expect(row.previous).toMatchObject({goalId:state.goalId,revision:2});expect((await f.store.load('session'))?.state.status).toBe('cancelled');
 });
 it('retains current exact applied definition and refuses weakened replacement',async()=>{
  const f=fixture(),row=await f.service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition()});let saved=row;
  for(const status of ['enrolling','enrolled','binding','ready','applied'] as const){const next={...saved,status,revision:saved.revision+1};f.nativeJournal.put({sessionId:'session',requestSource:'user',expectedRevision:saved.revision,next});saved=next;}
  await f.store.commit({sessionId:'session',expectedRevision:null,next:goalNativeCandidate(row),events:[],turns:[],evidence:[]});
  const weakened=definition();weakened.obligations[0].recipe.checks[0].sha256='b'.repeat(64);
  await expect(f.service.reserveNativeMutation(context(1),{kind:'replace',input,definition:weakened})).rejects.toThrow();
  expect(f.nativeJournal.load('session')).toHaveLength(1);await expect(f.service.reserveNativeMutation(context(1),{kind:'replace',input,definition:definition()})).resolves.toMatchObject({target:{epoch:2}});
 });
 it.each(['goalId','forkedFromGoalId','type'])('rejects extra input %s before it can select identity or reducer operation',async(field)=>{
  const f=fixture();await expect(f.service.reserveNativeMutation(context(null),{kind:'create',input:{...input,[field]:'caller-chosen-owner'},definition:definition()})).rejects.toThrow();
  const state=await f.service.create(context(null),input);await expect(f.service.reserveNativeMutation(context(state.revision),{kind:'replace',input:{...input,[field]:'cancel'},definition:definition()})).rejects.toThrow();expect(f.nativeJournal.load('session')).toEqual([]);
 });
 it('rejects accessor and extra context/envelope fields without invoking accessors',async()=>{
  const f=fixture();let reads=0;const payload={kind:'create' as const,input:{...input,get goalId(){reads++;return 'injected';}},definition:definition()};await expect(f.service.reserveNativeMutation(context(null),payload)).rejects.toThrow();expect(reads).toBe(0);
  await expect(f.service.reserveNativeMutation({...context(null),approved:true} as any,{kind:'create',input,definition:definition()})).rejects.toThrow();
  await expect(f.service.reserveNativeMutation(context(null),{kind:'create',input,definition:definition(),approved:true} as any)).rejects.toThrow();expect(f.nativeJournal.load('session')).toEqual([]);
 });

});
