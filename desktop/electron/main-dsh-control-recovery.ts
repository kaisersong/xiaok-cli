import {types} from 'node:util';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {createIntrinsicSet,appendIntrinsic} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import {readOriginalMainDshServicesBinding} from './desktop-services.js';
import {claimOriginalMainDshServiceRole} from './main-dsh-service-role.js';
import {assertOriginalBrokerAdmissionClient} from './collaboration-room-broker-client.js';
import {createMainDshBrokerControlSource,readOriginalMainDshBrokerControlSource,readOriginalMainDshBrokerReply,type MainDshBrokerControlSource} from './main-dsh-broker-control-source.js';
import {readOriginalMainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalKSwarmServiceIdentity} from './kswarm-service.js';
import {readOriginalDshAdmissionPort,readOriginalDshDesktopState} from './desktop-multi-agent-store.js';
import {readOriginalMainDshBusinessSource,readOriginalMainDshBusinessDelivery,type MainDshBusinessDelivery} from './main-dsh-business-source.js';

const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const freeze=Object.freeze,create=Object.create,NativePromise=Promise,then=Promise.prototype.then,NativeAbort=AbortController,abort=AbortController.prototype.abort;
const isProxy=types.isProxy,isArray=Array.isArray;
type R=Record<string,unknown>;
type Binding=ReturnType<typeof readOriginalMainDshServicesBinding>;
export interface OriginalMainDshControlRecovery {reconcile():Promise<void>;stopAccepting():void;close():Promise<void>}
interface Row {
 services:object;sources:object;client:object;binding:Binding;handle:OriginalMainDshControlRecovery;birth:Promise<OriginalMainDshControlRecovery>;birthDone:Promise<void>;
 stock:RoomTurnCustody;negatives:ReturnType<typeof createIntrinsicSet<RoomTurnCustody>>;controller:AbortController;broker?:MainDshBrokerControlSource;brokerClose?:Function;brokerStop?:Function;
 brokerConsumer?:Function;stopping:boolean;stopAttempted:boolean;physicalKnown:boolean;failure?:{raw:unknown};secondaries:unknown[];work?:Promise<void>;closing?:Promise<void>;
}
const rows=new WeakMap<object,Row>();
/** Original physical inventory only, never permission to read or send. Known
 * business failure does not hide secondary unknown cleanup or live SDK tails. */
export function assertOriginalMainDshControlRecoveryPhysicalKnown(handle:unknown,services:unknown,sources:unknown):void {
 const row=apply(get,rows,[services]) as Row|undefined;
 if(!row||row.handle!==handle||row.sources!==sources||!row.physicalKnown)fail('DSH_MAIN_CONTROL_RECOVERY_PHYSICAL_UNCONFIRMED');
}
function fail(code='DSH_MAIN_CONTROL_RECOVERY_REQUIRED'):never{throw Error(code);}
function method(receiver:object,key:string):Function {const d=descriptor(receiver,key);if(!d||!own(d,'value')||typeof d.value!=='function'||isProxy(d.value))fail();return d.value;}
function record(raw:unknown):R {const value=captureDispatchBusinessData(raw);if(!value||typeof value!=='object'||isArray(value))fail('DSH_MAIN_CONTROL_RECOVERY_RESULT_INVALID');return value as R;}
function remember(row:Row,raw:unknown):void {if(!row.failure)row.failure={raw};else if(row.failure.raw!==raw)appendIntrinsic(row.secondaries,raw);row.stock.inventory(raw);}
function local(row:Row):void {if(row.stopping||row.failure)fail('DSH_MAIN_CONTROL_RECOVERY_CLOSED');row.stock.local();}
function current(row:Row):void {
 local(row);
 row.stock.syncVoid(()=>{
  const lease=row.binding.lease,native=readOriginalMainDshBootstrapAuthority(lease.realm,row.binding.store,lease.realm),service=readOriginalKSwarmServiceIdentity(row.binding.kswarmService);
  row.stock.syncVoid(native.assertCurrent,undefined,[]);row.stock.syncVoid(service.assertCurrent,undefined,[]);
  row.stock.syncVoid(native.assertLocal,undefined,[]);row.stock.syncVoid(service.assertLocal,undefined,[]);
 },undefined,[]);
 local(row);
}
function negativeVoid(row:Row,fn:Function,receiver:unknown,args:unknown[]):void {const stock=createRoomTurnCustody();row.negatives.add(stock);stock.syncVoid(fn,receiver,args);}
function stop(row:Row):void {
 row.stopping=true;if(row.stopAttempted){if(row.failure)throw row.failure.raw;return;}row.stopAttempted=true;
 const attempt=(fn:Function,receiver:unknown,args:unknown[])=>{try{negativeVoid(row,fn,receiver,args);}catch(raw){remember(row,raw);}};
 attempt(abort,row.controller,[Error('DSH_MAIN_CONTROL_RECOVERY_CLOSED')]);
 if(row.broker&&row.brokerStop)attempt(row.brokerStop,row.broker,[]);
 if(row.failure)throw row.failure.raw;
}
function state(row:Row){const lease=row.binding.lease;return readOriginalDshDesktopState(lease.realm,row.binding.store,lease.realm,lease.scope);}
function registeredBroker(row:Row):R {
 const snapshot=state(row);let broker:R|undefined;
 if(!snapshot.authority)fail('DSH_MAIN_CONTROL_RECOVERY_AUTHORITY_REQUIRED');
 for(let i=0;i<snapshot.authorizations.ownerDomains.length;i++){
  const domain=snapshot.authorizations.ownerDomains[i]!;
  if(domain.writerProfile==='broker_dsh_control_v1'){if(broker)fail('DSH_MAIN_CONTROL_RECOVERY_DOMAIN_CONFLICT');broker=record(domain);}
 }
 if(!broker||!broker.brokerBaseline)fail('DSH_MAIN_CONTROL_RECOVERY_BASELINE_REQUIRED');
 return broker;
}
function close(row:Row):Promise<void> {
 if(row.closing)return row.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;
 row.closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
 const operation=(async()=>{
  try{stop(row);}catch(raw){remember(row,raw);}
  await row.birthDone;
  if(row.work)try{await row.work;}catch(raw){remember(row,raw);}
  let physicalKnown=!!row.broker&&!!row.brokerConsumer;
  if(row.broker&&row.brokerConsumer)try{await row.stock.consumeResource(row.brokerConsumer,row.broker,[]);}catch(raw){physicalKnown=false;remember(row,raw);}
  try{await row.stock.waitPhysicalKnown();}catch(raw){physicalKnown=false;remember(row,raw);}
  const negatives=row.negatives.snapshot();for(let i=0;i<negatives.length;i++)try{await negatives[i]!.waitPhysicalKnown();}catch(raw){physicalKnown=false;remember(row,raw);}
  // Negative SDK failures can expose new own/symbol tails into the main stock.
  try{await row.stock.waitPhysicalKnown();}catch(raw){physicalKnown=false;remember(row,raw);}
  row.physicalKnown=physicalKnown;
  if(row.failure)throw row.failure.raw;
 })();apply(then,operation,[yes,no]);return row.closing;
}
/** One original Services lifetime, narrowed to reading durable controls. No
 * claims, control sends, Source scans, model/Root factories or budget effects. */
