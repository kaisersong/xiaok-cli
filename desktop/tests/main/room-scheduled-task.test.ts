import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {TimedActionService} from '../../electron/timed-action-service.js';
import {createRoomTimedActionTools} from '../../electron/desktop-services.js';
import {createRoomScheduledTaskDispatch} from '../../electron/room-scheduled-task.js';
it('persists room targets, scopes listing/cancellation, and dispatches only the current binding',async()=>{
  const root=mkdtempSync(join(tmpdir(),'room-schedule-')),db=new TimedActionStore(join(root,'timed.db'));
  try{
    const service=new TimedActionService(db),scope={roomId:'r',logicalAgentId:'a',bindingId:'b',generation:1};
    const tools=createRoomTimedActionTools(service,scope),call=(name:string,input:Record<string,unknown>)=>tools.find(t=>t.definition.name===name)!.execute(input);
    const created=JSON.parse(await call('scheduled_task_create',{name:'room check',prompt:'check every five minutes',frequency:'interval',interval_minutes:5,max_runs:2,roomId:'forged'}));
    expect(created.ok).toBe(true);const action=service.getActions().find(a=>a.id===created.taskId)!;
    expect(action.executor).toMatchObject({roomTarget:scope});
    expect(()=>service.createRoomScheduledTask({name:'bad',prompt:'bad',trigger:{kind:'interval',intervalMinutes:5}},scope,{requestSource:'user'})).toThrow();
    const other=createRoomTimedActionTools(service,{...scope,roomId:'other'});
    expect(await other.find(t=>t.definition.name==='scheduled_task_list')!.execute({})).not.toContain(created.taskId);
    expect(await other.find(t=>t.definition.name==='scheduled_task_cancel')!.execute({task_id:created.taskId})).toContain('forbidden');
    const getWorkspace=vi.fn(async()=>({ok:true,phase:'active',bindingId:'b',generation:1,revision:1,permissions:{canRead:true,canManage:true},claims:[],artifacts:[]}));
    const sendWake=vi.fn(async()=>({ok:true,message:{messageId:'m'}})),dispatch=vi.fn(async()=>({ok:true}));
    const run=createRoomScheduledTaskDispatch({getWorkspace,sendWake,dispatch});
    const timing={scheduledDueAt:1000,claimedAt:1000,overdueMs:0,recoveryReason:'normal_tick' as const};
    expect(await run(action,timing)).toEqual({taskId:'m'});
    await vi.waitFor(()=>expect(dispatch).toHaveBeenCalledWith({roomId:'r',roomMessageId:'m',logicalAgentIds:['a']}));
    expect(sendWake).toHaveBeenCalledWith(expect.objectContaining({roomId:'r',targetAgentId:'a',idempotencyKey:`scheduled:${action.id}:1000`}));
    getWorkspace.mockResolvedValue({...await getWorkspace(),generation:2});
    await expect(run(action,timing)).rejects.toThrow('binding_unavailable');
    expect(sendWake).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await call('scheduled_task_cancel',{task_id:created.taskId})).ok).toBe(true);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
