import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {useScheduledTaskBootstrap} from '../../renderer/src/hooks/useScheduledTaskBootstrap';
import {scheduledRunPresentation} from '../../electron/scheduled-run-presentation';
import {createScheduledTaskDeliveryReconciler} from '../../electron/scheduled-task-delivery';
const m=vi.hoisted(()=>({due:undefined as any,recent:vi.fn(),runs:vi.fn(),schedules:vi.fn(),update:vi.fn(),get:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({onScheduledTaskDue:(fn:any)=>{m.due=fn;return ()=>{};},getRecentScheduledDeliveries:m.recent,getScheduledTasks:m.schedules,getTimedActionRuns:m.runs})}));
vi.mock('../../renderer/src/api',()=>({api:{listThreads:vi.fn().mockResolvedValue([]),getThread:m.get,createThread:vi.fn().mockResolvedValue({id:'thread-daily',taskIds:[]}),updateThreadTaskId:m.update}}));
const row={id:'daily',name:'Daily',threadId:'thread-daily',lastRunAt:1};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();m.schedules.mockResolvedValue([row]);m.runs.mockResolvedValue([]);m.recent.mockResolvedValue([]);m.get.mockResolvedValue({id:'thread-daily',taskIds:[]});m.update.mockResolvedValue(undefined);localStorage.setItem('xiaok:scheduled-tasks',JSON.stringify([row]));});
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
 m.recent.mockResolvedValue([{taskId:'daily',runId:'durable-run',runtimeTaskId:'task_today',completed:true,success:true,lastRunAt:2}]);
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

it('reloads 501 historical receipts three times without repeating toasts or unread counts',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 const deliveries=Array.from({length:501},(_,i)=>({taskId:`plan-${i%3}`,runId:`run-${i}`,completed:true,success:true}));
 m.schedules.mockResolvedValue([0,1,2].map(i=>({...row,id:`plan-${i}`,runtimeTaskId:`task_${i}`})));
 m.runs.mockImplementation(async(id:string)=>deliveries.filter(d=>d.taskId===id).map(delivery=>({delivery})));
 // The main recovery contract supplies only the latest event per schedule.
 m.recent.mockResolvedValue(deliveries.slice(-3));
 for(let i=0;i<3;i++){
  let hook:any;await act(async()=>{hook=renderHook(()=>useScheduledTaskBootstrap());});hook.unmount();
  expect(toast).toHaveBeenCalledTimes(3);
  expect(Object.values(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!))).toEqual([1,1,1]);
 }
 window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('recovers a completed once notification absent from both schedule list and cache',async()=>{
 localStorage.removeItem('xiaok:scheduled-tasks');m.schedules.mockResolvedValue([]);
 m.recent.mockResolvedValue([{taskId:'once',runId:'once-run',completed:true,success:true}]);
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).toHaveBeenCalledTimes(1);expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({once:1});
 window.removeEventListener('xiaok:scheduled-toast',toast);
});

