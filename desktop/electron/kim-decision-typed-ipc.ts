import {z} from 'zod';
import type {KimDecisionRuntime} from '../../src/ai/kim/runtime.js';
import {KIM_CONFIG_PATCH_SCHEMA,KIM_CONFIG_VIEW_SCHEMA,KIM_HEALTH_VIEW_SCHEMA} from '../shared/kim-decision-ipc-contract.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {registerIpcHandler} from './ipc-runtime.js';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
export function registerKimDecisionIpc(ipc:IpcHandleRegistrar,runtime:KimDecisionRuntime,authorize:(event:unknown)=>boolean){
 const registrar:IpcHandleRegistrar={handle(channel,listener){ipc.handle(channel,async(event,...args)=>{if(!authorize(event))throw Error('kim_config_user_required');return listener(event,...args);});}};
 const base={registrar,payloadMode:'tuple' as const,sourceFile:'desktop/electron/kim-decision-typed-ipc.ts',rolloutRound:21 as const};
 const capture=(s:z.ZodTypeAny)=>z.unknown().transform(v=>s.parse(captureIpcData(v,'kim_config_input_invalid')));
 registerIpcHandler({...base,channel:'desktop:getKimDecisionConfig',input:capture(z.tuple([])),output:KIM_CONFIG_VIEW_SCHEMA,riskTags:['fs-read'],handler:async()=>runtime.view()});
 registerIpcHandler({...base,channel:'desktop:saveKimDecisionConfig',input:capture(z.tuple([KIM_CONFIG_PATCH_SCHEMA])),output:KIM_CONFIG_VIEW_SCHEMA,riskTags:['fs-read','fs-write-userData','internal-mutation'],handler:async(args)=>runtime.save(args[0],'user')});
 registerIpcHandler({...base,channel:'desktop:testKimDecisionConnection',input:capture(z.tuple([])),output:KIM_HEALTH_VIEW_SCHEMA,riskTags:['fs-read','network'],handler:async()=>runtime.health()});
}
