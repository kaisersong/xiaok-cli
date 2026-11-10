import {z} from 'zod';
import type {IpcMainInvokeEvent} from 'electron';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import type {SubmissionActor} from './main-user-submission.js';
import {registerIpcHandler} from './ipc-runtime.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {ROOM_CONVERSION_CAPTURE_INPUT,ROOM_CONVERSION_CAPTURE_OUTPUT,ROOM_CONVERSION_CAPTURE_REFERENCE,ROOM_CONVERSION_OBSERVE_INPUT,
 type RoomConversionCaptureOutput,type RoomConversionCaptureReference} from '../shared/room-conversion-input-contract.js';
interface Port {
 captureRoomConversion(raw:unknown,actor:SubmissionActor,recheck:()=>void):Promise<RoomConversionCaptureOutput>;
 observeRoomConversion(captureId:string,actor:SubmissionActor,recheck:()=>void):RoomConversionCaptureReference;
}
/** Native-only semantic input capture; no generic HTTP/proof/binding API. */
export function registerRoomConversionCaptureIpc(ipc:IpcHandleRegistrar,service:Port,authorize:(event:IpcMainInvokeEvent)=>SubmissionActor):void{
 const definitions=[{channel:'desktop:roomConversion:capture',input:ROOM_CONVERSION_CAPTURE_INPUT,output:ROOM_CONVERSION_CAPTURE_OUTPUT,observe:false},
  {channel:'desktop:roomConversion:observe',input:ROOM_CONVERSION_OBSERVE_INPUT,output:ROOM_CONVERSION_CAPTURE_REFERENCE,observe:true}] as const;
 for(const definition of definitions){
  registerIpcHandler<unknown[],RoomConversionCaptureOutput|RoomConversionCaptureReference>({registrar:ipc,channel:definition.channel,payloadMode:'tuple',rolloutRound:38,
   sourceFile:'desktop/electron/room-conversion-typed-ipc.ts',riskTags:definition.observe?['fs-read']:['network','fs-read','fs-write-userData','capability-token'],
   beforeInput:event=>{authorize(event);return undefined;},beforeOutput:event=>{authorize(event);return undefined;},
   input:z.custom<unknown[]>(()=>true).transform(raw=>{const data=captureIpcData(raw,'room_conversion_input_invalid');const result=z.tuple([definition.input]).safeParse(data);if(!result.success)throw Error('room_conversion_input_invalid');return result.data;}),
   output:definition.output,
   handler:async(args,event)=>{
    const actor=authorize(event),recheck=()=>{if(authorize(event).actorId!==actor.actorId)throw Error('task_actor_forbidden');};
    return definition.observe?service.observeRoomConversion((args[0] as {captureId:string}).captureId,actor,recheck):service.captureRoomConversion(args[0],actor,recheck);
   },
   captureOutput:raw=>{const result=definition.output.safeParse(captureIpcData(raw,'room_conversion_projection_unavailable'));if(!result.success)throw Error('room_conversion_projection_unavailable');return result.data;},
  });
 }
}
