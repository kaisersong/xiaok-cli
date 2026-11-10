'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {isMainThread,Worker,parentPort,workerData}=require('node:worker_threads');
const names=['RoomDiscussion','RoomProject','KSwarmDirect','WorkflowRoot'];
const take=name=>'takeOriginal'+name+'SourceKey',check=name=>'assertOriginal'+name+'SourceKey';
if(!isMainThread){try{const api=require(workerData.addon);assert.throws(()=>api.openOriginalMainIssuer(),/ROLE_UNAVAILABLE/);for(const name of names)assert.throws(()=>api[take(name)]({}),/SESSION|ISSUER/);parentPort.postMessage({ok:true,roleRejected:true});}catch(error){parentPort.postMessage({ok:false,error:error.stack});process.exitCode=1;}}
else{
 const [mode,addon,domain,result,userData,foreignAddon]=process.argv.slice(2);let app,api,issuer;
 function publish(value){fs.writeFileSync(result+'.tmp',JSON.stringify({pid:process.pid,...value}),{flag:'wx',mode:0o600});fs.renameSync(result+'.tmp',result);}
 async function run(){
  if(mode!=='node'&&mode!=='run-as-node'){app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();await app.whenReady();}
  try{api=require(addon);}catch(error){if(mode==='node'&&error.code==='ERR_DLOPEN_FAILED'){assert.match(error.message,/NODE_MODULE_VERSION/);return{ok:true,loaderRejected:true,roleEvaluated:false};}throw error;}
  if(mode==='run-as-node'){assert.throws(()=>api.openOriginalMainIssuer(),/ROLE_UNAVAILABLE/);assert.equal(fs.existsSync(path.join(domain,'root-resource-v1.sqlite')),false);return{ok:true,roleRejected:true,noDatabase:true};}
  assert.equal(api.buildInfo().nativeQualified,false);assert.equal(api.buildInfo().compiledFixtureRoot,fs.realpathSync(domain));
  if(mode==='api'){
   issuer=api.openOriginalMainIssuer();for(const name of names){assert.equal(typeof api[take(name)],'function',take(name));assert.equal(typeof api[check(name)],'function',check(name));}return{ok:true,actualOriginalSession:true,apiAvailable:true};
  }
  for(const name of names){assert.equal(typeof api[take(name)],'function');assert.equal(typeof api[check(name)],'function');}
  assert.equal(typeof api.takeOriginalDshDraftSourceKey,'function');assert.equal(typeof api.assertOriginalDshDraftSourceKey,'function');
  let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');},getOwnPropertyDescriptor(){traps++;throw Error('trap');}});
  for(const name of names){assert.throws(()=>api[take(name)](),/ARGUMENT/);assert.throws(()=>api[take(name)](proxy),/SESSION|ISSUER/);}
  const ordinary=api.openOriginal();try{for(const name of names)assert.throws(()=>api[take(name)](ordinary),/ISSUER/);}finally{api.close(ordinary);}
  issuer=api.openOriginalMainIssuer();assert.equal(api.assertOriginalMainIssuerCurrent(issuer),undefined);
  if(mode==='gc'){
   require('node:v8').setFlagsFromString('--expose_gc');const collect=require('node:vm').runInNewContext('gc');
   const weakKey=(()=>new WeakRef(api[take(names[0])](issuer)))();let keyTurns=0;
   for(;keyTurns<16;keyTurns++){await new Promise(yes=>setImmediate(yes));collect();await new Promise(yes=>setImmediate(yes));if(weakKey.deref()===undefined)break;}
   assert.equal(weakKey.deref(),undefined,'fixture must observe original key collected');assert.throws(()=>api[take(names[0])](issuer),/ALREADY/);
   let heldKey=api[take(names[1])](issuer);const weakParent=new WeakRef(issuer);issuer=null;
   for(let i=0;i<3;i++){await new Promise(yes=>setImmediate(yes));collect();await new Promise(yes=>setImmediate(yes));}
   assert.ok(weakParent.deref(),'key must keep original parent wrapper alive');assert.throws(()=>api.openOriginal(),/BUSY/);
   assert.equal(api[check(names[1])](weakParent.deref(),heldKey),undefined);heldKey=null;let parentTurns=0;
   for(;parentTurns<16;parentTurns++){await new Promise(yes=>setImmediate(yes));collect();await new Promise(yes=>setImmediate(yes));if(weakParent.deref()===undefined)break;}
   assert.equal(weakParent.deref(),undefined,'fixture must observe parent collected after key released');const reopened=api.openOriginal();api.close(reopened);assert.throws(()=>api.openOriginalMainIssuer(),/ALREADY/);
   return{ok:true,keyCollected:true,parentRetainedByKey:true,parentCollected:true,lockReleased:true,keyTurns,parentTurns,noRemint:true};
  }
  if(mode==='early-closed'||mode==='early-revoked'){
   if(mode==='early-closed')api.close(issuer);else api.revokeOriginalMainIssuer(issuer);
   for(const name of names)assert.throws(()=>api[take(name)](issuer),/CLOSED|REVOKED/);
   return{ok:true,allUnissuedSlotsDenied:true,mode};
  }
  for(const name of names){assert.throws(()=>api[take(name)](issuer,proxy),/ARGUMENT/);for(const fake of [{...issuer},proxy,null,Promise.resolve()])assert.throws(()=>api[take(name)](fake),/SESSION|ISSUER/);}
  assert.throws(()=>require('node:vm').runInNewContext('api[method](issuer)',{api,method:take(names[0]),issuer}),/CONTEXT/);
  const keys=names.map(name=>api[take(name)](issuer));
  for(let i=0;i<names.length;i++){
   const name=names[i],key=keys[i];assert.equal(Object.isFrozen(key),true);assert.deepEqual(Reflect.ownKeys(key),[]);assert.equal(api[check(name)](issuer,key),undefined);assert.throws(()=>api[take(name)](issuer),/ALREADY/);
   assert.throws(()=>api[take(name)](issuer,proxy),/ARGUMENT/);assert.throws(()=>api[check(name)](issuer),/ARGUMENT/);assert.throws(()=>api[check(name)](issuer,key,proxy),/ARGUMENT/);
   for(const fake of [{...key},proxy,null,Promise.resolve()])assert.throws(()=>api[check(name)](issuer,fake),/SOURCE_KEY|ARGUMENT/);
   for(const fake of [{...issuer},proxy,null,Promise.resolve()])assert.throws(()=>api[check(name)](fake,key),/SESSION|ISSUER/);
   const wrapped=new Proxy(key,{get(){traps++;throw Error('wrapped');},getPrototypeOf(){traps++;throw Error('wrapped');},ownKeys(){traps++;throw Error('wrapped');}});assert.throws(()=>api[check(name)](issuer,wrapped),/SOURCE_KEY/);
   for(let j=0;j<names.length;j++)if(j!==i)assert.throws(()=>api[check(name)](issuer,keys[j]),/SOURCE_KEY/);
  }
  assert.equal(traps,0);
  const savedDomain=domain+'.wrong-key-cut';fs.renameSync(domain,savedDomain);fs.mkdirSync(domain);
  try{assert.throws(()=>api[check(names[0])](issuer,keys[1]),/SOURCE_KEY/);}
  finally{fs.rmdirSync(domain);fs.renameSync(savedDomain,domain);}
  assert.equal(api[check(names[0])](issuer,keys[0]),undefined,'wrong key must reject before FS and leave the original session healthy');
  assert.throws(()=>require('node:vm').runInNewContext('api[method](issuer,key)',{api,method:check(names[0]),issuer,key:keys[0]}),/CONTEXT/);
  assert.equal(api[check(names[0])](issuer,keys[0]),undefined);
  if(mode==='closed'||mode==='revoked'){
   if(mode==='closed')api.close(issuer);else api.revokeOriginalMainIssuer(issuer);
   for(let i=0;i<names.length;i++){assert.throws(()=>api[take(names[i])](issuer),/CLOSED|REVOKED/);assert.throws(()=>api[check(names[i])](issuer,keys[i]),/CLOSED|REVOKED/);}
   return{ok:true,allFourLifetimeDenied:true,mode};
  }
  if(mode==='unknown'){
   const old=domain+'.original';fs.renameSync(domain,old);fs.mkdirSync(domain);try{assert.throws(()=>api[check(names[0])](issuer,keys[0]),/UNCONFIRMED/);}finally{fs.rmdirSync(domain);fs.renameSync(old,domain);}
   // A previously unconfirmed positive is rejected locally, before the
   // original C++ role/context SDK. This probe proves ordering, not async work.
   assert.throws(()=>require('node:vm').runInNewContext('api[method](issuer)',{api,method:take(names[0]),issuer}),/SESSION_UNCONFIRMED/);
   assert.throws(()=>require('node:vm').runInNewContext('api[method](issuer,key)',{api,method:check(names[0]),issuer,key:keys[0]}),/SESSION_UNCONFIRMED/);
   for(let i=0;i<names.length;i++){assert.throws(()=>api[take(names[i])](issuer),/UNCONFIRMED/);assert.throws(()=>api[check(names[i])](issuer,keys[i]),/UNCONFIRMED/);}return{ok:true,stickyUnknown:true,unknownBeforeRoleContext:true};
  }
  const foreign=require(foreignAddon),other=foreign.openOriginalMainIssuer();try{const key=foreign[take(names[0])](other);assert.throws(()=>api[check(names[0])](issuer,key),/SOURCE_KEY/);assert.throws(()=>api[check(names[0])](other,keys[0]),/SESSION|ISSUER/);assert.throws(()=>foreign[check(names[0])](issuer,keys[0]),/SESSION|ISSUER/);}finally{foreign.close(other);}
  const worker=await new Promise((yes,no)=>{const thread=new Worker(__filename,{workerData:{addon}});let message;thread.once('message',value=>{message=value;});thread.once('error',no);thread.once('exit',code=>code===0&&message?.ok?yes({...message,exitCode:code}):no(Error(JSON.stringify({code,message}))));});
  return{ok:true,fourOnceKeys:true,traps,foreignRejected:true,ordinaryRejected:true,worker,noBusinessSubjectIssued:true};
 }
 run().then(value=>{if(issuer)api.close(issuer);issuer=null;publish(value);},error=>{try{if(issuer)api.close(issuer);}catch{}try{publish({ok:false,error:error.stack});}catch{}process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>{if(app)app.quit();});
}
