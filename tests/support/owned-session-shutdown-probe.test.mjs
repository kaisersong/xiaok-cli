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
 const before=source.slice(0,source.indexOf('  async suspend():'));
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

const physicalFailure=leaf=>new AggregateError([leaf],'agent_model_physical_drain_unconfirmed');
const serviceFailure=(idle,close)=>new AggregateError([idle,close],'multi_agent_cleanup_unconfirmed',{cause:idle});
function captureIdle(idle){const p=createOwnedSessionShutdownProbe(),session={};p.register(session);p.suspendFailure(session,idle);return p.snapshot(session).suspendFailures;}
test('suspend observer retains every original nullable and opaque value without reading it and marks duplicate capture unknown',()=>{
 let touched=0;const opaque=new Proxy({},{get(){touched++;throw Error('read');},getOwnPropertyDescriptor(){touched++;throw Error('read');}});
 for(const value of [undefined,null,opaque]){const p=createOwnedSessionShutdownProbe(),session={};p.register(session);p.suspendFailure(session,value);const snapshot=p.snapshot(session);assert.equal(snapshot.suspendFailures.length,1);assert.equal(snapshot.suspendFailures[0].error,value);assert.equal(snapshot.observerErrors,0);p.suspendFailure(session,value);assert.equal(p.snapshot(session).suspendFailures.length,2);assert.ok(p.quality().observerErrors>0);}
 const p=createOwnedSessionShutdownProbe();assert.doesNotThrow(()=>p.suspendFailure({},opaque));assert.ok(p.quality().observerErrors>0);assert.equal(touched,0);
});
test('double physical service shape requires the single original suspend capture and exact ordered references',()=>{
 const F=Error('F'),close=physicalFailure(F),idle=physicalFailure(F),S=serviceFailure(idle,close),physical={error:close},captures=captureIdle(idle);
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,S,captures,F),true);
 for(const c of [undefined,[],[captures[0],captures[0]],captureIdle(close)])assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,S,c,F),false);
 for(const bad of [serviceFailure(close,idle),new AggregateError([idle,close,Error('U')],'multi_agent_cleanup_unconfirmed',{cause:idle}),new AggregateError([idle,close],'multi_agent_cleanup_unconfirmed',{cause:close})])assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,bad,captures,F),false);
 for(const slot of ['finally_session_stop','finally_host_stop'])assert.equal(isKnownOwnedSessionServiceStopFailure(slot,true,physical,S,captures,F),false);
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',false,physical,S,captures,F),false);
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,S,captures,Error('different F')),false);
 assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,S,captures),false);
 const noLeafClose=physicalFailure(undefined),noLeafIdle=physicalFailure(undefined);assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,{error:noLeafClose},serviceFailure(noLeafIdle,noLeafClose),captureIdle(noLeafIdle),undefined),false);
 const single=new AggregateError([close],'multi_agent_cleanup_unconfirmed',{cause:close});assert.equal(isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,physical,single),true);
});
test('double physical classifier rejects every malformed level without touching unknown getters or Proxy traps',()=>{
 const F=Error('F'),close=physicalFailure(F),idle=physicalFailure(F),captures=captureIdle(idle);let touched=0;
 const check=(p,i,s,c=captures)=>isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,{error:p},s,c,F);
 for(const level of ['close','idle','service'])for(const key of ['message','cause','errors','stack']){
  const p=physicalFailure(F),i=physicalFailure(F),s=serviceFailure(i,p),target=level==='close'?p:level==='idle'?i:s;Object.defineProperty(target,key,{get(){touched++;throw Error('getter');}});assert.equal(check(p,i,s,captureIdle(i)),false);
 }
 for(const level of ['close','idle','service']){
  const p=physicalFailure(F),i=physicalFailure(F),s=serviceFailure(i,p);const proxy=new Proxy(level==='close'?p:level==='idle'?i:s,{get(){touched++;throw Error('proxy');},getOwnPropertyDescriptor(){touched++;throw Error('proxy');},ownKeys(){touched++;throw Error('proxy');},getPrototypeOf(){touched++;throw Error('proxy');}});
  assert.equal(check(level==='close'?proxy:p,level==='idle'?proxy:i,level==='service'?proxy:s,captureIdle(level==='idle'?proxy:i)),false);
 }
 const c=physicalFailure(F),i=physicalFailure(F);c.errors.push(Error('U'));assert.equal(check(c,i,serviceFailure(i,c),captureIdle(i)),false);
 for(const mode of ['sparse','extra','symbol','nonarray','prototype']){
  const p=physicalFailure(F),i=physicalFailure(F),s=serviceFailure(i,p);
  if(mode==='sparse')delete s.errors[0];if(mode==='extra')s.errors.extra=F;if(mode==='symbol')s.errors[Symbol('extra')]=F;if(mode==='nonarray')s.errors={0:i,1:p,length:2};if(mode==='prototype')Object.setPrototypeOf(i,Error.prototype);
  assert.equal(check(p,i,s,captureIdle(i)),false);
 }
 const getterCapture={get error(){touched++;throw Error('capture getter');}};assert.equal(check(close,idle,serviceFailure(idle,close),[getterCapture]),false);assert.equal(touched,0);
});
test('the actual transformed suspend catch preserves its original rejection when observation is unknown',async()=>{
 const source=readFileSync(new URL('../../'+OWNED_SESSION_SOURCE.path,import.meta.url),'utf8'),url=new URL('../../desktop/tests/fixtures/owned-session-shutdown-probe.mjs',import.meta.url).href;
 const changed=instrumentOwnedSessionShutdown(source,url);assert.equal(changed.split('observeOwnedSessionSuspendFailure(this, error);').length-1,1);
 const start=changed.indexOf('  async suspend(): Promise<void> {'),end=changed.indexOf('  deactivate():',start);assert.ok(start>=0&&end>start);
 const body=changed.slice(start,end).trim().replace('async suspend(): Promise<void>','async function suspend()');
 const p=createOwnedSessionShutdownProbe();const invoke=Function('waitDesktopModelPhysicalIdle','observeOwnedSessionSuspendFailure','return ('+body+');')(()=>Promise.reject(undefined),(session,error)=>p.suspendFailure(session,error));
 let caught=false,value=Symbol('not set');try{await invoke.call({running:undefined,modelPhysicalScope:{},scope:undefined});}catch(error){caught=true;value=error;}
 assert.equal(caught,true);assert.equal(value,undefined);assert.ok(p.quality().observerErrors>0);assert.equal(restoreOwnedSessionShutdown(changed,url),source);
});

