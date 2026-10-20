// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { createDesktopServices } from '../../electron/desktop-services.js';

describe('continuity through real Desktop admission and persisted task events', () => {
  it.each(['cancel', 'deny'])('keeps owner negative control %s available after context revocation while positive admission stays closed', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'continuity-cancel-control-')); let entered = false;
    const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root, kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never,
      runner: async input => { const { service, actor } = services.continuity.port(); service.resolveReference({ ...actor, requestSource: 'agent', taskId: input.taskId }, { refId }); if (mode === 'deny') await input.emitRuntimeEvent({ type: 'approval_required', sessionId: input.sessionId, turnId: input.taskId, approvalId: 'approval', prompt: 'fixture' }); entered = true; await new Promise<void>(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true }); }); },
    });
    let refId = '';
    try {
      const { service, actor } = services.continuity.port();
      const source = service.createConversation(actor, { operationId: 'source' }), target = service.createConversation(actor, { operationId: 'target' });
      service.recordMessage(actor, { conversationId: source.id, sourceId: 'fixture', sourceKind: 'desktop_task', sourceDataEpoch: 'e', sourceMessageId: 'm', sourceRevision: 1, role: 'assistant', text: 'private', executionState: 'settled' });
      refId = service.createReference(actor, { conversationId: source.id, expectedRevision: service.getConversation(actor, source.id)!.revision, operationId: 'ref' }).refId;
      const grant = service.attachReference(actor, { refId, targetConversationId: target.id, operationId: 'grant' });
      const task = await services.createTask({ prompt: 'run', materials: [], context: { threadId: target.id } }); await vi.waitFor(() => expect(entered).toBe(true));
      service.revokeGrant(actor, grant);
      const user = { requestSource: 'user' as const, actorId: actor.actorId };
      if (mode === 'deny') await expect(services.answerQuestion({ taskId: task.taskId, answer: { questionId: 'approval', type: 'choice', choiceId: 'deny' } }, user)).resolves.toBeUndefined();
      await expect(services.cancelTask(task.taskId, user)).resolves.toBeUndefined();
      await expect(services.authorizeTaskRead(task.taskId, user)).rejects.toThrow('not_readable');
    } finally { await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true }); }
  });
  it('binds accepted original input before execution, then captures the actual public result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-continuity-'));
    const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root,
      kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never,
      runner: async input => {
        const base = { sessionId: input.sessionId, turnId: input.taskId, intentId: 'test', stepId: 'test' };
        await input.emitRuntimeEvent({ type: 'assistant_delta', ...base, delta: 'actual answer' });
        await input.emitRuntimeEvent({ type: 'receipt_emitted', ...base, note: JSON.stringify({ summary: 'actual answer', artifacts: [] }) });
      },
    });
    try {
      const { service, actor } = services.continuity.port();
      const c = service.createConversation(actor, { operationId: 'new', title: 'source' });
      const created = await services.createTask({ prompt: 'original input', materials: [], context: { threadId: c.id } });
      expect(service.getConversation(actor, c.id)?.taskIds).toContain(created.taskId);
      await vi.waitFor(() => expect(service.listMessages(actor, c.id).map(m => m.text)).toEqual(['original input', 'actual answer']));
      await vi.waitFor(() => expect(service.listMessages(actor, c.id).every(m => m.executionState === 'settled')).toBe(true));
      const ref = service.createReference(actor, { conversationId: c.id, expectedRevision: service.getConversation(actor, c.id)!.revision, operationId: 'ref' });
      expect(service.resolveReference(actor, { refId: ref.refId }).messages.map(m => m.text)).toEqual(['original input', 'actual answer']);
    } finally { await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it('keeps logically cancelled output unreadable until the real runner physically settles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-continuity-cancel-'));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root,
      kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never,
      runner: async input => {
        await input.emitRuntimeEvent({ type: 'turn_aborted', sessionId: input.sessionId, turnId: input.taskId, partialText: 'partial' });
        await gate;
      },
    });
    try {
      const { service, actor } = services.continuity.port();
      const c = service.createConversation(actor, { operationId: 'new' });
      const created = await services.createTask({ prompt: 'original', materials: [], context: { threadId: c.id } });
      await vi.waitFor(() => expect(service.listMessages(actor, c.id).map(m => m.text)).toEqual(['original', 'partial']));
      const ref = service.createReference(actor, { conversationId: c.id, expectedRevision: service.getConversation(actor, c.id)!.revision, operationId: 'ref' });
      const consumer = { ...actor, requestSource: 'agent' as const, taskId: created.taskId };
      expect(() => service.resolveReference(consumer, { refId: ref.refId })).toThrow('not_readable');
      release();
      await vi.waitFor(() => expect(service.resolveReference(consumer, { refId: ref.refId }).messages.map(m => m.text)).toEqual(['original', 'partial']));
    } finally { release(); await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });

  it.each(['revoke', 'delete-derived-message'])('blocks invalid derived context at raw task reads and the next real history admission: %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-continuity-dependency-'));
    let read!: (taskId: string) => string; const runner = vi.fn(async input => {
      const text = input.history?.length ? 'history-derived canary' : read(input.taskId);
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: input.taskId, intentId: 'test', stepId: 'test', note: JSON.stringify({ summary: text, artifacts: [] }) });
    });
    const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root, runner,
      kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never });
    try {
      const { service, actor } = services.continuity.port();
      const source = service.createConversation(actor, { operationId: 'source' }), target = service.createConversation(actor, { operationId: 'target' });
      service.recordMessage(actor, { conversationId: source.id, sourceKind: 'desktop_task', sourceId: 'owner_fixture', sourceDataEpoch: 'fixture', sourceMessageId: 'user', sourceRevision: 1, role: 'user', text: 'private source', executionState: 'settled' });
      const ref = service.createReference(actor, { conversationId: source.id, expectedRevision: service.getConversation(actor, source.id)!.revision, operationId: 'ref' });
      const grant = service.attachReference(actor, { refId: ref.refId, targetConversationId: target.id, operationId: 'grant' });
      read = taskId => service.resolveReference({ ...actor, requestSource: 'agent', taskId }, { refId: ref.refId }).messages[0].text;
      const first = await services.createTask({ prompt: 'read context', materials: [], context: { threadId: target.id } });
      await vi.waitFor(() => expect(service.listMessages(actor, target.id).some(m => m.text === 'private source')).toBe(true));
      const second = await services.createTask({ prompt: 'derive via ordinary history', materials: [], context: { threadId: target.id, taskIds: [first.taskId] } });
      await vi.waitFor(() => expect(service.listMessages(actor, target.id).some(m => m.text === 'history-derived canary')).toBe(true));
      if (mode === 'revoke') service.revokeGrant(actor, grant);
      else service.deleteMessage(actor, { conversationId: target.id, messageId: service.listMessages(actor, target.id).find(m => m.sourceId === first.taskId && m.text === 'private source')!.messageId });
      expect(() => service.assertTaskReadable(second.taskId)).toThrow('not_readable');
      await expect(services.recoverTask(second.taskId)).rejects.toThrow('not_readable');
      expect(service.listMessages(actor, target.id).some(m => m.text === 'history-derived canary')).toBe(false);
      await expect(services.createTask({ prompt: 'continue', materials: [], context: { threadId: target.id, taskIds: [first.taskId] } })).rejects.toThrow('not_readable');
      expect(runner).toHaveBeenCalledTimes(2);
    } finally { await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });

});

