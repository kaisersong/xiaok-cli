export interface OriginalWorkflowScriptWorkerOrigin {
 readonly scriptHash:string;
 readonly executionContext:object;
 claim(script:string):void;
 assertCurrent():void;
 assertLocal():void;
 bindRuntime(reference:object):void;
 waitControllerPhysicalKnown():Promise<void>;
}
const rows=new WeakMap<object,()=>OriginalWorkflowScriptWorkerOrigin>(),apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
/** Passive fixed-member lookup. Worker code imports no Main/Store/Source SDK. */
export function readOptionalWorkflowScriptWorkerOrigin(controller:unknown):OriginalWorkflowScriptWorkerOrigin|null {
 const read=apply(get,rows,[controller]) as (()=>OriginalWorkflowScriptWorkerOrigin)|undefined;return read?read():null;
}
/** No caller origin, callback, verifier or known flag can populate this map. */
export async function cacheOriginalWorkflowScriptWorkerOrigin(controller:object):Promise<void>{
 apply(set,rows,[controller,()=>{throw Error('WORKFLOW_WORKER_ORIGIN_PENDING');}]);
 const source=await import('./original-workflow-root-source.js'),read=source.readOriginalWorkflowScriptWorkerOrigin;read(controller);
 apply(set,rows,[controller,()=>read(controller)]);
}