test('double physical stack accepts data or exact same native accessor and rejects changed getter setter or flags without touching them',()=>{
 const nativeStack=Object.getOwnPropertyDescriptor(new AggregateError([],'native stack descriptor only'),'stack');
 const nativeAccessor=!!nativeStack&&!Object.hasOwn(nativeStack,'value')&&Object.hasOwn(nativeStack,'get')&&Object.hasOwn(nativeStack,'set');
 const F=Error('F');let touched=0;
 const accepts=(close,idle,service)=>isKnownOwnedSessionServiceStopFailure('finally_service_stop',true,{error:close},service,captureIdle(idle),F);
 for(const level of ['close','idle','service']){
  for(const form of ['absent','data']){
   const close=physicalFailure(F),idle=physicalFailure(F),service=serviceFailure(idle,close),target=level==='close'?close:level==='idle'?idle:service;
   if(form==='absent')delete target.stack;
   else Object.defineProperty(target,'stack',{value:'fixed data value is never read',writable:true,enumerable:false,configurable:true});
   assert.equal(accepts(close,idle,service),true);
  }
  if(nativeAccessor){
   const close=physicalFailure(F),idle=physicalFailure(F),service=serviceFailure(idle,close),target=level==='close'?close:level==='idle'?idle:service;
   Object.defineProperty(target,'stack',{get:nativeStack.get,set:nativeStack.set,enumerable:nativeStack.enumerable,configurable:nativeStack.configurable});
   assert.equal(accepts(close,idle,service),true);
  }
  for(const changed of ['get','set','enumerable','configurable']){
   const close=physicalFailure(F),idle=physicalFailure(F),service=serviceFailure(idle,close),target=level==='close'?close:level==='idle'?idle:service;
   const descriptor={get:nativeAccessor?nativeStack.get:undefined,set:nativeAccessor?nativeStack.set:undefined,enumerable:nativeAccessor?nativeStack.enumerable:false,configurable:nativeAccessor?nativeStack.configurable:true};
   if(changed==='get')descriptor.get=()=>{touched++;throw Error('user stack getter');};
   if(changed==='set')descriptor.set=()=>{touched++;throw Error('user stack setter');};
   if(changed==='enumerable')descriptor.enumerable=!descriptor.enumerable;
   if(changed==='configurable')descriptor.configurable=!descriptor.configurable;
   Object.defineProperty(target,'stack',descriptor);
   assert.equal(accepts(close,idle,service),false);
  }
 }
 assert.equal(touched,0);
});
