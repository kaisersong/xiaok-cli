// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {TimedActionScheduler} from '../../electron/timed-action-scheduler.js';
import {createScheduledTaskDeliveryReconciler} from '../../electron/scheduled-task-delivery.js';
import {SCHEDULED_OUTPUT_SCHEMAS} from '../../shared/scheduled-timed-action-ipc-contract.js';

const roots:string[]=[];const stores:TimedActionStore[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function setup(){const root=mkdtempSync(join(tmpdir(),'xiaok-scheduled-delivery-'));roots.push(root);const path=join(root,'timed.sqlite'),store=new TimedActionStore(path);stores.push(store);return {store,path};}
function accepted(store:TimedActionStore,id='daily',now=Date.now(),room=false){
 store.createAction({id,title:'Daily',source:'user',trigger:{kind:'once',at:now},executor:{kind:'agent_task',prompt:'Daily',...(room?{roomTarget:{roomId:'r',logicalAgentId:'a',bindingId:'b',generation:1}}:{})},now:now-1});
 const [claim]=store.claimDueActions(now,1);store.markRunRunning(id,claim.runId,now);store.finishRunSuccess(id,claim.runId,now,{runtimeTaskId:`task_${id}`});return claim.runId;
}
const passed={status:'passed',verification:'passed',hostSettlement:'committed'};
describe('scheduled task completion delivery',()=>{
 it('uses the real scheduler tick, waits for execution and settlement, then delivers once',async()=>{
  const {store}=setup();accepted(store);let snapshot:any={status:'running'};const emit=vi.fn(()=>true);
  const reconcile=createScheduledTaskDeliveryReconciler({store,readSnapshot:async()=>snapshot,publish:emit});
  const scheduler=new TimedActionScheduler(store,{executors:{},reconcileScheduledTasks:reconcile});
  await scheduler.runOnce();expect(emit).not.toHaveBeenCalled();
  snapshot={status:'completed',result:{summary:'Done'},hostDelivery:{...passed,status:'checking'}};
  await scheduler.runOnce();expect(emit).not.toHaveBeenCalled();
  snapshot.hostDelivery=passed;await scheduler.runOnce();await scheduler.runOnce();
  expect(emit).toHaveBeenCalledTimes(1);expect(emit.mock.calls[0][0]).toMatchObject({taskId:'daily',runtimeTaskId:'task_daily',completed:true,success:true,runtimeState:'completed'});
  const projected=SCHEDULED_OUTPUT_SCHEMAS.getTimedActionRuns.parse(store.listRuns('daily'));
  expect(projected[0].delivery).toEqual(emit.mock.calls[0][0]);
 });
 it.each(['failed','cancelled'])('reports runtime %s despite a successful dispatch',async status=>{
  const {store}=setup();accepted(store);const emit=vi.fn(()=>true);
  await createScheduledTaskDeliveryReconciler({store,readSnapshot:async()=>({status,events:[{type:'error',message:'specific failure'}]} as any),publish:emit})();
  expect(emit.mock.calls[0][0]).toMatchObject({completed:true,success:false,runtimeState:status,error:'specific failure'});
 });
 it('does not acknowledge unavailable windows or thrown sends, and resumes after reopening the database',async()=>{
  const {store,path}=setup();accepted(store);let available=false;const emit=vi.fn(()=>{if(!available)return false;return true;});
  const options={readSnapshot:async()=>({status:'completed'} as any),publish:emit};
  await createScheduledTaskDeliveryReconciler({store,...options})();expect(store.listPendingScheduledDeliveries()).toHaveLength(1);
  available=true;const reopened=new TimedActionStore(path);stores.push(reopened);await createScheduledTaskDeliveryReconciler({store:reopened,...options})();
  const again=new TimedActionStore(path);stores.push(again);await createScheduledTaskDeliveryReconciler({store:again,...options})();expect(emit).toHaveBeenCalledTimes(2);
 });
 it('contains snapshot/send failures per run and observes shutdown before publishing',async()=>{
  const {store}=setup();accepted(store,'a');accepted(store,'b');const emit=vi.fn(()=>true);const read=vi.fn(async(id:string)=>{if(id==='task_a')throw Error('read failed');return {status:'completed'} as any;});
  const report=vi.fn();await createScheduledTaskDeliveryReconciler({store,readSnapshot:read,publish:emit,onError:report})();expect(emit).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalled();
  const controller=new AbortController();const work=createScheduledTaskDeliveryReconciler({store,readSnapshot:async()=>{controller.abort();return {status:'completed'} as any;},publish:emit});
  await work(controller.signal);expect(emit).toHaveBeenCalledTimes(1);
 });
 it('does not claim success when host delivery failed',async()=>{
  const {store}=setup();accepted(store);const emit=vi.fn(()=>true);
  await createScheduledTaskDeliveryReconciler({store,readSnapshot:async()=>({status:'completed',hostDelivery:{...passed,status:'failed',verification:'failed'}} as any),publish:emit})();
  expect(emit.mock.calls[0][0]).toMatchObject({success:false,runtimeState:'failed'});
 });
 it('retries a thrown send without losing the durable delivery and removes receipts with cleared history',async()=>{
  const {store}=setup();accepted(store);const send=vi.fn().mockImplementationOnce(()=>{throw Error('send_failed');}).mockReturnValue(true);
  const reconcile=createScheduledTaskDeliveryReconciler({store,readSnapshot:async()=>({status:'completed'}),publish:send});
  await reconcile();expect(store.listPendingScheduledDeliveries()).toHaveLength(1);await reconcile();expect(store.listPendingScheduledDeliveries()).toHaveLength(0);
  expect(store.clearActionRunHistory('daily')).toBe(1);expect(store.listRuns('daily')).toEqual([]);
 });
 it('migrates old history once, retaining only the latest recent run for recovery, and leaves room delivery to its owner',()=>{
  const {store,path}=setup();const recent=accepted(store,'recent');accepted(store,'ancient',Date.now()-3*86400000);accepted(store,'room',Date.now(),true);
  store.close();stores.splice(stores.indexOf(store),1);const db=new DatabaseSync(path);db.exec('DROP TABLE scheduled_task_delivery_receipts');db.close();
  const upgraded=new TimedActionStore(path);stores.push(upgraded);expect(upgraded.listPendingScheduledDeliveries().map(r=>r.run.runId)).toEqual([recent]);
 });
});

function legacyRuns(path:string,actionId:string,now:number){
 const db=new DatabaseSync(path);
 const insert=db.prepare("INSERT INTO timed_action_runs(run_id,action_id,executor_kind,status,started_at,runtime_task_id) VALUES (?,?,'agent_task','success',?,?)");
 for(let i=0;i<5;i++)insert.run(`legacy-${i}`,actionId,now-5000+i,`task_legacy_${i}`);
 db.close();
}
it.each([false,true])('baselines only the latest legacy run with an existing receipt table: %s',existing=>{
 const {store,path}=setup();const now=Date.now();const original=accepted(store,'daily',now-10000);
 store.acknowledgeScheduledDelivery(original,now-10000,{taskId:'daily',runId:original,completed:true});
 store.close();stores.splice(stores.indexOf(store),1);
 const db=new DatabaseSync(path);if(!existing)db.exec('DROP TABLE scheduled_task_delivery_receipts; UPDATE timed_action_runs SET delivery_tracked=NULL');db.close();
 legacyRuns(path,'daily',now);
 const upgraded=new TimedActionStore(path);stores.push(upgraded);
 expect(upgraded.listPendingScheduledDeliveries().map(row=>row.run.runId)).toEqual(['legacy-4']);
 const reopened=new TimedActionStore(path);stores.push(reopened);
 expect(reopened.listPendingScheduledDeliveries().map(row=>row.run.runId)).toEqual(['legacy-4']);
});
it('expires missing snapshots durably beyond 24h without publishing or reading them again',async()=>{
 const {store,path}=setup();const now=Date.now();const runId=accepted(store,'missing',now);
 const read=vi.fn(async()=>null),publish=vi.fn(()=>true);
 const reconcile=createScheduledTaskDeliveryReconciler({store,readSnapshot:read,publish});
 await reconcile();expect(store.listPendingScheduledDeliveries()).toHaveLength(1);
 const clock=vi.spyOn(Date,'now').mockReturnValue(now+86400001);
 try {
  await reconcile();await reconcile();expect(read).toHaveBeenCalledTimes(1);expect(publish).not.toHaveBeenCalled();
  expect(store.listPendingScheduledDeliveries()).toEqual([]);
  const db=new DatabaseSync(path);expect(db.prepare('SELECT event_json FROM scheduled_task_delivery_receipts WHERE run_id=?').get(runId)).toMatchObject({event_json:null});db.close();
 } finally {clock.mockRestore();}
});
it('recovers completed once receipts with a 24h inclusive boundary and only each action latest event',()=>{
 const {store}=setup();const now=Date.now();const run=accepted(store,'once',now);
 const event={taskId:'once',runId:run,completed:true,success:true};store.acknowledgeScheduledDelivery(run,now-86400000,event);
 expect(store.getAction('once')?.status).toBe('completed');
 expect(SCHEDULED_OUTPUT_SCHEMAS.getRecentScheduledDeliveries.parse(store.getRecentScheduledDeliveries(now))).toEqual([event]);
 expect(store.getRecentScheduledDeliveries(now+1)).toEqual([]);
});
it('returns the latest 200 action receipts in delivery order, ignoring baselines and older runs',()=>{
 const {store,path}=setup();const now=Date.now();
 // Seed 200 cloned actions/runs/receipts in ONE raw transaction: ~800 autocommit store writes timed out (>5s) on Windows CI.
 const first=accepted(store,'action-0',now);store.acknowledgeScheduledDelivery(first,now,{taskId:'action-0',runId:first,completed:true});
 const db=new DatabaseSync(path);
 const cols=(table:string)=>(db.prepare(`pragma table_info(${table})`).all() as {name:string}[]).map(c=>c.name);
 const actionCols=cols('timed_actions').filter(c=>c!=='id'),runCols=cols('timed_action_runs').filter(c=>!['run_id','action_id','started_at','runtime_task_id'].includes(c));
 const cloneAction=db.prepare(`INSERT INTO timed_actions(id,${actionCols.join(',')}) SELECT ?,${actionCols.join(',')} FROM timed_actions WHERE id='action-0'`);
 const cloneRun=db.prepare(`INSERT INTO timed_action_runs(run_id,action_id,started_at,runtime_task_id,${runCols.join(',')}) SELECT ?,?,?,?,${runCols.join(',')} FROM timed_action_runs WHERE run_id=?`);
 const receipt=db.prepare('INSERT INTO scheduled_task_delivery_receipts(run_id,delivered_at,event_json) VALUES (?,?,?)');
 db.exec('BEGIN IMMEDIATE');
 for(let i=1;i<201;i++){const id=`action-${i}`,run=`run-${i}`;cloneAction.run(id);cloneRun.run(run,id,now+i,`task_${id}`,first);receipt.run(run,now+i,JSON.stringify({taskId:id,runId:run,completed:true}));}
 db.prepare("INSERT INTO timed_action_runs(run_id,action_id,executor_kind,status,started_at,runtime_task_id) VALUES ('extra','action-200','agent_task','success',?,'task_extra')").run(now+202);
 db.exec('COMMIT');db.close();store.acknowledgeScheduledDelivery('extra',now+202,{taskId:'action-200',runId:'extra',completed:true});
 const events=store.getRecentScheduledDeliveries(now+203);
 expect(events).toHaveLength(200);expect(events[0].taskId).toBe('action-1');expect(events.at(-1)?.runId).toBe('extra');
 expect(new Set(events.map(event=>event.taskId)).size).toBe(200);
});
