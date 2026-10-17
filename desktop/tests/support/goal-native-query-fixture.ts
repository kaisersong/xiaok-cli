// Proposed fixture only. Calls original registrar/whole public getter, never full Services startup.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { FileGoalNativeJournal, type GoalNativeMutation } from '../../../src/runtime/goal/native-mutation-journal.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';

// Extract unchanged actual Main authorizers, not a handwritten permission reimplementation.
export function actualQueryAuthorizers(main: unknown, recorder: unknown, services: unknown) {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const coarse = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke');
  let finer: ts.PropertyAssignment | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === 'registerDesktopIpc') {
      const options = n.arguments[3];
      if (options && ts.isObjectLiteralExpression(options)) for (const p of options.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(ast) === 'multiAgentAuthorize') finer = p;
      }
    }
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (!coarse || !finer) throw Error('actual_main_authorizer_source_missing');
  const js = ts.transpileModule(`let mainWindow=main;let meetingRecorderController=recorder;\n${coarse.getText(ast)}\nreturn {coarse:authorizeDesktopInvoke,finer:${finer.initializer.getText(ast)}};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const dirname = resolve('dist/main/desktop/electron'), rendererFile = join(dirname, '../../../renderer/index.html');
  // Shared immutable configuration snapshot for both original authorizer bodies.
  // Does not mutate process.env or replace the production trust predicate.
  const processSnapshot={env:{...process.env}};
  const devServer=processSnapshot.env['XIAOK_DESKTOP_DEV_SERVER'];
  return compileFunction(js, ['main','recorder','services','isTrustedDesktopRendererUrl','join','__dirname','rendererFile','devServer','process'])(
    main,recorder,services,isTrustedDesktopRendererUrl,join,dirname,rendererFile,devServer,processSnapshot);
}

/** Scripted journal history, not a live native enrollment, application or approval receipt. */
export function queryRecord(id='summary'): GoalNativeMutation {
  return {id, revision:1, sessionId:'thread', kind:'create', previous:null,
    target:{version:1,kind:'goal',sessionId:'thread',goalId:'goal',epoch:1,objective:'Original query',completionCriterion:null,expectedEvidenceKinds:['answer']},
    turnLimit:3,definition:{version:1,obligations:[{obligationId:'original',predicateId:'exact-content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]},
    enrollmentRequestId:`${id}-enrollment`,applicationRequestId:`${id}-application`,status:'reserved',createdAt:1000,updatedAt:1000};
}
export async function queryFixture(withJournal=true) {
  const root=mkdtempSync(join(tmpdir(),'goal-query-component-'));
  const store=new SqliteGoalStore(join(root,'goals.db'));
  const journal=new FileGoalNativeJournal(root);
  // Unused dependency sentinels throw; never success/noop, grant or fake producer identity.
  let forbiddenHostCalls=0;
  const forbidden=async (): Promise<never> => { forbiddenHostCalls++; throw Error('query_must_not_call_task_host'); };
  const coordinator=new DesktopGoalCoordinator({store,...(withJournal?{nativeJournal:journal}:{}),taskHost:{prepareTask:forbidden,startTask:forbidden,cancelTask:forbidden},instanceId:'query-unit-instance',now:()=>1000});
  const frame={url:pathToFileURL(resolve('dist/renderer/index.html')).href};
  const target=Object.assign(new EventEmitter(),{id:1,mainFrame:frame,isDestroyed:()=>false,send:()=>{throw Error('query_must_not_publish');}});
  const recorder=Object.assign(new EventEmitter(),{id:2,mainFrame:frame,isDestroyed:()=>false});
  const window=Object.assign(new EventEmitter(),{webContents:target,isDestroyed:()=>false});
  // Extract the entire original Services property expression, never rebuild its body.
  // Erased factory return-type fixture cast below is NOT complete Services qualification.
  const source=readFileSync(new URL('../../electron/desktop-services.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('desktop-services.ts',source,ts.ScriptTarget.Latest,true);
  const matches:ts.PropertyAssignment[]=[];
  const find=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='getGoalNativeMutation')matches.push(node);ts.forEachChild(node,find);};find(ast);
  if(matches.length!==1)throw Error('actual_service_query_expression_population_changed');
  const js=ts.transpileModule(`return (${matches[0]!.initializer.getText(ast)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const getGoalNativeMutation=compileFunction(js,['goalCoordinator'])(coordinator) as DesktopGoalCoordinator['getGoalNativeMutation'];
  const services={multiAgent:undefined,getDataRoot:()=>root,getGoalNativeMutation};
  const authority=actualQueryAuthorizers(window,{ownsWebContents:(sender:unknown)=>sender===recorder},services);
  const gate=new DesktopShutdownGate(), listeners=new Map<string,IpcHandlerListener>(), disposers:Array<()=>void>=[];
  const registrar=new ShutdownAwareIpcMain({handle:(channel,handler)=>listeners.set(channel,handler)},gate,authority.coarse);
  try {
    await registerDesktopIpc(registrar,window as never,services as never,{multiAgentAuthorize:authority.finer,registerLifetimeDisposer:fn=>disposers.push(fn)});
  } catch(error) { store.close(); rmSync(root,{recursive:true,force:true}); throw error; }
  const file=join(root,createHash('sha256').update('thread').digest('hex')+'.native-goal.json');
  const write=(records:unknown[])=>writeFileSync(file,JSON.stringify({version:1,sessionId:'thread',records}));
  const event={sender:target,senderFrame:frame};
  const invoke=(args:unknown[]=[{threadId:'thread'}],source:unknown=event)=>Reflect.apply(listeners.get('desktop:goal:getNativeMutation')!,undefined,[source,...args]) as Promise<unknown>;
  const close=async()=>{
    gate.close(); coordinator.stopAccepting();
    const ipcDrained=await gate.drain(1500),queryDrained=await coordinator.drainShutdown(1500);
    if(!ipcDrained||!queryDrained) throw Error('query_fixture_actual_drain_incomplete');
    for(const dispose of disposers) dispose();
    store.close(); rmSync(root,{recursive:true,force:true});
  };
  return {root,store,journal,coordinator,gate,listeners,services,authority,frame,target,recorder,event,invoke,file,write,close,forbiddenHostCalls:()=>forbiddenHostCalls};
}

/** Original input parser for isolated negative transport controls, not a reimplementation. */
export function actualQueryParser() {
 const source=readFileSync(new URL('../../electron/ipc.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('ipc.ts',source,ts.ScriptTarget.Latest,true);
 const thread=ast.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='parseGoalThreadId');
 const candidates:ts.ArrowFunction[]=[];
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='parseGoalPublicationInput'&&n.initializer&&ts.isArrowFunction(n.initializer))candidates.push(n.initializer);ts.forEachChild(n,visit);};visit(ast);
 if(!thread||candidates.length!==1)throw Error('actual_query_parser_population_changed');
 const js=ts.transpileModule(`${thread.getText(ast)};return (${candidates[0]!.getText(ast)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return compileFunction(js,[])() as (input:unknown)=>{threadId:string};
}
