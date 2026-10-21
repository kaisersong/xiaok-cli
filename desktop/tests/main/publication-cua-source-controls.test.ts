// @vitest-environment node
// Ordinary finite transport controls. Real registrar/Main AST; no CUA/SDK workflow is executed.
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as os from 'node:os';
import {compileFunction,runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import type {createDesktopServices} from '../../electron/desktop-services.js';
import type {DesktopGoalProjection} from '../../electron/desktop-goal-coordinator.js';
import type {ComputerUseCapabilityStatusView} from '../../electron/preload-api.js';
import {createPreloadApi,type DesktopApi} from '../../electron/preload-api.js';
import {sanitizeUserFacingErrorMessage} from '../../renderer/src/lib/error-display.js';
import {resolveComputerUseUserAction} from '../../renderer/src/lib/computer-use-recoverable-action.js';
import {en} from '../../renderer/src/locales/en.js';
import {afterEach,beforeEach,expect,expectTypeOf,it,vi} from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/publication-cua-unit',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:()=>{}},clipboard:{},dialog:{},shell:{}}));
import {registerDesktopIpc} from '../../electron/ipc.js';
import {IPC_SCHEMA_REGISTRY,resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain,type IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
import {actualQueryAuthorizers} from '../support/goal-native-query-fixture.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
export const rows=[{method:'recoverGoalPublication',channel:'desktop:goal:recoverPublication',goal:true},{method:'continueGoalPublication',channel:'desktop:goal:continuePublication',goal:true},{method:'enableComputerUse',channel:'desktop:enableComputerUse',goal:false},{method:'reconnectComputerUse',channel:'desktop:reconnectComputerUse',goal:false},{method:'disableComputerUse',channel:'desktop:disableComputerUse',goal:false}] as const;
type Row=typeof rows[number];
const NativePromise=Promise,turn=()=>new NativePromise<void>(r=>setImmediate(r));
const cleanup:Array<()=>Promise<void>>=[];
beforeEach(resetIpcSchemaRegistryForTests);afterEach(async()=>{const errors:unknown[]=[];try{for(const fn of cleanup.splice(0))try{await fn();}catch(e){errors.push(e);}}finally{vi.restoreAllMocks();}if(errors.length)throw new AggregateError(errors,'all_transport_cleanup_errors');});
const dto=(row:Row):unknown=>row.goal?{state:createGoalState({sessionId:'thread',objective:'Ordinary scripted transport data',expectedEvidenceKinds:['answer'],now:100}),activation:'disarmed',currentCompletion:{kind:'unavailable'}}:{state:'ready',mcpConnected:true,wrapperReady:true};
async function fixture(row:Row,producer:(input:unknown)=>Promise<unknown>=()=>NativePromise.resolve(dto(row)),omitFine=false){
 const root=mkdtempSync(join(tmpdir(),'publication-cua-wire-'));let gate:DesktopShutdownGate|undefined;const disposers:Array<()=>void>=[];
 let closed:Promise<void>|undefined;
 const close=()=>closed ??= (async()=>{const errors:unknown[]=[];let drained=!gate;try{gate?.close();if(gate)drained=await gate.drain(1500);}catch(e){errors.push(e);}finally{for(const d of disposers.splice(0))try{d();}catch(e){errors.push(e);}if(drained)try{rmSync(root,{recursive:true,force:true});}catch(e){errors.push(e);}else errors.push(Error('owned_transport_root_retained_pending_token: '+root));}if(errors.length)throw new AggregateError(errors,'transport_cleanup_failed');})();
 try{
  const frame={url:process.env['XIAOK_DESKTOP_DEV_SERVER']||pathToFileURL(resolve('dist/renderer/index.html')).href};let destroyed=false;
  const target=Object.assign(new EventEmitter(),{id:931,mainFrame:frame,isDestroyed:()=>destroyed,send:()=>{throw Error('no_transport_send');}}),recorder=Object.assign(new EventEmitter(),{id:932,mainFrame:frame,isDestroyed:()=>false});
  const window={webContents:target,isDestroyed:()=>false},calls:unknown[]=[];
  const services={multiAgent:undefined,getDataRoot:()=>root,
   recoverGoalPublication:(input:unknown)=>{calls.push(input);return producer(input);},continueGoalPublication:(input:unknown)=>{calls.push(input);return producer(input);},
   enableComputerUse:(input:unknown)=>{calls.push(input);return producer(input);},reconnectComputerUse:(input:unknown)=>{calls.push(input);return producer(input);},disableComputerUse:(input:unknown)=>{calls.push(input);return producer(input);}};
  const auth=actualQueryAuthorizers(window,{ownsWebContents:(sender:unknown)=>sender===recorder},services),listeners=new Map<string,IpcHandlerListener>();gate=new DesktopShutdownGate();
  const registrar=new ShutdownAwareIpcMain({handle:(channel,handler)=>listeners.set(channel,handler)},gate,auth.coarse);
  await registerDesktopIpc(registrar,window as never,services as never,{multiAgentAuthorize:omitFine?undefined:auth.finer,registerLifetimeDisposer:d=>disposers.push(d)});
  const event={sender:target,senderFrame:frame},args=()=>row.goal?[{threadId:'thread'}]:[];
  const invoke=(input:unknown[]=args(),sender:unknown=event)=>Reflect.apply(listeners.get(row.channel)!,undefined,[sender,...input]) as Promise<unknown>;
  cleanup.push(close);return {gate,invoke,args,calls,target,recorder,frame,revoke:()=>{destroyed=true;}};
 }catch(original){try{await close();}catch(error){throw new AggregateError([original,error],'init_and_cleanup_failure');}throw original;}
}
it.each(rows)('$method full original wire: input/source/DTO typed tuple and correct single channel',async row=>{
 const expected=dto(row),f=await fixture(row,()=>NativePromise.resolve(expected));await expect(f.invoke(row.goal?[{threadId:' thread '}]:[])).resolves.toEqual(expected);
 expect(f.calls).toEqual([row.goal?{threadId:'thread',requestSource:'user'}:{requestSource:'user'}]);expect(f.gate.outstanding).toBe(0);
 expect(IPC_SCHEMA_REGISTRY.get(row.channel)).toMatchObject({payloadMode:'tuple',sourceFile:row.goal?'desktop/electron/goal-publication-typed-ipc.ts':'desktop/electron/computer-use-control-typed-ipc.ts'});
});
it.each(rows)('$method rejects wrong arity/accessor before original producer, caller source cannot grant',async row=>{
 const f=await fixture(row);let reads=0;const hostile=Object.defineProperty({threadId:'thread'},'requestSource',{enumerable:true,get(){reads++;throw Error('caller_source');}});
 const bad=row.goal?[[],[{threadId:'thread'},0],[hostile],[{threadId:'thread',requestSource:'agent'}]]:[[0],[hostile]];
 for(const args of bad)await expect(f.invoke(args)).rejects.toThrow();expect(reads).toBe(0);expect(f.calls).toEqual([]);expect(f.gate.outstanding).toBe(0);
});
it.each(rows)('$method actual coarse/finer Recorder, childframe, destroyed source deny before input',async row=>{
 const f=await fixture(row);for(const e of [{sender:f.recorder,senderFrame:f.frame},{sender:f.target,senderFrame:{url:f.frame.url}}])await expect(f.invoke(f.args(),e)).rejects.toThrow();f.revoke();await expect(f.invoke()).rejects.toThrow();expect(f.calls).toEqual([]);expect(f.gate.outstanding).toBe(0);
});
it.each(rows)('$method omitted Main finer authority defaults deny',async row=>{const f=await fixture(row,undefined,true);await expect(f.invoke()).rejects.toThrow();expect(f.calls).toEqual([]);expect(f.gate.outstanding).toBe(0);});
it.each(rows)('$method output capture rejects getter/missing required schema without reading',async row=>{
 let reads=0;const bad=row.goal?{...dto(row) as object,state:Object.defineProperty({},'objective',{enumerable:true,get(){reads++;throw Error('objective_getter');}})}:Object.defineProperty({},'state',{enumerable:true,get(){reads++;throw Error('state_getter');}});
 for(const value of [bad,row.goal?{state:{},activation:'disarmed'}:{state:'ready',mcpConnected:true}]){const f=await fixture(row,()=>NativePromise.resolve(value));await expect(f.invoke()).rejects.toThrow();expect(f.gate.outstanding).toBe(0);}expect(reads).toBe(0);
});
it.each(rows)('$method owns original plain rejection identity/no orphan',async row=>{const error=Error('original ordinary domain error'),orphans:unknown[]=[];const observe=(e:unknown)=>{orphans.push(e);};process.on('unhandledRejection',observe);try{const f=await fixture(row,async()=>{throw error;});await expect(f.invoke()).rejects.toBe(error);await turn();expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);}finally{process.off('unhandledRejection',observe);}});
it.each(rows)('$method held raw JS Promise token/shutdown with finally own release',async row=>{
 let release!:(v:unknown)=>void;const raw=new NativePromise<unknown>(r=>{release=r;}),expected=dto(row),f=await fixture(row,()=>raw),pending=f.invoke(),owned=pending.then(()=>undefined,()=>undefined);
 try{await turn();expect(f.gate.outstanding).toBe(1);f.gate.close();await expect(f.invoke()).rejects.toThrow();expect(f.calls).toHaveLength(1);release(expected);await expect(pending).resolves.toEqual(expected);expect(await f.gate.drain(1500)).toBe(true);}finally{release(expected);await owned;}
});
it.each(rows)('$method held postawait Main revoke refuses ACK without business rollback claim',async row=>{
 let release!:(v:unknown)=>void;const raw=new NativePromise<unknown>(r=>{release=r;}),expected=dto(row),f=await fixture(row,()=>raw),pending=f.invoke(),owned=pending.then(()=>undefined,()=>undefined);
 try{await turn();f.revoke();release(expected);await expect(pending).rejects.toThrow();expect(f.calls).toHaveLength(1);expect(f.gate.outstanding).toBe(0);}finally{release(expected);await owned;}
});
it.each(rows)('$method constructor validation precedes assimilation; intrinsic raw.then bypass',async row=>{
 let reads=0;const expected=dto(row),raw=NativePromise.resolve(expected);Object.defineProperty(raw,'constructor',{get(){reads++;throw Error('own_ctor');}});const f=await fixture(row,()=>raw);await expect(f.invoke()).rejects.toThrow();expect(reads).toBe(0);
 const normal=NativePromise.resolve(expected);Object.defineProperty(normal,'then',{get(){reads++;throw Error('raw_then');}});const g=await fixture(row,()=>normal);await expect(g.invoke()).resolves.toEqual(expected);expect(reads).toBe(0);
});
for(const outcome of ['fulfill','reject'] as const)for(const tamper of ['getter','value'] as const)it.each(rows)(`$method species ${tamper}/${outcome} preproducer effect0/getter0/unhandled0`,async row=>{
 const f=await fixture(row,async()=>{if(outcome==='reject')throw Error('unstarted native inner');return dto(row);}),desc=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!;let reads=0,pending!:Promise<unknown>;const orphans:unknown[]=[];const observe=(e:unknown)=>{orphans.push(e);};process.on('unhandledRejection',observe);
 try{try{Object.defineProperty(NativePromise,Symbol.species,tamper==='getter'?{configurable:true,get(){reads++;throw Error('species');}}:{configurable:true,value:NativePromise});pending=f.invoke();}finally{Object.defineProperty(NativePromise,Symbol.species,desc);}await expect(pending).rejects.toThrow();await turn();expect(f.calls).toEqual([]);expect(reads).toBe(0);expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);}finally{Object.defineProperty(NativePromise,Symbol.species,desc);process.off('unhandledRejection',observe);}
});
it.each(rows)('$method complete public nullable/status variants, data-only not native authority',async row=>{
 const values=row.goal?[null,dto(row),{...dto(row) as object,currentCompletion:{kind:'protected',state:'publication_pending'}}]:['ready','connected_no_target','not_enabled','failed','disabled_by_user'].map(state=>({state,mcpConnected:state==='ready'||state==='connected_no_target',wrapperReady:true,lastError:'ordinary fixture display'}));
 for(const value of values){const f=await fixture(row,()=>NativePromise.resolve(value));await expect(f.invoke()).resolves.toEqual(value);expect(f.gate.outstanding).toBe(0);}
});

