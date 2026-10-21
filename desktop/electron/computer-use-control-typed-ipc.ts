// Original semantic transport/public data contract; business and native authority unchanged.
import type { IpcMainInvokeEvent } from 'electron';
import type { createDesktopServices } from './desktop-services.js';
import type { ComputerUseCapabilityStatusView } from './preload-api.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { CUA_CONTROL_METHODS, CUA_CONTROL_OUTPUT } from '../shared/publication-cua-ipc-contract.js';
type Services=Pick<ReturnType<typeof createDesktopServices>, 'enableComputerUse' | 'reconnectComputerUse' | 'disableComputerUse'>;
const NativePromise=Promise,nativeThen=Promise.prototype.then,apply=Reflect.apply;
const witness=new NativePromise<void>(resolve=>resolve());
export function registerComputerUseControlIpc(ipc:IpcHandleRegistrar,services:Services,authorize:(event:IpcMainInvokeEvent)=>void):void{
 const capture=(raw:ComputerUseCapabilityStatusView):ComputerUseCapabilityStatusView=>{const data=captureIpcData(raw,'computer_use_projection_unavailable');if(!CUA_CONTROL_OUTPUT.safeParse(data).success)throw Error('computer_use_projection_unavailable');return data;};
 for(const method of CUA_CONTROL_METHODS){
  registerIpcHandler<[],ComputerUseCapabilityStatusView>({registrar:ipc,channel:'desktop:'+method,payloadMode:'tuple',rolloutRound:37,sourceFile:'desktop/electron/computer-use-control-typed-ipc.ts',riskTags:['fs-read','fs-write','exec','network'],
   beforeInput:e=>{authorize(e);return undefined;},beforeOutput:e=>{authorize(e);return undefined;},
   input:z.custom<[]>(()=>true).transform((raw):[]=>{const data=captureIpcData(raw,'computer_use_input_invalid');if(!z.tuple([]).safeParse(data).success)throw Error('computer_use_input_invalid');return []; }),
   handler:()=>{assertStandardIpcPromise(witness,'computer_use_projection_unavailable');const raw=services[method]({requestSource:'user'});assertStandardIpcPromise(raw,'computer_use_projection_unavailable');return new NativePromise<ComputerUseCapabilityStatusView>((resolve,reject)=>apply(nativeThen,raw,[(value:ComputerUseCapabilityStatusView)=>{try{resolve(capture(value));}catch(error){reject(error);}},reject]));},
   captureOutput:capture,output:CUA_CONTROL_OUTPUT,
  });
 }
}
