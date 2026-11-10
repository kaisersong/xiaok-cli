// Controlled source/SDK transport tests; no NativeMain or Host IO qualification.
import {expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import * as module from '../../../src/runtime/conversation-activity/owned-canonical-business.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},protocol='activity_dispatch_business_v1',boot='c'.repeat(64);
function fixture({deferProducer=false,holdAck=false,holdHello=false,holdBasis=false,basisRaw,proofOverride,observeHook,sealHook,resolveHook,custodyOverride,currentHook}:{deferProducer?:boolean;holdAck?:boolean;holdHello?:boolean;holdBasis?:boolean;basisRaw?:unknown;proofOverride?:object;observeHook?:(observer:(value:unknown)=>void)=>unknown;sealHook?:(observer:(value:unknown)=>void)=>unknown;resolveHook?:(binding:any)=>unknown;custodyOverride?:object;currentHook?:()=>void}={}){
 const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null}) as unknown as ChildProcess,owner={},proof=proofOverride??Object.freeze({}),custody=custodyOverride??Object.freeze(Object.create(null)),signal=new AbortController(),sent:any[]=[];
 let cutSent=false;let observer:((value:any)=>void)|undefined,releaseAck:(()=>void)|undefined,sourceReads=0,closed=false;let releaseHello:(()=>void)|undefined,releaseBasis:(()=>void)|undefined;
 const source={resolveWork(candidate:object,audience:any){sourceReads++;if(candidate!==proof||audience.projectId!=='p'||audience.serviceOwner!==owner)throw Error('original_work_required');const binding={workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};return resolveHook?resolveHook(binding):binding;},observeWork(actual:object,callback:(value:any)=>void){if(actual!==custody)throw Error('original_custody_required');observer=value=>{if(value?.disposition==='no_ack'||value?.disposition==='ack_registered')cutSent=true;callback(value);};return observeHook?.(observer);},sealWork(actual:object){if(actual!==custody)throw Error('original_custody_required');closed=true;if(sealHook)return sealHook(observer!);if(!deferProducer&&!cutSent)observer?.({disposition:'no_ack'});}};
 const admission=(candidate:object,audience:any)=>{if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('original_work_required');if(closed&&audience.operation!=='read_prepare_call'&&audience.operation!=='ack_prepared')throw Error('original_work_closed');};
 Object.defineProperty(child,'send',{value:(frame:any,callback:(error:null)=>void)=>{
  sent.push(frame);const common={protocol,scope,mainLaunchNonce:'e'.repeat(64),daemonBoot:boot,ownerEpoch:'fixture-owner',connectionIncarnation:'6'.repeat(64),targetGeneration:1,childBoot:'7'.repeat(64)};
  if(frame.type==='probe')child.emit('message',{...common,type:'hello_ack'});
  else if(frame.type==='request')child.emit('message',{...common,type:'response',id:frame.id,op:frame.op,projectId:frame.projectId,...(frame.family?{family:frame.family,workId:frame.workId,sourceIncarnation:frame.sourceIncarnation}:{}),result:{ok:true}});
  else child.emit('message',{...common,type:'prefix_drained',throughId:frame.throughId,sealNonce:frame.sealNonce});
  if(holdBasis&&frame.op==='read_preparation_basis')releaseBasis=()=>callback(null);else if(holdHello&&(frame.type==='hello'||frame.type==='probe'))releaseHello=()=>callback(null);else if(holdAck&&frame.op==='ack_prepared')releaseAck=()=>callback(null);else callback(null);return frame.op==='read_preparation_basis'&&basisRaw!==undefined?basisRaw:true;
 }});
 const client=module.createOwnedCanonicalBusiness({child,scope,serviceOwner:owner,mainLaunchNonce:'e'.repeat(64),ownerEpoch:'fixture-owner',isCurrent:()=>{currentHook?.();return true;},preparationSource:source,preparationAdmission:admission} as any);
 const get=(module as any).readOwnedCanonicalPreparationFacet;
 return{client,source,admission,proof,sent,signal,child,get,get sourceReads(){return sourceReads;},facet(){expect(get).toBeTypeOf('function');return get(client,source,admission);},open(){return this.facet().openWork('p',{childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)},{requestSource:'scheduler',preparationProof:proof,signal:signal.signal});},complete(cut:any){observer?.(cut);},release(){releaseAck?.();const callback=releaseBasis;releaseBasis=undefined;callback?.();},releaseHello(){releaseHello?.();}};
}
it('keeps a private preparation facet on the same actual client and refuses wrong source identities before getters',()=>{
 const f=fixture();expect(f.facet()).toBe(f.facet());let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('forbidden');}});
 expect(()=>f.get({...f.client},f.source,f.admission)).toThrow();expect(()=>f.get(f.client,fake,f.admission)).toThrow();expect(()=>f.get(f.client,f.source,()=>{})).toThrow();expect(getters).toBe(0);expect(f.sent).toHaveLength(0);
});
it('does not treat an aborted original Work as a continuing accepted binding',async()=>{
 const f=fixture({deferProducer:true}),work=f.open(),binding=module.readOwnedCanonicalPreparationWorkBinding(f.client,f.source,f.admission,work),reason=Error('original Work cancelled');binding.assertCurrent();f.signal.abort(reason);expect(()=>binding.assertCurrent()).toThrow(reason);f.complete({disposition:'no_ack'});await f.client.sealAndDrainPrefix();
});
it('joins the actual setup SDK raw after an early negative Work reply without waiting for its own producer cut',async()=>{
 const f=fixture({deferProducer:true}),work=f.open(),binding=module.readOwnedCanonicalPreparationWorkBinding(f.client,f.source,f.admission,work);let release!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),on=f.child.on;let injected=false;
 f.child.on=function(...args:any[]){Reflect.apply(on,this,args);if(!injected){injected=true;return held;}return this;} as any;
 await expect(work.readBasis()).rejects.toThrow();expect(injected).toBe(true);let known=false;const joined=binding.waitKnown().then(()=>{known=true;});
 try{await delay(15);expect(known).toBe(false);}finally{release();await joined;f.complete({disposition:'no_ack'});await f.client.sealAndDrainPrefix().catch(()=>{});}expect(known).toBe(true);
});
it('keeps negative reply physical callback and send raw independent of its producer',async()=>{
 let releaseRaw!:()=>void;const raw=new Promise<void>(yes=>{releaseRaw=yes;}),f=fixture({deferProducer:true,holdBasis:true,basisRaw:raw}),work=f.open(),binding=module.readOwnedCanonicalPreparationWorkBinding(f.client,f.source,f.admission,work);
 await expect(work.readBasis()).rejects.toThrow();let known=false;const joined=binding.waitKnown().then(()=>{known=true;});
 try{await delay(15);expect(known).toBe(false);expect(()=>binding.assertKnown()).toThrow();f.release();await delay(15);expect(known).toBe(false);expect(()=>binding.assertKnown()).toThrow();}
 finally{f.release();releaseRaw();await joined;f.complete({disposition:'no_ack'});await f.client.sealAndDrainPrefix().catch(()=>{});}expect(known).toBe(true);binding.assertKnown();
});
it('retains this Work input SDK raw after refusing its logical operation',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),f=fixture({deferProducer:true}),work=f.open(),binding=module.readOwnedCanonicalPreparationWorkBinding(f.client,f.source,f.admission,work);
 await expect(work.prepareIntent({inputSdk:raw})).rejects.toThrow();let known=false;const joined=binding.waitKnown().then(()=>{known=true;});
 try{await delay(15);expect(known).toBe(false);expect(()=>binding.assertKnown()).toThrow();}
 finally{release();await joined;f.complete({disposition:'no_ack'});await f.client.sealAndDrainPrefix().catch(()=>{});}expect(known).toBe(true);
});
it('keeps a failed original opening proof associated with its own client after another client rejects the same proof',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),proof=Object.freeze({}),first=fixture({proofOverride:proof,resolveHook:()=>raw}),second=fixture({proofOverride:proof,resolveHook:()=>{throw Error('second original Source refused');}});
 expect(()=>first.open()).toThrow();const original=module.readOwnedCanonicalPreparationWorkBinding(first.client,first.source,first.admission,proof);let known=false;void original.waitKnown().then(()=>{known=true;});
 try{expect(()=>second.open()).toThrow();const retained=module.readOwnedCanonicalPreparationWorkBinding(first.client,first.source,first.admission,proof);expect(retained.waitKnown).toBe(original.waitKnown);await delay(15);expect(known).toBe(false);}
 finally{release();await second.client.sealAndDrainPrefix().catch(()=>{});}await delay(1);expect(known).toBe(false); // First original Source returned an invalid raw: permanently unconfirmed, no Native resources in this fixture.
});
it('binds one opaque work across all five closed preparation operations without changing the user variant',async()=>{
 const f=fixture(),work=f.open();await work.readBasis();await work.prepareIntent({target:'controlled'});await work.admitSend({preparationIntentDigest:'3'.repeat(64),sourceIncarnation:'f'.repeat(64)});await work.readCall({admissionId:'controlled',preparationIntentDigest:'3'.repeat(64)});await work.acknowledge({preparationIntentDigest:'3'.repeat(64),fact:{controlled:true}});f.complete({disposition:'ack_registered'});await f.client.sealAndDrainPrefix();
 expect(f.sourceReads).toBe(1);expect(f.sent.filter(row=>row.type==='request').map(row=>row.op)).toEqual(['read_preparation_basis','prepare_intent','admit_send','read_prepare_call','ack_prepared']);for(const frame of f.sent.filter(row=>row.type==='request'))expect(frame).toMatchObject({family:'preparation',workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64)});expect(f.sent.at(-1).throughId).toBe(5);
});
it('joins an accepted future ACK producer before choosing final prefix and still waits its held callback',async()=>{
 const f=fixture({deferProducer:true,holdAck:true}),work=f.open();await work.readBasis();await work.prepareIntent({target:'controlled'});await work.admitSend({preparationIntentDigest:'3'.repeat(64),sourceIncarnation:'f'.repeat(64)});let done=false;const close=f.client.sealAndDrainPrefix().then(()=>{done=true;});
 try{await delay(10);expect(f.sent.some(row=>row.type==='seal_prefix')).toBe(false);await expect(work.prepareIntent({late:true})).rejects.toThrow();await work.readCall({admissionId:'controlled',preparationIntentDigest:'3'.repeat(64)});const ack=work.acknowledge({preparationIntentDigest:'3'.repeat(64),fact:{controlled:true}});await delay(10);f.complete({disposition:'ack_registered'});await delay(10);expect(done).toBe(false);f.release();await ack;await close;expect(f.sent.find(row=>row.type==='seal_prefix').throughId).toBe(5);}finally{f.release();f.complete({disposition:'no_ack'});await close.catch(()=>{});}
});
it('refuses non-scheduler contexts and copied proofs without transport SDK entry',()=>{
 const f=fixture(),facet=f.facet();for(const context of [{requestSource:'user',preparationProof:f.proof,signal:f.signal.signal},{requestSource:'agent',preparationProof:f.proof,signal:f.signal.signal},{requestSource:'scheduler',preparationProof:{},signal:f.signal.signal}])expect(()=>facet.openWork('p',{childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)},context)).toThrow();expect(f.sent).toHaveLength(0);
});
it('rejects a producer ACK cut before an actual ACK send has entered the inventory',async()=>{
 const f=fixture({deferProducer:true}),work=f.open();await work.readBasis();f.complete({disposition:'ack_registered'});await expect(work.readCall({})).rejects.toThrow();expect(f.sent.filter(row=>row.type==='request')).toHaveLength(1);expect(f.sent.some(row=>row.type==='seal_prefix')).toBe(false);
});
it('does not let a synchronous no-ACK cut hide an unknown observer registration return',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
 const f=fixture({observeHook(observer){observer({disposition:'no_ack'});return raw;}});expect(()=>f.open()).toThrow('SOURCE_RETURN_UNCONFIRMED');let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});
 await delay(10);expect(closed).toBe(false);expect(f.sent).toHaveLength(0);release();await delay(10);expect(closed).toBe(false);
});
it('does not let a synchronous no-ACK cut hide a seal SDK throw',async()=>{
 const f=fixture({sealHook(observer){observer({disposition:'no_ack'});throw undefined;}});f.open();let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});await delay(10);expect(closed).toBe(false);expect(f.sent).toHaveLength(0);
});
it('refuses a second open for the original proof and does not reread the Source',async()=>{
 const f=fixture();f.open();expect(()=>f.open()).toThrow('WORK_ALREADY_OPEN');expect(f.sourceReads).toBe(1);await f.client.sealAndDrainPrefix();
});

