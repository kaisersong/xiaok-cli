// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { registerDesktopMultiAgentIpc } from '../../electron/desktop-multi-agent-ipc.js';

it('binds an immutable mailbox source to its new consumer before disclosure and preserves revocation transitively', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-mailbox-policy-'));
  const continuity = new ContinuityService({ dbPath: join(root, 'continuity.sqlite'), profileId: 'p' });
  const actor = { requestSource: 'user' as const, profileId: 'p', actorId: 'desktop-user:p' };
  const source = continuity.createConversation(actor, { operationId: 'source' }), target = continuity.createConversation(actor, { operationId: 'target' });
  continuity.recordMessage(actor, { conversationId: source.id, sourceKind: 'desktop_task', sourceId: 'owner', sourceDataEpoch: 'e', sourceMessageId: 'm', sourceRevision: 1, role: 'assistant', text: 'CANARY', executionState: 'settled' });
  const ref = continuity.createReference(actor, { conversationId: source.id, expectedRevision: continuity.getConversation(actor, source.id)!.revision, operationId: 'ref' });
  const grant = continuity.attachReference(actor, { refId: ref.refId, targetConversationId: target.id, operationId: 'grant' });
  for (const taskId of ['task_A', 'task_B']) continuity.bindTask(actor, { conversationId: target.id, taskId });
  continuity.recordMessage(actor, { conversationId: target.id, sourceKind: 'desktop_task', sourceId: 'task_A', sourceDataEpoch: 'epoch-A', sourceMessageId: 'result', sourceRevision: 1, role: 'assistant', text: 'CANARY', executionState: 'settled' });
  continuity.resolveReference({ ...actor, requestSource: 'agent', taskId: 'task_A' }, { refId: ref.refId });
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); store.registerThread({ threadId: target.id, profileId: 'p', workspaceId: 'w', cwd: root });
  const group = store.createGroup(target.id), receiver = `root_${group.groupId}`;
  store.putAgent(group.groupId, { id: 'child', parentId: receiver, taskName: 'child', canonicalName: '/root/child', depth: 1, status: 'completed', turn: 1, sourceTaskId: 'task_A' });
  const message = store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: 'child' }, receiverId: receiver, text: 'CANARY', sourceTaskId: 'task_A' });
  const mailbox = new DesktopMultiAgentTurnMailbox({ store, groupId: group.groupId, agentId: receiver, turnId: 'new-turn', commands: new MultiAgentCommandSequencer(), assertCurrent: () => {}, onSeal: () => {}, authorizeMessages: messages => continuity.recordSourceTasks(actor, 'task_B', messages.filter(message => message.sender.kind === 'agent').map(message => message.sourceTaskId!)) });
  try {
    const batch = await mailbox.drainInput(); expect(batch.messages[0].sourceTaskId).toBe('task_A'); await mailbox.confirmApplied(batch.claimId!);
    continuity.revokeGrant(actor, grant); expect(() => continuity.assertTaskReadable('task_B')).toThrow('not_readable');
    expect(store.listMessages(group.groupId, receiver)[0].messageId).toBe(message.messageId);
  } finally { store.close(); continuity.close(); rmSync(root, { recursive: true, force: true }); }
});

