// Copy to desktop/tests/support. Source-before: no R32 production module imports.
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { DesktopGoalCoordinator, type DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { actualQueryAuthorizers } from './goal-native-query-fixture.js';
export type Method = 'pause' | 'cancel';
export type Producer = (threadId: string) => Promise<DesktopGoalProjection>;
export const methods = ['pause', 'cancel'] as const;
export const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
export function sourceProducer(method: Method, coordinator: DesktopGoalCoordinator): Producer {
  const text = source('electron/desktop-services.ts'), ast = ts.createSourceFile('services.ts', text, ts.ScriptTarget.Latest, true);
  const matches: ts.PropertyAssignment[] = [];
  const visit = (n: ts.Node) => { if (ts.isPropertyAssignment(n) && n.name.getText(ast) === method+'Goal') matches.push(n); ts.forEachChild(n, visit); }; visit(ast);
  if (matches.length !== 1) throw Error('original_pause_cancel_producer_population_changed');
  const js = ts.transpileModule('return ('+matches[0]!.initializer.getText(ast)+');', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return compileFunction(js, ['goalCoordinator'])(coordinator) as Producer;
}
export async function pauseCancelFixture(overrides: Partial<Record<Method, Producer>> = {}) {
  const root = mkdtempSync(join(tmpdir(),'goal-pause-cancel-source-'));
  let ownedStore: SqliteGoalStore | undefined, ownedCoordinator: DesktopGoalCoordinator | undefined, ownedGate: DesktopShutdownGate | undefined;
  const disposers:Array<()=>void>=[];
  let cleanupPromise:Promise<void>|undefined;
  const close=():Promise<void>=>cleanupPromise ??= (async()=>{
    const errors:unknown[]=[];let ipcDrained=!ownedGate,coordinatorDrained=!ownedCoordinator;
    try{ownedGate?.close();ownedCoordinator?.stopAccepting();
      try{if(ownedGate)ipcDrained=await ownedGate.drain(1500);}catch(e){errors.push(e);}
      try{if(ownedCoordinator)coordinatorDrained=await ownedCoordinator.drainShutdown(1500);}catch(e){errors.push(e);}
    }finally{
      for(const dispose of disposers.splice(0)){try{dispose();}catch(e){errors.push(e);}}
      if(ipcDrained&&coordinatorDrained){
        let safelyClosed=!ownedStore;
        try{if(ownedStore){ownedStore.close();safelyClosed=true;}}catch(e){errors.push(e);}
        if(safelyClosed){try{rmSync(root,{recursive:true,force:true});}catch(e){errors.push(e);}}
      }else errors.push(Error('transport_fixture_js_drain_failed; owned store/root retained: '+root));
    }
    if(errors.length)throw new AggregateError(errors,'ordinary_fixture_cleanup_failed: '+root);
  })();
  try {
  const store = ownedStore = new SqliteGoalStore(join(root,'goals.db'));
  let forbiddenCalls=0, effects=0;
  // Unused host sentinels FAIL, never manufacture successful prepare/cancel/ownership.
  const forbidden=async ():Promise<never>=>{forbiddenCalls++;throw Error('unseeded_task_host_not_authorized');};
  const coordinator=ownedCoordinator=new DesktopGoalCoordinator({store,taskHost:{prepareTask:forbidden,startTask:forbidden,cancelTask:forbidden},instanceId:'transport-unit',now:()=>100});
  const frame={url:process.env['XIAOK_DESKTOP_DEV_SERVER'] ?? pathToFileURL(resolve('dist/renderer/index.html')).href};
  let destroyed=false;
  const target=Object.assign(new EventEmitter(),{id:501,mainFrame:frame,isDestroyed:()=>destroyed,send:()=>{throw Error('transport_fixture_must_not_send');}});
  const recorder=Object.assign(new EventEmitter(),{id:502,mainFrame:frame,isDestroyed:()=>false});
  const window=Object.assign(new EventEmitter(),{webContents:target,isDestroyed:()=>false});
  const originalPause=sourceProducer('pause',coordinator),originalCancel=sourceProducer('cancel',coordinator);
  const services={multiAgent:undefined,getDataRoot:()=>root,
    pauseGoal:(id:string)=>{effects++;return (overrides.pause ?? originalPause)(id);},
    cancelGoal:(id:string)=>{effects++;return (overrides.cancel ?? originalCancel)(id);}};
  const auth=actualQueryAuthorizers(window,{ownsWebContents:(s:unknown)=>s===recorder},services);
  const gate=ownedGate=new DesktopShutdownGate(),listeners=new Map<string,IpcHandlerListener>();
  const registrar=new ShutdownAwareIpcMain({handle:(c,h)=>listeners.set(c,h)},gate,auth.coarse);
  await registerDesktopIpc(registrar,window as never,services as never,{multiAgentAuthorize:auth.finer,registerLifetimeDisposer:d=>disposers.push(d)});
  const event={sender:target,senderFrame:frame};
  const invoke=(method:Method,args:unknown[]=[{threadId:'thread'}],sender:unknown=event)=>Reflect.apply(listeners.get('desktop:goal:'+method)!,undefined,[sender,...args]) as Promise<DesktopGoalProjection>;
  // Scripted ordinary Goal data through the real reducer + actual store guard. No profile/route override.
  const seed=async()=>{const state=createGoalState({sessionId:'thread',objective:'Original ordinary Goal',expectedEvidenceKinds:['answer'],turnLimit:3,now:100});await store.commit({sessionId:'thread',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});return state;};

  return {root,store,coordinator,services,gate,listeners,frame,target,recorder,event,invoke,seed,close,effects:()=>effects,forbiddenCalls:()=>forbiddenCalls,revoke:()=>{destroyed=true;}};
  }catch(original){try{await close();}catch(cleanup){throw new AggregateError([original,cleanup],'fixture_init_and_cleanup_failed: '+root);}throw original;}
}
