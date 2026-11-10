import {z} from 'zod';
import type {IpcMainInvokeEvent} from 'electron';
import type {IpcHandleRegistrar} from '../shutdown-aware-ipc-main.js';
import {registerIpcHandler} from '../ipc-runtime.js';
import {DesktopInputQueue} from './input-queue.js';
import type {NativeActor} from '../codex-native-service.js';
import {expandSelectedMaterialPaths} from '../material-selection.js';
const key=z.string().min(1).max(256);
const item=z.object({inputId:key,prompt:z.string(),unavailable:z.boolean().optional(),status:z.enum(['pending','claimed','unknown']),sequence:z.number().int(),revision:z.number().int(),materialCount:z.number().int(),prepared:z.boolean()}).strict();
const queueView=z.object({conversationId:key,items:z.array(item).max(20),failedInput:z.object({inputId:key,prompt:z.string(),sequence:z.number().int(),unavailable:z.boolean().optional()}).strict().nullable().optional(),pauseReason:z.enum(['unknown_execution','execution_authorization_changed','input_unavailable']).nullable(),currentTaskId:key.nullable()}).strict();
/** Same Main actor before data parsing and after every original await/output. */
export function registerContinuityInputIpc(registrar:IpcHandleRegistrar,queue:DesktopInputQueue|undefined,actor:(event:IpcMainInvokeEvent)=>NativeActor){
 const register=<I,O extends object>(channel:string,input:z.ZodType<I>,output:z.ZodType<O>,work:(input:I,user:NativeActor,check:()=>void)=>Promise<O>)=>{
  const replies=new WeakMap<IpcMainInvokeEvent,{user:NativeActor;result:O}>();let finalReply:{event:IpcMainInvokeEvent;user:NativeActor;result:O}|undefined;
  const source=()=>{if(!queue)throw Error('input_queue_unavailable');return queue;};
  const check=(event:IpcMainInvokeEvent,user:NativeActor,result?:O)=>{if(actor(event).actorId!==user.actorId)throw Error('task_actor_forbidden');if(result)source().assertReply(result,user);};
  registerIpcHandler({registrar,channel,input,output,sourceFile:'context-continuity/input-ipc.ts',rolloutRound:3,riskTags:['internal-mutation'],
   beforeInput:event=>{actor(event);source();return undefined;},handler:async(value,event)=>{const user=actor(event),result=await work(value,user,()=>check(event,user));check(event,user,result);replies.set(event,{user,result});return result;},
   beforeOutput:event=>{const reply=replies.get(event);if(!reply)throw Error('input_queue_proof_unavailable');check(event,reply.user,reply.result);finalReply={event,...reply};return undefined;},
   afterOutputValidation:result=>{const reply=finalReply;finalReply=undefined;if(!reply||result!==reply.result)throw Error('input_queue_proof_unavailable');replies.delete(reply.event);check(reply.event,reply.user,reply.result);return undefined;},
  });
 };
 register('desktop:inputs:enqueue',z.object({inputId:key,conversationId:key,prompt:z.string().min(1).max(1024*1024),filePaths:z.array(z.string().max(4096)).max(64).optional()}).strict(),z.object({accepted:z.literal(true),inputId:key,conversationId:key,sequence:z.number().int(),taskId:key,sourceEpoch:key}).strict(),async(input,user,check)=>sourceQueue().withUserRequest(user,async()=>{DesktopInputQueue.prototype.assertEnqueueInput.call(sourceQueue(),input,user);const filePaths=await expandSelectedMaterialPaths(input.filePaths??[]);check();DesktopInputQueue.prototype.assertEnqueueInput.call(sourceQueue(),input,user);return sourceQueue().enqueue({...input,filePaths},user);}));
 register('desktop:inputs:list',z.object({conversationId:key}).strict(),queueView,(input,user)=>sourceQueue().list(input,user));
 register('desktop:inputs:cancel',z.object({conversationId:key,inputId:key}).strict(),queueView,(input,user)=>sourceQueue().cancel(input,user));
 function sourceQueue(){if(!queue)throw Error('input_queue_unavailable');return queue;}
}
