import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {ASSISTANT_EVENING_LOOP_ID,ASSISTANT_MORNING_LOOP_ID} from './assistant-types.js';
import {buildAssistantMorningContext} from './assistant-morning-context.js';
import {listLatestMorningSuggestions} from './assistant-morning-suggestions.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';

type Output=Awaited<ReturnType<DesktopLoopPublicationService['readAssistantOutput']>>;
/** Main-only read composition. Each result is an observation for this call, never
 * an acceptance capability or a reusable freshness cache. */
export function createAssistantPublicationContextReader(options:{
 store:LoopStore;evidenceStore:CompletionEvidenceStore;publication:DesktopLoopPublicationService;
}){
 const {store,evidenceStore,publication}=options;
 function route(runId:string){return readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:runId}));}
 function ordinarySnapshot(runId:string){
  // Store record mappers expose absent optional fields as undefined. Compare
  // their durable JSON representation, not a stricter transport input schema.
  return JSON.parse(JSON.stringify({run:store.getLoopRun(runId),members:store.listAssistantCandidates().filter(c=>c.runId===runId)})) as {run?:ReturnType<LoopStore['getLoopRun']>;members:ReturnType<LoopStore['listAssistantCandidates']>};
 }
 async function read(runId:string,requestSource:'user'|'scheduler'){
  try{
   const originalRoute=route(runId),routeJson=json(originalRoute);
   if(originalRoute.kind==='unavailable')return undefined;
   const protectedRun=!!store.getLoopRunPublicationBasis(runId)||originalRoute.kind!=='ordinary';
   if(protectedRun){
    const output:Output=await publication.readAssistantOutput({runId,requestSource});
    const current=()=>{try{return json(route(runId))===routeJson&&store.getLoopBusinessProjectionTarget(runId).vector===output.vector;}catch{return false;}};
    if(!current()||output.rows.run.status!=='success')return undefined;
    return {kind:'protected' as const,output,current};
   }
   const snapshot=ordinarySnapshot(runId),encoded=json(snapshot);
   const current=()=>{try{return json(route(runId))===routeJson&&!store.getLoopRunPublicationBasis(runId)&&json(ordinarySnapshot(runId))===encoded;}catch{return false;}};
   if(snapshot.run?.status!=='success')return undefined;
   return {kind:'ordinary' as const,snapshot,current};
  }catch{return undefined;}
 }
 return Object.freeze({
  async buildMorningContext(input:{snapshot:unknown;pinnedThreadIds:string[]}){
   const evening=store.listLoopRuns(ASSISTANT_EVENING_LOOP_ID,10).find(run=>run.status==='success');
   const pending=store.listAssistantCandidates({statuses:['pending']}).slice(0,100);
   const observations=new Map<string,Awaited<ReturnType<typeof read>>>();
   for(const runId of new Set([...(evening?[evening.id]:[]),...pending.map(c=>c.runId)]))observations.set(runId,await read(runId,'scheduler'));
   // No await after this point. Recheck all local vectors/routes after the last
   // run read, before handing these factual snapshots to the pure mapper.
   for(const [id,value] of observations)if(!value?.current())observations.delete(id);
   const latestEvening=store.listLoopRuns(ASSISTANT_EVENING_LOOP_ID,10).find(run=>run.status==='success');
   const selected=evening&&latestEvening?.id===evening.id?observations.get(evening.id):undefined;
   const summary=selected?.kind==='protected'?(selected.output.body.kind==='assistant-evening'?selected.output.body.summary:undefined):(selected&&selected.kind==='ordinary'?selected.snapshot.run?.summary:undefined);
   return buildAssistantMorningContext({snapshot:input.snapshot,pinnedThreadIds:input.pinnedThreadIds,
    eveningRun:evening&&summary?{id:evening.id,status:'success',summary}:undefined,
    pendingCandidates:pending.flatMap(candidate=>{
     const observation=observations.get(candidate.runId);if(!observation)return [];
     const member=observation.kind==='protected'?observation.output.rows.members.find(m=>m.id===candidate.id):observation.snapshot.members.find(m=>m.id===candidate.id);
     return member?.status==='pending'?[{id:member.id,kind:member.kind,title:member.title}]:[];
    }),
   });
  },
  async listMorningSuggestions(){
   const run=store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,10).find(candidate=>candidate.status==='success');if(!run)return [];
   const observation=await read(run.id,'user');if(!observation?.current()||store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,10).find(candidate=>candidate.status==='success')?.id!==run.id)return [];
   if(observation.kind==='protected'){
    if(observation.output.body.kind!=='assistant-morning')return [];
    const body=observation.output.body;
    return listLatestMorningSuggestions({listRuns:()=>[run],listEvidence:()=>[{metadata:{assistantKind:'morning',output:body}}]});
   }
   const evidence=evidenceStore.listEvidenceForOwner('loop_run',run.id);
   if(!observation.current())return [];
   return listLatestMorningSuggestions({listRuns:()=>[run],listEvidence:()=>evidence});
  },
 });
}
