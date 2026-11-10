import type { TaskCreateInput } from '../../src/runtime/task-host/types.js';
import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import type { DatabaseSync } from 'node:sqlite';
import type { InProcessTaskRuntimeHost } from '../../src/runtime/task-host/task-runtime-host.js';
import type { NativeActor, CodexNativeService } from './codex-native-service.js';
import type { CodexOrdinaryWriter } from './codex-ordinary-writer.js';
import { assertOriginalCodexBridgeLifecycle } from './codex-task-bridge.js';

type State={db:DatabaseSync;native:CodexNativeService;host:InProcessTaskRuntimeHost;writer:CodexOrdinaryWriter;closing:boolean;writeCurrent():void;authorize(actor?:NativeActor):void;options:{admitThread?:(id:string,current:()=>void)=>Promise<void|(()=>void)>;beforeStartTask?:(task:Awaited<ReturnType<InProcessTaskRuntimeHost['prepareTask']>>,actor:NativeActor,current:()=>void)=>Promise<void>|void};actor:NativeActor;runs:Map<string,unknown>;creations:Set<Promise<unknown>>;quiescence?:Promise<void>;disposal?:Promise<void>};
function state(owner:unknown):State {assertOriginalCodexBridgeLifecycle(owner);return owner as State;}
export function beginCodexBridgeShutdown(owner:unknown):void {
  const s=state(owner);if(s.closing)return;s.closing=true;
  const failures:unknown[]=[];
  try{s.host.stopAccepting();}catch(raw){failures.push(raw);s.writer.fail(raw);}
  try{s.host.abortAllActive();}catch(raw){failures.push(raw);s.writer.fail(raw);}
  try{s.native.beginShutdown();}catch(raw){failures.push(raw);s.writer.fail(raw);}
  if(failures.length)throw failures[0];
}
export function quiesceCodexBridgeShutdown(owner:unknown):Promise<void> {
  const s=state(owner);if(s.quiescence)return s.quiescence;
  let beginFailure:{raw:unknown}|undefined;
  s.quiescence=Promise.resolve().then(async()=>{
    const results=await Promise.allSettled([Promise.resolve().then(()=>s.native.quiesceShutdown()),(async()=>{
      while(s.creations.size)await Promise.allSettled([...s.creations]);await s.host.drain();
    })()]);
    const errors=results.flatMap(r=>r.status==='rejected'?[r.reason]:[]);
    if(beginFailure)errors.unshift(beginFailure.raw);
    for(const raw of errors)s.writer.fail(raw);
    if(errors.length)throw new AggregateError(errors,'codex_bridge_shutdown_unconfirmed');
  });
  try{beginCodexBridgeShutdown(owner);}catch(raw){beginFailure={raw};s.writer.fail(raw);}
  return s.quiescence;
}
export function drainCodexBridge(owner:unknown,deadlineMs:number):Promise<boolean> {
  state(owner);if(!Number.isFinite(deadlineMs)||deadlineMs<=0)return Promise.resolve(false);
  return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),deadlineMs);
    void quiesceCodexBridgeShutdown(owner).then(()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);});});
}
export function disposeCodexBridge(owner:unknown):Promise<void> {
  const s=state(owner);if(s.disposal)return s.disposal;
  s.disposal=Promise.resolve().then(async()=>{
    await quiesceCodexBridgeShutdown(owner);await s.native.dispose();
    try{await s.writer.waitKnown();s.writer.stock.syncVoid(s.db.close,s.db,[]);s.writer.closed();}catch(raw){s.writer.fail(raw);throw raw;}
  });
  try{beginCodexBridgeShutdown(owner);}catch(raw){s.writer.fail(raw);}
  return s.disposal;
}

export async function stopCodexThread(owner:unknown,threadId:string){
    const service=state(owner);
    for(const row of service.db.prepare('SELECT task_id FROM routes WHERE thread_id=?').all(threadId)){if(service.runs.has(String(row.task_id)))await service.host.cancelTask(String(row.task_id),'user_deleted_thread');}
    const nativeId=service.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id;
    if(nativeId)await service.native.disconnect(service.actor,String(nativeId));
  }
export async function stopCodexForRevocation(owner:unknown){const service=state(owner);service.host.abortAllActive();await service.host.drain();}

export async function createCodexTask(owner:unknown,input:TaskCreateInput,actor?:NativeActor,current?:()=>void){
  const service=state(owner);

    const assertCurrent=()=>{service.authorize(actor);assertBeforeEffects(current);service.authorize(actor);service.writeCurrent();};
    assertCurrent();const threadId=input.context?.threadId;if(!threadId)throw new Error('native_thread_required');
    const revalidate=await service.options.admitThread?.(threadId,assertCurrent);
    const admitted=()=>{assertCurrent();if(revalidate)assertBeforeEffects(revalidate);assertCurrent();};
    admitted();
    const task=await service.host.prepareTask(input);
    let startCalled=false;
    try {
      admitted();const taskId=task.taskId;service.writeCurrent();const statement=service.db.prepare('INSERT INTO routes VALUES (?,?)');service.writeCurrent();statement.run(taskId,threadId);
      await service.options.beforeStartTask?.(task,actor!,admitted);admitted();
      startCalled=true;await service.host.startTask(task.taskId);
    }catch(primary){
      try{await service.host.cancelTask(task.taskId,startCalled?'native_start_failed':'admission_revoked');}
      catch(cleanup){throw new AggregateError([primary,cleanup],startCalled?'native_start_and_cancel_failed':'native_preparation_and_cancel_failed');}
      throw primary;
    }
    return task;
}