it('rechecks raw collaboration content, events and an existing subscription after context revocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-group-read-')), store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); let readable = true;
  store.registerThread({ threadId: 'thread', profileId: 'p', workspaceId: 'w', cwd: root }); const group = store.createGroup('thread');
  store.putAgent(group.groupId, { id: 'child', parentId: `root_${group.groupId}`, taskName: 'child', canonicalName: '/root/child', depth: 1, status: 'completed', turn: 1 });
  const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: async () => { throw new Error('unused'); }, authorizeContentRead: () => { if (!readable) throw new Error('not_readable'); } });
  const access = service.createUserAccess({ requestSource: 'user', actorId: 'u', threadId: 'thread', profileId: 'p', workspaceId: 'w' });
  const content = store.putContent(group.groupId, 'child', 'CANARY'); const events: unknown[] = []; const unsubscribe = service.subscribe(access, event => events.push(event));
  try {
    expect(Buffer.from(service.readContent({ access, groupId: group.groupId, contentId: content.contentId, offset: 0 }).base64, 'base64').toString()).toBe('CANARY');
    readable = false;
    expect(() => service.readContent({ access, groupId: group.groupId, contentId: content.contentId, offset: 0 })).toThrow('not_readable');
    expect(() => service.readEvents({ access, groupId: group.groupId, afterSeq: 0 })).toThrow('not_readable');
    expect(() => service.getSnapshot({ access, groupId: group.groupId })).toThrow('not_readable');
    expect(() => service.readResources({ access, groupId: group.groupId })).toThrow('not_readable');
    const before = events.length; store.appendEvent(group.groupId, { kind: 'output', agentId: 'child', payload: { text: 'CANARY' } });
    expect(events).toHaveLength(before);
  } finally { unsubscribe(); await service.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

it.each(['snapshot','agents','events','content','groups','subscribe','snapshot-delete','operation-null-scope','operation-null-delete'] as const)('fences the real MA %s IPC after its final await when policy or scope changes',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-ma-ipc-race-')),continuity=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'p'}),store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));
 const actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'},source=continuity.createConversation(actor,{operationId:'source'}),target=continuity.createConversation(actor,{operationId:'target'});
 continuity.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'source',sourceDataEpoch:'epoch',sourceMessageId:'result',sourceRevision:1,role:'assistant',text:'MA_IPC_CANARY',executionState:'settled'});
 const ref=continuity.createReference(actor,{conversationId:source.id,expectedRevision:continuity.getConversation(actor,source.id)!.revision,operationId:'ref'}),grant=continuity.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});
 continuity.bindTask(actor,{conversationId:target.id,taskId:'task_A'});const text=continuity.resolveReference({...actor,requestSource:'agent',taskId:'task_A'},{refId:ref.refId}).messages[0].text;
 store.registerThread({threadId:target.id,profileId:'p',workspaceId:'w',cwd:root});const group=store.createGroup(target.id);
 store.putAgent(group.groupId,{id:'child',parentId:`root_${group.groupId}`,taskName:text,canonicalName:'/root/child',depth:1,status:'completed',turn:1,sourceTaskId:'task_A'});
 const content=store.putContent(group.groupId,'child',text);store.appendEvent(group.groupId,{kind:'output',agentId:'child',payload:{text}});
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw new Error('unused');},authorizeContentRead:()=>continuity.assertTaskReadable('task_A')});
 const mainFrame={},sender=Object.assign(new EventEmitter(),{id:1,mainFrame,isDestroyed:()=>false,send:vi.fn()}),event={sender,senderFrame:mainFrame},handlers=new Map<string,Function>();
 const stop=registerDesktopMultiAgentIpc({handle:(name,handler)=>handlers.set(name,handler)},{service,ready:Promise.resolve(),profileId:'p',workspaceId:'w',cwd:root},{authorize:()=>({actorId:actor.actorId})});
 const routes={snapshot:['getMultiAgentSnapshot','getSnapshot'],agents:['listMultiAgents','readAgents'],events:['getMultiAgentEvents','readEvents'],content:['getAgentContent','readContent'],groups:['listMultiAgentGroups','listGroups'],subscribe:['subscribeMultiAgents','getSnapshot'],'snapshot-delete':['getMultiAgentSnapshot','getSnapshot'],'operation-null-scope':['getMultiAgentOperation','readOperation'],'operation-null-delete':['getMultiAgentOperation','readOperation']} as const;
 const [channel,method]=routes[mode],input={threadId:target.id,...(mode==='groups'||mode==='snapshot-delete'?{}:{groupId:group.groupId}),...(mode==='content'?{contentId:content.contentId,offset:0}:{}),...(mode==='subscribe'?{subscriptionId:'private'}:{}),...(mode.startsWith('operation-null-')?{operationId:'missing'}:{})};
 const original=(service[method] as Function).bind(service);let spy:ReturnType<typeof vi.spyOn>|undefined;
 try{
  const first=await handlers.get(`desktop:${channel}`)!(event,input);if(mode.startsWith('operation-null-'))expect(first).toBeNull();else expect(first).toBeTruthy();
  if(mode==='subscribe')await handlers.get('desktop:unsubscribeMultiAgents')!(event,{subscriptionId:'private'});
  spy=vi.spyOn(service,method).mockImplementation(((...args:unknown[])=>{const result=original(...args);queueMicrotask(()=>{
   if(mode.endsWith('-scope')||mode.endsWith('-delete')){const changed=new DatabaseSync(join(root,'groups.sqlite'));try{if(mode.endsWith('-scope'))changed.prepare('UPDATE thread_bindings SET profile_id=? WHERE thread_id=?').run('foreign',target.id);else changed.prepare('UPDATE thread_bindings SET delete_state=? WHERE thread_id=?').run('delete_pending',target.id);}finally{changed.close();}}
   else continuity.revokeGrant(actor,grant);
  });return result;}) as never);
  await expect(handlers.get(`desktop:${channel}`)!(event,input)).rejects.toThrow(/not_readable|scope mismatch/);if(!mode.endsWith('-scope')&&!mode.endsWith('-delete'))expect(()=>continuity.assertTaskReadable('task_A')).toThrow('not_readable');
 }finally{spy?.mockRestore();stop();await service.dispose();store.close();continuity.close();rmSync(root,{recursive:true,force:true});}
});