it('retains a late callback raw even after the Source has closed its publisher frontier',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
 const f=fixture({observeHook(observer){observer({disposition:'no_ack'});observer(raw);}});expect(()=>f.open()).toThrow();let closed=false,healthy=false;const close=f.client.sealAndDrainPrefix().then(()=>{closed=true;healthy=true;},()=>{closed=true;});
 try{await delay(10);expect(closed).toBe(false);expect(f.sent.some(row=>row.type==='seal_prefix')).toBe(false);}finally{release();await close;}expect(healthy).toBe(false);
});

it('reserves the ACK once before waiting for a held original hello callback',async()=>{
 const f=fixture({holdHello:true}),work=f.open();const first=work.acknowledge({fact:'controlled'}),second=work.acknowledge({fact:'controlled'});let secondRejected=false;const secondDone=second.then(()=>{},()=>{secondRejected=true;});await delay(10);f.releaseHello();await first;await secondDone;expect(secondRejected).toBe(true);expect(f.sent.filter(row=>row.op==='ack_prepared')).toHaveLength(1);f.complete({disposition:'ack_registered'});await f.client.sealAndDrainPrefix();
});

it('does not accept a held SDK Promise disguised with the three binding data fields',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});const f=fixture({resolveHook(binding){return Object.assign(raw,binding);}});let rejected=false;try{f.open();}catch{rejected=true;}let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});try{await delay(10);expect({rejected,closed}).toEqual({rejected:true,closed:false});expect(f.sent).toHaveLength(0);}finally{release();}
});

