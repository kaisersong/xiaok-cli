import {createLoopBusinessPublicationHost,consumeLoopCompletedRun,type LoopCompletionRequest} from './loop-business-publication-host.js';
import type {LoopStore} from './loop-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
/** Fixed host composition for one read decision. It never trusts a cached DTO. */
export async function readLoopCompletedRun(store:LoopStore,input:LoopCompletionRequest,taskPort?:{recoverTask(taskId:string):Promise<TaskSnapshot|undefined>}):Promise<boolean>{
 const rawSignal=input&&typeof input==='object'?Object.getOwnPropertyDescriptor(input,'signal')?.value:undefined;
 const signal=rawSignal instanceof AbortSignal?rawSignal:undefined;
 const host=createLoopBusinessPublicationHost({store,taskPort,assertAdmission(){signal?.throwIfAborted();}});
 try{
  const ticket=await host.prepareCompletedRun(input);
  consumeLoopCompletedRun(store,input,ticket);
  return true;
 }catch{signal?.throwIfAborted();return false;}
 finally{void host.close().catch(()=>{});}
}
