import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,fsyncSync,ftruncateSync,lstatSync,openSync,readSync,writeSync} from 'node:fs';
import {dirname} from 'node:path';
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function regular(path) {
 const s=lstatSync(path,{bigint:true});
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n)throw Error('fixture_alias');
 return s;
}
function openRegular(path,flags,before) {
 const fd=openSync(path,flags|(constants.O_NOFOLLOW??0),0o600);
 try {const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||(before&&!same(s,before))||!same(s,regular(path)))throw Error('fixture_alias');return fd;}
 catch(error){closeSync(fd);throw error;}
}
/** Closed QA fixtures only. Caller must prove all DB/PID/epoch close ACKs;
 * this is not an OS mandatory lock or a backup tool for an active SQLite DB. */
export function restoreClosedFixture({source,target,expectedSha256,assertQuiescent}) {
 const began=performance.now(),cpuStart=process.cpuUsage();
 if(typeof assertQuiescent!=='function'||!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('fixture_arguments');
 assertQuiescent();
 const original=regular(source);let previous;
 try{previous=regular(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&same(original,previous))throw Error('fixture_alias');
 const from=openRegular(source,constants.O_RDONLY,original);
 let fromClosed=false,to,bytesCompared=0,bytesWritten=0,targetReadBytes=0;
 try {
  to=openRegular(target,previous?constants.O_RDWR:constants.O_RDWR|constants.O_CREAT|constants.O_EXCL,previous);
  const working=fstatSync(to,{bigint:true});
  if(same(original,working))throw Error('fixture_alias');
  const expected=Buffer.allocUnsafe(1048576),actual=Buffer.allocUnsafe(1048576),sourceHash=createHash('sha256');
  let n,position=0;
  while((n=readSync(from,expected,0,expected.length,null))>0) {
   sourceHash.update(expected.subarray(0,n));
   let got=0;
   while(got<n){const count=readSync(to,actual,got,n-got,position+got);if(count===0)break;got+=count;}
   targetReadBytes+=got;bytesCompared+=n;
   if(got!==n||!actual.subarray(0,n).equals(expected.subarray(0,n))) {
    assertQuiescent();let written=0;
    while(written<n){const count=writeSync(to,expected,written,n-written,position+written);if(count<=0)throw Error('fixture_write_progress');written+=count;}
    bytesWritten+=n;
   }
   position+=n;
  }
  const sourceSha256=sourceHash.digest('hex');
  if(sourceSha256!==expectedSha256)throw Error('fixture_source_hash');
  assertQuiescent();ftruncateSync(to,position);fsyncSync(to);
  if(process.platform!=='win32'&&(!previous||previous.size!==BigInt(position))) {
   const directory=openSync(dirname(target),constants.O_RDONLY);
   try{fsyncSync(directory);}finally{closeSync(directory);}
  }
  const synchronized=fstatSync(to,{bigint:true});
  const copyAndSyncMs=performance.now()-began,hashStart=performance.now(),targetHash=createHash('sha256');let read=0;
  while((n=readSync(to,expected,0,expected.length,read))>0){targetHash.update(expected.subarray(0,n));read+=n;}
  const targetSha256=targetHash.digest('hex');
  if(targetSha256!==expectedSha256||read!==position)throw Error('fixture_target_hash');
  const finalSource=regular(source),finalTarget=regular(target);
  if(!same(original,finalSource)||original.size!==finalSource.size||original.ctimeNs!==finalSource.ctimeNs||!same(working,finalTarget)||finalTarget.ctimeNs!==synchronized.ctimeNs||finalTarget.size!==BigInt(position))throw Error('fixture_identity');
  assertQuiescent();
  closeSync(to);to=undefined;closeSync(from);fromClosed=true;
  const cpu=process.cpuUsage(cpuStart);
  return {method:'full-compare-inplace',logicalCopyBytes:position,bytesCompared,bytesWritten,targetReadBytes,fullTargetHashBytes:read,sourceSha256,targetSha256,workingInode:String(working.ino),restoreSyncIncluded:true,copyAndSyncMs,hashMs:performance.now()-hashStart,totalMs:performance.now()-began,cpuUserUs:cpu.user,cpuSystemUs:cpu.system};
 } finally {if(to!==undefined)closeSync(to);if(!fromClosed)closeSync(from);}
}
