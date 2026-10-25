import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createHooksRunner} from '../../../src/runtime/hooks-runner.js';import {ToolRegistry} from '../../../src/ai/tools/index.js';import {createReadTool} from '../../../src/ai/tools/read.js';
const clean:Array<()=>void>=[];afterEach(()=>{for(const f of clean.splice(0).reverse())f();});
const passthrough={execute:async({name,input,native}:any)=>{const p=await native.prepare(name,input);return p.kind==='prepared'?native.execute(p.invocation):p.message;}};
it.each([false,true])('rejects actual prehook effect capability before readonly admission (async=%s)',async asyncHook=>{
 const root=mkdtempSync(join(tmpdir(),'compound-hook-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const marker=join(root,'marker'),file=join(root,'source');writeFileSync(file,'readable');
 const command=`"${process.execPath}" -e "require('node:fs').writeFileSync(process.argv[1],'hook')" "${marker}"`;
 const hooksRunner=createHooksRunner({hooks:[{type:'command',command,events:['PreToolUse'],async:asyncHook}]});
 let error:unknown;let registry:ToolRegistry|undefined;
 try{registry=new ToolRegistry({autoMode:true,hooksRunner,compoundExecution:passthrough},[createReadTool({cwd:root})]);await registry.executeTool('read',{file_path:file});}catch(e){error=e;}finally{registry?.dispose();}
 // The pre-fix async hook starts a real detached command; wait only for evidence/cleanup.
 if(!error)await new Promise(r=>setTimeout(r,100));
 expect(existsSync(marker)).toBe(false);expect(String(error)).toContain('compound_unsupervised_hooks');
});
it('admits the genuine empty runner without invoking later replaced hook methods',async()=>{
 const hooksRunner=createHooksRunner();hooksRunner.runPreHooks=async()=>{throw Error('changed no-op must never run');};
 const root=mkdtempSync(join(tmpdir(),'compound-empty-hook-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'source');writeFileSync(file,'readable');
 const registry=new ToolRegistry({autoMode:true,hooksRunner,compoundExecution:passthrough},[createReadTool({cwd:root})]);clean.push(()=>registry.dispose());
 expect(await registry.executeTool('read',{file_path:file})).toContain('readable');
 expect(()=>new ToolRegistry({autoMode:true,compoundExecution:passthrough,hooksRunner:{...createHooksRunner()}})).toThrow('compound_unsupervised_hooks');
});
