import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {useScheduledTaskBootstrap} from '../../renderer/src/hooks/useScheduledTaskBootstrap';
import {scheduledRunPresentation} from '../../electron/scheduled-run-presentation';
import {createScheduledTaskDeliveryReconciler} from '../../electron/scheduled-task-delivery';
const m=vi.hoisted(()=>({due:undefined as any,runs:vi.fn(),schedules:vi.fn(),update:vi.fn(),get:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({onScheduledTaskDue:(fn:any)=>{m.due=fn;return ()=>{};},getScheduledTasks:m.schedules,getTimedActionRuns:m.runs})}));
vi.mock('../../renderer/src/api',()=>({api:{listThreads:vi.fn().mockResolvedValue([]),getThread:m.get,createThread:vi.fn().mockResolvedValue({id:'thread-daily',taskIds:[]}),updateThreadTaskId:m.update}}));
const row={id:'daily',name:'Daily',threadId:'thread-daily',lastRunAt:1};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();m.schedules.mockResolvedValue([row]);m.runs.mockResolvedValue([]);m.get.mockResolvedValue({id:'thread-daily',taskIds:[]});m.update.mockResolvedValue(undefined);localStorage.setItem('xiaok:scheduled-tasks',JSON.stringify([row]));});
afterEach(()=>cleanup());
it('attaches dispatched runtime immediately, but only notifies when actual completion arrives',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);renderHook(()=>useScheduledTaskBootstrap());
 await act(async()=>{await m.due({taskId:'daily',runId:'run-1',runtimeTaskId:'task_daily',...scheduledRunPresentation({status:'success',runtimeTaskId:'task_daily'}),success:true,lastRunAt:2});});
 expect(m.update).toHaveBeenCalledWith('thread-daily','task_daily');expect(toast).not.toHaveBeenCalled();expect(localStorage.getItem('xiaok:scheduled-unread')).toBeNull();
 const done={taskId:'daily',runId:'run-1',runtimeTaskId:'task_daily',completed:true,success:true,lastRunAt:2};
 await act(async()=>{await m.due(done);await m.due(done);});
 expect(toast).toHaveBeenCalledTimes(1);expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({daily:1});window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('repairs runtime links on startup from authoritative schedules without issuing completion toasts',async()=>{
 m.schedules.mockResolvedValue([{...row,runtimeTaskId:'task_today'}]);m.runs.mockResolvedValue([{runtimeTaskId:'task_yesterday',startedAt:1},{runtimeTaskId:'task_today',startedAt:2}]);
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(m.update).toHaveBeenCalledWith('thread-daily','task_today');expect(JSON.parse(localStorage.getItem('xiaok:scheduled-tasks')!)[0]).toMatchObject({runtimeTaskId:'task_today',threadId:'thread-daily'});
});
it('preserves cached links if authoritative run history fails, then retries the same completion',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 const before=localStorage.getItem('xiaok:scheduled-tasks');m.runs.mockRejectedValueOnce(Error('read_failed'));
 const done={taskId:'daily',runId:'run-2',runtimeTaskId:'task_today',completed:true,success:true,lastRunAt:3};
 await act(async()=>{await m.due(done);});expect(localStorage.getItem('xiaok:scheduled-tasks')).toBe(before);expect(toast).not.toHaveBeenCalled();
 await act(async()=>{await m.due(done);});expect(toast).toHaveBeenCalledTimes(1);window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('links failed execution and displays failure without changing it into successful completion',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 await act(async()=>{await m.due({taskId:'daily',runId:'failed-run',runtimeTaskId:'task_failed',completed:true,success:false,error:'failure',lastRunAt:2});});
 expect(m.update).toHaveBeenCalledWith('thread-daily','task_failed');expect(toast.mock.calls[0][0].detail).toMatchObject({success:false,error:'failure'});window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('replays a persisted main delivery missed during renderer reload once, after repairing the thread',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 m.schedules.mockResolvedValue([{...row,runtimeTaskId:'task_today'}]);m.runs.mockResolvedValue([{runtimeTaskId:'task_today',startedAt:2,delivery:{taskId:'daily',runId:'durable-run',runtimeTaskId:'task_today',completed:true,success:true,lastRunAt:2}}]);
 let first:any;await act(async()=>{first=renderHook(()=>useScheduledTaskBootstrap());});expect(toast).toHaveBeenCalledTimes(1);first.unmount();
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});expect(toast).toHaveBeenCalledTimes(1);window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('ignores a late history response after unmount',async()=>{
 let release:any;const held=new Promise(resolve=>{release=resolve;});m.schedules.mockReturnValue(held);
 const {unmount}=renderHook(()=>useScheduledTaskBootstrap());await act(async()=>{await Promise.resolve();});const before=localStorage.getItem('xiaok:scheduled-tasks');unmount();
 await act(async()=>{release([{...row,runtimeTaskId:'task_late'}]);});expect(localStorage.getItem('xiaok:scheduled-tasks')).toBe(before);expect(m.update).not.toHaveBeenCalled();
});
it('renders the actual Main completion producer payload rather than an independently invented completion shape',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 const emitted:any[]=[];const acknowledged=vi.fn();
 const reconcile=createScheduledTaskDeliveryReconciler({
  store:{listPendingScheduledDeliveries:()=>[{action:{id:'daily',title:'Daily',nextDueAt:9} as any,run:{runId:'real-main-run',runtimeTaskId:'task_actual',startedAt:2} as any}],acknowledgeScheduledDelivery:acknowledged},
  readSnapshot:async()=>({status:'completed'}),publish:event=>{emitted.push(event);return true;},
 });
 await reconcile();await act(async()=>{await m.due(emitted[0]);});
 expect(acknowledged).toHaveBeenCalled();expect(m.update).toHaveBeenCalledWith('thread-daily','task_actual');expect(toast.mock.calls[0][0].detail).toMatchObject({taskId:'daily',success:true});window.removeEventListener('xiaok:scheduled-toast',toast);
});
