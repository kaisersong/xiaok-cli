// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ASSISTANT_CHAT_THREAD,LEGACY_ASSISTANT_CHAT_THREAD,isAssistantThread} from '../../shared/assistant-inbox-contract.js';
import {ASSISTANT_THREAD_ID} from '../../renderer/src/lib/assistant-thread.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {assembleOwnedHistory, withAssistantUserHistory} from '../../electron/context-continuity/history.js';
import { TaskContinuitySource } from '../../electron/context-continuity/task-source.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
it('keeps legacy assistant data distinct while recognizing both exact protected assistant identities',()=>{
 expect(LEGACY_ASSISTANT_CHAT_THREAD).toBe('a0c11111-1111-4111-8111-111111111111');expect(ASSISTANT_CHAT_THREAD).toBe('a0c11111-1111-4111-8111-111111111112');expect(ASSISTANT_THREAD_ID).toBe(ASSISTANT_CHAT_THREAD);
 expect(isAssistantThread(ASSISTANT_CHAT_THREAD)).toBe(true);expect(isAssistantThread(LEGACY_ASSISTANT_CHAT_THREAD)).toBe(true);expect(isAssistantThread('a0c11111-1111-4111-8111-111111111113')).toBe(false);
 const root=mkdtempSync(join(tmpdir(),'assistant-chat-generation-')),service=new ContinuityService({dbPath:join(root,'actual.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 try{const old=service.ensureAssistantConversation(actor,LEGACY_ASSISTANT_CHAT_THREAD);const before=service.store.db.prepare('SELECT record FROM conversations WHERE id=?').get(LEGACY_ASSISTANT_CHAT_THREAD);const current=service.ensureAssistantConversation(actor,ASSISTANT_CHAT_THREAD);expect(current?.id).not.toBe(old?.id);expect(current?.taskIds).toEqual([]);expect(service.ensureAssistantConversation(actor,ASSISTANT_CHAT_THREAD)).toEqual(current);expect(service.store.db.prepare('SELECT record FROM conversations WHERE id=?').get(LEGACY_ASSISTANT_CHAT_THREAD)).toEqual(before);}finally{service.store.close();rmSync(root,{recursive:true,force:true});}
});

it('continues the same assistant thread after a terminal read turn without granting source closure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'assistant-chat-readlike-'));
  const service = new ContinuityService({ dbPath: join(root, 'actual.sqlite'), profileId: 'profile' });
  const actor = { requestSource: 'user' as const, profileId: 'profile', actorId: 'desktop-user:profile' };
  const threadId = ASSISTANT_CHAT_THREAD;
  const source = new TaskContinuitySource(service, actor);
  try {
    service.ensureAssistantConversation(actor, threadId);
    const snapshot: TaskSnapshot = {
      taskId: 'task_previous', sessionId: 'epoch_fixture', status: 'completed' as const,
      prompt: 'Prior text must stay out of the next model request', materials: [],
      events: [
        { type: 'canvas_tool_call', toolName: 'web_search', toolUseId: 'request_fixture', input: {}, eventId: 'request_start' },
        { type: 'goal_tool_finished', toolName: 'web_search', invocationId: 'request_fixture', ok: true },
      ],
      context: { threadId, taskIds: [], loadedTaskIds: [], skipped: [] },
      createdAt: 1, updatedAt: 2,
    };
    await source.bindPrepared({ conversationId: threadId, taskId: snapshot.taskId, publicPrompt: snapshot.prompt }, async () => snapshot);
    service.recordUnprovenEffect(actor, snapshot.taskId, 'request_fixture', 'web_search');
    expect(() => assembleOwnedHistory(service, actor, 'task_automatic', { threadId })).toThrow('blocked_unsettled');
    const next = withAssistantUserHistory(threadId, () => assembleOwnedHistory(service, actor, 'task_next', { threadId }, () => snapshot));
    expect(next).toEqual({
      history: [],
      audit: { threadId, taskIds: [snapshot.taskId], loadedTaskIds: [], skipped: [{ taskId: snapshot.taskId, reason: 'unsettled' }] },
    });
    expect(service.getConversation(actor, threadId)?.taskIds).toEqual([snapshot.taskId]);
    expect(() => service.assertHistorySourceClosed(snapshot.taskId)).toThrow('blocked_unsettled');
    const conflicting: TaskSnapshot = { ...snapshot, events: [
      { type: 'canvas_tool_call', toolName: 'write', toolUseId: 'request_fixture', input: {}, eventId: 'request_start' },
      snapshot.events[1],
    ] };
    expect(() => withAssistantUserHistory(threadId, () => assembleOwnedHistory(service, actor, 'task_conflict', { threadId }, () => conflicting))).toThrow('blocked_unsettled');

    service.recordUnprovenEffect(actor, snapshot.taskId, 'write_fixture', 'write');
    expect(() => withAssistantUserHistory(threadId, () => assembleOwnedHistory(service, actor, 'task_later', { threadId }, () => snapshot))).toThrow('blocked_unsettled');
  } finally {
    service.store.close();
    rmSync(root, { recursive: true, force: true });
  }
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

it.each(['workspace', 'outside', 'missing'] as const)('checks historical file facts for a %s destination', async kind => {
  const root = mkdtempSync(join(tmpdir(), 'assistant-file-history-'));
  const work = join(root, 'assistant-workspace');
  mkdirSync(work);
  const service = new ContinuityService({ dbPath: join(root,'actual.sqlite'), profileId: 'profile' });
  const actor = { requestSource:'user' as const, profileId:'profile', actorId:'desktop-user:profile' };
  const threadId = ASSISTANT_CHAT_THREAD;
  const source = new TaskContinuitySource(service, actor);
  try {
    service.ensureAssistantConversation(actor, threadId);
    const snapshot: TaskSnapshot = {
      taskId:'task_file', sessionId:'epoch_file', status:'completed', prompt:'Write a document', materials: [],
      context:{threadId,taskIds:[],loadedTaskIds:[],skipped:[]}, createdAt:1, updatedAt:2,
      events:[
        {type:'canvas_tool_call',toolName:'assistant_read_sources',toolUseId:'refresh',input:{},eventId:'refresh_begin'},
        {type:'goal_tool_finished',toolName:'assistant_read_sources',invocationId:'refresh',ok:true},
        {type:'canvas_tool_call',toolName:'write',toolUseId:'file',input:{file_path:'report.md'},eventId:'file_begin'},
        ...(kind === 'missing' ? [] : [{type:'goal_tool_fact' as const,toolName:'write',invocationId:'file',factKind:'file_mutation' as const,
          normalizedFilePaths:[join(kind === 'outside' ? root : work,'report.md')]}]),
        {type:'goal_tool_finished',toolName:'write',invocationId:'file',ok:true},
      ],
    };
    await source.bindPrepared({conversationId:threadId,taskId:snapshot.taskId,publicPrompt:snapshot.prompt},async()=>snapshot);
    service.recordUnprovenEffect(actor,snapshot.taskId,'refresh','assistant_read_sources');
    service.recordUnprovenEffect(actor,snapshot.taskId,'file','write');
    const resume = () => withAssistantUserHistory(threadId, () => assembleOwnedHistory(service,actor,'task_next',{threadId},()=>snapshot,work));
    if (kind === 'workspace') expect(resume()?.audit?.skipped).toEqual([{taskId:snapshot.taskId,reason:'unsettled'}]);
    else expect(resume).toThrow('blocked_unsettled');
    expect(() => service.assertHistorySourceClosed(snapshot.taskId)).toThrow('blocked_unsettled');
  } finally {
    service.store.close();
    rmSync(root,{recursive:true,force:true});
  }
});
