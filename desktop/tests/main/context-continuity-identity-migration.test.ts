// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {cpSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {CodexNativeService} from '../../electron/codex-native-service.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
const cleanup:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
const legacy='a'.repeat(64),profile=randomUUID();
function root(){const path=mkdtempSync(join(tmpdir(),'continuity-identity-migration-'));cleanup.push(()=>rmSync(path,{recursive:true,force:true}));return path;}
it('requires the physical MA boot owner, preserves denied permission/receipt and historical provenance, and resumes idempotently after restart',()=>{
 const file=join(root(),'groups.sqlite'),store=new DesktopMultiAgentStore(file);cleanup.push(()=>store.close());
 store.registerThread({threadId:'thread',profileId:legacy,workspaceId:'workspace',cwd:'/workspace'});
 const old=store.initializeWorkspaceAuthorization({profileId:legacy,workspaceId:'workspace'});
 const receipt=JSON.stringify({requestHash:'f'.repeat(64),receipt:{operationId:'exec-auth:old:0:x',state:'applied',permissionRevision:1,executionAllowed:false,persistenceState:'confirmed'}});
 store.compareAndSetWorkspaceAuthorization({profileId:legacy,workspaceId:'workspace',expectedPermissionRevision:0,next:{...old,permissionRevision:1,executionAllowed:false,actorId:`desktop-user:${legacy}`,lastReceiptJson:receipt}});
 expect(()=>store.migrateProfileIdentity(legacy,profile)).toThrow('multi_agent_owner_unknown');
 store.claimBootOwnership();store.migrateProfileIdentity(legacy,profile);
 expect(store.getThread('thread')?.profileId).toBe(profile);
 const migrated=store.initializeWorkspaceAuthorization({profileId:profile,workspaceId:'workspace'});
 expect(migrated).toMatchObject({executionAllowed:false,permissionRevision:1,actorId:`desktop-user:${legacy}`});expect(JSON.parse(migrated.lastReceiptJson!)).toEqual(JSON.parse(receipt));
 store.settleBootOwnership();store.close();
 const next=new DesktopMultiAgentStore(file);cleanup.push(()=>next.close());next.claimBootOwnership();next.migrateProfileIdentity(legacy,profile);expect(next.readWorkspaceAuthorization({profileId:profile,workspaceId:'workspace'})?.executionAllowed).toBe(false);next.settleBootOwnership();
});
it('fails a permission-domain collision atomically rather than creating an allowed replacement',()=>{
 const store=new DesktopMultiAgentStore(join(root(),'groups.sqlite'));cleanup.push(()=>store.close());store.claimBootOwnership();
 store.registerThread({threadId:'thread',profileId:legacy,workspaceId:'workspace',cwd:'/workspace'});
 for(const id of [legacy,profile])store.initializeWorkspaceAuthorization({profileId:id,workspaceId:'workspace'});
 expect(()=>store.migrateProfileIdentity(legacy,profile)).toThrow('profile_migration_conflict');expect(store.getThread('thread')?.profileId).toBe(legacy);store.settleBootOwnership();
});
it('moves activity origins, presentation/read cursors and tombstones under the exclusive owner without reviving deleted work',()=>{
 const file=join(root(),'activity.sqlite'),store=new ConversationActivityStore(file);cleanup.push(()=>store.close());
 store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'key',origin:{profileId:legacy,threadId:'thread',workspaceId:'workspace'}});
 store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'local',sourceDataEpoch:'epoch',workId:'task'});
 store.markPresented(legacy,'thread','sidebar',1);store.markRead(legacy,'thread',1);store.deleteThread(legacy,'thread','delete');
 store.migrateProfileIdentity(legacy,profile);
 expect(store.getWatch('watch')?.origin.profileId).toBe(profile);expect(store.getAssociation('operation')?.origin.profileId).toBe(profile);
 expect(store.getPresentationCursor(profile,'thread','sidebar')).toBe(1);
 expect(()=>store.prepareAssociation({operationId:'new',creationIdempotencyKey:'new',origin:{profileId:profile,threadId:'thread',workspaceId:'workspace'}})).toThrow('activity_thread_deleted');
 store.close();const next=new ConversationActivityStore(file);cleanup.push(()=>next.close());next.migrateProfileIdentity(legacy,profile);expect(next.getWatch('watch')?.status).toBe('stopped');
});
it('migrates native owners before loading sessions and keeps a failed owner/storage unavailable',async()=>{
 const path=root(),file=join(path,'native.sqlite');let db=new DatabaseSync(file);db.exec('CREATE TABLE codex_native_sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,native_id TEXT,snapshot TEXT NOT NULL)');
 db.prepare('INSERT INTO codex_native_sessions VALUES(?,?,?,?)').run('session',`desktop-user:${legacy}`,'old-thread',JSON.stringify({id:'session',title:'old',cwd:path,status:'idle',updatedAt:1,revision:1,messages:[],approvals:[],queued:0}));db.close();
 let claimed=false;const service=new CodexNativeService({dbPath:file,profileId:`desktop-user:${profile}`,migrateFromProfileId:`desktop-user:${legacy}`,initializeOwner:()=>{claimed=true;}});cleanup.push(()=>service.dispose());
 expect(claimed).toBe(true);expect(service.list({requestSource:'user',actorId:`desktop-user:${profile}`})).toHaveLength(1);
 const failed=new CodexNativeService({dbPath:join(path,'failed.sqlite'),profileId:`desktop-user:${profile}`,initializeOwner:()=>{throw new Error('owner live');}});cleanup.push(()=>failed.dispose());
 expect(()=>failed.list({requestSource:'user',actorId:`desktop-user:${profile}`})).toThrow('native_owner_unavailable');
 const broken=new CodexNativeService({dbPath:path,profileId:`desktop-user:${profile}`});cleanup.push(()=>broken.dispose());expect(()=>broken.list({requestSource:'user',actorId:`desktop-user:${profile}`})).toThrow('native_owner_unavailable');
});
it('preserves the actual main execution domain and denied authorization after moving data, and blocks all execution if its UUID is lost',async()=>{
 const path=root(),dataRoot=join(path,'old'),workspaceRoot=join(path,'workspace');mkdirSync(workspaceRoot);mkdirSync(join(dataRoot,'multi-agent'),{recursive:true});
 const oldProfile=createHash('sha256').update(dataRoot).digest('hex'),workspaceId=createHash('sha256').update(workspaceRoot).digest('hex');
 const old=new DesktopMultiAgentStore(join(dataRoot,'multi-agent/groups.sqlite'));
 old.registerThread({threadId:'thread',profileId:oldProfile,workspaceId,cwd:workspaceRoot});const previous=old.initializeWorkspaceAuthorization({profileId:oldProfile,workspaceId});
 old.compareAndSetWorkspaceAuthorization({profileId:oldProfile,workspaceId,expectedPermissionRevision:0,next:{...previous,permissionRevision:1,executionAllowed:false,actorId:`desktop-user:${oldProfile}`,lastReceiptJson:JSON.stringify({requestHash:'f'.repeat(64),receipt:{operationId:`exec-auth:${old.bootId}:0:${randomUUID()}`,state:'applied',permissionRevision:1,executionAllowed:false,persistenceState:'confirmed'}})}});old.close();
 const kswarmService={getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never;
 let main=createDesktopServices({ knowledgeDbPath: join(dataRoot, 'knowledge.test.sqlite'),dataRoot,workspaceRoot,kswarmService});cleanup.push(()=>main.disposeMultiAgent());await main.multiAgent!.ready;
 const id=main.multiAgent!.profileId;expect(id).toMatch(/^[a-f0-9-]{36}$/);expect(main.continuity.port().actor.profileId).toBe(id);expect(main.multiAgent!.service.getExecutionAuthorization().executionAllowed).toBe(false);await main.disposeMultiAgent();
 const moved=join(path,'new');cpSync(dataRoot,moved,{recursive:true});main=createDesktopServices({ knowledgeDbPath: join(moved, 'knowledge.test.sqlite'),dataRoot:moved,workspaceRoot,kswarmService});await main.multiAgent!.ready;expect(main.multiAgent!.profileId).toBe(id);expect(main.multiAgent!.service.getExecutionAuthorization().executionAllowed).toBe(false);await main.disposeMultiAgent();
 rmSync(join(moved,'continuity-profile.json'));main=createDesktopServices({ knowledgeDbPath: join(moved, 'knowledge.test.sqlite'),dataRoot:moved,workspaceRoot,kswarmService});await expect(main.multiAgent!.ready).rejects.toThrow('profile_identity_unavailable');await expect(main.createTask({prompt:'must not execute',materials:[],context:{threadId:'thread'}})).rejects.toThrow('profile_identity_unavailable');expect(()=>main.continuity.port()).toThrow('continuity_unavailable');
});
it('keeps the identity gate when an injected runner has no multi-agent owner',async()=>{
 const dataRoot=root();writeFileSync(join(dataRoot,'continuity-profile.json'),'{}');let calls=0;
 const main=createDesktopServices({ knowledgeDbPath: join(dataRoot, 'knowledge.test.sqlite'),dataRoot,runner:async()=>{calls++;},kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never});cleanup.push(()=>main.disposeMultiAgent());
 await expect(main.createTask({prompt:'work',materials:[]})).rejects.toThrow('profile_identity_unavailable');expect(calls).toBe(0);
});
it('blocks source deletion through real main and message/tombstone paths when an unprojected legacy native route could have consumed it',async()=>{
 const dataRoot=root(),kswarmService={getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never;
 let main=createDesktopServices({ knowledgeDbPath: join(dataRoot, 'knowledge.test.sqlite'),dataRoot,kswarmService});cleanup.push(()=>main.disposeMultiAgent());await main.multiAgent!.ready;
 const p=main.continuity.port(),conversation=p.service.createConversation(p.actor,{operationId:'source'});
 p.service.recordMessage(p.actor,{conversationId:conversation.id,sourceKind:'desktop_task',sourceId:'task_A',sourceDataEpoch:'A_epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'SOURCE_A',executionState:'settled'});
 const message=p.service.listMessages(p.actor,conversation.id)[0];
 main.multiAgent!.service.registerThread({threadId:conversation.id,profileId:main.multiAgent!.profileId,workspaceId:main.multiAgent!.workspaceId,cwd:main.multiAgent!.cwd});
 const profile=main.multiAgent!.profileId;await main.disposeMultiAgent();
 const native=new DatabaseSync(join(dataRoot,'codex-native.sqlite'));native.prepare('INSERT INTO codex_native_sessions VALUES(?,?,?,?)').run('legacy_session',`desktop-user:${profile}`,'legacy_thread',JSON.stringify({id:'legacy_session',title:'legacy',cwd:dataRoot,status:'disconnected',updatedAt:1,revision:1,messages:[{id:'m',role:'user',text:'earlier source A history was loaded outside continuity'}],approvals:[],queued:0}));native.close();
 const routes=new DatabaseSync(join(dataRoot,'codex-task-routes.sqlite'));routes.prepare('INSERT INTO routes VALUES (?,?)').run('task_native_B','other_conversation');routes.prepare('INSERT INTO threads VALUES (?,?)').run('other_conversation','legacy_session');routes.close();
 main=createDesktopServices({ knowledgeDbPath: join(dataRoot, 'knowledge.test.sqlite'),dataRoot,kswarmService});await main.multiAgent!.ready;const next=main.continuity.port();
 expect(()=>next.service.deleteMessage(next.actor,{conversationId:conversation.id,messageId:message.messageId})).toThrow('blocked_unsettled');
 expect(()=>next.service.tombstoneConversation(next.actor,conversation.id)).toThrow('blocked_unsettled');
 const m=main.multiAgent!,access=m.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${profile}`,profileId:profile,workspaceId:m.workspaceId,threadId:conversation.id}),snapshot=m.service.readThreadDeletion({access});
 const result=await m.service.deleteThread({access,requestSource:'user',confirmTerminate:true,expectedThreadRevision:snapshot.threadRevision,operationId:`delete:${snapshot.threadRevision}:closure`});
 expect(result.state).not.toBe('completed');expect(next.service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(conversation.id)?.deleted).toBe(0);
});
