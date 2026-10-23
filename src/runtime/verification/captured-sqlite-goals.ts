import {readProfileSourceCapture,readProfileSqliteSchema,readProfileSqliteRows} from './profile-source-capture.js';
import {capturedIdentity,capturedInteger,freezeCapturedData,parseCapturedSourceJson} from './captured-source-json.js';
import {readCapturedGoalSessions} from '../goal/file-store.js';
import {goalApplicationFromState,parseGoalCompletionIntent,type GoalCompletionIntent} from '../goal/completion-intent.js';
import {canonicalVerificationJson} from './protocol.js';
import {validateCapturedGoalCompletionIntents,type GoalPublicationAttempt} from '../goal/publication-attempt.js';
import type {GoalDocument,GoalState,GoalEvent,GoalTurnRecord,GoalEvidenceEnvelope} from '../goal/types.js';
import type {MetadataSessionQueryId} from './metadata-session-query-manifest.js';
import {GOAL_SOURCE_SCHEMA} from './goal-source-schema.js';

type Row=Readonly<Record<string,unknown>>;
interface GoalRecord {state:GoalState;events:GoalEvent[];turns:GoalTurnRecord[];evidence:GoalEvidenceEnvelope[];completionIntents:GoalCompletionIntent[];completionAttempts:GoalPublicationAttempt[]}
interface TaskBinding {bindingId:string;goalId:string;epoch:number;goalTurnId:string;threadId:string;taskId:string;origin:'user'|'continuation';ordinal:number;attachedAt:number|null}
interface ContextTask {contextId:string;goalId:string;threadId:string;taskId:string;ordinal:number;recordedAt:number}
interface GoalDeclaration {goalId:string;logicalContainerId:string;revision:number;epoch:number;declaration:ReturnType<typeof readCapturedGoalSessions>}
interface GoalSource {sourceId:string;snapshotHash:string;goals:GoalDeclaration[];pointers:Array<{logicalContainerId:string;currentGoalId:string;updatedAt:number}>;taskBindings:TaskBinding[];contextTasks:ContextTask[]}
function fail(reason:string):never{throw Error('captured_sqlite_goal_'+reason);}
// Historical epochs retain their original immutable application.
function validateIntentState(intent:GoalCompletionIntent,state:GoalState):void{
 if(intent.application.epoch===state.epoch&&canonicalVerificationJson(intent.application)!==canonicalVerificationJson(goalApplicationFromState(state)))fail('intent_application');
}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('json');return value as Record<string,unknown>;}
function json(raw:unknown):Record<string,unknown>{if(typeof raw!=='string')fail('json');return object(parseCapturedSourceJson(raw));}
function schema(owner:object,token:object,sourceId:string):void{
 const actual=readProfileSqliteSchema(owner,token,sourceId);
 if(actual.length!==GOAL_SOURCE_SCHEMA.length||actual.some((row,index)=>{const expected=GOAL_SOURCE_SCHEMA[index]!;return row.type!==expected.type||row.name!==expected.name||row.tbl_name!==expected.tbl_name
  ||(row.sql===null?null:typeof row.sql==='string'?row.sql.replace(/\s+/g,' ').trim():undefined)!==expected.sql;}))fail('schema');
}

/** Complete Goal source declarations only. Logical Goal container/thread IDs
 * are not native session attribution, ownership or migration authority. */
