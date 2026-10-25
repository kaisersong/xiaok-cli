// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Tool} from '../../../src/types.js';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {CapabilityRegistry} from '../../../src/platform/runtime/capability-registry.js';
import {createHooksRunner} from '../../../src/runtime/hooks-runner.js';
import {BUILTIN_READ_DESCRIPTION} from '../../../src/shared/tool-description-metadata.js';
const roots:string[]=[];const registries:ToolRegistry[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const r of registries.splice(0))r.dispose();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function root(){const r=mkdtempSync(join(tmpdir(),'readonly-registry-'));roots.push(r);return r;}
function readonlyTools(r:string){return buildToolList(undefined,{cwd:r}).filter(tool=>getBuiltinToolIdentity(tool)==='readonly');}
function registry(r:string,options:any={},tools=readonlyTools(r)){const v=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true,...options} as any,tools);registries.push(v);return v;}
function fake(name='read',execute=vi.fn(async()=> 'MUTATION')):Tool{return {permission:'safe',definition:{name,description:'readOnly readonly safe',inputSchema:{type:'object',properties:{}}},execute,...{readOnly:true,annotations:{readOnlyHint:true}}};}
it('executes genuine native read grep glob and advertises only their exact objects with paired metadata',async()=>{
 const r=root(),file=join(r,'evidence.txt');writeFileSync(file,'ORIGINAL');const tools=readonlyTools(r);const metadata=new Map([[tools.find(t=>t.definition.name==='read')!,BUILTIN_READ_DESCRIPTION]]);const v=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true} as any,tools,metadata);registries.push(v);
 expect(await v.executeTool('read',{file_path:file})).toContain('ORIGINAL');expect(await v.executeTool('grep',{path:file,pattern:'ORIGINAL'})).toContain('ORIGINAL');expect(await v.executeTool('glob',{path:r,pattern:'*.txt'})).toContain(file);
 expect(v.getToolDefinitions().map(t=>t.name).sort()).toEqual(['glob','grep','read']);expect(v.searchTools('select:read,bash,write,toolsearch,mcp__readonly').map(t=>t.name)).toEqual(['read']);expect(v.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')?.metadata).toEqual(BUILTIN_READ_DESCRIPTION);
 expect(await v.executeTool('tool_search',{query:'select:bash'})).toMatch(/^Error:/);
});
const deniedPopulation=buildToolList().filter(t=>getBuiltinToolIdentity(t)!=='readonly');
it.each(deniedPopulation.map(tool=>({name:tool.definition.name,tool})))('denies full real produced mutation/unknown population registration: $name',({tool})=>{
 const r=root();expect(()=>registry(r,{},[tool])).toThrow('native_readonly_tool_required');
});
it.each(['read','READ','web-fetch','mcp__server__read','skill_read','render_ui'])('does not grant native authority to same-name alias or readOnly descriptor %s',async name=>{
 const r=root(),v=registry(r),tool=fake(name);expect(()=>v.registerTool(tool,BUILTIN_READ_DESCRIPTION)).toThrow('native_readonly_tool_required');expect(v.searchTools('select:'+name).some(t=>t.name===name&&t.description===tool.definition.description)).toBe(false);expect(tool.execute).not.toHaveBeenCalled();
});
it('late registration atomically rejects an entire companion tree before publishing parent or capabilities',()=>{
 const r=root(),caps=new CapabilityRegistry();const v=registry(r,{capabilityRegistry:caps});const parent=buildToolList(undefined,{cwd:r}).find(t=>t.definition.name==='read')!;const child=fake('mcp__sideeffect');parent.companionTools=[child];const original=v.getRegisteredTool('read');
 expect(()=>v.registerTool(parent)).toThrow('native_readonly_tool_required');expect(v.getRegisteredTool('read')).toBe(original);expect(v.getRegisteredTool(child.definition.name)).toBeUndefined();expect(v.searchTools('').map(t=>t.name).sort()).toEqual(['glob','grep','read']);expect(child.execute).not.toHaveBeenCalled();
});
it('denies deferred identities, foreign discovery and filter-based broadening',async()=>{
 const r=root(),caps=new CapabilityRegistry();caps.register({kind:'tool',name:'foreign_write',description:'safe readonly',inputSchema:{type:'object',properties:{}},execute:async()=> 'MUTATION'},{});const v=registry(r,{capabilityRegistry:caps});expect(()=>v.registerDeferredTool(fake('deferred').definition)).toThrow('native_readonly_tool_required');v.setAllowedTools(['read','foreign_write','bash']);expect(v.searchDeferredTools('')).toEqual([]);expect(v.searchTools('select:foreign_write')).toEqual([]);expect(await v.executeTool('foreign_write',{})).toMatch(/^Error:/);expect(await v.prepareToolInvocation('bash',{command:'echo MUTATION'})).toMatch(/^Error:/);
});
it.each(['execute','permission','definition','precondition'])('fresh native identity denies in-place %s replacement after actual prepare',async field=>{
 const r=root(),file=join(r,'evidence.txt');writeFileSync(file,'ORIGINAL');const v=registry(r);const native=v.getRegisteredTool('read')!;const prepared=await v.prepareToolInvocation('read',{file_path:file});expect(typeof prepared).toBe('object');const replacement=vi.fn(async()=> 'MUTATION');
 if(field==='execute')native.execute=replacement;else if(field==='permission')native.permission='write';else if(field==='definition')native.definition={...native.definition,description:'replaced'};else native.compoundFilePrecondition=()=>({filePath:file,beforeHash:null});
 const result=await v.executePreparedTool(prepared as any).catch(e=>String(e));expect(result).toMatch(/Error:|authorization changed|builtin_tool_changed|native_readonly/);expect(replacement).not.toHaveBeenCalled();expect(v.getToolDefinitions()).not.toContain(native.definition);expect(v.searchTools('select:read')).toEqual([]);
});
it('rejects cloned lookalike and late same-name replacement without changing existing legitimate object',()=>{
 const r=root(),v=registry(r),native=v.getRegisteredTool('read')!;expect(()=>v.registerTool({...native})).toThrow('native_readonly_tool_required');expect(v.getRegisteredTool('read')).toBe(native);
});
it.each(['onToolObserved','protectedOutputGuard','onPrompt','hooksRunner','compoundExecution'])('rejects caller supplied executable owner %s in readonly mode',field=>{
 const r=root(),called=vi.fn(async()=>{});const option=field==='protectedOutputGuard'?{getProtectedArtifacts:()=>[],onDecision:called}:field==='hooksRunner'?{runHooks:called,runPreHooks:called,runPostHooks:called}:field==='compoundExecution'?{execute:called}:called;
 expect(()=>registry(r,{[field]:option})).toThrow(/native_readonly/);expect(called).not.toHaveBeenCalled();
});
it('rejects later opaque compound installation before calling the factory',()=>{
 const r=root(),v=registry(r),factory=vi.fn(()=>({execute:async()=> 'MUTATION'}));expect(()=>v.installCompoundExecutionPort(factory)).toThrow(/native_readonly/);expect(factory).not.toHaveBeenCalled();
});
it('readonly observation fork cannot mint an unknown companion or command identity',async()=>{
 const r=root(),v=registry(r);expect(()=>v.forkForObservation([fake('observation_read')],['read'])).toThrow(/native_readonly/);expect(()=>v.forkForObservation([],['bash'])).toThrow();const fork=v.forkForObservation([],['read']);registries.push(fork);const file=join(r,'file');writeFileSync(file,'ORIGINAL');expect(await fork.executeTool('read',{file_path:file})).toContain('ORIGINAL');expect(await fork.executeTool('write',{file_path:file,content:'MUTATED'})).toMatch(/^Error:/);
});
it('ordinary registry keeps actual write, description sidecar, supplied callbacks and real compound native bridge',async()=>{
 const r=root(),file=join(r,'ordinary.txt');const tools=buildToolList(undefined,{cwd:r});const descriptions=new Map([[tools.find(t=>t.definition.name==='read')!,BUILTIN_READ_DESCRIPTION]]);const observed=vi.fn(async()=>{});const v=new ToolRegistry({autoMode:true,onToolObserved:observed},tools,descriptions);registries.push(v);expect(await v.executeTool('write',{file_path:file,content:'ORIGINAL'})).not.toMatch(/^Error:/);expect(readFileSync(file,'utf8')).toBe('ORIGINAL');expect(observed).toHaveBeenCalledOnce();expect(v.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')?.metadata).toEqual(BUILTIN_READ_DESCRIPTION);
 const compound=new ToolRegistry({autoMode:true},readonlyTools(r));registries.push(compound);compound.installCompoundExecutionPort(()=>({async execute({name,input,native}:any){const prepared=await native.prepare(name,input);if(prepared.kind!=='prepared')return prepared.message;return native.execute(prepared.invocation);}}));expect(await compound.executeTool('read',{file_path:file})).toContain('ORIGINAL');
});

it('captures immutable mode despite later mutation of caller constructor options',async()=>{
 const r=root(),options:any={autoMode:true,nativeReadonlyOnly:true};const v=new ToolRegistry(options,readonlyTools(r));registries.push(v);options.nativeReadonlyOnly=false;expect(v.isNativeReadonlyOnly).toBe(true);expect(()=>v.registerTool(fake('write'))).toThrow('native_readonly_tool_required');expect(await v.executeTool('write',{})).toMatch(/^Error:/);
});
it('disables proved-empty hook methods even if their caller mutates the empty owner afterward',async()=>{
 const r=root(),file=join(r,'file');writeFileSync(file,'ORIGINAL');const hooks=createHooksRunner({});const fail=vi.fn(async()=>{throw Error('mutated hook forbidden');});(hooks as any).runPreHooks=fail;(hooks as any).runHooks=fail;(hooks as any).runPostHooks=fail;const v=registry(r,{hooksRunner:hooks});expect(await v.executeTool('read',{file_path:file})).toContain('ORIGINAL');expect(fail).not.toHaveBeenCalled();
});
it('host readonly identity cannot be disabled by a public property shadow or mutable private-shaped flag',async()=>{
 const r=root(),v=registry(r);(v as any).nativeReadonlyOnly=false;expect(v.isNativeReadonlyOnly).toBe(true);expect(()=>Object.defineProperty(v,'isNativeReadonlyOnly',{value:false})).toThrow();expect(()=>v.registerTool(fake('write'))).toThrow('native_readonly_tool_required');
});
