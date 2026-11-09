import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {z} from 'zod';
import {parseCapturedSourceJson} from '../../src/runtime/verification/captured-source-json.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import type {DatabaseSync} from 'node:sqlite';
import type {LoopStore} from './loop-store.js';
type Source='user'|'scheduler'|'agent';
export interface AssistantAnalysisReservation {requestSource:Source;attemptId:string;occurrenceId:string;inputDigest:string;providerContract:string;inputTokens:number;outputTokens:number;now:number}
interface Attempt {triggerSource?:'user'|'scheduler';attemptId:string;occurrenceId:string;inputDigest:string;providerContract:string;inputTokens:number;outputTokens:number;logicalAt:number;state:'reserved'|'sent'|'settled';chargedInput:number;chargedOutput:number;settlement?:string}
export function migrateAssistantAnalysisBudget(db:DatabaseSync, original: LoopDatabaseLease){assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_analysis_clock(id INTEGER PRIMARY KEY CHECK(id=1),logical_now INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_analysis_runs(attempt_id TEXT PRIMARY KEY,run_id TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_analysis_attempts(attempt_id TEXT PRIMARY KEY,occurrence_id TEXT UNIQUE NOT NULL,logical_at INTEGER NOT NULL,payload_json TEXT NOT NULL);`);}
const budgetInteger=z.number().nonnegative().refine(Number.isSafeInteger),budgetId=z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/);
const analysisAttemptSchema=z.object({triggerSource:z.enum(['user','scheduler']),attemptId:budgetId,occurrenceId:budgetId,inputDigest:z.string().regex(/^[a-f0-9]{64}$/),providerContract:budgetId,inputTokens:budgetInteger.refine(n=>n>0),outputTokens:budgetInteger.refine(n=>n>0),logicalAt:budgetInteger,state:z.enum(['reserved','sent','settled']),chargedInput:budgetInteger,chargedOutput:budgetInteger,settlement:z.string().optional()}).strict();
function parseAnalysisAttempt(raw:unknown):Attempt{
 try{const value=analysisAttemptSchema.parse(parseCapturedSourceJson(String(raw)));
  if(value.state==='settled'){
   if(value.settlement===undefined)throw Error('settlement_missing');
   const usage=parseCapturedSourceJson(value.settlement);
   if(usage==='unknown'){if(value.chargedInput!==value.inputTokens||value.chargedOutput!==value.outputTokens)throw Error('unknown_charge');}
   else{const known=z.object({inputTokens:budgetInteger,outputTokens:budgetInteger}).strict().parse(usage);if(known.inputTokens!==value.chargedInput||known.outputTokens!==value.chargedOutput)throw Error('usage_charge');}
  }else if(value.settlement!==undefined||value.chargedInput!==value.inputTokens||value.chargedOutput!==value.outputTokens)throw Error('reservation_charge');
  return value;
 }catch(raw){throw Error('assistant_budget_attempt_corrupt',{cause:raw});}
}
export function readAssistantAnalysisAttempt(db:DatabaseSync,original:LoopDatabaseLease,id:string):Attempt|undefined{
 const row=assistantOwnedGet(db,original,'SELECT attempt_id,occurrence_id,logical_at,payload_json FROM assistant_analysis_attempts WHERE attempt_id=?',id);
 if(!row)return undefined;const value=parseAnalysisAttempt(row.payload_json);
 if(value.attemptId!==row.attempt_id||value.occurrenceId!==row.occurrence_id||value.logicalAt!==row.logical_at)throw Error('assistant_budget_attempt_corrupt');return value;
}

function clock(db:DatabaseSync, original: LoopDatabaseLease,observed:number):number{
 if(!Number.isSafeInteger(observed)||observed<0)throw Error('assistant_budget_time');
 const logical=Math.max(Number(assistantOwnedGet(db,original,'SELECT logical_now FROM assistant_analysis_clock WHERE id=1')?.logical_now??0),observed);
 assistantOwnedRun(db,original,'INSERT INTO assistant_analysis_clock(id,logical_now) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET logical_now=excluded.logical_now',logical);return logical;
}
function write(db:DatabaseSync, original: LoopDatabaseLease,value:Attempt){assistantOwnedRun(db,original,'INSERT INTO assistant_analysis_attempts(attempt_id,occurrence_id,logical_at,payload_json) VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET payload_json=excluded.payload_json',value.attemptId,value.occurrenceId,value.logicalAt,JSON.stringify(value));return value;}
function source(input:{requestSource:Source}){if(!input||!['user','scheduler'].includes(input.requestSource))throw Error('assistant_budget_source_denied');}
function identity(value:string){if(typeof value!=='string'||!value||value.length>256||/[\x00-\x1f\x7f]/.test(value))throw Error('assistant_budget_identity');}
export function reserveAssistantAnalysis(db:DatabaseSync, original: LoopDatabaseLease,input:AssistantAnalysisReservation):Attempt{
 source(input);identity(input.attemptId);identity(input.occurrenceId);identity(input.providerContract);
 if(!/^[a-f0-9]{64}$/.test(input.inputDigest)||!Number.isSafeInteger(input.inputTokens)||input.inputTokens<1||!Number.isSafeInteger(input.outputTokens)||input.outputTokens<1)throw Error('assistant_budget_contract');
 const logicalAt=clock(db, original,input.now),existing=readAssistantAnalysisAttempt(db, original,input.attemptId);
 if(existing){if(existing.triggerSource!==input.requestSource)throw Error('assistant_budget_source_mismatch');if(['occurrenceId','inputDigest','providerContract','inputTokens','outputTokens'].some(key=>existing[key as keyof Attempt]!==input[key as keyof AssistantAnalysisReservation]))throw Error('assistant_budget_conflict');return existing;}
 if(assistantOwnedGet(db,original,'SELECT 1 FROM assistant_analysis_attempts WHERE occurrence_id=?',input.occurrenceId))throw Error('assistant_budget_occurrence_conflict');
 const all=assistantOwnedAll(db,original,'SELECT payload_json FROM assistant_analysis_attempts').map(row=>parseAnalysisAttempt(row.payload_json));
 if(all.some(row=>row.chargedInput>row.inputTokens||row.chargedOutput>row.outputTokens))throw Error('assistant_budget_provider_breach');
 const recent=all.filter(row=>row.logicalAt>logicalAt-86400_000);
 if(recent.length>=6||recent.reduce((sum,row)=>sum+row.chargedInput,0)+input.inputTokens>48000||recent.reduce((sum,row)=>sum+row.chargedOutput,0)+input.outputTokens>6000)throw Error('assistant_budget_exhausted');
 return write(db, original,{triggerSource:input.requestSource as 'user'|'scheduler',attemptId:input.attemptId,occurrenceId:input.occurrenceId,inputDigest:input.inputDigest,providerContract:input.providerContract,inputTokens:input.inputTokens,outputTokens:input.outputTokens,logicalAt,state:'reserved',chargedInput:input.inputTokens,chargedOutput:input.outputTokens});
}
export function sendAssistantAnalysis(db:DatabaseSync, original: LoopDatabaseLease,input:{attemptId:string;now:number;requestSource:Source}):Attempt{
 source(input);identity(input.attemptId);const now=clock(db, original,input.now),old=readAssistantAnalysisAttempt(db, original,input.attemptId);
 if(!old)throw Error('assistant_budget_attempt_missing');if(old.triggerSource!==input.requestSource)throw Error('assistant_budget_source_mismatch');if(old.state!=='reserved')throw Error('assistant_budget_already_sent');
 if(now-old.logicalAt>600000)throw Error('assistant_budget_reservation_expired');return write(db, original,{...old,state:'sent'});
}
export function settleAssistantAnalysis(db:DatabaseSync, original: LoopDatabaseLease,input:{attemptId:string;now:number;requestSource:Source;usage:'unknown'|{inputTokens:number;outputTokens:number}}):Attempt{
 source(input);identity(input.attemptId);clock(db, original,input.now);const old=readAssistantAnalysisAttempt(db, original,input.attemptId);if(!old)throw Error('assistant_budget_attempt_missing');if(old.triggerSource!==input.requestSource)throw Error('assistant_budget_source_mismatch');
 if(input.usage!=='unknown'&&(!Number.isSafeInteger(input.usage.inputTokens)||input.usage.inputTokens<0||!Number.isSafeInteger(input.usage.outputTokens)||input.usage.outputTokens<0))throw Error('assistant_budget_usage');
 const settlement=JSON.stringify(input.usage);
 if(old.state==='settled'){if(old.settlement!==settlement)throw Error('assistant_budget_settlement_conflict');return old;}
 if(old.state!=='sent')throw Error('assistant_budget_not_sent');
 return write(db, original,{...old,state:'settled',settlement,chargedInput:input.usage==='unknown'?old.inputTokens:input.usage.inputTokens,chargedOutput:input.usage==='unknown'?old.outputTokens:input.usage.outputTokens});
}
function assertAnalysisRun(db:DatabaseSync, original: LoopDatabaseLease,runId:string){
 identity(runId);const run=assistantOwnedGet(db,original,'SELECT loop_id,status FROM loop_runs WHERE id=?',runId);
 if(!run||run.loop_id!=='personal-assistant-transaction-check'||run.status!=='running'||assistantOwnedGet(db,original,'SELECT active_run_id FROM loop_definitions WHERE id=?',String(run.loop_id))?.active_run_id!==runId)throw Error('assistant_analysis_run_claim');
}
export function reserveAssistantAnalysisForRun(db:DatabaseSync, original: LoopDatabaseLease,input:AssistantAnalysisReservation,runId:string){
 assertAnalysisRun(db, original,runId);
 const old=assistantOwnedGet(db,original,'SELECT run_id FROM assistant_analysis_runs WHERE attempt_id=?',input.attemptId);if(old&&old.run_id!==runId)throw Error('assistant_analysis_run_conflict');
 const attempt=reserveAssistantAnalysis(db, original,input);
 assistantOwnedRun(db,original,'INSERT INTO assistant_analysis_runs(attempt_id,run_id) VALUES(?,?) ON CONFLICT(attempt_id) DO NOTHING',attempt.attemptId,runId);return attempt;
}
export function sendAssistantAnalysisForRun(db:DatabaseSync, original: LoopDatabaseLease,input:Parameters<typeof sendAssistantAnalysis>[2],runId:string){
 assertAnalysisRun(db, original,runId);if(assistantOwnedGet(db,original,'SELECT run_id FROM assistant_analysis_runs WHERE attempt_id=?',input.attemptId)?.run_id!==runId)throw Error('assistant_analysis_run_conflict');return sendAssistantAnalysis(db, original,input);
}
/** Main-only: the analysis port still must pass provider/quality gates before reserve. */
export class AssistantAnalysisBudget {
 private readonly now:()=>number;
 constructor(private readonly store:LoopStore,options:{now?:()=>number}={}){this.now=options.now??Date.now;}
 reserve(input:Omit<AssistantAnalysisReservation,'now'>){return this.store.reserveAssistantAnalysis({...input,now:this.now()});}
 sent(input:Omit<Parameters<typeof sendAssistantAnalysis>[2],'now'>){return this.store.sendAssistantAnalysis({...input,now:this.now()});}
 settle(input:Omit<Parameters<typeof settleAssistantAnalysis>[2],'now'>){return this.store.settleAssistantAnalysis({...input,now:this.now()});}
 reserveForRun(input:Omit<AssistantAnalysisReservation,'now'>,runId:string){return this.store.reserveAssistantAnalysisForRun({...input,now:this.now()},runId);}
 sentForRun(input:Omit<Parameters<typeof sendAssistantAnalysis>[2],'now'>,runId:string){return this.store.sendAssistantAnalysisForRun({...input,now:this.now()},runId);}
 read(id:string){identity(id);return this.store.readAssistantAnalysisAttempt(id);}
}
