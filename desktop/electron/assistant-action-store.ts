import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseAssistantActionRecommendation,type AssistantActionRecommendation} from '../../src/runtime/assistant/action-recommendation.js';
import {ASSISTANT_ACTION_PROPOSAL_SCHEMA,type AssistantActionProposalDto,type AssistantActionDecisionResultDto} from '../shared/assistant-action-contract.js';
export interface AssistantActionSource {
 profileId:'default-personal-assistant';runId:string;sourceVector:string;publishedAt:number;
 recommendations:readonly AssistantActionRecommendation[];
 /** Main-only observation closure, never serializable authority. */
 isCurrent():boolean;
}
export function migrateAssistantActions(db:DatabaseSync, original: LoopDatabaseLease):void{
 assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_action_proposals (
 proposal_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, work_identity TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload_json TEXT NOT NULL,
 UNIQUE(profile_id,work_identity));`);
}
function readRow(db:DatabaseSync, original: LoopDatabaseLease,profileId:string,id:string):AssistantActionProposalDto|undefined{
 const row=assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_action_proposals WHERE profile_id=? AND proposal_id=?',profileId,id);
 return row?ASSISTANT_ACTION_PROPOSAL_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;
}
function guard(source:AssistantActionSource):void{
 if(source.profileId!=='default-personal-assistant'||!source.runId||!Number.isFinite(source.publishedAt)||! /^[a-f0-9]{64}$/.test(source.sourceVector)||source.isCurrent()!==true)throw Error('assistant_action_source_unavailable');
}
export function assistantWorkItemIdentity(profileId:string,r:AssistantActionRecommendation):string{
 const references=r.evidenceRefs.map(ref=>JSON.stringify([ref.kind,ref.id])).sort();
 return createHash('sha256').update(JSON.stringify([profileId,r.action.kind,[...new Set(references)]])).digest('hex');
}
export function projectAssistantActions(db:DatabaseSync, original: LoopDatabaseLease,source:AssistantActionSource,now:number):AssistantActionProposalDto[]{
 guard(source);if(!Number.isFinite(now)||source.recommendations.length>3)throw Error('assistant_action_projection_invalid');
 const result:AssistantActionProposalDto[]=[],seen=new Set<string>();
 for(const value of source.recommendations){
  const r=parseAssistantActionRecommendation(value);
  const workItemIdentity=assistantWorkItemIdentity(source.profileId,r);
  const id=`assistant-action-${workItemIdentity}`;
  if(seen.has(id))continue;seen.add(id);
  const existing=readRow(db, original,source.profileId,id);
  const suppressed=existing?.decision==='dismissed'&&now-existing.updatedAt<14*86400_000;
  if(existing&&(suppressed||existing.decision==='linked')){result.push(existing);continue;}
  const validUntil=source.publishedAt+86400_000;
  const decision=now>=validUntil?'expired':existing?.decision==='snoozed'&&(existing.snoozeUntil??0)>now?'snoozed':'open';
  const next=ASSISTANT_ACTION_PROPOSAL_SCHEMA.parse({
   schemaVersion:2,id,profileId:source.profileId,revision:existing?.revision??1,workItemIdentity,
   originRunId:source.runId,sourceVector:source.sourceVector,actionKind:r.action.kind,title:r.title,
   reason:r.action.reason,nextStep:r.action.nextStep,instruction:r.action.instruction,evidenceRefs:r.evidenceRefs,
   decision,createdAt:existing?.createdAt??now,updatedAt:existing?.updatedAt??now,validUntil,
   snoozeUntil:decision==='snoozed'?existing!.snoozeUntil:null,startAvailability:'unavailable',
  });
  if(existing&&JSON.stringify(existing)===JSON.stringify(next)){result.push(existing);continue;}
  if(existing){next.revision=existing.revision+1;next.updatedAt=now;
   assistantOwnedRun(db,original,'UPDATE assistant_action_proposals SET revision=?,payload_json=? WHERE proposal_id=? AND profile_id=? AND revision=?',next.revision,JSON.stringify(next),id,source.profileId,existing.revision);
  }else assistantOwnedRun(db,original,'INSERT INTO assistant_action_proposals(proposal_id,profile_id,work_identity,revision,payload_json) VALUES(?,?,?,?,?)',id,source.profileId,workItemIdentity,1,JSON.stringify(next));
  result.push(next);
 }
 guard(source);return result;
}
export function decideAssistantAction(db:DatabaseSync, original: LoopDatabaseLease,source:AssistantActionSource,input:{proposalId:string;expectedRevision:number;decision:'dismissed'|'snoozed';snoozeUntil?:number;now:number}):AssistantActionDecisionResultDto{
 const current=projectAssistantActions(db, original,source,input.now).find(row=>row.id===input.proposalId);
 if(!current||current.revision!==input.expectedRevision||current.sourceVector!==source.sourceVector||!['open','snoozed'].includes(current.decision))return {status:'conflict',proposal:current??null};
 const next=ASSISTANT_ACTION_PROPOSAL_SCHEMA.parse({...current,revision:current.revision+1,decision:input.decision,updatedAt:input.now,snoozeUntil:input.decision==='snoozed'?input.snoozeUntil:null});
 const update=assistantOwnedRun(db,original,'UPDATE assistant_action_proposals SET revision=?,payload_json=? WHERE proposal_id=? AND profile_id=? AND revision=?',next.revision,JSON.stringify(next),next.id,source.profileId,current.revision);
 guard(source);
 return Number(update.changes)===1?{status:'updated',proposal:next}:{status:'conflict',proposal:readRow(db, original,source.profileId,next.id)??null};
}
