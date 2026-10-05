import {vi,expect,it,afterEach} from 'vitest';
const state=vi.hoisted(()=>({failure:'' as ''|'file'|'directory',directoryInode:0,events:[] as string[]}));
vi.mock('node:fs',async()=>{const fs=await vi.importActual<typeof import('node:fs')>('node:fs');return{...fs,fsyncSync(fd:number){const kind=fs.fstatSync(fd).isDirectory()?'directory':'file';state.events.push(kind);if(state.failure===kind&&(!state.directoryInode||fs.fstatSync(fd).ino===state.directoryInode))throw Error('injected fsync failure');return fs.fsyncSync(fd);}};});
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {createWriteTool} from '../../../src/ai/tools/write.js';import {createEditTool} from '../../../src/ai/tools/edit.js';import {mcpTestContext} from '../../support/mcp-cancellation-context.js';
const clean:Array<()=>void>=[];afterEach(()=>{state.failure='';state.directoryInode=0;state.events=[];clean.splice(0).reverse().forEach(f=>f());});
it.each(['write','edit'] as const)('P2 %s confirms file and directory durability before reporting commit',async name=>{
 const root=mkdtempSync(join(tmpdir(),'p2-file-durable-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'file');writeFileSync(file,'before');const registry=new ToolRegistry({autoMode:true},[createWriteTool({cwd:root}),createEditTool({cwd:root})]);clean.push(()=>registry.dispose());
 let committed=false;const result=await registry.executeTool(name,name==='write'?{file_path:file,content:'after'}:{file_path:file,old_string:'before',new_string:'after'},{...mcpTestContext(),compoundPhase:{fileMutationCommitted(){expect(state.events[0]).toBe('file');expect(state.events).toContain('directory');committed=true;}}});
 expect(result).not.toContain('Error:');expect(committed).toBe(true);expect(readFileSync(file,'utf8')).toBe('after');
});
it('a real directory flush failure after rename cannot report a completed mutation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'p2-file-failure-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'file');writeFileSync(file,'before');const registry=new ToolRegistry({autoMode:true},[createWriteTool({cwd:root})]);clean.push(()=>registry.dispose());const committed=vi.fn();state.failure='directory';
 expect(await registry.executeTool('write',{file_path:file,content:'after'},{...mcpTestContext(),compoundPhase:{fileMutationCommitted:committed}})).toContain('fsync failure');expect(committed).not.toHaveBeenCalled();expect(readFileSync(file,'utf8')).toBe('after');
});

it('post-rename native fsync failure leaves a real durable unknown journal and cannot replay the edit',async()=>{
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const {createSessionExecutionAuthority,createSessionExecutionContext}=await import('../../../src/ai/runtime/session-store/execution-authority.js');
 const {createCompoundSessionJournal}=await import('../../../src/runtime/sol-pi/compound-session-journal.js');
 const {createCompoundExecutionCoordinator}=await import('../../../src/runtime/sol-pi/compound-execution-coordinator.js');
 const root=mkdtempSync(join(tmpdir(),'p2-file-journal-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'files');mkdirSync(directory);const file=join(directory,'file');writeFileSync(file,'before');
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),sessionId='durability';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root:storeRoot,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});clean.push(()=>authority.dispose());
 const write=createWriteTool({cwd:root}),journal=createCompoundSessionJournal({store,root:storeRoot,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 const coordinator=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent(){},getPermissionRevision:()=>0,readonlyTools:[],fileTools:[write]});
 const registry=new ToolRegistry({autoMode:true,compoundExecution:coordinator},[write]);clean.push(()=>registry.dispose());
 state.directoryInode=statSync(directory).ino;state.failure='directory';
 const context={...mcpTestContext(),session:(await store.load(sessionId))!,hostProviderInvocationId:'provider',toolInvocationId:'write'};
 expect(await registry.executeTool('write',{file_path:file,content:'after'},context)).toContain('fsync failure');
 expect(readFileSync(file,'utf8')).toBe('after');expect((await store.load(sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'outcome_unknown',outcome:'unknown',fileFacts:{path:file,adapter:'synchronous-native-file-v1'}});
 state.failure='';expect(await registry.executeTool('write',{file_path:file,content:'overwrite'},{...context,toolInvocationId:'new'})).toContain('unknown');expect(readFileSync(file,'utf8')).toBe('after');
});
