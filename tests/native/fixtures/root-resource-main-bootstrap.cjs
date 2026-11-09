const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');

function refused(addon){
 assert.equal(typeof addon.createOriginalMainIssuer,'function');
 assert.throws(()=>addon.createOriginalMainIssuer(),/MAIN_BOOTSTRAP_ROLE_UNAVAILABLE/);
 return {refused:true};
}
if(!isMainThread){
 try{parentPort.postMessage({ok:true,...refused(require(workerData.addon))});}catch(error){parentPort.postMessage({ok:false,error:error.stack});process.exitCode=1;}
}else{
 const [mode,addonPath,foreignPath,resultPath,userData]=process.argv.slice(2);
 const write=value=>{const pending=resultPath+'.pending';fs.writeFileSync(pending,JSON.stringify({pid:process.pid,...value}),{flag:'wx',mode:0o600});fs.renameSync(pending,resultPath);};
 let app;
 async function main(){
  if(mode==='main'){app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();await app.whenReady();}
  let shadowCalls=0;const original=process._linkedBinding;
  process._linkedBinding=()=>{shadowCalls++;throw Error('PUBLIC_LINKED_BINDING_FORBIDDEN');};
  let native;try{native=require(addonPath);}catch(error){
   if(mode==='plain-node'&&error.code==='ERR_DLOPEN_FAILED'&&/NODE_MODULE_VERSION/.test(error.message)){
    write({ok:true,loaderRefused:true,rolePredicateEvaluated:false});return;
   }throw error;
  }finally{process._linkedBinding=original;}
  assert.equal(typeof native.createOriginalMainIssuer,'function');
  if(mode!=='main'){write({ok:true,...refused(native),shadowCalls});return;}
  assert.throws(()=>native.createOriginalMainIssuer({}),/ARGUMENT/);
  process._linkedBinding=()=>{shadowCalls++;throw Error('PUBLIC_LINKED_BINDING_FORBIDDEN');};
  let issuer;try{issuer=native.createOriginalMainIssuer();}finally{process._linkedBinding=original;}
  assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  assert.equal(Object.getPrototypeOf(issuer),null);assert.deepEqual(Reflect.ownKeys(issuer),[]);
  assert.throws(()=>require('node:vm').runInNewContext('native.assertOriginalMainIssuerCurrent(issuer)',{native,issuer}),/CONTEXT|UNCONFIRMED/);
  assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  assert.throws(()=>native.createOriginalMainIssuer(),/ALREADY/);
  assert.throws(()=>native.createOriginalMainIssuer(issuer),/ARGUMENT/);
  assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  let traps=0;const fake=new Proxy(issuer,{get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
  for(const value of [{...issuer},Object.create(issuer),fake,null,undefined]){
   assert.throws(()=>native.assertOriginalMainIssuerCurrent(value),/ISSUER/);
   assert.throws(()=>native.revokeOriginalMainIssuer(value),/ISSUER/);
  }
  assert.equal(traps,0);
  const foreign=require(foreignPath),other=foreign.createOriginalMainIssuer();
  assert.throws(()=>native.assertOriginalMainIssuerCurrent(other),/ISSUER/);
  assert.throws(()=>foreign.assertOriginalMainIssuerCurrent(issuer),/ISSUER/);
  foreign.revokeOriginalMainIssuer(other);
  const sdkFailures=[];
  for(const kind of ['error','undefined']){
   const failedPath=foreignPath+'.'+kind+'.node';fs.copyFileSync(addonPath,failedPath);const failed=require(failedPath);
   const failure=kind==='error'?Object.assign(Error('ORIGINAL_NATIVE_EXPORTS_FAILURE'),{code:'CONTROLLED_NATIVE_SET_FAILURE'}):undefined;
   const old=Object.getOwnPropertyDescriptor(Object.prototype,'exports');let hits=0,thrown=false,observed;
   try{
    Object.defineProperty(Object.prototype,'exports',{configurable:true,set(){hits++;throw failure;}});
    try{failed.createOriginalMainIssuer();}catch(value){thrown=true;observed=value;}
   }finally{if(old)Object.defineProperty(Object.prototype,'exports',old);else delete Object.prototype.exports;}
   assert.equal(hits,1,'actual GetLinkedBinding module->Set exports must execute the fixture setter');
   assert.equal(thrown,true);assert.equal(observed,failure);assert.throws(()=>failed.createOriginalMainIssuer(),/ALREADY/);
   sdkFailures.push({kind,hits,thrown,originalIdentity:observed===failure});
  }
  assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  const worker=await new Promise((yes,no)=>{
   const child=new Worker(__filename,{workerData:{addon:addonPath}});let value;
   child.once('message',message=>{value=message;});child.once('error',no);
   child.once('exit',code=>code===0&&value?.ok?yes({...value,actualExitCode:code}):no(Error(JSON.stringify({code,value}))));
  });
  assert.equal(worker.refused,true);
  native.revokeOriginalMainIssuer(issuer);native.revokeOriginalMainIssuer(issuer);
  assert.throws(()=>native.assertOriginalMainIssuerCurrent(issuer),/REVOKED/);
  assert.throws(()=>native.createOriginalMainIssuer(),/ALREADY|REVOKED/);
  assert.equal(shadowCalls,0);
  write({ok:true,opaque:true,copyRejected:true,foreignRejected:true,traps,shadowCalls,sdkFailures,worker,revoked:true,ready:app.isReady()});
 }
 main().catch(error=>{try{write({ok:false,error:error.stack});}catch{}process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>{if(app)app.quit();});
}
