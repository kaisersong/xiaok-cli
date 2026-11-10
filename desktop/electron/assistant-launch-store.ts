import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {randomUUID,createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {assistantWorkItemIdentity,projectAssistantActions,type AssistantActionSource} from './assistant-action-store.js';
import {ASSISTANT_LAUNCH_DRAFT_SCHEMA,ASSISTANT_LAUNCH_OPERATION_SCHEMA,type AssistantThreadTarget,type AssistantLaunchDomain,type AssistantLaunchDraft,type AssistantLaunchOperation} from '../shared/assistant-launch-contract.js';
export function migrateAssistantLaunch(db:DatabaseSync, original: LoopDatabaseLease){assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_launch_drafts(id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_operations(id TEXT PRIMARY KEY,draft_id TEXT UNIQUE NOT NULL,proposal_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_active_work_claims(work_identity TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_draft_links(draft_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_confirmation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,code TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL);`);}
export function readAssistantLaunchDraft(db:DatabaseSync, original: LoopDatabaseLease,id:string):AssistantLaunchDraft|undefined{const row=assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_launch_drafts WHERE id=?',id);return row?ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;}
export function readAssistantLaunchOperation(db:DatabaseSync, original: LoopDatabaseLease,key:string,by:'id'|'draft_id'='id'):AssistantLaunchOperation|undefined{const row=by==='id'?assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_launch_operations WHERE id=?',key):assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_launch_operations WHERE draft_id=? OR id=(SELECT operation_id FROM assistant_launch_draft_links WHERE draft_id=?) LIMIT 1',key,key);return row?ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;}
export function listAssistantLaunchOperations(db:DatabaseSync, original: LoopDatabaseLease):AssistantLaunchOperation[]{return assistantOwnedAll(db,original,'SELECT payload_json FROM assistant_launch_operations ORDER BY rowid DESC LIMIT 10').map(row=>ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))));}
function audit(db:DatabaseSync, original: LoopDatabaseLease,op:AssistantLaunchOperation,code:string,now:number){assistantOwnedRun(db,original,'INSERT INTO assistant_launch_events(operation_id,code,digest,observed_at) VALUES(?,?,?,?)',op.operationId,code,op.requestDigest,now);}
function write(db:DatabaseSync, original: LoopDatabaseLease,op:AssistantLaunchOperation,code:string){const value=ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(op);assistantOwnedRun(db,original,'INSERT INTO assistant_launch_operations(id,draft_id,proposal_id,state,payload_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id,state=excluded.state,payload_json=excluded.payload_json',value.operationId,value.draftId,value.proposalId,value.state,JSON.stringify(value));assistantOwnedRun(db,original,'INSERT INTO assistant_launch_draft_links(draft_id,operation_id) VALUES(?,?) ON CONFLICT(draft_id) DO NOTHING',value.draftId,value.operationId);audit(db, original,value,code,value.updatedAt);return value;}
function current(source:AssistantActionSource){if(source.profileId!=='default-personal-assistant'||!source.isCurrent())throw Error('assistant_launch_source_stale');}
export function prepareAssistantLaunchDraft(db:DatabaseSync, original: LoopDatabaseLease,source:AssistantActionSource,input:{proposalId:string;expectedRevision:number;domain:AssistantLaunchDomain;now:number;candidateId?:string;reconfirmOperationId?:string;expectedOperationDigest?:string;threadTarget?:AssistantThreadTarget}):AssistantLaunchDraft{
 current(source);const proposal=projectAssistantActions(db,original,source,input.now).find(p=>p.id===input.proposalId);
 const previous=input.reconfirmOperationId?readAssistantLaunchOperation(db, original,input.reconfirmOperationId):undefined;
 const reconfirm=!!previous&&previous.state==='blocked'&&previous.taskId===null&&previous.proposalId===input.proposalId&&previous.requestDigest===input.expectedOperationDigest;
 const recommendation=reconfirm?source.recommendations.find(item=>assistantWorkItemIdentity(source.profileId,item)===previous!.workItemIdentity):undefined;
 if(!proposal||proposal.revision!==input.expectedRevision||(!reconfirm&&proposal.decision!=='open')||(!reconfirm&&proposal.validUntil<=input.now)||(input.reconfirmOperationId&&!recommendation))throw Error('assistant_launch_proposal_conflict');
 const prior=assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_launch_drafts WHERE proposal_id=? ORDER BY rowid DESC LIMIT 1',proposal.id);
 if(prior){const draft=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(JSON.parse(String(prior.payload_json)));if(draft.reconfirmOperationId===input.reconfirmOperationId&&draft.expectedOperationDigest===input.expectedOperationDigest&&draft.validUntil>input.now&&draft.sourceVector===source.sourceVector&&draft.proposalRevision===proposal.revision&&canonicalVerificationJson(draft.threadTarget??null)===canonicalVerificationJson(input.threadTarget??null)&&canonicalVerificationJson(draft.domain)===canonicalVerificationJson(input.domain)){current(source);return draft;}}
 const draft=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse({...(input.reconfirmOperationId?{reconfirmOperationId:input.reconfirmOperationId,expectedOperationDigest:input.expectedOperationDigest}:{}),...(input.candidateId?{candidateId:input.candidateId}:{}),id:randomUUID(),proposalId:proposal.id,proposalRevision:proposal.revision,sourceVector:source.sourceVector,workItemIdentity:proposal.workItemIdentity,title:recommendation?.title??proposal.title,instruction:recommendation?.action.instruction??proposal.instruction,domain:input.domain,...(input.threadTarget?{threadTarget:input.threadTarget}:{}),threadId:input.threadTarget?.threadId??randomUUID(),createdAt:input.now,validUntil:Math.min(input.now+600000,input.threadTarget?.goalBinding?.validUntil??input.threadTarget?.noGoalGuard?.validUntil??Infinity,reconfirm?source.publishedAt+86400_000:proposal.validUntil)});
 assistantOwnedRun(db,original,'INSERT INTO assistant_launch_drafts(id,proposal_id,payload_json) VALUES(?,?,?)',draft.id,draft.proposalId,JSON.stringify(draft));current(source);return draft;
}
export function confirmAssistantLaunch(db:DatabaseSync, original: LoopDatabaseLease,source:AssistantActionSource,input:{draftId:string;instruction:string;now:number}):AssistantLaunchOperation{
 const draft=readAssistantLaunchDraft(db, original,input.draftId);if(!draft)throw Error('assistant_launch_draft_missing');
 const old=readAssistantLaunchOperation(db, original,draft.id,'draft_id');if(old){if(old.instruction!==input.instruction)throw Error('assistant_launch_confirmation_conflict');return old;}
 current(source);if(draft.validUntil<=input.now)throw Error('assistant_launch_draft_expired');
 if(draft.reconfirmOperationId){
  const previous=readAssistantLaunchOperation(db, original,draft.reconfirmOperationId);
  if(!previous||previous.state!=='blocked'||previous.taskId!==null||previous.requestDigest!==draft.expectedOperationDigest||source.sourceVector!==draft.sourceVector)throw Error('assistant_launch_reconfirmation_denied');
  if(!source.recommendations.some(item=>assistantWorkItemIdentity(source.profileId,item)===previous.workItemIdentity))throw Error('assistant_launch_source_stale');
  const requestDigest=createHash('sha256').update(canonicalVerificationJson({profileId:source.profileId,proposalId:previous.proposalId,revision:draft.proposalRevision,sourceVector:source.sourceVector,instruction:input.instruction,domain:draft.domain,threadBinding:{kind:draft.threadTarget?'existing':'new',threadId:draft.threadId,allocationId:draft.id,target:draft.threadTarget??null}})).digest('hex');
  assistantOwnedRun(db,original,'INSERT INTO assistant_launch_confirmation_history(operation_id,payload_json) VALUES(?,?)',previous.operationId,JSON.stringify(previous));
  const updated=write(db, original,{...previous,draftId:draft.id,instruction:input.instruction,requestDigest,domain:draft.domain,threadTarget:draft.threadTarget,threadId:draft.threadId,sourceVector:source.sourceVector,state:'accepted',errorCode:null,validUntil:draft.validUntil,updatedAt:input.now},'reconfirmed');
  current(source);return updated;
 }
 const proposal=projectAssistantActions(db,original,source,input.now).find(p=>p.id===draft.proposalId);
 if(!proposal||proposal.revision!==draft.proposalRevision||proposal.sourceVector!==draft.sourceVector||proposal.decision!=='open')throw Error('assistant_launch_proposal_conflict');
 const operationId=randomUUID(),requestDigest=createHash('sha256').update(canonicalVerificationJson({profileId:source.profileId,proposalId:proposal.id,revision:proposal.revision,sourceVector:source.sourceVector,instruction:input.instruction,domain:draft.domain,threadBinding:{kind:draft.threadTarget?'existing':'new',threadId:draft.threadId,allocationId:draft.id,target:draft.threadTarget??null}})).digest('hex');
 assistantOwnedRun(db,original,'INSERT INTO assistant_active_work_claims(work_identity,operation_id) VALUES(?,?)',proposal.workItemIdentity,operationId);
 const op=write(db, original,{operationId,draftId:draft.id,proposalId:proposal.id,title:proposal.title,threadTarget:draft.threadTarget,threadId:draft.threadId,taskId:null,submissionId:null,requestDigest,instruction:input.instruction,domain:draft.domain,sourceVector:source.sourceVector,workItemIdentity:proposal.workItemIdentity,state:'accepted',createdAt:input.now,updatedAt:input.now,validUntil:draft.validUntil,cancelRequestedAt:null,errorCode:null,taskStatus:null,resultDigest:null,resolvedDigest:null},'confirmed');
 const linked={...proposal,decision:'linked',revision:proposal.revision+1,updatedAt:input.now};
 assistantOwnedRun(db,original,'UPDATE assistant_action_proposals SET revision=?,payload_json=? WHERE proposal_id=? AND revision=?',linked.revision,JSON.stringify(linked),proposal.id,proposal.revision);
 current(source);return op;
}
export function claimAssistantLaunchDispatch(db:DatabaseSync, original: LoopDatabaseLease,id:string,taskId:string,now:number,submissionId:string):AssistantLaunchOperation|undefined{
 const op=readAssistantLaunchOperation(db, original,id);if(!op||!['accepted','preparing'].includes(op.state)||op.taskId!==null)return undefined;
 if(op.validUntil<=now)return write(db, original,{...op,state:'blocked',errorCode:'confirmation_expired',updatedAt:now},'blocked');
 return write(db, original,{...op,taskId,submissionId,state:'preparing',updatedAt:now},'dispatch_claimed');
}
export function consumeAssistantLaunchStart(db:DatabaseSync, original: LoopDatabaseLease,source:AssistantActionSource,id:string,guard:()=>void,now:number):void{
 const op=readAssistantLaunchOperation(db, original,id);if(!op||op.state!=='preparing'||op.cancelRequestedAt!==null||op.validUntil<=now||source.sourceVector!==op.sourceVector)throw Error('assistant_launch_start_denied');
 guard();current(source);write(db, original,{...op,state:'start_committed',updatedAt:now},'start_committed');current(source);guard();
}
export function updateAssistantLaunchObservation(db:DatabaseSync, original: LoopDatabaseLease,id:string,update:Partial<Pick<AssistantLaunchOperation,'state'|'errorCode'|'taskStatus'|'resultDigest'|'resolvedDigest'>>,now:number):AssistantLaunchOperation{
 const op=readAssistantLaunchOperation(db, original,id);if(!op)throw Error('assistant_launch_operation_missing');
 const unchanged=Object.entries(update).every(([key,value])=>op[key as keyof AssistantLaunchOperation]===value);if(unchanged)return op;
 const next=write(db, original,{...op,...update,updatedAt:now},'observed');
 if(next.taskStatus&&['completed','failed','cancelled'].includes(next.taskStatus))assistantOwnedRun(db,original,'DELETE FROM assistant_active_work_claims WHERE operation_id=? AND work_identity=?',next.operationId,next.workItemIdentity);
 return next;
}
export function findAssistantLaunchTask(db:DatabaseSync, original: LoopDatabaseLease,taskId:string):AssistantLaunchOperation|undefined{
 const row=assistantOwnedGet(db,original,"SELECT payload_json FROM assistant_launch_operations WHERE json_extract(payload_json,'$.taskId')=? LIMIT 1",taskId);return row?ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;
}
export function listAssistantLaunchRecovery(db:DatabaseSync, original: LoopDatabaseLease):AssistantLaunchOperation[]{
 return assistantOwnedAll(db,original,"SELECT payload_json FROM assistant_launch_operations WHERE state IN ('accepted','preparing','start_committed','outcome_unknown') OR json_extract(payload_json,'$.taskStatus') IN ('running','waiting_user') ORDER BY rowid").map(row=>ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))));
}

export function requestAssistantLaunchCancel(db:DatabaseSync, original: LoopDatabaseLease,id:string,now:number):AssistantLaunchOperation{
 const op=readAssistantLaunchOperation(db, original,id);if(!op)throw Error('assistant_launch_operation_missing');
 if(op.state==='cancelled'||op.taskStatus&&['completed','failed','cancelled'].includes(op.taskStatus))return op;
 const proven=!op.taskId&&['accepted','blocked'].includes(op.state);
 const next=write(db, original,{...op,cancelRequestedAt:op.cancelRequestedAt??now,state:proven?'cancelled':op.state,errorCode:proven?null:'cancel_pending',updatedAt:now},'cancel_requested');
 if(proven)assistantOwnedRun(db,original,'DELETE FROM assistant_active_work_claims WHERE operation_id=?',op.operationId);
 return next;
}
