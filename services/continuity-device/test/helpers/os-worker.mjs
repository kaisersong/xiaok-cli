import{fork}from'node:child_process';import{createRequire}from'node:module';import{randomBytes,createHash}from'node:crypto';import{fileURLToPath}from'node:url';import{openOsCredentialBackend}from'../../src/os-backend.mjs';
const require=createRequire(import.meta.url),digest=b=>createHash('sha256').update(b).digest('hex');
async function peer(accountId){const child=fork(fileURLToPath(import.meta.url),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});process.send?.({type:'pid',pid:child.pid});let result;const message=new Promise((resolve,reject)=>{child.once('message',value=>{result=value;});child.once('error',reject);child.once('exit',code=>code===0&&result?.ok?resolve(result):reject(new Error('peer_unavailable')));});child.send({mode:'read',accountId});return message;}
process.once('message',async({mode,accountId})=>{
 let backend,entry,owned=false,attempted=false,stage='open';const first=randomBytes(64),second=randomBytes(64);let outcome;
 try{
  backend=openOsCredentialBackend({accountId});
  if(mode==='read'){const value=backend.read();if(!value)throw new Error('missing');outcome={ok:true,hash:digest(value)};value.fill(0);}
  else{
   stage='read-missing';if(backend.read()!==null)throw new Error('unexpected_existing');owned=true;
   const target=process.platform==='darwin'?`darwin-${process.arch}`:'win32-x64-msvc',binding=require(`@napi-rs/keyring-${target}`);entry=new binding.Entry('xiaok.continuity.device.v1',accountId);
   attempted=true;stage='create';backend.createInitial(first);stage='first-peer';const a=await peer(accountId);if(a.hash!==digest(first))throw new Error('restart_mismatch');stage='replace';backend.compareReplace(first,second);stage='second-peer';const b=await peer(accountId);if(b.hash!==digest(second))throw new Error('update_mismatch');stage='delete';if(entry.deleteCredential()!==true)throw new Error('delete_failed');
   stage='lost-item-check';let refused=false;try{backend.compareReplace(second,first);}catch(error){refused=error.message==='os_backend_unavailable';}if(!refused)throw new Error('lost_item_recreated');const check=openOsCredentialBackend({accountId});if(check.read()!==null)throw new Error('constructor_wrote');check.close();outcome={ok:true,freshMissing:true,restartRead:true,updatedRestartRead:true,missingNotRecreated:true,deletedOwn:true};
  }
 }catch{outcome={ok:false,error:'os_backend_unavailable',stage};}
 finally{
  if(owned&&attempted&&entry){try{entry.deleteCredential();if(entry.getSecret()!==null)outcome={ok:false,error:'test_cleanup_failed'};}catch{outcome={ok:false,error:'test_cleanup_failed'};}}
  first.fill(0);second.fill(0);backend?.close();process.send?.(outcome,()=>process.disconnect());
 }
});
