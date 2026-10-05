import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {ToolRegistry,type PreparedToolInvocation} from '../../../src/ai/tools/index.js';
import {createWriteTool} from '../../../src/ai/tools/write.js';
const clean:Array<()=>void>=[];afterEach(()=>{for(const fn of clean.splice(0).reverse())fn();});
function fixture(port:any){const root=mkdtempSync(join(tmpdir(),'compound-gate-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const registry=new ToolRegistry({autoMode:true,compoundExecution:port} as any,[createWriteTool({cwd:root})]);clean.push(()=>registry.dispose());return{registry,file:join(root,'file')};}
it('routes real native and unclassified tools through the host gate before hooks or effects',async()=>{
 const execute=vi.fn(async()=> 'Error: session mutation state unknown');const{registry,file}=fixture({execute});
 expect(await registry.executeTool('write',{file_path:file,content:'bad'})).toContain('unknown');
 registry.registerTool({definition:{name:'unclassified',description:'not trusted read only',inputSchema:{type:'object',properties:{}}},permission:'auto',execute:async()=>{throw Error('must not run');}} as any);
 expect(await registry.executeTool('unclassified',{})).toContain('unknown');expect(execute).toHaveBeenCalledTimes(2);expect(existsSync(file)).toBe(false);
});
it('public prepare and consume cannot bypass the configured gate',async()=>{
 const{registry,file}=fixture({execute:async()=> 'blocked'});
 const result=await registry.prepareToolInvocationDetailed('write',{file_path:file,content:'bad'});
 expect(result).toMatchObject({kind:'not_started',reason:'blocked'});
 await expect(registry.executePreparedTool({toolName:'write',input:{}} as PreparedToolInvocation)).rejects.toThrow('compound_native_port_required');expect(existsSync(file)).toBe(false);
});
it('permits only same live delivery native tokens and expires escaped closures',async()=>{
 let escaped:any;let token:any;
 const{registry,file}=fixture({execute:async({name,input,native}:any)=>{
  escaped=native;const prepared=await native.prepare(name,input);expect(prepared.kind).toBe('prepared');token=prepared.invocation;
  await expect(registry.executePreparedTool(token)).rejects.toThrow('compound_native_port_required');
  const result=await native.execute(token);await expect(native.execute(token)).rejects.toThrow();return result;
 }});
 await registry.executeTool('write',{file_path:file,content:'once'});expect(readFileSync(file,'utf8')).toBe('once');
 await expect(escaped.prepare('write',{file_path:file,content:'late'})).rejects.toThrow('compound_native_port_expired');
 await expect(escaped.execute(token)).rejects.toThrow();expect(readFileSync(file,'utf8')).toBe('once');
});
it('does not accept native tokens from another concurrent delivery',async()=>{
 let saved:any;let release!:()=>void;const ready=new Promise<void>(r=>release=r);let finish!:()=>void;const wait=new Promise<void>(r=>finish=r);
 const{registry,file}=fixture({execute:async({input,native}:any)=>{
  if(input.content==='first'){const r=await native.prepare('write',input);saved=r.invocation;release();await wait;return 'not executed';}
  await ready;try{await expect(native.execute(saved)).rejects.toThrow('compound_native_token_mismatch');return 'blocked';}finally{finish();}
 }});
 await Promise.all([registry.executeTool('write',{file_path:file,content:'first'}),registry.executeTool('write',{file_path:file,content:'second'})]);expect(existsSync(file)).toBe(false);
});
it('only installs a host port on a fresh registry and prevents later preparation bypass',async()=>{
 const registry=new ToolRegistry({autoMode:true});clean.push(()=>registry.dispose());
 const port={execute:async()=> 'gated'};expect(registry.installCompoundExecutionPort(()=>port)).toBe(port);
 expect(await registry.executeTool('write',{})).toBe('gated');expect(()=>registry.installCompoundExecutionPort(()=>port)).toThrow();
 const used=new ToolRegistry({autoMode:true});clean.push(()=>used.dispose());await used.prepareToolInvocationDetailed('nonexistent',{});
 expect(()=>used.installCompoundExecutionPort(()=>port)).toThrow('compound_registry_not_fresh');
});