it.each(['authorization','internal-recover'] as const)('rechecks dependency revocation after the real %s waits for snapshot IO',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-read-race-'));let refId='';
 const main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never,runner:async input=>{const p=main.continuity.port(),text=input.prompt==='source'?'source canary':p.service.resolveReference({...p.actor,requestSource:'agent',taskId:input.taskId},{refId}).messages[0].text;await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary:text,artifacts:[]})});}});
 let release=()=>{},restore=()=>{};
 try{
  const p=main.continuity.port(),source=p.service.createConversation(p.actor,{operationId:'source'}),target=p.service.createConversation(p.actor,{operationId:'target'}),a=await main.createTask({prompt:'source',materials:[],context:{threadId:source.id}});await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(a.taskId)).toBeTruthy());
  refId=p.service.createReference(p.actor,{conversationId:source.id,expectedRevision:p.service.getConversation(p.actor,source.id)!.revision,operationId:'ref'}).refId;const grant=p.service.attachReference(p.actor,{refId,targetConversationId:target.id,operationId:'grant'}),b=await main.createTask({prompt:'derive',materials:[],context:{threadId:target.id}});await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(b.taskId)).toBeTruthy());
  let entered!:()=>void;const latched=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=FileTaskSnapshotStore.prototype.recoverTask;let armed=true;
  const spy=vi.spyOn(FileTaskSnapshotStore.prototype,'recoverTask').mockImplementation(async function(taskId,options){if(armed&&taskId===b.taskId){armed=false;entered();await gate;}return original.call(this,taskId,options);});restore=()=>spy.mockRestore();
  const authorization=mode==='authorization'?main.authorizeTaskRead(b.taskId,{requestSource:'user',actorId:p.actor.actorId}):main.recoverTask(b.taskId);await latched;p.service.revokeGrant(p.actor,grant);release();await expect(authorization).rejects.toThrow('not_readable');
 }finally{release();restore();await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it('requires an issued main read scope and rechecks noncanonical MA deletion without an await',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-read-scope-')),main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never});
 try{await main.multiAgent!.ready;const m=main.multiAgent!,threadId='noncanonical',taskId='task_noncanonical',actor={requestSource:'user' as const,actorId:`desktop-user:${m.profileId}`};
  await new FileTaskSnapshotStore(join(root,'tasks')).save({taskId,sessionId:'epoch',prompt:'fixture',status:'completed',context:{threadId},materials:[],events:[],createdAt:1,updatedAt:2} as never);m.service.registerThread({threadId,profileId:m.profileId,workspaceId:m.workspaceId,cwd:m.cwd});
  expect(()=>main.assertTaskReadCurrent(taskId,actor)).toThrow('task_read_fence_unavailable');await main.authorizeTaskRead(taskId,actor);expect(()=>main.assertTaskReadCurrent(taskId,actor)).not.toThrow();expect(()=>main.assertTaskReadCurrent(taskId,{...actor})).toThrow('task_read_fence_unavailable');
  const access=m.service.createUserAccess({requestSource:'user',actorId:actor.actorId,profileId:m.profileId,workspaceId:m.workspaceId,threadId}),before=m.service.readThreadDeletion({access});await m.service.deleteThread({access,requestSource:'user',confirmTerminate:true,expectedThreadRevision:before.threadRevision,operationId:`delete:${before.threadRevision}:scope-fence`});expect(()=>main.assertTaskReadCurrent(taskId,actor)).toThrow('task_scope_forbidden');
 }finally{await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
