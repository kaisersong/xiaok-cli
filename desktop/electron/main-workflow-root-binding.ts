import type {OriginalMainWorkflowAdmissionPort} from './main-room-root-admission.js';
const bindings=new WeakMap<object,()=>OriginalMainWorkflowAdmissionPort>();
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
/** Passive lookup for the ordinary tool path: this module imports no Native,
 * Electron, Room owner, verifier or SDK at module load. */
export function readOptionalOriginalMainWorkflowAdmission(service:unknown):OriginalMainWorkflowAdmissionPort|null {
    const read=apply(get,bindings,[service]) as (()=>OriginalMainWorkflowAdmissionPort)|undefined;
    return read?read():null;
}
/** This takes no port/callback/boolean. It can cache only the fixed original
 * owner's already-published private binding, and re-reads it on every use. */
export async function cacheOriginalMainWorkflowAdmission(service:object):Promise<void> {
    // Publish a negative/pending fence before the first loader SDK. A failed
    // bind must never make the ordinary fallback appear available again.
    apply(set,bindings,[service,()=>{throw Error('ROOT_RESOURCE_WORKFLOW_BINDING_PENDING');}]);
    const original=await import('./main-room-root-admission.js');
    const read=original.readOriginalMainWorkflowAdmission;
    read(service);
    apply(set,bindings,[service,()=>read(service)]);
}
