'use strict';
module.exports=async function(options){
 const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
 process.env.XIAOK_CONFIG_DIR=options.config;
 const api=require(options.binary),facts={kind:'original-broker-parent-port',mode:options.mode,genuineMain:false,productionQualified:false,proxyTraps:0};
 for(const name of ['prepareOriginalBrokerChild','assertOriginalBrokerChildPort','assertOriginalBrokerChildTerminal'])assert.equal(typeof api[name],'function',name+' real Native export required');
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getOwnPropertyDescriptor(){traps++;throw 0;}});
 assert.throws(()=>api.prepareOriginalBrokerChild(proxy));assert.equal(traps,0);
 const issuer=api.componentCreateOriginalCoreForBudget();
 if(options.mode==='allocation-fault'){
  assert.throws(()=>api.prepareOriginalBrokerChild(issuer),/ALLOCATION_HELD/);
  assert.throws(()=>api.prepareOriginalBrokerChild(issuer));facts.secondPrepareDenied=true;
  assert.throws(()=>api.componentCloseOriginalCoreForBudget(issuer));facts.rootCloseHeld=true;
  assert.throws(()=>api.assertOriginalBrokerChildTerminal({}));
  console.log(JSON.stringify(facts));fs.writeFileSync(options.result,JSON.stringify(facts,null,2));return;
 }
 const port=api.prepareOriginalBrokerChild(issuer);
 assert.equal(Object.getPrototypeOf(port),null);assert.equal(Object.isFrozen(port),true);
 assert.deepEqual(Reflect.ownKeys(port).sort(),['cancel','join','launch','poll','read','signal','write']);
 for(const name of Reflect.ownKeys(port))assert.equal(Object.isFrozen(port[name]),true);
 api.assertOriginalBrokerChildPort(port);assert.throws(()=>api.assertOriginalBrokerChildPort(proxy));assert.throws(()=>api.assertOriginalBrokerChildTerminal(port));
 assert.throws(()=>api.prepareOriginalBrokerChild(issuer));assert.throws(()=>port.cancel.call(proxy));assert.throws(()=>port.launch(proxy));assert.equal(traps,0);
 let brokerForeignDenied=false,ksForeignDenied=false;
 try{vm.runInNewContext('port.cancel()',{port});}catch{brokerForeignDenied=true;}
 const ks=api.prepareOriginalKSwarmChild(issuer);
 try{vm.runInNewContext('port.cancel()',{port:ks});}catch{ksForeignDenied=true;}
 console.log(JSON.stringify({kind:'actual-native-port-cross-context',brokerForeignDenied,ksForeignDenied,productionQualified:false}));
 assert.equal(brokerForeignDenied,true);assert.equal(ksForeignDenied,true);
 ks.cancel();api.assertOriginalKSwarmChildTerminal(ks);
 if(options.mode==='cancel'){
  assert.throws(()=>api.componentCloseOriginalCoreForBudget(issuer));
  api.revokeOriginalMainIssuer(issuer);assert.throws(()=>port.launch());port.cancel();port.cancel();
 }else{
  port.launch();assert.throws(()=>port.launch());
  api.revokeOriginalMainIssuer(issuer);assert.throws(()=>port.write(new Uint8Array([1])));
  let done=false,output='',errors='',pid=0;const eof=new Set();const deadline=Date.now()+10000;
  while(!done&&Date.now()<deadline){
   const state=port.poll();pid=state.pid;
   for(const stream of [1,2,3])for(;;){const chunk=port.read(stream);if(chunk.state===0){eof.add(stream);break;}if(chunk.state===2)break;if(stream===1)output+=chunk.data;if(stream===2)errors+=chunk.data;}
   done=state.state===1&&eof.size===3;if(!done)await new Promise(resolve=>setTimeout(resolve,1));
  }
  assert.equal(done,true,errors+output);port.join();assert.ok(pid>0);facts.actualChildKnown=true;
  facts.child=output.split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)).find(v=>v.kind==='broker-fixed-native-node');assert.ok(facts.child,errors+output);
 }
 api.assertOriginalBrokerChildTerminal(port);facts.terminal=true;
 const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.closed,true);assert.equal(closed.unknown,false);facts.rootClosed=true;facts.proxyTraps=traps;
 console.log(JSON.stringify(facts));fs.writeFileSync(options.result,JSON.stringify(facts,null,2));
};
