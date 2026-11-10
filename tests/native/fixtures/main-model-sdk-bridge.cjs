'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads');
const [mode,addon,domain,result,userData]=process.argv.slice(2);const fixtureConfig=path.join(fs.realpathSync(domain),'fixture-config');fs.mkdirSync(fixtureConfig,{recursive:true,mode:0o700});process.env.XIAOK_CONFIG_DIR=fixtureConfig;let app,api,issuer;let traps=0,negativeCalls=0;
const port=()=>Object.freeze(Object.assign(Object.create(null),Object.fromEntries(['acquireModel','consumeModel','settleModel','cancelModel','assertModelCurrent','assertModelLocal','acquireProcess','consumeProcess','settleProcess','cancelProcess','assertProcessCurrent','assertProcessLocal','readProcessSourceRequest'].map(name=>[name,function(){if(name==='readProcessSourceRequest')return null;if(name==='settleModel'||name==='cancelModel'||name==='settleProcess'||name==='cancelProcess')negativeCalls++;}]))));
const foreign=new Proxy({}, {get(){traps++;throw Error('foreign getter');},getOwnPropertyDescriptor(){traps++;throw Error('foreign descriptor');},ownKeys(){traps++;throw Error('foreign keys');},getPrototypeOf(){traps++;throw Error('foreign prototype');},preventExtensions(){traps++;throw Error('foreign freeze');}});
async function run(){
 if(mode==='main'||mode==='revoked'||mode==='closed'||mode==='gc'||mode==='core'||mode==='cache-poison'){app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();await app.whenReady();}
 let originalCore;
 if(mode==='cache-poison'){
  require(addon);let calls=0;require.cache[require.resolve(addon)].exports={assertOriginalModelSdkBridge(){calls++;}};
  originalCore=await import(require('node:url').pathToFileURL(path.join(path.dirname(addon),'bridge.mjs')).href);
  assert.throws(()=>originalCore.installOriginalMainSdkBridge(foreign,port()),'fake require-cache verifier must never install a bridge');assert.equal(calls,0);assert.equal(originalCore.hasOriginalMainSdkBridgeInstallation(),false);
  return {ok:true,cacheVerifierRejected:true,traps,calls,componentOnly:true};
 }
 if(mode==='core')originalCore=await import(require('node:url').pathToFileURL(path.join(path.dirname(addon),'bridge.mjs')).href);
 api=originalCore?originalCore.loadOriginalMainResourceAuthority():require(addon);assert.equal(typeof api.takeOriginalModelSdkBridgeKey,'function','original Main SDK bridge mint export required');assert.equal(typeof api.assertOriginalModelSdkBridge,'function','original Main SDK bridge reader export required');
 if(mode==='run-as-node'){assert.throws(()=>api.openOriginalMainIssuer(),/ROLE_UNAVAILABLE/);assert.throws(()=>api.takeOriginalModelSdkBridgeKey(foreign,foreign));assert.equal(traps,0);return {ok:true,roleRejected:true};}
 issuer=api.openOriginalMainIssuer();assert.throws(()=>api.takeOriginalModelSdkBridgeKey(foreign,foreign));assert.equal(traps,0);assert.throws(()=>api.takeOriginalModelSdkBridgeKey(issuer,foreign));assert.equal(traps,0);
 const mutable=Object.assign(Object.create(null),port());assert.throws(()=>api.takeOriginalModelSdkBridgeKey(issuer,mutable),/BRIDGE_PORT/);
 const savedFrozen=Object.isFrozen,savedGet=Object.getOwnPropertyDescriptor(Object.prototype,'get');let poisonedCalls=0;
 Object.isFrozen=()=>true;
 Object.defineProperty(Object.prototype,'get',{__proto__:null,configurable:true,get(){poisonedCalls++;throw Error('inherited descriptor getter');}});
 let poisonFailure;try{api.takeOriginalModelSdkBridgeKey(issuer,mutable);}catch(error){poisonFailure=error;}
 finally{Object.isFrozen=savedFrozen;if(savedGet)Object.defineProperty(Object.prototype,'get',savedGet);else delete Object.prototype.get;}
 assert.match(poisonFailure?.message??'',/BRIDGE_PORT/);assert.equal(poisonedCalls,0);

 let getters=0;const accessor=Object.create(null);Object.defineProperty(accessor,'acquireModel',{get(){getters++;throw Error('port getter');}});Object.freeze(accessor);assert.throws(()=>api.takeOriginalModelSdkBridgeKey(issuer,accessor),/BRIDGE_PORT/);assert.equal(getters,0);
 const original=port();let key=api.takeOriginalModelSdkBridgeKey(issuer,original);assert.equal(Object.isFrozen(key),true);assert.deepEqual(Reflect.ownKeys(key),[]);assert.equal(api.assertOriginalModelSdkBridge(key,original),undefined);
 for(const bad of [foreign,{...key},{},null])assert.throws(()=>api.assertOriginalModelSdkBridge(bad,foreign));assert.equal(traps,0);
 for(const bad of [foreign,port(),{...original},null])assert.throws(()=>api.assertOriginalModelSdkBridge(key,bad));assert.equal(traps,0);
 assert.throws(()=>api.takeOriginalModelSdkBridgeKey(issuer,original),/ALREADY/);assert.equal(api.assertOriginalModelSdkBridge(key,original),undefined);
 if(mode==='core'){
  const core=originalCore;
  assert.equal(typeof core.readOptionalOriginalMainProcessSourceRequest,'function','fixed passive process Source request bridge required');
  assert.equal(core.readOptionalOriginalMainProcessSourceRequest(foreign),null);assert.equal(traps,0);
  assert.equal(core.hasOriginalMainSdkBridgeInstallation(),false);assert.equal(core.readOptionalOriginalMainSdkBridge(),null);
  assert.throws(()=>core.installOriginalMainSdkBridge(foreign,foreign));assert.equal(traps,0);
  core.installOriginalMainSdkBridge(key,original);core.installOriginalMainSdkBridge(key,original);
  assert.equal(core.hasOriginalMainSdkBridgeInstallation(),true);const captured=core.readOptionalOriginalMainSdkBridge();assert.equal(Object.isFrozen(captured),true);
  assert.equal(core.readOptionalOriginalMainProcessSourceRequest(foreign),null);assert.equal(traps,0);
  assert.throws(()=>core.installOriginalMainSdkBridge(key,port()));
  assert.throws(()=>core.installOriginalMainSdkBridge(foreign,foreign));assert.equal(traps,0);
  captured.assertModelCurrent({});captured.assertModelLocal({});
  api.revokeOriginalMainIssuer(issuer);
  assert.throws(()=>core.readOptionalOriginalMainSdkBridge(),/REVOKED/);
  assert.equal(core.hasOriginalMainSdkBridgeInstallation(),true);assert.throws(()=>captured.assertModelLocal({}),/BRIDGE_REQUIRED/);
  assert.equal(core.readOptionalOriginalMainProcessSourceRequest(foreign),null);assert.equal(traps,0);
  for(const name of ['settleModel','cancelModel','settleProcess','cancelProcess'])assert.doesNotThrow(()=>captured[name]({},{}),'retired bridge must attempt exact original negative method '+name);assert.equal(negativeCalls,4);
  for(const name of ['acquireModel','consumeModel','assertModelCurrent','assertModelLocal','acquireProcess','consumeProcess','assertProcessCurrent','assertProcessLocal'])assert.throws(()=>captured[name]({}),/BRIDGE_REQUIRED/);
  assert.throws(()=>core.installOriginalMainSdkBridge(key,original));
  return {ok:true,nativeVerifiedCache:true,sticky:true,traps,componentOnly:true};
 }
 if(mode==='revoked'){api.revokeOriginalMainIssuer(issuer);assert.throws(()=>api.assertOriginalModelSdkBridge(key,original),/REVOKED/);assert.throws(()=>api.takeOriginalModelSdkBridgeKey(issuer,original));return {ok:true,revoked:true,traps};}
 if(mode==='closed'){api.close(issuer);issuer=null;assert.throws(()=>api.assertOriginalModelSdkBridge(key,original),/CLOSED/);return {ok:true,closed:true,traps};}
 return {ok:true,samePort:true,foreignPortRejected:true,once:true,traps,getters,componentOnly:true};
}
run().then(facts=>{if(issuer)api.close(issuer);fs.writeFileSync(result,JSON.stringify({pid:process.pid,...facts}));if(app)app.exit(0);},error=>{try{if(issuer)api.close(issuer);}catch{}fs.writeFileSync(result,JSON.stringify({pid:process.pid,ok:false,error:error.stack,traps}));if(app)app.exit(1);else process.exitCode=1;});
