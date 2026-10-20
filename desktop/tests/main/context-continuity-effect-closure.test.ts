// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {TaskContinuitySource} from '../../electron/context-continuity/task-source.js';
import {createBashTool} from '../../../src/ai/tools/bash.js';
import {createRoomLocalCommandTool} from '../../electron/room-local-command.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {continuityEffects} from '../fixtures/continuity-effects.js';
it('required host tools cannot execute through a retained object without their main effect guard',async()=>{
 const effect=vi.fn(async()=> 'done'),registry=new ToolRegistry({autoMode:true,requireEffectGuard:true} as never,[{definition:{name:'effect',description:'fixture',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:effect}]);
 try{await expect(registry.getRegisteredTool('effect')!.execute({})).rejects.toThrow('context_effect_guard_unavailable');expect(effect).not.toHaveBeenCalled();}finally{registry.dispose();}
});
it('host-required guard refuses hook runners before a deny hook can launch effects',()=>{
 const hook=vi.fn();expect(()=>new ToolRegistry({autoMode:true,requireEffectGuard:true,hooksRunner:{runHooks:hook}} as never,[])).toThrow('context_effect_hook_unavailable');expect(hook).not.toHaveBeenCalled();
});
it.each(['approve','replace','unregister'] as const)('preserves original approval identity and the durable pre-effect guard across %s',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'context-guard-approval-')),effects=continuityEffects(root);let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),pending=new Promise<void>(resolve=>entered=resolve),execute=vi.fn(async()=>{expect(effects.count('task_approval')).toBeGreaterThan(0);return 'effect';});
 const tool={definition:{name:'write',description:'fixture',inputSchema:{type:'object',properties:{}}},permission:'write' as const,execute};
 const replacement=vi.fn(async()=> 'replacement'),registry=new ToolRegistry({requireEffectGuard:true,permissionManager:new PermissionManager({mode:'default'}),onPrompt:async(_name,_input,invocation)=>{expect(invocation!.tool).toBe(tool);entered();await gate;return true;}},[tool]);
 try{const result=registry.executeTool('write',{},effects.context('task_approval'));await pending;
  if(mode==='replace')registry.registerTool({...tool,execute:replacement});if(mode==='unregister')registry.unregisterTool('write',tool);release();
  if(mode==='approve'){expect(await result).toBe('effect');expect(execute).toHaveBeenCalledOnce();}
  else{expect(await result).toMatch(/no longer registered/);expect(execute).not.toHaveBeenCalled();expect(effects.count()).toBe(0);}
  expect(replacement).not.toHaveBeenCalled();
 }finally{release();registry.dispose();effects.close();rmSync(root,{recursive:true,force:true});}
});
it('an unproven effect atomically retracts old settlement, survives restart and blocks unrelated profile deletion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'context-effect-')),options={dbPath:join(root,'continuity.sqlite'),profileId:'profile'};let service=new ContinuityService(options);const actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 try{
  const c=service.createConversation(actor,{operationId:'c'}),unrelated=service.createConversation(actor,{operationId:'other'}),source=new TaskContinuitySource(service,actor);const snapshot={taskId:'task_effect',sessionId:'session',prompt:'fixture',status:'completed',context:{threadId:c.id},events:[]} as unknown as TaskSnapshot;
  await source.bindPrepared({conversationId:c.id,taskId:snapshot.taskId,publicPrompt:snapshot.prompt},async()=>snapshot);source.capture(snapshot,{physicallySettled:true});expect(service.listMessages(actor,c.id)[0].executionState).toBe('settled');
  service.recordUnprovenEffect(actor,snapshot.taskId,'invocation','bash');source.capture(snapshot,{physicallySettled:true});expect(service.store.db.prepare('SELECT 1 FROM source_settlements').get()).toBeUndefined();expect(service.listMessages(actor,c.id)[0].executionState).toBe('unknown');expect(()=>service.tombstoneConversation(actor,unrelated.id)).toThrow('blocked_unsettled');
  service.close();service=new ContinuityService(options);expect(()=>service.tombstoneConversation(actor,c.id)).toThrow('blocked_unsettled');
 }finally{service.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it.each(['bash','room'] as const)('failed durable marker prevents the actual %s spawn',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'effect-write-fail-')),marker=join(root,'effect');const tool=kind==='bash'?createBashTool():createRoomLocalCommandTool({cwd:root,onCleanupPending:()=>{}});
 try{await expect(tool.execute({command:`echo forbidden > '${marker}'`,workdir:root},{recordUnprovenEffect:()=>{throw new Error('storage_unavailable');}} as never)).rejects.toThrow('storage_unavailable');expect(existsSync(marker)).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('a missing guard prevents the direct Room spawn',async()=>{
 const root=mkdtempSync(join(tmpdir(),'room-effect-missing-')),marker=join(root,'effect');try{await expect(createRoomLocalCommandTool({cwd:root,onCleanupPending:()=>{}}).execute({command:`echo forbidden > '${marker}'`})).rejects.toThrow('context_effect_guard_unavailable');expect(existsSync(marker)).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('pre-policy receipts are invalidated before any restored reference can treat them as closed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-legacy-')),opts={dbPath:join(root,'continuity.sqlite'),profileId:'profile'};let service=new ContinuityService(opts);const actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 try{const c=service.createConversation(actor,{operationId:'c'}),source=new TaskContinuitySource(service,actor),snapshot={taskId:'task_old',sessionId:'epoch',prompt:'old',status:'completed',context:{threadId:c.id},events:[]} as unknown as TaskSnapshot;await source.bindPrepared({conversationId:c.id,taskId:snapshot.taskId,publicPrompt:snapshot.prompt},async()=>snapshot);source.capture(snapshot,{physicallySettled:true});service.store.db.prepare('DELETE FROM continuity_meta WHERE key=?').run('effectClosurePolicy');service.close();service=new ContinuityService(opts);expect(service.store.db.prepare('SELECT 1 FROM source_settlements').get()).toBeUndefined();expect(service.listMessages(actor,c.id)[0].executionState).toBe('unknown');expect(()=>service.tombstoneConversation(actor,c.id)).toThrow('blocked_unsettled');}finally{service.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