// Design/review: budget distinct plans, not runs. Evict only by notification time;
// migrate the old chronological identity list before comparing a replay receipt.
// Exercise the production hook across unmount/remount so persistence is required.
it('retains A after 500 distinct live receipts for B, including across reload',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 m.schedules.mockResolvedValue(['A','B'].map(id=>({...row,id})));
 let hook:any;await act(async()=>{hook=renderHook(()=>useScheduledTaskBootstrap());});
 const a={taskId:'A',runId:'a',completed:true,success:true};
 let b:any;
 await act(async()=>{await m.due(a);for(let i=0;i<500;i++){b={taskId:'B',runId:`b-${i}`,completed:true,success:true};await m.due(b);}});
 expect(toast).toHaveBeenCalledTimes(501);
 const unread=localStorage.getItem('xiaok:scheduled-unread');hook.unmount();m.recent.mockResolvedValue([a,b]);
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).toHaveBeenCalledTimes(501);expect(localStorage.getItem('xiaok:scheduled-unread')).toBe(unread);
 window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('retains the most recently notified plans when 1100 plans exceed the budget',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 const deliveries=Array.from({length:1100},(_,i)=>({taskId:`plan-${i}`,runId:`run-${i}`,completed:true,success:true}));
 m.schedules.mockResolvedValue(deliveries.map(d=>({...row,id:d.taskId})));
 let hook:any;await act(async()=>{hook=renderHook(()=>useScheduledTaskBootstrap());});
 // Deliberately non-lexical plan order, with distinct notification times.
 const ordered=[...deliveries.slice(550),...deliveries.slice(0,550)];
 const now=vi.spyOn(Date,'now');
 try {
  await act(async()=>{for(let i=0;i<ordered.length;i++){now.mockReturnValue(1000+i);await m.due(ordered[i]);}});
 } finally {now.mockRestore();}
 expect(toast).toHaveBeenCalledTimes(1100);
 const stored=JSON.parse(localStorage.getItem('xiaok:scheduled-delivered-runs')!);
 expect(Object.keys(stored)).toHaveLength(1000);
 const unread=localStorage.getItem('xiaok:scheduled-unread');hook.unmount();m.recent.mockResolvedValue(ordered.slice(-200));
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).toHaveBeenCalledTimes(1100);expect(localStorage.getItem('xiaok:scheduled-unread')).toBe(unread);
 window.removeEventListener('xiaok:scheduled-toast',toast);
});
it('migrates legacy identities, persists migration and notifies a newer receipt exactly once',async()=>{
 localStorage.setItem('xiaok:scheduled-delivered-runs',JSON.stringify(['daily:old','other:one','daily:latest']));
 localStorage.setItem('xiaok:scheduled-unread',JSON.stringify({daily:2,other:1}));
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 m.recent.mockResolvedValue([{taskId:'daily',runId:'latest',completed:true,success:true},{taskId:'other',runId:'one',completed:true,success:true}]);
 let hook:any;await act(async()=>{hook=renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).not.toHaveBeenCalled();expect(Array.isArray(JSON.parse(localStorage.getItem('xiaok:scheduled-delivered-runs')!))).toBe(false);
 hook.unmount();await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({daily:2,other:1});
 const newer={taskId:'daily',runId:'newer',completed:true,success:true};
 await act(async()=>{await m.due(newer);await m.due(newer);});
 expect(toast).toHaveBeenCalledTimes(1);expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({daily:3,other:1});
 window.removeEventListener('xiaok:scheduled-toast',toast);
});

// QA repro shape (#156 codex Major): plan-old once, then 500 distinct filler
// plans each once; reload still recovers plan-old and must not re-toast it.
it('keeps plan-old after 500 distinct live filler plans so reload does not re-toast',async()=>{
 const toast=vi.fn();window.addEventListener('xiaok:scheduled-toast',toast);
 const oldPlan={...row,id:'plan-old',name:'Old Plan',threadId:'thread-old',runtimeTaskId:'task_old'};
 const oldDelivery={taskId:'plan-old',runId:'run-old',runtimeTaskId:'task_old',completed:true,success:true,lastRunAt:10,title:'Old Plan'};
 const fillers=Array.from({length:500},(_,i)=>({...row,id:`plan-fill-${i}`,name:`Fill ${i}`,threadId:`thread-fill-${i}`,runtimeTaskId:`task_fill_${i}`,lastRunAt:20+i}));
 m.schedules.mockResolvedValue([oldPlan]);
 let hook:any;await act(async()=>{hook=renderHook(()=>useScheduledTaskBootstrap());});
 await act(async()=>{await m.due(oldDelivery);});
 expect(toast).toHaveBeenCalledTimes(1);
 expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({'plan-old':1});
 m.schedules.mockResolvedValue([oldPlan,...fillers]);
 const now=vi.spyOn(Date,'now');
 try {
  await act(async()=>{for(let i=0;i<500;i++){now.mockReturnValue(2000+i);await m.due({taskId:`plan-fill-${i}`,runId:`run-fill-${i}`,runtimeTaskId:`task_fill_${i}`,completed:true,success:true,lastRunAt:20+i,title:`Fill ${i}`});}});
 } finally {now.mockRestore();}
 expect(toast).toHaveBeenCalledTimes(501);
 const unread=localStorage.getItem('xiaok:scheduled-unread');
 const stored=JSON.parse(localStorage.getItem('xiaok:scheduled-delivered-runs')!);
 expect(stored['plan-old']?.identity).toBe('plan-old:run-old');
 hook.unmount();m.recent.mockResolvedValue([oldDelivery]);m.schedules.mockResolvedValue([oldPlan,...fillers]);
 await act(async()=>{renderHook(()=>useScheduledTaskBootstrap());});
 expect(toast).toHaveBeenCalledTimes(501);expect(localStorage.getItem('xiaok:scheduled-unread')).toBe(unread);
 window.removeEventListener('xiaok:scheduled-toast',toast);
});
