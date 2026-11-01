import {beforeEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({kind:'ordinary' as string}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:route.kind})}));
import {createAssistantPublicationContextReader} from '../../electron/assistant-publication-context.js';
import {ASSISTANT_CHECK_LOOP_ID,ASSISTANT_EVENING_LOOP_ID,ASSISTANT_MORNING_LOOP_ID} from '../../electron/assistant-types.js';
beforeEach(()=>{route.kind='ordinary';});
function fixture(hiddenRunId?:string){
 const runs=[{id:'evening',loopId:ASSISTANT_EVENING_LOOP_ID,status:'success',summary:'legacy summary'},{id:'morning',loopId:ASSISTANT_MORNING_LOOP_ID,status:'success',summary:''}];
 const candidates=[{id:'candidate',runId:'evening',kind:'memory',title:'original member',status:'pending'}];
 const vectors=new Map([['evening','evening-vector'],['morning','morning-vector']]);
 const protectedRuns=new Set<string>();
 const store={getAssistantProfile:()=>({id:'default-personal-assistant',dataScopes:['threads','projects','tasks','artifacts','automations','meetings']}),listLoopRuns:(id:string)=>runs.filter(r=>r.loopId===id),getLoopRun:(id:string)=>runs.find(r=>r.id===id),listAssistantCandidates:()=>structuredClone(candidates),getLoopRunPublicationBasis:(id:string)=>protectedRuns.has(id)?{}:undefined,getLoopBusinessProjectionTarget:(id:string)=>({vector:vectors.get(id)})};
 const publication={readAssistantOutput:vi.fn(async({runId}:{runId:string})=>({runId,vector:vectors.get(runId),rows:{run:{id:runId,status:'success'},members:[{id:'candidate',kind:'memory',title:'original member',status:'pending'}]},body:runId==='evening'?{kind:'assistant-evening',summary:'published summary',candidates:[]}:{kind:'assistant-morning',recommendations:[{title:'published recommendation',reasonCode:'verified',evidenceRefs:[{kind:'task',id:'task'}]}]}}))};
 const evidenceStore={listEvidenceForOwner:vi.fn(()=>[{metadata:{assistantKind:'morning',output:{recommendations:[{title:'old evidence',reasonCode:'old',evidenceRefs:[{kind:'task',id:'task'}]}]}}}])};
 return {runs,candidates,vectors,protectedRuns,publication,evidenceStore,reader:createAssistantPublicationContextReader({store:store as never,publication:publication as never,evidenceStore:evidenceStore as never,...(hiddenRunId?{derivedVisibility:{readLineage:()=>undefined,isRunVisible:(id:string)=>id!==hiddenRunId,isCandidateVisible:()=>true,isEvidenceVisible:()=>true}}:{})})};
}
it('preserves truly ordinary summaries and evidence without protected RPC',async()=>{
 const f=fixture();const context=await f.reader.buildMorningContext({snapshot:{today:true},pinnedThreadIds:['thread']});
 expect(context.latestEvening?.summary).toBe('legacy summary');expect(context.pendingCandidates).toHaveLength(1);
 expect((await f.reader.listMorningSuggestions())[0].title).toBe('old evidence');expect(f.publication.readAssistantOutput).not.toHaveBeenCalled();
});
it('uses fresh bound bodies rather than raw empty summary and historical evidence',async()=>{
 const f=fixture();f.protectedRuns.add('evening');f.protectedRuns.add('morning');
 const context=await f.reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]});
 expect(context.latestEvening?.summary).toBe('published summary');expect(context.pendingCandidates).toHaveLength(1);
 expect(f.publication.readAssistantOutput.mock.calls.filter(([v])=>v.runId==='evening')).toHaveLength(1);
 expect((await f.reader.listMorningSuggestions())[0].title).toBe('published recommendation');expect(f.evidenceStore.listEvidenceForOwner).not.toHaveBeenCalled();
});
it.each(['expired','offline'])('does not feed protected history into prompt or suggestions on %s',async reason=>{
 const f=fixture();f.protectedRuns.add('evening');f.protectedRuns.add('morning');f.publication.readAssistantOutput.mockRejectedValue(Error(reason));
 const context=await f.reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]});expect(context.latestEvening).toBeNull();expect(context.pendingCandidates).toEqual([]);expect(await f.reader.listMorningSuggestions()).toEqual([]);expect(f.evidenceStore.listEvidenceForOwner).not.toHaveBeenCalled();
});
it('unavailable installed classification is never ordinary',async()=>{
 const f=fixture();route.kind='unavailable';const context=await f.reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]});expect(context.latestEvening).toBeNull();expect(context.pendingCandidates).toEqual([]);expect(await f.reader.listMorningSuggestions()).toEqual([]);expect(f.publication.readAssistantOutput).not.toHaveBeenCalled();
});
it('drops an earlier run changed while another run was read',async()=>{
 const f=fixture();f.protectedRuns.add('evening');f.protectedRuns.add('second');f.runs.push({id:'second',loopId:ASSISTANT_EVENING_LOOP_ID,status:'success',summary:'second'});f.candidates.push({id:'candidate2',runId:'second',kind:'memory',title:'second',status:'pending'});
 const original=f.publication.readAssistantOutput.getMockImplementation()!;
 f.publication.readAssistantOutput.mockImplementation(async input=>{const result=await original(input);if(input.runId==='second')f.vectors.set('evening','changed');return result;});
 const context=await f.reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]});expect(context.latestEvening).toBeNull();expect(context.pendingCandidates.some(c=>c.id==='candidate')).toBe(false);
});
it.each(['evening','morning'] as const)('does not label an older %s result latest after a new successful run appears',async kind=>{
 const f=fixture();f.protectedRuns.add(kind);const original=f.publication.readAssistantOutput.getMockImplementation()!;
 f.publication.readAssistantOutput.mockImplementation(async input=>{const result=await original(input);f.runs.unshift({id:`new-${kind}`,loopId:kind==='evening'?ASSISTANT_EVENING_LOOP_ID:ASSISTANT_MORNING_LOOP_ID,status:'success',summary:'new summary'});return result;});
 if(kind==='evening')expect((await f.reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]})).latestEvening).toBeNull();
 else expect(await f.reader.listMorningSuggestions()).toEqual([]);
});
it('reads ordinary real SQLite records that include absent optional fields',async()=>{
 const {LoopStore}=await import('../../electron/loop-store.js');
 const {mkdtempSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const root=mkdtempSync(join(tmpdir(),'assistant-context-ordinary-')),store=new LoopStore(join(root,'loop.sqlite'));
 try{store.ensureBuiltInLoops(1);store.setLoopStatus(ASSISTANT_EVENING_LOOP_ID,'active',2);const run=store.beginLoopRun(ASSISTANT_EVENING_LOOP_ID,{kind:'manual'},3,1000);if(run.status!=='started')throw Error('fixture');
 store.stageAssistantCandidates(run.run.id,[{kind:'memory',title:'原始建议',content:'正文',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'original'}],4);store.finishAssistantLoopRunSuccess(run.run.id,['evidence'],5,'真实摘要');
 const readAssistantOutput=vi.fn();const reader=createAssistantPublicationContextReader({store,publication:{readAssistantOutput} as never,evidenceStore:{} as never});
 const result=await reader.buildMorningContext({snapshot:{},pinnedThreadIds:[]});expect(result.latestEvening?.summary).toBe('真实摘要');expect(result.pendingCandidates).toHaveLength(1);expect(readAssistantOutput).not.toHaveBeenCalled();
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

it('returns a main-private v2 source observation that becomes invalid when its protected vector changes',async()=>{
 const f=fixture();f.protectedRuns.add('morning');
 Object.assign(f.runs.find(run=>run.id==='morning')!,{finishedAt:100,updatedAt:100});
 const original=f.publication.readAssistantOutput.getMockImplementation()!;
 f.publication.readAssistantOutput.mockImplementation(async input=>{
  const result=await original(input);
  return {...result,body:{kind:'assistant-morning',schemaVersion:2,recommendations:[{title:'Review',reasonCode:'result',evidenceRefs:[{kind:'task',id:'task'}],action:{kind:'review',reason:'A result',nextStep:'Inspect evidence',instruction:'Review without editing.'}}],artifacts:[]}} as any;
 });
 const source=await f.reader.readMorningActionSource();
 expect(source?.recommendations[0]?.action.instruction).toBe('Review without editing.');
 expect(source?.isCurrent()).toBe(true);
 f.vectors.set('morning','changed');expect(source?.isCurrent()).toBe(false);
});

it('confirms only accepted memory targets with matching scope, content and current ordinary publication',async()=>{
 const {LoopStore}=await import('../../electron/loop-store.js');
 const {createLoopDatabaseOwnerGroup,openLoopDatabase}=await import('../../electron/loop-database-owner.js');
 const {assistantMemoryContentHash}=await import('../../electron/assistant-derived-lineage.js');
 const owner=createLoopDatabaseOwnerGroup([':memory:']),lease=openLoopDatabase(owner.sources[0]),store=new LoopStore(owner.sources[0]);
 try{
  store.ensureBuiltInLoops(1);store.setLoopStatus(ASSISTANT_EVENING_LOOP_ID,'active',1);
  store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:00',morningTime:'08:00',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});
  const run=store.beginLoopRun(ASSISTANT_EVENING_LOOP_ID,{kind:'manual'},2,1000);if(run.status!=='started')throw Error('fixture');
  const [candidate]=store.stageAssistantCandidates(run.run.id,[{kind:'memory',title:'Preference',content:'Prepare notes',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'pref'}],3);
  store.finishAssistantLoopRunSuccess(run.run.id,['evidence'],4,'Complete');
  lease.database.prepare("UPDATE assistant_candidates SET status='accepted',target_kind='memory',target_id='mem',accepted_target_ref='memory://layered/mem',decided_at=5 WHERE id=?").run(candidate.id);
  const record={id:'mem',scope:'global' as const,title:'Preference',summary:'Prepare notes',tags:[],updatedAt:5,type:'user' as const,provenance:{kind:'assistant_candidate' as const,candidateId:candidate.id,loopRunId:run.run.id,backend:'layered' as const,evidenceRefs:candidate.evidenceRefs}};
  const reader=createAssistantPublicationContextReader({store,evidenceStore:{} as never,publication:{} as never,memoryOwner:()=>({ownerId:'local',profileId:'default-personal-assistant',cwd:'/work'})});
  const proof=reader.confirmMemory(record);expect(proof?.isCurrent()).toBe(true);expect(proof?.contentHash).toBe(assistantMemoryContentHash(record));
  expect(reader.confirmMemory({...record,summary:'Unconfirmed edit'})).toBeUndefined();
  expect(reader.confirmMemory({...record,scope:'project',cwd:'/else'})).toBeUndefined();
  route.kind='protected-unregistered';expect(reader.confirmMemory(record)).toBeUndefined();route.kind='ordinary';
  lease.database.prepare("UPDATE assistant_candidates SET status='rejected' WHERE id=?").run(candidate.id);expect(proof?.isCurrent()).toBe(false);
 }finally{store.close();lease.close();owner.close();}
});

it('uses a dedicated finite confirmation accessor instead of recursively calling gated public readers',()=>{
 const candidate={id:'candidate',runId:'origin',kind:'memory',status:'accepted',targetKind:'memory',targetId:'mem',acceptedTargetRef:'memory://layered/mem',scope:'global',title:'Preference',content:'Notes',evidenceRefs:[{kind:'task',id:'task'}]};
 const profile={id:'default-personal-assistant',status:'active',dataScopes:['tasks']};
 const forbidden=vi.fn(()=>{throw Error('gated_reader_recursion');});let current=true;
 const store={getAssistantProfile:()=>profile,getLoopRunPublicationBasis:()=>undefined,getAssistantCandidate:forbidden,getLoopRun:forbidden,listAssistantCandidates:forbidden};
 const derivedVisibility={readLineage:()=>undefined,isRunVisible:()=>true,isCandidateVisible:()=>true,isEvidenceVisible:()=>true};
 const record={id:'mem',scope:'global' as const,title:'Preference',summary:'Notes',tags:[],updatedAt:1,provenance:{kind:'assistant_candidate' as const,candidateId:'candidate',loopRunId:'origin',backend:'layered' as const,evidenceRefs:candidate.evidenceRefs}};
 const reader=createAssistantPublicationContextReader({store:store as never,evidenceStore:{} as never,publication:{} as never,derivedVisibility,memoryOwner:()=>({ownerId:'local',profileId:profile.id,cwd:'/work'}),readMemoryConfirmationFacts:()=>({candidate,run:{id:'origin',status:'success'},revision:'raw-facts-revision',isCurrent:()=>current}) as never});
 const confirmation=reader.confirmMemory(record);expect(confirmation?.isCurrent()).toBe(true);expect(forbidden).not.toHaveBeenCalled();current=false;expect(confirmation?.isCurrent()).toBe(false);
 const noDedicated=createAssistantPublicationContextReader({store:store as never,evidenceStore:{} as never,publication:{} as never,derivedVisibility,memoryOwner:()=>({ownerId:'local',profileId:profile.id,cwd:'/work'})});
 expect(noDedicated.confirmMemory(record)).toBeUndefined();expect(forbidden).not.toHaveBeenCalled();
});

it('keeps an unavailable latest check as a barrier rather than resurrecting an older morning suggestion',async()=>{
 const f=fixture('revoked-check');
 f.runs.push({id:'revoked-check',loopId:ASSISTANT_CHECK_LOOP_ID,status:'success',summary:''});
 Object.assign(f.runs.find(run=>run.id==='revoked-check')!,{finishedAt:200,updatedAt:200,evidenceIds:[],trigger:{kind:'source_unavailable'}});
 expect(await f.reader.listMorningSuggestions()).toEqual([]);expect(await f.reader.readMorningActionSource()).toBeUndefined();
});

it('distinguishes a proven empty check from an unavailable check barrier',async()=>{
 const f=fixture();f.runs.push({id:'empty-check',loopId:ASSISTANT_CHECK_LOOP_ID,status:'success',summary:''});Object.assign(f.runs.find(run=>run.id==='empty-check')!,{finishedAt:200,evidenceIds:['check-evidence']});
 const original=f.evidenceStore.listEvidenceForOwner.getMockImplementation()!;
 f.evidenceStore.listEvidenceForOwner.mockImplementation((...args:unknown[])=>args[1]==='empty-check'?[{id:'check-evidence',kind:'log_diagnostic',metadata:{assistantKind:'check',output:{schemaVersion:2,recommendations:[]}}}] as any:original());
 expect((await f.reader.listMorningSuggestions())[0]?.title).toBe('old evidence');
});
