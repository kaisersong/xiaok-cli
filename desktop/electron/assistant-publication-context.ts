import type {AssistantCandidate} from './assistant-types.js';
import type {LoopRun} from './loop-types.js';
import {assistantDerivedHash,assistantMemoryContentHash,hasAssistantExternalLineage,type AssistantDerivedVisibility,type AssistantMemoryConfirmation} from './assistant-derived-lineage.js';
import type {MemoryRecord} from '../../src/ai/memory/store.js';
import {parseAssistantActionRecommendation} from '../../src/runtime/assistant/action-recommendation.js';
import {createHash} from 'node:crypto';
import {validateMorningBriefingStructure} from './assistant-llm.js';
import type {AssistantActionSource} from './assistant-action-store.js';
import type {AssistantActionRecommendation} from '../../src/runtime/assistant/action-recommendation.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {ASSISTANT_CHECK_LOOP_ID,ASSISTANT_EVENING_LOOP_ID,ASSISTANT_MORNING_LOOP_ID} from './assistant-types.js';
import {buildAssistantMorningContext} from './assistant-morning-context.js';
import {listLatestMorningSuggestions} from './assistant-morning-suggestions.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';

export interface AssistantMemoryPublicationFacts {candidate:AssistantCandidate;run:LoopRun;revision:string;isCurrent():boolean}

type Output=Awaited<ReturnType<DesktopLoopPublicationService['readAssistantOutput']>>;
/** Main-only read composition. Each result is an observation for this call, never
 * an acceptance capability or a reusable freshness cache. */
