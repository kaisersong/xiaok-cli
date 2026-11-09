import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,type BigIntStats} from 'node:fs';
import {join} from 'node:path';

const unavailable=()=>new Error('profile_identity_unavailable');
const stable=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function pathMatchesFd(a:BigIntStats,b:BigIntStats):boolean {
  return (a.dev===b.dev||(process.platform==='win32'&&a.dev===0n))&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
export function assertProfileDirectory(dataRoot:string):BigIntStats {
  const stat=lstatSync(dataRoot,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink()||typeof process.getuid==='function'&&(stat.uid!==BigInt(process.getuid())||(stat.mode&0o022n)!==0n))throw unavailable();
  return stat;
}
/** Bounded identity JSON, not a Native/source authority or Windows SID proof. */
export function readCapturedProfileJson(dataRoot:string,name:'continuity-profile.json'|'continuity-profile-migration.json'):unknown {
  const parent=assertProfileDirectory(dataRoot);
  const file=join(dataRoot,name),before=lstatSync(file,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>4096n||typeof process.getuid==='function'&&(before.uid!==BigInt(process.getuid())||(before.mode&0o022n)!==0n))throw unavailable();
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  const assertPath=(binding:BigIntStats)=>{
    const current=lstatSync(file,{bigint:true});
    if(!stable(before,current))throw unavailable();
    if(process.platform==='win32'&&current.dev===0n){
      const probe=openSync(file,constants.O_RDONLY);
      try{if(!stable(binding,fstatSync(probe,{bigint:true})))throw unavailable();}finally{closeSync(probe);}
    }
  };
  try {
    const binding=fstatSync(fd,{bigint:true});
    if(!pathMatchesFd(before,binding))throw unavailable();assertPath(binding);
    const bytes=Buffer.alloc(4097);let count=0;
    while(count<bytes.length){const read=readSync(fd,bytes,count,bytes.length-count,count);if(!Number.isInteger(read)||read<0||read>bytes.length-count)throw unavailable();if(read===0)break;count+=read;}
    if(count!==Number(before.size)||count>4096||!stable(binding,fstatSync(fd,{bigint:true})))throw unavailable();
    assertPath(binding);const currentParent=assertProfileDirectory(dataRoot);
    if(currentParent.dev!==parent.dev||currentParent.ino!==parent.ino||currentParent.uid!==parent.uid||currentParent.mode!==parent.mode)throw unavailable();
    return JSON.parse(bytes.subarray(0,count).toString('utf8'));
  } finally {closeSync(fd);}
}
