import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createOwnedCanonicalBusiness,prepareOwnedCanonicalBusinessHello,assertOwnedCanonicalBusinessHelloCurrent} from '../../../src/runtime/conversation-activity/owned-canonical-business.js';
import * as businessModule from '../../../src/runtime/conversation-activity/owned-canonical-business.js';
import {createOwnedKSwarmPrefixV2Client,createKSwarmOwnedControl} from '../../../src/runtime/conversation-activity/owned-kswarm-control.js';

const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},protocol='activity_dispatch_business_v1',instance='c'.repeat(64);
const cleanups:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(options:{admit?:boolean;hold?:boolean;raw?:(frame:any)=>unknown;admitHook?():void;currentHook?():void}={}){
 const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null}) as unknown as ChildProcess;
 const owner={},proof={},signal=new AbortController();let live=true,calls=0;const sent:any[]=[],held:Array<()=>void>=[];
 Object.defineProperty(child,'send',{value:(frame:any,callback:(error:null)=>void)=>{
  sent.push(frame);const common={protocol,scope,mainLaunchNonce:'e'.repeat(64),daemonBoot:'d'.repeat(64),ownerEpoch:'original-epoch',connectionIncarnation:'f'.repeat(64),targetGeneration:1,childBoot:instance};
  if(frame.type==='probe')child.emit('message',{...common,type:'hello_ack'});
  else if(frame.type==='request')child.emit('message',{...common,type:'response',id:frame.id,op:frame.op,projectId:frame.projectId,result:{ok:true,value:{id:'p'}}});
  else child.emit('message',{...common,type:'prefix_drained',throughId:frame.throughId,sealNonce:frame.sealNonce});
  if(options.hold&&frame.type==='request')held.push(()=>callback(null));else callback(null);
  return options.raw?options.raw(frame):true;
 },configurable:true});
 const client=createOwnedCanonicalBusiness({child,scope,mainLaunchNonce:'e'.repeat(64),ownerEpoch:'original-epoch',serviceOwner:owner,isCurrent:()=>{options.currentHook?.();return live;},...(options.admit===false?{}:{admit(candidate,audience){calls++;options.admitHook?.();if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('fixture_denied');}})});
 const context={requestSource:'user' as const,admission:proof,signal:signal.signal};
 return{child,client,context,sent,held,signal,revoke(){live=false;},calls:()=>calls};
}
describe('fixed canonical business client SDK custody',()=>{
 it('identifies only an original validated remote failure without inspecting copied or Proxy errors',async()=>{
  const read=(businessModule as any).readOwnedCanonicalBusinessRemoteError;expect(read).toBeTypeOf('function');let hooks=0;
  const remote={name:'Error',message:'original remote',code:'persistence_post_commit_failure',durableCommitted:true},fake=Object.assign(Error('fake'),{remoteError:remote});
  expect(read(fake)).toBeUndefined();expect(read(new Proxy(fake,{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}}))).toBeUndefined();expect(hooks).toBe(0);
  const f=fixture();f.child.prependListener('message',(frame:any)=>{if(frame.type==='response'){delete frame.result;frame.error=remote;}});
  const error=await f.client.readPlan('p',f.context).catch(error=>error);expect(read(error)).toEqual(remote);expect(read(Object.assign(Error('copy'),error))).toBeUndefined();
  await f.client.sealAndDrainPrefix().catch(()=>{});
 });
 it('defaults to deny and refuses non-user or copied proof before any producer SDK',async()=>{
  const denied=fixture({admit:false});await expect(denied.client.readPlan('p',denied.context)).rejects.toThrow();expect(denied.sent).toHaveLength(0);
  const f=fixture();for(const context of [{...f.context,requestSource:'agent' as const},{...f.context,admission:{}}])await expect(f.client.readPlan('p',context)).rejects.toThrow();expect(f.sent).toHaveLength(0);
 });
 it('performs the fixed hello and three operations, then authenticates its exact prefix',async()=>{
  const f=fixture();await expect(f.client.readPlan('p',f.context)).resolves.toMatchObject({ok:true});
  await f.client.captureDefaultDispatch('p',{action:'test-data'},f.context);await f.client.readOperation('p',{planRevision:1,dispatchGeneration:1},f.context);
  expect(f.sent.filter(row=>row.type==='request').map(row=>row.op)).toEqual(['read_plan','capture_default_dispatch','read_operation']);
  await f.client.sealAndDrainPrefix();expect(f.sent.at(-1).throughId).toBe(3);expect(f.child.listenerCount('message')).toBe(0);
 });
 it('keeps a reply distinct from the original held send callback',async()=>{
  const f=fixture({hold:true});let done=false;const work=f.client.readPlan('p',f.context).then(()=>{done=true;},error=>{done=true;return error;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);expect(f.held).toHaveLength(1);
  let drained=false;const drain=f.client.sealAndDrainPrefix().then(()=>{drained=true;},()=>{drained=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(drained).toBe(false);f.held[0]!();await Promise.all([work,drain]);
 });
 it('brands an original hello observation independently from a business proof',async()=>{
  const f=fixture({admit:false}),hello=await prepareOwnedCanonicalBusinessHello(f.client);expect(hello.boot).toBe(instance);
  expect(()=>assertOwnedCanonicalBusinessHelloCurrent(f.client,{...hello})).toThrow();assertOwnedCanonicalBusinessHelloCurrent(f.client,hello);
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();await f.client.sealAndDrainPrefix();expect(()=>assertOwnedCanonicalBusinessHelloCurrent(f.client,hello)).toThrow();
 });
 it('rejects a Proxy context without running its traps or starting SDK work',async()=>{
  const f=fixture();let hooks=0;const raw=new Proxy({},{get(){hooks++;throw Error('trap');},ownKeys(){hooks++;throw Error('trap');}});
  await expect(f.client.readPlan('p',raw as any)).rejects.toThrow();expect(hooks).toBe(0);expect(f.sent).toHaveLength(0);
 });
 it('never reads shadowed methods on a genuine Native AbortSignal',async()=>{
  const f=fixture();let hooks=0;
  for(const name of ['addEventListener','removeEventListener','throwIfAborted','reason','aborted'])Object.defineProperty(f.context.signal,name,{get(){hooks++;throw Error('shadow method');},configurable:true});
  await expect(f.client.readPlan('p',f.context)).resolves.toMatchObject({ok:true});await f.client.sealAndDrainPrefix();expect(hooks).toBe(0);
 });
 it('joins a known SDK raw and held callback before reporting an invalid send return',async()=>{
  let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),f=fixture({hold:true,raw:frame=>frame.type==='request'?raw:true});
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);release();await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);
  expect(f.sent.filter(row=>row.type==='request')).toHaveLength(1);f.held[0]!();await drain;
 });
 it('reports an unknown raw only after joining its known sibling callback',async()=>{
  const unknown=Object.create(null),f=fixture({hold:true,raw:frame=>frame.type==='request'?unknown:true});
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);f.held[0]!();await drain;expect(done).toBe(true);
 });
 it('cannot create a second independent business hello on the same original child',()=>{
  const f=fixture();expect(()=>createOwnedCanonicalBusiness({child:f.child,scope,mainLaunchNonce:'e'.repeat(64),ownerEpoch:'original-epoch',serviceOwner:{},isCurrent:()=>true})).toThrow(/ALREADY/);
 });
 it('does not leak its private wire Root through a prototype setter installed by an admission seam',async()=>{
  let hooks=0;const previous=Object.getOwnPropertyDescriptor(Object.prototype,'frame');
  const f=fixture({admitHook(){Object.defineProperty(Object.prototype,'frame',{configurable:true,set(value){hooks++;if(value.type==='request'){value.op='capture_default_dispatch';value.input={substituted:true};}Object.defineProperty(this,'frame',{value,writable:true,configurable:true,enumerable:true});}});}});
  try{await f.client.readPlan('p',f.context);expect(f.sent.find(row=>row.type==='request').op).toBe('read_plan');expect(hooks).toBe(0);await f.client.sealAndDrainPrefix();}
  finally{if(previous)Object.defineProperty(Object.prototype,'frame',previous);else delete (Object.prototype as any).frame;}
 });
 it('never sends a business request after any final current seam aborts the original signal',async()=>{
  for(let cut=1;cut<=35;cut++){
   let currentCalls=0,aborted=false;let f:ReturnType<typeof fixture>;
   f=fixture({currentHook(){if(++currentCalls===cut){aborted=true;f.signal.abort(Error('original abort'));}}});
   const send=f.child.send!;let sendsAfterAbort=0;Object.defineProperty(f.child,'send',{value:(frame:any,callback:any)=>{if(aborted&&frame.type==='request')sendsAfterAbort++;return Reflect.apply(send,f.child,[frame,callback]);},configurable:true});
   await f.client.readPlan('p',f.context).catch(()=>{});expect(sendsAfterAbort,'current seam '+cut).toBe(0);
   await f.client.sealAndDrainPrefix().catch(()=>{});
  }
 });
 it('classifies a malformed response as unknown while still joining a known held SDK callback',async()=>{
  const f=fixture({hold:true});await prepareOwnedCanonicalBusinessHello(f.client);
  // Corrupt the actual captured SDK's publication, before our original reader.
  f.child.prependListener('message',(frame:any)=>{if(frame.type==='response')frame.op='wrong';});
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);f.held[0]!();await drain;expect(done).toBe(true);
 });
 it('never reads an inherited Promise constructor while a producer reenters close',async()=>{
  const previous=Object.getOwnPropertyDescriptor(Promise.prototype,'constructor')!;let hooks=0,drain:Promise<void>|undefined;
  const f=fixture({raw(frame){if(frame.type==='request'){
   Object.defineProperty(Promise.prototype,'constructor',{configurable:true,get(){hooks++;return Promise;}});
   try{drain=f.client.sealAndDrainPrefix();}finally{Object.defineProperty(Promise.prototype,'constructor',previous);}
  }return true;}});
  await f.client.readPlan('p',f.context).catch(()=>{});expect(hooks).toBe(0);await drain?.catch(()=>{});
 });
 it('does not deliver a cached hello after that individual observation was sealed',async()=>{
  const f=fixture();await prepareOwnedCanonicalBusinessHello(f.client);const next=prepareOwnedCanonicalBusinessHello(f.client);f.client.seal();await expect(next).rejects.toThrow();await f.client.sealAndDrainPrefix();
 });
 it('keeps the original held SDK callback known even when send subsequently throws',async()=>{
  const f=fixture({hold:true,raw(frame){if(frame.type==='request')throw Error('original SDK threw after effect');return true;}});
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);f.held[0]!();await drain;
 });
 for(const mode of ['input','sdk'])it('rejects an unsafe '+mode+' Proxy without descriptor traps and keeps known callbacks',async()=>{
  let hooks=0;const raw=new Proxy({},{getOwnPropertyDescriptor(){hooks++;return undefined;},getPrototypeOf(){hooks++;return Object.prototype;},get(){hooks++;return undefined;}});
  const f=fixture({hold:mode==='sdk',raw:frame=>mode==='sdk'&&frame.type==='request'?raw:true});
  await expect(mode==='input'?f.client.captureDefaultDispatch('p',raw,f.context):f.client.readPlan('p',f.context)).rejects.toThrow();expect(hooks).toBe(0);
  const drain=f.client.sealAndDrainPrefix().catch(()=>{});if(mode==='sdk')f.held[0]!();await drain;expect(hooks).toBe(0);
 });
 it('refuses post-seal calls before capturing new input tails',async()=>{
  const f=fixture();await f.client.readPlan('p',f.context);f.client.seal();let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
  await expect(f.client.captureDefaultDispatch('p',raw,f.context)).rejects.toThrow();let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
  try{await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(true);}finally{release();await drain;}
 });
 for(const name of ['on','off','send'])it('rejects a bound async '+name+' SDK before its body',async()=>{
  const f=fixture();let bodies=0;Object.defineProperty(f.child,name,{value:(async()=>{bodies++;return f.child;}).bind(f.child),configurable:true});
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow(/SYNCHRONOUS/);await f.client.sealAndDrainPrefix().catch(()=>{});expect(bodies).toBe(0);expect(f.sent).toHaveLength(0);
 });
});