it('defers a reentrant seal until the actual Source custody and observer are installed',async()=>{
 let seals=0;const f=fixture({resolveHook(binding){f.client.seal();return binding;},sealHook(observer){seals++;observer({disposition:'no_ack'});}});expect(()=>f.open()).toThrow();expect(seals).toBe(1);await f.client.sealAndDrainPrefix();
});

it('refuses an actual SDK Promise used as the Source opaque custody handle',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});const f=fixture({custodyOverride:raw});let rejected=false;try{f.open();}catch{rejected=true;}let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});try{await delay(10);expect({rejected,closed}).toEqual({rejected:true,closed:false});expect(f.sent).toHaveLength(0);}finally{release();}
});

it('rejects the Native Promise brand even when custody is frozen with a null prototype',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});Object.setPrototypeOf(raw,null);Object.freeze(raw);const f=fixture({custodyOverride:raw});let rejected=false;try{f.open();}catch{rejected=true;}let closed=false;void f.client.sealAndDrainPrefix().then(()=>{closed=true;},()=>{closed=true;});try{await delay(10);expect({rejected,closed}).toEqual({rejected:true,closed:false});}finally{release();}
});

it('preserves an actual endpoint late fault without requiring an RPC to be pending',async()=>{
 const f=fixture(),work=f.open();await work.readBasis();const remote={name:'Error',message:'original late body failure',code:'CONTROLLED_SDK_FAILURE',durableCommitted:false};f.child.emit('message',{protocol,type:'fault',error:remote});f.complete({disposition:'no_ack'});const error:any=await f.client.sealAndDrainPrefix().catch(error=>error);expect(module.readOwnedCanonicalBusinessRemoteError(error.errors[0])).toEqual(remote);
});

