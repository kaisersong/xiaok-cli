import type {IngressOwner} from './desktop-shutdown-coordinator.js';
import type {BrowserWindow,IpcMainInvokeEvent} from 'electron';
import {types} from 'node:util';
import {createDefaultDispatchUserSource,readDefaultDispatchUserBootstrap,type DefaultDispatchUserFrame,type DefaultDispatchUserBootstrap} from './default-dispatch-user-source.js';
import {readOriginalDefaultDispatchOwner,type MainUserSubmissionOwner,type OriginalDefaultDispatchOwner,type DefaultDispatchAction,type DefaultDispatchObservationSource} from './main-user-submission.js';
import {getKSwarmOwnedBusinessTransport,readKSwarmOwnedBusinessServiceScope,type KSwarmService,type KSwarmOwnedBusinessTransport} from './kswarm-service.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import type {BusinessScope,KSwarmBusinessAdmission,KSwarmBusinessOperation} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {DEFAULT_DISPATCH_CAPTURE_OUTPUT} from '../shared/default-dispatch-ipc-contract.js';
import {captureIpcData} from './ipc-data-snapshot.js';
const P=Promise,then=P.prototype.then,apply=Reflect.apply,freeze=Object.freeze,create=Object.create,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf,setPrototype=Object.setPrototypeOf;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,weakDelete=WeakMap.prototype.delete,own=Object.hasOwn,keys=Object.keys,stringify=JSON.stringify,descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys;
const sort=Array.prototype.sort,join=Array.prototype.join,isArray=Array.isArray,isProxy=types.isProxy,isPromise=types.isPromise,signalAborted=descriptor(AbortSignal.prototype,'aborted')!.get!;
const initialSpecies=descriptor(P,Symbol.species);
const denied=()=>Error('DEFAULT_DISPATCH_BUSINESS_AUTHORITY_REQUIRED');
const inert=<T extends object>(value:T):T=>setPrototype(value,null);
function deferred<T>(){let resolve!:(v:T|PromiseLike<T>)=>void,reject!:(e:unknown)=>void;const promise=new P<T>((yes,no)=>{resolve=yes;reject=no;});define(promise,'constructor',{__proto__:null,value:P} as PropertyDescriptor);return{promise,resolve,reject};}
function owned(raw:unknown):raw is Promise<unknown>{if(!raw||typeof raw!=='object'||isProxy(raw)||!isPromise(raw)||prototype(raw)!==P.prototype||descriptor(raw,'then'))return false;const ctor=descriptor(raw,'constructor'),species=descriptor(P,Symbol.species);return !!ctor&&own(ctor,'value')&&ctor.value===P&&!!species&&!!initialSpecies&&!own(species,'value')&&species.get===initialSpecies.get&&species.set===initialSpecies.set;}
function stable(value:unknown):string{
 if(isArray(value)){const values:string[]=[];for(let i=0;i<value.length;i++)appendIntrinsic(values,stable(value[i]));return '['+apply(join,values,[','])+']';}
 if(value&&typeof value==='object'){const names=keys(value);apply(sort,names,[]);const values:string[]=[];for(let i=0;i<names.length;i++)appendIntrinsic(values,stringify(names[i])+':'+stable((value as Record<string,unknown>)[names[i]!]));return '{'+apply(join,values,[','])+'}';}return stringify(value);
}
const same=(a:BusinessScope,b:BusinessScope)=>a.profileId===b.profileId&&a.workspaceId===b.workspaceId;
interface Invocation {started:boolean;workDone:boolean;released:boolean;ready:boolean;failed:boolean;failure?:unknown;final?:()=>void;release():void;raw?:unknown;completion:Promise<void>;complete():void;frame?:DefaultDispatchUserFrame;port?:KSwarmOwnedBusinessTransport;commands:object[];observation?:object;requests:object[];requestsTaken:boolean}
interface Command {root:Invocation;operation:KSwarmBusinessOperation;projectId:string;input:unknown;current():void}
export interface DefaultDispatchDeliveryInvocation {
 run():Promise<unknown>;assertCurrent():void;fail(error:unknown):void;release():void;
}
export interface DefaultDispatchBusinessController {
 readonly ingress:IngressOwner;readonly observationSource:DefaultDispatchObservationSource;readonly userAdmission:ReturnType<typeof createDefaultDispatchUserSource>['assertAdmission'];readonly businessAdmission:KSwarmBusinessAdmission;
 bindService(service:KSwarmService):void;bindUserOwner(owner:MainUserSubmissionOwner):void;
 openCurrentPlan(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):DefaultDispatchDeliveryInvocation;
 dispatchCurrentPlan(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):Promise<unknown>;
 seal():void;
 /** Input/command/source admission only. Original service/launch-state owners
  * independently join physical transport callbacks/raws before retirement. */
 drain():Promise<void>;
}
export interface DefaultDispatchControllerBootstrap {readonly source:DefaultDispatchUserBootstrap;readonly scope:BusinessScope;assertCurrent():void;assertLocal():void}
interface ControllerIdentity {read(service:object):DefaultDispatchControllerBootstrap;assertService(service:object):void}
const controllers=new WeakMap<object,ControllerIdentity>();
export interface OriginalDefaultDispatchObservationRequestData {readonly scope:BusinessScope;readonly projectId:string;readonly parentId:string;readonly planRevision:number;readonly dispatchGeneration:number;readonly childKey:string;readonly taskId:string;readonly payloadHash:string}
interface ObservationRequest {controller:object;recipient:object;service:object;root:Invocation;data:Readonly<OriginalDefaultDispatchObservationRequestData>;listed:boolean;consumed:boolean;current():void}
const deliveryInvocations=new WeakMap<object,{controller:object;recipient?:object;service:object;root:Invocation}>(),observationRequests=new WeakMap<object,ObservationRequest>();
/** Private normal B-capture provenance. A returned DTO cannot mint requests. */
export function takeOriginalDefaultDispatchObservationRequests(controller:unknown,invocation:unknown,recipient:unknown,service:unknown):readonly object[]{
 const row=invocation&&typeof invocation==='object'?apply(weakGet,deliveryInvocations,[invocation]) as {controller:object;recipient?:object;service:object;root:Invocation}|undefined:undefined;
 if(!row||row.controller!==controller||row.recipient!==recipient||!row.recipient||row.service!==service||row.root.requestsTaken||row.root.released||!row.root.ready||row.root.failed||!row.root.final)throw denied();
 row.root.requestsTaken=true;row.root.final();if(row.root.released||row.root.failed)throw denied();
 const result:object[]=[];for(let i=0;i<row.root.requests.length;i++){const frame=row.root.requests[i]!,request=apply(weakGet,observationRequests,[frame]) as ObservationRequest|undefined;if(!request||request.root!==row.root)throw denied();request.listed=true;appendIntrinsic(result,frame);}return freeze(inert(result));
}
/** Consume before the short user invocation releases. The consumer must reserve
 * its independent Native/Host Root first; these data grant no continuing IO. */
