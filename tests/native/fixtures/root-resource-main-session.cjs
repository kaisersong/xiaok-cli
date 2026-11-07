const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
function rejectRole(native){assert.throws(()=>native.openOriginalMainIssuer(),/ROLE_UNAVAILABLE/);return{roleRejected:true};}
if(!isMainThread){try{parentPort.postMessage({ok:true,...rejectRole(require(workerData.addon))});}catch(error){parentPort.postMessage({ok:false,error:error.stack});process.exitCode=1;}}
else{
 const [mode,addonPath,domain,resultPath,userData]=process.argv.slice(2);let app;
 function publish(value){fs.writeFileSync(resultPath+'.pending',JSON.stringify({pid:process.pid,...value}),{flag:'wx',mode:0o600});fs.renameSync(resultPath+'.pending',resultPath);}
 async function run(){
  if(mode.startsWith('main')){app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();await app.whenReady();}
  let native;try{native=require(addonPath);}catch(error){if(mode==='node'&&error.code==='ERR_DLOPEN_FAILED'){
   assert.match(error.message,/NODE_MODULE_VERSION/);publish({ok:true,loaderRejected:true,abiRejected:true,roleEvaluated:false,loaderError:error.message});return;
  }throw error;}
  const database=path.join(domain,'root-resource-v1.sqlite');assert.equal(fs.existsSync(database),false);
  assert.equal(native.buildInfo().nativeQualified,false);assert.equal(native.buildInfo().compiledFixtureRoot,fs.realpathSync(domain));
  assert.equal(typeof native.openOriginalMainIssuer,'function');
  if(mode==='main-revoked'){
   const issuer=native.openOriginalMainIssuer();try{
    native.revokeOriginalMainIssuer(issuer);let installed,error,policy;
    try{installed=native.installFresh(issuer);}catch(value){error=value;}
    try{policy=native.readPolicy(issuer);}catch{}
    console.log(JSON.stringify({revokedFloorProbe:true,installed:installed?.installed===true,policyWritten:policy?.capacity===5}));
    assert.match(error?.message||'',/REVOKED/);
    for(const operation of [()=>native.enqueue(issuer,{}),()=>native.claimNext(issuer),()=>native.consumeLaunch(issuer,{})])assert.throws(operation,/REVOKED/);
    if(native.fixtureSubject)assert.throws(()=>native.fixtureSubject(issuer,0),/REVOKED/);
    assert.throws(()=>native.readPolicy(issuer),/FLOOR/);
   }finally{native.close(issuer);}
   publish({ok:true,revokeBeforeFloor:true,newPositiveDenied:true,metadataReadAllowed:true});return;
  }
  if(mode!=='main'){const result=rejectRole(native);assert.equal(fs.existsSync(database),false);publish({ok:true,...result,noDatabase:true});return;}
  let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');}});
  assert.throws(()=>native.openOriginalMainIssuer(proxy),/ARGUMENT/);assert.equal(traps,0);assert.equal(fs.existsSync(database),false);
  assert.throws(()=>require('node:vm').runInNewContext('native.openOriginalMainIssuer()',{native}),/CONTEXT/);assert.equal(fs.existsSync(database),false);
  const issuer=native.openOriginalMainIssuer();assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  assert.throws(()=>require('node:vm').runInNewContext('native.assertOriginalMainIssuerCurrent(issuer)',{native,issuer}),/CONTEXT/);
  assert.equal(native.assertOriginalMainIssuerCurrent(issuer),undefined);
  assert.equal(native.installFresh(issuer).installed,true);assert.equal(native.readPolicy(issuer).capacity,5);
  let queuedSubject,claimSequence;
  if(native.fixtureSubject){queuedSubject=native.fixtureSubject(issuer,0);assert.equal(native.enqueue(issuer,queuedSubject).disposition,'new_queued');claimSequence=native.readPolicy(issuer).claimSeq;}
  assert.throws(()=>native.openOriginalMainIssuer(),/ALREADY/);
  for(const value of [{...issuer},proxy,null]){assert.throws(()=>native.assertOriginalMainIssuerCurrent(value),/SESSION|ISSUER/);assert.throws(()=>native.revokeOriginalMainIssuer(value),/SESSION|ISSUER/);}
  assert.equal(traps,0);
  const foreignPath=addonPath+'.foreign.node';fs.copyFileSync(addonPath,foreignPath);const foreign=require(foreignPath);
  assert.throws(()=>foreign.assertOriginalMainIssuerCurrent(issuer),/SESSION|ISSUER/);
  const worker=await new Promise((yes,no)=>{const child=new Worker(__filename,{workerData:{addon:addonPath}});let result;child.once('message',value=>{result=value;});child.once('error',no);child.once('exit',code=>code===0&&result?.ok?yes({...result,exitCode:code}):no(Error(JSON.stringify({code,result}))));});
  native.revokeOriginalMainIssuer(issuer);native.revokeOriginalMainIssuer(issuer);
  assert.throws(()=>native.assertOriginalMainIssuerCurrent(issuer),/REVOKED/);
  assert.equal(native.readPolicy(issuer).capacity,5);assert.equal(native.readRecord(issuer,'missing-original-record'),null);
  for(const operation of [()=>native.enqueue(issuer,{}),()=>native.claimNext(issuer),()=>native.consumeLaunch(issuer,{})])assert.throws(operation,/REVOKED/);
  let negativeSettlement;
  if(queuedSubject){
   assert.throws(()=>native.fixtureSubject(issuer,0),/REVOKED/);
   const result=native.cancelQueued(issuer,queuedSubject);assert.equal(result.cancelled,true);assert.equal(result.record.state,'cancelled_before_launch');
   assert.equal(native.readRecord(issuer,result.record.executionKey).state,'cancelled_before_launch');assert.equal(native.readPolicy(issuer).claimSeq,claimSequence);
   negativeSettlement={acceptedBeforeRevoke:true,cancelled:true,claimSequenceUnchanged:true};
  }
  assert.throws(()=>native.cancelQueued(issuer,{}),/SUBJECT/);
  native.close(issuer);assert.throws(()=>native.readPolicy(issuer),/CLOSED/);
  const portable=native.openOriginal();assert.throws(()=>native.assertOriginalMainIssuerCurrent(portable),/ISSUER/);native.close(portable);
  const gcFile=addonPath+'.gc.node';fs.copyFileSync(addonPath,gcFile);const gcNative=require(gcFile);
  require('node:v8').setFlagsFromString('--expose_gc');const collect=require('node:vm').runInNewContext('gc');
  const weak=(()=>new WeakRef(gcNative.openOriginalMainIssuer()))();let gcTurns=0;
  for(;gcTurns<12;){gcTurns++;await new Promise(yes=>setImmediate(yes));collect();await new Promise(yes=>setImmediate(yes));if(weak.deref()===undefined)break;}
  assert.equal(weak.deref(),undefined,'the Main bridge must not strongly retain its C session JS wrapper');
  const afterGc=native.openOriginal();native.close(afterGc);assert.throws(()=>gcNative.openOriginalMainIssuer(),/ALREADY/);
  const faults=[];
  for(const kind of ['error','undefined']){
   const file=addonPath+'.'+kind+'.node';fs.copyFileSync(addonPath,file);const failed=require(file);let hits=0,thrown=false,observed;
   const failure=kind==='error'?Error('ORIGINAL_EMBEDDED_NATIVE_FAILURE'):undefined,old=Object.getOwnPropertyDescriptor(Object.prototype,'exports');
   try{Object.defineProperty(Object.prototype,'exports',{configurable:true,set(){hits++;throw failure;}});try{failed.openOriginalMainIssuer();}catch(value){thrown=true;observed=value;}}
   finally{if(old)Object.defineProperty(Object.prototype,'exports',old);else delete Object.prototype.exports;}
   assert.equal(hits,1);assert.equal(thrown,true);assert.equal(observed,failure);assert.throws(()=>failed.openOriginalMainIssuer(),/ALREADY/);faults.push({kind,hits,thrown,originalIdentity:observed===failure});
  }
  publish({ok:true,sameOriginalSession:true,actualPolicy:true,traps,worker,faults,revoked:true,closed:true,gcWrapperCollected:true,gcLockReleased:true,gcTurns,negativeSettlement});
 }
 run().catch(error=>{try{publish({ok:false,error:error.stack});}catch{}process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>{if(app)app.quit();});
}
