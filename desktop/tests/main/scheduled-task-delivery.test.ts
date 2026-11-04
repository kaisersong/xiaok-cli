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
