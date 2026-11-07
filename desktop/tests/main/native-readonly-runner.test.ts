// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSandboxPolicy} from '../../../src/platform/sandbox/policy.js';
import {createSandboxEnforcer} from '../../../src/platform/sandbox/enforcer.js';
import {applySandboxToTools} from '../../../src/platform/sandbox/tool-wrappers.js';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {buildScopedNativeReadonlyTools} from '../../../src/ai/tools/scoped-native-readonly.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {createDesktopModelRunnerWithRegistry} from '../../electron/desktop-services.js';
import * as skills from '../../../src/ai/skills/loader.js';
import * as gateways from '../../electron/provider-gateways/create-host-gateways.js';
const roots:string[]=[];const registries:ToolRegistry[]=[];const materials:MaterialRegistry[]=[];const prior=process.env.XIAOK_CONFIG_DIR;
afterEach(async()=>{vi.restoreAllMocks();for(const v of registries.splice(0)){v.dispose();}for(const m of materials.splice(0))await m.sealAndDrainInstanceMutations();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;});
function fixture(scoped=true){const r=mkdtempSync(join(tmpdir(),'native-readonly-runner-'));roots.push(r);const config=join(r,'config');mkdirSync(config);process.env.XIAOK_CONFIG_DIR=config;writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));const tools=scoped?buildScopedNativeReadonlyTools({cwd:r,readOnlyPaths:[r]}):buildToolList(undefined,{cwd:r}).filter(t=>getBuiltinToolIdentity(t)==='readonly');const registry=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true,requireSandboxScope:scoped},tools);registries.push(registry);const material=new MaterialRegistry({workspaceRoot:join(r,'materials'),maxBytes:1000000});materials.push(material);return{r,tools,registry,material};}
it('rejects identity-only readonly registries without authenticated path scope before creating a model runner',()=>{
 const {r,tools,registry,material}=fixture(false);
 expect(()=>createDesktopModelRunnerWithRegistry(registry,tools,join(r,'data'),{} as never,material,{}, {cwd:r})).toThrow('native_readonly_scope_required');
});
it('scoped readonly registry rejects later raw native tools before publishing them',()=>{
 const {r,registry}=fixture();const before=registry.getToolDefinitions();
 const raw=buildToolList(undefined,{cwd:r}).find(tool=>tool.definition.name==='read')!;
 expect(()=>registry.registerTool(raw)).toThrow('native_readonly_tool_required');expect(registry.getToolDefinitions()).toEqual(before);
});
it.each(['grep','glob'])('actual scoped readonly model runner rejects outside %s',async name=>{
 const {r,tools,registry,material}=fixture();const outside=mkdtempSync(join(tmpdir(),'native-outside-'));roots.push(outside);
 writeFileSync(join(outside,'private.txt'),'PRIVATE_CANARY');let calls=0;let result='';
 vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages){
  if(++calls===1)yield {type:'tool_use',id:'outside-read',name,input:{path:outside,pattern:name==='grep'?'PRIVATE':'**/*'}};
  else {const block=messages.flatMap(message=>message.content).find(block=>block.type==='tool_result');result=block?.type==='tool_result'?block.content:'';yield {type:'text',delta:'读取范围拒绝，未取得外部资料。'};}
  yield {type:'done'};
 });
 const runner=createDesktopModelRunnerWithRegistry(registry,tools,join(r,'data'),{} as never,material,{}, {cwd:r});
 await runner({taskId:'task',sessionId:'session',prompt:'Review',materials:[],understanding:{goal:'review',deliverable:'review',taskType:'unknown',audience:'user',inputs:[],missingInfo:[],assumptions:[],riskLevel:'low',suggestedPlan:[],nextAction:'execute'},signal:new AbortController().signal,history:[],permissionMode:'auto',emitUsage:async()=>{},emitRuntimeEvent:async()=>{}});
 expect(result).toMatch(/denied/);expect(result).not.toContain('PRIVATE_CANARY');expect(result).not.toContain('private.txt');
});
it('empty approved references grant no tools rather than an unrestricted empty allowlist',()=>{
 const {r}=fixture();expect(buildScopedNativeReadonlyTools({cwd:r,readOnlyPaths:[]})).toEqual([]);
});
it('an unrestricted ordinary sandbox cannot be presented as a scoped readonly registry',()=>{
 const {r}=fixture();const raw=buildToolList(undefined,{cwd:r}).filter(tool=>getBuiltinToolIdentity(tool)==='readonly');
 const tools=applySandboxToTools(raw,createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[],network:'deny'})));
 expect(()=>new ToolRegistry({autoMode:true,nativeReadonlyOnly:true,requireSandboxScope:true},tools)).toThrow('native_readonly_tool_required');
});
it('read executes the exact path checked by the sandbox even when its internal cwd differs',async()=>{
 const {r}=fixture();const relative=join('.dsh-read-'+randomUUID(),'evidence.txt'),approved=join(process.cwd(),relative),wrong=join(r,relative);
 roots.push(dirname(approved));mkdirSync(dirname(approved),{recursive:true,mode:0o700});mkdirSync(dirname(wrong),{recursive:true});
 writeFileSync(approved,'PUBLIC_APPROVED_TEXT');writeFileSync(wrong,'PRIVATE_WRONG_CWD');
 const raw=buildToolList(undefined,{cwd:r,readOnlyPaths:[approved]}).filter(tool=>tool.definition.name==='read');
 const tools=applySandboxToTools(raw,createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[approved],network:'deny'})));
 const registry=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true,requireSandboxScope:true},tools);registries.push(registry);
 const result=await registry.executeTool('read',{file_path:relative});expect(result).toContain('PUBLIC_APPROVED_TEXT');expect(result).not.toContain('PRIVATE_WRONG_CWD');
});
it('scoped readonly observation forks retain scope and all three permitted tool paths',async()=>{
 const {r,registry}=fixture();const file=join(r,'positive.txt');writeFileSync(file,'PUBLIC_MATCH');
 const fork=registry.forkForObservation([],['read','grep','glob']);registries.push(fork);
 expect(await fork.executeTool('read',{file_path:file})).toContain('PUBLIC_MATCH');
 expect(await fork.executeTool('grep',{path:file,pattern:'PUBLIC'})).toContain('PUBLIC_MATCH');
 expect(await fork.executeTool('glob',{path:r,pattern:'*.txt'})).toContain('positive.txt');
 const outside=mkdtempSync(join(tmpdir(),'fork-outside-'));roots.push(outside);writeFileSync(join(outside,'secret.txt'),'PRIVATE_CANARY');
 expect(await fork.executeTool('grep',{path:outside,pattern:'PRIVATE'})).toMatch(/denied/);
});
it('suppresses all ordinary bootstrap and late skill/gateway registrations in the actual opted-in model runner',async()=>{
 const{r,tools,registry,material}=fixture();const register=vi.spyOn(registry,'registerTool');const gateway=vi.spyOn(gateways,'createAllHostGateways');const originalCatalog=skills.createSkillCatalog;let reloads=0;vi.spyOn(skills,'createSkillCatalog').mockImplementation((...args)=>{const catalog=originalCatalog(...args);const reload=catalog.reload;catalog.reload=async()=>{reloads++;return reload.call(catalog);};return catalog;});
 const file=join(r,'evidence.txt');writeFileSync(file,'ORIGINAL');const forbiddenRuntime={acquire:()=>{throw Error('gateway must not run');},describeUnavailable:()=>{throw Error('gateway must not run');}};let calls=0;
 vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(_messages,definitions){expect(definitions.map(d=>d.name).sort()).toEqual(['glob','grep','read']);if(++calls===1)yield {type:'tool_use',id:'native-read',name:'read',input:{file_path:file}};else yield {type:'text',delta:'完成审查并返回当前参考资料核对结果，未修改任何交付物。'};yield {type:'done'};});
 const runner=createDesktopModelRunnerWithRegistry(registry,tools,join(r,'data'),{request:async()=>{throw Error('bootstrap service must not run');}} as never,material,{}, {cwd:r,pluginProviderRuntime:forbiddenRuntime,nativeReadonlyOnly:false});
 await runner({taskId:'task',sessionId:'session',prompt:'Review evidence',materials:[],understanding:{goal:'review',deliverable:'review',taskType:'unknown',audience:'user',inputs:[],missingInfo:[],assumptions:[],riskLevel:'low',suggestedPlan:[],nextAction:'execute'},signal:new AbortController().signal,history:[],permissionMode:'auto',emitUsage:async()=>{},emitRuntimeEvent:async()=>{}});
 expect(calls).toBe(2);expect(register).not.toHaveBeenCalled();expect(gateway).not.toHaveBeenCalled();expect(reloads).toBe(0);expect(registry.getToolDefinitions().map(d=>d.name).sort()).toEqual(['glob','grep','read']);
});
it.each(['create_project','report_artifact','report_progress','memory_write','get_room_messages_page','skill','skill_bundle_refs','mcp__report__render_report','read_material','read_workspace_material'])('actual readonly runner refuses hallucinated nonnative %s including material shortcuts',async name=>{
 const{r,tools,registry,material}=fixture();let calls=0;const errors:string[]=[];const execute=vi.spyOn(registry,'executeTool');const importMaterial=vi.spyOn(material,'importMaterial');
 vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages){if(++calls===1)yield {type:'tool_use',id:'forbidden',name,input:{name:'Project',goal:'report',file_path:join(r,'fake')}};else{const result=messages.flatMap(m=>m.content).find(b=>b.type==='tool_result');errors.push(result?.type==='tool_result'?result.content:'');yield {type:'text',delta:'审查已完成，不支持当前工具且没有执行任何文件或项目写入。'};}yield {type:'done'};});
 const request=vi.fn(async()=>{throw Error('service mutation forbidden');});const runner=createDesktopModelRunnerWithRegistry(registry,tools,join(r,'data'),{request} as never,material,{}, {cwd:r});await runner({taskId:'task',sessionId:'session',prompt:'Review evidence',materials:[],understanding:{goal:'review',deliverable:'review',taskType:'unknown',audience:'user',inputs:[],missingInfo:[],assumptions:[],riskLevel:'low',suggestedPlan:[],nextAction:'execute'},signal:new AbortController().signal,history:[],permissionMode:'auto',emitUsage:async()=>{},emitRuntimeEvent:async()=>{}});
 expect(errors).toHaveLength(1);expect(errors[0]).toMatch(/^Error:/);expect(execute).toHaveBeenCalledWith(name,expect.anything(),expect.anything());expect(importMaterial).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});
