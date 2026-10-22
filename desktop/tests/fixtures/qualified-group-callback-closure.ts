// Test-only callback receipts. This module never closes a native store or removes a root.
import type {MultiAgentCoordinator} from '../../../src/ai/agents/multi-agent-coordinator.js';
import {types} from 'node:util';

type Retain=<T>(label:string,value:T)=>T;
type Outcome={ok:true;value:unknown}|{ok:false;error:unknown};
type Row={id:string;record:object;cleanup?:Promise<void>;cleanupOutcome?:Outcome;reaction?:Promise<void>};
export type QualifiedCoreCallbackReceipt=Readonly<{callbacksTerminal:true;nativeHealthy:boolean;originalCoreStop:Promise<void>;originalCleanups:readonly Promise<void>[];failures:readonly unknown[]}>;
export type QualifiedCoreCallbacks={readonly core:MultiAgentCoordinator;readonly originalRecords:Map<string,unknown>;readonly rows:Row[];readonly retain:Retain;readonly dispose:Function;readonly listAgents:Function;sealed:boolean;started:boolean;originalCoreStop?:Promise<void>;coreOutcome?:Outcome;coreReaction?:Promise<void>;publicSnapshots?:unknown[];finish?:Promise<QualifiedCoreCallbackReceipt>;expected?:Error;observerFailures:unknown[]};
const own=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,proto=Object.getPrototypeOf,has=Object.hasOwn,apply=Reflect.apply;
const isProxy=types.isProxy,isPromise=types.isPromise,isError=types.isNativeError;
const mapEntries=Map.prototype.entries,mapIteratorNext=proto(new Map().entries()).next;
const nativeThen=Promise.prototype.then;
const ErrorProto=Error.prototype,AggregateProto=AggregateError.prototype;
type TrustedStack=Readonly<{mode:'unknown'|'absent'|'data'|'accessor';get?:Function;set?:Function;enumerable?:boolean;configurable?:boolean;writable?:boolean}>;
function nativeStackShape(sample:Error):TrustedStack{
 const result:{mode:'unknown'|'absent'|'data'|'accessor';get?:Function;set?:Function;enumerable?:boolean;configurable?:boolean;writable?:boolean}={mode:'unknown'};
 try{
  const d=own(sample,'stack');if(d===undefined)result.mode='absent';
  else if(keys(d).length===4&&has(d,'enumerable')&&has(d,'configurable')&&typeof d.enumerable==='boolean'&&typeof d.configurable==='boolean'){
   result.enumerable=d.enumerable;result.configurable=d.configurable;
   if(has(d,'value')&&has(d,'writable')&&typeof d.writable==='boolean'){result.mode='data';result.writable=d.writable;}
   else if(has(d,'get')&&has(d,'set')&&(d.get===undefined||typeof d.get==='function')&&(d.set===undefined||typeof d.set==='function')&&(typeof d.get==='function'||typeof d.set==='function')){result.mode='accessor';result.get=d.get;result.set=d.set;}
  }
 }catch{/* Unknown native shape never authorizes an accessor. */}
 return Object.freeze(result);
}
const leafStackShape=nativeStackShape(new Error('qualified_native_leaf_stack_shape'));
const aggregateStackShape=nativeStackShape(new AggregateError([],'qualified_native_aggregate_stack_shape'));
function trustedStack(error:object,shape:TrustedStack):boolean{
 const d=own(error,'stack');if(d===undefined)return shape.mode==='absent';
 if(has(d,'value'))return shape.mode==='data'&&keys(d).length===4&&typeof d.value==='string'&&d.writable===shape.writable&&d.enumerable===shape.enumerable&&d.configurable===shape.configurable;
 return shape.mode==='accessor'&&has(d,'get')&&has(d,'set')&&d.get===shape.get&&d.set===shape.set&&d.enumerable===shape.enumerable&&d.configurable===shape.configurable;
}
function closedExpectedLeaf(expected:unknown):expected is Error{
 if(expected===null||typeof expected!=='object'||isProxy(expected)||!isError(expected)||proto(expected)!==ErrorProto)return false;
 for(const key of keys(expected))if(key!=='message'&&key!=='stack')return false;
 const message=own(expected,'message');return Boolean(message&&has(message,'value')&&typeof message.value==='string'&&trustedStack(expected,leafStackShape));
}
function need(ok:unknown,code:string):asserts ok{if(!ok)throw Error('qualified_core_callbacks:'+code);}
function object(value:unknown):asserts value is object{need(value!==null&&(typeof value==='object'||typeof value==='function')&&!isProxy(value),'non_proxy_object');}
function slot(receiver:unknown,key:PropertyKey,optional=false):unknown{
 object(receiver);const d=own(receiver,key);if(d===undefined){need(optional,'own_data_missing:'+String(key));return undefined;}
 need(has(d,'value'),'own_accessor:'+String(key));return d.value;
}
function array(value:unknown):unknown[]{
 object(value);need(Array.isArray(value)&&proto(value)===Array.prototype,'native_array');const length=slot(value,'length');need(Number.isSafeInteger(length)&&Number(length)>=0,'array_length');
 const result:unknown[]=[];for(let index=0;index<Number(length);index++){const d=own(value,String(index));need(d&&has(d,'value'),'dense_own_array');result.push(d.value);}
 need(keys(value).length===Number(length)+1,'closed_array_shape');return result;
}
function entries(value:unknown):Array<[string,object]>{
 object(value);need(proto(value)===Map.prototype,'native_map');const iterator=apply(mapEntries,value,[]);const result:Array<[string,object]>=[];
 for(;;){const next=apply(mapIteratorNext,iterator,[]) as IteratorResult<unknown>;if(next.done)break;const pair=array(next.value);need(pair.length===2&&typeof pair[0]==='string','map_key');object(pair[1]);result.push([pair[0],pair[1]]);}
 return result;
}
function method(receiver:unknown,key:string):Function{
 object(receiver);const p=proto(receiver);object(p);const d=own(p,key);need(d&&has(d,'value')&&typeof d.value==='function','fixed_prototype_method:'+key);return d.value;
}
function verifyMap(binding:QualifiedCoreCallbacks){need(slot(binding.core,'records')===binding.originalRecords,'same_records');}
function verifyPopulation(binding:QualifiedCoreCallbacks,capturePublic=false){
 verifyMap(binding);const actual=entries(binding.originalRecords);need(actual.length===binding.rows.length,'record_population');
 for(let index=0;index<actual.length;index++)need(actual[index][0]===binding.rows[index].id&&actual[index][1]===binding.rows[index].record,'record_identity_or_order');
 if(capturePublic){need(binding.publicSnapshots===undefined,'public_population_captured_once');binding.publicSnapshots=binding.retain('qualified-core-original-public-snapshots',array(apply(binding.listAgents,binding.core,[{requestSource:'user',callerId:'main'}])));}
 const snapshots=binding.publicSnapshots;need(snapshots&&snapshots.length===actual.length,'public_population');const ids=new Set<string>();
 for(const snapshot of snapshots){const id=slot(snapshot,'id');need(typeof id==='string'&&!ids.has(id),'public_unique_id');ids.add(id);}
 for(const[id,record]of actual){need(ids.has(id)&&slot(record,'id')===id,'public_private_record_identity');}
 need(ids.has('main'),'fixed_root_record');
}
function observe(binding:QualifiedCoreCallbacks,promise:Promise<void>,label:string,accept:(outcome:Outcome)=>void):Promise<void>{
 const reaction=apply(nativeThen,promise,[(value:unknown)=>{try{accept(binding.retain(label+':fulfilled',{ok:true,value}));}catch(error){binding.observerFailures.push(error);}},(error:unknown)=>{try{accept(binding.retain(label+':rejected',{ok:false,error}));}catch(observerError){binding.observerFailures.push(observerError);}}])as Promise<void>;
 return binding.retain(label+':reaction',reaction);
}
// Only known wrappers around the already-bound original leaf. Unknown shapes,
// extra fields, proxies, accessor values, null/undefined and extra U all reject.
export function isQualifiedExpectedCallbackFailure(error:unknown,expected:Error):boolean{
 if(!closedExpectedLeaf(expected))return false;
 const visiting=new Set<object>();
 const visit=(value:unknown):boolean=>{
  if(value===expected)return true;
  if(value===null||typeof value!=='object'||isProxy(value)||!isError(value)||proto(value)!==AggregateProto||visiting.has(value))return false;
  const names=keys(value);for(const key of names)if(typeof key!=='string'||!['stack','message','errors','cause'].includes(key))return false;
  const message=own(value,'message'),items=own(value,'errors'),cause=own(value,'cause');
  if(!message||!has(message,'value')||!items||!has(items,'value')||!trustedStack(value,aggregateStackShape))return false;
  if(!['agent_model_physical_drain_unconfirmed','multi_agent_descendant_cleanup_unconfirmed','multi_agent_cleanup_unconfirmed'].includes(message.value))return false;
  let failures:unknown[];try{failures=array(items.value);}catch{return false;}if(!failures.length)return false;
  if(message.value==='agent_model_physical_drain_unconfirmed'&&(failures.length!==1||cause!==undefined))return false;
  if(message.value==='multi_agent_descendant_cleanup_unconfirmed'&&cause!==undefined)return false;
  if(message.value==='multi_agent_cleanup_unconfirmed'&&(!cause||!has(cause,'value')||cause.value!==failures[0]))return false;
  visiting.add(value);for(const child of failures)if(!visit(child)){visiting.delete(value);return false;}visiting.delete(value);return true;
 };
 return visit(error);
}
export function captureQualifiedCoreCallbacks(core:MultiAgentCoordinator,retain:Retain):QualifiedCoreCallbacks{
 object(core);need(typeof retain==='function','retain_function');const records=slot(core,'records');entries(records);
 const binding:QualifiedCoreCallbacks={core,originalRecords:records as Map<string,unknown>,rows:[],retain,dispose:method(core,'dispose'),listAgents:method(core,'listAgents'),sealed:false,started:false,observerFailures:[]};
 retain('qualified-core-callback-binding',binding);retain('qualified-core',core);retain('qualified-core-original-records',records);retain('qualified-core-original-dispose',binding.dispose);retain('qualified-core-original-list',binding.listAgents);return binding;
}
export function sealQualifiedCoreCallbacks(binding:QualifiedCoreCallbacks):void{
 if(binding.sealed){verifyPopulation(binding);return;}
 verifyMap(binding);for(const[id,record]of entries(binding.originalRecords))binding.rows.push(binding.retain('qualified-core-record',{id,record}));verifyPopulation(binding,true);binding.sealed=true;
}
export function beginQualifiedCoreCallbacks(binding:QualifiedCoreCallbacks):Promise<void>{
 if(binding.started){need(binding.originalCoreStop,'first_core_call_published');return binding.originalCoreStop;}
 sealQualifiedCoreCallbacks(binding);
 binding.started=true;const raw=apply(binding.dispose,binding.core,[]);need(isPromise(raw),'original_core_promise');binding.originalCoreStop=binding.retain('qualified-core-original-stop',raw as Promise<void>);
 binding.coreReaction=observe(binding,binding.originalCoreStop,'qualified-core-stop',outcome=>{binding.coreOutcome=outcome;});
 verifyPopulation(binding);
 for(const row of binding.rows){if(row.id==='main')continue;const cleanup=slot(row.record,'cleanup');need(isPromise(cleanup),'published_original_cleanup');row.cleanup=binding.retain('qualified-core-original-cleanup',cleanup as Promise<void>);row.reaction=observe(binding,row.cleanup,'qualified-core-cleanup',outcome=>{row.cleanupOutcome=outcome;});}
 return binding.originalCoreStop;
}
function throwAll(errors:unknown[]):never{if(errors.length===1)throw errors[0];throw new AggregateError(errors,'qualified_callback_original_failures',{cause:errors[0]});}
export function finishQualifiedCoreCallbacks(binding:QualifiedCoreCallbacks,expected:Error):Promise<QualifiedCoreCallbackReceipt>{
 if(binding.finish){need(binding.expected===expected,'same_expected_leaf');return binding.finish;}
 need(binding.started&&binding.originalCoreStop,'core_started');need(closedExpectedLeaf(expected),'original_closed_native_error_leaf');binding.expected=expected;binding.retain('qualified-core-expected-leaf',expected);
 const result=(async():Promise<QualifiedCoreCallbackReceipt>=>{
  const failures:unknown[]=[],invalid:unknown[]=[];
  // Every original operation is observed, including failure paths. No bounded
  // Core acknowledgement can replace the cleanup promises captured at begin.
  await binding.coreReaction;for(const row of binding.rows)if(row.id!=='main')await row.reaction;
  if(binding.coreOutcome?.ok===false)failures.push(binding.coreOutcome.error);else if(!binding.coreOutcome)invalid.push(Error('qualified_core_stop_outcome_missing'));
  try{verifyPopulation(binding);}catch(error){invalid.push(error);}
  let nativeHealthy=true;
  for(const row of binding.rows){if(row.id==='main')continue;
   if(row.cleanupOutcome?.ok===false)failures.push(row.cleanupOutcome.error);else if(!row.cleanupOutcome)invalid.push(Error('qualified_core_cleanup_outcome_missing'));
   try{
    need(slot(row.record,'cleanup')===row.cleanup,'same_original_cleanup');need(slot(row.record,'cleanupSettled')===true,'cleanup_settled');need(slot(row.record,'execution',true)===undefined&&slot(row.record,'controller',true)===undefined,'execution_controller_empty');need(array(slot(row.record,'queue')).length===0,'queue_empty');
    const saved=slot(row.record,'cleanupFailures',true);if(saved!==undefined)for(const failure of array(saved))failures.push(failure);
    const released=slot(row.record,'resourcesReleased');need(released===true||released===false,'resource_fact_boolean');if(released!==true)nativeHealthy=false;
   }catch(error){invalid.push(error);nativeHealthy=false;}
  }
  for(const failure of binding.observerFailures)invalid.push(failure);
  let known=true;for(const error of failures)if(!isQualifiedExpectedCallbackFailure(error,expected))known=false;
  if(!known||invalid.length)throwAll([...failures,...invalid]);
  if(failures.length)nativeHealthy=false;
  const originalCleanups=binding.rows.filter(row=>row.id!=='main').map(row=>row.cleanup!);
  const receipt=Object.freeze({callbacksTerminal:true as const,nativeHealthy,originalCoreStop:binding.originalCoreStop!,originalCleanups:Object.freeze(originalCleanups),failures:Object.freeze(failures.slice())});return binding.retain('qualified-core-callback-terminal-receipt',receipt);
 })();binding.finish=binding.retain('qualified-core-callback-finish',result);return result;
}

