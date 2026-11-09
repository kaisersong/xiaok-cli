// Controlled source/SDK transport tests; no NativeMain or Host IO qualification.
import {expect,it} from 'vitest';
import {createHook} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import * as lower from '../../../src/runtime/conversation-activity/owned-kswarm-business.js';
import * as canonical from '../../../src/runtime/conversation-activity/owned-canonical-business.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},boot='c'.repeat(64);
function fixture(module:any,protocol:string,{hostSource=true,holdRegister=false,resolveHostHook,finishHook,deferProducer=false,holdAck=false,holdHello=false,holdBasis=false,basisRaw,proofOverride,observeHook,sealHook,resolveHook,custodyOverride,currentHook}:{hostSource?:boolean;holdRegister?:boolean;resolveHostHook?:(data:any)=>any;finishHook?:()=>void;deferProducer?:boolean;holdAck?:boolean;holdHello?:boolean;holdBasis?:boolean;basisRaw?:unknown;proofOverride?:object;observeHook?:(observer:(value:unknown)=>void)=>unknown;sealHook?:(observer:(value:unknown)=>void)=>unknown;resolveHook?:(binding:any)=>unknown;custodyOverride?:object;currentHook?:()=>void}={}){
 const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null}) as unknown as ChildProcess,owner={},proof=proofOverride??Object.freeze({}),custody=custodyOverride??Object.freeze(Object.create(null)),signal=new AbortController(),sent:any[]=[];
 let releaseRegister:(()=>void)|undefined;let cutSent=false;let observer:((value:any)=>void)|undefined,releaseAck:(()=>void)|undefined,sourceReads=0,closed=false;let releaseHello:(()=>void)|undefined,releaseBasis:(()=>void)|undefined;
 const source={resolveWork(candidate:object,audience:any){sourceReads++;if(candidate!==proof||audience.projectId!=='p'||audience.serviceOwner!==owner)throw Error('original_work_required');const binding={workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};return resolveHook?resolveHook(binding):binding;},observeWork(actual:object,callback:(value:any)=>void){if(actual!==custody)throw Error('original_custody_required');observer=value=>{if(value?.disposition==='no_ack'||value?.disposition==='ack_registered'||value?.disposition==='host_no_effect_registered')cutSent=true;callback(value);};return observeHook?.(observer);},sealWork(actual:object){if(actual!==custody)throw Error('original_custody_required');closed=true;if(sealHook)return sealHook(observer!);if(!deferProducer&&!cutSent)observer?.({disposition:'no_ack'});}};
 const registration={scope,projectId:'p',childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64),admissionId:'original-admission',preparationIntentDigest:'3'.repeat(64),sourceIncarnation:'f'.repeat(64),hostLeaseKey:'4'.repeat(64)};
 const settlement={resolveRegistration(actual:object,audience:any){if(actual!==custody||audience.operation!=='register_host'||audience.serviceOwner!==owner)throw Error('foreign_host_source');return resolveHostHook?resolveHostHook(registration):{data:registration,assertCurrent(){}};},resolveNoEffectSettlement(actual:object,audience:any){if(actual!==custody||audience.operation!=='finish_host_no_effect'||audience.serviceOwner!==owner)throw Error('foreign_host_source');finishHook?.();return {data:{scope,projectId:'p',registrationDigest:'5'.repeat(64),hostLeaseKey:'4'.repeat(64),sourceIncarnation:'f'.repeat(64),reason:'cancelled'},assertCurrent(){}};}};
 const admission=(candidate:object,audience:any)=>{if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('original_work_required');if(closed&&audience.operation!=='read_prepare_call'&&audience.operation!=='ack_prepared')throw Error('original_work_closed');};
 Object.defineProperty(child,'send',{value:(frame:any,callback:(error:null)=>void)=>{
  sent.push(frame);const common=module===lower?{protocol,scope,nonce:frame.nonce,instance:boot}:{protocol,scope,mainLaunchNonce:'e'.repeat(64),daemonBoot:boot,ownerEpoch:'fixture-owner',connectionIncarnation:'6'.repeat(64),targetGeneration:1,childBoot:'7'.repeat(64)};
  if(frame.type==='hello'||frame.type==='probe')child.emit('message',{...common,type:'hello_ack'});
  else if(frame.type==='request')child.emit('message',{...common,type:'response',id:frame.id,op:frame.op,projectId:frame.projectId,...(frame.family?{family:frame.family,workId:frame.workId,sourceIncarnation:frame.sourceIncarnation}:{}),result:{ok:true}});
  else child.emit('message',{...common,type:'prefix_drained',throughId:frame.throughId,sealNonce:frame.sealNonce});
  if(holdRegister&&frame.op==='register_host')releaseRegister=()=>callback(null);else if(holdBasis&&frame.op==='read_preparation_basis')releaseBasis=()=>callback(null);else if(holdHello&&(frame.type==='hello'||frame.type==='probe'))releaseHello=()=>callback(null);else if(holdAck&&frame.op==='ack_prepared')releaseAck=()=>callback(null);else callback(null);return frame.op==='read_preparation_basis'&&basisRaw!==undefined?basisRaw:true;
 }});
 const client=(module.createOwnedKSwarmBusiness??module.createOwnedCanonicalBusiness)({child,scope,serviceOwner:owner,mainLaunchNonce:'e'.repeat(64),ownerEpoch:'fixture-owner',isCurrent:()=>{currentHook?.();return true;},preparationSource:source,preparationAdmission:admission,...(hostSource?{hostSettlementSource:settlement}:{})} as any);
 const get=(module.readOwnedKSwarmPreparationFacet??module.readOwnedCanonicalPreparationFacet);
 return{client,settlement,source,admission,proof,sent,signal,child,get,get sourceReads(){return sourceReads;},facet(){expect(get).toBeTypeOf('function');return get(client,source,admission);},open(){return this.facet().openWork('p',{childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)},{requestSource:'scheduler',preparationProof:proof,signal:signal.signal});},complete(cut:any){observer?.(cut);},release(){releaseRegister?.();releaseAck?.();const callback=releaseBasis;releaseBasis=undefined;callback?.();},releaseHello(){releaseHello?.();}};
}