it('issues exact opaque MA read receipts for null and clears capture state after errors, reentry and duplicate reads',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-ma-read-receipt-')),store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));
 store.registerThread({threadId:'thread',profileId:'p',workspaceId:'w',cwd:root});const group=store.createGroup('thread');
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw new Error('unused');}}),issue=()=>service.createUserAccess({requestSource:'user',actorId:'u',threadId:'thread',profileId:'p',workspaceId:'w'}),access=issue(),other=issue();
 const read=()=>service.readOperation({access,groupId:group.groupId,operationId:'missing'});
 try{
  expect(()=>new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw new Error('unused');},requireContentPolicy:true})).toThrow('multi_agent_content_policy_unavailable');
  expect(()=>service.captureUserRead(access,()=>null)).toThrow('multi_agent_read_manifest_unavailable');
  expect(()=>service.captureUserRead(access,()=>{throw new Error('read failed');})).toThrow('read failed');
  expect(()=>service.captureUserRead(access,()=>service.captureUserRead(access,read))).toThrow('multi_agent_read_capture_nested');
  expect(()=>service.captureUserRead(access,()=>{read();return read();})).toThrow('multi_agent_read_capture_mismatch');
  expect(()=>service.captureUserRead(access,()=>Promise.resolve(read()))).toThrow('multi_agent_read_capture_async');
  expect(()=>service.captureUserRead(access,read,()=>Promise.resolve(null))).toThrow('multi_agent_read_manifest_unavailable');
  const captured=service.captureUserRead(access,read);expect(captured.result).toBeNull();expect(()=>service.assertUserReadCurrent(captured.receipt,access,null)).not.toThrow();
  expect(()=>service.assertUserReadCurrent({...captured.receipt},access,null)).toThrow('multi_agent_read_manifest_unavailable');
  expect(()=>service.assertUserReadCurrent(captured.receipt,other,null)).toThrow('multi_agent_read_manifest_unavailable');
  expect(()=>service.assertUserReadCurrent(captured.receipt,access,{})).toThrow('multi_agent_read_manifest_unavailable');
 }finally{await service.dispose();store.close();rmSync(root,{recursive:true,force:true});}
});

it('does not issue a deleted safe-empty receipt while a real root-only group remains in the store',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-ma-safe-empty-')),file=join(root,'groups.sqlite'),store=new DesktopMultiAgentStore(file);
 store.registerThread({threadId:'thread',profileId:'p',workspaceId:'w',cwd:root});store.createGroup('thread');
 const changed=new DatabaseSync(file);try{changed.prepare('UPDATE thread_bindings SET delete_state=?,active_group_id=NULL WHERE thread_id=?').run('deleted','thread');}finally{changed.close();}
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),requireContentPolicy:true,authorizeContentRead:()=>{},createSession:async()=>{throw new Error('unused');}}),access=service.createUserAccess({requestSource:'user',actorId:'u',threadId:'thread',profileId:'p',workspaceId:'w'});
 try{expect(store.threadHasAgentHistory('thread')).toBe(false);expect(()=>service.captureUserRead(access,()=>service.getSnapshot({access}))).toThrow('not_readable');}
 finally{await service.dispose();store.close();rmSync(root,{recursive:true,force:true});}
});
