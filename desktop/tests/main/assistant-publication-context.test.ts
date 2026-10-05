import {beforeEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({kind:'ordinary' as string}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:route.kind})}));
import {createAssistantPublicationContextReader} from '../../electron/assistant-publication-context.js';
import {ASSISTANT_EVENING_LOOP_ID,ASSISTANT_MORNING_LOOP_ID} from '../../electron/assistant-types.js';
beforeEach(()=>{route.kind='ordinary';});
function fixture(){
 const runs=[{id:'evening',loopId:ASSISTANT_EVENING_LOOP_ID,status:'success',summary:'legacy summary'},{id:'morning',loopId:ASSISTANT_MORNING_LOOP_ID,status:'success',summary:''}];
 const candidates=[{id:'candidate',runId:'evening',kind:'memory',title:'original member',status:'pending'}];
 const vectors=new Map([['evening','evening-vector'],['morning','morning-vector']]);
 const protectedRuns=new Set<string>();
 const store={listLoopRuns:(id:string)=>runs.filter(r=>r.loopId===id),getLoopRun:(id:string)=>runs.find(r=>r.id===id),listAssistantCandidates:()=>structuredClone(candidates),getLoopRunPublicationBasis:(id:string)=>protectedRuns.has(id)?{}:undefined,getLoopBusinessProjectionTarget:(id:string)=>({vector:vectors.get(id)})};
 const publication={readAssistantOutput:vi.fn(async({runId}:{runId:string})=>({runId,vector:vectors.get(runId),rows:{run:{id:runId,status:'success'},members:[{id:'candidate',kind:'memory',title:'original member',status:'pending'}]},body:runId==='evening'?{kind:'assistant-evening',summary:'published summary',candidates:[]}:{kind:'assistant-morning',recommendations:[{title:'published recommendation',reasonCode:'verified',evidenceRefs:[{kind:'task',id:'task'}]}]}}))};
 const evidenceStore={listEvidenceForOwner:vi.fn(()=>[{metadata:{assistantKind:'morning',output:{recommendations:[{title:'old evidence',reasonCode:'old',evidenceRefs:[{kind:'task',id:'task'}]}]}}}])};
 return {runs,candidates,vectors,protectedRuns,publication,evidenceStore,reader:createAssistantPublicationContextReader({store:store as never,publication:publication as never,evidenceStore:evidenceStore as never})};
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
