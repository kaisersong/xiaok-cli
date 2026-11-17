import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
import { recoverForDisplay } from '../../renderer/src/lib/recover-for-display';
import type { TaskSnapshot } from '../../shared/task-types';
const original = window.xiaokDesktop;
afterEach(() => { window.xiaokDesktop = original; });
const snapshot: TaskSnapshot = { taskId: 'task_old', sessionId: 'old-epoch', prompt: 'old ordinary input',
  status: 'completed', materials: [], events: [], createdAt: 1, updatedAt: 2 };

it('checks the actual old preload capability instead of the always-present bridge wrapper', async () => {
  window.xiaokDesktop = { recoverTask: vi.fn(async () => ({ snapshot })) } as unknown as typeof window.xiaokDesktop;
  const value = await recoverForDisplay(api, snapshot.taskId, undefined, () => true);
  expect(value.snapshot).toEqual(snapshot);
  expect(value.presentation).toBeUndefined();
});

it('does not downgrade a present preload method when it denies the new read', async () => {
  const read = vi.fn(async () => { throw new Error('task_history_unavailable'); });
  window.xiaokDesktop = { recoverTask: vi.fn(async () => ({ snapshot })), readTaskHistory: read } as unknown as typeof window.xiaokDesktop;
  await expect(recoverForDisplay(api, snapshot.taskId, undefined, () => true)).rejects.toThrow('task_history_unavailable');
  expect(read).toHaveBeenCalledTimes(1);
});
it('selects the explicit local archive before protected history and never promotes its messages to context',async()=>{
 const archive={taskId:snapshot.taskId,sourceEpoch:snapshot.sessionId,messages:[{sourceMessageId:'assistant:event:1',role:'assistant' as const,text:'old assistant only'}]},read=vi.fn(async()=>archive),protectedRead=vi.fn(async()=>{throw Error('protected_read_not_selected');});
 window.xiaokDesktop={recoverTask:vi.fn(async()=>({snapshot})),readTaskHistory:protectedRead,readLocalLegacyTaskArchive:read} as unknown as typeof window.xiaokDesktop;
 const value=await recoverForDisplay(api,snapshot.taskId,undefined,()=>true);expect(value.archive).toEqual(archive);expect(value.presentation).toBeNull();expect(read).toHaveBeenCalledOnce();expect(protectedRead).not.toHaveBeenCalled();
});
it('does not fall back to protected history or raw input after a local archive refusal',async()=>{
 const protectedRead=vi.fn();window.xiaokDesktop={recoverTask:vi.fn(async()=>({snapshot})),readTaskHistory:protectedRead,readLocalLegacyTaskArchive:vi.fn(async()=>{throw Error('archive_denied');})} as unknown as typeof window.xiaokDesktop;
 await expect(recoverForDisplay(api,snapshot.taskId,undefined,()=>true)).rejects.toThrow('archive_denied');expect(protectedRead).not.toHaveBeenCalled();
});
it('keeps a scoped snapshot on the existing protected history path even if the archive capability exists',async()=>{
 const scoped={...snapshot,context:{threadId:'current-thread'}},read=vi.fn(),protectedRead=vi.fn(async()=>{throw Error('protected_denied');});window.xiaokDesktop={recoverTask:vi.fn(async()=>({snapshot:scoped})),readTaskHistory:protectedRead,readLocalLegacyTaskArchive:read} as unknown as typeof window.xiaokDesktop;
 await expect(recoverForDisplay(api,snapshot.taskId,undefined,()=>true)).rejects.toThrow('protected_denied');expect(protectedRead).toHaveBeenCalledOnce();expect(read).not.toHaveBeenCalled();
});
it('uses an explicit legacy display hint for scoped local history but never retries a refused archive',async()=>{
 const scoped={...snapshot,context:{threadId:'historical-thread'}},read=vi.fn(async()=>{throw Error('local_legacy_archive_unavailable');}),protectedRead=vi.fn();window.xiaokDesktop={recoverTask:vi.fn(async()=>({snapshot:scoped})),readTaskHistory:protectedRead,readLocalLegacyTaskArchive:read} as unknown as typeof window.xiaokDesktop;
 await expect(recoverForDisplay(api,snapshot.taskId,undefined,()=>true,true)).rejects.toThrow('local_legacy_archive_unavailable');expect(read).toHaveBeenCalledOnce();expect(protectedRead).not.toHaveBeenCalled();
});