for(const [label,module,protocol] of [['lower',lower,'kswarm_dispatch_business_v1'],['canonical',canonical,'activity_dispatch_business_v1']] as const){
 const make=(options:Parameters<typeof fixture>[2]={})=>fixture(module,protocol,options);
 it(label+': default-denies both Host methods without a fixed settlement Source before transport',async()=>{
  const f=make({hostSource:false}),work=f.open();expect(work.registerHost).toBeTypeOf('function');expect(work.finishHostNoEffect).toBeTypeOf('function');
  await expect(work.registerHost()).rejects.toThrow('HOST_SOURCE_REQUIRED');await expect(work.finishHostNoEffect()).rejects.toThrow('HOST_SOURCE_REQUIRED');expect(f.sent).toHaveLength(0);await f.client.sealAndDrainPrefix();
 });
 it(label+': joins the prior registration callback before issuing finish, excluding its own operation',async()=>{
  const f=make({deferProducer:true,holdRegister:true}),work=f.open();const registered=work.registerHost();await delay(1);let done=false;const finish=work.finishHostNoEffect().then(()=>{done=true;});
  try{await delay(15);expect(done).toBe(false);expect(f.sent.some(row=>row.op==='finish_host_no_effect')).toBe(false);f.release();await registered;await finish;expect(f.sent.filter(row=>row.type==='request').map(row=>row.op)).toEqual(['register_host','finish_host_no_effect']);f.complete({disposition:'host_no_effect_registered'});await f.client.sealAndDrainPrefix();}finally{f.release();}
 });
 it(label+': settles the original Host after seal and abort without invoking effect admission',async()=>{
  const f=make({deferProducer:true}),work=f.open();await work.registerHost();f.client.seal();f.signal.abort(Error('cancelled'));await work.finishHostNoEffect();f.complete({disposition:'host_no_effect_registered'});await f.client.sealAndDrainPrefix();expect(f.sent.at(-1).throughId).toBe(2);
 });
 it(label+': a no-ACK cut cannot erase a registered Host',async()=>{
  const f=make({deferProducer:true}),work=f.open();await work.registerHost();f.complete({disposition:'no_ack'});let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});await delay(15);expect(closed).toBe(false);expect(f.sent.some(row=>row.type==='seal_prefix')).toBe(false);
 });
 it(label+': observes a nested Promise own SDK sibling even after its parent settles',async()=>{
  const ids=new WeakMap<object,number>();let heldId=-1,observed=0,release!:()=>void;const hook=createHook({init(id,type,trigger,resource){if(type==='PROMISE'){ids.set(resource,id);if(trigger===heldId)observed++;}}});hook.enable();
  const held=new Promise<void>(yes=>{release=yes;});heldId=ids.get(held)!;const parent=Object.assign(Promise.resolve(),{[Symbol('nested original SDK raw')]:held});
  const f=make({deferProducer:true,resolveHostHook(data){return Object.assign(Object.create({foreign:true}),{data,assertCurrent(){},parent});}}),work=f.open();
  try{await expect(work.registerHost()).rejects.toThrow();expect(observed).toBeGreaterThan(0);expect(f.sent).toHaveLength(0);}finally{release();hook.disable();}
 });
 for(const variant of ['foreign-envelope','assertion-error'])it(label+': observes actual raw SDK siblings in '+variant+' before refusing',async()=>{
  const ids=new WeakMap<object,number>();let heldId=-1,observed=0,release!:()=>void;const hook=createHook({init(id,type,trigger,resource){if(type==='PROMISE'){ids.set(resource,id);if(trigger===heldId)observed++;}}});hook.enable();
  const held=new Promise<void>(yes=>{release=yes;});heldId=ids.get(held)!;
  const f=make({deferProducer:true,resolveHostHook(data){if(variant==='foreign-envelope')return Object.assign(Object.create({foreign:true}),{data,assertCurrent(){},held});return{data,assertCurrent(){throw Object.assign(Error('actual Source assertion failure'),{[Symbol('actual raw SDK sibling')]:held});}};}}),work=f.open();
  try{await expect(work.registerHost()).rejects.toThrow();expect(observed).toBeGreaterThan(0);expect(f.sent).toHaveLength(0);}finally{release();hook.disable();}
 });
 it(label+': does not lose a synchronous resolver producer cut or send after it',async()=>{
  const f=make({deferProducer:true,resolveHostHook(data){f.complete({disposition:'no_ack'});return{data,assertCurrent(){}};}}),work=f.open();await expect(work.registerHost()).rejects.toThrow();expect(f.sent).toHaveLength(0);
 });
 it(label+': checks the stopped effect branch after a final Source reentrant finish',async()=>{
  let count=0,work:any,second:Promise<unknown>|undefined;const f=make({deferProducer:true,resolveHostHook(data){return{data,assertCurrent(){if(++count===3){second=work.finishHostNoEffect();void second?.catch(()=>{});}}};}});work=f.open();await expect(work.registerHost()).rejects.toThrow();await second?.catch(()=>{});expect(f.sent.some(row=>row.op==='register_host')).toBe(false);
 });
 it(label+': refuses an unqualified ACK before consuming the registered Host terminal slot',async()=>{
  const f=make({deferProducer:true}),work=f.open();await work.registerHost();await expect(work.acknowledge({preparationIntentDigest:'3'.repeat(64),fact:{controlled:true}})).rejects.toThrow('HOST_EFFECT_PERMISSION_UNAVAILABLE');expect(f.sent.some(row=>row.op==='ack_prepared')).toBe(false);await work.finishHostNoEffect();f.complete({disposition:'host_no_effect_registered'});await f.client.sealAndDrainPrefix();
 });
 it(label+': keeps both constructor Source methods fixed after their public slots change',async()=>{
  const f=make({deferProducer:true}),work=f.open();let late=0;for(const name of ['resolveRegistration','resolveNoEffectSettlement'])f.settlement[name as keyof typeof f.settlement]=(()=>{late++;throw Error('late Source slot');}) as any;
  await work.registerHost();await work.finishHostNoEffect();f.complete({disposition:'host_no_effect_registered'});await f.client.sealAndDrainPrefix();expect(late).toBe(0);
 });
 it(label+': rejects mismatched original registration data before transport SDK',async()=>{
  const f=make({deferProducer:true,resolveHostHook(data){return{data:{...data,sourceIncarnation:'9'.repeat(64)},assertCurrent(){}};}}),work=f.open();await expect(work.registerHost()).rejects.toThrow('HOST_DATA_INVALID');expect(f.sent).toHaveLength(0);
 });
 it(label+': retains raw Source siblings before refusing an accessor envelope without calling it',async()=>{
  let release!:()=>void,reads=0;const held=new Promise<void>(yes=>{release=yes;}),f=make({deferProducer:true,resolveHostHook(data){return Object.defineProperty({data,assertCurrent(){},raw:held},'then',{get(){reads++;throw Error('forbidden');}});}}),work=f.open();
  await expect(work.registerHost()).rejects.toThrow();let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});try{await delay(15);expect(closed).toBe(false);expect(reads).toBe(0);expect(f.sent).toHaveLength(0);}finally{release();}await delay(1);expect(closed).toBe(false);
 });
 it(label+': reserves finish before Source reentry',async()=>{
  let second:Promise<unknown>|undefined,work:any;const f=make({deferProducer:true,finishHook(){second=work.finishHostNoEffect();void second?.catch(()=>{});}});work=f.open();await work.registerHost();await work.finishHostNoEffect();await expect(second).rejects.toThrow('HOST_FINISH_ALREADY_REGISTERED');expect(f.sent.filter(row=>row.op==='finish_host_no_effect')).toHaveLength(1);f.complete({disposition:'host_no_effect_registered'});await f.client.sealAndDrainPrefix();
 });
}
