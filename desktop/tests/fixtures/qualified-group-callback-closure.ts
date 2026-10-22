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
export type QualifiedPreparationSource={begin:QualifiedCallbackCall;group?:QualifiedGroupCallbacks;child?:object;pending?:object;ticket?:object;context?:object;coreRecord?:object;rawFacts?:object;operationId?:string;expectedTurn?:number;producer?:QualifiedCallbackCall;preparation?:object;facts?:object;consumption?:Readonly<{error:Error;bodyOutcomeP:Promise<unknown>;bodyOutcomeValue:unknown}>;bodyOutcome?:Outcome;bodyReaction?:Promise<void>};
type GroupSnapshot={children:Array<[string,object]>;promises:Promise<void>[];pending:GroupPending[];coreExecutions:CoreExecutionOrigin[];finals:Array<[unknown,object]>;releases:Array<[unknown,object]>};
export type QualifiedGroupCallbacks={service:QualifiedServiceCallbacks;groupId:string;group:object;core:QualifiedCoreCallbacks;commands:object;commandsRun:Function;children:Map<string,unknown>;snapshot?:GroupSnapshot;coreReceipt?:QualifiedCoreCallbackReceipt};
export type QualifiedServiceCallbackHooks={retain:Retain;isClosing():boolean;allowedCloseOrigin(receiver:object,call:QualifiedCallbackCall):boolean;invokeOriginal(call:QualifiedCallbackCall,invoke:()=>unknown):unknown;onGroup(binding:QualifiedGroupCallbacks):void;preparedCalls(factory:QualifiedCallbackCall):readonly QualifiedPreparedCallbackCall[];onPreparedFactory(call:QualifiedCallbackCall,groupId:string,agentId:string):void;onPreparedSession(call:QualifiedCallbackCall,session:object,groupId:string,agentId:string):void;onError(error:unknown):void;observeExpectedPreparation?:true};
export type QualifiedServiceCallbackReceipt=Readonly<{callbacksTerminal:true;nativeHealthy:false;originalServiceOutcome:Outcome;originalServiceError?:unknown}>;
export type QualifiedServiceCallbacks={service:object;store:object;hooks:QualifiedServiceCallbackHooks;groups:Map<string,unknown>;bindings:QualifiedGroupCallbacks[];errors:unknown[];methods:CapturedMethod[];physicalCalls:Call[];factoryCalls:Call[];preparationSources:QualifiedPreparationSource[];preparationNativePoisoned:boolean;preparationAuthority?:{inspectOriginal:Function;inspectPrototype:object;inspectDescriptor:PropertyDescriptor;preparations:WeakMap<object,object>};bindingReactions:Promise<void>[];acceptedPreparedCalls:Set<object>;sealed:boolean;terminal:boolean;containers:{preparations:WeakMap<object,Set<Promise<void>>>;physical:Map<object,Set<Promise<void>>>;finals:Map<unknown,object>;releases:Map<string,object>;globalPreparations?:Set<Promise<void>>};finish?:Promise<QualifiedServiceCallbackReceipt>;finishArguments?:{expected:Error;outcome:Outcome}};
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
function recordCall(binding:QualifiedServiceCallbacks,call:Call,original:Function,beforeOriginal?:()=>void):unknown{
 let raw:unknown;
 try{raw=binding.hooks.invokeOriginal(call,()=>{if(beforeOriginal)try{beforeOriginal();}catch(error){retainedError(binding,error);}return apply(original,call.receiver,call.args);});}catch(error){call.outcome={ok:false,error};retainObserved(binding,'qualified-group-call-threw',call.outcome);throw error;}
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
 const binding:QualifiedServiceCallbacks={service,store,hooks,groups:groups as Map<string,unknown>,bindings:[],errors:[],methods:[],physicalCalls:[],factoryCalls:[],preparationSources:[],preparationNativePoisoned:false,bindingReactions:[],acceptedPreparedCalls:new Set(),sealed:false,terminal:false,containers:{preparations:preparations as WeakMap<object,Set<Promise<void>>>,physical:physical as Map<object,Set<Promise<void>>>,finals:finals as Map<unknown,object>,releases:releases as Map<string,object>}};hooks.retain('qualified-service-callback-owner',binding);
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
 if(hooks.observeExpectedPreparation===true)installQualifiedPreparationSources(binding);
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
 need(isQualifiedExpectedCallbackFailure(originalServiceError,expected),'exact_service_dispose_failure');
 return finishQualifiedServiceOutcome(binding,expected,{ok:false,error:originalServiceError});
}
export function finishQualifiedPreparationCallbacks(binding:QualifiedServiceCallbacks,expected:Error,originalDisposeCall:QualifiedCallbackCall):Promise<QualifiedServiceCallbackReceipt>{
 need(hasQualifiedPreparationNativePoison(binding)&&binding.hooks.observeExpectedPreparation===true,'preparation_healthy_service_sticky_poison');
 need(binding.methods.some(method=>method.receiver===binding.service&&method.key==='dispose'&&method.calls.includes(originalDisposeCall))&&originalDisposeCall.receiver===binding.service&&originalDisposeCall.args.length===0&&originalDisposeCall.rawWritten&&isPromise(originalDisposeCall.raw)&&originalDisposeCall.outcome?.ok===true,'preparation_original_fulfilled_service_call');
 return finishQualifiedServiceOutcome(binding,expected,originalDisposeCall.outcome);
}
function finishQualifiedServiceOutcome(binding:QualifiedServiceCallbacks,expected:Error,originalServiceOutcome:Outcome):Promise<QualifiedServiceCallbackReceipt>{
 if(binding.finish){const prior=binding.finishArguments?.outcome;need(binding.finishArguments?.expected===expected&&prior?.ok===originalServiceOutcome.ok&&(prior?.ok===false&&originalServiceOutcome.ok===false?prior.error===originalServiceOutcome.error:prior===originalServiceOutcome),'same_service_finish_arguments');return binding.finish;}
 need(binding.sealed&&binding.bindings.length>0,'sealed_service_dispose_outcome');binding.finishArguments={expected,outcome:originalServiceOutcome};
 const finish=(async():Promise<QualifiedServiceCallbackReceipt>=>{
  const allFailures:unknown[]=originalServiceOutcome.ok?[]:[originalServiceOutcome.error],invalid:unknown[]=[];
  try{await verifyQualifiedPreparationSources(binding,expected);}catch(error){invalid.push(error);}
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
    if(captured.key==='dispose'||captured.key==='closeManagedSession')allFailures.push(call.outcome.error);else if(!isConsumedPreparationCall(binding,call))invalid.push(call.outcome.error);
   }
  }
  try{need(binding.physicalCalls.length===count,'physical_population_after_barrier');for(let i=0;i<binding.methods.length;i++)need(binding.methods[i].calls.length===methodPopulations[i],'call_population_after_barrier');sameService(binding);}catch(error){invalid.push(error);}
  for(const group of binding.bindings){for(const entry of group.snapshot?.coreExecutions??[])await entry.reaction;for(const entry of group.snapshot?.pending??[])await entry.reaction;try{verifyQualifiedGroupFailureOrigins(group,expected);}catch(error){invalid.push(error);}}
  try{recheckQualifiedPreparationSources(binding,expected);}catch(error){invalid.push(error);}
  for(const error of binding.errors)invalid.push(error);let known=true;for(const error of allFailures)if(!isQualifiedExpectedCallbackFailure(error,expected))known=false;
  if(!known||invalid.length)throwAll([...allFailures,...invalid]);
  const receipt=retainObserved(binding,'qualified-service-callback-terminal',Object.freeze({callbacksTerminal:true as const,nativeHealthy:false as const,originalServiceOutcome,...(originalServiceOutcome.ok?{}:{originalServiceError:originalServiceOutcome.error})}));
  try{recheckQualifiedPreparationSources(binding,expected);}catch(error){invalid.push(error);}
  if(binding.errors.length||invalid.length)throwAll([...allFailures,...invalid,...binding.errors]);binding.terminal=true;return receipt;
 })();binding.finish=retainObserved(binding,'qualified-service-callback-finish',finish);return finish;
}
export async function awaitQualifiedServiceCallbackObservations(binding:QualifiedServiceCallbacks):Promise<void>{
 const failures:unknown[]=[];
 for(const reaction of binding.bindingReactions)await reaction;
 const populations=binding.methods.map(method=>method.calls.length);
 for(const captured of binding.methods)for(const call of captured.calls){
  await call.reaction;
  if(!call.outcome)failures.push(Error('qualified_original_callback_outcome_missing'));
  else if(call.outcome.ok===false&&!(binding.terminal&&binding.finishArguments&&((captured.key==='dispose'||captured.key==='closeManagedSession')?isQualifiedExpectedCallbackFailure(call.outcome.error,binding.finishArguments.expected):(call.outcome.error===binding.finishArguments.expected&&isConsumedPreparationCall(binding,call)))))failures.push(call.outcome.error);
 }
 for(let index=0;index<binding.methods.length;index++)if(binding.methods[index].calls.length!==populations[index])failures.push(Error('qualified_callback_observation_population_changed'));
 if(binding.terminal&&binding.finishArguments)try{recheckQualifiedPreparationSources(binding,binding.finishArguments.expected);}catch(error){failures.push(error);}
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
 const preparationConsumed=new Set<object>();
 for(const pending of snapshot.pending){if(pending.outcome?.ok!==false)continue;const pendingError=pending.outcome.error;
  if(pending.kind==='physical')need(binding.physicalCalls.some(call=>call.group===group&&call.raw===pending.raw&&call.outcome?.ok===false&&call.outcome.error===pendingError),'origin_physical_snapshot_propagation');
  else if(pending.kind==='child-execution'){
   const execution=byId.get(pending.agentId!);need(execution?.execution&&execution.executionOutcome?.ok===false&&execution.executionOutcome.error===pending.outcome.error,'origin_child_handle_execution_propagation');
  }else if(pending.kind==='preparation'){const source=consumedPreparationPending(binding,group,pending);need(source&&!preparationConsumed.has(source),'origin_unconsumed_or_extra_preparation_failure');preparationConsumed.add(source);}else throw pending.outcome.error;
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


const qualifiedPreparationPoisoned=new WeakSet<object>(),qualifiedPreparationPoisonHas=WeakSet.prototype.has,qualifiedPreparationPoisonAdd=WeakSet.prototype.add;
export function hasQualifiedPreparationNativePoison(binding:QualifiedServiceCallbacks):boolean{return apply(qualifiedPreparationPoisonHas,qualifiedPreparationPoisoned,[binding])===true;}
// Opt-in only for a case which deliberately consumes an original managed
// preparation rejection. The occurrence remains separate from native health.
function sameQualifiedPreparationAuthority(binding:QualifiedServiceCallbacks):void{
 const authority=binding.preparationAuthority;need(authority&&proto(binding.service)===authority.inspectPrototype&&own(binding.service,'inspectManagedFollowupPreparation')===undefined&&slot(binding.service,'managedFollowupPreparations')===authority.preparations,'preparation_fixed_inspect_and_map');
 const current=own(authority.inspectPrototype,'inspectManagedFollowupPreparation'),original=authority.inspectDescriptor;need(current&&keys(current).length===keys(original).length&&keys(original).every(key=>has(current,key)&&slot(current,key)===slot(original,key))&&current.value===authority.inspectOriginal,'preparation_inspect_original_descriptor');
}
function equalQualifiedPreparationClosure(left:unknown,right:unknown):boolean{
 const aSeen=new Set<object>(),bSeen=new Set<object>();let population=0;
 const equal=(a:unknown,b:unknown,depth:number):boolean=>{
  if(++population>10000||depth>64)return false;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b&&!(typeof a==='function'||typeof b==='function')&&!(typeof a==='number'&&!Number.isFinite(a));
  object(a);object(b);if(aSeen.has(a)||bSeen.has(b))return false;aSeen.add(a);bSeen.add(b);
  const pa=proto(a),pb=proto(b);if(pa!==pb||![Object.prototype,Array.prototype,null].includes(pa))return false;
  const ak=keys(a),bk=keys(b);if(ak.length!==bk.length)return false;
  for(let i=0;i<ak.length;i++){const key=ak[i];if(typeof key!=='string'||bk[i]!==key)return false;const x=own(a,key),y=own(b,key);if(!x||!y||!has(x,'value')||!has(y,'value')||!equal(x.value,y.value,depth+1))return false;}
  return true;
 };return equal(left,right,0);
}
function installQualifiedPreparationSources(binding:QualifiedServiceCallbacks):void{
 const service=binding.service,options=slot(service,'options');object(options);
 const global=slot(service,'observationPreparationDrains');promises(global);binding.containers.globalPreparations=global as Set<Promise<void>>;
 const inspectPrototype=proto(service);object(inspectPrototype);need(own(service,'inspectManagedFollowupPreparation')===undefined,'preparation_no_own_inspect_replacement');const inspectDescriptor=own(inspectPrototype,'inspectManagedFollowupPreparation');need(inspectDescriptor&&has(inspectDescriptor,'value')&&typeof inspectDescriptor.value==='function','preparation_original_inspect_descriptor');
 const preparations=slot(service,'managedFollowupPreparations');object(preparations);need(proto(preparations)===WeakMap.prototype,'preparation_original_token_map');binding.preparationAuthority={inspectOriginal:inspectDescriptor.value,inspectPrototype,inspectDescriptor,preparations:preparations as WeakMap<object,object>};
 const beginOriginal=method(service,'beginManagedFollowup'),producerOriginal=slot(options,'prepareObservationFollowup');need(typeof producerOriginal==='function','preparation_original_own_producer');
 install(binding,service,'beginManagedFollowup',beginOriginal,call=>{
  const source:QualifiedPreparationSource={begin:call};binding.preparationSources.push(retainObserved(binding,'qualified-preparation-fixed-begin-source',source));
  let returned:unknown;
  try{returned=recordCall(binding,call,beginOriginal,()=>{
   need(call.receiver===service&&call.args.length===4&&call.originRecord!==undefined&&call.preClosing===true&&call.originSlot===undefined&&!binding.sealed&&!binding.terminal&&!binding.hooks.isClosing(),'preparation_begin_origin');
   need(binding.methods.some(method=>method.key==='prepareRoot'&&method.calls.some(prior=>prior.originRecord===call.originRecord)),'preparation_begin_same_case_origin');
   const[group,child,pending,ticket]=call.args;object(group);object(child);object(pending);object(ticket);
   const bound=binding.bindings.find(entry=>entry.group===group);need(bound,'preparation_begin_bound_group');sameGroup(bound);
   const id=slot(child,'id');need(typeof id==='string'&&apply(mapGet,bound.children,[id])===child&&apply(mapGet,bound.core.originalRecords,[id])!==undefined,'preparation_begin_child');
   const operationId=slot(pending,'operationId'),expectedTurn=slot(pending,'expectedTurn');need(typeof operationId==='string'&&typeof expectedTurn==='number'&&Number.isSafeInteger(expectedTurn),'preparation_begin_operation');
   const operation=apply(method(binding.store,'getOperation'),binding.store,[bound.groupId,operationId]);object(operation);
   need(slot(pending,'ticket')===ticket&&array(slot(child,'followups'))[0]===pending,'preparation_begin_current_pending_ticket');
   const context=slot(child,'context'),coreRecord=apply(mapGet,bound.core.originalRecords,[id]);object(context);object(coreRecord);
   source.group=bound;source.child=child;source.pending=pending;source.ticket=ticket;source.context=context;source.coreRecord=coreRecord;source.operationId=operationId;source.expectedTurn=expectedTurn as number;
  });return returned;}finally{try{
   need(source.group&&call.rawWritten&&isPromise(call.raw),'preparation_begin_original_promise');
   need(slot(service,'observationPreparationDrains')===global,'preparation_global_set_identity');
   need(promises(global).includes(call.raw as Promise<void>)&&promises(apply(weakMapGet,binding.containers.preparations,[source.group.group])).includes(call.raw as Promise<void>),'preparation_original_return_membership');
  }catch(error){retainedError(binding,error);}}
 });
 install(binding,options,'prepareObservationFollowup',producerOriginal,call=>recordCall(binding,call,producerOriginal,()=>{
  need(call.receiver===options&&call.args.length===1&&!binding.terminal,'preparation_producer_receiver');
  const source=binding.preparationSources.find(entry=>entry.begin===call.parentCall);need(source&&source.group&&source.child&&source.pending&&source.ticket&&!source.producer,'preparation_producer_exact_begin');sameGroup(source.group);
  const preparation=call.args[0];object(preparation);sameQualifiedPreparationAuthority(binding);const authority=binding.preparationAuthority!;const facts=apply(authority.inspectOriginal,service,[preparation]);object(facts);
  need(slot(facts,'operationId')===source.operationId&&slot(facts,'nextTurnId')!==slot(facts,'previousTurnId'),'preparation_producer_operation');
  const childSession=slot(facts,'childSession');object(childSession);
  // The existing public inspection is used while the token is live, before
  // the original producer. No caller is reopened after sealing.
  const entry=apply(weakMapGet,authority.preparations,[preparation]);object(entry);
  const rawFacts=slot(entry,'facts');object(rawFacts);need(source.context&&source.coreRecord&&slot(entry,'group')===source.group.group&&slot(entry,'child')===source.child&&slot(entry,'pending')===source.pending&&slot(entry,'oldContext')===source.context&&slot(source.child,'context')===source.context&&slot(source.context,'turnId')===slot(facts,'previousTurnId')&&apply(mapGet,source.group.core.originalRecords,[slot(source.child,'id')])===source.coreRecord,'preparation_token_same_actual_owner');
  const rawKeys=keys(rawFacts),publicKeys=keys(facts);need(rawKeys.length===publicKeys.length&&rawKeys.every(key=>typeof key==='string'&&publicKeys.includes(key)),'preparation_public_facts_population');
  for(const key of rawKeys){const original=slot(rawFacts,key),published=slot(facts,key);if(key==='closure')need(equalQualifiedPreparationClosure(original,published),'preparation_public_closure_copy');else need(original===published,'preparation_public_facts_field');}
  source.rawFacts=rawFacts;
  need(call.originRecord===source.begin.originRecord&&call.originSlot===source.begin.originSlot,'preparation_producer_same_origin');
  source.producer=call;source.preparation=preparation;source.facts=facts;
 }));
}
export function consumeQualifiedPreparationFailure(binding:QualifiedServiceCallbacks,error:Error,bodyOutcomeP:Promise<unknown>,bodyOutcomeValue:unknown):void{
 need(binding.hooks.observeExpectedPreparation===true&&!binding.sealed&&!binding.terminal&&binding.preparationSources.length===1,'preparation_case_fixed_population');
 need(isQualifiedExpectedCallbackFailure(error,error)&&isPromise(bodyOutcomeP),'preparation_case_original_native_refs');
 const source=binding.preparationSources[0];need(source.group&&source.producer&&source.preparation&&source.facts&&source.begin.rawWritten&&isPromise(source.begin.raw)&&source.producer.rawWritten&&isPromise(source.producer.raw)&&!source.consumption,'preparation_case_single_original_source');
 source.consumption=retainObserved(binding,'qualified-preparation-existing-case-consumption',Object.freeze({error,bodyOutcomeP,bodyOutcomeValue}));
 source.bodyReaction=retainObserved(binding,'qualified-preparation-original-case-outcome-reaction',apply(nativeThen,bodyOutcomeP,[(value:unknown)=>{source.bodyOutcome={ok:true,value};},(failure:unknown)=>{source.bodyOutcome={ok:false,error:failure};}])as Promise<void>);
 // Sticky memory-only health poison, independent of later fulfilled close slots.
 apply(qualifiedPreparationPoisonAdd,qualifiedPreparationPoisoned,[binding]);binding.preparationNativePoisoned=true;
}
async function verifyQualifiedPreparationSources(binding:QualifiedServiceCallbacks,expected:Error):Promise<void>{
 if(binding.hooks.observeExpectedPreparation!==true){need(binding.preparationSources.length===0&&!binding.preparationNativePoisoned,'preparation_disabled_population');return;}
 const global=binding.containers.globalPreparations;need(global&&slot(binding.service,'observationPreparationDrains')===global,'preparation_original_global_set');
 need(binding.preparationSources.length===1,'preparation_final_population');const source=binding.preparationSources[0],producer=source.producer,consumed=source.consumption;
 need(source.group&&source.child&&source.pending&&source.ticket&&source.facts&&source.preparation&&producer&&consumed,'preparation_complete_original_source');
 need(source.begin.reaction&&producer.reaction&&source.bodyReaction,'preparation_original_reactions');await source.begin.reaction;await producer.reaction;await source.bodyReaction;
 recheckQualifiedPreparationSources(binding,expected);
}
function recheckQualifiedPreparationSources(binding:QualifiedServiceCallbacks,expected:Error):void{
 if(binding.hooks.observeExpectedPreparation!==true){need(binding.preparationSources.length===0&&!binding.preparationNativePoisoned,'preparation_disabled_population');return;}
 const global=binding.containers.globalPreparations;need(global&&slot(binding.service,'observationPreparationDrains')===global,'preparation_original_global_set');
 need(binding.preparationSources.length===1,'preparation_final_population');const source=binding.preparationSources[0],producer=source.producer,consumed=source.consumption;
 need(source.group&&source.child&&source.pending&&source.ticket&&source.facts&&source.preparation&&producer&&consumed,'preparation_complete_original_source');
 need(source.begin.reaction&&producer.reaction&&source.bodyReaction,'preparation_original_reactions');
 const beginMethods=binding.methods.filter(method=>method.key==='beginManagedFollowup'),producerMethods=binding.methods.filter(method=>method.key==='prepareObservationFollowup');need(beginMethods.length===1&&producerMethods.length===1&&beginMethods[0].calls.length===1&&beginMethods[0].calls[0]===source.begin&&producerMethods[0].calls.length===1&&producerMethods[0].calls[0]===producer,'preparation_exact_call_occurrence_population');
 need(source.begin.rawWritten&&isPromise(source.begin.raw)&&producer.rawWritten&&isPromise(producer.raw)&&source.begin.outcome?.ok===false&&producer.outcome?.ok===false,'preparation_both_original_rejected');
 need(consumed.error===expected&&source.begin.outcome.error===expected&&producer.outcome.error===expected&&source.bodyOutcome?.ok===true&&source.bodyOutcome.value===consumed.bodyOutcomeValue,'preparation_original_error_and_body_refs');
 need(producer.parentCall===source.begin&&producer.receiver===slot(binding.service,'options')&&producer.args.length===1&&producer.args[0]===source.preparation&&source.begin.receiver===binding.service,'preparation_final_call_identity');
 sameGroup(source.group);need(source.begin.args[0]===source.group.group&&source.begin.args[1]===source.child&&source.begin.args[2]===source.pending&&source.begin.args[3]===source.ticket,'preparation_final_begin_arguments');
 need(promises(global).length===0&&!promises(global).includes(source.begin.raw as Promise<void>)&&!promises(apply(weakMapGet,binding.containers.preparations,[source.group.group])).includes(source.begin.raw as Promise<void>),'preparation_original_membership_removed');
 sameQualifiedPreparationAuthority(binding);need(hasQualifiedPreparationNativePoison(binding),'preparation_sticky_native_poison');
}
function isConsumedPreparationCall(binding:QualifiedServiceCallbacks,call:Call):boolean{
 return binding.preparationSources.some(source=>source.consumption!==undefined&&(source.begin===call||source.producer===call)&&call.outcome?.ok===false&&call.outcome.error===source.consumption.error&&source.begin.outcome?.ok===false&&source.producer?.outcome?.ok===false&&source.begin.outcome.error===source.consumption.error&&source.producer.outcome.error===source.consumption.error);
}
function consumedPreparationPending(binding:QualifiedServiceCallbacks,group:QualifiedGroupCallbacks,pending:GroupPending):QualifiedPreparationSource|undefined{
 return binding.preparationSources.find(source=>source.group===group&&source.consumption!==undefined&&pending.raw===source.begin.raw&&pending.outcome?.ok===false&&pending.outcome.error===source.consumption.error&&source.begin.outcome?.ok===false&&source.begin.outcome.error===source.consumption.error);
}

// Appended to the test-only callback helper; uses its captured native readers.
import {AsyncLocalStorage as SourceAsyncLocalStorage} from 'node:async_hooks';
type SourceCall={receiver:unknown;args:unknown[];rawWritten:boolean;raw?:unknown;outcome?:Outcome;reaction?:Promise<void>};
type SourceStoreCall=SourceCall&{queue?:Promise<void>;queueOutcome?:Outcome;queueReaction?:Promise<void>};
type SourceRole={taskId:string;ticket:object;expected:Error;writes:SourceCall[];publications:SourceCall[];spy?:{callee:Function;installed:Function;active:boolean;prototypeDescriptor:PropertyDescriptor;before?:PropertyDescriptor}};
type SourceCollections=ReadonlyArray<readonly [string,object,'set'|'map']>;
export type QualifiedSourceCallbacks={host:object;store:object;options:object;retain:Retain;isClosing:()=>boolean;sourceMethod:Function;publicationMethod:Function;saveMethod:Function;storeMethod:Function;storePrototype:object;storePrototypeDescriptor:PropertyDescriptor;savePrototypeDescriptor:PropertyDescriptor;storeBefore?:PropertyDescriptor;storeInstalled:Function;collections:SourceCollections;calls:SourceStoreCall[];errors:unknown[];role?:SourceRole;restored:boolean;finish?:Promise<QualifiedSourceCallbackReceipt>};
export type QualifiedSourceFailureOccurrence=Readonly<{sourceBinding:QualifiedSourceCallbacks;originalPublication:Promise<unknown>;originalWrite:Promise<unknown>;originalError:Error}>;
export type QualifiedSourceCallbackReceipt=Readonly<{callbacksTerminal:true;nativeHealthy:false;originalSourceClose:Promise<unknown>;originalSourceError:unknown;occurrence:QualifiedSourceFailureOccurrence}>;
const qualifiedSourcePublicationOrigin=new SourceAsyncLocalStorage<{binding:QualifiedSourceCallbacks;call:SourceCall}>();
const qualifiedSourceConsumptions=new WeakMap<QualifiedSourceFailureOccurrence,SourceRole>();
const qualifiedSourceConsumedRoles=new WeakSet<SourceRole>();
const sourceSetSize=own(Set.prototype,'size')!.get!,sourceMapSize=own(Map.prototype,'size')!.get!;
function sourceRetain<T>(binding:QualifiedSourceCallbacks,label:string,value:T):T{try{binding.retain(label,value);}catch(error){binding.errors.push(error);}return value;}
function sourceInstalledDescriptor(fn:Function):PropertyDescriptor{return {value:fn,writable:true,configurable:true,enumerable:false};}
function sourceObserve(binding:QualifiedSourceCallbacks,raw:unknown,label:string,accept:(outcome:Outcome)=>void):Promise<void>{
 need(isPromise(raw),'source_original_native_promise');
 const reaction=apply(nativeThen,raw,[(value:unknown)=>{try{accept(sourceRetain(binding,label+':fulfilled',{ok:true,value}));}catch(error){binding.errors.push(error);}},(error:unknown)=>{try{accept(sourceRetain(binding,label+':rejected',{ok:false,error}));}catch(failure){binding.errors.push(failure);}}]) as Promise<void>;
 return sourceRetain(binding,label+':reaction',reaction);
}
function sameSourceDescriptor(actual:PropertyDescriptor|undefined,expected:PropertyDescriptor):boolean{if(!actual)return false;const names=keys(actual);return names.length===keys(expected).length&&names.every(key=>has(expected,key)&&slot(actual,key)===slot(expected,key));}
function sourceSame(binding:QualifiedSourceCallbacks){
 need(slot(binding.host,'options')===binding.options&&slot(binding.options,'snapshotStore')===binding.store,'source_same_host_store');
 need(method(binding.host,'closeSourceWriterForMigration')===binding.sourceMethod&&method(binding.host,'publishGroupObservationReference')===binding.publicationMethod,'source_same_original_methods');
 need(own(binding.host,'closeSourceWriterForMigration')===undefined&&own(binding.host,'publishGroupObservationReference')===undefined,'source_no_replaced_host_method');
 for(const[name,value,kind]of binding.collections){need(slot(binding.host,name)===value,'source_same_collection:'+name);object(value);need(proto(value)===(kind==='set'?Set.prototype:Map.prototype),'source_native_collection:'+name);}
 need(!binding.restored&&sameSourceDescriptor(own(binding.store,'closeAndDrain'),sourceInstalledDescriptor(binding.storeInstalled)),'source_same_store_observer');
 need(proto(binding.store)===binding.storePrototype&&sameSourceDescriptor(own(binding.storePrototype,'closeAndDrain'),binding.storePrototypeDescriptor),'source_same_store_prototype_descriptor');
 if(binding.role?.spy?.active){need(sameSourceDescriptor(own(binding.store,'save'),sourceInstalledDescriptor(binding.role.spy.installed))&&sameSourceDescriptor(own(binding.storePrototype,'save'),binding.role.spy.prototypeDescriptor),'source_same_active_save_observer');}else need(own(binding.store,'save')===undefined&&sameSourceDescriptor(own(binding.storePrototype,'save'),binding.savePrototypeDescriptor),'source_original_save_restored');
}
function sourceCaptureCall(binding:QualifiedSourceCallbacks,call:SourceCall,invoke:()=>unknown):unknown{
 let raw:unknown;try{raw=invoke();}catch(error){call.outcome={ok:false,error};try{sourceRetain(binding,'qualified-source-original-throw',error);}catch(failure){binding.errors.push(failure);}throw error;}
 call.raw=raw;call.rawWritten=true;try{sourceRetain(binding,'qualified-source-original-value',raw);call.reaction=sourceObserve(binding,raw,'qualified-source-call',outcome=>{call.outcome=outcome;});}catch(error){binding.errors.push(error);}return raw;
}
export function captureQualifiedSourceCallbacks(host:object,store:object,hooks:{retain:Retain;isClosing:()=>boolean}):QualifiedSourceCallbacks{
 object(host);object(store);const options=slot(host,'options');object(options);need(slot(options,'snapshotStore')===store,'source_original_store');
 const storeMethod=method(store,'closeAndDrain'),saveMethod=method(store,'save'),storeBefore=own(store,'closeAndDrain'),storePrototype=proto(store),storePrototypeDescriptor=own(storePrototype,'closeAndDrain')!,savePrototypeDescriptor=own(storePrototype,'save')!;need(!storeBefore&&own(store,'save')===undefined,'source_store_methods_unmodified');
 const collections:SourceCollections=[...['sourceOperations','sourceInvocations','sourceClosingInvocations','cancellingTaskIds'].map(name=>[name,slot(host,name),'set'] as const),...['sourceClosingExecutions','executionPromises','activeExecutions','cancellationPromises','mutationChains'].map(name=>[name,slot(host,name),'map'] as const)] as SourceCollections;
 const binding:QualifiedSourceCallbacks={host,store,options,retain:hooks.retain,isClosing:hooks.isClosing,sourceMethod:method(host,'closeSourceWriterForMigration'),publicationMethod:method(host,'publishGroupObservationReference'),storeMethod,saveMethod,storePrototype,storePrototypeDescriptor,savePrototypeDescriptor,storeBefore,storeInstalled:()=>{},collections,calls:[],errors:[],restored:false};
 const installed=function(this:unknown,...args:unknown[]){
  const call:SourceStoreCall={receiver:this,args,rawWritten:false};binding.calls.push(sourceRetain(binding,'qualified-source-store-call',call));
  // Observation failures retain evidence, and never replace original behavior.
  try{sourceSame(binding);need(this===store&&args.length===0&&binding.isClosing(),'source_store_close_origin');const queue=slot(store,'writerQueue');need(isPromise(queue),'source_writer_queue');call.queue=queue as Promise<void>;call.queueReaction=sourceObserve(binding,queue,'qualified-source-writer-queue',outcome=>{call.queueOutcome=outcome;});}catch(error){binding.errors.push(error);}
  return sourceCaptureCall(binding,call,()=>apply(storeMethod,this,args));
 };
 binding.storeInstalled=installed;Object.defineProperty(store,'closeAndDrain',{value:installed,writable:true,configurable:true,enumerable:false});sourceSame(binding);
 sourceRetain(binding,'qualified-source-fixed-binding',binding);return binding;
}
export function armQualifiedSourceFailure(binding:QualifiedSourceCallbacks,input:{taskId:string;ticket:object;expected:Error}):void{
 sourceSame(binding);need(!binding.isClosing()&&!binding.role&&typeof input.taskId==='string'&&closedExpectedLeaf(input.expected),'source_one_prebody_role');object(input.ticket);
 need(slot(binding.host,'sourceClosing')===false&&array(slot(binding.host,'sourceCloseFailures')).length===0,'source_clean_initial_failure_population');
 binding.role=sourceRetain(binding,'qualified-source-expected-occurrence',{taskId:input.taskId,ticket:input.ticket,expected:input.expected,writes:[],publications:[]});
}
// Install after the original prototype spy, without changing its fault behavior.
export function bindQualifiedSourceFailureSpy(binding:QualifiedSourceCallbacks,callee:Function):void{
 const role=binding.role;need(role&&!role.spy&&!binding.isClosing()&&own(binding.store,'save')===undefined&&own(binding.storePrototype,'save')?.value===callee,'source_installed_fault_spy');
 const installed=function(this:unknown,...args:unknown[]){
  const call:SourceCall={receiver:this,args,rawWritten:false};role.writes.push(sourceRetain(binding,'qualified-source-write-occurrence',call));
  try{const origin=qualifiedSourcePublicationOrigin.getStore();sourceSame(binding);need(origin?.binding===binding&&role.publications.includes(origin.call)&&this===binding.store&&!binding.isClosing(),'source_write_publication_origin');const values=array(args);need(values.length===2&&slot(values[0],'taskId')===role.taskId&&slot(values[1],'taskId')===role.taskId,'source_write_task');}catch(error){binding.errors.push(error);}
  return sourceCaptureCall(binding,call,()=>apply(callee,this,args));
 };
 role.spy=sourceRetain(binding,'qualified-source-save-spy-binding',{callee,installed,active:true,prototypeDescriptor:own(binding.storePrototype,'save')!});Object.defineProperty(binding.store,'save',{value:installed,writable:true,configurable:true,enumerable:false});sourceSame(binding);
}
export function restoreQualifiedSourceFailureSpy(binding:QualifiedSourceCallbacks):void{
 sourceSame(binding);const spy=binding.role?.spy;need(spy?.active&&sameSourceDescriptor(own(binding.store,'save'),sourceInstalledDescriptor(spy.installed)),'source_restore_save_observer');need(Reflect.deleteProperty(binding.store,'save'),'source_remove_save_observer');need(own(binding.store,'save')===undefined&&sameSourceDescriptor(own(binding.storePrototype,'save'),spy.prototypeDescriptor),'source_save_observer_removed_exactly');spy.active=false;
}
export function beginQualifiedSourceFailurePublication(binding:QualifiedSourceCallbacks,ticket:object):Promise<unknown>{
 sourceSame(binding);const role=binding.role;need(role&&!binding.isClosing()&&ticket===role.ticket,'source_publication_origin');
 const call:SourceCall={receiver:binding.host,args:[ticket],rawWritten:false};role.publications.push(sourceRetain(binding,'qualified-source-publication-occurrence',call));
 return sourceCaptureCall(binding,call,()=>qualifiedSourcePublicationOrigin.run({binding,call},()=>apply(binding.publicationMethod,binding.host,[ticket]))) as Promise<unknown>;
}
// The caller places this after the original rejection assertion succeeds.
export async function consumeQualifiedSourceFailure(binding:QualifiedSourceCallbacks,originalPublication:Promise<unknown>,expected:Error):Promise<QualifiedSourceFailureOccurrence>{
 sourceSame(binding);const role=binding.role;need(role&&!qualifiedSourceConsumedRoles.has(role)&&role.expected===expected&&!binding.isClosing()&&role.writes.length===1&&role.publications.length===1,'source_one_consumed_occurrence');
 const write=role.writes[0],publication=role.publications[0];await write.reaction;await publication.reaction;
 need(!binding.errors.length&&write.rawWritten&&isPromise(write.raw)&&write.outcome?.ok===false&&write.outcome.error===expected&&publication.rawWritten&&publication.raw===originalPublication&&publication.outcome?.ok===false&&publication.outcome.error===expected,'source_exact_consumed_originals');
 const occurrence=sourceRetain(binding,'qualified-source-body-consumption',Object.freeze({sourceBinding:binding,originalPublication,originalWrite:write.raw as Promise<unknown>,originalError:expected}));qualifiedSourceConsumptions.set(occurrence,role);qualifiedSourceConsumedRoles.add(role);return occurrence;
}
export function finishQualifiedSourceCallbacks(binding:QualifiedSourceCallbacks,occurrence:QualifiedSourceFailureOccurrence,sourceSlot:{receiver:unknown;method:Function;args:unknown[];rawWritten:boolean;raw?:unknown;outcome?:Outcome}):Promise<QualifiedSourceCallbackReceipt>{
 need(!binding.finish,'source_finish_once');
 const finish=(async():Promise<QualifiedSourceCallbackReceipt>=>{
  sourceSame(binding);const role=binding.role;need(role&&qualifiedSourceConsumptions.get(occurrence)===role&&occurrence.sourceBinding===binding&&role.writes.length===1&&role.publications.length===1,'source_authentic_consumption');
  need(role.spy&&!role.spy.active&&binding.isClosing()&&sourceSlot.receiver===binding.host&&sourceSlot.method===binding.sourceMethod&&array(sourceSlot.args).length===0&&sourceSlot.rawWritten&&isPromise(sourceSlot.raw)&&sourceSlot.raw===slot(binding.host,'sourceClosePromise')&&sourceSlot.outcome?.ok===false,'source_original_rejected_close_slot');
  const error=sourceSlot.outcome.error;let closeOutcome:Outcome|undefined;await sourceObserve(binding,sourceSlot.raw,'qualified-source-original-close',outcome=>{closeOutcome=outcome;});need(closeOutcome?.ok===false&&closeOutcome.error===error,'source_original_close_rejection_identity');object(error);need(isError(error)&&proto(error)===AggregateProto&&trustedStack(error,aggregateStackShape),'source_native_aggregate');
  for(const key of keys(error))need(typeof key==='string'&&['stack','message','errors'].includes(key),'source_closed_error_shape');
  need(slot(error,'message')==='task_source_close_unconfirmed','source_error_role');const failures=array(slot(error,'errors'));need(failures.length===1&&failures[0]===role.expected&&closedExpectedLeaf(role.expected),'source_exact_error_occurrence');
  need(slot(binding.host,'sourceClosing')===true&&slot(binding.host,'sourceTailClosed')===true,'source_sealed_tail');const drain=slot(binding.host,'sourceDrainPromise');need(isPromise(drain),'source_original_drain_promise');
  let drained:Outcome|undefined;await sourceObserve(binding,drain,'qualified-source-original-drain',outcome=>{drained=outcome;});need(drained?.ok===true,'source_drain_fulfilled');const values=array(drained.value);need(values.length===1&&values[0]===role.expected,'source_drain_exact_occurrence');
  const sticky=array(slot(binding.host,'sourceCloseFailures'));need(sticky.length===1&&sticky[0]===role.expected,'source_sticky_exact_occurrence');
  for(const[name,value,kind]of binding.collections)if(name!=='sourceClosingExecutions')need(apply(kind==='set'?sourceSetSize:sourceMapSize,value,[])===0,'source_callbacks_remaining:'+name);
  const executions=slot(binding.host,'sourceClosingExecutions');const initial=entries(executions),history=initial.map(([id,entry])=>({id,entry,promise:slot(entry,'promise'),outcome:undefined as Outcome|undefined}));for(const row of history){await sourceObserve(binding,row.promise,'qualified-source-historical-execution',value=>{row.outcome=value;});need(row.outcome?.ok===true,'source_historical_execution_failed');}sameMembers(entries(executions),initial,'source_historical_execution_population');
  need(binding.calls.length===1,'source_single_store_close');const call=binding.calls[0];await call.reaction;await call.queueReaction;
  need(call.receiver===binding.store&&array(call.args).length===0&&call.rawWritten&&isPromise(call.raw)&&call.outcome?.ok===true&&isPromise(call.queue)&&call.queueOutcome?.ok===true&&slot(binding.store,'writerQueue')===call.queue&&slot(binding.store,'writerClosed')===true,'source_original_writer_closed_terminal');
  sourceSame(binding);need(!binding.errors.length&&role.writes.length===1&&role.publications.length===1&&binding.calls.length===1&&slot(binding.host,'sourceDrainPromise')===drain&&slot(binding.host,'sourceClosePromise')===sourceSlot.raw&&slot(binding.host,'sourceClosing')===true&&slot(binding.host,'sourceTailClosed')===true&&slot(binding.store,'writerQueue')===call.queue&&slot(binding.store,'writerClosed')===true,'source_stable_final_originals');
  for(const[name,value,kind]of binding.collections)if(name!=='sourceClosingExecutions')need(apply(kind==='set'?sourceSetSize:sourceMapSize,value,[])===0,'source_final_callbacks_remaining:'+name);sameMembers(entries(executions),initial,'source_final_execution_population');for(const row of history)need(slot(row.entry,'promise')===row.promise&&row.outcome?.ok===true,'source_final_execution_original_promise');const finalSticky=array(slot(binding.host,'sourceCloseFailures'));need(finalSticky.length===1&&finalSticky[0]===role.expected,'source_final_sticky_occurrence');const finalDrain=array(drained.value);need(finalDrain.length===1&&finalDrain[0]===role.expected,'source_final_drain_occurrence');const finalFailures=array(slot(error,'errors'));need(finalFailures.length===1&&finalFailures[0]===role.expected,'source_final_error_occurrence');
  const receipt=sourceRetain(binding,'qualified-source-callback-terminal',Object.freeze({callbacksTerminal:true as const,nativeHealthy:false as const,originalSourceClose:sourceSlot.raw as Promise<unknown>,originalSourceError:error,occurrence}));if(binding.errors.length)throwAll(binding.errors);return receipt;
 })();binding.finish=sourceRetain(binding,'qualified-source-callback-finish',finish);return finish;
}
export function restoreQualifiedSourceCallbacks(binding:QualifiedSourceCallbacks):void{
 sourceSame(binding);need(!binding.restored&&sameSourceDescriptor(own(binding.store,'closeAndDrain'),sourceInstalledDescriptor(binding.storeInstalled)),'source_restore_original_descriptor');
 if(binding.storeBefore)Object.defineProperty(binding.store,'closeAndDrain',binding.storeBefore);else need(Reflect.deleteProperty(binding.store,'closeAndDrain'),'source_remove_observer');need(own(binding.store,'closeAndDrain')===binding.storeBefore&&sameSourceDescriptor(own(binding.storePrototype,'closeAndDrain'),binding.storePrototypeDescriptor),'source_store_observer_removed_exactly');binding.restored=true;
}
