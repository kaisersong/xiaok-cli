import {describe,it,expect} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
import {ASSISTANT_MORNING_LOOP_ID} from '../../electron/assistant-types.js';
import {assistantDerivedHash,createAssistantDerivedVisibility,beginAssistantDerivedCapture} from '../../electron/assistant-derived-lineage.js';
import {migrateAssistantDerivedLineage,recordAssistantDerivedSourceRun,readAssistantDerivedLineage} from '../../electron/assistant-derived-lineage-store.js';
import {migrateAssistantSourceRuns} from '../../electron/assistant-source-store.js';
import {ASSISTANT_SOURCE_IDS} from '../../shared/assistant-coverage-contract.js';
const profile={id:'default-personal-assistant',status:'active',dataScopes:['tasks'],updatedAt:1};
const hash='a'.repeat(64),eid='b'.repeat(64);
function lineage(){return {version:1 as const,profileId:profile.id,profileRevision:assistantDerivedHash(profile),parents:[],calendar:{epoch:2,observationRevision:hash,events:[{id:eid,observationRevision:hash}]}};}
describe('durable source lineage',()=>{
 it('requires same DB transaction and persists coverage/lineage atomically, idempotently',()=>{
  const group=createLoopDatabaseOwnerGroup([':memory:']),lease=openLoopDatabase(group.sources[0]),store=new LoopStore(group.sources[0]),db=lease.database;try{
   store.ensureBuiltInLoops(1);store.setLoopStatus(ASSISTANT_MORNING_LOOP_ID,'active',1);const begin=store.beginLoopRun(ASSISTANT_MORNING_LOOP_ID,{kind:'manual'},2,1000);if(begin.status!=='started')throw Error('fixture');const runId=begin.run.id;
   migrateAssistantSourceRuns(db);migrateAssistantDerivedLineage(db);
   const sourceRun={runId,profileId:'default-personal-assistant' as const,kind:'morning' as const,now:1,coverage:ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked' as const,recordCount:0,includedCount:0,checkedAt:1,freshUntil:2,requestedWindow:{from:0,to:1}}))};
   expect(()=>recordAssistantDerivedSourceRun(db,{sourceRun,lineage:lineage()},()=>true)).toThrow('transaction');
   db.exec('BEGIN IMMEDIATE');let calls=0;expect(()=>recordAssistantDerivedSourceRun(db,{sourceRun,lineage:lineage()},()=>++calls===1)).toThrow('stale');db.exec('ROLLBACK');
   expect(db.prepare('SELECT count(*) AS n FROM assistant_source_runs').get()?.n).toBe(0);expect(readAssistantDerivedLineage(db,runId)).toBeUndefined();
   db.exec('BEGIN IMMEDIATE');recordAssistantDerivedSourceRun(db,{sourceRun,lineage:lineage()},()=>true);recordAssistantDerivedSourceRun(db,{sourceRun,lineage:lineage()},()=>true);db.exec('COMMIT');
   expect(readAssistantDerivedLineage(db,runId)).toEqual(lineage());
  }finally{store.close();lease.close();group.close();}
 });
 it('hides runs, ordinary evidence, candidates and descendants after source/profile/memory changes',()=>{
  let activeProfile={...profile},epoch=2;const records=new Map([['run',lineage()]]);
  const gate=createAssistantDerivedVisibility({isTrackedAssistantRun:()=>false,readLineage:id=>records.get(id),getProfile:()=>activeProfile,currentCalendar:()=>({epoch,events:[{id:eid,observationRevision:hash}]}),currentMemorySettings:()=>undefined,getMemory:()=>undefined,confirmMemory:()=>undefined});
  expect(gate.isRunVisible('run')).toBe(true);expect(gate.isEvidenceVisible({ownerKind:'loop_run',ownerId:'run'})).toBe(true);
  records.set('child',{version:1,profileId:profile.id,profileRevision:assistantDerivedHash(profile),parents:[{runId:'run',lineageHash:assistantDerivedHash(lineage())}]} as any);
  epoch++;expect(gate.isRunVisible('run')).toBe(false);expect(gate.isCandidateVisible({runId:'run'})).toBe(false);expect(gate.isRunVisible('child')).toBe(false);
  epoch=2;activeProfile={...profile,status:'paused'};expect(gate.isRunVisible('run')).toBe(false);
 });
 it('captures before/after collection fences, preparation/changed facts and rejects revoked consent',async()=>{
  let epoch=2;const snapshot={status:'partial',epoch:2,collectedAt:10,from:0,to:999999999,events:[{id:eid,title:'Prepare review',start:100,end:200,timeZone:'UTC',allDay:'unknown',cancelled:'unknown',observationRevision:hash}],observation:{changed:[eid]}};
  const start=()=>beginAssistantDerivedCapture({profile,getProfile:()=>profile,owner:()=>({ownerId:'owner',profileId:profile.id,cwd:'/work'}),calendar:()=>({lineage:{epoch,revision:hash},read:()=>snapshot,isCurrent:()=>true}),memorySettings:()=>({enabled:false,revision:0,ownerId:'owner',profileId:profile.id}),memoryStore:{listRelevant:async()=>[]},confirmMemory:()=>undefined,visibility:{readLineage:()=>undefined,isRunVisible:()=>true},now:10});
  const captured=await start().finish({});expect(captured.items[0].reference).toEqual({kind:'calendar_observation',id:eid});expect(captured.context.calendar.events[0].change).toBe('observed_changed');
  const pending=start();epoch=3;await expect(pending.finish({})).rejects.toThrow('stale');
 });
});

it('revalidates memory consent/content/accepted proof and hides empty-recall derivatives when consent is revoked',()=>{
 const record={id:'mem',scope:'global' as const,title:'Preference',summary:'Prepare notes',tags:[],updatedAt:1};
 let enabled=true,revision=1,body={...record},confirmed=true;
 const proof=()=>confirmed?{candidateId:'candidate',contentHash:assistantDerivedHash(body),confirmationRevision:hash,isCurrent:()=>confirmed}:undefined;
 const memoryLineage={version:1 as const,profileId:profile.id,profileRevision:assistantDerivedHash(profile),parents:[],memory:{ownerId:'owner',consentRevision:1,records:[{id:'mem',contentHash:assistantDerivedHash(record),candidateId:'candidate',confirmationRevision:hash}]}};
 const gate=createAssistantDerivedVisibility({isTrackedAssistantRun:()=>false,readLineage:()=>memoryLineage,getProfile:()=>profile,currentCalendar:()=>undefined,currentMemorySettings:()=>({ownerId:'owner',profileId:profile.id,enabled,revision}),getMemory:()=>body,confirmMemory:proof});
 expect(gate.isRunVisible('run')).toBe(true);body={...record,summary:'Unconfirmed edit'};expect(gate.isRunVisible('run')).toBe(false);body=record;confirmed=false;expect(gate.isRunVisible('run')).toBe(false);confirmed=true;revision++;expect(gate.isRunVisible('run')).toBe(false);revision=1;enabled=false;expect(gate.isRunVisible('run')).toBe(false);
});
it('fails closed for parent cycles and damaged lineage rather than treating them as legacy',()=>{
 const value:any={version:1,profileId:profile.id,profileRevision:assistantDerivedHash(profile),parents:[{runId:'cycle',lineageHash:hash}]};
 const gate=createAssistantDerivedVisibility({isTrackedAssistantRun:()=>false,readLineage:()=>value,getProfile:()=>profile,currentCalendar:()=>undefined,currentMemorySettings:()=>undefined,getMemory:()=>undefined,confirmMemory:()=>undefined});
 expect(gate.isRunVisible('cycle')).toBe(false);value.version=2;expect(gate.isRunVisible('cycle')).toBe(false);
});

it('does not hide unrelated or legacy business evidence while assistant is paused; tracked missing lineage fails closed',()=>{
 const gate=createAssistantDerivedVisibility({readLineage:()=>undefined,isTrackedAssistantRun:runId=>runId==='tracked-assistant',getProfile:()=>({...profile,status:'paused'}),currentCalendar:()=>undefined,currentMemorySettings:()=>undefined,getMemory:()=>undefined,confirmMemory:()=>undefined});
 expect(gate.isRunVisible('artifact-health-userloop')).toBe(true);expect(gate.isEvidenceVisible({ownerKind:'loop_run',ownerId:'artifact-health-userloop'})).toBe(true);expect(gate.isRunVisible('legacy-assistant')).toBe(true);expect(gate.isRunVisible('tracked-assistant')).toBe(false);
});
