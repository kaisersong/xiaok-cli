// @vitest-environment node
// R32 source-before candidate. Existing TS/CJS public binding -> actual registrar -> original whole producer.
import * as os from 'node:os';
import { compileFunction, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/goal-pause-cancel',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:()=>{}},clipboard:{},dialog:{},shell:{}}));
import { createPreloadApi, type DesktopApi } from '../../electron/preload-api.js';
import type { DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { methods,pauseCancelFixture,source,type Method } from '../support/goal-pause-cancel-fixture.js';
const cleanup:Array<()=>Promise<void>>=[];
beforeEach(resetIpcSchemaRegistryForTests);afterEach(async()=>{const errors:unknown[]=[];try{for(const f of cleanup.splice(0)){try{await f();}catch(e){errors.push(e);}}}finally{vi.restoreAllMocks();}if(errors.length)throw new AggregateError(errors,'all_fixture_cleanup_failures');});
async function wired(form:'TS'|'CJS'){
 const f=await pauseCancelFixture();cleanup.push(f.close);const calls:Array<{channel:string,args:unknown[]}>=[];
 const ipc={invoke:(channel:string,...args:unknown[])=>{calls.push({channel,args:structuredClone(args)});if(channel!=='desktop:goal:pause'&&channel!=='desktop:goal:cancel')throw Error('unexpected_wire');return f.invoke(channel.endsWith(':pause')?'pause':'cancel',structuredClone(args));},on:()=>{},removeListener:()=>{},off:()=>{},send:()=>{throw Error('unexpected_send');}};
 let api:DesktopApi;
 if(form==='TS')api=createPreloadApi(ipc);else{let captured:DesktopApi|undefined;runInNewContext(source('electron/preload.cjs'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:DesktopApi){captured=value;}}};if(name==='os')return os;throw Error('unexpected_preload_dependency');}});if(!captured)throw Error('missing_current_api');api=captured;}
 return {f,api,calls};
}
for(const form of ['TS','CJS'] as const)it.each(methods)(`${form} %s original string ABI/full DTO through real transport and source-extracted ChatShell callback`,async method=>{
 const {f,api,calls}=await wired(form);await f.seed();
 const text=source('renderer/src/components/ChatShell.tsx'),ast=ts.createSourceFile('ChatShell.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const mutations:ts.ArrowFunction[]=[],applies:ts.ArrowFunction[]=[],callbacks:ts.ArrowFunction[]=[];
 const visit=(n:ts.Node)=>{
  if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='runGoalMutation'&&n.initializer&&ts.isArrowFunction(n.initializer))mutations.push(n.initializer);
  if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='applyGoal'&&n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.arguments[0]&&ts.isArrowFunction(n.initializer.arguments[0]))applies.push(n.initializer.arguments[0]);
  if(ts.isJsxAttribute(n)&&n.name.getText(ast)===(method==='pause'?'onPause':'onCancel')&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression))callbacks.push(n.initializer.expression);
  ts.forEachChild(n,visit);
 };visit(ast);
 expect(mutations).toHaveLength(1);expect(applies).toHaveLength(1);expect(callbacks).toHaveLength(1);
 const code='const applyGoal=('+applies[0]!.getText(ast)+');const runGoalMutation=('+mutations[0]!.getText(ast)+');return ('+callbacks[0]!.getText(ast)+');';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 let goal:DesktopGoalProjection|null=null,clears=0;
 // Ordinary UI state/attempt fixture only; source callbacks retained verbatim. Not mounted/fullUI qualification.
 const action=compileFunction(js,['getDesktopApi','taskId','beginGoalAttempt','runGoalAttempt','currentAttempt','setGoal','clearCancelledTaskPresentation'])(()=>api,'thread',()=>({id:'current'}),async(_attempt:unknown,fn:()=>Promise<void>)=>fn(),()=>true,(update:(previous:DesktopGoalProjection|null)=>DesktopGoalProjection|null)=>{goal=update(goal);},()=>{clears++;}) as ()=>Promise<void>;
 await action();expect(calls).toEqual([{channel:'desktop:goal:'+method,args:[{threadId:'thread'}]}]);
 expect(goal).toMatchObject({state:{sessionId:'thread',status:method==='pause'?'paused':'cancelled'},activation:'disarmed',currentCompletion:{kind:'ordinary'}});expect(clears).toBe(1);expect(f.effects()).toBe(1);expect(f.forbiddenCalls()).toBe(0);expect(f.gate.outstanding).toBe(0);
});
for(const form of ['TS','CJS'] as const)it.each(methods)(`${form} %s public binding retains actual domain rejection/no fabricated success DTO`,async method=>{
 const {f,api}=await wired(form);const action: (id:string)=>Promise<DesktopGoalProjection>=method==='pause'?api.pauseGoal:api.cancelGoal;
 await expect(action('thread')).rejects.toThrow();expect(f.effects()).toBe(1);expect(f.gate.outstanding).toBe(0);
});
