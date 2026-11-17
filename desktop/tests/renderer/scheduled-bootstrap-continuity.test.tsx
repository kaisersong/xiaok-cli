import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {useScheduledTaskBootstrap} from '../../renderer/src/hooks/useScheduledTaskBootstrap';
import {SCHEDULED_READ_FAILURE_EVENT} from '../../renderer/src/lib/scheduled-timed-action-error';
const state=vi.hoisted(()=>({
 row:{id:'own-schedule',name:'Own history',threadId:'original-thread',runtimeTaskId:'task_original'},
 get:vi.fn(),create:vi.fn(),update:vi.fn(),
}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({
 getContextConversation:()=>undefined,onScheduledTaskDue:()=>()=>{},
 getScheduledTasks:async()=>[state.row],getRecentScheduledDeliveries:async()=>[],
 getTimedActionRuns:async()=>[{runtimeTaskId:'task_original',startedAt:1}],
})}));
vi.mock('../../renderer/src/api',()=>({api:{getThread:state.get,listThreads:async()=>[],createThread:state.create,updateThreadTaskId:state.update}}));
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
it('two initial bootstraps preserve refused historical links and create no empty Main conversations',async()=>{
 const before=JSON.stringify([state.row]);localStorage.setItem('xiaok:scheduled-tasks',before);
 state.get.mockRejectedValue(Error('not_readable'));
 const failure=vi.fn();window.addEventListener(SCHEDULED_READ_FAILURE_EVENT,failure);
 try{
  const first=renderHook(()=>useScheduledTaskBootstrap());
  await waitFor(()=>expect(failure).toHaveBeenCalledTimes(1));first.unmount();
  const second=renderHook(()=>useScheduledTaskBootstrap());
  await waitFor(()=>expect(failure).toHaveBeenCalledTimes(2));second.unmount();
  expect(localStorage.getItem('xiaok:scheduled-tasks')).toBe(before);
  expect(state.create).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();
 }finally{window.removeEventListener(SCHEDULED_READ_FAILURE_EVENT,failure);}
});
