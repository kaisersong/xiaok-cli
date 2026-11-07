import {invokeSourceSyncSdk,type SourceSyncSdkKind} from '../../../runtime/task-host/source-sync-custody.js';
import {types} from 'node:util';
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy;
/** A context is custody of the original Task Store's SDK results, never a
 * filesystem grant. Invalid supplied contexts cannot fall back to legacy IO. */
export function sessionReadSdk(context:object|undefined,kind:SourceSyncSdkKind,method:Function,args:unknown[],receiver?:unknown):any {
 if(context===undefined)return apply(method,receiver,args);
 // File identities can exceed the exact Number range on Windows.
 const originalArgs=kind==='stat'||kind==='fd-stat'?[args[0],{bigint:true}]:args;
 return invokeSourceSyncSdk(context,kind,method,originalArgs,receiver);
}
export function sessionReadStatKind(stat:any,kind:'file'|'directory'|'symlink'):boolean {
 const mode=stat.mode,mask=typeof mode==='bigint'?mode&0o170000n:mode&0o170000;
 return mask===(typeof mode==='bigint'?(kind==='file'?0o100000n:kind==='directory'?0o040000n:0o120000n):(kind==='file'?0o100000:kind==='directory'?0o040000:0o120000));
}
export function sessionReadMissing(error:unknown):boolean {
 if(!error||typeof error!=='object'||isProxy(error))return false;
 const row=descriptor(error,'code');return !!row&&own(row,'value')&&row.value==='ENOENT';
}
