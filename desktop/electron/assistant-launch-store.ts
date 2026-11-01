import {randomUUID,createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {assistantWorkItemIdentity,projectAssistantActions,type AssistantActionSource} from './assistant-action-store.js';
import {ASSISTANT_LAUNCH_DRAFT_SCHEMA,ASSISTANT_LAUNCH_OPERATION_SCHEMA,type AssistantThreadTarget,type AssistantLaunchDomain,type AssistantLaunchDraft,type AssistantLaunchOperation} from '../shared/assistant-launch-contract.js';
export function migrateAssistantLaunch(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS assistant_launch_drafts(id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_operations(id TEXT PRIMARY KEY,draft_id TEXT UNIQUE NOT NULL,proposal_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_active_work_claims(work_identity TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_draft_links(draft_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_confirmation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_launch_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,code TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL);`);}
export function readAssistantLaunchDraft(db:DatabaseSync,id:string):AssistantLaunchDraft|undefined{const row=db.prepare('SELECT payload_json FROM assistant_launch_drafts WHERE id=?').get(id);return row?ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;}
export function readAssistantLaunchOperation(db:DatabaseSync,key:string,by:'id'|'draft_id'='id'):AssistantLaunchOperation|undefined{const row=by==='id'?db.prepare('SELECT payload_json FROM assistant_launch_operations WHERE id=?').get(key):db.prepare('SELECT payload_json FROM assistant_launch_operations WHERE draft_id=? OR id=(SELECT operation_id FROM assistant_launch_draft_links WHERE draft_id=?) LIMIT 1').get(key,key);return row?ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;}
export function listAssistantLaunchOperations(db:DatabaseSync):AssistantLaunchOperation[]{return db.prepare('SELECT payload_json FROM assistant_launch_operations ORDER BY rowid DESC LIMIT 10').all().map(row=>ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))));}
function audit(db:DatabaseSync,op:AssistantLaunchOperation,code:string,now:number){db.prepare('INSERT INTO assistant_launch_events(operation_id,code,digest,observed_at) VALUES(?,?,?,?)').run(op.operationId,code,op.requestDigest,now);}
function write(db:DatabaseSync,op:AssistantLaunchOperation,code:string){const value=ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(op);db.prepare('INSERT INTO assistant_launch_operations(id,draft_id,proposal_id,state,payload_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id,state=excluded.state,payload_json=excluded.payload_json').run(value.operationId,value.draftId,value.proposalId,value.state,JSON.stringify(value));db.prepare('INSERT INTO assistant_launch_draft_links(draft_id,operation_id) VALUES(?,?) ON CONFLICT(draft_id) DO NOTHING').run(value.draftId,value.operationId);audit(db,value,code,value.updatedAt);return value;}
function current(source:AssistantActionSource){if(source.profileId!=='default-personal-assistant'||!source.isCurrent())throw Error('assistant_launch_source_stale');}
export function prepareAssistantLaunchDraft(db:DatabaseSync,source:AssistantActionSource,input:{proposalId:string;expectedRevision:number;domain:AssistantLaunchDomain;now:number;candidateId?:string;reconfirmOperationId?:string;expectedOperationDigest?:string;threadTarget?:AssistantThreadTarget}):AssistantLaunchDraft{
 current(source);const proposal=projectAssistantActions(db,source,input.now).find(p=>p.id===input.proposalId);
 const previous=input.reconfirmOperationId?readAssistantLaunchOperation(db,input.reconfirmOperationId):undefined;
 const reconfirm=!!previous&&previous.state==='blocked'&&previous.taskId===null&&previous.proposalId===input.proposalId&&previous.requestDigest===input.expectedOperationDigest;
 const recommendation=reconfirm?source.recommendations.find(item=>assistantWorkItemIdentity(source.profileId,item)===previous!.workItemIdentity):undefined;
 if(!proposal||proposal.revision!==input.expectedRevision||(!reconfirm&&proposal.decision!=='open')||(!reconfirm&&proposal.validUntil<=input.now)||(input.reconfirmOperationId&&!recommendation))throw Error('assistant_launch_proposal_conflict');
 const prior=db.prepare('SELECT payload_json FROM assistant_launch_drafts WHERE proposal_id=? ORDER BY rowid DESC LIMIT 1').get(proposal.id);
 if(prior){const draft=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(JSON.parse(String(prior.payload_json)));if(draft.reconfirmOperationId===input.reconfirmOperationId&&draft.expectedOperationDigest===input.expectedOperationDigest&&draft.validUntil>input.now&&draft.sourceVector===source.sourceVector&&draft.proposalRevision===proposal.revision&&canonicalVerificationJson(draft.threadTarget??null)===canonicalVerificationJson(input.threadTarget??null)&&canonicalVerificationJson(draft.domain)===canonicalVerificationJson(input.domain)){current(source);return draft;}}
 const draft=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse({...(input.reconfirmOperationId?{reconfirmOperationId:input.reconfirmOperationId,expectedOperationDigest:input.expectedOperationDigest}:{}),...(input.candidateId?{candidateId:input.candidateId}:{}),id:randomUUID(),proposalId:proposal.id,proposalRevision:proposal.revision,sourceVector:source.sourceVector,workItemIdentity:proposal.workItemIdentity,title:recommendation?.title??proposal.title,instruction:recommendation?.action.instruction??proposal.instruction,domain:input.domain,...(input.threadTarget?{threadTarget:input.threadTarget}:{}),threadId:input.threadTarget?.threadId??randomUUID(),createdAt:input.now,validUntil:Math.min(input.now+600000,input.threadTarget?.goalBinding?.validUntil??input.threadTarget?.noGoalGuard?.validUntil??Infinity,reconfirm?source.publishedAt+86400_000:proposal.validUntil)});
 db.prepare('INSERT INTO assistant_launch_drafts(id,proposal_id,payload_json) VALUES(?,?,?)').run(draft.id,draft.proposalId,JSON.stringify(draft));current(source);return draft;
}
export function confirmAssistantLaunch(db:DatabaseSync,source:AssistantActionSource,input:{draftId:string;instruction:string;now:number}):AssistantLaunchOperation{
 const draft=readAssistantLaunchDraft(db,input.draftId);if(!draft)throw Error('assistant_launch_draft_missing');
 const old=readAssistantLaunchOperation(db,draft.id,'draft_id');if(old){if(old.instruction!==input.instruction)throw Error('assistant_launch_confirmation_conflict');return old;}
 current(source);if(draft.validUntil<=input.now)throw Error('assistant_launch_draft_expired');
 if(draft.reconfirmOperationId){
  const previous=readAssistantLaunchOperation(db,draft.reconfirmOperationId);
  if(!previous||previous.state!=='blocked'||previous.taskId!==null||previous.requestDigest!==draft.expectedOperationDigest||source.sourceVector!==draft.sourceVector)throw Error('assistant_launch_reconfirmation_denied');
  if(!source.recommendations.some(item=>assistantWorkItemIdentity(source.profileId,item)===previous.workItemIdentity))throw Error('assistant_launch_source_stale');
  const requestDigest=createHash('sha256').update(canonicalVerificationJson({profileId:source.profileId,proposalId:previous.proposalId,revision:draft.proposalRevision,sourceVector:source.sourceVector,instruction:input.instruction,domain:draft.domain,threadBinding:{kind:draft.threadTarget?'existing':'new',threadId:draft.threadId,allocationId:draft.id,target:draft.threadTarget??null}})).digest('hex');
  db.prepare('INSERT INTO assistant_launch_confirmation_history(operation_id,payload_json) VALUES(?,?)').run(previous.operationId,JSON.stringify(previous));
  const updated=write(db,{...previous,draftId:draft.id,instruction:input.instruction,requestDigest,domain:draft.domain,threadTarget:draft.threadTarget,threadId:draft.threadId,sourceVector:source.sourceVector,state:'accepted',errorCode:null,validUntil:draft.validUntil,updatedAt:input.now},'reconfirmed');
  current(source);return updated;
 }
 const proposal=projectAssistantActions(db,source,input.now).find(p=>p.id===draft.proposalId);
 if(!proposal||proposal.revision!==draft.proposalRevision||proposal.sourceVector!==draft.sourceVector||proposal.decision!=='open')throw Error('assistant_launch_proposal_conflict');
 const operationId=randomUUID(),requestDigest=createHash('sha256').update(canonicalVerificationJson({profileId:source.profileId,proposalId:proposal.id,revision:proposal.revision,sourceVector:source.sourceVector,instruction:input.instruction,domain:draft.domain,threadBinding:{kind:draft.threadTarget?'existing':'new',threadId:draft.threadId,allocationId:draft.id,target:draft.threadTarget??null}})).digest('hex');
 db.prepare('INSERT INTO assistant_active_work_claims(work_identity,operation_id) VALUES(?,?)').run(proposal.workItemIdentity,operationId);
 const op=write(db,{operationId,draftId:draft.id,proposalId:proposal.id,title:proposal.title,threadTarget:draft.threadTarget,threadId:draft.threadId,taskId:null,requestDigest,instruction:input.instruction,domain:draft.domain,sourceVector:source.sourceVector,workItemIdentity:proposal.workItemIdentity,state:'accepted',createdAt:input.now,updatedAt:input.now,validUntil:draft.validUntil,cancelRequestedAt:null,errorCode:null,taskStatus:null,resultDigest:null,resolvedDigest:null},'confirmed');
 const linked={...proposal,decision:'linked',revision:proposal.revision+1,updatedAt:input.now};
 db.prepare('UPDATE assistant_action_proposals SET revision=?,payload_json=? WHERE proposal_id=? AND revision=?').run(linked.revision,JSON.stringify(linked),proposal.id,proposal.revision);
 current(source);return op;
}
export function claimAssistantLaunchDispatch(db:DatabaseSync,id:string,taskId:string,now:number):AssistantLaunchOperation|undefined{
 const op=readAssistantLaunchOperation(db,id);if(!op||op.state!=='accepted')return undefined;
 if(op.validUntil<=now)return write(db,{...op,state:'blocked',errorCode:'confirmation_expired',updatedAt:now},'blocked');
 return write(db,{...op,taskId,state:'preparing',updatedAt:now},'dispatch_claimed');
}
export function consumeAssistantLaunchStart(db:DatabaseSync,source:AssistantActionSource,id:string,guard:()=>void,now:number):void{
 const op=readAssistantLaunchOperation(db,id);if(!op||op.state!=='preparing'||op.cancelRequestedAt!==null||op.validUntil<=now||source.sourceVector!==op.sourceVector)throw Error('assistant_launch_start_denied');
 guard();current(source);write(db,{...op,state:'start_committed',updatedAt:now},'start_committed');current(source);guard();
}
export function updateAssistantLaunchObservation(db:DatabaseSync,id:string,update:Partial<Pick<AssistantLaunchOperation,'state'|'errorCode'|'taskStatus'|'resultDigest'|'resolvedDigest'>>,now:number):AssistantLaunchOperation{
 const op=readAssistantLaunchOperation(db,id);if(!op)throw Error('assistant_launch_operation_missing');
 const unchanged=Object.entries(update).every(([key,value])=>op[key as keyof AssistantLaunchOperation]===value);if(unchanged)return op;
 const next=write(db,{...op,...update,updatedAt:now},'observed');
 if(next.taskStatus&&['completed','failed','cancelled'].includes(next.taskStatus))db.prepare('DELETE FROM assistant_active_work_claims WHERE operation_id=? AND work_identity=?').run(next.operationId,next.workItemIdentity);
 return next;
}
export function findAssistantLaunchTask(db:DatabaseSync,taskId:string):AssistantLaunchOperation|undefined{
 const row=db.prepare("SELECT payload_json FROM assistant_launch_operations WHERE json_extract(payload_json,'$.taskId')=? LIMIT 1").get(taskId);return row?ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))):undefined;
}
export function listAssistantLaunchRecovery(db:DatabaseSync):AssistantLaunchOperation[]{
 return db.prepare("SELECT payload_json FROM assistant_launch_operations WHERE state IN ('accepted','preparing','start_committed','outcome_unknown') OR json_extract(payload_json,'$.taskStatus') IN ('running','waiting_user') ORDER BY rowid").all().map(row=>ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(JSON.parse(String(row.payload_json))));
}

export function requestAssistantLaunchCancel(db:DatabaseSync,id:string,now:number):AssistantLaunchOperation{
 const op=readAssistantLaunchOperation(db,id);if(!op)throw Error('assistant_launch_operation_missing');
 if(op.state==='cancelled'||op.taskStatus&&['completed','failed','cancelled'].includes(op.taskStatus))return op;
 const proven=!op.taskId&&['accepted','blocked'].includes(op.state);
 const next=write(db,{...op,cancelRequestedAt:op.cancelRequestedAt??now,state:proven?'cancelled':op.state,errorCode:proven?null:'cancel_pending',updatedAt:now},'cancel_requested');
 if(proven)db.prepare('DELETE FROM assistant_active_work_claims WHERE operation_id=?').run(op.operationId);
 return next;
}
