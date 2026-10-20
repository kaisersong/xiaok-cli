// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createDesktopServices,runDesktopToolLoop} from '../../electron/desktop-services.js';
import {createRoomLocalCommandTool} from '../../electron/room-local-command.js';
import {ToolRegistry,buildToolList} from '../../../src/ai/tools/index.js';
const quote=(value:string)=>`'${value.replace(/'/g,`'\\''`)}'`;
it.skipIf(process.platform==='win32').each(['same-process-group','detached-session','room-detached-session'] as const)('never turns a finished ordinary tool Promise into physical closure of a live %s descendant',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-background-closure-')),pidFile=join(root,'background.pid'),gate=join(root,'release'),effect=join(root,'effect');let pid:number|undefined;
 writeFileSync(join(root,'child.mjs'),`import{writeFileSync,existsSync}from'node:fs';writeFileSync(process.argv[2],String(process.pid));const timer=setInterval(()=>{if(existsSync(process.argv[3])){writeFileSync(process.argv[4],'late effect');clearInterval(timer);}},10);`);
 writeFileSync(join(root,'launcher.mjs'),`import{spawn}from'node:child_process';const child=spawn(process.execPath,process.argv.slice(2),{detached:true,stdio:'ignore'});child.unref();`);
 const args=[process.execPath,...(mode!=='same-process-group'?[join(root,'launcher.mjs')]:[]),join(root,'child.mjs'),pidFile,gate,effect];
 const command=args.map(quote).join(' ')+(mode==='same-process-group'?' >/dev/null 2>&1 &':'');
 const tools=buildToolList();if(mode==='room-detached-session')tools.splice(tools.findIndex(t=>t.definition.name==='bash'),1,createRoomLocalCommandTool({cwd:root,onCleanupPending:()=>{}}));
 const registry=new ToolRegistry({autoMode:true,onPrompt:async()=>true},tools);let calls=0;
 const services=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never,
  runner:async input=>{
   const result=await runDesktopToolLoop({adapter:{async*stream(){if(++calls===1)yield{type:'tool_use' as const,id:'background-command',name:'bash',input:{command,workdir:root}};else yield{type:'text' as const,delta:'parent finished'};yield{type:'done' as const};}},
    requireEffectGuard:true,recordUnprovenEffect:(id,name)=>services.continuity.recordUnprovenEffect(input.taskId,id,name),
    registry,allToolDefs:registry.getToolDefinitions(),messages:[{role:'user',content:[{type:'text',text:'synthetic background fixture'}]}],systemPrompt:'',signal:input.signal,taskDeadline:Date.now()+15_000,sessionId:input.sessionId,turnId:input.taskId,taskId:input.taskId,intentId:'intent',stepId:'step',materials:[],emitRuntimeEvent:input.emitRuntimeEvent,skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),
    strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false},
   });await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'intent',stepId:'step',note:JSON.stringify({summary:result.reply,artifacts:[]})});
  }});
 try{
  const {service,actor}=services.continuity.port(),conversation=service.createConversation(actor,{operationId:'conversation'});const task=await services.createTask({prompt:'synthetic fixture',materials:[],context:{threadId:conversation.id}});
  await vi.waitFor(()=>expect(existsSync(pidFile)).toBe(true));pid=Number(readFileSync(pidFile,'utf8'));console.info('owned background PID',pid,mode);expect(()=>process.kill(pid!,0)).not.toThrow();
  await vi.waitFor(()=>expect(service.listMessages(actor,conversation.id).some(m=>m.text==='parent finished')).toBe(true));
  await vi.waitFor(()=>expect(['completed','failed','cancelled']).toContain(service.store.db.prepare('SELECT terminal_status FROM source_cursors WHERE source_id=?').get(task.taskId)?.terminal_status));
  await new Promise(resolve=>setTimeout(resolve,50));expect(()=>process.kill(pid!,0)).not.toThrow();
  expect(service.store.db.prepare('SELECT 1 FROM source_settlements WHERE task_id=?').get(task.taskId)).toBeUndefined();
  expect(()=>service.tombstoneConversation(actor,conversation.id)).toThrow('blocked_unsettled');expect(service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(conversation.id)?.deleted).toBe(0);
  writeFileSync(gate,'release');await vi.waitFor(()=>expect(existsSync(effect)).toBe(true));
 }finally{
  if(!pid&&existsSync(pidFile))pid=Number(readFileSync(pidFile,'utf8'));
  if(pid){try{process.kill(pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}await vi.waitFor(()=>expect(()=>process.kill(pid!,0)).toThrow(),{timeout:3000});}
  await services.disposeMultiAgent();registry.dispose();rmSync(root,{recursive:true,force:true,maxRetries:3});
 }
},15_000);
