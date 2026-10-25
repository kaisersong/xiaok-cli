// @vitest-environment node
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({root:'',windows:[] as unknown[]}));
vi.mock('electron',()=>({app:{getPath:()=>state.root},BrowserWindow:{getAllWindows:()=>state.windows,fromWebContents:()=>undefined},clipboard:{read:vi.fn(),readImage:vi.fn()},dialog:{showOpenDialog:vi.fn(),showSaveDialog:vi.fn()},shell:{openExternal:vi.fn(),openPath:vi.fn(),showItemInFolder:vi.fn()},systemPreferences:{askForMediaAccess:vi.fn(),getMediaAccessStatus:vi.fn()}}));
import {registerDesktopIpc} from '../../electron/ipc.js';
import {createDesktopLoopRuntime} from '../../electron/loop-executor.js';
import {getDesktopMemoryStore} from '../../electron/desktop-services.js';
import {resetIpcSchemaRegistryForTests,IPC_SCHEMA_REGISTRY} from '../../electron/ipc-runtime.js';

async function owned(body:(fixture:{runtime:ReturnType<typeof createDesktopLoopRuntime>;handlers:Map<string,Function>;root:string})=>Promise<void>|void,options:Omit<Parameters<typeof createDesktopLoopRuntime>[0],'dataRoot'>={}){
 const root=mkdtempSync(join(tmpdir(),'xiaok-loop-management-red-'));state.root=root;const runtime=createDesktopLoopRuntime({...options,dataRoot:root});const handlers=new Map<string,Function>();const registrar={handle:(name:string,handler:Function)=>handlers.set(name,handler)};const window={id:1,once:vi.fn(),isDestroyed:()=>false,webContents:{id:11,send:vi.fn()}};state.windows=[window];
 try{await registerDesktopIpc(registrar as never,window as never,{getDataRoot:()=>root}as never,{loopRuntime:runtime});await body({runtime,handlers,root});}finally{runtime.close();getDesktopMemoryStore(root).close?.();resetIpcSchemaRegistryForTests();state.windows=[];rmSync(root,{recursive:true,force:true});}
}
import {registerLoopManagementIpc} from '../../electron/loop-management-typed-ipc.js';
import {LOOP_MANAGEMENT_OUTPUT_SCHEMAS,LOOP_TEMPLATE_CONTRACT_SCHEMA} from '../../shared/loop-management-ipc-contract.js';