export function consumeOriginalDefaultDispatchObservationRequest(controller:unknown,request:unknown,recipient:unknown,service:unknown):Readonly<{data:Readonly<OriginalDefaultDispatchObservationRequestData>}>{
 const row=request&&typeof request==='object'?apply(weakGet,observationRequests,[request]) as ObservationRequest|undefined:undefined;
 if(!row||row.controller!==controller||row.recipient!==recipient||row.service!==service||!row.listed||row.consumed||row.root.released||row.root.failed)throw denied();
 row.consumed=true;row.current();if(row.root.released||row.root.failed)throw denied();return freeze(inert({data:row.data}));
}
/** Pure original composition membership, before any Native bootstrap SDK. */
export function assertDefaultDispatchControllerService(controller:object,service:object):void{
 const entry=apply(weakGet,controllers,[controller]) as ControllerIdentity|undefined;if(!entry)throw denied();entry.assertService(service);
}
export function readDefaultDispatchControllerBootstrap(controller:object,service:object):DefaultDispatchControllerBootstrap{
 const entry=apply(weakGet,controllers,[controller]) as ControllerIdentity|undefined;if(!entry)throw denied();return entry.read(service);
}
/** Passive Main composition. No Native SDK, service startup, B call, user proof
 * or filesystem journal is produced by construction. */
