import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createOwnedKSwarmBusiness,prepareOwnedKSwarmBusinessHello,assertOwnedKSwarmBusinessHelloCurrent} from '../../../src/runtime/conversation-activity/owned-kswarm-business.js';
import * as businessModule from '../../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {createOwnedKSwarmPrefixV2Client,createKSwarmOwnedControl} from '../../../src/runtime/conversation-activity/owned-kswarm-control.js';

const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},protocol='kswarm_dispatch_business_v1',instance='c'.repeat(64);
const cleanups:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(options:{admit?:boolean;hold?:boolean;raw?:(frame:any)=>unknown;admitHook?():void;currentHook?():void}={}){
 const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null}) as unknown as ChildProcess;
 const owner={},proof={},signal=new AbortController();let live=true,calls=0;const sent:any[]=[],held:Array<()=>void>=[];
 Object.defineProperty(child,'send',{value:(frame:any,callback:(error:null)=>void)=>{
  sent.push(frame);const common={protocol,nonce:frame.nonce,scope,instance};
  if(frame.type==='hello')child.emit('message',{...common,type:'hello_ack'});
  else if(frame.type==='request')child.emit('message',{...common,type:'response',id:frame.id,op:frame.op,projectId:frame.projectId,result:{ok:true,value:{id:'p'}}});
  else child.emit('message',{...common,type:'prefix_drained',throughId:frame.throughId,sealNonce:frame.sealNonce});
  if(options.hold&&frame.type==='request')held.push(()=>callback(null));else callback(null);
  return options.raw?options.raw(frame):true;
 },configurable:true});
 const client=createOwnedKSwarmBusiness({child,scope,serviceOwner:owner,isCurrent:()=>{options.currentHook?.();return live;},...(options.admit===false?{}:{admit(candidate,audience){calls++;options.admitHook?.();if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('fixture_denied');}})});
 const context={requestSource:'user' as const,admission:proof,signal:signal.signal};
 return{child,client,context,sent,held,signal,revoke(){live=false;},calls:()=>calls};
}
describe('original owned KSwarm business client',()=>{
 it('identifies only an original validated remote failure without inspecting copied or Proxy errors',async()=>{
  const read=(businessModule as any).readOwnedKSwarmBusinessRemoteError;expect(read).toBeTypeOf('function');let hooks=0;
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
  const f=fixture({admit:false}),hello=await prepareOwnedKSwarmBusinessHello(f.client);expect(hello.boot).toBe(instance);
  expect(()=>assertOwnedKSwarmBusinessHelloCurrent(f.client,{...hello})).toThrow();assertOwnedKSwarmBusinessHelloCurrent(f.client,hello);
  await expect(f.client.readPlan('p',f.context)).rejects.toThrow();await f.client.sealAndDrainPrefix();expect(()=>assertOwnedKSwarmBusinessHelloCurrent(f.client,hello)).toThrow();
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
  const f=fixture();expect(()=>createOwnedKSwarmBusiness({child:f.child,scope,serviceOwner:{},isCurrent:()=>true})).toThrow(/ALREADY/);
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
  const f=fixture({hold:true});await prepareOwnedKSwarmBusinessHello(f.client);
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
  const f=fixture();await prepareOwnedKSwarmBusinessHello(f.client);const next=prepareOwnedKSwarmBusinessHello(f.client);f.client.seal();await expect(next).rejects.toThrow();await f.client.sealAndDrainPrefix();
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

async function originalProcess(){
 const root=mkdtempSync(join(tmpdir(),'dsh-business-client-')),entry=resolve('../../kswarm/test/fixtures/owned-default-dispatch-business/entry.js');
 const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe','ipc'],env:{...process.env,DISPATCH_BUSINESS_TEST_ROOT:root}});
 let output='',closed=false;child.stdout!.on('data',chunk=>{output+=String(chunk);});child.stderr!.on('data',chunk=>{output+=String(chunk);});
 const close=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(yes=>child.once('close',(code,signal)=>{closed=true;yes({code,signal});}));
 cleanups.push(async()=>{
  let forced=false;if(!closed)child.stdin!.write('close\n');
  const timer=setTimeout(()=>{if(!closed){forced=true;child.kill('SIGTERM');}},2000);
  const emergency=setTimeout(()=>{if(!closed){forced=true;child.kill('SIGKILL');}},4000);
  const result=await close;clearTimeout(timer);clearTimeout(emergency);console.log(JSON.stringify({fixture:'business-client-original-child',pid:child.pid,...result,forced,notProductionClose:true}));rmSync(root,{recursive:true,force:true});
  expect(forced,output).toBe(false);expect(result.code,output).toBe(0);
 });
 const ready=await new Promise<any>((yes,no)=>{
  const timer=setTimeout(()=>no(Error('original child ready timeout: '+output)),5000);
  const onMessage=(frame:any)=>{if(frame.protocol==='fixture_ready'){clearTimeout(timer);child.off('message',onMessage);yes(frame);}};child.on('message',onMessage);child.once('error',error=>{clearTimeout(timer);no(error);});
 });
 const proof={},owner={},client=createOwnedKSwarmBusiness({child,scope,serviceOwner:owner,isCurrent:()=>!closed&&child.connected===true,
  admit(candidate,audience){if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('fixture_denied');}});
 return{root,child,closed:close,client,context:{requestSource:'user' as const,admission:proof,signal:new AbortController().signal},ready};
}
it('uses original Node/SQLite Hub for capture, stable reuse and historical read with both config siblings',async()=>{
 for(const version of [1,2]){
  const f=await originalProcess(),configuration=version===2?createOwnedKSwarmPrefixV2Client({child:f.child,scope}):createKSwarmOwnedControl({child:f.child,scope,serviceOwner:{},isCurrent:()=>true,admit(){}});
  const plan:any=await f.client.readPlan('p',f.context);expect(plan.ok).toBe(true);
  const capture:any=await f.client.captureDefaultDispatch('p',f.ready.localFact,f.context);expect(capture.ok).toBe(true);
  const reused=await f.client.captureDefaultDispatch('p',f.ready.localFact,f.context);expect(reused).toEqual(capture);
  const history=await f.client.readOperation('p',{planRevision:f.ready.localFact.planRevision,dispatchGeneration:f.ready.localFact.dispatchGeneration},f.context);expect(history).toEqual(capture);
  const inspection:any=version===2?await (configuration as ReturnType<typeof createOwnedKSwarmPrefixV2Client>).inspectWriter():await (configuration as ReturnType<typeof createKSwarmOwnedControl>).call('inspect_writer',f.context);
  expect(inspection.ok).toBe(true);await f.client.sealAndDrainPrefix();
  if(version===2)await (configuration as ReturnType<typeof createOwnedKSwarmPrefixV2Client>).sealAndDrainPrefix();else await (configuration as ReturnType<typeof createKSwarmOwnedControl>).sealAndDrainTransport();
 }
},15000);

for(const mode of ['commit-before','commit-after','post-bookkeeping'])it('preserves actual original Server '+mode+' and joins its parent callback after EXIT75',async()=>{
 const seed=await originalProcess();await seed.client.readPlan('p',seed.context);await seed.client.sealAndDrainPrefix();seed.child.stdin!.write('close\n');expect((await seed.closed).code).toBe(0);
 const serverRoot=resolve('../../kswarm'),child=spawn(process.execPath,['-r',join(serverRoot,'test/fixtures/owned-default-dispatch-business/sdk-preload.cjs'),join(serverRoot,'src/server/index.js')],{
  cwd:serverRoot,stdio:['pipe','pipe','pipe','ipc'],env:{...process.env,HOME:seed.root,USERPROFILE:seed.root,XIAOK_CONFIG_DIR:join(seed.root,'config'),KSWARM_DATA_ROOT:seed.root,KSWARM_PORT:'0',BROKER_URL:'http://127.0.0.1:9',KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId,XIAOK_DISABLE_GLOBAL_PLUGINS:'1',DISPATCH_BUSINESS_SDK_MODE:mode},
 });
 let output='',closed=false;child.stdout!.on('data',chunk=>{output+=String(chunk);});child.stderr!.on('data',chunk=>{output+=String(chunk);});
 const close=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(yes=>child.once('close',(code,signal)=>{closed=true;yes({code,signal});}));
 cleanups.push(async()=>{let forced=false;const timer=setTimeout(()=>{if(!closed){forced=true;child.kill('SIGKILL');}},2000);const result=await close;clearTimeout(timer);console.log(JSON.stringify({fixture:'business-client-actual-server',pid:child.pid,...result,forced,notProductionClose:true}));expect(forced,output).toBe(false);expect(result.code,output).toBe(75);});
 const send=child.send!.bind(child);let release:(()=>void)|undefined;Object.defineProperty(child,'send',{value:(frame:any,callback:any)=>send(frame,error=>{if(frame.type==='request'&&frame.op==='capture_default_dispatch')release=()=>callback(error);else callback(error);}),configurable:true});
 const owner={},proof={},client=createOwnedKSwarmBusiness({child,scope,serviceOwner:owner,isCurrent:()=>!closed&&child.connected===true,admit(candidate,audience){if(candidate!==proof||audience.projectId!=='p'||audience.serviceOwner!==owner)throw Error('fixture_denied');}}),context={requestSource:'user' as const,admission:proof,signal:new AbortController().signal};
 expect((await client.readPlan('p',context) as any).ok).toBe(true);let caught:any;const work=client.captureDefaultDispatch('p',seed.ready.localFact,context).catch(error=>{caught=error;});
 expect((await close).code,output).toBe(75);await work;
 let done=false;const drain=client.sealAndDrainPrefix().then(()=>{done=true;},()=>{done=true;});
 try{expect(caught).toMatchObject({remoteError:{durableCommitted:mode==='post-bookkeeping'}});expect(caught.remoteError.code).toBe(mode==='post-bookkeeping'?'persistence_post_commit_failure':'DISPATCH_BUSINESS_REMOTE_ERROR');await new Promise(resolve=>setTimeout(resolve,20));expect(release).toBeTypeOf('function');expect(done).toBe(false);}finally{release?.();await drain;}
},15000);

it('does not send after the request timer SDK revokes the original signal',async()=>{
 const f=fixture();await prepareOwnedKSwarmBusinessHello(f.client);const original=setTimeout;let cuts=0;
 globalThis.setTimeout=((...args:any[])=>{const timer=Reflect.apply(original,globalThis,args);if(args[1]===30000&&!cuts++){f.signal.abort(Error('timer SDK revoked original signal'));}return timer;}) as typeof setTimeout;
 try{await expect(f.client.readPlan('p',f.context)).rejects.toThrow();expect(cuts).toBeGreaterThan(0);expect(f.sent.filter(frame=>frame.type==='request')).toHaveLength(0);}finally{globalThis.setTimeout=original;await f.client.sealAndDrainPrefix().catch(()=>{});}
});

it('does not reject close before a held callback when the SDK invalidates the ambient Promise species',async()=>{
 const original=Object.getOwnPropertyDescriptor(Promise,Symbol.species)!;let closing:Promise<void>|undefined;
 const f=fixture({hold:true,raw(frame){if(frame.type==='request'){Object.defineProperty(Promise,Symbol.species,{configurable:true,value:Promise});try{closing=f.client.sealAndDrainPrefix();}finally{Object.defineProperty(Promise,Symbol.species,original);}}return true;}});
 const call=f.client.readPlan('p',f.context).catch(()=>{});let done=false;for(let n=0;n<100&&!closing;n++)await new Promise(yes=>setTimeout(yes,1));expect(closing).toBeDefined();const close=closing!.then(()=>{done=true;},()=>{done=true;});
 try{await new Promise(yes=>setTimeout(yes,20));expect(done).toBe(false);}finally{f.held[0]!();await call;await close;}
});
