import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstatSync, readFileSync, existsSync, unlinkSync, openSync, closeSync, writeFileSync, fsyncSync, linkSync,fstatSync } from 'node:fs';
import {invokeSourceSyncSdk,type SourceSyncSdkKind} from '../../../runtime/task-host/source-sync-custody.js';
import {appendIntrinsic,aggregateIntrinsicErrors} from '../../../runtime/verification/intrinsic-async-collection.js';
import {types} from 'node:util';
const apply=Reflect.apply,get=Reflect.get,parse=JSON.parse,stringify=JSON.stringify,keys=Object.keys,own=Object.hasOwn,descriptor=Object.getOwnPropertyDescriptor,define=Object.defineProperty,isProxy=types.isProxy;
const originalLstat=lstatSync,originalRead=readFileSync,originalExists=existsSync,originalUnlink=unlinkSync,originalOpen=openSync,originalClose=closeSync,originalWrite=writeFileSync,originalSync=fsyncSync,originalLink=linkSync,originalFstat=fstatSync,originalUuid=randomUUID,originalHostname=hostname;
const integer=Number.isSafeInteger,exec=RegExp.prototype.exec;
function call<T>(context:object|undefined,kind:SourceSyncSdkKind,method:Function,args:unknown[],receiver?:unknown):T{return context===undefined?apply(method,receiver,args):invokeSourceSyncSdk(context,kind,method,args,receiver) as T;}
function code(error:unknown,value:string):boolean{if(!error||typeof error!=='object'||isProxy(error))return false;const row=descriptor(error,'code');return !!row&&own(row,'value')&&row.value===value;}
function statKind(stat:any,kind:'file'|'symlink',context?:object){if(context===undefined)return kind==='file'?stat.isFile():stat.isSymbolicLink();const mode=stat.mode;return(typeof mode==='bigint'?mode&0o170000n:mode&0o170000)===(typeof mode==='bigint'?(kind==='file'?0o100000n:0o120000n):(kind==='file'?0o100000:0o120000));}
const requireOptional = createRequire(import.meta.url);
const originalKill=process.kill;
interface SaveLockMarker { version: 1; pid: number; hostname: string; nonce: string }
function readSaveLock(path: string,context?:object) {
  const stat:any = call(context,'stat',originalLstat,[path]);
  if (!statKind(stat,'file',context) || statKind(stat,'symlink',context) || stat.size > 2048) throw new Error('session_save_locked');
  const bytes = call<string>(context,'string',originalRead,[path,'utf8']);
  const after:any=call(context,'stat',originalLstat,[path]);
  if(after.dev!==stat.dev||after.ino!==stat.ino)throw new Error('session_save_locked');
  const marker = parse(bytes) as SaveLockMarker;
  if (!marker || typeof marker!=='object'||keys(marker).length!==4||!own(marker,'version')||!own(marker,'pid')||!own(marker,'hostname')||!own(marker,'nonce')
    || marker.version !== 1 || !integer(marker.pid) || marker.pid < 1
    || marker.hostname !== call(context,'string',originalHostname,[]) || typeof marker.nonce !== 'string'
    || !apply(exec,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,[marker.nonce])) throw new Error('session_save_locked');
  return { stat, bytes, marker };
}
function clearDeadSaveLock(path: string,context?:object) {
  // Optional only for stale-lock recovery. Fresh ordinary saves remain pure JS.
  let database: import('better-sqlite3').Database | undefined;
  let bodyFailure:{error:unknown}|undefined;
  try {
    const Database = call<typeof import('better-sqlite3')>(context,'callable',requireOptional,['better-sqlite3']);
    const cleanupPath = `${path}.cleanup.sqlite`;
    if (call(context,'boolean',originalExists,[cleanupPath]) && statKind(call(context,'stat',originalLstat,[cleanupPath]),'symlink',context)) throw new Error('session_save_locked');
    database = call(context,'db-open',()=>new Database(cleanupPath,{timeout:0}),[]);
    const execute=call<Function>(context,'callable',get,[database,'exec']);call(context,'db-exec',execute,['BEGIN EXCLUSIVE'],database);
    if(context!==undefined)call(context,'db-transaction',get,[database,'inTransaction'],database);
    const previous = readSaveLock(path,context);
    try { call(context,'pid-live',context===undefined?process.kill:originalKill,[previous.marker.pid,0],process); throw new Error('session_save_locked'); }
    catch (error) { if (!code(error,'ESRCH')) throw error; }
    const current = readSaveLock(path,context);
    if (current.stat.ino !== previous.stat.ino || current.stat.dev !== previous.stat.dev || current.bytes !== previous.bytes) throw new Error('session_save_locked');
    call(context,'stale-unlink',originalUnlink,[path,current.stat.dev,current.stat.ino,current.bytes]);
  }catch(error){bodyFailure={error};}
  {
    if(database){const failures:unknown[]=[];
      try{const close=call<Function>(context,'db-method',get,[database,'close'],database);call(context,'db-close',close,[],database);}catch(error){appendIntrinsic(failures,error);}
      if(context!==undefined)try{call(context,'db-open-state',get,[database,'open'],database);}catch(error){appendIntrinsic(failures,error);}
      if(failures.length){const all:unknown[]=[];if(bodyFailure)appendIntrinsic(all,bodyFailure.error);for(let i=0;i<failures.length;i++)appendIntrinsic(all,failures[i]);const failure=aggregateIntrinsicErrors(all,'session_save_recovery_cleanup_failed');define(failure,'cause',{__proto__:null,value:all[0]} as PropertyDescriptor);throw failure;}
    }
  }
  if(bodyFailure)throw bodyFailure.error;
}
const sourceLockEntry=()=>undefined;
export function acquireSaveLock(path: string,context?:object): () => void {
  if(context!==undefined)call(context,'lock-enter',sourceLockEntry,[path]);
  const nonce = call<string>(context,'uuid',originalUuid,[]); const temp = `${path}.${nonce}.tmp`;
  const marker: SaveLockMarker = { version: 1, pid: process.pid, hostname: call(context,'string',originalHostname,[]), nonce };
  let descriptor: number | undefined;
  let bodyFailure:{error:unknown}|undefined;
  let release!:()=>void;
  try {
    descriptor = call<number>(context,'fd-open',originalOpen,[temp,'wx',0o600]);
    if(context!==undefined)call(context,'fd-stat',originalFstat,[descriptor]);
    call(context,'void',originalWrite,[descriptor,stringify(marker),'utf8']);call(context,'void',originalSync,[descriptor]);
    call(context,'fd-close',originalClose,[descriptor]); descriptor = undefined;
    try { call(context,'link',originalLink,[temp,path]); }
    catch (error) {
      if (!code(error,'EEXIST')) throw error;
      try { clearDeadSaveLock(path,context); }
      catch (cleanupError) {
        if (!code(cleanupError,'ENOENT')) throw cleanupError;
      }
      try { call(context,'link',originalLink,[temp,path]); }
      catch (retryError) {
        if (code(retryError,'EEXIST')) throw new Error('session_save_locked');
        throw retryError;
      }
    }
    const owned = readSaveLock(path,context);
    release = () => {
      // Never unlink a replacement lock, including after a failed save.
      if (!call(context,'boolean',originalExists,[path])) return;
      const current = readSaveLock(path,context);
      if (current.marker.nonce === nonce && current.stat.ino === owned.stat.ino && current.stat.dev === owned.stat.dev && current.bytes === owned.bytes)call(context,'lock-release',originalUnlink,[path,current.stat.dev,current.stat.ino,current.bytes]);
    };
  } catch(error){bodyFailure={error};}
  {
    const failures:unknown[]=[];
    try{if (descriptor !== undefined) call(context,'fd-close',originalClose,[descriptor]);}catch(error){appendIntrinsic(failures,error);}
    try{if (context!==undefined)call(context,'unlink-temp',originalUnlink,[temp]);else if (existsSync(temp)) unlinkSync(temp);}catch(error){appendIntrinsic(failures,error);}
    if(failures.length){
      const errors:unknown[]=[];if(bodyFailure)appendIntrinsic(errors,bodyFailure.error);for(let i=0;i<failures.length;i++)appendIntrinsic(errors,failures[i]);
      const failure=aggregateIntrinsicErrors(errors,'session_save_lock_cleanup_failed');define(failure,'cause',{__proto__:null,value:errors[0]} as PropertyDescriptor);throw failure;
    }
  }
  if(bodyFailure)throw bodyFailure.error;
  return release;
}
