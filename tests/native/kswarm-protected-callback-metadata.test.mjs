import test from 'node:test';
import assert from 'node:assert/strict';
import {runKSwarmProtectedSourceFixture} from './helpers/kswarm-protected-source-fixture.mjs';

test('ordinary function listeners keep the genuine child Source physically joinable', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let exited,sent,sendCalls=0;
 const observed=new Promise(resolve=>{exited=resolve;}),sentResult=new Promise(resolve=>{sent=resolve;});
 child.stdout.on('data',function onData(){});child.stderr.on('data',function onErrorData(){});
 let traps=0;const foreign=new Proxy(function foreignListener(){},{ownKeys(){traps++;return [];},getOwnPropertyDescriptor(){traps++;return undefined;}});
 assert.throws(()=>child.on('message',foreign));assert.equal(traps,0);
 child.once('exit',function onExit(){exited();});child.once('close',function onClose(){});
 child.send({kind:'original-callback-metadata-probe'},function onSent(error){assert.equal(error,null);sendCalls++;sent();});
 await observed;await sentResult;assert.equal(sendCalls,1);await source.closeOriginalProtectedKSwarmChild(port);
 source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown();api.assertOriginalKSwarmChildTerminal(port);
 const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'ordinary-function-source-known',rootFilesClosed:closed.rootFilesClosed,unknown:closed.unknown}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/ordinary-function-source-known/);
});

test('unknown callback metadata cannot prevent the real negative signal, stream join and Native terminal', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('ignore_term_after_finish',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let ready,getters=0;
 const started=new Promise(resolve=>{ready=resolve;});child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 child.on('message',message=>{if(message.kind==='ks-original-ignore-term-ready')ready();});await started;
 function uncalled(){}Object.defineProperty(uncalled,Symbol('unknown-metadata'),{get(){getters++;return 1;}});child.on('message',uncalled);
 await assert.rejects(source.closeOriginalProtectedKSwarmChild(port));assert.equal(child.signalCode,'SIGKILL');assert.equal(getters,0);
 api.assertOriginalKSwarmChildTerminal(port);assert.throws(()=>source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown());
 console.log(JSON.stringify({kind:'callback-unknown-negative-still-terminal',getters,signal:child.signalCode,coreCloseAttempted:false}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/callback-unknown-negative-still-terminal/);
 assert.match(result.stdout,/"event":"reaped"[^\n]*"unknown":true/);
});

test('a genuine callback bare undefined failure preserves presence while known metadata still joins', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let exited;
 const observed=new Promise(resolve=>{exited=resolve;});child.stdout.on('data',function onData(){});child.stderr.on('data',function onStderr(){});
 child.once('exit',function onExit(){exited();throw undefined;});await observed;
 let failed=false;try{await source.closeOriginalProtectedKSwarmChild(port);}catch(raw){failed=true;assert.equal(raw,undefined);}assert.equal(failed,true);
 const fate=source.readOriginalProtectedKSwarmChildPhysicalFate(child);await fate.waitKnown();fate.assertKnown();
 const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'callback-undefined-presence',failed,rootFilesClosed:closed.rootFilesClosed}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/callback-undefined-presence/);
});

test('callback symbol tails registered before and during dispatch remain held until original settlement', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let exited,releaseBefore,releaseDuring;
 const before=new Promise(resolve=>{releaseBefore=resolve;}),during=new Promise(resolve=>{releaseDuring=resolve;});
 const observed=new Promise(resolve=>{exited=resolve;});const beforeKey=Symbol('registered-tail'),duringKey=Symbol('dispatch-tail');
 function onExit(){onExit[duringKey]=during;exited();}onExit[beforeKey]=before;
 child.stdout.on('data',function onData(){});child.stderr.on('data',function onStderr(){});child.once('exit',onExit);
 await observed;let settled=false;const closing=source.closeOriginalProtectedKSwarmChild(port);closing.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setTimeout(resolve,40));assert.equal(settled,false);releaseBefore();
 await new Promise(resolve=>setTimeout(resolve,40));assert.equal(settled,false);releaseDuring();await closing;
 source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown();const closed=api.componentCloseOriginalCoreForBudget(issuer);
 assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'callback-two-original-symbol-tails',heldBoth:true,rootFilesClosed:closed.rootFilesClosed}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/callback-two-original-symbol-tails/);
});

test('final Source fate rescans removed callback metadata and never invokes an added accessor or Proxy', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let exited,getters=0,traps=0;
 const observed=new Promise(resolve=>{exited=resolve;});function onExit(){exited();}
 child.stdout.on('data',function onData(){});child.stderr.on('data',function onStderr(){});child.once('exit',onExit);
 await observed;await source.closeOriginalProtectedKSwarmChild(port);const fate=source.readOriginalProtectedKSwarmChildPhysicalFate(child);fate.assertKnown();
 let release,settled=false;onExit[Symbol('late-held')]=new Promise(resolve=>{release=resolve;});
 const waiting=fate.waitKnown();waiting.then(()=>{settled=true;},()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(settled,false);release();await waiting;fate.assertKnown();
 Object.defineProperty(onExit,Symbol('late-getter'),{get(){getters++;return 1;}});
 onExit[Symbol('late-proxy')]=new Proxy({},{ownKeys(){traps++;return [];},getOwnPropertyDescriptor(){traps++;return undefined;}});
 assert.throws(()=>fate.assertKnown());await assert.rejects(fate.waitKnown());assert.equal(getters,0);assert.equal(traps,0);
 api.assertOriginalKSwarmChildTerminal(port);
 console.log(JSON.stringify({kind:'callback-late-unknown-stays-held',getters,traps,nativeTerminalOnly:true,coreCloseAttempted:false}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/callback-late-unknown-stays-held/);
 assert.match(result.stdout,/"event":"reaped"[^\n]*"unknown":true/);
});
