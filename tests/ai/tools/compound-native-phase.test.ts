import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
function setup(){const cwd=mkdtempSync(join(tmpdir(),'compound-native-'));cleanup.push(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
it('awaits the native edit barrier before creating directories and rechecks revocation afterward',async()=>{
 const cwd=setup(),file=join(cwd,'new','file');const permissions=new PermissionManager({mode:'auto'});const registry=new ToolRegistry({permissionManager:permissions},[createWriteTool({cwd})]);cleanup.push(()=>registry.dispose());
 let before=false;const result=await registry.executeTool('write',{file_path:file,content:'forbidden'},{...mcpTestContext(new AbortController().signal),compoundPhase:{beforeFileMutation:async()=>{before=true;expect(existsSync(join(cwd,'new'))).toBe(false);permissions.setMode('plan');}}});
 expect(before).toBe(true);expect(result).toMatch(/Error/);expect(existsSync(file)).toBe(false);
});
it('reports file commit before a failing observer and reports real nonzero command terminal facts',async()=>{
 const cwd=setup(),file=join(cwd,'file');const phases:string[]=[];const registry=new ToolRegistry({autoMode:true,onToolObserved:async()=>{throw Error('observer failed');}},[createWriteTool({cwd}),bashTool]);cleanup.push(()=>registry.dispose());
 await registry.executeTool('write',{file_path:file,content:'kept'},{...mcpTestContext(new AbortController().signal),compoundPhase:{beforeFileMutation:async()=>{phases.push('started');},fileMutationCommitted:async()=>{expect(readFileSync(file,'utf8')).toBe('kept');phases.push('committed');}}});
 expect(phases).toEqual(['started','committed']);
 let terminal:any;const denied=await registry.executeTool('bash',{command:'exit 2',workdir:cwd},{...mcpTestContext(new AbortController().signal),compoundPhase:{commandFinished:async fact=>{terminal=fact;}}});
 expect(denied).toContain('compound_isolated_execution_required');expect(terminal).toBeUndefined();
});
it('a rejected durable command-start barrier must never spawn',async()=>{
 const cwd=setup(),marker=join(cwd,'marker');const registry=new ToolRegistry({autoMode:true},[bashTool]);cleanup.push(()=>registry.dispose());
 await registry.executeTool('bash',{command:'printf forbidden > marker',workdir:cwd},{...mcpTestContext(new AbortController().signal),compoundPhase:{beforeCommandStart:async()=>{throw Error('durable start failed');}}});
 expect(existsSync(marker)).toBe(false);
});
it.each(['write','edit'] as const)('%s refuses a file changed while the real durable phase callback was awaited',async name=>{
 const {writeFileSync,readFileSync}=await import('node:fs');const cwd=mkdtempSync(join(tmpdir(),'compound-file-race-'));cleanup.push(()=>rmSync(cwd,{recursive:true,force:true}));const path=join(cwd,'file');writeFileSync(path,'before');
 const {createEditTool}=await import('../../../src/ai/tools/edit.js');
 const registry=new ToolRegistry({autoMode:true},[createWriteTool({cwd}),createEditTool({cwd})]);cleanup.push(()=>registry.dispose());
 const result=await registry.executeTool(name,name==='write'?{file_path:path,content:'approved'}:{file_path:path,old_string:'before',new_string:'approved'},{compoundPhase:{beforeFileMutation:async()=>{await Promise.resolve();writeFileSync(path,'concurrent change');}}} as any);
 expect(result).toMatch(/Error/);expect(readFileSync(path,'utf8')).toBe('concurrent change');
});

it.each(['write','edit'] as const)('%s rechecks the host effect guard after its durable await and before any filesystem mutation',async name=>{
 const {writeFileSync}=await import('node:fs');const {createEditTool}=await import('../../../src/ai/tools/edit.js');
 const cwd=setup(),file=join(cwd,'file');writeFileSync(file,'before');let current=true,checked=false;
 const registry=new ToolRegistry({autoMode:true},[createWriteTool({cwd}),createEditTool({cwd})]);cleanup.push(()=>registry.dispose());
 const result=await registry.executeTool(name,name==='write'?{file_path:file,content:'after'}:{file_path:file,old_string:'before',new_string:'after'},{...mcpTestContext(new AbortController().signal),compoundPhase:{beforeFileMutation:async()=>{await Promise.resolve();current=false;},assertBeforeFileMutation(){checked=true;if(!current)throw Error('other branch became unknown');}}});
 expect(checked).toBe(true);expect(result).toContain('other branch became unknown');expect(readFileSync(file,'utf8')).toBe('before');
});
it('does not treat a promise-returning final guard as synchronous authorization',async()=>{
 const cwd=setup(),file=join(cwd,'file');const registry=new ToolRegistry({autoMode:true},[createWriteTool({cwd})]);cleanup.push(()=>registry.dispose());
 const result=await registry.executeTool('write',{file_path:file,content:'forbidden'},{...mcpTestContext(new AbortController().signal),compoundPhase:{assertBeforeFileMutation:async()=>{throw Error('late rejection');}}});
 expect(result).toContain('compound_file_effect_guard_must_be_synchronous');expect(existsSync(file)).toBe(false);
});