export function readCapturedSQLiteGoalSources(owner:object,token:object){
 const capture=readProfileSourceCapture(owner,token),sources:GoalSource[]=[];
 for(const entry of capture.sources){
  if(entry.source.kind!=='sqlite-db'||entry.source.snapshotFormat!=='goal-sqlite-v1')continue;
  const sourceId=entry.source.sourceId;schema(owner,token,sourceId);
  const rows=(query:MetadataSessionQueryId)=>readProfileSqliteRows(owner,token,sourceId,query);
  const goals=new Map<string,GoalRecord>();
  for(const row of rows('goal:goals')){
   capturedIdentity(row.goal_id);capturedIdentity(row.session_id);capturedInteger(row.revision,1);capturedInteger(row.epoch,1);capturedInteger(row.created_at);capturedInteger(row.updated_at,row.created_at);
   const state=json(row.state_json);
   if(goals.has(row.goal_id)||state.goalId!==row.goal_id||state.sessionId!==row.session_id||state.revision!==row.revision||state.epoch!==row.epoch||state.createdAt!==row.created_at||state.updatedAt!==row.updated_at)fail('state_row');
   goals.set(row.goal_id,{state:state as unknown as GoalState,events:[],turns:[],evidence:[],completionIntents:[],completionAttempts:[]});
  }
  const original=(row:Row):GoalRecord=>{capturedIdentity(row.goal_id);const goal=goals.get(row.goal_id);if(!goal)fail('orphan');return goal;};
  const eventIds=new Set<string>();
  for(const row of rows('goal:goal_events')){
   const goal=original(row),event=json(row.event_json);capturedIdentity(row.event_id);capturedInteger(row.revision,1);capturedInteger(row.recorded_at);
   if(eventIds.has(row.event_id)||row.session_id!==goal.state.sessionId||event.eventId!==row.event_id||event.goalId!==row.goal_id||event.revision!==row.revision||event.recordedAt!==row.recorded_at||row.revision>goal.state.revision)fail('event_row');
   eventIds.add(row.event_id);goal.events.push(event as unknown as GoalEvent);
  }
  const turnIds=new Set<string>();
  for(const row of rows('goal:goal_turns')){
   const goal=original(row),turn=json(row.turn_json);capturedIdentity(row.turn_id);capturedInteger(row.epoch,1);capturedInteger(row.recorded_at);const key=JSON.stringify([row.goal_id,row.epoch,row.turn_id]);
   if(turnIds.has(key)||turn.goalId!==row.goal_id||turn.epoch!==row.epoch||turn.turnId!==row.turn_id||turn.recordedAt!==row.recorded_at||row.epoch>goal.state.epoch)fail('turn_row');
   turnIds.add(key);goal.turns.push(turn as unknown as GoalTurnRecord);
  }
  const evidenceIds=new Set<string>();
  for(const row of rows('goal:goal_evidence')){
   const goal=original(row),evidence=json(row.evidence_json);capturedIdentity(row.evidence_id);capturedIdentity(row.goal_turn_id);capturedInteger(row.epoch,1);capturedInteger(row.recorded_at);
   if(evidenceIds.has(row.evidence_id)||evidence.evidenceId!==row.evidence_id||evidence.goalId!==row.goal_id||evidence.epoch!==row.epoch||evidence.goalTurnId!==row.goal_turn_id||evidence.recordedAt!==row.recorded_at)fail('evidence_row');
   evidenceIds.add(row.evidence_id);goal.evidence.push(evidence as unknown as GoalEvidenceEnvelope);
  }
  const intentIds=new Set<string>(),intentTurns=new Set<string>();
  for(const row of rows('goal:goal_completion_intents')){
   const goal=original(row),intent=parseGoalCompletionIntent(json(row.intent_json) as unknown as GoalCompletionIntent);capturedIdentity(row.intent_id);capturedIdentity(row.turn_id);capturedInteger(row.epoch,1);capturedInteger(row.revision,1);const key=JSON.stringify([row.goal_id,row.epoch,row.turn_id]);
   if(intentIds.has(row.intent_id)||intentTurns.has(key)||intent.intentId!==row.intent_id||intent.application.goalId!==row.goal_id||intent.application.sessionId!==goal.state.sessionId||intent.application.epoch!==row.epoch||intent.turnId!==row.turn_id||intent.revision!==row.revision||row.epoch>goal.state.epoch)fail('intent_row');
   validateIntentState(intent,goal.state);
   intentIds.add(row.intent_id);intentTurns.add(key);goal.completionIntents.push(intent);
  }
  const attemptIds=new Set<string>();
  for(const row of rows('goal:goal_publication_attempts')){
   const goal=original(row),attempt=json(row.attempt_json);capturedIdentity(row.attempt_id);capturedIdentity(row.intent_id);capturedInteger(row.sequence,1);capturedInteger(row.revision,1);
   if(attemptIds.has(row.attempt_id)||attempt.attemptId!==row.attempt_id||attempt.intentId!==row.intent_id||object(attempt.application).goalId!==row.goal_id||attempt.sequence!==row.sequence||attempt.revision!==row.revision)fail('attempt_row');
   attemptIds.add(row.attempt_id);goal.completionAttempts.push(attempt as unknown as GoalPublicationAttempt);
  }
  const pointers:GoalSource['pointers']=[],containers=new Set<string>();
  for(const row of rows('goal:goal_sessions')){
   capturedIdentity(row.session_id);capturedIdentity(row.current_goal_id);capturedInteger(row.updated_at);const goal=goals.get(row.current_goal_id);
   if(containers.has(row.session_id)||!goal||goal.state.sessionId!==row.session_id||goal.state.updatedAt!==row.updated_at)fail('pointer');
   containers.add(row.session_id);pointers.push({logicalContainerId:row.session_id,currentGoalId:row.current_goal_id,updatedAt:row.updated_at});
  }
  for(const goal of goals.values())if(!containers.has(goal.state.sessionId))fail('container');
  const taskBindings:TaskBinding[]=[],contextTasks:ContextTask[]=[],taskIds=new Set<string>(),bindingIds=new Set<string>(),contextIds=new Set<string>(),ordinals=new Map<string,Set<number>>(),bindingTurns=new Set<string>();
  const relation=(row:Row)=>{
   const goal=original(row);capturedIdentity(row.thread_id);capturedIdentity(row.task_id);capturedInteger(row.ordinal,1);const prior=ordinals.get(row.thread_id)??new Set<number>();
   if(row.thread_id!==goal.state.sessionId||taskIds.has(row.task_id)||prior.has(row.ordinal))fail('task_relation');
   taskIds.add(row.task_id);prior.add(row.ordinal);ordinals.set(row.thread_id,prior);return goal;
  };
  for(const row of rows('goal:goal_thread_tasks')){
   const goal=relation(row);capturedIdentity(row.binding_id);capturedIdentity(row.goal_turn_id);capturedInteger(row.epoch,1);if(row.attached_at!==null)capturedInteger(row.attached_at);const key=JSON.stringify([row.goal_id,row.epoch,row.goal_turn_id]);
   if(bindingIds.has(row.binding_id)||bindingTurns.has(key)||row.epoch>goal.state.epoch||(row.origin!=='user'&&row.origin!=='continuation'))fail('task_binding');
   bindingIds.add(row.binding_id);bindingTurns.add(key);taskBindings.push({bindingId:row.binding_id,goalId:goal.state.goalId,epoch:row.epoch,goalTurnId:row.goal_turn_id,threadId:row.thread_id as string,taskId:row.task_id as string,origin:row.origin,ordinal:row.ordinal as number,attachedAt:row.attached_at as number|null});
  }
  for(const row of rows('goal:goal_thread_context_tasks')){
   const goal=relation(row);capturedIdentity(row.context_id);capturedInteger(row.recorded_at);if(contextIds.has(row.context_id))fail('context');contextIds.add(row.context_id);
   contextTasks.push({contextId:row.context_id,goalId:goal.state.goalId,threadId:row.thread_id as string,taskId:row.task_id as string,ordinal:row.ordinal as number,recordedAt:row.recorded_at});
  }
  for(const values of ordinals.values())if([...values].sort((a,b)=>a-b).some((ordinal,index)=>ordinal!==index+1))fail('ordinal');
  const declarations:GoalDeclaration[]=[];
  for(const [goalId,goal] of [...goals].sort(([a],[b])=>compare(a,b))){
   goal.events.sort((a,b)=>a.recordedAt-b.recordedAt||compare(a.eventId,b.eventId));goal.turns.sort((a,b)=>a.epoch-b.epoch||a.recordedAt-b.recordedAt||compare(a.turnId,b.turnId));goal.evidence.sort((a,b)=>compare(a.evidenceId,b.evidenceId));goal.completionIntents.sort((a,b)=>compare(a.intentId,b.intentId));goal.completionAttempts.sort((a,b)=>compare(a.intentId,b.intentId)||a.sequence-b.sequence);
   const document:GoalDocument=goal;
   validateCapturedGoalCompletionIntents(goal.completionIntents,goal.completionAttempts);
   const declaration=readCapturedGoalSessions(JSON.stringify({schemaVersion:1,...document}),goal.state.sessionId);
   declarations.push({goalId,logicalContainerId:goal.state.sessionId,revision:goal.state.revision,epoch:goal.state.epoch,declaration});
  }
  pointers.sort((a,b)=>compare(a.logicalContainerId,b.logicalContainerId));taskBindings.sort((a,b)=>compare(a.threadId,b.threadId)||a.ordinal-b.ordinal);contextTasks.sort((a,b)=>compare(a.threadId,b.threadId)||a.ordinal-b.ordinal);
  sources.push({sourceId,snapshotHash:entry.snapshotHash,goals:declarations,pointers,taskBindings,contextTasks});
 }
 readProfileSourceCapture(owner,token);
 return freezeCapturedData({kind:'captured-sqlite-goal-declarations' as const,sources});
}