it('characterizes complete11 registered handlers through actual owned LoopRuntime/SQLite without a fake result controller',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-loop-management-ipc-'));state.root=root;
 const runtime=createDesktopLoopRuntime({dataRoot:root});
 const handlers=new Map<string,Function>();const registrar={handle:(name:string,handler:Function)=>handlers.set(name,handler)};
 const window={id:1,once:vi.fn(),isDestroyed:()=>false,webContents:{id:11,send:vi.fn()}};state.windows=[window];
 const services={getDataRoot:()=>root};
 const results:Record<string,unknown>={};
 const invoke=async(name:string,...args:unknown[])=>{const handler=handlers.get('desktop:loops:'+name);expect(handler).toBeDefined();const output=await handler!({},...args);results[name]=output;return output;};
 try{
  await registerDesktopIpc(registrar as never,window as never,services as never,{loopRuntime:runtime});
  const defs=await invoke('listDefinitions');expect(defs).toHaveLength(4);
  expect(await invoke('listUserTemplates')).toEqual([]);
  const created=await invoke('createUserTemplate',{loopId:'owned-markdown',kind:'markdown_file',title:'title',prompt:'prompt',outputDirectory:join(root,'out'),outputFileName:'report.md',scheduleEnabled:true,scheduleTrigger:{kind:'interval',seconds:3},autoRunApproved:true}) as any;
  expect(created.ignoredLegacyScheduleFields).toEqual(['scheduleEnabled','scheduleTrigger','autoRunApproved']);expect(created.template.scheduleEnabled).toBe(false);expect(created.template.autoRunApproved).toBe(false);
  const updated=await invoke('updateUserTemplate','owned-markdown',{prompt:'updated'}) as any;expect(updated.prompt).toBe('updated');
  const task=await invoke('createUserTemplate',{loopId:'owned-task',kind:'task_completion',title:'task',prompt:'finish'}) as any;expect(task.template.contract.permissionPolicy.mode).toBe('read_only');
  expect(await invoke('listUserTemplates')).toHaveLength(2);
  expect(await invoke('listAnomalies','owned-markdown')).toEqual([]);
  const constraint=runtime.loopStore.addConstraint({loopId:'owned-markdown',source:'user_manual',rule:'preserve data',sourceRunId:'owned-run',now:1});
  expect(await invoke('listConstraints','owned-markdown')).toHaveLength(1);
  const confirmed=await invoke('confirmConstraint',constraint.id) as any;expect(confirmed.active).toBe(true);
  const inactive=await invoke('setConstraintActive',constraint.id,false) as any;expect(inactive.active).toBe(false);
  expect(await invoke('clearRunHistory','owned-markdown',[])).toEqual({ok:true,removed:0});
  expect(await invoke('runNow','missing-owned-loop')).toEqual({status:'skipped',reason:'missing_loop'});
  expect(await invoke('deleteUserTemplate','owned-markdown')).toBeUndefined();expect(runtime.loopStore.getUserLoopTemplate('owned-markdown')).toBeUndefined();
  expect(Object.keys(results)).toHaveLength(11);
  console.log('LOOP_MANAGEMENT11_ACTUAL_FIELDS',JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,value])=>[name,{kind:value===undefined?'undefined':Array.isArray(value)?'array':typeof value,keys:value&&typeof value==='object'?Object.keys(value):[]}]))));
 }finally{runtime.close();getDesktopMemoryStore(root).close?.();resetIpcSchemaRegistryForTests();state.windows=[];rmSync(root,{recursive:true,force:true});}
});
it('registers typed metadata for all eleven original Loop management entrypoints',async()=>{await owned(()=>{for(const name of ['listDefinitions','listUserTemplates','createUserTemplate','updateUserTemplate','deleteUserTemplate','listAnomalies','runNow','listConstraints','setConstraintActive','confirmConstraint','clearRunHistory'])expect(IPC_SCHEMA_REGISTRY.get('desktop:loops:'+name),'missing '+name).toBeDefined();});});
it('reports mutation unknown after actual SQLite commit with a malformed known template ID without retry or rollback',async()=>{await owned(async({runtime,handlers,root})=>{const original=runtime.loopStore.createUserLoopTemplate.bind(runtime.loopStore);let calls=0;runtime.loopStore.createUserLoopTemplate=input=>{calls++;const actual=original(input);return {...actual,template:{...actual.template,loopId:42}}as never;};const result=handlers.get('desktop:loops:createUserTemplate')!({}, {loopId:'owned-committed',kind:'markdown_file',title:'commit',prompt:'preserve',outputDirectory:join(root,'out'),outputFileName:'report.md'});expect(calls).toBe(1);expect(runtime.loopStore.getUserLoopTemplate('owned-committed')?.prompt).toBe('preserve');await expect(Promise.resolve(result)).rejects.toThrow('loop_operation_unknown');expect(calls).toBe(1);expect(runtime.loopStore.getUserLoopTemplate('owned-committed')?.loopId).toBe('owned-committed');});});
it('captures the actual synchronous full definition result before caller alias mutation',async()=>{await owned(async({runtime,handlers})=>{const actual=runtime.loopStore.listLoopDefinitions();const expected=actual[0]!.title;runtime.loopStore.listLoopDefinitions=()=>actual;const result=handlers.get('desktop:loops:listDefinitions')!({});actual[0]!.title='caller-mutated';expect((await result)[0].title).toBe(expected);});});
it('preserves legacy ignored scheduling primitives without granting execution or changing original empty and nullable patch behavior',async()=>{await owned(async({runtime,handlers,root})=>{
 const create=handlers.get('desktop:loops:createUserTemplate')!;
 const result=await create({}, {loopId:'legacy-ignored',kind:'task_completion',title:'legacy',prompt:'keep',scheduleEnabled:NaN,autoRunApproved:1n,scheduleTrigger:{undefinedValue:undefined,big:3n,infinite:Infinity}});
 expect(result.ignoredLegacyScheduleFields).toEqual(['scheduleEnabled','scheduleTrigger','autoRunApproved']);expect(result.template.scheduleEnabled).toBe(false);expect(result.template.autoRunApproved).toBe(false);expect(result.template.contract.permissionPolicy.mode).toBe('read_only');
 expect(await handlers.get('desktop:loops:updateUserTemplate')!({},'legacy-ignored',null)).toBeDefined();
 expect(await handlers.get('desktop:loops:updateUserTemplate')!({},'missing')).toBeUndefined();
 expect(await handlers.get('desktop:loops:confirmConstraint')!({},'')).toBeUndefined();
 expect(await handlers.get('desktop:loops:setConstraintActive')!({},'',false)).toBeUndefined();
 expect(runtime.loopStore.getUserLoopTemplate('legacy-ignored')?.scheduleTrigger).toBeUndefined();
});});
it('rejects closed authority fields, invalid tuples and hostile input before the actual producer is called',async()=>{await owned(async({runtime,handlers})=>{
 const spy=vi.spyOn(runtime.loopStore,'createUserLoopTemplate');let reads=0;const getter={get kind(){reads++;throw Error('unexpected getter');}},proxy=new Proxy({}, {get(){reads++;throw Error('unexpected proxy');},ownKeys(){reads++;throw Error('unexpected keys');}});
 for(const input of [getter,proxy,{loopId:'forged',kind:'task_completion',title:'title',prompt:'prompt',requestSource:'user'}])await expect(handlers.get('desktop:loops:createUserTemplate')!({},input)).rejects.toThrow('loop_input_invalid');
 expect(reads).toBe(0);expect(spy).not.toHaveBeenCalled();await expect(handlers.get('desktop:loops:listDefinitions')!({},'extra')).rejects.toThrow('loop_input_invalid');
 await expect(handlers.get('desktop:loops:clearRunHistory')!({},'ok',[1])).rejects.toThrow('loop_input_invalid');
 await expect(handlers.get('desktop:loops:setConstraintActive')!({},'id','yes')).rejects.toThrow('loop_input_invalid');
 await expect(handlers.get('desktop:loops:deleteUserTemplate')!({},'  ')).rejects.toThrow('loopId must be a non-empty string');
});});
it('preserves original producer error identity and uses native Promise then without touching an overridden getter',async()=>{await owned(async({runtime,handlers})=>{
 const originalError=Error('protected_history');runtime.loopStore.clearLoopRunHistory=()=>{throw originalError;};await expect(handlers.get('desktop:loops:clearRunHistory')!({},'loop')).rejects.toBe(originalError);
 let reads=0;const promise=Promise.resolve({status:'skipped' as const,reason:'missing_loop' as const});Object.defineProperty(promise,'then',{get(){reads++;throw Error('unexpected then');}});runtime.runner.runLoopNow=()=>promise;
 expect(await handlers.get('desktop:loops:runNow')!({},'missing')).toEqual({status:'skipped',reason:'missing_loop'});expect(reads).toBe(0);
 const data={status:'skipped',reason:'missing_loop',get then(){reads++;throw Error('unexpected data then');}};runtime.runner.runLoopNow=()=>data as never;
 await expect(handlers.get('desktop:loops:runNow')!({},'missing')).rejects.toThrow('loop_operation_unknown');expect(reads).toBe(0);
});});
it('continues partial registrations only for the initial actual runtime and never exchanges owners',async()=>{await owned(({runtime})=>{
 const registered=new Map<string,Function>();let fail=true;const registrar={handle:(channel:string,fn:Function)=>{if(fail&&channel.endsWith(':createUserTemplate')){fail=false;throw Error('actual partial registration');}expect(registered.has(channel)).toBe(false);registered.set(channel,fn);}};
 expect(()=>registerLoopManagementIpc(registrar as never,runtime)).toThrow('actual partial registration');expect(registered.size).toBe(2);
 registerLoopManagementIpc(registrar as never,runtime);expect(registered.size).toBe(11);const first=registered.get('desktop:loops:listDefinitions');registerLoopManagementIpc(registrar as never,runtime);expect(registered.get('desktop:loops:listDefinitions')).toBe(first);
 expect(()=>registerLoopManagementIpc(registrar as never,{...runtime})).toThrow('owner_conflict');expect(registered.get('desktop:loops:listDefinitions')).toBe(first);
});});
it('keeps unavailable runtime admission ahead of hostile input and rejects replacing its owner later',async()=>{
 const handlers=new Map<string,Function>();const registrar={handle:(name:string,fn:Function)=>handlers.set(name,fn)};registerLoopManagementIpc(registrar as never);let reads=0;
 const raw={get title(){reads++;throw Error('unexpected input');}};expect(()=>handlers.get('desktop:loops:createUserTemplate')!({},raw)).toThrow('loop diagnostics runtime is not registered');expect(reads).toBe(0);
 await owned(({runtime})=>{expect(()=>registerLoopManagementIpc(registrar as never,runtime)).toThrow('owner_conflict');});
});
it('validates every full contract criterion and run family without accepting known malformed slots as historical data',()=>{
 const run={id:'run',loopId:'loop',status:'running',trigger:{kind:'manual',old:{deep:[1,'data',null]}},evidenceIds:[],startedAt:-1.5,updatedAt:2};
 for(const status of ['publication_pending','executing','success','blocked','failed'])expect(LOOP_MANAGEMENT_OUTPUT_SCHEMAS.runNow.safeParse({status,run}).success).toBe(true);
 for(const value of [{status:'already_running',activeRunId:'r'},{status:'already_completed',completedRunId:'r'},...['paused','missing_loop','deleted_loop'].map(reason=>({status:'skipped',reason}))])expect(LOOP_MANAGEMENT_OUTPUT_SCHEMAS.runNow.safeParse(value).success).toBe(true);
 expect(LOOP_MANAGEMENT_OUTPUT_SCHEMAS.runNow.safeParse({status:'success',run:{...run,id:42}}).success).toBe(false);
 const contract={schemaVersion:'loop_contract_v1',objective:'objective',triggerPolicy:{kind:'manual'},successCriteria:[{kind:'task_completed',strength:'strong'},{kind:'file_exists',pathTemplate:'file',minBytes:1,expectedMime:'text/plain'},{kind:'command_exit_zero',commandId:'fixed',args:['--old-data'],cwdPolicy:'workspace'}],stopPolicy:{maxConsecutiveFailures:3},permissionPolicy:{mode:'workspace_write',autoRunApproved:false,allowedToolCategories:['file_write'],approvedTargetRefs:['target']},concurrencyPolicy:{perLoop:'queue_latest',coalesceMissedRuns:false},legacyPolicy:{requiresHumanApprovalBeforeBackgroundSuccess:true,legacyWeakModeAuditRef:'old',grandfatheredOutputTargetRefs:['old']}};
 expect(LOOP_TEMPLATE_CONTRACT_SCHEMA.safeParse(contract).success).toBe(true);expect(LOOP_TEMPLATE_CONTRACT_SCHEMA.safeParse({...contract,permissionPolicy:{...contract.permissionPolicy,autoRunApproved:'true'}}).success).toBe(false);
});

