import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
function setup(){const cwd=mkdtempSync(join(tmpdir(),'prepared-tool-'));cleanup.push(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
it('prepares with one approval and zero effects, then dispatches the same native tool once',async()=>{
 const cwd=setup();let prompts=0;const registry=new ToolRegistry({onPrompt:async()=>{prompts++;return true;}},[createWriteTool({cwd})]);cleanup.push(()=>registry.dispose());
 const input={file_path:join(cwd,'file'),content:'approved'};const prepared=await registry.prepareToolInvocation('write',input);
 expect(typeof prepared).not.toBe('string');if(typeof prepared==='string')throw Error(prepared);
 expect(prompts).toBe(1);expect(existsSync(input.file_path)).toBe(false);input.content='mutated';
 expect(prepared.input.content).toBe('approved');expect(Object.isFrozen(prepared.input)).toBe(true);
 await registry.executePreparedTool(prepared);expect(readFileSync(input.file_path,'utf8')).toBe('approved');expect(prompts).toBe(1);
 await expect(registry.executePreparedTool(prepared)).rejects.toThrow();
});
it('rejects prepared policy revocation, token forgery and tool replacement',async()=>{
 const cwd=setup();const permissionManager=new PermissionManager({mode:'auto'});const registry=new ToolRegistry({permissionManager},[createWriteTool({cwd})]);cleanup.push(()=>registry.dispose());
 const path=join(cwd,'file');const prepared=await registry.prepareToolInvocation('write',{file_path:path,content:'forbidden'});if(typeof prepared==='string')throw Error(prepared);
 await expect(registry.executePreparedTool({...prepared})).rejects.toThrow();permissionManager.setMode('plan');
 expect(await registry.executePreparedTool(prepared)).toMatch(/Error/);expect(existsSync(path)).toBe(false);
 permissionManager.setMode('auto');const next=await registry.prepareToolInvocation('write',{file_path:path,content:'forbidden'});if(typeof next==='string')throw Error(next);
 registry.registerTool(createWriteTool({cwd}));expect(await registry.executePreparedTool(next)).toMatch(/Error/);expect(existsSync(path)).toBe(false);
});
