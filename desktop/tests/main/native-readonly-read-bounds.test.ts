// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildScopedNativeReadonlyTools} from '../../../src/ai/tools/scoped-native-readonly.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function root(){const value=mkdtempSync(join(tmpdir(),'scoped-read-bounds-'));roots.push(value);return value;}
it('the real readonly registry rejects excessive physical text before output paging',async()=>{
 const cwd=root(),file=join(cwd,'large.txt');writeFileSync(file,'X'.repeat(4*1024*1024+1));
 const registry=new ToolRegistry({nativeReadonlyOnly:true,requireSandboxScope:true},buildScopedNativeReadonlyTools({cwd,readOnlyPaths:[cwd]}));
 try{expect(await registry.executeTool('read',{file_path:file,max_chars:20,limit:1})).toMatch(/read_scan_limit/);writeFileSync(file,'APPROVED_TEXT');expect(await registry.executeTool('read',{file_path:file})).toContain('APPROVED_TEXT');}
 finally{registry.dispose();}
});
it.skipIf(process.platform==='win32')('a FIFO cannot hang the actual readonly read; the isolated native child is always reaped',async()=>{
 const cwd=root(),fifo=join(cwd,'pipe');expect(spawnSync('mkfifo',[fifo]).status).toBe(0);
 const project=fileURLToPath(new URL('../../../',import.meta.url));
 const script=String.raw`import {ToolRegistry} from './src/ai/tools/index.ts';import {buildScopedNativeReadonlyTools} from './src/ai/tools/scoped-native-readonly.ts';
 const registry=new ToolRegistry({nativeReadonlyOnly:true,requireSandboxScope:true},buildScopedNativeReadonlyTools({cwd:${JSON.stringify(cwd)},readOnlyPaths:[${JSON.stringify(cwd)}]}));
 process.stdout.write('READY\n');const result=await registry.executeTool('read',{file_path:${JSON.stringify(fifo)}});registry.dispose();process.stdout.write(JSON.stringify({result})+'\n');`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:project,stdio:['ignore','pipe','pipe']});let out='',err='',expired=false,timer:ReturnType<typeof setTimeout>|undefined;
 const closed=new Promise<void>(resolve=>child.once('exit',(code,signal)=>{console.log(JSON.stringify({test:'scoped-fifo-read-child',pid:child.pid,code,signal,reaped:true}));resolve();}));
 child.stdout!.on('data',data=>{out+=String(data);if(out.includes('READY')&&!timer)timer=setTimeout(()=>{expired=true;child.kill('SIGTERM');},2000);});child.stderr!.on('data',data=>err+=String(data));
 const startup=setTimeout(()=>{expired=true;child.kill('SIGTERM');},10000);
 try{await closed;expect(err).toBe('');expect(expired,err+out).toBe(false);expect(out).toMatch(/read_regular_file_required/);}
 finally{clearTimeout(startup);clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;}
},15000);