it('accepts actual runtime paused, deleted and admitted failed template results without inventing model or native completion',async()=>{await owned(async({runtime,handlers})=>{
 const create=handlers.get('desktop:loops:createUserTemplate')!;const run=handlers.get('desktop:loops:runNow')!;
 for(const id of ['paused-template','deleted-template','no-task-port'])await create({}, {loopId:id,kind:'task_completion',title:id,prompt:'no external task'});
 runtime.loopStore.setLoopStatus('paused-template','paused',Date.now());expect(await run({},'paused-template')).toEqual({status:'skipped',reason:'paused'});
 runtime.loopStore.setLoopStatus('deleted-template','deleted',Date.now(),'owned test');expect(await run({},'deleted-template')).toEqual({status:'skipped',reason:'deleted_loop'});
 const failed=await run({},'no-task-port');expect(failed.status).toBe('failed');expect(failed.run.status).toBe('failed');expect(failed.run.failureKind).toBe('executor_failed');expect(runtime.loopStore.getLoopRun(failed.run.id)?.status).toBe('failed');
});});
it('preserves both complete actual scanner anomaly families and a genuine built-in runner result through the registered boundary',async()=>{await owned(async({runtime,handlers})=>{
 runtime.evidenceStore.upsertExpectation({ownerKind:'task',ownerId:'owned-incomplete',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:100});
 expect(()=>runtime.evidenceStore.completeOwnerWithEvidence({ownerKind:'task',ownerId:'owned-incomplete',now:101})).toThrow();
 const artifactScan=runtime.scanner.scan({now:102});expect(artifactScan.anomalies).toHaveLength(1);
 const artifact=await handlers.get('desktop:loops:listAnomalies')!({},'artifact-evidence-regression');expect(artifact).toEqual(artifactScan.anomalies);expect(artifact[0].ownerKind).toBe('task');
 const healthScan=await runtime.kswarmHealthScanner.scan({now:103});expect(healthScan.anomalies).toHaveLength(1);
 const health=await handlers.get('desktop:loops:listAnomalies')!({},'kswarm-service-health');expect(health).toEqual(healthScan.anomalies);expect(health[0].kind).toBe('source_unavailable');
 const result=await handlers.get('desktop:loops:runNow')!({},'kswarm-service-health');expect(['success','blocked','failed','publication_pending']).toContain(result.status);expect(result.run.loopId).toBe('kswarm-service-health');expect(runtime.loopStore.getLoopRun(result.run.id)?.id).toBe(result.run.id);
},{kswarmHealthProbe:()=>{throw Error('owned real probe unavailable');}});});