it('keeps a private preparation hello current through normal seal and rejects a copied source or retired session',async()=>{
 const f=fixture(),hello=await module.prepareOwnedCanonicalBusinessHello(f.client),assertCurrent=(module as any).assertOwnedCanonicalPreparationHelloCurrent;expect(assertCurrent).toBeTypeOf('function');let reads=0;const fake=new Proxy({},{get(){reads++;throw Error('forbidden');}});
 expect(()=>assertCurrent(f.client,fake,f.admission,hello)).toThrow();expect(()=>assertCurrent(f.client,f.source,f.admission,{...hello})).toThrow();expect(reads).toBe(0);f.client.seal();assertCurrent(f.client,f.source,f.admission,hello);await f.client.sealAndDrainPrefix();expect(()=>assertCurrent(f.client,f.source,f.admission,hello)).toThrow();
});

it('preserves the original failure observed inside its final preparation current SDK',async()=>{
 const original=Error('original current SDK failure');let armed=false;const f=fixture({currentHook(){if(armed){armed=false;f.child.emit('error',original);}}}),hello=await module.prepareOwnedCanonicalBusinessHello(f.client);armed=true;let observed:unknown;try{(module as any).assertOwnedCanonicalPreparationHelloCurrent(f.client,f.source,f.admission,hello);}catch(error){observed=error;}expect(observed).toBe(original);await f.client.sealAndDrainPrefix().catch(()=>{});
});
