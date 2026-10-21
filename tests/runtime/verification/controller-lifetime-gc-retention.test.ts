import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import Native from 'better-sqlite3';
const faults=vi.hoisted(()=>({barrier:undefined as Error|undefined,close:undefined as Error|undefined,native:undefined as WeakRef<import('better-sqlite3').Database>|undefined}));
vi.mock('../../../src/utils/atomic-file.js',async original=>{const actual=await original<typeof import('../../../src/utils/atomic-file.js')>();return {...actual,syncDirectoryTreeStrict(...args:Parameters<typeof actual.syncDirectoryTreeStrict>){if(faults.barrier)throw faults.barrier;return actual.syncDirectoryTreeStrict(...args);}};});
import {acquireControllerLifetimeLock} from '../../../src/runtime/verification/controller-lifetime-lock.js';
const roots:string[]=[],locks:Array<WeakRef<ReturnType<typeof acquireControllerLifetimeLock>>>=[];
const originalClose=Native.prototype.close;
setFlagsFromString('--expose_gc');const collect=runInNewContext('gc') as ()=>void;
async function gc(){for(let i=0;i<12;i++){await nextTurn();collect();await nextTurn();}}
function dir(){const root=mkdtempSync(join(tmpdir(),'controller-lifetime-gc-'));roots.push(root);return root;}
function concurrentOwnerRejected(root:string){let second:ReturnType<typeof acquireControllerLifetimeLock>|undefined,error:unknown;try{second=acquireControllerLifetimeLock(root);}catch(cause){error=cause;}finally{second?.close();}return error!==undefined;}
beforeEach(()=>{faults.barrier=undefined;faults.close=undefined;faults.native=undefined;Native.prototype.close=function(){if(faults.close){faults.native=new WeakRef(this);throw faults.close;}return originalClose.call(this);};});
afterEach(()=>{Native.prototype.close=originalClose;faults.close=undefined;faults.barrier=undefined;for(const weak of locks.splice(0))weak.deref()?.close();const native=faults.native?.deref();if(native?.open)originalClose.call(native);for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('collects the matching unretained real SQLite lifetime and releases its actual OS lock',async()=>{
 const root=dir(),weak=(()=>{const lock=acquireControllerLifetimeLock(root);return new WeakRef(lock);})();
 await gc();expect(weak.deref()).toBeUndefined();expect(concurrentOwnerRejected(root)).toBe(false);
});
it('retains the exact returned lifetime after an actual native close failure through GC',async()=>{
 const root=dir(),failure=Error('native_close_failed');
 const weak=(()=>{const lock=acquireControllerLifetimeLock(root);faults.close=failure;expect(()=>lock.close()).toThrow(failure);faults.close=undefined;return new WeakRef(lock);})();locks.push(weak);
 await gc();expect(weak.deref()).toBeDefined();expect(concurrentOwnerRejected(root)).toBe(true);
 weak.deref()!.close();expect(concurrentOwnerRejected(root)).toBe(false);
});
it('retains the actual BEGIN EXCLUSIVE owner and both failures when initialization cleanup cannot close it',async()=>{
 const root=dir(),original=Error('barrier_failed'),cleanup=Error('native_close_failed');faults.barrier=original;faults.close=cleanup;
 let error:unknown;try{acquireControllerLifetimeLock(root);}catch(cause){error=cause;}
 faults.close=undefined;faults.barrier=undefined;
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(original);expect((error as AggregateError).errors).toEqual([original,cleanup]);
 await gc();expect(faults.native?.deref()).toBeDefined();expect(concurrentOwnerRejected(root)).toBe(true);
});
