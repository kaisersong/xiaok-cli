import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
import {createCompoundExecutionCoordinator} from '../../../src/runtime/sol-pi/compound-execution-coordinator.js';
import {bindManagedCompoundQueryTool,getManagedCompoundQueryAdapter,bindManagedCompoundCancellationTool} from '../../../src/runtime/sol-pi/compound-managed-control.js';
import type {Tool} from '../../../src/types.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{cleanup.splice(0).reverse().forEach(f=>f());});
it('keeps an actual waiting query outside the effect lease and retains the original unknown ledger',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-query-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='query-session';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test',scopeId:'query'})});cleanup.push(()=>authority.dispose());
 const journal=createCompoundSessionJournal({root,store,sessionIdentity:sessionId,ownerId:'test',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 const old=await authority.acquire({invocationId:'old',kind:'recovery'});try{const entry=await journal.createOrGetDirect({hostProviderInvocationId:'old',originalToolUseId:'old',toolName:'bash',inputHash:'a'.repeat(64),permissionGeneration:0},old);await journal.advanceDirect(entry.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},old);}finally{await old.releaseAfterDrain();}
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve),checks=vi.fn();
 const tool:Tool={definition:{name:'actual_query',description:'fixture notification query',inputSchema:{type:'object',properties:{}}},permission:'safe',async execute(){entered();await new Promise<void>(resolve=>release=resolve);return 'existing status';}};
 bindManagedCompoundQueryTool(tool,{assertCurrent:checks});
 const adapter=getManagedCompoundQueryAdapter(tool)!;
 const coordinator=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent(){},getPermissionRevision:()=>0,readonlyTools:[],fileTools:[],captureGlobalSupervision(){throw Error('compound_tree_actual_unknown');},observationQueries:[{tool,assertCurrent:()=>{expect(getManagedCompoundQueryAdapter(tool)).toBe(adapter);adapter.assertCurrent();}}]});
 const registry=new ToolRegistry({autoMode:true,compoundExecution:coordinator},[tool]);cleanup.push(()=>registry.dispose());
 const context={taskId:'task',session:(await store.load(sessionId))!,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'query'};
 const pending=registry.executeTool('actual_query',{},context);await waiting;
 const competing=await authority.acquire({invocationId:'child',kind:'direct-mutation'});await competing.releaseAfterDrain();release();expect(await pending).toBe('existing status');expect(checks.mock.calls.length).toBeGreaterThanOrEqual(2);
 expect((await store.load(sessionId))!.compoundOperations!.directOperations).toHaveLength(1);expect((await store.load(sessionId))!.compoundOperations!.directOperations![0].stage).toBe('started');
 const forged=vi.fn(async()=> 'forged');registry.registerTool({...tool,execute:forged});await expect(registry.executeTool('actual_query',{}, {...context,toolInvocationId:'forged'})).rejects.toThrow('compound_tree_actual_unknown');expect(forged).not.toHaveBeenCalled();await coordinator.dispose();
},5000);
it('does not transfer query classification to copies or changed handlers',()=>{
 const tool:Tool={definition:{name:'list_agents',description:'actual private wrapper fixture',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=> 'status'};
 bindManagedCompoundQueryTool(tool,{assertCurrent(){}});expect(getManagedCompoundQueryAdapter({...tool})).toBeUndefined();tool.execute=async()=> 'changed';expect(getManagedCompoundQueryAdapter(tool)).toBeUndefined();
});
it('rejects asynchronous host currentness instead of granting a free preparation gap',()=>{
 const tool:Tool={definition:{name:'query',description:'test',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=> 'status'};
 bindManagedCompoundQueryTool(tool,{assertCurrent:async()=>{throw Error('late rejection');}});
 expect(()=>getManagedCompoundQueryAdapter(tool)!.assertCurrent()).toThrow('compound_managed_query_async');
});
it('requests exact existing-target cancellation before waiting for an ancestor effect lease',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-cancel-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='cancel-session';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test',scopeId:'cancel'})});cleanup.push(()=>authority.dispose());
 const journal=createCompoundSessionJournal({root,store,sessionIdentity:sessionId,ownerId:'test',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 const ticket=Object.freeze({}),calls=vi.fn();let scoped=false;
 const tool:Tool={definition:{name:'close_agent',description:'fixture exact cancellation',inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}},permission:'safe',async execute(input){expect(scoped).toBe(true);expect(input).toEqual({target:'old-child'});calls();return 'cancellation requested, not proof of drain';}};
 bindManagedCompoundCancellationTool(tool,{assertCurrent(){},prepareCancellation(input){expect(input.finalInput).toEqual({target:'old-child'});expect(input.nativeInvocationId).toMatch(/^cancel:[a-f0-9]{64}$/);return ticket;},async runCancellation(actual,work){expect(actual).toBe(ticket);scoped=true;try{return await work();}finally{scoped=false;}}});
 const coordinator=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent(){},getPermissionRevision:()=>0,readonlyTools:[],fileTools:[],cancellationTools:[tool]});
 const registry=new ToolRegistry({autoMode:true,compoundExecution:coordinator},[tool]);cleanup.push(()=>registry.dispose());
 const held=await authority.acquire({invocationId:'child-awaiting-cancel',kind:'direct-mutation'});
 const pending=registry.executeTool('close_agent',{target:'old-child'},{taskId:'task',session:(await store.load(sessionId))!,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'cancel'});
 await new Promise(resolve=>setTimeout(resolve,30));const beforeRelease=calls.mock.calls.length;await held.releaseAfterDrain();expect(await pending).toContain('cancellation requested');expect(beforeRelease).toBe(1);await coordinator.dispose();
});
