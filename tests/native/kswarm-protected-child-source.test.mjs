import test from 'node:test';
import assert from 'node:assert/strict';
import {runKSwarmProtectedSourceFixture} from './helpers/kswarm-protected-source-fixture.mjs';

test('fixed Source fate joins the original Native child and all Main callback tails before negative close', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);
 const sentinel=Error('original listener failure');let release,exited;
 const tail=new Promise(resolve=>{release=resolve;}),observedExit=new Promise(resolve=>{exited=resolve;});
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 child.once('exit',()=>{exited();throw sentinel;});child.once('close',()=>tail);
 await observedExit;let settled=false;const closing=source.closeOriginalProtectedKSwarmChild(port);closing.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setTimeout(resolve,40));assert.equal(settled,false,'held close callback must remain owned');
 const fate=source.readOptionalOriginalProtectedKSwarmChildPortFate(port);assert.ok(fate);assert.throws(()=>fate.assertPhysicalKnown());
 release();await assert.rejects(closing,raw=>raw===sentinel);await fate.waitPhysicalKnown();fate.assertPhysicalKnown();
 assert.equal(source.readOptionalOriginalProtectedKSwarmChildPortFate(Object.freeze({})),null);
 api.assertOriginalKSwarmChildTerminal(port);const closed=api.componentCloseOriginalCoreForBudget(issuer);
 assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'ks-source-owned-tail',pid:process.pid,heldUntilReleased:true,firstCauseIdentity:true,rootFilesClosed:closed.rootFilesClosed,unknown:closed.unknown}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/"kind":"ks-source-owned-tail"/);
});

test('an entered original Native client keeps negative finish reachable before its JS reference publishes', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('consume_ref_failure',`
 const child=await source.createOriginalProtectedKSwarmChild(port);child.stdout.on('data',bytes=>process.stdout.write(bytes));child.stderr.on('data',bytes=>process.stderr.write(bytes));
 await new Promise(resolve=>child.once('exit',resolve));await source.closeOriginalProtectedKSwarmChild(port);source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown();
 assert.equal(child.exitCode,0);const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'ks-failed-consume-negative-fate',rootFilesClosed:closed.rootFilesClosed,unknown:closed.unknown}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/"kind":"ks-consume-negative-before-reference"/);
});

test('fixed negative close escalates an actual SIGTERM-ignoring child without treating its deadline as known', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('ignore_term_after_finish',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let ready;const started=new Promise(resolve=>{ready=resolve;});
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.on('message',message=>{if(message.kind==='ks-original-ignore-term-ready')ready();});await started;
 const before=process.hrtime.bigint(),closing=source.closeOriginalProtectedKSwarmChild(port);
 const observed=await Promise.race([closing.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),6000))]);
 // Failure cleanup still uses the same owned private child, never a PID search.
 if(!observed){child.kill('SIGKILL');await closing;}
 assert.equal(observed,true,'actual child must be joined after the original five-second grace');
 assert.equal(child.signalCode,'SIGKILL');source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown();
 const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 console.log(JSON.stringify({kind:'ks-source-real-escalation',pid:process.pid,signal:child.signalCode,elapsedMs:Number(process.hrtime.bigint()-before)/1e6,rootFilesClosed:closed.rootFilesClosed,unknown:closed.unknown}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/"kind":"ks-source-real-escalation"/);
});

test('fixed Native bootstrap consumes birth before config and runs the original server with protected persistence', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('server',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let ready,failed,output='',errors='';
 const started=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
 child.stdout.on('data',bytes=>{output+=bytes.toString('utf8');if(output.includes('KSwarm API server started on port 0'))ready();});
 child.stderr.on('data',bytes=>{errors+=bytes.toString('utf8');});child.once('exit',()=>{if(!output.includes('KSwarm API server started on port 0'))failed(Error('original server exited before ready: '+errors));});
 child.send({kind:'original_kswarm_start_v1',environment:{XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR,KSWARM_DATA_ROOT:require('node:path').join(require('node:path').dirname(__filename),'business'),KSWARM_PORT:'0',BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_PROFILE_ID:'a'.repeat(64),KSWARM_DESKTOP_WORKSPACE_ID:'b'.repeat(64)}});
 await started;await source.closeOriginalProtectedKSwarmChild(port);source.readOriginalProtectedKSwarmChildPhysicalFate(child).assertKnown();
 const closed=api.componentCloseOriginalCoreForBudget(issuer);assert.equal(closed.rootFilesClosed,true);assert.equal(closed.unknown,false);
 assert.equal(require('node:fs').existsSync(require('node:path').join(require('node:path').dirname(__filename),'business/state.sqlite')),false);
 console.log(JSON.stringify({kind:'ks-source-original-server',pid:process.pid,originalServerStarted:true,ordinaryPathAbsent:true,rootFilesClosed:closed.rootFilesClosed,unknown:closed.unknown}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/"kind":"ks-source-original-server"/);
});

test('an unknown Main callback result cannot be laundered by a genuine Native terminal child', {skip:process.platform!=='darwin'},async()=>{
 const result=await runKSwarmProtectedSourceFixture('normal',`
 const child=await source.createOriginalProtectedKSwarmChild(port);let getterCalls=0,observed;
 const exited=new Promise(resolve=>{observed=resolve;});
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 const unknown=Object.defineProperty({},'resource',{get(){getterCalls++;return 1;}});
 child.once('exit',()=>{observed();return unknown;});await exited;
 await assert.rejects(source.closeOriginalProtectedKSwarmChild(port));
 const fate=source.readOptionalOriginalProtectedKSwarmChildPortFate(port);assert.ok(fate);
 assert.throws(()=>fate.assertPhysicalKnown());await assert.rejects(fate.waitPhysicalKnown());
 api.assertOriginalKSwarmChildTerminal(port);assert.equal(getterCalls,0);
 console.log(JSON.stringify({kind:'ks-source-unknown-tail',pid:process.pid,getterCalls,sourcePhysicalDenied:true,nativeTerminalOnly:true,coreCloseAttempted:false}));
 `);
 assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/"kind":"ks-source-unknown-tail"/);
 assert.match(result.stdout,/"event":"reaped"[^\n]*"unknown":true/,'exit zero is not a known Core close');
});
