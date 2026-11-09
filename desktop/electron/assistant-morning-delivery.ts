import type {DatabaseSync} from 'node:sqlite';
import type {LoopStore} from './loop-store.js';
import type {TimedActionStore} from './timed-action-store.js';
import type {TimedActionRecord} from './timed-action-types.js';
import type {DesktopNotificationPort} from './desktop-notifications.js';
import {ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID,type AssistantProfile} from './assistant-types.js';
import {assistantLocalDate} from '../shared/assistant-inbox-contract.js';
type State='claimed'|'issued'|'skipped'|'failed'|'unknown';
const scheduler=(source:unknown)=>{if(source!=='scheduler')throw Error('assistant_notification_scheduler_only');};
const identity=(id:string)=>{if(typeof id!=='string'||!id||id.length>256||id.includes('\0'))throw Error('assistant_notification_id');};
/** Delivery attempts only; this never rewrites execution or human-read state. */
export class AssistantMorningNotificationLedger {
 constructor(private readonly db:DatabaseSync){db.exec("CREATE TABLE IF NOT EXISTS assistant_morning_notifications(run_id TEXT PRIMARY KEY,timed_run_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('claimed','issued','skipped','failed','unknown')),attempted_at INTEGER NOT NULL,finished_at INTEGER,reason TEXT)");}
 get(id:string){const row=this.db.prepare('SELECT * FROM assistant_morning_notifications WHERE run_id=?').get(id);return row?{runId:String(row.run_id),timedRunId:String(row.timed_run_id),state:String(row.state) as State}:undefined;}
 claim(runId:string,timedRunId:string,at:number,source:'scheduler'){scheduler(source);identity(runId);identity(timedRunId);return this.db.prepare("INSERT OR IGNORE INTO assistant_morning_notifications(run_id,timed_run_id,state,attempted_at) VALUES(?,?,'claimed',?)").run(runId,timedRunId,at).changes===1;}
 finish(runId:string,state:Exclude<State,'claimed'>,at:number,reason:string,source:'scheduler'){scheduler(source);if(!['issued','skipped','failed','unknown'].includes(state)||!['accepted','platform_unavailable','admission_rejected','show_failed','interrupted'].includes(reason))throw Error('assistant_notification_state');this.db.prepare("UPDATE assistant_morning_notifications SET state=?,finished_at=?,reason=? WHERE run_id=? AND state='claimed'").run(state,at,reason,runId);}
 recover(source:'scheduler'){scheduler(source);this.db.prepare("UPDATE assistant_morning_notifications SET state='unknown',finished_at=?,reason='interrupted' WHERE state='claimed'").run(Date.now());}
}
interface Event {action:TimedActionRecord;runId:string;status:string}
interface Options {loopStore:Pick<LoopStore,'getLoopRun'|'listLoopRuns'>;timedStore:Pick<TimedActionStore,'getAction'|'listRuns'|'getLoopTimedReceipt'>;ledger:AssistantMorningNotificationLedger;profile():AssistantProfile|undefined;readMorningRun(runId:string):Promise<{titles:string[];current():boolean}|undefined>;notificationPort:DesktopNotificationPort;refresh():void;focus():void;ready():boolean;isOpen():boolean;now?:()=>number}
function owned(a:TimedActionRecord,kind:'morning'|'evening'){return a.source==='system'&&a.ownerKind==='assistant'&&a.ownerId==='default-personal-assistant'&&a.id===`assistant:default-personal-assistant:${kind}`&&a.executor.kind==='loop'&&a.executor.loopId===(kind==='morning'?ASSISTANT_MORNING_LOOP_ID:ASSISTANT_EVENING_LOOP_ID);}
function allowed(p:AssistantProfile,at:number,due:number){try{const valid=/^(?:[01]\d|2[0-3]):[0-5]\d$/;if(due>at||!valid.test(p.quietHours.start)||!valid.test(p.quietHours.end))return false;const date=assistantLocalDate(at,p.timeZone);if(p.status!=='active'||date!==assistantLocalDate(due,p.timeZone)||!p.workdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()))return false;const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at),time=parts.find(x=>x.type==='hour')!.value+':'+parts.find(x=>x.type==='minute')!.value,{start,end}=p.quietHours;return start===end||!(start<end?time>=start&&time<end:time>=start||time<end);}catch{return false;}}
export function createAssistantMorningDelivery(o:Options){
 const now=o.now??Date.now,pending=new Set<Promise<unknown>>(),jobs=new Map<string,Promise<void>>();let closed=false;o.ledger.recover('scheduler');
 const track=<T>(p:Promise<T>)=>{pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
 async function deliver(event:Event){
  if(closed||!o.isOpen())return;
  if(owned(event.action,'evening')){if(['success','failed'].includes(event.status))o.refresh();return;}
  if(!owned(event.action,'morning')||!['success','failed'].includes(event.status))return;
  const action=o.timedStore.getAction(event.action.id);if(!action||!owned(action,'morning')||action.status!=='active')return;
  const timed=o.timedStore.listRuns(action.id).find(r=>r.runId===event.runId);if(!timed||timed.executorKind!=='loop'||!['success','failed','failed_stale'].includes(timed.status))return;
  const linkedId=timed.decision?.loopRunId;if(typeof linkedId!=='string')return;const run=o.loopStore.getLoopRun(linkedId),receipt=o.timedStore.getLoopTimedReceipt(event.runId);
  if(!run||run.loopId!==ASSISTANT_MORNING_LOOP_ID||run.trigger.assistantKind!=='morning'||run.trigger.timedActionRunId!==event.runId||receipt&&(receipt.loopRunId!==run.id||receipt.disposition!=='committed'||receipt.outcome!==run.status))return;
  const p=o.profile(),due=run.trigger.scheduledDueAt;if(!p||run.trigger.timedActionId!==action.id||run.trigger.source!=='scheduled'||typeof due!=='number'||!Number.isFinite(due)||!['success','failed','blocked'].includes(run.status)||o.ledger.get(run.id))return;
  const timedJson=JSON.stringify([timed.status,timed.decision,receipt??null]);
  const timedCurrent=()=>{const row=o.timedStore.listRuns(action.id).find(r=>r.runId===event.runId);return !!row&&JSON.stringify([row.status,row.decision,o.timedStore.getLoopTimedReceipt(event.runId)??null])===timedJson;};
  if((event.status==='success')!==(run.status==='success')||(timed.status==='success')!==(run.status==='success'))return;
  const profileJson=JSON.stringify(p),actionJson=JSON.stringify([action.trigger,action.executor,action.ownerKind,action.ownerId,action.source]);
  const eligible=()=>{const current=o.profile(),a=o.timedStore.getAction(action.id);return timedCurrent()&&!closed&&o.isOpen()&&o.ready()&&!!current&&JSON.stringify(current)===profileJson&&allowed(current,now(),due)&&!!a&&a.status==='active'&&owned(a,'morning')&&JSON.stringify([a.trigger,a.executor,a.ownerKind,a.ownerId,a.source])===actionJson;};
  if(!eligible())return;
  const observation=run.status==='success'?await o.readMorningRun(run.id):undefined;if(run.status==='success'&&!observation?.current())return;
  const runJson=JSON.stringify(run),current=()=>eligible()&&(observation?observation.current():JSON.stringify(o.loopStore.getLoopRun(run.id))===runJson);
  if(!current())return;
  const en=p.locale==='en',title=en?'XiaoK morning suggestions':'小K助理晨间建议',body=run.status==='success'?(observation!.titles.length?observation!.titles.slice(0,3).map(t=>t.slice(0,200)).join('\n'):(en?'No new suggestions this morning. Open the assistant to review.':'今早暂无新增建议，可以打开助理查看。')):(en?'Morning suggestions could not be generated. Open the assistant to review the run.':'晨间建议未能生成，请打开助理查看运行记录。');
  if(!o.ledger.claim(run.id,event.runId,now(),'scheduler'))return;try{o.refresh();}catch{/* Renderer projection cannot rewrite a delivery outcome. */}
  try{const result=await o.notificationPort.show({title,body,silent:false,beforeShow:current,onClick:()=>{if(!closed&&o.isOpen())o.focus();}});o.ledger.finish(run.id,result.ok?'issued':result.skipped?'skipped':'failed',now(),result.ok?'accepted':result.skipped?(result.reason==='notification_admission_rejected'?'admission_rejected':'platform_unavailable'):'show_failed','scheduler');}catch{o.ledger.finish(run.id,'failed',now(),'show_failed','scheduler');}
 }
 function handle(event:Event):Promise<void>{if(closed)return Promise.resolve();const existing=jobs.get(event.runId);if(existing)return existing;const p=track(deliver(event));jobs.set(event.runId,p);void p.then(()=>jobs.delete(event.runId),()=>jobs.delete(event.runId));return p;}
 async function reconcile(){if(closed||!o.isOpen())return;const action=o.timedStore.getAction('assistant:default-personal-assistant:morning'),p=o.profile();if(!action||!owned(action,'morning')||!p)return;for(const timed of o.timedStore.listRuns(action.id)){const id=timed.decision?.loopRunId;if(typeof id!=='string')continue;const run=o.loopStore.getLoopRun(id);if(!run||run.trigger.source!=='scheduled'||run.trigger.timedActionRunId!==timed.runId||typeof run.trigger.scheduledDueAt!=='number'||assistantLocalDate(run.trigger.scheduledDueAt,p.timeZone)!==assistantLocalDate(now(),p.timeZone))continue;await handle({action,runId:timed.runId,status:run.status==='success'?'success':'failed'});return;}}

 return {handle,reconcile:()=>track(reconcile()),stopAccepting(){closed=true;},async close(){closed=true;await Promise.allSettled([...pending]);}};
}