for(const name of ['mainLaunchNonce','daemonBoot','ownerEpoch','connectionIncarnation','targetGeneration','childBoot'])it('rejects a substituted canonical '+name+' before exposing a business reply',async()=>{
 const f=fixture();await prepareOwnedCanonicalBusinessHello(f.client);f.child.prependListener('message',(frame:any)=>{if(frame.type==='response')frame[name]=name==='targetGeneration'?2:'0'.repeat(64);});
 await expect(f.client.readPlan('p',f.context)).rejects.toThrow(/PROTOCOL/);await f.client.sealAndDrainPrefix().catch(()=>{});
});
it('keeps actual unavailable remote cause and the held probe callback independent',async()=>{
 const f=fixture();let release!:()=>void;const remote={name:'Error',message:'no owned target',code:'TARGET_NOT_OWNED',durableCommitted:false};
 Object.defineProperty(f.child,'send',{configurable:true,value:(frame:any,callback:any)=>{f.sent.push(frame);release=()=>callback(null);f.child.emit('message',{protocol,type:'unavailable',scope,mainLaunchNonce:frame.mainLaunchNonce,error:remote});return true;}});
 const error=await f.client.readPlan('p',f.context).catch(error=>error);expect(businessModule.readOwnedCanonicalBusinessRemoteError(error)).toEqual(remote);
 let done=false;const close=f.client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});await new Promise(yes=>setTimeout(yes,20));expect(done).toBe(false);release();await close;
});
it('rejects a wrong hello owner epoch rather than accepting the daemon role alone',async()=>{
 const f=fixture();f.child.prependListener('message',(frame:any)=>{if(frame.type==='hello_ack')frame.ownerEpoch='foreign-epoch';});
 await expect(prepareOwnedCanonicalBusinessHello(f.client)).rejects.toThrow(/PROTOCOL/);expect(f.sent.filter(frame=>frame.type==='request')).toHaveLength(0);await f.client.sealAndDrainPrefix().catch(()=>{});
});

