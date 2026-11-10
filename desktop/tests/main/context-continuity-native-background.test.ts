// @vitest-environment node
import {expect,it,vi} from 'vitest';import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CodexTaskBridge} from '../../electron/codex-task-bridge.js';import {SessionProbe} from '../../electron/codex-native-transport.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';import {TaskContinuitySource} from '../../electron/context-continuity/task-source.js';import {assembleOwnedHistory} from '../../electron/context-continuity/history.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';import type {TaskSnapshot} from '../../shared/task-types.js';
it.skipIf(process.platform==='win32')('keeps native context unknown and source fences active when a real independent background process outlives the parent turn',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-background-closure-')),pidFile=join(root,'background.pid'),releaseFile=join(root,'release'),effectFile=join(root,'effect');
 const service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'},projection=new TaskContinuitySource(service,actor);
 const conversation=service.createConversation(actor,{operationId:'conversation'}),source={taskId:'task_source',sessionId:'source_epoch',prompt:'source constraint',status:'completed',context:{threadId:conversation.id},events:[],materials:[],createdAt:1,updatedAt:2} as TaskSnapshot;
 await projection.bindPrepared({conversationId:conversation.id,taskId:source.taskId,publicPrompt:source.prompt},async()=>source);projection.capture(source,{physicallySettled:true});
 writeFileSync(join(root,'background.mjs'),`import{existsSync,writeFileSync}from'node:fs';const timer=setInterval(()=>{if(existsSync(process.argv[2])){writeFileSync(process.argv[3],'background effect');clearInterval(timer);}},10);`);
 writeFileSync(join(root,'protocol.mjs'),`import{createInterface}from'node:readline';import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';import{join}from'node:path';const root=process.argv[2];const emit=m=>process.stdout.write(JSON.stringify(m)+'\\n');for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;let result={};if(m.method==='config/read')result={config:{features:{apps:false,multi_agent:false,goals:false,hooks:false,memories:false,remote_plugin:false}}};if(m.method==='plugin/list')result={marketplaces:[],marketplaceLoadErrors:[]};if(m.method==='mcpServerStatus/list')result={data:[],nextCursor:null};if(m.method==='thread/start')result={thread:{id:'native-thread'}};if(m.method==='turn/start'){const child=spawn(process.execPath,[join(root,'background.mjs'),join(root,'release'),join(root,'effect')],{detached:true,stdio:'ignore'});child.unref();writeFileSync(join(root,'background.pid'),String(child.pid));emit({method:'turn/started',params:{threadId:'native-thread',turn:{id:'turn',status:'inProgress'}}});emit({method:'item/started',params:{threadId:'native-thread',turnId:'turn',item:{id:'command',type:'commandExecution',command:'controlled fixture background',status:'inProgress',processId:String(child.pid)}}});emit({method:'item/agentMessage/delta',params:{threadId:'native-thread',turnId:'turn',itemId:'answer',delta:'parent done'}});emit({method:'turn/completed',params:{threadId:'native-thread',turn:{id:'turn',status:'completed'}}});result={turn:{id:'turn'}};}emit({id:m.id,result});}`);
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));let backgroundPid:number|undefined;const receipts:unknown[]=[];
 const bridge=new CodexTaskBridge({dataRoot:root,profileId:actor.actorId,cwd:root,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace')}),snapshotStore:snapshots,
   createClient:options=>new SessionProbe({...options,executable:process.execPath,prefixArgs:[join(root,'protocol.mjs'),root]}),
   resolveOwnedHistory:(taskId,context)=>assembleOwnedHistory(service,actor,taskId,context),
   onTaskPrepared:async(input,taskId)=>projection.bindPrepared({conversationId:conversation.id,taskId,publicPrompt:input.prompt,sourceKind:'native_codex'},id=>snapshots.recoverTask(id)),
   acquireNativeContext:(taskId)=>service.acquireNativeContext(actor,taskId,[source.taskId]),
   onPersistedEvent:input=>{projection.capture(input.snapshot);},onExecutionSettled:(snapshot,receipt)=>{receipts.push(receipt);projection.capture(snapshot,receipt);}});
 try{
   const task=await bridge.create({prompt:'next work',materials:[],context:{threadId:conversation.id}},actor);await bridge.host.drain();
   backgroundPid=Number(readFileSync(pidFile,'utf8'));expect(Number.isSafeInteger(backgroundPid)&&backgroundPid>0).toBe(true);expect(()=>process.kill(backgroundPid!,0)).not.toThrow();
   expect(receipts).toEqual([expect.objectContaining({physicallySettled:false})]);expect(service.store.db.prepare('SELECT * FROM source_settlements WHERE task_id=?').get(task.taskId)).toBeUndefined();
   expect(service.listMessages(actor,conversation.id).filter(m=>m.sourceId===task.taskId).every(m=>m.executionState==='unknown')).toBe(true);
   expect(service.store.db.prepare('SELECT active FROM native_context_fences WHERE native_task_id=?').all(task.taskId).every(r=>r.active===1)).toBe(true);
   expect(()=>service.tombstoneConversation(actor,conversation.id)).toThrow('blocked_unsettled');writeFileSync(releaseFile,'release');await vi.waitFor(()=>expect(existsSync(effectFile)).toBe(true));
   expect(()=>service.tombstoneConversation(actor,conversation.id)).toThrow('blocked_unsettled');
 }finally{
   if(!backgroundPid&&existsSync(pidFile))backgroundPid=Number(readFileSync(pidFile,'utf8'));
   if(backgroundPid){try{process.kill(backgroundPid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}await vi.waitFor(()=>expect(()=>process.kill(backgroundPid!,0)).toThrow(),{timeout:3000});}
   await bridge.dispose();service.close();rmSync(root,{recursive:true,force:true});
 }
},10000);
