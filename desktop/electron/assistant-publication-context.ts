import {ASSISTANT_MESSAGE_SCHEMA,type AssistantMessage} from '../shared/assistant-inbox-contract.js';
import {validateMorningBriefing} from './assistant-llm.js';
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
  async readMorningRun(runId:string,requestSource:'user'|'scheduler'='scheduler'){
   if(store.getLoopRun(runId)?.loopId!==ASSISTANT_MORNING_LOOP_ID)return undefined;
   const observation=await read(runId,requestSource);if(!observation?.current())return undefined;
   try{let output:unknown;let evidenceJson:string|undefined;
    if(observation.kind==='protected'){if(observation.output.body.kind!=='assistant-morning')return undefined;output=observation.output.body;}
    else {const rows=evidenceStore.listEvidenceForOwner('loop_run',runId);evidenceJson=json(JSON.parse(JSON.stringify(rows)));output=rows.find(e=>e.metadata.assistantKind==='morning')?.metadata.output;}
    const parsed=validateMorningBriefing(output);if(!observation.current())return undefined;
    return {titles:parsed.recommendations.map(r=>r.title),current:()=>{try{return observation.current()&&(evidenceJson===undefined||json(JSON.parse(JSON.stringify(evidenceStore.listEvidenceForOwner('loop_run',runId))))===evidenceJson);}catch{return false;}}};
   }catch{return undefined;}
  },
  async readMorningConversation(locale:'zh'|'en'){
   const runs=store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,10).filter(r=>r.status==='success');
   const observations: Array<{run:typeof runs[number];value:{titles:string[];current():boolean}}>=[];
   for(const run of runs){const value=await this.readMorningRun(run.id,'user');if(value)observations.push({run,value});}
   const current=()=>observations.every(o=>o.value.current())&&JSON.stringify(store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,10).filter(r=>r.status==='success').map(r=>[r.id,r.finishedAt]))===JSON.stringify(runs.map(r=>[r.id,r.finishedAt]));
   if(!current())return {messages:[] as AssistantMessage[],suggestions:[],current};
   const en=locale==='en';
   const messages:AssistantMessage[]=observations.flatMap(({run,value})=>{
    if(typeof run.finishedAt!=='number'||!Number.isFinite(run.finishedAt)||run.finishedAt<0)return [];
    const message=ASSISTANT_MESSAGE_SCHEMA.safeParse({id:`assistant-morning:${run.id}`,kind:'morning' as const,createdAt:run.finishedAt,title:en?'Morning suggestions':'晨间建议',text:value.titles.length?(en?'Here are some things worth your attention today:':'今天有这些事情值得关注：')+'\n\n'+value.titles.slice(0,3).map(t=>`- ${t}`).join('\n'):(en?'There are no new suggestions this morning.':'今天早上暂无新增建议。')});
    return message.success?[message.data]:[];
   });
   const latest=observations.find(o=>o.run.id===runs[0]?.id);
   const suggestions=latest?.value.titles.slice(0,3).map((title,index)=>({id:`${latest.run.id}:${index}`,title,summary:''}))??[];
   return {messages,suggestions,current};
  },
  async listMorningMessages(locale:'zh'|'en'){const result=await this.readMorningConversation(locale);return result.current()?result.messages:[];},
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