const readSource=(name:string)=>readFileSync(resolve(process.cwd(),name),'utf8');
function bindApi(form:'TS'|'CJS',row:Row,f:Awaited<ReturnType<typeof fixture>>){
 const calls:Array<{channel:string,args:unknown[]}>=[];
 const ipc={invoke:(channel:string,...args:unknown[])=>{if(channel!==row.channel)throw Error('unexpected_consumer_channel');calls.push({channel,args:structuredClone(args)});return f.invoke(structuredClone(args));},on:()=>{},removeListener:()=>{},off:()=>{},send:()=>{throw Error('no_send');}};
 let api:DesktopApi;if(form==='TS')api=createPreloadApi(ipc);else{let captured:DesktopApi|undefined;runInNewContext(readSource('electron/preload.cjs'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:DesktopApi){captured=value;}}};if(name==='os')return os;throw Error('unexpected_preload_dependency');}});if(!captured)throw Error('no_current_api');api=captured;}
 const invoke=()=>{switch(row.method){case'recoverGoalPublication':return api.recoverGoalPublication({threadId:'thread'});case'continueGoalPublication':return api.continueGoalPublication({threadId:'thread'});case'enableComputerUse':return api.enableComputerUse();case'reconnectComputerUse':return api.reconnectComputerUse();case'disableComputerUse':return api.disableComputerUse();}}
 return {api,calls,invoke};
}
for(const form of ['TS','CJS'] as const)it.each(rows)(`${form} $method actual public binding -> real registered protocol/full DTO/error`,async row=>{
 const expected=dto(row),f=await fixture(row,()=>NativePromise.resolve(expected)),binding=bindApi(form,row,f);await expect(binding.invoke()).resolves.toEqual(expected);expect(binding.calls).toEqual([{channel:row.channel,args:f.args()}]);
 const error=Error('public ordinary rejection'),g=await fixture(row,async()=>{throw error;}),failed=bindApi(form,row,g);await expect(failed.invoke()).rejects.toBe(error);expect(g.gate.outstanding).toBe(0);
});
const METHOD_SHA = {"recoverGoalPublication": "2012987bf9b5ba56f00c94f9082bb2a0ee9c5db1974bbece604f1f8dcb6761cb", "continueGoalPublication": "c21e5066f3d7a9959cc0293601d95a70c6aa212dc583bac105974703489f0541", "enableComputerUse": "94e5a490694aab993836c39ab1b3ed71a5080cfa6e032b471a9f59ecb5959246", "reconnectComputerUse": "9fc613f1c4b8466b31fb130aaf9e3d56020eaeb4bd56ed389794683ffa403a51", "disableComputerUse": "2bb38690e1850235ec4064ed3418ee9798159ded9382111b7448684864b24d1f"};
it.each(rows)('$method original real Services complete method body/branch preimage matches exact binding',row=>{
 const text=readSource('electron/desktop-services.ts'),ast=ts.createSourceFile('services.ts',text,ts.ScriptTarget.Latest,true),matches:ts.Node[]=[];
 const visit=(n:ts.Node)=>{if((ts.isPropertyAssignment(n)||ts.isMethodDeclaration(n))&&n.name.getText(ast)===row.method)matches.push(n);ts.forEachChild(n,visit);};visit(ast);expect(matches).toHaveLength(1);
 expect(createHash('sha256').update(matches[0]!.getText(ast)).digest('hex')).toBe(METHOD_SHA[row.method]);
});
function expression(ast:ts.SourceFile,name:string):ts.ArrowFunction{
 const nodes:ts.ArrowFunction[]=[];const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name&&n.initializer){const e=ts.isArrowFunction(n.initializer)?n.initializer:ts.isCallExpression(n.initializer)?n.initializer.arguments[0]:undefined;if(e&&ts.isArrowFunction(e))nodes.push(e);}ts.forEachChild(n,visit);};visit(ast);expect(nodes).toHaveLength(1);return nodes[0]!;
}
for(const form of ['TS','CJS'] as const)for(const outcome of ['data','null','error'] as const)it.each(rows.filter(r=>r.goal))(`${form} $method original GoalBar callback/runGoalAttempt/applyGoal ${outcome}`,async row=>{
 const expected=outcome==='null'?null:dto(row),error=Error('ordinary publication failure'),f=await fixture(row,async()=>{if(outcome==='error')throw error;return expected;}),{api,calls}=bindApi(form,row,f);
 const text=readSource('renderer/src/components/ChatShell.tsx'),ast=ts.createSourceFile('ChatShell.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callbacks:ts.ArrowFunction[]=[];
 const attr=row.method==='recoverGoalPublication'?'onRecoverPublication':'onContinuePublication';const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(ast)===attr&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression))callbacks.push(n.initializer.expression);ts.forEachChild(n,visit);};visit(ast);expect(callbacks).toHaveLength(1);
 const names=['currentAttempt','beginGoalAttempt','applyGoal','runGoalAttempt','runGoalMutation'];const code=names.map(name=>'const '+name+'=('+expression(ast,name).getText(ast)+');').join('\n')+';return ('+callbacks[0]!.getText(ast)+');';
 const renderScope={taskId:'thread'},liveRenderScope={current:renderScope},goalAttemptRef={current:null};const lastGood=dto(row);let goal:unknown=lastGood,clears=0;const errors:unknown[]=[],loading:boolean[]=[];
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const action=compileFunction(js,['getDesktopApi','taskId','renderScope','liveRenderScope','goalAttemptRef','setGoal','setGoalLoading','setGoalError','clearCancelledTaskPresentation','sanitizeUserFacingErrorMessage','t'])(()=>api,'thread',renderScope,liveRenderScope,goalAttemptRef,(fn:(previous:unknown)=>unknown)=>{goal=fn(goal);},(v:boolean)=>{loading.push(v);},(v:unknown)=>{errors.push(v);},()=>{clears++;},sanitizeUserFacingErrorMessage,en) as ()=>Promise<void>;
 await expect(action()).resolves.toBeUndefined();expect(calls).toEqual([{channel:row.channel,args:[{threadId:'thread'}]}]);expect(goal).toEqual(outcome==='error'?lastGood:expected);expect(errors).toEqual(outcome==='error'?[null,sanitizeUserFacingErrorMessage(error,en.chatShell.taskCreateFailed)]:[null]);expect(loading).toEqual([true,false]);expect(clears).toBe(0);expect(f.gate.outstanding).toBe(0);
});
for(const form of ['TS','CJS'] as const)for(const state of ['ready','connected_no_target','failed'] as const)it.each(rows.filter(r=>!r.goal&&r.method!=='disableComputerUse'))(`${form} $method actual ChatShell computer-use action maps ${state} status`,async row=>{
 const value={state,mcpConnected:state!=='failed',wrapperReady:true,lastError:'ordinary CUA display failure'},f=await fixture(row,()=>NativePromise.resolve(value)),{api,calls}=bindApi(form,row,f);
 const text=readSource('renderer/src/components/ChatShell.tsx'),ast=ts.createSourceFile('ChatShell.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),arrow=expression(ast,'handleComputerUseAction');
 const js=ts.transpileModule('return ('+arrow.getText(ast)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const updates:Array<{id:string;patch:unknown}>=[];const action=compileFunction(js,['api','resolveComputerUseUserAction','updateComputerUseActionMessage','t'])(api,resolveComputerUseUserAction,(id:string,patch:unknown)=>{updates.push({id,patch});},en) as (id:string,action:{actionType:string;code:string})=>Promise<void>;
 await action('message',{actionType:row.method==='enableComputerUse'?'enable_computer_use':'reconnect_computer_use',code:row.method==='enableComputerUse'?'COMPUTER_USE_NEEDS_ENABLEMENT':'COMPUTER_USE_MCP_CONNECT_TIMEOUT'});
 expect(calls).toEqual([{channel:row.channel,args:[]}]);expect(updates).toEqual([{id:'message',patch:{status:'working',detail:en.chatShell.cuProcessing}},{id:'message',patch:state==='ready'?{status:'ready',detail:en.chatShell.cuReady}:state==='connected_no_target'?{status:'idle',detail:en.chatShell.cuConnectedNoTarget}:{status:'failed',detail:value.lastError}}]);expect(f.gate.outstanding).toBe(0);
});
it('disable retains public bridge no-arg forwarder; no mounted UI caller claimed',()=>{const text=readSource('renderer/src/api/bridge.ts');expect(text).toContain('async disableComputerUse() {\n    return window.xiaokDesktop.disableComputerUse();\n  }');});

it('exact original producer/public nullable Goal and full CUA DTO signatures (owner strict still required)',()=>{
 type Services=ReturnType<typeof createDesktopServices>;
 expectTypeOf<Parameters<Services['recoverGoalPublication']>[0]>().toEqualTypeOf<{threadId:string;requestSource:'user'|'agent'|'scheduler'}>();
 expectTypeOf<ReturnType<Services['recoverGoalPublication']>>().toEqualTypeOf<Promise<DesktopGoalProjection|null>>();
 expectTypeOf<ReturnType<Services['continueGoalPublication']>>().toEqualTypeOf<Promise<DesktopGoalProjection|null>>();
 expectTypeOf<ReturnType<Services['enableComputerUse']>>().toEqualTypeOf<Promise<ComputerUseCapabilityStatusView>>();
 expectTypeOf<ReturnType<Services['reconnectComputerUse']>>().toEqualTypeOf<Promise<ComputerUseCapabilityStatusView>>();
 expectTypeOf<ReturnType<Services['disableComputerUse']>>().toEqualTypeOf<Promise<ComputerUseCapabilityStatusView>>();
 expectTypeOf<Parameters<DesktopApi['recoverGoalPublication']>[0]>().toEqualTypeOf<{threadId:string}>();
 expectTypeOf<Parameters<DesktopApi['continueGoalPublication']>[0]>().toEqualTypeOf<{threadId:string}>();
 expectTypeOf<Parameters<DesktopApi['enableComputerUse']>>().toEqualTypeOf<[]>();
 expectTypeOf<Parameters<DesktopApi['reconnectComputerUse']>>().toEqualTypeOf<[]>();
 expectTypeOf<Parameters<DesktopApi['disableComputerUse']>>().toEqualTypeOf<[]>();
});

// Additional ordinary DATA consumer controls; never true publication/native permission receipts.
function publicationRoot(api:DesktopApi,row:Row,lastGood:DesktopGoalProjection){
 const text=readSource('renderer/src/components/ChatShell.tsx'),ast=ts.createSourceFile('ChatShell.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callbacks:ts.ArrowFunction[]=[];
 const attr=row.method==='recoverGoalPublication'?'onRecoverPublication':'onContinuePublication';
 const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(ast)===attr&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression))callbacks.push(n.initializer.expression);ts.forEachChild(n,visit);};visit(ast);expect(callbacks).toHaveLength(1);
 const names=['currentAttempt','beginGoalAttempt','applyGoal','runGoalAttempt','runGoalMutation'];
 const code=names.map(name=>'const '+name+'=('+expression(ast,name).getText(ast)+');').join('\n')+';return ('+callbacks[0]!.getText(ast)+');';
 const renderScope={taskId:'thread'},liveRenderScope:{current:unknown}={current:renderScope},goalAttemptRef:{current:unknown}={current:null};
 let goal:DesktopGoalProjection|null=lastGood;const errors:unknown[]=[],loading:boolean[]=[];
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const run=compileFunction(js,['getDesktopApi','taskId','renderScope','liveRenderScope','goalAttemptRef','setGoal','setGoalLoading','setGoalError','clearCancelledTaskPresentation','sanitizeUserFacingErrorMessage','t'])(()=>api,'thread',renderScope,liveRenderScope,goalAttemptRef,(fn:(previous:DesktopGoalProjection|null)=>DesktopGoalProjection|null)=>{goal=fn(goal);},(v:boolean)=>loading.push(v),(v:unknown)=>errors.push(v),()=>{throw Error('publication_callback_must_not_clear_task');},sanitizeUserFacingErrorMessage,en) as ()=>Promise<void>;
 return {run,retire(kind:'scope'|'attempt'){if(kind==='scope')liveRenderScope.current={taskId:'new-thread'};else goalAttemptRef.current=null;},snapshot:()=>({goal,errors,loading})};
}
for(const form of ['TS','CJS'] as const)for(const retire of ['scope','attempt'] as const)for(const outcome of ['fulfill','reject'] as const)it.each(rows.filter(r=>r.goal))(`${form} $method actual stale ${retire} ${outcome} retains last-good/errors after await`,async row=>{
 const lastGood=dto(row) as DesktopGoalProjection;let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;
 const raw=new NativePromise<unknown>((yes,no)=>{resolve=yes;reject=no;});const f=await fixture(row,()=>raw),binding=bindApi(form,row,f),root=publicationRoot(binding.api,row,lastGood);
 const pending=root.run(),owned=pending.then(()=>undefined,()=>undefined);
 try{await turn();expect(f.calls).toHaveLength(1);root.retire(retire);if(outcome==='fulfill')resolve(dto(row));else reject(Error('ordinary_stale_publication_rejection'));await expect(pending).resolves.toBeUndefined();expect(root.snapshot().goal).toBe(lastGood);expect(root.snapshot().errors).toEqual([null]);expect(root.snapshot().loading).toEqual([true]);expect(f.gate.outstanding).toBe(0);}finally{resolve(dto(row));await owned;}
});
for(const form of ['TS','CJS'] as const)it.each(rows.filter(r=>r.goal))(`${form} $method actual functional setter preserves newer same-Goal revision`,async row=>{
 const lastGood=dto(row) as DesktopGoalProjection;lastGood.state.revision=8;
 const older={...lastGood,state:{...lastGood.state,revision:7}},f=await fixture(row,()=>NativePromise.resolve(older)),binding=bindApi(form,row,f),root=publicationRoot(binding.api,row,lastGood);
 await expect(root.run()).resolves.toBeUndefined();expect(root.snapshot().goal).toBe(lastGood);expect(root.snapshot().errors).toEqual([null]);expect(root.snapshot().loading).toEqual([true,false]);expect(f.gate.outstanding).toBe(0);
});
for(const form of ['TS','CJS'] as const)it.each(rows.filter(r=>r.goal))(`${form} $method all original Goal optional fields and protected DISPLAY variants roundtrip`,async row=>{
 const base=dto(row) as DesktopGoalProjection;
 const complete:DesktopGoalProjection={state:{...base.state,forkedFromGoalId:'scripted-fork',completionCriterion:'scripted criterion',terminalReason:'scripted display',pendingCompletionIntentId:'scripted-intent',blockerFingerprint:'scripted-blocker',budgetLimits:{...base.state.budgetLimits,tokenLimit:100,activeWallClockLimitMs:20000}},activation:'disarmed',waitingReason:'waiting_children',currentCompletion:{kind:'ordinary'}};
 for(const state of ['binding_required','binding_pending','binding_mismatch','needs_revalidation','publication_pending','verified'] as const){const value:DesktopGoalProjection={...complete,currentCompletion:{kind:'protected',state}};const f=await fixture(row,()=>NativePromise.resolve(value)),binding=bindApi(form,row,f);await expect(binding.invoke()).resolves.toEqual(value);expect(f.gate.outstanding).toBe(0);}
});
