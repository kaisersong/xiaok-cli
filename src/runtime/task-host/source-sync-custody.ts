/** Internal custody plumbing. This context confers no filesystem permission,
 * Native membership, writer readiness or task receipt. */
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,has=WeakMap.prototype.has,apply=Reflect.apply;
const create=Object.create,freeze=Object.freeze;
export type SourceSyncSdkKind='current'|'lock-enter'|'mkdir'|'stat'|'string'|'void'|'boolean'|'clock'|'random'|'uuid'|'fd-open'|'fd-open-read'|'fd-read'|'fd-stat'|'fd-close'|'rename-temp'|'link'|'lock-release'|'db-open'|'db-exec'|'db-close'|'db-method'|'db-open-state'|'db-transaction'|'pid-live'|'callable'|'unlink-temp'|'stale-unlink';
type Consumer=(key:object,kind:SourceSyncSdkKind,method:Function,args:unknown[],receiver:unknown)=>unknown;
const owners=new WeakMap<object,Consumer>(),contexts=new WeakMap<object,{owner:object;key:object}>();
export function registerSourceSyncCustodyOwner(owner:object,consumer:Consumer):void{
 if(apply(has,owners,[owner]))throw Error('SOURCE_SYNC_OWNER_ALREADY_REGISTERED');
 apply(set,owners,[owner,consumer]);
}
export function createSourceSyncCustodyContext(owner:object,key:object):object{
 if(!apply(has,owners,[owner]))throw Error('SOURCE_SYNC_OWNER_REQUIRED');
 const context=freeze(create(null));apply(set,contexts,[context,{owner,key}]);return context;
}
export function assertSourceSyncCustodyContext(context:unknown):void{
 if(!context||typeof context!=='object'||!apply(has,contexts,[context]))throw Error('SOURCE_SYNC_CONTEXT_REQUIRED');
}
const currentNoop=()=>undefined;
export function assertSourceSyncCustodyCurrent(context:unknown):void{
 invokeSourceSyncSdk(context,'current',currentNoop,[]);
}
export function invokeSourceSyncSdk(context:unknown,kind:SourceSyncSdkKind,method:Function,args:unknown[],receiver?:unknown):unknown{
 const record=context&&typeof context==='object'?apply(get,contexts,[context]) as {owner:object;key:object}|undefined:undefined;
 if(!record)throw Error('SOURCE_SYNC_CONTEXT_REQUIRED');
 const consumer=apply(get,owners,[record.owner]) as Consumer|undefined;if(!consumer)throw Error('SOURCE_SYNC_OWNER_REQUIRED');
 // The actual Store rechecks its private key before consulting any arguments.
 return consumer(record.key,kind,method,args,receiver);
}
