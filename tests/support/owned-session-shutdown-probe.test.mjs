import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOwnedSessionShutdownProbe,isKnownOwnedSessionServiceStopFailure} from '../../desktop/tests/fixtures/owned-session-shutdown-probe.mjs';
import {instrumentOwnedSessionShutdown,restoreOwnedSessionShutdown,OWNED_SESSION_SOURCE} from '../../desktop/tests/fixtures/owned-session-shutdown-loader.mjs';

test('observer invokes the real expression once and returns the same Promise without a reaction',()=>{
 let species=0,calls=0;class Original extends Promise{static get [Symbol.species](){species++;throw Error('no observer reaction');}}
 const original=new Original(()=>{}),session={},probe=createOwnedSessionShutdownProbe();probe.register(session);
 assert.equal(probe.stop(session,'execution',()=>{calls++;return original;}),original);
 const state=probe.snapshot(session);assert.equal(calls,1);assert.equal(species,0);
 assert.equal(state.events[0].raw,original);assert.equal(state.events[0].returned,true);assert.equal(state.observerErrors,0);
});
test('original synchronous nullable and opaque thrown values retain exact identity',()=>{
 for(const error of [undefined,null,new Proxy({},{get(){throw Error('opaque');},getOwnPropertyDescriptor(){throw Error('opaque');}})]){
  const session={},probe=createOwnedSessionShutdownProbe();probe.register(session);let caught=false,value;
  try{probe.stop(session,'transport',()=>{throw error;});}catch(e){caught=true;value=e;}
  assert.equal(caught,true);assert.equal(value,error);const event=probe.snapshot(session).events[0];
  assert.equal(event.returned,false);assert.equal(event.error,error);
 }
});
test('observer never reads a returned then getter or interprets an error message',()=>{
 let reads=0;const original={get then(){reads++;throw Error('private');}};
 const probe=createOwnedSessionShutdownProbe(),session={};probe.register(session);
 assert.equal(probe.stop(session,'execution',()=>original),original);assert.equal(reads,0);
 probe.tail(session);assert.deepEqual(probe.snapshot(session).events.map(e=>e.kind),['execution','tail']);
});
test('unregistered or invalid observations keep the business result but quality unknown',()=>{
 const probe=createOwnedSessionShutdownProbe(),session={},original={};let calls=0;
 assert.equal(probe.stop(session,'execution',()=>{calls++;return original;}),original);
 assert.equal(calls,1);assert.ok(probe.quality().observerErrors>0);
 probe.register(session);assert.equal(probe.stop(session,'invalid',()=>original),original);
 assert.ok(probe.snapshot(session).observerErrors>0);
});
test('read-only snapshots cannot corrupt the observer or make it throw into a later stop',()=>{
 const probe=createOwnedSessionShutdownProbe(),session={},original={};probe.register(session);probe.tail(session);
 const state=probe.snapshot(session);assert.equal(Object.isFrozen(state),true);assert.equal(Object.isFrozen(state.events),true);
 assert.equal(Object.isFrozen(state.events[0]),true);
 assert.throws(()=>{state.events[0].kind='transport';},TypeError);
 assert.equal(probe.stop(session,'execution',()=>original),original);
 assert.deepEqual(probe.snapshot(session).events.map(e=>e.kind),['tail','execution']);
});
test('the exact original source reverses byte for byte and only caller stop/tail sites change',()=>{
 const source=readFileSync(new URL('../../'+OWNED_SESSION_SOURCE.path,import.meta.url),'utf8');
 const url=new URL('../../desktop/tests/fixtures/owned-session-shutdown-probe.mjs',import.meta.url).href;
 const changed=instrumentOwnedSessionShutdown(source,url);
 assert.equal(restoreOwnedSessionShutdown(changed,url),source);
 assert.equal(changed.split('observeOwnedSessionStop(this,').length-1,2);
 assert.equal(changed.split('observeOwnedSessionTail(this);').length-1,1);
 const before=source.slice(0,source.indexOf('  private async disposeOwned():'));
 assert.ok(changed.endsWith(source.slice(source.lastIndexOf('\n}'))));
 assert.ok(changed.includes(before));
 assert.throws(()=>instrumentOwnedSessionShutdown(source+'\n',url),/owned_session_probe_source_changed/);
 assert.throws(()=>restoreOwnedSessionShutdown(changed+'\n',url),/owned_session_probe_restore_changed/);
 assert.throws(()=>instrumentOwnedSessionShutdown(source,'https://invalid.example/probe.mjs'),/owned_session_probe_url/);
 assert.equal(fileURLToPath(url).endsWith('owned-session-shutdown-probe.mjs'),true);
});

test('known service stop classifier accepts exactly its original [P] cause P after strict body acceptance',()=>{
 const P=new AggregateError([Error('F')],'agent_model_physical_drain_unconfirmed'),physical={error:P};
 const S=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,S),true);
 assert.equal(S.cause,P);assert.equal(S.errors[0],P);assert.equal(S.errors.length,1);
 for(const slot of ['finally_session_stop','finally_host_stop','retention_record','finally-phase-result'])assert.equal(isKnownOwnedSessionServiceStopFailure(slot,true,physical,S),false);
 for(const accepted of [false,undefined,null])assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',accepted,physical,S),false);
 for(const missing of [undefined,null,{}, {error:undefined},{error:null}])assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,missing,S),false);
});
test('known service stop classifier rejects extra unknown leaves, wrong identity/cause/message and array shape',()=>{
 const P=new AggregateError([Error('F')],'agent_model_physical_drain_unconfirmed'),U=Error('U'),physical={error:P};
 const candidates=[new AggregateError([P,U],'multi_agent_cleanup_unconfirmed',{cause:P}),new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:U}),new AggregateError([U],'multi_agent_cleanup_unconfirmed',{cause:P}),new AggregateError([P],'different',{cause:P}),new AggregateError([P],'multi_agent_cleanup_unconfirmed'),undefined,null,P];
 for(const candidate of candidates)assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,candidate),false);
 const extra=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});extra.errors.extra=U;
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,extra),false);
 const sparse=new AggregateError([],'multi_agent_cleanup_unconfirmed',{cause:P});sparse.errors.length=1;
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,sparse),false);
 const nonarray=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});Object.defineProperty(nonarray,'errors',{value:{0:P,length:1}});
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,nonarray),false);
 const symbol=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});symbol[Symbol('unexpected')]=U;
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,symbol),false);
});
test('known service stop classifier never invokes Proxy or unknown descriptor getters',()=>{
 const P=new AggregateError([Error('F')],'agent_model_physical_drain_unconfirmed'),physical={error:P};let touches=0;
 const opaque=new Proxy(new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P}),{get(){touches++;throw Error('getter');},getOwnPropertyDescriptor(){touches++;throw Error('descriptor');},ownKeys(){touches++;throw Error('keys');},getPrototypeOf(){touches++;throw Error('prototype');}});
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,opaque),false);
 for(const key of ['message','cause','errors']){
  const candidate=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});Object.defineProperty(candidate,key,{get(){touches++;throw Error('getter');}});
  assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,candidate),false);
 }
 const proxyArray=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});Object.defineProperty(proxyArray,'errors',{value:new Proxy([P],{get(){touches++;throw Error('array getter');},getOwnPropertyDescriptor(){touches++;throw Error('array descriptor');}})});
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,proxyArray),false);
 const itemGetter=new AggregateError([P],'multi_agent_cleanup_unconfirmed',{cause:P});Object.defineProperty(itemGetter.errors,'0',{get(){touches++;throw Error('item getter');}});
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,itemGetter),false);
 assert.equal(touches,0);
});
