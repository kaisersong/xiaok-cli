// @vitest-environment node
// R34 ordinary UI source callbacks + real registered API. Not mounted/SDK/native authority.
import * as os from 'node:os';
import { compileFunction,runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/goal-pause-cancel',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:()=>{}},clipboard:{},dialog:{},shell:{}}));
import { createPreloadApi,type DesktopApi } from '../../electron/preload-api.js';
import type { DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { createGoalState,reduceGoal } from '../../../src/runtime/goal/reducer.js';
import { sanitizeUserFacingErrorMessage } from '../../renderer/src/lib/error-display.js';
import { en } from '../../renderer/src/locales/en.js';
import { methods,pauseCancelFixture,source,type Method } from '../support/goal-pause-cancel-fixture.js';
const NativePromise=Promise,turn=()=>new NativePromise<void>(r=>setImmediate(r));
const cleanup:Array<()=>Promise<void>>=[];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(async()=>{const errors:unknown[]=[];try{for(const close of cleanup.splice(0)){try{await close();}catch(e){errors.push(e);}}}finally{vi.restoreAllMocks();}if(errors.length)throw new AggregateError(errors,'root_fixture_cleanup_failed');});
function rootConsumer(api:DesktopApi,method:Method,last:DesktopGoalProjection){
 const text=source('renderer/src/components/ChatShell.tsx'),ast=ts.createSourceFile('ChatShell.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const wanted=['currentAttempt','beginGoalAttempt','applyGoal','runGoalAttempt','runGoalMutation'] as const;
 const expressions=new Map<string,ts.ArrowFunction>();const callbacks:ts.ArrowFunction[]=[];
 const visit=(n:ts.Node)=>{
  if(ts.isVariableDeclaration(n)&&wanted.some(name=>name===n.name.getText(ast))&&n.initializer){
   const expr=ts.isArrowFunction(n.initializer)?n.initializer:ts.isCallExpression(n.initializer)?n.initializer.arguments[0]:undefined;
   if(!expr||!ts.isArrowFunction(expr)||expressions.has(n.name.getText(ast)))throw Error('original_guard_expression_population_changed');expressions.set(n.name.getText(ast),expr);
  }
  if(ts.isJsxAttribute(n)&&n.name.getText(ast)===(method==='pause'?'onPause':'onCancel')&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression))callbacks.push(n.initializer.expression);
  ts.forEachChild(n,visit);
 };visit(ast);expect(expressions.size).toBe(5);expect(callbacks).toHaveLength(1);
 const renderScope={taskId:'thread',attachmentObservers:new Set<()=>void>()};
 const liveRenderScope:{current:unknown}={current:renderScope},goalAttemptRef:{current:unknown}={current:null};
 let goal:DesktopGoalProjection|null=last,clears=0,applies=0;
 const loading:boolean[]=[],errors:Array<string|null>=[];
 const code=wanted.map(name=>'const '+name+'=('+expressions.get(name)!.getText(ast)+');').join('\n')+';return ('+callbacks[0]!.getText(ast)+');';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const action=compileFunction(js,['getDesktopApi','taskId','renderScope','liveRenderScope','goalAttemptRef','setGoal','setGoalLoading','setGoalError','clearCancelledTaskPresentation','sanitizeUserFacingErrorMessage','t'])(
  ()=>api,'thread',renderScope,liveRenderScope,goalAttemptRef,
  (update:(previous:DesktopGoalProjection|null)=>DesktopGoalProjection|null)=>{applies++;goal=update(goal);},
  (v:boolean)=>{loading.push(v);},(v:string|null)=>{errors.push(v);},()=>{clears++;},sanitizeUserFacingErrorMessage,en,
 ) as ()=>Promise<void>;
 return {action,state:()=>({goal,clears,applies,loading:[...loading],errors:[...errors]}),staleScope:()=>{liveRenderScope.current={taskId:'other'};},staleAttempt:()=>{goalAttemptRef.current={scope:renderScope};}};
}
const scenarios=['current-success','current-error','stale-scope-success','stale-attempt-success','stale-scope-error','stale-attempt-error'] as const;
for(const form of ['TS','CJS'] as const)for(const scenario of scenarios)it.each(methods)(`${form} %s real root guards ${scenario} preserve last-good/error/after-await intent`,async method=>{
 const state=createGoalState({sessionId:'thread',objective:'Scripted ordinary UI last good',expectedEvidenceKinds:['answer'],now:100});
 const last:DesktopGoalProjection={state,activation:'disarmed',currentCompletion:{kind:'ordinary'}};
 const dto:DesktopGoalProjection={state:reduceGoal(state,{type:method,reason:method==='pause'?'user_paused':'user_cancelled',now:101}),activation:'disarmed',currentCompletion:{kind:'ordinary'}};
 let fulfill!:(v:DesktopGoalProjection)=>void,reject!:(e:unknown)=>void;
 const raw=new NativePromise<DesktopGoalProjection>((yes,no)=>{fulfill=yes;reject=no;});
 // Plain producer is ordinary registered-transport fault/held data, not fake real business success.
 const f=await pauseCancelFixture({[method]:()=>raw});cleanup.push(f.close);
 const calls:Array<{channel:string,args:unknown[]}>=[];
 const ipc={invoke:(channel:string,...args:unknown[])=>{if(channel!=='desktop:goal:pause'&&channel!=='desktop:goal:cancel')throw Error('unexpected_root_wire');calls.push({channel,args:structuredClone(args)});return f.invoke(channel.endsWith(':pause')?'pause':'cancel',structuredClone(args));},on:()=>{},removeListener:()=>{},off:()=>{},send:()=>{throw Error('unexpected_root_send');}};
 let api:DesktopApi;if(form==='TS')api=createPreloadApi(ipc);else{let captured:DesktopApi|undefined;runInNewContext(source('electron/preload.cjs'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:DesktopApi){captured=value;}}};if(name==='os')return os;throw Error('unexpected_preload_dependency');}});if(!captured)throw Error('missing_current_api');api=captured;}
 const ui=rootConsumer(api,method,last),failure=Error('ordinary root owned failure');
 const result=ui.action(),owned=result.then(()=>undefined,()=>undefined);
 try{
  await turn();expect(calls).toEqual([{channel:'desktop:goal:'+method,args:[{threadId:'thread'}]}]);expect(f.effects()).toBe(1);expect(f.gate.outstanding).toBe(1);
  expect(ui.state()).toEqual({goal:last,clears:0,applies:0,loading:[true],errors:[null]});
  if(scenario.startsWith('stale-scope'))ui.staleScope();if(scenario.startsWith('stale-attempt'))ui.staleAttempt();
  if(scenario.endsWith('error'))reject(failure);else fulfill(dto);
  // Real runGoalAttempt catches current errors; stale completion must not alter new intent.
  await expect(result).resolves.toBeUndefined();
  if(scenario==='current-success')expect(ui.state()).toEqual({goal:dto,clears:1,applies:1,loading:[true,false],errors:[null]});
  else if(scenario==='current-error')expect(ui.state()).toEqual({goal:last,clears:0,applies:0,loading:[true,false],errors:[null,sanitizeUserFacingErrorMessage(failure,en.chatShell.taskCreateFailed)]});
  else expect(ui.state()).toEqual({goal:last,clears:0,applies:0,loading:[true],errors:[null]});
  expect(f.forbiddenCalls()).toBe(0);expect(f.gate.outstanding).toBe(0);
 }finally{fulfill(dto);await owned;}
});
