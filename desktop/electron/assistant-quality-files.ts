import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {writeFileAtomicallySync} from '../../src/utils/atomic-file.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {createProtectedChildCallbackCustody} from './protected-child-callback-custody.js';
type HeldFile={fd:number;attempted:boolean;closed:boolean};
// A thrown close has unknown pre/post-call state. Keep the original row, and do
// not retry a numeric fd that another owner could have acquired in the meantime.
const heldFiles=new Set<HeldFile>();
/** Picker paths stay Main-owned. This inventories this port's real file IO and
 * callback metadata only; it is not a filesystem namespace or OS qualification. */
export function createAssistantQualityFilePorts(input:{chooseSave:()=>Promise<string|null>;chooseOpen:()=>Promise<string|null>}){
 const native={open:openSync,close:closeSync,stat:fstatSync,lstat:lstatSync,read:readSync,save:writeFileAtomicallySync};
 const stock=createRoomTurnCustody(),callbacks=createProtectedChildCallbackCustody(),files=new Set<HeldFile>(),flights=new Set<Promise<unknown>>(),errors:unknown[]=[];
 let unreturned:Function|undefined;let sealed=false,first:{raw:unknown}|undefined,closing:Promise<void>|undefined;
 const failure=(raw:unknown)=>{first??={raw};errors.push(raw);stock.inventory(raw);};
 const current=()=>{if(first)throw first.raw;if(sealed)throw Error('assistant_quality_files_closed');};
 function io<T>(fn:Function,args:unknown[],negative=false):T{
  try{callbacks.capture(fn);if(!negative)callbacks.assertPhysicalKnown();const result=callbacks.invoke(fn,undefined,args);if(!negative)callbacks.assertPhysicalKnown();return result as T;}
  catch(raw){if(fn===native.open){unreturned=fn;stock.inventory(fn);}failure(raw);throw raw;}
 }
 function closeFile(row:HeldFile){
  if(row.closed||row.attempted)return;row.attempted=true;
  const result=io<unknown>(native.close,[row.fd],true);
  if(result!==undefined){const error=Error('assistant_quality_close_unconfirmed',{cause:result});failure(error);throw error;}
  row.closed=true;files.delete(row);heldFiles.delete(row);
 }
 function start<T>(work:()=>Promise<T>):Promise<T>{
  const promise=(async()=>{current();return work();})();flights.add(promise);void promise.then(()=>flights.delete(promise),()=>flights.delete(promise));return promise;
 }
 return {
  open(maxBytes:number):Promise<string|null>{return start(async()=>{
   if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4_000_000)throw Error('assistant_quality_file_limit');
   const file=await stock.sdk<string|null>(input.chooseOpen,input,[]);current();if(file===null)return null;
   const before=io<ReturnType<typeof lstatSync>>(native.lstat,[file]);if(!before||!before.isFile()||before.isSymbolicLink()||before.size>maxBytes)throw Error('assistant_quality_file_invalid');
   const row:HeldFile={fd:io<number>(native.open,[file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)]),attempted:false,closed:false};files.add(row);heldFiles.add(row);let primary:{raw:unknown}|undefined;let output:string;
   try{const held=io<ReturnType<typeof fstatSync>>(native.stat,[row.fd]);if(held.dev!==before.dev||held.ino!==before.ino||held.size>maxBytes)throw Error('assistant_quality_file_changed');
    const bytes=Buffer.alloc(maxBytes+1);let length=0;
    while(length<bytes.length){const count=io<number>(native.read,[row.fd,bytes,length,bytes.length-length,null]);if(count===0)break;length+=count;}
    const after=io<ReturnType<typeof fstatSync>>(native.stat,[row.fd]);if(length>maxBytes||held.size!==after.size||held.mtimeMs!==after.mtimeMs)throw Error('assistant_quality_file_changed');
    output=bytes.subarray(0,length).toString('utf8');
   }catch(raw){primary={raw};}
   try{closeFile(row);}catch(raw){primary??={raw};}
   if(primary)throw primary.raw;return output!;
  });},
  save(contents:string,assertCurrent:()=>void):Promise<boolean>{return start(async()=>{
   if(typeof contents!=='string'||Buffer.byteLength(contents)>4_000_000)throw Error('assistant_quality_file_limit');
   const file=await stock.sdk<string|null>(input.chooseSave,input,[]);current();if(file===null)return false;
   assertCurrent();io(native.save,[file,contents]);return true;
  });},
  close():Promise<void>{
   sealed=true;if(closing)return closing;
   closing=(async()=>{
    while(flights.size)await Promise.allSettled([...flights]);
    for(const row of files)try{closeFile(row);}catch{/* Retained original failures; attempt every other owned row. */}
    let inventory:{raw:unknown}|undefined;for(const join of [()=>stock.drain(),()=>callbacks.waitPhysicalKnown()])try{await join();}catch(raw){inventory??={raw};}
    if(first||inventory||files.size||unreturned){const error=new AggregateError([...errors,...(inventory?[inventory.raw]:[])],'assistant_quality_file_close_unconfirmed',{cause:first?first.raw:inventory?.raw});if(files.size||unreturned)Object.defineProperty(error,'unconfirmedIO',{value:[...(unreturned?[{producer:unreturned}]:[]),...[...files].map(row=>({fd:row.fd,consumer:native.close}))]});throw error;}
   })();return closing;
  },
 };
}