export function createOriginalMainDshControlRecovery(raw:unknown):Promise<OriginalMainDshControlRecovery> {
 if(!raw||typeof raw!=='object'||isProxy(raw))fail();
 const input=captureGithubOpaqueRecord(raw,['services','sources','brokerClient']),services=input.services as object,sources=input.sources as object,client=input.brokerClient as object;
 const binding=readOriginalMainDshServicesBinding(services,sources);assertOriginalBrokerAdmissionClient(client,binding.kswarmService);
 const prior=apply(get,rows,[services]) as Row|undefined;
 if(prior){if(prior.sources!==sources||prior.client!==client||prior.stopping||prior.failure)fail('DSH_MAIN_CONTROL_RECOVERY_CLOSED');return prior.birth;}
 claimOriginalMainDshServiceRole(services,sources,'control_recovery');
 let yes!:(value:OriginalMainDshControlRecovery)=>void,no!:(raw:unknown)=>void,complete!:()=>void;
 const birth=new NativePromise<OriginalMainDshControlRecovery>((resolve,reject)=>{yes=resolve;no=reject;}),birthDone=new NativePromise<void>(resolve=>{complete=resolve;});
 const row:Row={services,sources,client,binding,handle:undefined!,birth,birthDone,stock:createRoomTurnCustody(),negatives:createIntrinsicSet(),controller:new NativeAbort(),stopping:false,stopAttempted:false,physicalKnown:false,secondaries:[]};
 row.handle=freeze({reconcile:()=>reconcile(row),stopAccepting:()=>stop(row),close:()=>close(row)});apply(set,rows,[services,row]);
 row.brokerConsumer=function(this:object){if(this!==row.broker||!row.brokerClose)fail();return apply(row.brokerClose,this,[]);};
 const work=row.stock.root(async()=>{
  await row.stock.sdk(()=>binding.constructionReady,undefined,[]);local(row);
  registeredBroker(row);
  const lease=binding.lease;readOriginalMainDshBusinessSource(lease.businessSource,lease.realm,lease.runtime,lease.budgetSource,binding.store);
  await row.stock.sdk(createMainDshBrokerControlSource,undefined,[{services,sources,client}],{accept(value){
   const actual=readOriginalMainDshBrokerControlSource(value,lease.realm,binding.store);
   row.broker=actual;row.brokerClose=method(actual,'close');row.brokerStop=method(actual,'stopAccepting');return true;
  },consumer:row.brokerConsumer!});local(row);
 });
 apply(then,work,[()=>{complete();yes(row.handle);},(raw:unknown)=>{remember(row,raw);complete();apply(then,close(row),[()=>no(raw),()=>no(raw)]);}]);return birth;
}
function reconcile(row:Row):Promise<void> {
 if(row.work)return row.work;local(row);
 let yes!:()=>void,no!:(raw:unknown)=>void;
 row.work=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
 const operation=row.stock.root(async()=>{
  current(row);const broker=registeredBroker(row),lease=row.binding.lease,port=readOriginalDshAdmissionPort(row.binding.store,lease.realm),source=row.broker!;
  const releaseReply=function(this:object){readOriginalMainDshBrokerReply(this,lease.realm,row.binding.store,lease.realm);return apply(method(source,'release'),source,[this]);};
  const acceptReply=(candidate:unknown)=>{readOriginalMainDshBrokerReply(candidate,lease.realm,row.binding.store,lease.realm);return true;};
  const baseline=await row.stock.sdk<object>(method(source,'prepareOwner'),source,[row.controller.signal],{accept:acceptReply,consumer:releaseReply});
  try{
   const view=readOriginalMainDshBrokerReply(baseline,lease.realm,row.binding.store,lease.realm);
   await row.stock.sdk(view.waitKnown,view,[]);row.stock.syncVoid(view.assertKnown,view,[]);row.stock.syncVoid(view.assertCurrent,view,[]);current(row);
   if(view.operation!=='read'||record(view.output.domain).domainId!==broker.domainId)fail('DSH_MAIN_CONTROL_RECOVERY_BASELINE_CONFLICT');
  }finally{await row.stock.consumeResource(releaseReply,baseline,[]);}
  const snapshot=state(row);
  for(let i=0;i<snapshot.pendingOwnerCommands.length;i++){
   const item=snapshot.pendingOwnerCommands[i]!;
   if(item.operation!=='apply_dsh_control'||item.state!=='leased'||item.reconcileOnly!==true)continue;
   let workDomain=false;for(let j=0;j<snapshot.authorizations.ownerDomains.length;j++){const domain=snapshot.authorizations.ownerDomains[j]!;if(domain.kind==='work'&&domain.domainId===item.ownerDomain)workDomain=true;}
   current(row);
   if(item.ownerDomain===broker.domainId){
    const reply=await row.stock.sdk<object>(method(source,'readControl'),source,[item.commandId,item.ownerDomain,row.controller.signal],{accept:acceptReply,consumer:releaseReply});
    try{current(row);await row.stock.sdk(method(port,'importBrokerControlReceipt'),port,[reply,{requestSource:'scheduler',bootstrapAuthority:lease.realm}]);}
    finally{await row.stock.consumeResource(releaseReply,reply,[]);}
   }else if(workDomain){
    const history=record(await row.stock.sdk(method(port,'readOperation'),port,[lease.realm.openReadHistory({schemaVersion:1,query:{kind:'control',operationId:item.commandId,ownerDomain:item.ownerDomain}}),{requestSource:'scheduler'}]));
    const target=record(history.control);if(history.ok!==true||typeof target.controlId!=='string')fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
    const business=lease.businessSource,releaseDelivery=function(this:object){const actual=readOriginalMainDshBusinessDelivery(business,this);return apply(method(actual,'release'),actual,[]);};
    current(row);
    const delivery=await row.stock.sdk<MainDshBusinessDelivery>(method(business,'reconcileControl'),business,[item.commandId,item.ownerDomain,row.controller.signal],{accept(value){readOriginalMainDshBusinessDelivery(business,value);return true;},consumer:releaseDelivery});
    try{
     const output=record(delivery.observation.output),heads=output.controlHeads;
     if(output.ok!==true||!isArray(heads))fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
     let selected:R|undefined;for(let j=0;j<heads.length;j++){const head=record(heads[j]);if(head.id===target.controlId){if(selected)fail('DSH_ADMISSION_OWNER_CONTROL_CONFLICT');selected=head;}}
     if(!selected||typeof selected.recordDigest!=='string')fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');current(row);
     await row.stock.sdk(method(port,'importControlReceipt'),port,[lease.realm.openControlReceipt({operationId:item.commandId,ownerDomain:item.ownerDomain,receiptId:'dsh-owner-control:'+selected.recordDigest},{ownerObservation:delivery.reply as object}),{requestSource:'scheduler'}]);
    }finally{await row.stock.consumeResource(releaseDelivery,delivery,[]);}
   }
  }
 });
 apply(then,operation,[yes,(raw:unknown)=>{remember(row,raw);try{stop(row);}catch(secondary){remember(row,secondary);}const joined=row.stock.waitPhysicalKnown();apply(then,joined,[()=>no(raw),(secondary:unknown)=>{remember(row,secondary);no(raw);}]);}]);return row.work;
}
