import {parentPort,workerData} from 'node:worker_threads';
import {ProtectedJsonFile,protectedJsonDigest} from './protected-json.js';
const allowed=new Set(['credential_store_unavailable','credential_missing','credential_binding_invalid','credential_path_unsafe','credential_config_busy','credential_config_corrupt','credential_reserved_input','credential_config_changed','credential_cancelled']);
try {
  const data=workerData as {file:string;operation:'read'|'save';value?:unknown;expectedHash?:string;state:SharedArrayBuffer};const state=new Int32Array(data.state),store=new ProtectedJsonFile(data.file);
  const commit=()=>{if(Atomics.compareExchange(state,0,0,2)!==0)throw Error('credential_cancelled');};
  let result:{value:unknown;digest:string;backupDigest:string};
  if(data.operation==='save'){store.save(data.value,data.expectedHash,commit);result={value:data.value,digest:protectedJsonDigest(data.file),backupDigest:protectedJsonDigest(data.file+'.bak')};}
  else {let stable=false;let value:unknown,digest='',backupDigest='';for(let i=0;i<3;i++){const before=protectedJsonDigest(data.file),beforeBackup=protectedJsonDigest(data.file+'.bak');value=store.read();digest=protectedJsonDigest(data.file);backupDigest=protectedJsonDigest(data.file+'.bak');if(before===digest&&beforeBackup===backupDigest){stable=true;break;}}if(!stable)throw Error('credential_config_changed');result={value,digest,backupDigest};}
  parentPort!.postMessage({ok:true,result});
}catch(error){const code=error instanceof Error?error.message:'';parentPort!.postMessage({ok:false,error:allowed.has(code)?code:'credential_store_unavailable'});}