export function createAssistantPublicationContextReader(options:{
 store:LoopStore;evidenceStore:CompletionEvidenceStore;publication:DesktopLoopPublicationService;
 derivedVisibility?:AssistantDerivedVisibility;
 memoryOwner?:()=>{ownerId:string;profileId:string;cwd:string};
 projectCwd?:(projectId:string)=>string|undefined;
 /** Raw finite accepted-candidate/publication facts, not the gated public readers. */
 readMemoryConfirmationFacts?:(candidateId:string)=>AssistantMemoryPublicationFacts|undefined;
}){
 const {store,evidenceStore,publication}=options;
 const visible=(runId:string)=>!options.derivedVisibility||options.derivedVisibility.isRunVisible(runId);
 function displayOnly(runId:string){try{const lineage=options.derivedVisibility?.readLineage(runId);return !!lineage&&hasAssistantExternalLineage(lineage);}catch{return true;}}
 function route(runId:string){return readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:runId}));}
 function ordinarySnapshot(runId:string){
  // Store record mappers expose absent optional fields as undefined. Compare
  // their durable JSON representation, not a stricter transport input schema.
  return JSON.parse(JSON.stringify({run:store.getLoopRun(runId),members:store.listAssistantCandidates().filter(c=>c.runId===runId)})) as {run?:ReturnType<LoopStore['getLoopRun']>;members:ReturnType<LoopStore['listAssistantCandidates']>};
 }
 async function read(runId:string,requestSource:'user'|'scheduler'){
  try{
   if(!visible(runId))return undefined;
   const originalRoute=route(runId),routeJson=json(originalRoute);
   if(originalRoute.kind==='unavailable')return undefined;
   const protectedRun=!!store.getLoopRunPublicationBasis(runId)||originalRoute.kind!=='ordinary';
   if(protectedRun){
    const output:Output=await publication.readAssistantOutput({runId,requestSource});
    const current=()=>{try{return visible(runId)&&json(route(runId))===routeJson&&store.getLoopBusinessProjectionTarget(runId).vector===output.vector;}catch{return false;}};
    if(!current()||output.rows.run.status!=='success')return undefined;
    return {kind:'protected' as const,output,current};
   }
   const snapshot=ordinarySnapshot(runId),encoded=json(snapshot);
   const current=()=>{try{return visible(runId)&&json(route(runId))===routeJson&&!store.getLoopRunPublicationBasis(runId)&&json(ordinarySnapshot(runId))===encoded;}catch{return false;}};
   if(snapshot.run?.status!=='success')return undefined;
   return {kind:'ordinary' as const,snapshot,current};
  }catch{return undefined;}
 }
 function latestActionRun(){
  const morning=store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,10).filter(run=>run.status==='success');
  const checks=store.listLoopRuns(ASSISTANT_CHECK_LOOP_ID,10).filter(run=>{
   if(run.status!=='success')return false;
   // An unavailable newest run is a barrier, not proof of an empty check. Keep
   // its identity so later reads cannot resurrect an older action source.
   if(!visible(run.id)||store.getLoopRunPublicationBasis(run.id)||route(run.id).kind!=='ordinary')return true;
   const ids=new Set(run.evidenceIds),entries=evidenceStore.listEvidenceForOwner('loop_run',run.id).filter(entry=>ids.has(entry.id)&&entry.kind==='log_diagnostic'&&entry.metadata.assistantKind==='check');
   if(entries.length!==1)return true;
   const output=entries[0].metadata.output as {schemaVersion?:unknown;recommendations?:unknown}|undefined;
   if(output?.schemaVersion!==2||!Array.isArray(output.recommendations))return true;
   return output.recommendations.length>0;
  });
  return [...morning,...checks].sort((a,b)=>(b.finishedAt??b.updatedAt??b.startedAt??0)-(a.finishedAt??a.updatedAt??a.startedAt??0))[0];
 }
 async function readMorningSource(requestSource:'user'|'scheduler',allowExternal:boolean):Promise<AssistantActionSource|undefined>{
   if(!['user','scheduler'].includes(requestSource))return undefined;
   const run=latestActionRun();
   if(!run||!allowExternal&&displayOnly(run.id))return undefined;
   const observation=await read(run.id,requestSource);if(!observation?.current())return undefined;
   const selectedRunJson=JSON.stringify(run);
   const stillLatest=()=>{const latest=latestActionRun();return latest?.id===run.id&&JSON.stringify(latest)===selectedRunJson;};
   try{
    let raw:unknown,ordinaryEvidenceJson:string|undefined;
    if(observation.kind==='protected'){
     if(observation.output.body.kind!=='assistant-morning'||observation.output.body.schemaVersion!==2)return undefined;
     raw={schemaVersion:2,recommendations:observation.output.body.recommendations};
    }else{
     const committedIds=new Set(run.evidenceIds);
     const entries=evidenceStore.listEvidenceForOwner('loop_run',run.id).filter(entry=>committedIds.has(entry.id)&&entry.kind==='log_diagnostic');
     ordinaryEvidenceJson=JSON.stringify(entries);
     raw=entries.find(entry=>entry.metadata.assistantKind===(run.loopId===ASSISTANT_CHECK_LOOP_ID?'check':'morning')&&(entry.metadata.output as {schemaVersion?:unknown})?.schemaVersion===2)?.metadata.output;
    }
    if(!raw)return undefined;
    const output=validateMorningBriefingStructure(raw);if(output.schemaVersion!==2)return undefined;
    const profile=store.getAssistantProfile('default-personal-assistant');if(!profile)return undefined;
    const profileJson=JSON.stringify(profile),scopes=new Set<string>(profile.dataScopes);
    const lineage=options.derivedVisibility?.readLineage(run.id),lineageRevision=assistantDerivedHash(lineage??null);
    const required:Record<string,string[]>={task:['tasks'],task_snapshot:['tasks'],thread:['threads'],artifact:['artifacts'],kswarm_project:['projects'],timed_action:['automations'],meeting:['meetings'],knowledge_source:['artifacts'],assistant_candidate:['threads','projects','tasks','artifacts','automations','meetings'],loop_run:['threads','projects','tasks','artifacts','automations','meetings']};
    if(output.recommendations.some(item=>item.evidenceRefs.some(ref=>{
     if(ref.kind==='calendar_observation')return !allowExternal||!lineage?.calendar?.events.some(event=>event.id===ref.id);
     if(ref.kind==='memory_context')return !allowExternal||!lineage?.memory?.records.some(record=>record.id===ref.id);
     return !required[ref.kind]||!required[ref.kind].every(scope=>scopes.has(scope));
    })))return undefined;
    const sourceVector=createHash('sha256').update(json({runId:run.id,output,lineageRevision,
      vector:observation.kind==='protected'?observation.output.vector:ordinaryEvidenceJson??''})).digest('hex');
    const isCurrent=()=>{try{return JSON.stringify(store.getAssistantProfile('default-personal-assistant'))===profileJson&&assistantDerivedHash(options.derivedVisibility?.readLineage(run.id)??null)===lineageRevision&&stillLatest()&&observation.current()&&(observation.kind==='protected'||JSON.stringify(evidenceStore.listEvidenceForOwner('loop_run',run.id).filter(entry=>run.evidenceIds.includes(entry.id)&&entry.kind==='log_diagnostic'))===ordinaryEvidenceJson);}catch{return false;}};
    if(!isCurrent()||!Number.isFinite(run.finishedAt??run.updatedAt))return undefined;
    return Object.freeze({profileId:'default-personal-assistant',runId:run.id,sourceVector,
      publishedAt:run.finishedAt??run.updatedAt,recommendations:output.recommendations as AssistantActionRecommendation[],isCurrent});
   }catch{return undefined;}
  }
 function readMorningDisplaySource(requestSource:'user'|'scheduler'='user'){return readMorningSource(requestSource,true);}
 function readMorningActionSource(requestSource:'user'|'scheduler'='user'){return readMorningSource(requestSource,false);}
 function confirmMemory(record:MemoryRecord):AssistantMemoryConfirmation|undefined{
  try{
   const owner=options.memoryOwner?.(),profile=store.getAssistantProfile('default-personal-assistant'),provenance=record.provenance;
   if(!owner||!owner.ownerId||owner.profileId!==profile?.id||profile.status!=='active'||provenance?.kind!=='assistant_candidate'||!['layered','fallback'].includes(provenance.backend))return undefined;
   let facts=options.readMemoryConfirmationFacts?.(provenance.candidateId);
   if(!facts){
    if(options.derivedVisibility)return undefined; // Never recurse through gated public getters.
    const member=store.getAssistantCandidate(provenance.candidateId);if(!member)return undefined;
    const original=ordinarySnapshot(member.runId);if(!original.run)return undefined;
    const revision=assistantDerivedHash(original);
    facts={candidate:member,run:original.run,revision,isCurrent:()=>assistantDerivedHash(ordinarySnapshot(member.runId))===revision};
   }
   const candidate=facts.candidate;
   if(!candidate||candidate.runId!==provenance.loopRunId||candidate.kind!=='memory'||candidate.status!=='accepted'||candidate.targetKind!=='memory'||candidate.targetId!==record.id||candidate.acceptedTargetRef!==`memory://${provenance.backend}/${record.id}`||candidate.scope!==record.scope||candidate.title!==record.title||candidate.content!==record.summary)return undefined;
   if(record.scope==='project'&&(!candidate.projectId||!record.cwd||record.cwd!==owner.cwd||options.projectCwd?.(candidate.projectId)!==record.cwd))return undefined;
   if(!visible(candidate.runId)||store.getLoopRunPublicationBasis(candidate.runId)||route(candidate.runId).kind!=='ordinary')return undefined;
   if(facts.run.id!==candidate.runId||facts.run.status!=='success'||!facts.isCurrent())return undefined;
   const scopes=new Set<string>(profile.dataScopes),required:Record<string,string[]>={task:['tasks'],task_snapshot:['tasks'],thread:['threads'],artifact:['artifacts'],kswarm_project:['projects'],timed_action:['automations'],meeting:['meetings'],knowledge_source:['artifacts']};
   const lineage=options.derivedVisibility?.readLineage(candidate.runId);
   if(candidate.evidenceRefs.some(ref=>ref.kind==='calendar_observation'? !lineage?.calendar?.events.some(event=>event.id===ref.id):!required[ref.kind]||!required[ref.kind].every(scope=>scopes.has(scope))))return undefined;
   const encoded=assistantDerivedHash({profile,owner}),confirmationRevision=assistantDerivedHash({candidate,publicationRevision:facts.revision}),contentHash=assistantMemoryContentHash(record);
   const isCurrent=()=>{try{return visible(candidate.runId)&&!store.getLoopRunPublicationBasis(candidate.runId)&&route(candidate.runId).kind==='ordinary'&&facts!.isCurrent()&&assistantDerivedHash({profile:store.getAssistantProfile('default-personal-assistant'),owner:options.memoryOwner?.()})===encoded;}catch{return false;}};
   return isCurrent()?{candidateId:candidate.id,confirmationRevision,contentHash,isCurrent}:undefined;
  }catch{return undefined;}
 }
 return Object.freeze({
  confirmMemory,
  readMorningDisplaySource,
  readMorningActionSource,
  async readAcceptedFollowUpSource(candidateId:string):Promise<AssistantActionSource|undefined>{
   try{
    const candidate=store.getAssistantCandidate(candidateId);
    if(!candidate||displayOnly(candidate.runId)||candidate.kind!=='follow_up'||candidate.status!=='accepted'||!candidate.acceptedTargetRef?.startsWith('draft://'))return undefined;
    const observation=await read(candidate.runId,'user');if(!observation?.current())return undefined;
    const profile=store.getAssistantProfile('default-personal-assistant');if(!profile||['threads','projects','tasks','artifacts','automations','meetings'].some(scope=>!profile.dataScopes.includes(scope as never)))return undefined;
    const encoded=JSON.stringify(candidate),profileJson=JSON.stringify(profile);
    const isCurrent=()=>{try{return observation.current()&&JSON.stringify(store.getAssistantCandidate(candidateId))===encoded&&JSON.stringify(store.getAssistantProfile('default-personal-assistant'))===profileJson;}catch{return false;}};
    if(!isCurrent()||!Number.isFinite(candidate.decidedAt))return undefined;
    const recommendation=parseAssistantActionRecommendation({title:candidate.title,reasonCode:'accepted_follow_up',evidenceRefs:candidate.evidenceRefs,action:{kind:'follow_up',reason:profile.locale==='zh'?'已采纳的跟进事项':'An accepted follow-up',nextStep:profile.locale==='zh'?'按确认要求处理并保留结果证据':'Carry out the confirmed requirements and retain evidence',instruction:candidate.content}});
    return {profileId:'default-personal-assistant',runId:candidate.runId,sourceVector:createHash('sha256').update(json({candidate:JSON.parse(encoded),vector:observation.kind==='protected'?observation.output.vector:'ordinary'})).digest('hex'),publishedAt:candidate.decidedAt!,recommendations:[recommendation],isCurrent};
   }catch{return undefined;}
  },
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
   const context=buildAssistantMorningContext({snapshot:input.snapshot,pinnedThreadIds:input.pinnedThreadIds,
    eveningRun:evening&&summary?{id:evening.id,status:'success',summary}:undefined,
    pendingCandidates:pending.flatMap(candidate=>{
     const observation=observations.get(candidate.runId);if(!observation)return [];
     const member=observation.kind==='protected'?observation.output.rows.members.find(m=>m.id===candidate.id):observation.snapshot.members.find(m=>m.id===candidate.id);
     return member?.status==='pending'?[{id:member.id,kind:member.kind,title:member.title}]:[];
    }),
   });
   return {...context,derivedRunIds:[...new Set([...(context.latestEvening&&evening?[evening.id]:[]),...pending.filter(c=>context.pendingCandidates.some(p=>p.id===c.id)).map(c=>c.runId)])].filter(runId=>!!options.derivedVisibility?.readLineage(runId))};
  },
  async listMorningSuggestions(){
   const run=latestActionRun();if(!run)return [];
   const observation=await read(run.id,'user');if(!observation?.current()||latestActionRun()?.id!==run.id)return [];
   if(observation.kind==='protected'){
    if(observation.output.body.kind!=='assistant-morning')return [];
    const body=observation.output.body;
    if(body.schemaVersion===2){const source=await readMorningDisplaySource('user');return source?.recommendations.map((item,index)=>({id:`${source.runId}:${index}`,title:item.title,summary:item.action.reason}))??[];}
    return listLatestMorningSuggestions({listRuns:()=>[run],listEvidence:()=>[{metadata:{assistantKind:'morning',output:body}}]});
   }
   const evidence=evidenceStore.listEvidenceForOwner('loop_run',run.id);
   if(evidence.some(entry=>(entry.metadata.output as {schemaVersion?:unknown})?.schemaVersion===2)){const source=await readMorningDisplaySource('user');return source?.recommendations.map((item,index)=>({id:`${source.runId}:${index}`,title:item.title,summary:item.action.reason}))??[];}
   if(!observation.current())return [];
   return listLatestMorningSuggestions({listRuns:()=>[run],listEvidence:()=>evidence});
  },
 });
}
