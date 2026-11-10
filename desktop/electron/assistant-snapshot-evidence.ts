import type {AssistantEvidenceRef} from './assistant-llm.js';
/** Only explicit fact references supplied by the main composition count. Source
 * prose and model-created keys can never extend this allowlist. */
export function assistantSnapshotEvidence(snapshot:unknown):AssistantEvidenceRef[]{
  const outer=record(snapshot),current=record(outer?.current)??outer;
  const refs:AssistantEvidenceRef[]=[];
  for(const item of Array.isArray(current?.items)?current.items:[]){
    const reference=record(record(item)?.reference);
    if(typeof reference?.kind==='string'&&reference.kind.trim()&&typeof reference.id==='string'&&reference.id.trim())refs.push({kind:reference.kind,id:reference.id});
  }
  for(const value of Array.isArray(outer?.pendingCandidates)?outer.pendingCandidates:[]){
    const candidate=record(value);
    if(typeof candidate?.id==='string'&&candidate.id.trim())refs.push({kind:'assistant_candidate',id:candidate.id});
  }
  const evening=record(outer?.latestEvening);
  if(typeof evening?.runId==='string'&&evening.runId.trim()&&typeof evening.summary==='string'&&evening.summary.trim())refs.push({kind:'loop_run',id:evening.runId});
  return refs;
}
function record(value:unknown):Record<string,unknown>|undefined{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
