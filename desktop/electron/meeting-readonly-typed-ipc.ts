import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MEETING_READONLY_METHODS, MEETING_READONLY_INPUT_SCHEMA, MEETING_READONLY_OUTPUT_SCHEMAS } from '../shared/meeting-readonly-ipc-contract.js';
const isPromise=types.isPromise,NativePromise=Promise,nativeThen=Promise.prototype.then,apply=Reflect.apply;
const owners=new WeakMap<IpcHandleRegistrar,ReadonlyMap<string,IpcHandlerListener>|null>();
export function registerMeetingReadonlyIpc(ipc:IpcHandleRegistrar,rawProducers?:ReadonlyMap<string,IpcHandlerListener>):void {
 const producers=rawProducers??null;
 if(owners.has(ipc)){if(owners.get(ipc)!==producers)throw Error('meeting_readonly_registrar_owner_conflict');return;}
 for(const method of MEETING_READONLY_METHODS){
  const channel='desktop:meeting:'+method,output=MEETING_READONLY_OUTPUT_SCHEMAS[method];
  const capture=(raw:unknown)=>{const value=captureIpcData(raw,'meeting_readonly_projection_unavailable');if(!output.safeParse(value).success)throw Error('meeting_readonly_projection_unavailable');return value;};
  registerIpcHandler<unknown[],unknown>({registrar:ipc,channel,input:z.custom<unknown[]>(()=>true).transform(raw=>{const value=captureIpcData(raw,'meeting_readonly_input_invalid');if(!MEETING_READONLY_INPUT_SCHEMA.safeParse(value).success)throw Error('meeting_readonly_input_invalid');return value;}),output,payloadMode:'tuple',rolloutRound:33,riskTags:['fs-read'],sourceFile:'desktop/electron/meeting-readonly-typed-ipc.ts',handler:async(args,event)=>{
   const producer=producers?.get(channel);if(!producer)throw Error('meeting_readonly_runtime_unavailable');const result=producer(event,...args);
   if(!isPromise(result))return capture(result);assertStandardIpcPromise(result,'meeting_readonly_projection_unavailable');
   return new NativePromise((resolve,reject)=>apply(nativeThen,result,[(value:unknown)=>{try{resolve(capture(value));}catch(error){reject(error);}},reject]));
  }});
 }
 owners.set(ipc,producers);
}
