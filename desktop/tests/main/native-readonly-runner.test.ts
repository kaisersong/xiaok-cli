// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {createDesktopModelRunnerWithRegistry} from '../../electron/desktop-services.js';
import * as skills from '../../../src/ai/skills/loader.js';
import * as gateways from '../../electron/provider-gateways/create-host-gateways.js';
const roots:string[]=[];const registries:ToolRegistry[]=[];const materials:MaterialRegistry[]=[];const prior=process.env.XIAOK_CONFIG_DIR;
afterEach(async()=>{vi.restoreAllMocks();for(const v of registries.splice(0)){v.dispose();}for(const m of materials.splice(0))await m.sealAndDrainInstanceMutations();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;});
function fixture(){const r=mkdtempSync(join(tmpdir(),'native-readonly-runner-'));roots.push(r);const config=join(r,'config');mkdirSync(config);process.env.XIAOK_CONFIG_DIR=config;writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));const tools=buildToolList(undefined,{cwd:r}).filter(t=>getBuiltinToolIdentity(t)==='readonly');const registry=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true},tools);registries.push(registry);const material=new MaterialRegistry({workspaceRoot:join(r,'materials'),maxBytes:1000000});materials.push(material);return{r,tools,registry,material};}
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
