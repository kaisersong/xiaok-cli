import {it,expect,vi} from 'vitest';
const completedObserver=vi.hoisted(()=>({onRead:()=>{}}));
vi.mock('../../electron/loop-completion-consumer.js',()=>({readLoopCompletedRun:async()=>{completedObserver.onRead();return false;}}));
const classification=vi.hoisted(()=>({kind:'ordinary'}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:classification.kind})}));
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {createAssistantPublicationContextReader} from '../../electron/assistant-publication-context.js';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
import {migrateAssistantDerivedLineage,recordAssistantDerivedSourceRun,readAssistantDerivedLineage,isAssistantDerivedRunTracked} from '../../electron/assistant-derived-lineage-store.js';
import {beginAssistantDerivedCapture,createAssistantDerivedVisibility} from '../../electron/assistant-derived-lineage.js';
import {ASSISTANT_MORNING_LOOP_ID} from '../../electron/assistant-types.js';
import {ASSISTANT_SOURCE_IDS} from '../../shared/assistant-coverage-contract.js';
function fixture(){
 classification.kind='ordinary';completedObserver.onRead=()=>{};
 const owner=createLoopDatabaseOwnerGroup([':memory:']),source=owner.sources[0],lease=openLoopDatabase(source),store=new LoopStore(source),evidence=new CompletionEvidenceStore(source),db=lease.database;
 migrateAssistantDerivedLineage(db);const now=Date.parse('2026-11-01T00:00:00Z');store.ensureBuiltInLoops(now);store.setLoopStatus(ASSISTANT_MORNING_LOOP_ID,'active',now);
 store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
 let epoch=1;const id='c'.repeat(64),rev='d'.repeat(64),event={id,title:'Design review',start:now+3600000,end:now+7200000,timeZone:'UTC',allDay:'unknown',cancelled:'unknown',observationRevision:rev};
 const calendar=()=>({lineage:{epoch,revision:rev},isCurrent:()=>epoch===1,read:()=>({status:'partial',epoch,collectedAt:now,from:now-86400000,to:now+7*86400000,events:[event],observation:{changed:[id]}})});
 const visibility=createAssistantDerivedVisibility({isTrackedAssistantRun:runId=>isAssistantDerivedRunTracked(db,runId),readLineage:runId=>readAssistantDerivedLineage(db,runId),getProfile:()=>store.getAssistantProfile('default-personal-assistant'),currentCalendar:()=>({epoch,events:[event]}),currentMemorySettings:()=>undefined,getMemory:()=>undefined,confirmMemory:()=>undefined});
 const beginCapture=()=>beginAssistantDerivedCapture({profile:store.getAssistantProfile('default-personal-assistant')!,getProfile:()=>store.getAssistantProfile('default-personal-assistant'),owner:()=>({ownerId:'local',profileId:'default-personal-assistant',cwd:'/work'}),calendar,memorySettings:()=>({ownerId:'local',profileId:'default-personal-assistant',enabled:false,revision:0}),memoryStore:{listRelevant:async()=>[]},confirmMemory:()=>undefined,visibility,now});
 const recordCollection=(input:any,guard:()=>boolean)=>{db.exec('BEGIN IMMEDIATE');try{recordAssistantDerivedSourceRun(db,input,guard);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
 const coverage=ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked' as const,recordCount:0,includedCount:0,checkedAt:now,freshUntil:now+1000,requestedWindow:{from:now-86400000,to:now}}));
 const collect=()=>({current:{items:[],coverage}});
 const complete=vi.fn(async()=>({text:JSON.stringify({schemaVersion:2,recommendations:[{title:'Prepare design review',reasonCode:'preparation',evidenceRefs:[{kind:'calendar_observation',id}],action:{kind:'prepare',reason:'Upcoming review; preparation may help',nextStep:'Review your notes',instruction:'Prepare notes; no calendar changes.'}}]})}));
 const runtime=()=>createAssistantRuntime({loopStore:store,evidenceStore:evidence,llmPort:{complete},collect,now:()=>now,derived:{beginCapture,recordCollection,visibility}});
 return {store,evidence,db,complete,runtime,visibility,revoke:()=>epoch++,close:()=>{classification.kind='ordinary';evidence.close();store.close();lease.close();owner.close();}};
}
it('publishes real P2 preparation through ordinary runtime/evidence and hides display/launch on revoke',async()=>{
 const f=fixture();try{
  f.complete.mockImplementationOnce(async(input:any)=>{expect(JSON.stringify(input)).toContain('calendar_observation');expect(f.db.prepare('SELECT count(*) AS n FROM assistant_source_runs').get()?.n).toBe(1);expect(f.db.prepare('SELECT count(*) AS n FROM assistant_derived_lineage').get()?.n).toBe(1);return {text:JSON.stringify({schemaVersion:2,recommendations:[{title:'Prepare design review',reasonCode:'preparation',evidenceRefs:[{kind:'calendar_observation',id:'c'.repeat(64)}],action:{kind:'prepare',reason:'Upcoming review',nextStep:'Read notes',instruction:'Prepare notes only.'}}]})};});
  const result=await f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});expect(result.status).toBe('success');
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0];expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toHaveLength(1);
  const reader=createAssistantPublicationContextReader({store:f.store,evidenceStore:f.evidence,publication:{} as never,derivedVisibility:f.visibility});
  expect((await reader.listMorningSuggestions())[0]?.title).toBe('Prepare design review');const display=await reader.readMorningDisplaySource();expect(display?.recommendations[0]?.action.instruction).toBe('Prepare notes only.');expect(display?.isCurrent()).toBe(true);expect(await reader.readMorningActionSource()).toBeUndefined();
  f.revoke();expect(f.visibility.isRunVisible(run.id)).toBe(false);expect(await reader.listMorningSuggestions()).toEqual([]);
 }finally{f.close();}
});
it('rejects revoke during model execution before writing source-derived evidence or candidates',async()=>{
 const f=fixture();try{
  f.complete.mockImplementationOnce(async()=>{f.revoke();return {text:JSON.stringify({schemaVersion:2,recommendations:[]})};});
  await expect(f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'})).rejects.toThrow('assistant_derived_unavailable');
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0];expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.store.listAssistantCandidates()).toEqual([]);
 }finally{f.close();}
});

