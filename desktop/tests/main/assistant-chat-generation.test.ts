// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ASSISTANT_CHAT_THREAD,LEGACY_ASSISTANT_CHAT_THREAD,isAssistantThread} from '../../shared/assistant-inbox-contract.js';
import {ASSISTANT_THREAD_ID} from '../../renderer/src/lib/assistant-thread.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {assembleOwnedHistory} from '../../electron/context-continuity/history.js';
it('keeps legacy assistant data distinct while recognizing both exact protected assistant identities',()=>{
 expect(LEGACY_ASSISTANT_CHAT_THREAD).toBe('a0c11111-1111-4111-8111-111111111111');expect(ASSISTANT_CHAT_THREAD).toBe('a0c11111-1111-4111-8111-111111111112');expect(ASSISTANT_THREAD_ID).toBe(ASSISTANT_CHAT_THREAD);
 expect(isAssistantThread(ASSISTANT_CHAT_THREAD)).toBe(true);expect(isAssistantThread(LEGACY_ASSISTANT_CHAT_THREAD)).toBe(true);expect(isAssistantThread('a0c11111-1111-4111-8111-111111111113')).toBe(false);
 const root=mkdtempSync(join(tmpdir(),'assistant-chat-generation-')),service=new ContinuityService({dbPath:join(root,'actual.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 try{const old=service.ensureAssistantConversation(actor,LEGACY_ASSISTANT_CHAT_THREAD);const before=service.store.db.prepare('SELECT record FROM conversations WHERE id=?').get(LEGACY_ASSISTANT_CHAT_THREAD);const current=service.ensureAssistantConversation(actor,ASSISTANT_CHAT_THREAD);expect(current?.id).not.toBe(old?.id);expect(current?.taskIds).toEqual([]);expect(service.ensureAssistantConversation(actor,ASSISTANT_CHAT_THREAD)).toEqual(current);expect(service.store.db.prepare('SELECT record FROM conversations WHERE id=?').get(LEGACY_ASSISTANT_CHAT_THREAD)).toEqual(before);}finally{service.store.close();rmSync(root,{recursive:true,force:true});}
});

it('admits the recovery conversation while preserving the blocked original source', () => {
  const root = mkdtempSync(join(tmpdir(), 'assistant-chat-recovery-'));
  const service = new ContinuityService({ dbPath: join(root, 'actual.sqlite'), profileId: 'profile' });
  const actor = { requestSource: 'user' as const, profileId: 'profile', actorId: 'desktop-user:profile' };
  const recoveryId = 'a0c22222-aaaa-4111-8111-111111111112';
  try {
    service.ensureAssistantConversation(actor, ASSISTANT_CHAT_THREAD);
    service.bindTask(actor, { conversationId: ASSISTANT_CHAT_THREAD, taskId: 'task_previous' });
    service.recordUnprovenEffect(actor, 'task_previous', 'invocation_fixture', 'write');
    const original = service.getConversation(actor, ASSISTANT_CHAT_THREAD);

    expect(() => assembleOwnedHistory(service, actor, 'task_rejected', { threadId: ASSISTANT_CHAT_THREAD })).toThrow('blocked_unsettled');
    expect(assembleOwnedHistory(service, actor, 'task_fresh', { threadId: recoveryId })).toEqual({
      history: [],
      audit: { threadId: recoveryId, taskIds: [], loadedTaskIds: [], skipped: [] },
    });
    expect(service.getConversation(actor, ASSISTANT_CHAT_THREAD)).toEqual(original);
    expect(() => service.assertHistorySourceClosed('task_previous')).toThrow('blocked_unsettled');
  } finally {
    service.store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
