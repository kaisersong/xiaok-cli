import {z} from 'zod';
import {captureIpcData} from './ipc-data-snapshot.js';
import {registerIpcHandler} from './ipc-runtime.js';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import type {DefaultDispatchBusinessController,DefaultDispatchDeliveryInvocation} from './default-dispatch-business-controller.js';
import {observeOriginalDefaultDispatchPreparation,type DefaultDispatchPreparationOwner,type DefaultDispatchPreparationObservation} from './default-dispatch-preparation-owner.js';
import {DEFAULT_DISPATCH_CAPTURE_CHANNEL,DEFAULT_DISPATCH_INPUT,DEFAULT_DISPATCH_CAPTURE_OUTPUT,DEFAULT_DISPATCH_OUTPUT,type DefaultDispatchResult,type DefaultDispatchInput} from '../shared/default-dispatch-ipc-contract.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,remove=WeakMap.prototype.delete,freeze=Object.freeze,descriptors=Object.getOwnPropertyDescriptors,keys=Reflect.ownKeys,own=Object.hasOwn;
function freezeClosed<T>(raw:T):T{
 if(raw&&typeof raw==='object'){const fields=descriptors(raw),names=keys(fields);for(let i=0;i<names.length;i++){const key=names[i]!;if(typeof key!=='string')throw Error('DEFAULT_DISPATCH_RESPONSE_INVALID');const row=fields[key]!;if(!own(row,'value'))throw Error('DEFAULT_DISPATCH_RESPONSE_INVALID');freezeClosed(row.value);}freeze(raw);}return raw;
}
function projection(raw:unknown):DefaultDispatchResult{
 return freezeClosed(captureIpcData(DEFAULT_DISPATCH_OUTPUT.parse(captureIpcData(raw,'DEFAULT_DISPATCH_RESPONSE_INVALID')),'DEFAULT_DISPATCH_RESPONSE_INVALID'));
}
function captureProjection(raw:unknown){return freezeClosed(captureIpcData(DEFAULT_DISPATCH_CAPTURE_OUTPUT.parse(captureIpcData(raw,'DEFAULT_DISPATCH_RESPONSE_INVALID')),'DEFAULT_DISPATCH_RESPONSE_INVALID'));}
/** Only the actual renderer event and a project id cross this semantic ingress.
 * Caller DTOs never supply a source, action, plan, actor or dispatch generation. */
export function registerDefaultDispatchIpc(ipc:IpcHandleRegistrar,controller:DefaultDispatchBusinessController,preparationOwner?:DefaultDispatchPreparationOwner):void{
 interface Delivery {invocation:DefaultDispatchDeliveryInvocation;fail(error:unknown):void;release():void}
 const outputs=new WeakMap<object,Delivery>();
 registerIpcHandler<unknown[],DefaultDispatchResult>({registrar:ipc,channel:DEFAULT_DISPATCH_CAPTURE_CHANNEL,payloadMode:'tuple',inputStage:'afterHostAuthorization',
  wireInput:z.custom<unknown[]>(()=>true),input:DEFAULT_DISPATCH_INPUT,output:DEFAULT_DISPATCH_OUTPUT,rolloutRound:39,
  sourceFile:'desktop/electron/default-dispatch-typed-ipc.ts',riskTags:['capability-token','internal-mutation','fs-write'],
  handler:async(args,event,helpers)=>{
   const [input]=helpers!.parseInput(captureIpcData(args,'DEFAULT_DISPATCH_INPUT_INVALID')) as [DefaultDispatchInput];
   const invocation=controller.openCurrentPlan(event,input.projectId,'user');let released=false,failed=false;
   const delivery:Delivery={invocation,fail(error){if(failed)return;failed=true;invocation.fail(error);},release(){if(released)return;released=true;invocation.release();}};
   helpers!.onFailure(error=>{try{delivery.fail(error);}finally{delivery.release();}});
   try{
    const captured=captureProjection(await invocation.run());let value:DefaultDispatchResult=captured;
    if(preparationOwner&&captured.ok){
     try{
      const observed=captureIpcData(await observeOriginalDefaultDispatchPreparation(preparationOwner,controller,invocation)) as readonly DefaultDispatchPreparationObservation[];
      if(observed.length!==captured.operation.children.length)throw Error('DEFAULT_DISPATCH_OBSERVATION_PROJECTION_INVALID');
      const rows=[];for(let i=0;i<observed.length;i++){const actual=observed[i]!,child=captured.operation.children[i]!;if(actual.childKey!==child.childKey)throw Error('DEFAULT_DISPATCH_OBSERVATION_PROJECTION_INVALID');rows.push({childKey:child.childKey,taskId:child.taskId,status:actual.status});}
      value=projection({...captured,preparationObservations:rows});
     }catch{value=projection({...captured,preparationObservationUnavailable:true});}
    }
    apply(set,outputs,[value,delivery]);return value;
   }catch(error){delivery.fail(error);throw error;}
  },
  captureOutput(raw){
   const delivery=apply(get,outputs,[raw]) as Delivery|undefined;if(!delivery)throw Error('DEFAULT_DISPATCH_PROJECTION_UNVERIFIED');
   try{const value=projection(raw);apply(remove,outputs,[raw]);apply(set,outputs,[value,delivery]);return value;}catch(error){delivery.fail(error);throw error;}
  },
  afterOutputValidation(value){
   const delivery=apply(get,outputs,[value]) as Delivery|undefined;if(!delivery)throw Error('DEFAULT_DISPATCH_PROJECTION_UNVERIFIED');apply(remove,outputs,[value]);
   try{delivery.invocation.assertCurrent();}catch(error){delivery.fail(error);throw error;}finally{delivery.release();}
  },
 });
}