it('does not publish ordinary bodies if the owner becomes protected while the model runs',async()=>{
 const f=fixture();try{
  f.complete.mockImplementationOnce(async()=>{classification.kind='protected-unregistered';return {text:JSON.stringify({schemaVersion:2,recommendations:[]})};});
  await expect(f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'})).rejects.toThrow('assistant_derived_protected_unsupported');
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0];expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.store.listAssistantCandidates()).toEqual([]);
 }finally{f.close();}
});

it('rechecks lineage after asynchronous completed-run observation before returning a captured historical run',async()=>{
 const f=fixture();try{
  expect((await f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'})).status).toBe('success');
  completedObserver.onRead=f.revoke;
  await expect(f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'})).rejects.toThrow('assistant_derived_unavailable');
 }finally{f.close();}
});

it('display source rejects model external references not present in the actual durable lineage',async()=>{
 const f=fixture();try{
  await f.runtime().runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0],reader=createAssistantPublicationContextReader({store:f.store,evidenceStore:f.evidence,publication:{} as never,derivedVisibility:f.visibility});
  const row=f.db.prepare('SELECT id,metadata_json FROM completion_evidence WHERE owner_id=?').get(run.id)!;
  const metadata=JSON.parse(String(row.metadata_json));metadata.output.recommendations[0].evidenceRefs=[{kind:'calendar_observation',id:'f'.repeat(64)}];
  f.db.prepare('UPDATE completion_evidence SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),String(row.id));
  expect(await reader.readMorningDisplaySource()).toBeUndefined();expect(await reader.listMorningSuggestions()).toEqual([]);
  metadata.output.recommendations[0].evidenceRefs=[{kind:'memory_context',id:'not-confirmed'}];f.db.prepare('UPDATE completion_evidence SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),String(row.id));
  expect(await reader.readMorningDisplaySource()).toBeUndefined();
  metadata.output.recommendations[0].evidenceRefs=[{kind:'task_snapshot',id:'task-1'}];f.db.prepare('UPDATE completion_evidence SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),String(row.id));
  expect(await reader.readMorningActionSource()).toBeUndefined(); // Changing reference kind cannot turn this P2 run into launch authority.
 }finally{f.close();}
});
