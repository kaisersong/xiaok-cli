import type {MemoryRecord} from '../../src/ai/memory/store.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import {DEFAULT_PERSONAL_ASSISTANT_ID} from './assistant-types.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {assistantDerivedHash,assistantMemoryContentHash,type AssistantDerivedVisibility,type AssistantMemoryConfirmation} from './assistant-derived-lineage.js';
import {captureAssistantDerivedValue} from './assistant-derived-data.js';
/** A provenance hint locates original durable facts; it never is a grant. No
 * caller-provided approval or MemoryRecord field can replace these reads. */
export function createAssistantMemoryConfirmationReader(options:{store:LoopStore;evidenceStore:CompletionEvidenceStore;visibility:AssistantDerivedVisibility;owner():{ownerId:string;profileId:string;cwd:string};projectCwd(projectId:string):string|undefined}){
 const {store,evidenceStore,visibility}=options;
 return (raw:MemoryRecord):AssistantMemoryConfirmation|undefined=>{try{
  const record=captureAssistantDerivedValue(raw),owner=options.owner(),profile=store.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID),provenance=record.provenance;
  if(!owner.ownerId||owner.profileId!==profile?.id||profile.status!=='active'||provenance?.kind!=='assistant_candidate'||!['layered','fallback'].includes(provenance.backend))return undefined;
  const facts=store.captureAssistantMemoryConfirmationFacts(provenance.candidateId);if(!facts)return undefined;
  const candidate=facts.candidate;
  if(candidate.runId!==provenance.loopRunId||candidate.kind!=='memory'||candidate.status!=='accepted'||candidate.targetKind!=='memory'||candidate.targetId!==record.id||candidate.acceptedTargetRef!==`memory://${provenance.backend}/${record.id}`||candidate.scope!==record.scope||candidate.title!==record.title||candidate.content!==record.summary)return undefined;
  const projectCurrent=()=>record.scope!=='project'||!!candidate.projectId&&record.cwd===options.owner().cwd&&options.projectCwd(candidate.projectId)===record.cwd;
  if(!projectCurrent()||assistantDerivedHash(provenance.evidenceRefs)!==assistantDerivedHash(candidate.evidenceRefs))return undefined;
  const ordinary=()=>!store.getLoopRunPublicationBasis(candidate.runId)&&readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:candidate.runId})).kind==='ordinary';
  if(!ordinary()||!visibility.isRunVisible(candidate.runId)||facts.run.id!==candidate.runId||facts.run.status!=='success')return undefined;
  const evidence=evidenceStore.captureAssistantMemoryEvidenceFacts(facts.run.id,facts.run.evidenceIds);if(!evidence||!facts.isCurrent()||!evidence.isCurrent())return undefined;
  const required:Record<string,string[]>={task:['tasks'],task_snapshot:['tasks'],thread:['threads'],artifact:['artifacts'],kswarm_project:['projects'],timed_action:['automations'],meeting:['meetings'],knowledge_source:['artifacts']},scopes=new Set<string>(profile.dataScopes),lineage=visibility.readLineage(candidate.runId);
  if(!candidate.evidenceRefs.length||candidate.evidenceRefs.some(ref=>ref.kind==='calendar_observation'?!lineage?.calendar?.events.some(event=>event.id===ref.id):!required[ref.kind]||!required[ref.kind].every(scope=>scopes.has(scope))))return undefined;
  const ownerRevision=assistantDerivedHash({profile,owner}),contentHash=assistantMemoryContentHash(record),confirmationRevision=assistantDerivedHash({candidate,publicationRevision:facts.revision,evidenceRevision:evidence.revision});
  const isCurrent=()=>{try{return projectCurrent()&&ordinary()&&visibility.isRunVisible(candidate.runId)&&facts.isCurrent()&&evidence.isCurrent()&&assistantDerivedHash({profile:store.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID),owner:options.owner()})===ownerRevision;}catch{return false;}};
  return isCurrent()?Object.freeze({candidateId:candidate.id,confirmationRevision,contentHash,isCurrent}):undefined;
 }catch{return undefined;}};
}