// File-private fixture observation support. Each wrapper invokes its original
// exactly once and returns that call's original value/Promise without wrapping.
export type QualifiedCallbackCall={name:string;receiver:unknown;args:unknown[];rawWritten:boolean;raw?:unknown;outcome?:Outcome;reaction?:Promise<void>;group?:QualifiedGroupCallbacks;child?:object;agentId?:string;session?:object;factoryCall?:QualifiedCallbackCall;originRecord?:object;originSlot?:object;preClosing?:boolean;parentCall?:QualifiedCallbackCall};
type Call=QualifiedCallbackCall;
type CapturedMethod={receiver:object;key:string;before:PropertyDescriptor|undefined;original:Function;installed:Function;calls:Call[]};
type GroupPending={kind:'preparation'|'physical'|'child-execution'|'managed-final'|'managed-release';raw:Promise<void>;agentId?:string;outcome?:Outcome;reaction?:Promise<void>};
type CoreExecutionOrigin={id:string;record:object;parentId:unknown;execution?:Promise<void>;executionOutcome?:Outcome;reaction?:Promise<void>};
export type QualifiedPreparedCallbackCall={name:string;factoryCall:object;session:object;groupId:string;agentId:string;receiver:unknown;rawWritten:boolean;raw?:unknown;outcome?:Outcome;reaction?:Promise<void>;parentCall?:object};
type GroupSnapshot={children:Array<[string,object]>;promises:Promise<void>[];pending:GroupPending[];coreExecutions:CoreExecutionOrigin[];finals:Array<[unknown,object]>;releases:Array<[unknown,object]>};
export type QualifiedGroupCallbacks={service:QualifiedServiceCallbacks;groupId:string;group:object;core:QualifiedCoreCallbacks;commands:object;commandsRun:Function;children:Map<string,unknown>;snapshot?:GroupSnapshot;coreReceipt?:QualifiedCoreCallbackReceipt};
export type QualifiedServiceCallbackHooks={retain:Retain;isClosing():boolean;allowedCloseOrigin(receiver:object,call:QualifiedCallbackCall):boolean;invokeOriginal(call:QualifiedCallbackCall,invoke:()=>unknown):unknown;onGroup(binding:QualifiedGroupCallbacks):void;preparedCalls(factory:QualifiedCallbackCall):readonly QualifiedPreparedCallbackCall[];onPreparedFactory(call:QualifiedCallbackCall,groupId:string,agentId:string):void;onPreparedSession(call:QualifiedCallbackCall,session:object,groupId:string,agentId:string):void;onError(error:unknown):void};
export type QualifiedServiceCallbackReceipt=Readonly<{callbacksTerminal:true;nativeHealthy:false;originalServiceError:unknown}>;
export type QualifiedServiceCallbacks={service:object;store:object;hooks:QualifiedServiceCallbackHooks;groups:Map<string,unknown>;bindings:QualifiedGroupCallbacks[];errors:unknown[];methods:CapturedMethod[];physicalCalls:Call[];factoryCalls:Call[];bindingReactions:Promise<void>[];acceptedPreparedCalls:Set<object>;sealed:boolean;terminal:boolean;containers:{preparations:WeakMap<object,Set<Promise<void>>>;physical:Map<object,Set<Promise<void>>>;finals:Map<unknown,object>;releases:Map<string,object>};finish?:Promise<QualifiedServiceCallbackReceipt>;finishArguments?:{expected:Error;originalServiceError:unknown}};
const weakMapGet=WeakMap.prototype.get,setValues=Set.prototype.values,setIteratorNext=proto(new Set().values()).next,mapGet=Map.prototype.get;
function retainedError(binding:QualifiedServiceCallbacks,error:unknown):void{
 // Observer failures are retained without replacing an original return/throw.
 binding.errors.push(error);
 try{binding.hooks.retain('qualified-group-observer-error',error);}catch(failure){binding.errors.push(failure);}
 try{binding.hooks.onError(error);}catch(failure){binding.errors.push(failure);}
}
function retainObserved<T>(binding:QualifiedServiceCallbacks,label:string,value:T):T{
 try{binding.hooks.retain(label,value);}catch(error){retainedError(binding,error);}return value;
}
function promises(value:unknown):Promise<void>[] {
 if(value===undefined)return [];object(value);need(proto(value)===Set.prototype,'native_promise_set');const iterator=apply(setValues,value,[]),out:Promise<void>[]=[];
 for(;;){const next=apply(setIteratorNext,iterator,[]) as IteratorResult<unknown>;if(next.done)break;need(isPromise(next.value),'native_pending_promise');out.push(next.value as Promise<void>);}return out;
}
function anyEntries(value:unknown):Array<[unknown,object]>{
 object(value);need(proto(value)===Map.prototype,'native_owner_map');const iterator=apply(mapEntries,value,[]),out:Array<[unknown,object]>=[];
 for(;;){const next=apply(mapIteratorNext,iterator,[]) as IteratorResult<unknown>;if(next.done)break;const pair=array(next.value);object(pair[1]);out.push([pair[0],pair[1]]);}return out;
}
function associated(map:unknown,group:object):Array<[unknown,object]>{
 const out:Array<[unknown,object]>=[];for(const[key,value]of anyEntries(map))if(slot(value,'group')===group)out.push([key,value]);return out;
}
function sameMembers(actual:Array<[string,object]>,expected:Array<[string,object]>,code:string){need(actual.length===expected.length,code+':population');for(let i=0;i<actual.length;i++)need(actual[i][0]===expected[i][0]&&actual[i][1]===expected[i][1],code+':identity');}
function sameService(binding:QualifiedServiceCallbacks){
 need(slot(binding.service,'groups')===binding.groups,'same_service_groups');
 need(slot(binding.service,'groupObservationPreparationDrains')===binding.containers.preparations&&slot(binding.service,'physicalSessionClosures')===binding.containers.physical&&slot(binding.service,'managedFinalPublications')===binding.containers.finals&&slot(binding.service,'managedReleaseOwners')===binding.containers.releases,'same_service_containers');
 const current=entries(binding.groups);need(current.length===binding.bindings.length,'bound_group_population');for(const[id,group]of current)need(binding.bindings.some(b=>b.groupId===id&&b.group===group),'bound_group_identity');
}
function sameGroup(binding:QualifiedGroupCallbacks){
 const owner=binding.service;sameService(owner);need(apply(mapGet,owner.groups,[binding.groupId])===binding.group&&slot(binding.group,'id')===binding.groupId,'same_bound_group');
 need(slot(binding.group,'core')===binding.core.core&&slot(binding.group,'commands')===binding.commands&&slot(binding.group,'children')===binding.children,'same_bound_group_owners');
}
function snapshotGroup(binding:QualifiedGroupCallbacks):GroupSnapshot{
 sameGroup(binding);const owner=binding.service,children=entries(binding.children),all:Promise<void>[]=[],pending:GroupPending[]=[],coreExecutions:CoreExecutionOrigin[]=[];
 const observePending=(entry:GroupPending)=>{
  retainObserved(owner,'qualified-group-pending-origin',entry);pending.push(entry);all.push(entry.raw);
  entry.reaction=apply(nativeThen,entry.raw,[(value:unknown)=>{entry.outcome={ok:true,value};retainObserved(owner,'qualified-group-pending-fulfilled',entry.outcome);},(error:unknown)=>{entry.outcome={ok:false,error};retainObserved(owner,'qualified-group-pending-rejected',entry.outcome);}])as Promise<void>;retainObserved(owner,'qualified-group-pending-reaction',entry.reaction);
 };
 for(const raw of promises(apply(weakMapGet,owner.containers.preparations,[binding.group])))observePending({kind:'preparation',raw});
 for(const raw of promises(apply(mapGet,owner.containers.physical,[binding.group])))observePending({kind:'physical',raw});
 for(const[id,child]of children){need(slot(child,'id')===id,'same_child_id');const execution=slot(child,'execution',true);if(execution!==undefined){const raw=slot(execution,'settled');need(isPromise(raw),'child_original_settled_promise');observePending({kind:'child-execution',agentId:id,raw:raw as Promise<void>});}}
 const finals=associated(owner.containers.finals,binding.group),releases=associated(owner.containers.releases,binding.group);
 for(const[,entry]of finals){const raw=slot(entry,'pending',true);if(raw!==undefined){need(isPromise(raw),'managed_final_original_promise');observePending({kind:'managed-final',raw:raw as Promise<void>});}}
 for(const[,entry]of releases){const raw=slot(entry,'pending',true);if(raw!==undefined){need(isPromise(raw),'managed_release_original_promise');observePending({kind:'managed-release',raw:raw as Promise<void>});}}
 for(const row of binding.core.rows){
  const entry:CoreExecutionOrigin={id:row.id,record:row.record,parentId:slot(row.record,'parentId',true)};coreExecutions.push(retainObserved(owner,'qualified-original-core-execution-origin',entry));
  const raw=slot(row.record,'execution',true);if(raw!==undefined){need(isPromise(raw),'same_core_original_execution_promise');entry.execution=raw as Promise<void>;
   entry.reaction=apply(nativeThen,raw,[(value:unknown)=>{entry.executionOutcome={ok:true,value};retainObserved(owner,'qualified-original-core-execution-fulfilled',entry.executionOutcome);},(error:unknown)=>{entry.executionOutcome={ok:false,error};retainObserved(owner,'qualified-original-core-execution-rejected',entry.executionOutcome);}])as Promise<void>;retainObserved(owner,'qualified-original-core-execution-reaction',entry.reaction);
  }
 }
 return retainObserved(owner,'qualified-group-close-snapshot',{children,promises:all,pending,coreExecutions,finals,releases});
}

