import type {IpcMainInvokeEvent} from 'electron';
import {z} from 'zod';
import type {DshDesktopApi,DshDesktopState} from '../../src/shared/dsh-desktop.js';
import {DSH_SETTINGS_STATE,DSH_SET_MODE,DSH_CONFIGURE_SETUP,DSH_CONNECT,DSH_SOURCE_ACTION,DSH_CONFIGURE_BUDGET,DSH_PUBLISH_MANDATE,DSH_PUBLISH_EGRESS_POLICY} from '../shared/dsh-settings-ipc-contract.js';
import {registerIpcHandler} from './ipc-runtime.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import type {MainDshControlSource,MainDshControlFrame} from './main-dsh-control-source.js';
type Mutation='setMode'|'configureSetup'|'connect'|'disconnect'|'reconcile'|'configureBudget'|'publishMandate'|'publishEgressPolicy';
export type DshSettingsController={getState():Promise<DshDesktopState>} & {[K in Mutation]:(event:IpcMainInvokeEvent,input:Parameters<DshDesktopApi[K]>[0])=>Promise<DshDesktopState>};
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,remove=WeakMap.prototype.delete,NativeError=Error,freeze=Object.freeze,keys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor;
function immutable<T>(value:T):T{if(value&&typeof value==='object'){const names=keys(value);for(let i=0;i<names.length;i++)immutable(descriptor(value,names[i]!)!.value);freeze(value);}return value;}
/** Fixed public status before the complete production profile qualifies.
 * Does not construct Sources, touch storage, inspect secrets or start timers. */
export function registerUnavailableDshSettingsIpc(ipc:IpcHandleRegistrar):void {
 const state: DshDesktopState=immutable({schemaVersion:1,executionQualified:false,availability:'unavailable',domain:null,modes:[],setups:[],sources:[],lastErrorCode:'DSH_P4_NOT_QUALIFIED'});
 for(const action of ['getState','setMode','configureSetup','connect','disconnect','reconcile','configureBudget','publishMandate','publishEgressPolicy'] as const){
  registerIpcHandler<unknown[],DshDesktopState>({registrar:ipc,channel:'desktop:dsh:'+action,payloadMode:'tuple',input:z.custom<unknown[]>(()=>true),output:DSH_SETTINGS_STATE,rolloutRound:39,sourceFile:'desktop/electron/dsh-settings-typed-ipc.ts',riskTags:[],handler:async(args)=>{if(action!=='getState')throw new NativeError('DSH_P4_NOT_QUALIFIED');if(args.length!==0)throw new NativeError('DSH_SETTINGS_INPUT_INVALID');return state;}});
 }
}
/** Semantic whitelist only. No caller selects a Source, path, actor or SQL. */
export function registerDshSettingsIpc(ipc:IpcHandleRegistrar,controller:DshSettingsController,source:MainDshControlSource):void {
 const deliveries=new WeakMap<object,MainDshControlFrame>();
 const entries=[['getState',z.tuple([])],['setMode',z.tuple([DSH_SET_MODE])],['configureSetup',z.tuple([DSH_CONFIGURE_SETUP])],['connect',z.tuple([DSH_CONNECT])],['disconnect',z.tuple([DSH_SOURCE_ACTION])],['reconcile',z.tuple([DSH_SOURCE_ACTION])],['configureBudget',z.tuple([DSH_CONFIGURE_BUDGET])],['publishMandate',z.tuple([DSH_PUBLISH_MANDATE])],['publishEgressPolicy',z.tuple([DSH_PUBLISH_EGRESS_POLICY])]] as const;
 for(const [action,input] of entries){
  registerIpcHandler<unknown[],DshDesktopState>({registrar:ipc,channel:'desktop:dsh:'+action,payloadMode:'tuple',inputStage:'afterHostAuthorization',wireInput:z.custom<unknown[]>(()=>true),input,output:DSH_SETTINGS_STATE,rolloutRound:39,sourceFile:'desktop/electron/dsh-settings-typed-ipc.ts',riskTags:action==='getState'?[]:['network','fs-write','capability-token'],
   handler:async(args,event,helpers)=>{
    const frame=source.open(event,'policy_control',{schemaVersion:1,action,input:args},'user');helpers!.onFailure(()=>frame.release());
    try{
     const parsed=helpers!.parseInput(captureIpcData(args));
     const raw=action==='getState'?await controller.getState():await apply(controller[action],controller,[event,parsed[0]]);
     const state=immutable(captureIpcData(DSH_SETTINGS_STATE.parse(captureIpcData(raw)))) as DshDesktopState;frame.assertCurrent();apply(set,deliveries,[state,frame]);return state;
    }catch{frame.release();throw new NativeError('DSH_SETTINGS_OPERATION_FAILED');}
   },
   captureOutput(raw){const frame=apply(get,deliveries,[raw]) as MainDshControlFrame|undefined;if(!frame)throw new NativeError('DSH_SETTINGS_REPLY_UNVERIFIED');const state=immutable(captureIpcData(DSH_SETTINGS_STATE.parse(captureIpcData(raw)))) as DshDesktopState;apply(remove,deliveries,[raw]);apply(set,deliveries,[state,frame]);return state;},
   afterOutputValidation(state){const frame=apply(get,deliveries,[state]) as MainDshControlFrame|undefined;if(!frame)throw new NativeError('DSH_SETTINGS_REPLY_UNVERIFIED');apply(remove,deliveries,[state]);try{frame.assertCurrent();}finally{frame.release();}return undefined;},
  });
 }
}
