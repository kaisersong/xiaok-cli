// UNREVIEWED CANDIDATE target desktop/electron/meeting-actions10-typed-ipc.ts
import { types } from 'node:util';
import { z } from 'zod';
import { projectMeeting10Failure,meeting10Rejection } from './meeting-actions10-error-policy.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MEETING_ACTIONS10_METHODS,MEETING_ACTIONS10_INPUT_SCHEMAS,MEETING_ACTIONS10_OUTPUT_SCHEMAS,MEETING_ACTIONS10_LIVE_UPDATE_SCHEMA,type MeetingActions10LiveUpdate } from '../shared/meeting-actions10-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then;
// Private fulfilled witness qualifies ambient descriptors before producer entry.
const preProducerWitness = new NativePromise<void>(resolve => resolve());
const owners = new WeakMap<IpcHandleRegistrar,ReadonlyMap<string,IpcHandlerListener>>();
export function captureMeeting10LiveUpdate(sessionId: unknown, update: unknown): MeetingActions10LiveUpdate {
 const captured = captureIpcData(update,'meeting_actions10_projection_unavailable');
 const updateResult = MEETING_ACTIONS10_LIVE_UPDATE_SCHEMA.omit({sessionId:true}).safeParse(captured);
 if (!updateResult.success) throw Error('meeting_actions10_projection_unavailable');
 const value = {sessionId,...updateResult.data};
 const parsed = MEETING_ACTIONS10_LIVE_UPDATE_SCHEMA.safeParse(value);
 if (!parsed.success) throw Error('meeting_actions10_projection_unavailable');
 return parsed.data;
}
export function registerMeetingActions10Ipc(ipc: IpcHandleRegistrar,producers: ReadonlyMap<string,IpcHandlerListener>): void {
 if(owners.has(ipc)){if(owners.get(ipc)!==producers)throw Error('meeting_actions10_registrar_owner_conflict');return;}
 const bindings = new Map(producers);
 for(const method of MEETING_ACTIONS10_METHODS){
  const channel='desktop:meeting:'+method,output=MEETING_ACTIONS10_OUTPUT_SCHEMAS[method];
  const capture=(raw:unknown)=>{const value=captureIpcData(raw,'meeting_actions10_projection_unavailable');if(!output.safeParse(value).success)throw Error('meeting_actions10_projection_unavailable');const projected=captureIpcData(projectMeeting10Failure(method,value),'meeting_actions10_projection_unavailable');if(!output.safeParse(projected).success)throw Error('meeting_actions10_projection_unavailable');return projected;};
  const risks:RiskTag[]=method==='pickAudioFile'?['dialog']:method.startsWith('live:')?['network','long-subscription']:method==='saveRecordedAudio'?['fs-write']:['fs-read','fs-write'];
  registerIpcHandler<unknown[],unknown>({registrar:ipc,channel,
   input:z.custom<unknown[]>(()=>true).transform(raw=>{const value=captureIpcData(raw,'meeting_actions10_input_invalid',{preserveDataPrototype:true});if(!MEETING_ACTIONS10_INPUT_SCHEMAS[method].safeParse(value).success)throw Error('meeting_actions10_input_invalid');return value;}),
   output,payloadMode:'tuple',rolloutRound:34,riskTags:risks,sourceFile:'desktop/electron/meeting-actions10-typed-ipc.ts',
   handler:async(args,event)=>{
    // The existing ShutdownAwareIpcMain owns the actual Main/Recorder admission
    // before this callback. No payload field can grant source/owner authority.
    const producer=bindings.get(channel);if(!producer)throw Error('meeting_actions10_runtime_unavailable');
    try {
    assertStandardIpcPromise(preProducerWitness,'meeting_actions10_projection_unavailable');
    const result=producer(event,...args);
    if(!types.isPromise(result))return capture(result);
    assertStandardIpcPromise(result,'meeting_actions10_projection_unavailable');
    return await new Promise((resolve,reject)=>Reflect.apply(nativeThen,result,[(value:unknown)=>{try{resolve(capture(value));}catch(error){reject(error);}},reject]));
    } catch(error) { throw meeting10Rejection(error); }
   },
  });
 }
 owners.set(ipc,producers);
}