it('does not send after the request timer SDK revokes the original signal',async()=>{
 const f=fixture();await prepareOwnedCanonicalBusinessHello(f.client);const original=setTimeout;let cuts=0;
 globalThis.setTimeout=((...args:any[])=>{const timer=Reflect.apply(original,globalThis,args);if(args[1]===30000&&!cuts++){f.signal.abort(Error('timer SDK revoked original signal'));}return timer;}) as typeof setTimeout;
 try{await expect(f.client.readPlan('p',f.context)).rejects.toThrow();expect(cuts).toBeGreaterThan(0);expect(f.sent.filter(frame=>frame.type==='request')).toHaveLength(0);}finally{globalThis.setTimeout=original;await f.client.sealAndDrainPrefix().catch(()=>{});}
});

it('does not reject close before a held callback when the SDK invalidates the ambient Promise species',async()=>{
 const original=Object.getOwnPropertyDescriptor(Promise,Symbol.species)!;let closing:Promise<void>|undefined;
 const f=fixture({hold:true,raw(frame){if(frame.type==='request'){Object.defineProperty(Promise,Symbol.species,{configurable:true,value:Promise});try{closing=f.client.sealAndDrainPrefix();}finally{Object.defineProperty(Promise,Symbol.species,original);}}return true;}});
 const call=f.client.readPlan('p',f.context).catch(()=>{});let done=false;for(let n=0;n<100&&!closing;n++)await new Promise(yes=>setTimeout(yes,1));expect(closing).toBeDefined();const close=closing!.then(()=>{done=true;},()=>{done=true;});
 try{await new Promise(yes=>setTimeout(yes,20));expect(done).toBe(false);}finally{f.held[0]!();await call;await close;}
});
