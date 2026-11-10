import {z} from 'zod';
import {captureIpcData} from './ipc-data-snapshot.js';
import {registerIpcHandler} from './ipc-runtime.js';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import type {KSwarmWriterControlService,WriterControlInvocation} from './kswarm-writer-control-service.js';
import {WRITER_CONTROL_INPUT,WRITER_CONTROL_OUTPUT,type WriterControlResult} from '../shared/kswarm-writer-control-ipc-contract.js';
function projection(raw:unknown):WriterControlResult{
 return Object.freeze(captureIpcData(WRITER_CONTROL_OUTPUT.parse(captureIpcData(raw,'WRITER_CONTROL_RESPONSE_INVALID')),'WRITER_CONTROL_RESPONSE_INVALID'));
}
/** Empty semantic calls only; no renderer-provided actor/scope/operation proof. */
export function registerKSwarmWriterControlIpc(ipc:IpcHandleRegistrar,service:KSwarmWriterControlService):void{
 const bindings=[['inspect',service.openInspect.bind(service)],['prepare',service.openPrepare.bind(service)],['migrate',service.openMigrate.bind(service)]] as const;
 for(const [method,open] of bindings){
  const outputs=new WeakMap<object,WriterControlInvocation>(),get=outputs.get.bind(outputs),set=outputs.set.bind(outputs),remove=outputs.delete.bind(outputs);
  registerIpcHandler<unknown[],WriterControlResult>({registrar:ipc,channel:'desktop:kswarm:writer:'+method,payloadMode:'tuple',inputStage:'afterHostAuthorization',
   wireInput:z.custom<unknown[]>(()=>true),input:WRITER_CONTROL_INPUT,output:WRITER_CONTROL_OUTPUT,rolloutRound:38,
   sourceFile:'desktop/electron/kswarm-writer-control-typed-ipc.ts',riskTags:['capability-token','internal-mutation','fs-write'],
   handler:async(args,event,helpers)=>{
    const invocation=open(event,'user');helpers!.onFailure(error=>{try{invocation.fail(error);}finally{invocation.frame.release();}});
    try{helpers!.parseInput(captureIpcData(args,'WRITER_CONTROL_INPUT_INVALID'));}catch(error){invocation.fail(error);throw error;}
    let value:WriterControlResult;try{value=projection(await invocation.run());}catch(error){invocation.fail(error);throw error;}
    // Always a fresh snapshot, even if an SDK erroneously caches its object.
    set(value,invocation);return value;
   },
   captureOutput(raw){
    const invocation=get(raw);if(!invocation)throw Error('WRITER_CONTROL_PROJECTION_UNVERIFIED');
    try{const value=projection(raw);remove(raw);set(value,invocation);return value;}catch(error){invocation.fail(error);throw error;}
   },
   afterOutputValidation(value){
    const invocation=get(value);if(!invocation)throw Error('WRITER_CONTROL_PROJECTION_UNVERIFIED');remove(value);
    try{invocation.frame.assertCurrent();}catch(error){invocation.fail(error);throw error;}finally{invocation.frame.release();}
   },
  });
 }
}
