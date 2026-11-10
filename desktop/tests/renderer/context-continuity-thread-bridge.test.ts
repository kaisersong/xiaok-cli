import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
const state = vi.hoisted(() => ({ desktop: null as Record<string, unknown> | null }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => state.desktop, isDesktop: () => true }));
afterEach(() => { state.desktop = null; vi.unstubAllGlobals(); });
const conversation = { id: 'main-owned', title: 'source', status: 'idle', mode: 'work', createdAt: 1, updatedAt: 1, starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: 'task_real', taskIds: ['task_real'], revision: 1, coverage: 'complete' };
it('creates and updates new conversations through the main owner without touching IndexedDB', async () => {
  const open = vi.fn(() => { throw new Error('renderer write prohibited'); }); vi.stubGlobal('indexedDB', { open });
  const create = vi.fn(async () => conversation), get = vi.fn(async () => conversation), update = vi.fn(async () => conversation);
  state.desktop = { createContextConversation: create, getContextConversation: get, updateContextConversation: update };
  expect((await api.createThread({ title: 'source' })).id).toBe('main-owned');
  expect(create).toHaveBeenCalledWith({ operationId: expect.any(String), title: 'source' });
  expect((await api.getThread('main-owned'))?.id).toBe('main-owned');
  await api.updateThreadTitle('main-owned', 'edited'); await api.updateThreadSidebarState('main-owned', { starred: true });
  expect(update).toHaveBeenCalledWith({ conversationId: 'main-owned', patch: { title: 'edited' } });
  await api.updateThreadTaskId('main-owned', 'task_real');
  await expect(api.updateThreadTaskId('main-owned', 'task_forged')).rejects.toThrow('source_binding_conflict');
  expect(open).not.toHaveBeenCalled();
});
it('does not silently fall back to renderer writes when the main owner fails', async () => {
  const open = vi.fn(); vi.stubGlobal('indexedDB', { open });
  state.desktop = { createContextConversation: vi.fn(async () => { throw new Error('storage unavailable'); }) };
  await expect(api.createThread({})).rejects.toThrow('storage unavailable'); expect(open).not.toHaveBeenCalled();
});

it('never revives a claimed conversation from IndexedDB after the main owner tombstones it', async () => {
  const open = vi.fn(() => { throw new Error('deleted fallback prohibited'); }); vi.stubGlobal('indexedDB', { open });
  state.desktop = { inspectContextConversations: vi.fn(async () => [{ id: 'main-owned', state: 'deleted' }]), getContextConversation: vi.fn(async () => null) };
  expect(await api.getThread('main-owned')).toBeNull();
  await expect(api.updateThreadTitle('main-owned', 'resurrect')).rejects.toThrow('not_readable');
  await expect(api.updateThreadTaskId('main-owned', 'task_fake')).rejects.toThrow('not_readable');
  expect(open).not.toHaveBeenCalled();
});

it('keeps paginated legacy candidates separate from main-authorized task history after a partial claim', async () => {
  const open = vi.fn(() => { throw new Error('main metadata must survive without IndexedDB'); }); vi.stubGlobal('indexedDB', { open });
  const metadata = vi.fn(async ({ offset }: { offset?: number }) => offset ? { id: conversation.id, taskIds: ['task_last'], total: 3 } : { id: conversation.id, taskIds: ['task_real', 'task_unclaimed'], total: 3, nextOffset: 2 });
  state.desktop = { getContextConversation: vi.fn(async () => ({ ...conversation, coverage: 'partial' })), getLegacyThreadMetadata: metadata };
  const record = await api.getThread(conversation.id);
  expect(record?.taskIds).toEqual(['task_real']); expect(record?.legacyTaskIds).toEqual(['task_unclaimed', 'task_last']);
  expect(metadata).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled();
});

it('uses main metadata for stars and refuses a failed or unclaimed owner mutation without browser writes',async()=>{
  const browserWrite=vi.spyOn(Storage.prototype,'setItem');
  const update=vi.fn(async()=>({...conversation,starred:true}));
  state.desktop={getContextConversation:vi.fn(async({conversationId})=>conversationId===conversation.id?conversation:null),
    listContextConversations:vi.fn(async()=>[{...conversation,starred:true},{...conversation,id:'other',starred:false}]),
    updateContextConversation:update};
  expect(await api.listStarredThreadIds()).toEqual([conversation.id]);
  await api.starThread(conversation.id);await api.unstarThread(conversation.id);
  expect(update.mock.calls).toEqual([[{conversationId:conversation.id,patch:{starred:true}}],[{conversationId:conversation.id,patch:{starred:false}}]]);
  await expect(api.starThread('unclaimed')).rejects.toThrow('legacy_claim_required');
  update.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(api.starThread(conversation.id)).rejects.toThrow('storage unavailable');
  expect(browserWrite).not.toHaveBeenCalled();browserWrite.mockRestore();
});
