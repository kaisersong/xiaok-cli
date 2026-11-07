import {sessionReadSdk,sessionReadStatKind} from './source-read-sdk.js';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync} from 'node:fs';
const MAX_BYTES=16*1024*1024;function fail(reason:string):never{throw Error(`session_delete_compound_${reason}`);}
export function readCompoundDeletionBytes(file:string,remaining=MAX_BYTES,context?:object):Buffer {
 const before=sessionReadSdk(context,'stat',lstatSync,[file,{bigint:true}]);
 if(!sessionReadStatKind(before,'file')||sessionReadStatKind(before,'symlink')||before.size>BigInt(remaining))fail('budget');
 const fd=sessionReadSdk(context,'fd-open-read',openSync,[file,constants.O_RDONLY|constants.O_NOFOLLOW]);
 let bodyFailure:{error:unknown}|undefined,result!:Buffer;
 try{
  const stat=sessionReadSdk(context,'fd-stat',fstatSync,[fd]);if(!sessionReadStatKind(stat,'file')||stat.size>remaining)fail('budget');
  const opened=sessionReadSdk(context,'fd-stat',fstatSync,[fd,{bigint:true}]);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeNs!==before.mtimeNs)fail('changed');
  const bytes=Buffer.alloc(stat.size+1);let size=0;
  while(size<bytes.length){const n=sessionReadSdk(context,'fd-read',readSync,[fd,bytes,size,bytes.length-size,null]);if(!n)break;size+=n;}
  const after=sessionReadSdk(context,'fd-stat',fstatSync,[fd,{bigint:true}]),path=sessionReadSdk(context,'stat',lstatSync,[file,{bigint:true}]);
  if(size!==stat.size||size>remaining||after.size!==before.size||after.mtimeNs!==before.mtimeNs||path.dev!==before.dev||path.ino!==before.ino||path.size!==before.size||path.mtimeNs!==before.mtimeNs)fail('changed');result=bytes.subarray(0,size);
 }catch(error){bodyFailure={error};}
 try{sessionReadSdk(context,'fd-close',closeSync,[fd]);}catch(error){if(bodyFailure)throw new AggregateError([bodyFailure.error,error],'session_read_and_close_failed',{cause:bodyFailure.error});throw error;}
 if(bodyFailure)throw bodyFailure.error;return result;
}