import {afterEach,describe,expect,it,vi} from 'vitest';
import {ensureAggregatedScheduledThread,type ScheduledThreadApi} from '../../renderer/src/lib/scheduled-task-threads';
const state=vi.hoisted(()=>({desktop:true}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.desktop?{getContextConversation:()=>undefined}:null}));
afterEach(()=>{state.desktop=true;});
function ports():ScheduledThreadApi{
 return{getThread:vi.fn(async()=>null),listThreads:vi.fn(async()=>[]),createThread:vi.fn(async()=>({id:'empty-main',taskIds:[]})),updateThreadTaskId:vi.fn(async()=>{throw Error('source_binding_conflict');})};
}
describe('scheduled history with Main-owned continuity',()=>{
 it.each(['preferred','list'] as const)('also preserves web read failures (%s) instead of creating replacement history',async phase=>{
  state.desktop=false;const p=ports();
  if(phase==='preferred')vi.mocked(p.getThread).mockRejectedValue(Error('read_unavailable'));
  else vi.mocked(p.listThreads).mockRejectedValue(Error('read_unavailable'));
  await expect(ensureAggregatedScheduledThread({...(phase==='preferred'?{threadId:'original'}:{}),runtimeTaskId:'task_old'},['task_old'],p)).rejects.toThrow('read_unavailable');
  expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
 it('propagates a refused preferred read without creating an empty conversation',async()=>{
  const p=ports();vi.mocked(p.getThread).mockRejectedValue(Error('not_readable'));
  await expect(ensureAggregatedScheduledThread({threadId:'old',runtimeTaskId:'task_old'},['task_old'],p)).rejects.toThrow('not_readable');
  expect(p.listThreads).not.toHaveBeenCalled();expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
 it('propagates list failure rather than treating failed discovery as an empty store',async()=>{
  const p=ports();vi.mocked(p.listThreads).mockRejectedValue(Error('continuity_unavailable'));
  await expect(ensureAggregatedScheduledThread({runtimeTaskId:'task_old'},['task_old'],p)).rejects.toThrow('continuity_unavailable');
  expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
 it('refuses two genuinely missing projections without committing orphan conversations',async()=>{
  const p=ports();for(let i=0;i<2;i++)await expect(ensureAggregatedScheduledThread({runtimeTaskId:'task_old'},['task_old'],p)).rejects.toThrow('scheduled_projection_unavailable');
  expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
 it('keeps an existing readable legacy navigation link without granting task bindings',async()=>{
  const p=ports();vi.mocked(p.getThread).mockResolvedValue({id:'legacy-original',taskIds:['task_old'],currentTaskId:'task_old'});
  const row=await ensureAggregatedScheduledThread({threadId:'legacy-original',runtimeTaskId:'task_new'},['task_old','task_new'],p);
  expect(row.threadId).toBe('legacy-original');expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
 it('uses an existing Main-bound conversation for display and never appends arbitrary history ids',async()=>{
  const p=ports();vi.mocked(p.listThreads).mockResolvedValue([{id:'owned',taskIds:['task_new'],currentTaskId:'task_new'}]);
  expect((await ensureAggregatedScheduledThread({runtimeTaskId:'task_new'},['task_old','task_new'],p)).threadId).toBe('owned');
  expect(p.createThread).not.toHaveBeenCalled();expect(p.updateThreadTaskId).not.toHaveBeenCalled();
 });
});