function install(binding:QualifiedServiceCallbacks,receiver:object,key:string,original:Function,invoke:(call:Call)=>unknown):CapturedMethod{
 const before=own(receiver,key),calls:Call[]=[];if(before)need(has(before,'value')&&before.value===original&&before.configurable===true,'own_method_before_install');
 const installed=function(this:unknown,...args:unknown[]){const call:Call={name:key,receiver:this,args,rawWritten:false};calls.push(call);retainObserved(binding,'qualified-group-original-call',call);return invoke(call);};
 const record={receiver,key,before,original,installed,calls};binding.methods.push(record);retainObserved(binding,'qualified-group-method-original-descriptor',record);
 Object.defineProperty(receiver,key,{value:installed,configurable:true,writable:true,enumerable:before?.enumerable??false});need(own(receiver,key)?.value===installed,'same_installed_method');return record;
}
function recordCall(binding:QualifiedServiceCallbacks,call:Call,original:Function):unknown{
 let raw:unknown;
 try{raw=binding.hooks.invokeOriginal(call,()=>apply(original,call.receiver,call.args));}catch(error){call.outcome={ok:false,error};retainObserved(binding,'qualified-group-call-threw',call.outcome);throw error;}
 call.raw=raw;call.rawWritten=true;retainObserved(binding,'qualified-group-original-call-value',raw);
 if(isPromise(raw)){
  try{call.reaction=apply(nativeThen,raw,[(value:unknown)=>{call.outcome={ok:true,value};retainObserved(binding,'qualified-group-call-fulfilled',call.outcome);},(error:unknown)=>{call.outcome={ok:false,error};retainObserved(binding,'qualified-group-call-rejected',call.outcome);}])as Promise<void>;retainObserved(binding,'qualified-group-call-reaction',call.reaction);}catch(error){retainedError(binding,error);}
 }else{call.outcome={ok:true,value:raw};retainObserved(binding,'qualified-group-call-fulfilled',call.outcome);}
 return raw;
}
function bindPreparedRoot(binding:QualifiedServiceCallbacks,call:Call,prepared:unknown):void{
 const hooks=binding.hooks;need(call.receiver===binding.service&&!binding.sealed&&!hooks.isClosing(),'prepare_root_origin_or_late');const taskId=slot(prepared,'taskId');need(typeof taskId==='string','prepared_actual_task');
 const root=apply(method(binding.store,'getRootBinding'),binding.store,[taskId]),id=slot(root,'groupId');need(typeof id==='string','durable_group_binding');const group=apply(mapGet,binding.groups,[id]);object(group);
 const prior=binding.bindings.find(x=>x.groupId===id);if(prior){need(prior.group===group,'same_repeated_group');return;}
 const core=slot(group,'core');object(core);const commands=slot(group,'commands');object(commands);const children=slot(group,'children');entries(children);
 const captured:QualifiedGroupCallbacks={service:binding,groupId:id,group,core:captureQualifiedCoreCallbacks(core as MultiAgentCoordinator,hooks.retain),commands,commandsRun:method(commands,'run'),children:children as Map<string,unknown>};binding.bindings.push(retainObserved(binding,'qualified-group-fixed-owner',captured));hooks.onGroup(captured);
}
function preparedOrigin(binding:QualifiedServiceCallbacks,call:Call):QualifiedGroupCallbacks{
 need(call.receiver===undefined&&call.args.length===1,'prepared_factory_receiver_args');const options=slot(binding.service,'options');need(binding.methods.some(method=>method.receiver===options&&method.key==='prepareObservationSession'&&method.calls.includes(call)),'same_installed_prepared_factory_call');const input=call.args[0],context=slot(input,'context'),identity=slot(input,'identity');const groupId=slot(context,'groupId'),agentId=slot(identity,'id');
 need(typeof groupId==='string'&&typeof agentId==='string','prepared_factory_exact_ids');const group=binding.bindings.find(b=>b.groupId===groupId);need(group,'prepared_factory_bound_group');sameGroup(group);
 const child=apply(mapGet,group.children,[agentId]);object(child);need(slot(child,'id')===agentId&&slot(child,'context')===context,'prepared_factory_exact_child');
 need(apply(mapGet,group.core.originalRecords,[agentId])!==undefined,'prepared_factory_exact_core_record');call.group=group;call.child=child;call.agentId=agentId;return group;
}
export function captureQualifiedServiceCallbacks(service:object,store:object,hooks:QualifiedServiceCallbackHooks):QualifiedServiceCallbacks{
 object(service);object(store);const groups=slot(service,'groups');entries(groups);
 const preparations=slot(service,'groupObservationPreparationDrains'),physical=slot(service,'physicalSessionClosures'),finals=slot(service,'managedFinalPublications'),releases=slot(service,'managedReleaseOwners');
 object(preparations);need(proto(preparations)===WeakMap.prototype,'native_group_preparation_map');object(physical);need(proto(physical)===Map.prototype,'native_physical_map');anyEntries(finals);anyEntries(releases);
 const binding:QualifiedServiceCallbacks={service,store,hooks,groups:groups as Map<string,unknown>,bindings:[],errors:[],methods:[],physicalCalls:[],factoryCalls:[],bindingReactions:[],acceptedPreparedCalls:new Set(),sealed:false,terminal:false,containers:{preparations:preparations as WeakMap<object,Set<Promise<void>>>,physical:physical as Map<object,Set<Promise<void>>>,finals:finals as Map<unknown,object>,releases:releases as Map<string,object>}};hooks.retain('qualified-service-callback-owner',binding);
 const originalPrepare=method(service,'prepareRoot'),originalDispose=method(service,'dispose'),originalPhysical=method(service,'closeManagedSession');
 install(binding,service,'prepareRoot',originalPrepare,call=>{
  const raw=recordCall(binding,call,originalPrepare);
  if(isPromise(raw)){const reaction=apply(nativeThen,raw,[(prepared:unknown)=>{try{bindPreparedRoot(binding,call,prepared);}catch(error){retainedError(binding,error);}},()=>{}])as Promise<void>;binding.bindingReactions.push(retainObserved(binding,'qualified-prepare-group-binding-reaction',reaction));}return raw;
 });
 install(binding,service,'dispose',originalDispose,call=>{
  try{need(call.receiver===service&&call.args.length===0&&!binding.terminal,'service_dispose_origin');sealQualifiedServiceCallbacks(binding);}catch(error){retainedError(binding,error);}
  try{return recordCall(binding,call,originalDispose);}finally{try{need(hooks.allowedCloseOrigin(service,call),'fixed_service_dispose_source');}catch(error){retainedError(binding,error);}}
 });
 install(binding,service,'closeManagedSession',originalPhysical,call=>{
  try{
   need(call.receiver===service&&call.args.length===3&&!binding.terminal,'physical_call_origin');const[group,child,close]=call.args;object(group);object(child);need(typeof close==='function','physical_original_close');
   const owner=binding.bindings.find(x=>x.group===group);need(owner,'known_physical_group');sameGroup(owner);need(entries(owner.children).some(([,value])=>value===child),'known_physical_child');
   if(binding.sealed)need(owner.snapshot?.children.some(([,value])=>value===child),'sealed_physical_child');
   call.group=owner;call.child=child;binding.physicalCalls.push(call);
  }catch(error){retainedError(binding,error);}
  try{return recordCall(binding,call,originalPhysical);}finally{try{need(hooks.allowedCloseOrigin(service,call)||Boolean(call.group&&hooks.allowedCloseOrigin(call.group.core.core,call)),'registered_physical_close_source');}catch(error){retainedError(binding,error);}}
 });
 // These two named producer entrances are the only creation sites for the two
 // pending-publication maps. Post-seal creation is unknown, even if later removed.
 for(const key of ['bindManagedObservationAdmission','registerManagedFinalPublication']){
  const original=method(service,key);install(binding,service,key,original,call=>{try{need(call.receiver===service&&!binding.sealed&&!binding.terminal&&!hooks.isClosing(),'late_managed_producer:'+key);}catch(error){retainedError(binding,error);}return recordCall(binding,call,original);});
 }
 const options=slot(service,'options');object(options);const originalPreparation=slot(options,'prepareObservationSession',true);
 if(originalPreparation!==undefined){need(typeof originalPreparation==='function','original_observation_factory');install(binding,options,'prepareObservationSession',originalPreparation,call=>{
  try{need(!binding.sealed&&!binding.terminal&&!hooks.isClosing(),'late_prepared_factory');const group=preparedOrigin(binding,call);binding.factoryCalls.push(call);hooks.onPreparedFactory(call,group.groupId,call.agentId!);}catch(error){retainedError(binding,error);}
  const raw=recordCall(binding,call,originalPreparation);
  if(isPromise(raw)){const reaction=apply(nativeThen,raw,[(prepared:unknown)=>{try{
   // A pre-seal factory's original P may settle while closing. Fill only its
   // pre-registered role; never register another fixture/session owner here.
   need(binding.factoryCalls.includes(call)&&call.group&&call.agentId&&!binding.terminal,'prepared_factory_fixed_role');const group=preparedOrigin(binding,call);const session=slot(prepared,'session');object(session);need(call.session===undefined,'prepared_session_single_fill');call.session=session;hooks.onPreparedSession(call,session,group.groupId,call.agentId!);
  }catch(error){retainedError(binding,error);}},()=>{}])as Promise<void>;binding.bindingReactions.push(retainObserved(binding,'qualified-prepared-session-binding-reaction',reaction));}return raw;
 });}
 return binding;
}
export function sealQualifiedServiceCallbacks(binding:QualifiedServiceCallbacks):void{
 if(binding.sealed){sameService(binding);return;}sameService(binding);
 for(const group of binding.bindings){sealQualifiedCoreCallbacks(group.core);group.snapshot=snapshotGroup(group);}binding.sealed=true;
}
export function beginQualifiedGroupCallbackStop(binding:QualifiedGroupCallbacks):Promise<void>{
 need(binding.service.sealed,'service_close_sealed');sameGroup(binding);return beginQualifiedCoreCallbacks(binding.core);
}
export function finishQualifiedServiceCallbacks(binding:QualifiedServiceCallbacks,expected:Error,originalServiceError:unknown):Promise<QualifiedServiceCallbackReceipt>{
 if(binding.finish){need(binding.finishArguments?.expected===expected&&binding.finishArguments.originalServiceError===originalServiceError,'same_service_finish_arguments');return binding.finish;}
 need(binding.sealed&&binding.bindings.length>0&&isQualifiedExpectedCallbackFailure(originalServiceError,expected),'exact_service_dispose_failure');binding.finishArguments={expected,originalServiceError};
 const finish=(async():Promise<QualifiedServiceCallbackReceipt>=>{
  const allFailures:unknown[]=[originalServiceError],invalid:unknown[]=[];
  for(const group of binding.bindings){try{need(group.core.started,'original_independent_core_stop_called');group.coreReceipt=await finishQualifiedCoreCallbacks(group.core,expected);}catch(error){invalid.push(error);}}
  for(const group of binding.bindings)try{need(group.snapshot,'group_close_snapshot');for(const promise of group.snapshot.promises){try{await promise;}catch(error){allFailures.push(error);}}}catch(error){invalid.push(error);}
  // Every actual call is held. Observer reactions only record outcomes; their
  // settledness never substitutes for their original P's terminal outcome.
  for(const reaction of binding.bindingReactions)await reaction;
  for(const factory of binding.factoryCalls)for(const call of binding.hooks.preparedCalls(factory))await call.reaction;
  const count=binding.physicalCalls.length;
  for(const call of binding.physicalCalls){await call.reaction;if(call.outcome?.ok===false)allFailures.push(call.outcome.error);else if(!call.outcome)invalid.push(Error('qualified_physical_call_outcome_missing'));}
  for(const group of binding.bindings)try{
   const raw=apply(group.commandsRun,group.commands,[()=>{}]);need(isPromise(raw),'original_command_barrier_promise');retainObserved(binding,'qualified-group-original-command-barrier',raw);await raw;
   sameGroup(group);need(group.snapshot,'final_group_snapshot');sameMembers(entries(group.children),group.snapshot.children,'final_child_population');
   need(promises(apply(weakMapGet,binding.containers.preparations,[group.group])).length===0,'preparation_callbacks_remaining');need(promises(apply(mapGet,binding.containers.physical,[group.group])).length===0,'physical_callbacks_remaining');
   need(associated(binding.containers.finals,group.group).length===0,'managed_final_entries_remaining');need(associated(binding.containers.releases,group.group).every(([,owner])=>slot(owner,'pending',true)===undefined&&slot(owner,'delivered')===true),'managed_release_callbacks_remaining');
   for(const[,child]of entries(group.children))need(slot(child,'execution',true)===undefined,'live_child_execution_remaining');
  }catch(error){invalid.push(error);}
  const methodPopulations=binding.methods.map(m=>m.calls.length);
  for(const captured of binding.methods)for(const call of captured.calls){
   await call.reaction;if(!call.outcome)invalid.push(Error('qualified_original_call_outcome_missing'));
   else if(call.outcome.ok===false){
    // Only the exact disposal/physical stop roles use the expected-F classifier.
    // Business/factory/producer failures are never waived by sharing that F.
    if(captured.key==='dispose'||captured.key==='closeManagedSession')allFailures.push(call.outcome.error);else invalid.push(call.outcome.error);
   }
  }
  try{need(binding.physicalCalls.length===count,'physical_population_after_barrier');for(let i=0;i<binding.methods.length;i++)need(binding.methods[i].calls.length===methodPopulations[i],'call_population_after_barrier');sameService(binding);}catch(error){invalid.push(error);}
  for(const group of binding.bindings){for(const entry of group.snapshot?.coreExecutions??[])await entry.reaction;for(const entry of group.snapshot?.pending??[])await entry.reaction;try{verifyQualifiedGroupFailureOrigins(group,expected);}catch(error){invalid.push(error);}}
  for(const error of binding.errors)invalid.push(error);let known=true;for(const error of allFailures)if(!isQualifiedExpectedCallbackFailure(error,expected))known=false;
  if(!known||invalid.length)throwAll([...allFailures,...invalid]);binding.terminal=true;
  return retainObserved(binding,'qualified-service-callback-terminal',Object.freeze({callbacksTerminal:true as const,nativeHealthy:false as const,originalServiceError}));
 })();binding.finish=retainObserved(binding,'qualified-service-callback-finish',finish);return finish;
}
export async function awaitQualifiedServiceCallbackObservations(binding:QualifiedServiceCallbacks):Promise<void>{
 const failures:unknown[]=[];
 for(const reaction of binding.bindingReactions)await reaction;
 const populations=binding.methods.map(method=>method.calls.length);
 for(const captured of binding.methods)for(const call of captured.calls){
  await call.reaction;
  if(!call.outcome)failures.push(Error('qualified_original_callback_outcome_missing'));
  else if(call.outcome.ok===false&&!(binding.terminal&&(captured.key==='dispose'||captured.key==='closeManagedSession')&&binding.finishArguments&&isQualifiedExpectedCallbackFailure(call.outcome.error,binding.finishArguments.expected)))failures.push(call.outcome.error);
 }
 for(let index=0;index<binding.methods.length;index++)if(binding.methods[index].calls.length!==populations[index])failures.push(Error('qualified_callback_observation_population_changed'));
 for(const error of binding.errors)failures.push(error);
 if(failures.length)throwAll(failures);
}
export function proveQualifiedPreparedCallbackFailure(binding:QualifiedServiceCallbacks,factory:object,call:QualifiedPreparedCallbackCall,error:unknown,expected:Error):boolean{
 try{
  need(binding.terminal&&binding.finishArguments?.expected===expected&&binding.factoryCalls.some(item=>item===factory),'terminal_prepared_factory');
  const original=binding.factoryCalls.find(item=>item===factory);need(original,'same_prepared_factory_call');const group=original.group;need(group&&group.coreReceipt?.callbacksTerminal&&original.agentId&&original.child&&original.session,'prepared_factory_identity');
  need(call.factoryCall===factory&&call.session===original.session&&call.receiver===original.session&&call.groupId===group.groupId&&call.agentId===original.agentId,'prepared_method_identity');
  need(binding.acceptedPreparedCalls.has(call)&&['dispose','suspend','deactivate'].includes(call.name)&&call.rawWritten&&call.outcome?.ok===false&&call.outcome.error===error&&isQualifiedExpectedCallbackFailure(error,expected),'exact_prepared_method_rejection');
  const row=group.core.rows.find(r=>r.id===original.agentId);need(row&&row.record===apply(mapGet,group.core.originalRecords,[original.agentId]),'prepared_core_record_identity');
  const failures=slot(row.record,'cleanupFailures',true);const fromCore=failures!==undefined&&array(failures).some(failure=>failure===error);
  const fromPhysical=binding.physicalCalls.some(p=>p.group===group&&p.child===original.child&&p.outcome?.ok===false&&p.outcome.error===error);
  return fromCore||fromPhysical;
 }catch{return false;}
}
// A reference can legitimately propagate through several known wrappers. The
// budget below is per originating call/index, never a global Set<error> waiver.
function verifyQualifiedGroupFailureOrigins(group:QualifiedGroupCallbacks,expected:Error):void{
 const binding=group.service,snapshot=group.snapshot;need(snapshot&&group.coreReceipt,'origin_snapshot_and_core_receipt');
 const calls:QualifiedPreparedCallbackCall[]=[];
 for(const factory of binding.factoryCalls){if(factory.group!==group)continue;
  need(factory.outcome?.ok===true&&factory.session&&factory.agentId,'origin_factory_fulfilled');
  const observed=binding.hooks.preparedCalls(factory);need(Array.isArray(observed),'origin_prepared_calls_array');
  for(const call of observed){
   need(call.factoryCall===factory&&call.session===factory.session&&call.receiver===factory.session&&call.groupId===group.groupId&&call.agentId===factory.agentId,'origin_prepared_call_identity');
   need(call.outcome!==undefined,'origin_prepared_call_terminal');calls.push(call);
  }
 }
 const consumed=new Set<object>(),executionConsumed=new Set<object>(),descendantConsumed=new Map<object,Set<object>>();
 const byId=new Map(snapshot.coreExecutions.map(entry=>[entry.id,entry]));
 need(group.core.coreOutcome?.ok===true,'origin_core_stop_fulfilled');
 for(const row of group.core.rows){if(row.id==='main')continue;
  need(row.cleanupOutcome?.ok===true,'origin_original_cleanup_fulfilled');
  const saved=slot(row.record,'cleanupFailures',true);const failures=saved===undefined?[]:array(saved);
  const original=byId.get(row.id);need(original&&original.record===row.record&&slot(row.record,'parentId',true)===original.parentId,'origin_core_record_fixed');
  for(const failure of failures){
   need(isQualifiedExpectedCallbackFailure(failure,expected),'origin_closed_expected_tree');
   const direct=calls.find(call=>call.agentId===row.id&&['dispose','suspend','deactivate'].includes(call.name)&&call.outcome?.ok===false&&call.outcome.error===failure&&!consumed.has(call));
   if(direct){consumed.add(direct);continue;}
   if(original.execution&&original.executionOutcome?.ok===false&&original.executionOutcome.error===failure&&!executionConsumed.has(original)){executionConsumed.add(original);continue;}
   // closeRecord creates exactly one descendant wrapper for each failed direct
   // child, with that child's already-held cleanup failure entries in order.
   let matched=false;
   const message=own(failure as object,'message'),nested=own(failure as object,'errors');
   if(message&&has(message,'value')&&message.value==='multi_agent_descendant_cleanup_unconfirmed'&&nested&&has(nested,'value')){
    const nestedFailures=array(nested.value);let used=descendantConsumed.get(row.record);if(!used){used=new Set();descendantConsumed.set(row.record,used);}
    for(const child of snapshot.coreExecutions){if(child.parentId!==row.id||used.has(child.record))continue;
     const raw=slot(child.record,'cleanupFailures',true),childFailures=raw===undefined?[]:array(raw);
     if(nestedFailures.length!==childFailures.length||!nestedFailures.length)continue;
     if(nestedFailures.some((item,index)=>item!==childFailures[index]))continue;
     need(slot(child.record,'resourcesReleased')===false,'origin_failed_descendant_native_fact');used.add(child.record);matched=true;break;
    }
   }
   need(matched,'origin_unmatched_or_extra_cleanup_failure');
  }
 }
 // A physical Promise is the propagation of its exact close callback, not an
 // additional allowance for an arbitrary equal-valued error elsewhere.
 const physicalMatched=new Set<object>();
 for(const physical of binding.physicalCalls){if(physical.group!==group||physical.outcome?.ok!==false)continue;const physicalError=physical.outcome.error;
  const source=calls.find(call=>call.name==='dispose'&&call.parentCall===physical&&call.outcome?.ok===false&&call.outcome.error===physicalError&&!physicalMatched.has(call));
  need(source,'origin_physical_call_without_exact_session_callback');physicalMatched.add(source);consumed.add(source);
 }
 for(const call of calls){
  if(call.name==='run'||call.outcome?.ok!==false)continue;
  need(consumed.has(call),'origin_unmatched_or_extra_prepared_failure');binding.acceptedPreparedCalls.add(call);
 }
 for(const pending of snapshot.pending){if(pending.outcome?.ok!==false)continue;const pendingError=pending.outcome.error;
  if(pending.kind==='physical')need(binding.physicalCalls.some(call=>call.group===group&&call.raw===pending.raw&&call.outcome?.ok===false&&call.outcome.error===pendingError),'origin_physical_snapshot_propagation');
  else if(pending.kind==='child-execution'){
   const execution=byId.get(pending.agentId!);need(execution?.execution&&execution.executionOutcome?.ok===false&&execution.executionOutcome.error===pending.outcome.error,'origin_child_handle_execution_propagation');
  }else throw pending.outcome.error;
 }
}
export function restoreQualifiedServiceCallbackObservers(binding:QualifiedServiceCallbacks):void{
 const errors:unknown[]=[];
 for(const captured of binding.methods.slice().reverse())try{
  const d=own(captured.receiver,captured.key);need(d&&has(d,'value')&&d.value===captured.installed&&d.configurable===true&&d.writable===true&&d.enumerable===(captured.before?.enumerable??false),'same_observer_descriptor');
  if(captured.before)Object.defineProperty(captured.receiver,captured.key,captured.before);else need(Reflect.deleteProperty(captured.receiver,captured.key),'observer_descriptor_delete');
 }catch(error){errors.push(error);}
 if(errors.length)throwAll(errors);
}
