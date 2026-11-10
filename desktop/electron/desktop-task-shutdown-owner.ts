import type {createTaskSourceWriterPopulation} from '../../src/runtime/task-host/task-runtime-host.js';
import type {DesktopGoalCoordinator} from './desktop-goal-coordinator.js';
import type {CodexTaskBridge} from './codex-task-bridge.js';
import type {DesktopMultiAgentService} from './desktop-multi-agent-service.js';
import type {KSwarmInitialPlanBootstrapQueue} from './kswarm-initial-plan-bootstrap.js';
import type {IngressOwner,DurableStoreOwner} from './desktop-shutdown-coordinator.js';
/** Main composition over original owners. A caller deadline only observes this
 * one actual drain; it never closes a writer or fabricates physical settlement. */
export function createDesktopTaskShutdownOwner(options:{
 population:ReturnType<typeof createTaskSourceWriterPopulation>;
 goal:DesktopGoalCoordinator;stopGoal():void;closeGoal():Promise<void>;
 codex:CodexTaskBridge;multiAgent?:DesktopMultiAgentService;
 bootstrap:KSwarmInitialPlanBootstrapQueue;finalizeServices():Promise<void>;
 stopAuxiliary?():void;quiesceAuxiliary?():Promise<void>;
}):Readonly<{ingress:IngressOwner;durable:DurableStoreOwner}> {
 const stopFailures:unknown[]=[];
 let stopped=false,drained=false,draining:Promise<boolean>|undefined,closing:Promise<void>|undefined;
 const stop=()=>{
  if(stopped)return;stopped=true;
  for(const work of [options.stopGoal,()=>options.stopAuxiliary?.(),()=>options.bootstrap.stopAccepting(),()=>options.population.stopAccepting('app_shutdown'),()=>options.codex.beginShutdown(),()=>options.multiAgent?.beginShutdown()]){
   try{work();}catch(error){stopFailures.push(error);}
  }
  if(stopFailures.length)throw new AggregateError(stopFailures,'desktop_task_shutdown_stop_unconfirmed');
 };
 const abort=(reason:string)=>{
  const failures:unknown[]=[];for(const work of [()=>options.bootstrap.abortActive(reason),()=>options.population.abortAllActive(reason)]){try{work();}catch(error){stopFailures.push(error);failures.push(error);}}
  if(failures.length)throw new AggregateError(failures,'desktop_task_shutdown_abort_unconfirmed');
 };
 const actualDrain=():Promise<boolean>=>{
  if(draining)return draining;
  draining=Promise.resolve().then(async()=>{
   // External native/core writers may still publish real physical witnesses to
   // Host. Finish those original producers before permanently sealing its tail.
   const external=await Promise.allSettled([options.codex.quiesceShutdown(),options.multiAgent?.quiesceShutdown(),options.quiesceAuxiliary?.(),options.bootstrap.drain()]);
   if(stopFailures.length || external.some(result=>result.status==='rejected') || !options.bootstrap.getHealth().ok)return false;
   if(!await options.population.drainShutdown())return false;
   if(!await options.goal.whenShutdownDrained() || options.multiAgent && !options.multiAgent.isShutdownQuiescent())return false;
   const receipt=options.population.getShutdownDrainedReceipt();
   if(!receipt)return false;
   options.goal.sealNativePersistedTail(receipt);drained=true;return true;
  });
  try{stop();}catch{/* stopFailures already records failure; siblings still stopped. */}
  return draining;
 };
 return Object.freeze({
  ingress:Object.freeze({name:'desktop-task-sources',stopAccepting:stop,abortAllActive:abort,
   drain(deadlineMs:number):Promise<boolean>{
    if(!Number.isFinite(deadlineMs)||deadlineMs<=0)return Promise.resolve(drained);
    return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),deadlineMs);
     void actualDrain().then(result=>{clearTimeout(timer);resolve(result);},()=>{clearTimeout(timer);resolve(false);});});
   }}),
  durable:Object.freeze({name:'desktop-task-sources',close():Promise<void>{
   if(!drained)return Promise.reject(Error('desktop_task_shutdown_not_drained'));
   if(closing)return closing;
   closing=Promise.resolve().then(async()=>{
    const receipt=options.population.getShutdownDrainedReceipt();
    if(!receipt)throw Error('desktop_task_shutdown_not_drained');
    options.population.assertShutdownDrainedReceipt(receipt);
    await options.population.closeAfterShutdown(receipt);await options.finalizeServices();await options.closeGoal();
   });return closing;
  }}),
 });
}
