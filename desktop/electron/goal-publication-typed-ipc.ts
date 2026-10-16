// Original semantic transport/public data contract; business and native authority unchanged.
import type { IpcMainInvokeEvent } from 'electron';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopGoalProjection } from './desktop-goal-coordinator.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { GOAL_PUBLICATION_OUTPUT, PUBLICATION_METHODS } from '../shared/publication-cua-ipc-contract.js';
type Services = Pick<ReturnType<typeof createDesktopServices>, 'recoverGoalPublication' | 'continueGoalPublication'>;
type Input = {threadId:string;requestSource:'user'};
const NativePromise=Promise, nativeThen=Promise.prototype.then, apply=Reflect.apply;
const witness=new NativePromise<void>(resolve=>resolve());
export function registerGoalPublicationIpc(ipc:IpcHandleRegistrar,services:Services,parseOriginal:(input:unknown)=>Input,authorize:(event:IpcMainInvokeEvent)=>void):void{
 const capture=(raw:DesktopGoalProjection|null):DesktopGoalProjection|null=>{const data=captureIpcData(raw,'goal_publication_projection_unavailable');if(!GOAL_PUBLICATION_OUTPUT.safeParse(data).success)throw Error('goal_publication_projection_unavailable');return data;};
 for(const method of PUBLICATION_METHODS){
  registerIpcHandler<[Input],DesktopGoalProjection|null>({registrar:ipc,channel:method==='recoverGoalPublication'?'desktop:goal:recoverPublication':'desktop:goal:continuePublication',payloadMode:'tuple',rolloutRound:37,sourceFile:'desktop/electron/goal-publication-typed-ipc.ts',riskTags:['fs-read','fs-write','network'],
   beforeInput:e=>{authorize(e);return undefined;},beforeOutput:e=>{authorize(e);return undefined;},
   input:z.custom<[Input]>(()=>true).transform((raw):[Input]=>{const data=captureIpcData(raw,'invalid_goal_publication_input');if(!Array.isArray(data)||data.length!==1||!Object.hasOwn(data,'0'))throw Error('invalid_goal_publication_input');return [parseOriginal(data[0])];}),
   handler:args=>{assertStandardIpcPromise(witness,'goal_publication_projection_unavailable');const raw=services[method](args[0]);assertStandardIpcPromise(raw,'goal_publication_projection_unavailable');return new NativePromise<DesktopGoalProjection|null>((resolve,reject)=>apply(nativeThen,raw,[(value:DesktopGoalProjection|null)=>{try{resolve(capture(value));}catch(error){reject(error);}},reject]));},
   captureOutput:capture,output:GOAL_PUBLICATION_OUTPUT,
  });
 }
}
