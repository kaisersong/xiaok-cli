import type {DatabaseSync} from 'node:sqlite';
import type {LoopStore} from './loop-store.js';
type Source='user'|'scheduler'|'agent';
export interface AssistantAnalysisReservation {requestSource:Source;attemptId:string;occurrenceId:string;inputDigest:string;providerContract:string;inputTokens:number;outputTokens:number;now:number}
interface Attempt {triggerSource?:'user'|'scheduler';attemptId:string;occurrenceId:string;inputDigest:string;providerContract:string;inputTokens:number;outputTokens:number;logicalAt:number;state:'reserved'|'sent'|'settled';chargedInput:number;chargedOutput:number;settlement?:string}
export function migrateAssistantAnalysisBudget(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS assistant_analysis_clock(id INTEGER PRIMARY KEY CHECK(id=1),logical_now INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_analysis_runs(attempt_id TEXT PRIMARY KEY,run_id TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_analysis_attempts(attempt_id TEXT PRIMARY KEY,occurrence_id TEXT UNIQUE NOT NULL,logical_at INTEGER NOT NULL,payload_json TEXT NOT NULL);`);}
export function readAssistantAnalysisAttempt(db:DatabaseSync,id:string):Attempt|undefined{
 const row=db.prepare('SELECT payload_json FROM assistant_analysis_attempts WHERE attempt_id=?').get(id);return row?JSON.parse(String(row.payload_json)) as Attempt:undefined;
}
function clock(db:DatabaseSync,observed:number):number{
 if(!Number.isSafeInteger(observed)||observed<0)throw Error('assistant_budget_time');
 const logical=Math.max(Number(db.prepare('SELECT logical_now FROM assistant_analysis_clock WHERE id=1').get()?.logical_now??0),observed);
 db.prepare('INSERT INTO assistant_analysis_clock(id,logical_now) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET logical_now=excluded.logical_now').run(logical);return logical;
}
function write(db:DatabaseSync,value:Attempt){db.prepare('INSERT INTO assistant_analysis_attempts(attempt_id,occurrence_id,logical_at,payload_json) VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET payload_json=excluded.payload_json').run(value.attemptId,value.occurrenceId,value.logicalAt,JSON.stringify(value));return value;}
function source(input:{requestSource:Source}){if(!input||!['user','scheduler'].includes(input.requestSource))throw Error('assistant_budget_source_denied');}
function identity(value:string){if(typeof value!=='string'||!value||value.length>256||/[\x00-\x1f\x7f]/.test(value))throw Error('assistant_budget_identity');}
export function reserveAssistantAnalysis(db:DatabaseSync,input:AssistantAnalysisReservation):Attempt{
 source(input);identity(input.attemptId);identity(input.occurrenceId);identity(input.providerContract);
 if(!/^[a-f0-9]{64}$/.test(input.inputDigest)||!Number.isSafeInteger(input.inputTokens)||input.inputTokens<1||!Number.isSafeInteger(input.outputTokens)||input.outputTokens<1)throw Error('assistant_budget_contract');
 const logicalAt=clock(db,input.now),existing=readAssistantAnalysisAttempt(db,input.attemptId);
 if(existing){if(['occurrenceId','inputDigest','providerContract','inputTokens','outputTokens'].some(key=>existing[key as keyof Attempt]!==input[key as keyof AssistantAnalysisReservation]))throw Error('assistant_budget_conflict');return existing;}
 if(db.prepare('SELECT 1 FROM assistant_analysis_attempts WHERE occurrence_id=?').get(input.occurrenceId))throw Error('assistant_budget_occurrence_conflict');
 const all=db.prepare('SELECT payload_json FROM assistant_analysis_attempts').all().map(row=>JSON.parse(String(row.payload_json)) as Attempt);
 if(all.some(row=>row.chargedInput>row.inputTokens||row.chargedOutput>row.outputTokens))throw Error('assistant_budget_provider_breach');
 const recent=all.filter(row=>row.logicalAt>logicalAt-86400_000);
 if(recent.length>=6||recent.reduce((sum,row)=>sum+row.chargedInput,0)+input.inputTokens>48000||recent.reduce((sum,row)=>sum+row.chargedOutput,0)+input.outputTokens>6000)throw Error('assistant_budget_exhausted');
 return write(db,{triggerSource:input.requestSource as 'user'|'scheduler',attemptId:input.attemptId,occurrenceId:input.occurrenceId,inputDigest:input.inputDigest,providerContract:input.providerContract,inputTokens:input.inputTokens,outputTokens:input.outputTokens,logicalAt,state:'reserved',chargedInput:input.inputTokens,chargedOutput:input.outputTokens});
}
export function sendAssistantAnalysis(db:DatabaseSync,input:{attemptId:string;now:number;requestSource:Source}):Attempt{
 source(input);identity(input.attemptId);const now=clock(db,input.now),old=readAssistantAnalysisAttempt(db,input.attemptId);
 if(!old)throw Error('assistant_budget_attempt_missing');if(old.state!=='reserved')throw Error('assistant_budget_already_sent');
 if(now-old.logicalAt>600000)throw Error('assistant_budget_reservation_expired');return write(db,{...old,state:'sent'});
}
export function settleAssistantAnalysis(db:DatabaseSync,input:{attemptId:string;now:number;requestSource:Source;usage:'unknown'|{inputTokens:number;outputTokens:number}}):Attempt{
 source(input);identity(input.attemptId);clock(db,input.now);const old=readAssistantAnalysisAttempt(db,input.attemptId);if(!old)throw Error('assistant_budget_attempt_missing');
 if(input.usage!=='unknown'&&(!Number.isSafeInteger(input.usage.inputTokens)||input.usage.inputTokens<0||!Number.isSafeInteger(input.usage.outputTokens)||input.usage.outputTokens<0))throw Error('assistant_budget_usage');
 const settlement=JSON.stringify(input.usage);
 if(old.state==='settled'){if(old.settlement!==settlement)throw Error('assistant_budget_settlement_conflict');return old;}
 if(old.state!=='sent')throw Error('assistant_budget_not_sent');
 return write(db,{...old,state:'settled',settlement,chargedInput:input.usage==='unknown'?old.inputTokens:input.usage.inputTokens,chargedOutput:input.usage==='unknown'?old.outputTokens:input.usage.outputTokens});
}
function assertAnalysisRun(db:DatabaseSync,runId:string){
 identity(runId);const run=db.prepare('SELECT loop_id,status FROM loop_runs WHERE id=?').get(runId);
 if(!run||run.loop_id!=='personal-assistant-transaction-check'||run.status!=='running'||db.prepare('SELECT active_run_id FROM loop_definitions WHERE id=?').get(String(run.loop_id))?.active_run_id!==runId)throw Error('assistant_analysis_run_claim');
}
export function reserveAssistantAnalysisForRun(db:DatabaseSync,input:AssistantAnalysisReservation,runId:string){
 assertAnalysisRun(db,runId);
 const old=db.prepare('SELECT run_id FROM assistant_analysis_runs WHERE attempt_id=?').get(input.attemptId);if(old&&old.run_id!==runId)throw Error('assistant_analysis_run_conflict');
 const attempt=reserveAssistantAnalysis(db,input);
 db.prepare('INSERT INTO assistant_analysis_runs(attempt_id,run_id) VALUES(?,?) ON CONFLICT(attempt_id) DO NOTHING').run(attempt.attemptId,runId);return attempt;
}
export function sendAssistantAnalysisForRun(db:DatabaseSync,input:Parameters<typeof sendAssistantAnalysis>[1],runId:string){
 assertAnalysisRun(db,runId);if(db.prepare('SELECT run_id FROM assistant_analysis_runs WHERE attempt_id=?').get(input.attemptId)?.run_id!==runId)throw Error('assistant_analysis_run_conflict');return sendAssistantAnalysis(db,input);
}
/** Main-only: the analysis port still must pass provider/quality gates before reserve. */
export class AssistantAnalysisBudget {
 private readonly now:()=>number;
 constructor(private readonly store:LoopStore,options:{now?:()=>number}={}){this.now=options.now??Date.now;}
 reserve(input:Omit<AssistantAnalysisReservation,'now'>){return this.store.reserveAssistantAnalysis({...input,now:this.now()});}
 sent(input:Omit<Parameters<typeof sendAssistantAnalysis>[1],'now'>){return this.store.sendAssistantAnalysis({...input,now:this.now()});}
 settle(input:Omit<Parameters<typeof settleAssistantAnalysis>[1],'now'>){return this.store.settleAssistantAnalysis({...input,now:this.now()});}
 reserveForRun(input:Omit<AssistantAnalysisReservation,'now'>,runId:string){return this.store.reserveAssistantAnalysisForRun({...input,now:this.now()},runId);}
 sentForRun(input:Omit<Parameters<typeof sendAssistantAnalysis>[1],'now'>,runId:string){return this.store.sendAssistantAnalysisForRun({...input,now:this.now()},runId);}
 read(id:string){identity(id);return this.store.readAssistantAnalysisAttempt(id);}
}
