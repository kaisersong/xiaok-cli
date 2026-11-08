
'use strict';
module.exports=async function(options){
 const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),url=require('node:url');
 process.env.XIAOK_CONFIG_DIR=options.config;
 const api=require(options.binary),source=await import(url.pathToFileURL(path.join(path.dirname(options.binary),'source.mjs')).href);
 const issuer=api.componentCreateOriginalCoreForBudget();
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getOwnPropertyDescriptor(){traps++;throw 0;}});
 await assert.rejects(source.createOriginalProtectedBrokerChild(proxy));assert.equal(traps,0);
 const ks=api.prepareOriginalKSwarmChild(issuer);await assert.rejects(source.createOriginalProtectedBrokerChild(ks));ks.cancel();api.assertOriginalKSwarmChildTerminal(ks);
 const port=api.prepareOriginalBrokerChild(issuer),child=await source.createOriginalProtectedBrokerChild(port);
 await assert.rejects(source.createOriginalProtectedBrokerChild(port));assert.equal(source.readOptionalOriginalProtectedBrokerChildPortFate({}),null);
 const ordinaryFunctions=options.mode==='ordinary-functions',known=options.mode==='held'||ordinaryFunctions;
 let output='',errors='',exited,release,getterCalls=0;
 const observed=new Promise(resolve=>{exited=resolve;}),tail=new Promise(resolve=>{release=resolve;}),sentinel=Error('original Broker callback rejection');
 if(ordinaryFunctions){child.stdout.on('data',function originalBrokerOutput(bytes){output+=bytes.toString('utf8');});child.stderr.on('data',function originalBrokerError(bytes){errors+=bytes.toString('utf8');});}
 else{child.stdout.on('data',bytes=>{output+=bytes.toString('utf8');});child.stderr.on('data',bytes=>{errors+=bytes.toString('utf8');});}
 if(known){
  if(ordinaryFunctions){child.once('exit',function originalBrokerExit(){exited();throw sentinel;});child.once('close',function originalBrokerClose(){return tail;});}
  else{child.once('exit',()=>{exited();throw sentinel;});child.once('close',()=>tail);}
 }else{
  const unknown=Object.defineProperty({},'resource',{get(){getterCalls++;return 1;}});child.once('exit',()=>{exited();return unknown;});
 }
 if(ordinaryFunctions)child.send({kind:'start-real-native-sqlite'},function originalBrokerSent(raw){if(raw)throw raw;});else child.send({kind:'start-real-native-sqlite'});await observed;
 const fate=source.readOptionalOriginalProtectedBrokerChildPortFate(port);assert.ok(fate);
 if(known){
  let settled=false;const closing=source.closeOriginalProtectedBrokerChild(port);closing.then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(settled,false);assert.throws(()=>fate.assertPhysicalKnown());release();
  await assert.rejects(closing,raw=>raw===sentinel);await fate.waitPhysicalKnown();fate.assertPhysicalKnown();source.readOriginalProtectedBrokerChildPhysicalFate(child).assertKnown();
  api.assertOriginalBrokerChildTerminal(port);const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.closed,true);assert.equal(closed.unknown,false);
 }else{
  await assert.rejects(source.closeOriginalProtectedBrokerChild(port));assert.throws(()=>fate.assertPhysicalKnown());await assert.rejects(fate.waitPhysicalKnown());
  api.assertOriginalBrokerChildTerminal(port);assert.equal(getterCalls,0);
 }
 assert.equal(child.exitCode,0,errors+output);const actual=output.split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)).find(v=>v.kind==='broker-fixed-native-node');assert.ok(actual,errors+output);assert.equal(actual.rows,1);assert.equal(actual.closed,true);
 const facts={kind:'broker-fixed-protected-source',mode:options.mode,traps,getterCalls,actualNativeSqlite:true,actualNativeTerminal:true,heldUntilReleased:known,sourceKnown:known,genuineMain:false,productionQualified:false};
 fs.writeFileSync(options.result,JSON.stringify(facts,null,2));console.log(JSON.stringify(facts));
};
