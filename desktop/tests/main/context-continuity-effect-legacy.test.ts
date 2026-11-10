// @vitest-environment node
import {expect,it,vi} from 'vitest';import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createDesktopServices,runDesktopToolLoop} from '../../electron/desktop-services.js';
import {createRoomLocalCommandTool} from '../../electron/room-local-command.js';
import {createBashTool} from '../../../src/ai/tools/bash.js';import {ToolRegistry,buildToolList} from '../../../src/ai/tools/index.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';import type {TaskSnapshot} from '../../shared/task-types.js';
const kswarmService={getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never;
const quote=(s:string)=>`'${s.replace(/'/g,`'\\''`)}'`;
function files(root:string){const pid=join(root,'background.pid');writeFileSync(join(root,'child.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);`);writeFileSync(join(root,'launcher.mjs'),`import{spawn}from'node:child_process';const child=spawn(process.execPath,process.argv.slice(2),{detached:true,stdio:'ignore'});child.unref();`);return {pid,command:[process.execPath,join(root,'launcher.mjs'),join(root,'child.mjs'),pid].map(quote).join(' ')};}
async function cleanupPid(file:string){if(!existsSync(file))return;const pid=Number(readFileSync(file,'utf8'));console.info('owned legacy fixture PID',pid);try{process.kill(pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}await vi.waitFor(()=>expect(()=>process.kill(pid,0)).toThrow(),{timeout:3000});}
it.skipIf(process.platform==='win32').each(['snapshot-without-receipt','room-without-snapshot'] as const)('reconciles %s before real MA deletion can declare closure',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'legacy-effect-inventory-'));let main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService});const background=files(root);
 try{
  await main.multiAgent!.ready;const {service,actor}=main.continuity.port(),c=service.createConversation(actor,{operationId:'target'});main.multiAgent!.service.registerThread({threadId:c.id,profileId:main.multiAgent!.profileId,workspaceId:main.multiAgent!.workspaceId,cwd:main.multiAgent!.cwd});const profile=main.multiAgent!.profileId;
  // Simulate a pre-policy installation: no inventory certification or receipt exists.
  service.store.db.prepare('DELETE FROM continuity_meta WHERE key=?').run('effectInventoryPolicy');await main.disposeMultiAgent();
  const tool=kind==='room-without-snapshot'?createRoomLocalCommandTool({cwd:root,onCleanupPending:()=>{}}):createBashTool();await tool.execute({command:background.command,workdir:root},{recordUnprovenEffect:()=>{}} as never);await vi.waitFor(()=>expect(existsSync(background.pid)).toBe(true));
  if(kind==='snapshot-without-receipt')await new FileTaskSnapshotStore(join(root,'tasks')).save({taskId:'task_legacy_background',sessionId:'legacy',prompt:'fixture',status:'completed',context:{threadId:'legacy-thread'},events:[],materials:[],createdAt:1,updatedAt:2} as unknown as TaskSnapshot);
  else expect(existsSync(join(root,'tasks','snapshots'))).toBe(false);
  main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService});await main.multiAgent!.ready;const m=main.multiAgent!,access=m.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${profile}`,profileId:profile,workspaceId:m.workspaceId,threadId:c.id}),deletion=m.service.readThreadDeletion({access});const result=await m.service.deleteThread({access,requestSource:'user',confirmTerminate:true,expectedThreadRevision:deletion.threadRevision,operationId:`delete:${deletion.threadRevision}:legacy-effect`});
  expect(result.state).not.toBe('completed');const p=main.continuity.port();expect(p.service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(c.id)?.deleted).toBe(0);
 }finally{await cleanupPid(background.pid);await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
},15000);
it.skipIf(process.platform==='win32')('blocks unknown source closure before noncanonical history fallback reaches the next provider',async()=>{
 const root=mkdtempSync(join(tmpdir(),'legacy-effect-history-')),background=files(root),registry=new ToolRegistry({autoMode:true,onPrompt:async()=>true},buildToolList());let calls=0,finished=false;
 const main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner:async input=>{
  await runDesktopToolLoop({adapter:{async*stream(){if(++calls===1)yield{type:'tool_use' as const,id:'legacy-background',name:'bash',input:{command:background.command,workdir:root}};else yield{type:'text' as const,delta:'done'};yield{type:'done' as const};}},registry,allToolDefs:registry.getToolDefinitions(),requireEffectGuard:true,recordUnprovenEffect:(id,name)=>main.continuity.recordUnprovenEffect(input.taskId,id,name),messages:[{role:'user',content:[{type:'text',text:input.prompt}]}],systemPrompt:'',signal:input.signal,taskDeadline:Date.now()+15000,sessionId:input.sessionId,turnId:input.taskId,taskId:input.taskId,intentId:'i',stepId:'s',materials:[],emitRuntimeEvent:input.emitRuntimeEvent,skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});finished=true;
 }});
 try{const a=await main.createTask({prompt:'first',materials:[],context:{threadId:'unadopted-thread'}});await vi.waitFor(()=>expect(finished).toBe(true));await vi.waitFor(()=>expect(existsSync(background.pid)).toBe(true));const before=calls;await expect(main.createTask({prompt:'must not start',materials:[],context:{threadId:'unadopted-thread',taskIds:[a.taskId]}})).rejects.toThrow('blocked_unsettled');expect(calls).toBe(before);}finally{await cleanupPid(background.pid);await main.disposeMultiAgent();registry.dispose();rmSync(root,{recursive:true,force:true,maxRetries:3});}
},15000);

it.skipIf(process.platform==='win32')('a legacy claim after completed inventory cannot turn an unknown live background owner into completed deletion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'late-legacy-claim-')),main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService}),background=files(root);
 try{
  await main.multiAgent!.ready;const m=main.multiAgent!,p=main.continuity.port(),threadId='legacy-after-inventory';
  // A newly discovered legacy source was never admitted by this guarded boot.
  await createBashTool().execute({command:background.command,workdir:root});await vi.waitFor(()=>expect(existsSync(background.pid)).toBe(true));
  const snapshot={taskId:'task_late_legacy',sessionId:'legacy-epoch',prompt:'late legacy evidence',status:'completed',context:{threadId},events:[],materials:[],createdAt:1,updatedAt:2} as unknown as TaskSnapshot;await new FileTaskSnapshotStore(join(root,'tasks')).save(snapshot);
  const preview=await p.importer!.preview({operationId:'late-preview',legacyThreadId:threadId,taskIds:[snapshot.taskId]});await p.importer!.claim({operationId:'late-claim',previewId:preview.previewId,expectedManifestHash:preview.manifestHash});expect(()=>process.kill(Number(readFileSync(background.pid,'utf8')),0)).not.toThrow();
  m.service.registerThread({threadId,profileId:m.profileId,workspaceId:m.workspaceId,cwd:m.cwd});const access=m.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${m.profileId}`,profileId:m.profileId,workspaceId:m.workspaceId,threadId}),before=m.service.readThreadDeletion({access});const result=await m.service.deleteThread({access,requestSource:'user',confirmTerminate:true,expectedThreadRevision:before.threadRevision,operationId:`delete:${before.threadRevision}:late-claim`});
  expect(result.state).not.toBe('completed');expect(p.service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(threadId)?.deleted).toBe(0);
 }finally{await cleanupPid(background.pid);await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
},15000);
