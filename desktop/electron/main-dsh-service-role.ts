import {readOriginalMainDshServicesBinding} from './desktop-services.js';
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,freeze=Object.freeze;
type Role='runtime'|'control_recovery';
const roles=new WeakMap<object,Readonly<{sources:object;role:Role}>>();
/** Narrows one original Services lifetime. A role never grants Native or SDK
 * permission; failed/closed lifetimes keep the same claim permanently. */
export function claimOriginalMainDshServiceRole(services:unknown,sources:unknown,role:Role):void {
 readOriginalMainDshServicesBinding(services,sources);
 if(role!=='runtime'&&role!=='control_recovery')throw Error('DSH_MAIN_SERVICE_ROLE_REQUIRED');
 const prior=apply(get,roles,[services]) as Readonly<{sources:object;role:Role}>|undefined;
 if(prior){if(prior.sources!==sources||prior.role!==role)throw Error('DSH_MAIN_SERVICE_ROLE_CONFLICT');return;}
 apply(set,roles,[services,freeze({sources:sources as object,role})]);
}
