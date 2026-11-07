import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
import {projectRuntimeEventToDesktopEvent} from '../../../src/runtime/task-host/event-projection.js';
it('carries original explicitly owned approval metadata through the original task source and SQLite event receipt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-approval-source-'));const file=join(root,'activity.sqlite'),store=new ConversationActivityStore(file);
 const owner={schemaVersion:1 as const,kind:'codex_native_approval' as const,taskSessionId:'host-session',nativeIncarnation:randomUUID(),nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'actual-native-turn',nativeTurnGeneration:1,approvalToken:'question',requestDigest:'a'.repeat(64)};
 const projected=projectRuntimeEventToDesktopEvent({taskId:'task',event:{type:'approval_required',sessionId:'host-session',turnId:'task',approvalId:'question',owner}})!;
 store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run'});
 const service=new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),canObserveWork:()=>true});
 const host={async *subscribeTaskRecords(_task:string,options:{signal:AbortSignal}){yield{taskId:'task',sourceDataEpoch:'host-session',eventIndex:0,event:projected};if(!options.signal.aborted)await new Promise<void>(resolve=>options.signal.addEventListener('abort',()=>resolve(),{once:true}));}};
 const sources=new ConversationActivitySources({store,service,taskHost:()=>host as any,readProject:async()=>{throw Error('fixture_no_project');}});
 try{
  await sources.startWatch('watch');await vi.waitFor(()=>expect(store.getProjection('watch')?.executionState).toBe('input_required'));
  const db=new DatabaseSync(file,{readOnly:true});try{const row=db.prepare('SELECT e.content_json FROM source_events e JOIN watch_event_receipts r ON r.event_key=e.event_key WHERE r.watch_id=?').get('watch') as {content_json:string};const data=JSON.parse(row.content_json);expect(data.schemaVersion).toBe(2);expect(data.questionId).toBe('question');expect(data.questionOwner).toEqual(owner);}finally{db.close();}
 }finally{await sources.close();await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
