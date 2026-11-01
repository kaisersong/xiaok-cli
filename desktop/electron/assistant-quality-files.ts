import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {writeFileAtomicallySync} from '../../src/utils/atomic-file.js';
/** Picker ports are fixed main-owned functions; IPC never supplies paths. */
export function createAssistantQualityFilePorts(input:{chooseSave:()=>Promise<string|null>;chooseOpen:()=>Promise<string|null>}){
 return {
  async open(maxBytes:number):Promise<string|null>{
   if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4_000_000)throw Error('assistant_quality_file_limit');
   const file=await input.chooseOpen();if(file===null)return null;
   const before=lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.size>maxBytes)throw Error('assistant_quality_file_invalid');
   const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   try{const held=fstatSync(fd);if(held.dev!==before.dev||held.ino!==before.ino||held.size>maxBytes)throw Error('assistant_quality_file_changed');
    // Cap actual allocation and IO even when a local writer grows the file after stat.
    const bytes=Buffer.alloc(maxBytes+1);let length=0;
    while(length<bytes.length){const count=readSync(fd,bytes,length,bytes.length-length,null);if(count===0)break;length+=count;}
    const after=fstatSync(fd);if(length>maxBytes||held.size!==after.size||held.mtimeMs!==after.mtimeMs)throw Error('assistant_quality_file_changed');
    return bytes.subarray(0,length).toString('utf8');
   }finally{closeSync(fd);}
  },
  async save(contents:string,assertCurrent:()=>void):Promise<boolean>{
   if(typeof contents!=='string'||Buffer.byteLength(contents)>4_000_000)throw Error('assistant_quality_file_limit');
   const file=await input.chooseSave();if(file===null)return false;
   assertCurrent();writeFileAtomicallySync(file,contents);return true;
  },
 };
}