export function createDefaultDispatchBusinessController(options:{window:BrowserWindow;scope:BusinessScope;isTrustedUrl(url:string):boolean;preparationRecipient?:object}):DefaultDispatchBusinessController{
 if(!options||typeof options!=='object'||isProxy(options))throw denied();const fields=descriptors(options),names=['window','scope','isTrustedUrl'];if(own(fields,'preparationRecipient'))appendIntrinsic(names,'preparationRecipient');if(ownKeys(fields).length!==names.length)throw denied();for(let i=0;i<names.length;i++){const name=names[i]!;if(!own(fields,name))throw denied();const field=fields[name]!;if(!field||!field.enumerable||!own(field,'value'))throw denied();}
 const recipient=own(fields,'preparationRecipient')?fields.preparationRecipient!.value as object:undefined;if(own(fields,'preparationRecipient')&&(!recipient||typeof recipient!=='object'||isProxy(recipient)))throw denied();
 const scope=captureDispatchBusinessData(fields.scope!.value) as BusinessScope,source=createDefaultDispatchUserSource({window:fields.window!.value as BrowserWindow,scope,isTrustedUrl:fields.isTrustedUrl!.value as (url:string)=>boolean});
 if(!scope||keys(scope).length!==2||typeof scope.profileId!=='string'||typeof scope.workspaceId!=='string')throw denied();
 const actor=freeze(inert({requestSource:'user' as const,actorId:'desktop-user:'+scope.profileId}));
 const roots=createIntrinsicSet<Invocation>(),unknown=createIntrinsicSet<unknown>(),commands=new WeakMap<object,Command>(),observations=new WeakMap<object,{data:unknown;assertCurrent():void}>(),failures:unknown[]=[];
 let service:KSwarmService|undefined,binding:OriginalDefaultDispatchOwner|undefined,owner:MainUserSubmissionOwner|undefined,sealed=false,closing:Promise<void>|undefined;
 const observationSource=freeze(inert({resolve(frame:object){const row=apply(weakGet,observations,[frame]) as {data:unknown;assertCurrent():void}|undefined;if(!row)throw denied();row.assertCurrent();return row;}}));
 const userAdmission=source.assertAdmission;
 function local(root?:Invocation){if(sealed||!service||root&&(root.released||!roots.has(root))||root?.frame&&apply(signalAborted,root.frame.signal,[]))throw denied();}
 function serviceLocal(){if(!service)throw denied();const current=readKSwarmOwnedBusinessServiceScope(service,businessAdmission);if(!same(current,scope))throw denied();local();}
 const businessAdmission:KSwarmBusinessAdmission=(proof,audience)=>{
  const row=apply(weakGet,commands,[proof]) as Command|undefined;if(!row)throw denied();
  const data=captureDispatchBusinessData({operation:audience.operation,scope:audience.scope,projectId:audience.projectId,input:audience.input}) as Record<string,any>;
  if(audience.serviceOwner!==service||row.operation!==data.operation||row.projectId!==data.projectId||!same(data.scope,scope)||stable(data.input)!==stable(row.input))throw denied();row.current();local(row.root);binding?.assertLocal();
 };
 function checked<T>(raw:Promise<T>):Promise<T>{if(!owned(raw)){try{assertStandardIpcPromise(raw,'DEFAULT_DISPATCH_BUSINESS_TAIL_UNKNOWN');}catch{unknown.add(raw);throw Error('DEFAULT_DISPATCH_BUSINESS_TAIL_UNKNOWN');}}return raw;}
 function settleInternal(raw:Promise<unknown>,yes:()=>void,no:(error:unknown)=>void){if(!owned(raw)){unknown.add(raw);return;}try{apply(then,raw,[yes,no]);}catch(error){unknown.add(raw);appendIntrinsic(failures,error);}}
 function bindService(candidate:KSwarmService){const candidateScope=readKSwarmOwnedBusinessServiceScope(candidate,businessAdmission);if(sealed||service&&service!==candidate||!same(candidateScope,scope))throw denied();service=candidate;}
 function bindUserOwner(candidate:MainUserSubmissionOwner){const original=readOriginalDefaultDispatchOwner(candidate,observationSource,userAdmission);if(sealed||owner&&owner!==candidate||!same(original.scope,scope))throw denied();original.assertLocal();owner=candidate;binding=original;}
 function command(root:Invocation,operation:KSwarmBusinessOperation,projectId:string,input:unknown,current:()=>void){const proof=freeze(create(null)),data=captureDispatchBusinessData(input);appendIntrinsic(root.commands,proof);apply(weakSet,commands,[proof,{root,operation,projectId,input:data,current}]);return{proof,data};}
 function openCurrentPlan(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):DefaultDispatchDeliveryInvocation{
  const done=deferred<void>(),root:Invocation=inert({started:false,workDone:false,released:false,ready:false,failed:false,failure:undefined,final:undefined,raw:undefined,completion:done.promise,commands:[],frame:undefined,port:undefined,observation:undefined,requests:[],requestsTaken:false,
   complete(){if(root.released&&root.workDone){roots.delete(root);done.resolve();}},release(){
    if(root.released)return;root.released=true;
    for(let i=0;i<root.commands.length;i++)apply(weakDelete,commands,[root.commands[i]!]);if(root.observation)apply(weakDelete,observations,[root.observation]);
    for(let i=0;i<root.requests.length;i++)apply(weakDelete,observationRequests,[root.requests[i]!]);
    try{root.frame?.release();}catch(error){appendIntrinsic(failures,error);}if(!root.started)root.workDone=true;root.complete();
   }});roots.add(root);
  const fail=(error:unknown)=>{if(!root.failed){root.failed=true;root.failure=error;}};
  try{if(requestSource!=='user')throw denied();local(root);if(!binding)throw denied();binding.assertLocal();root.frame=source.open(event,projectId,requestSource);local(root);}
  catch(error){fail(error);root.release();throw error;}
  let result:ReturnType<typeof deferred<unknown>>|undefined;
  const assertCurrent=()=>{if(root.failed)throw root.failure;local(root);if(!root.ready||!root.final)throw denied();root.final();local(root);};
  function run():Promise<unknown>{
   if(result)return result.promise;result=deferred<unknown>();
   if(root.released){result.reject(denied());return result.promise;}root.started=true;
   const work=(async()=>{
    try{
     local(root);const frame=root.frame!,port=getKSwarmOwnedBusinessTransport(service!,businessAdmission);root.port=port;
     const hello=await checked(port.prepareHello());
     const current=()=>{local(root);serviceLocal();port.assertHelloCurrent(hello);frame.assertCurrent();binding!.assertLocal();local(root);};
     const read=command(root,'read_plan',projectId,null,current),context=(proof:object)=>({requestSource:'user' as const,admission:proof,signal:frame.signal});
     const plan=captureDispatchBusinessData(await checked(port.readPlan(projectId,context(read.proof)))) as Record<string,any>;current();root.final=current;
     if(plan.ok!==true){root.ready=true;result!.resolve(plan);return;}
     const head=plan.plan,observation=freeze(create(null));root.observation=observation;
     const data=captureDispatchBusinessData({scope,projectId,planRevision:head.revision,dispatchGeneration:head.dispatchGeneration,bindingDigest:head.bindingDigest,taskSetDigest:head.taskSetDigest});
     apply(weakSet,observations,[observation,freeze(inert({data,assertCurrent:current}))]);
     const action:DefaultDispatchAction=binding!.capture(observation,frame.proof,actor),canonical=captureDispatchBusinessData(binding!.read(action,actor));
     const capture=command(root,'capture_default_dispatch',projectId,canonical,()=>{current();const actual=captureDispatchBusinessData(binding!.read(action,actor));if(stable(actual)!==stable(canonical))throw denied();current();});
     const value=await checked(port.captureDefaultDispatch(projectId,capture.data,context(capture.proof)));const last=apply(weakGet,commands,[capture.proof]) as Command;last.current();root.final=last.current;
     const closed=captureDispatchBusinessData(value);
     if(recipient){
      const response=DEFAULT_DISPATCH_CAPTURE_OUTPUT.parse(captureIpcData(closed,'DEFAULT_DISPATCH_RESPONSE_INVALID'));
      if(response.ok){
       const operation=response.operation;
       if(operation.projectId!==projectId||operation.planRevision!==head.revision||operation.dispatchGeneration!==head.dispatchGeneration)throw denied();
       for(let i=0;i<operation.children.length;i++){const child=operation.children[i]!,request=freeze(create(null));
        const data=captureDispatchBusinessData({scope,projectId,parentId:operation.parentId,planRevision:operation.planRevision,dispatchGeneration:operation.dispatchGeneration,childKey:child.childKey,taskId:child.taskId,payloadHash:child.payloadHash}) as unknown as OriginalDefaultDispatchObservationRequestData;
        apply(weakSet,observationRequests,[request,inert({controller,recipient,service:service!,root,data,listed:false,consumed:false,current:last.current})]);appendIntrinsic(root.requests,request);
       }
      }
     }
     root.ready=true;result!.resolve(closed);
    }catch(error){fail(error);result!.reject(error);}
   })();root.raw=work;define(work,'constructor',{__proto__:null,value:P} as PropertyDescriptor);settleInternal(work,()=>{root.workDone=true;root.complete();},error=>{appendIntrinsic(failures,error);fail(error);result!.reject(error);root.workDone=true;root.complete();});return result.promise;
  }
  const invocation=freeze(inert({run,assertCurrent,fail,release:root.release}));apply(weakSet,deliveryInvocations,[invocation,inert({controller,recipient,service:service!,root})]);return invocation;
 }
 function dispatchCurrentPlan(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):Promise<unknown>{
  const result=deferred<unknown>();let invocation:DefaultDispatchDeliveryInvocation|undefined;
  const work=(async()=>{try{invocation=openCurrentPlan(event,projectId,requestSource);const value=await checked(invocation.run());invocation.assertCurrent();result.resolve(value);}catch(error){invocation?.fail(error);result.reject(error);}finally{invocation?.release();}})();
  define(work,'constructor',{__proto__:null,value:P} as PropertyDescriptor);settleInternal(work,()=>{},error=>result.reject(error));return result.promise;
 }
 function seal(){sealed=true;source.seal();const rows=roots.snapshot();for(let i=0;i<rows.length;i++)if(!rows[i]!.started)rows[i]!.release();}
 function drain(){
  if(closing)return closing;const result=deferred<void>();closing=result.promise;seal();const rows=roots.snapshot();let remaining=rows.length+1;
  const finished=(error?:unknown)=>{if(error!==undefined)appendIntrinsic(failures,error);if(--remaining===0){if(failures.length||unknown.size)result.reject(aggregateIntrinsicErrors(failures,'DEFAULT_DISPATCH_BUSINESS_DRAIN_UNCONFIRMED'));else result.resolve();}};
  for(let i=0;i<rows.length;i++)settleInternal(rows[i]!.completion,()=>finished(),finished);
  let raw:Promise<void>;try{raw=source.drain();checked(raw);apply(then,raw,[()=>finished(),finished]);}catch(error){unknown.add(error);}return result.promise;
 }
 const ingress:IngressOwner=freeze(inert<IngressOwner>({name:'default-dispatch-user-action',stopAccepting:seal,abortAllActive:seal,drain(deadlineMs:number){
  const result=deferred<boolean>(),timer=setTimeout(()=>result.resolve(false),Math.max(0,deadlineMs));let raw:Promise<void>|undefined;
  try{raw=drain();checked(raw);apply(then,raw,[()=>{clearTimeout(timer);result.resolve(true);},()=>{clearTimeout(timer);result.resolve(false);}]);}catch(error){if(raw)unknown.add(raw);clearTimeout(timer);result.resolve(false);}return result.promise;
 }}));
 const controller=freeze({ingress,observationSource,userAdmission,businessAdmission,bindService,bindUserOwner,openCurrentPlan,dispatchCurrentPlan,seal,drain});
 apply(weakSet,controllers,[controller,{assertService(candidate:object){if(candidate!==service)throw denied();serviceLocal();},read(candidate:object){
  if(candidate!==service)throw denied();serviceLocal();const original=readDefaultDispatchUserBootstrap(source);if(!same(original.scope,scope))throw denied();
  const assertLocal=()=>{local();serviceLocal();original.assertLocal();};
  const bootstrap=freeze(inert({source:original,scope,assertLocal,assertCurrent(){assertLocal();original.assertCurrent();assertLocal();}}));bootstrap.assertCurrent();return bootstrap;
 }}]);return controller;
}
