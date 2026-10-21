import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {createWriteTool} from '../../../src/ai/tools/write.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
it.each(['denied','cancelled','invalid','blocked'] as const)('returns native preparation reason %s without parsing text or producing a file',async reason=>{
 const root=mkdtempSync(join(tmpdir(),'prepare-details-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'file');
 const registry=new ToolRegistry({permissionManager:new PermissionManager({mode:reason==='denied'?'plan':reason==='cancelled'?'default':'auto'}),onPrompt:async()=>false,...(reason==='blocked'?{hooksRunner:{runHooks:async()=>({ok:true}),runPreHooks:async()=>({ok:false,message:'ordinary message without Error keywords'})} as any}:{})},[createWriteTool({cwd:root})]);cleanup.push(()=>registry.dispose());
 const result=await registry.prepareToolInvocationDetailed('write',reason==='invalid'?{file_path:file}:{file_path:file,content:'must not execute'});expect(result.kind).toBe('not_started');if(result.kind==='not_started')expect(result.reason).toBe(reason);expect(existsSync(file)).toBe(false);
});
