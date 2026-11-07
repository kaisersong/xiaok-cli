import {randomBytes} from 'node:crypto';
import {captureGithubOpaqueRecord,captureGithubReadData,githubReadFreeze} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {dshAFields,dshAHash,dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {dshSourceScopeIdentity} from '../../src/runtime/multi-agent/dsh-source-configuration.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import type {readOriginalMainDshServicesBinding} from './desktop-services.js';
import {loadOriginalBrokerServicesReader} from './main-dsh-broker-services-loader.js';
import {readOriginalMainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalDshDomainMetadata,readOriginalDshAdmissionPort,readOriginalDshDesktopState} from './desktop-multi-agent-store.js';
import {readOriginalKSwarmServiceIdentity} from './kswarm-service.js';
import {assertOriginalBrokerAdmissionClient,performOriginalBrokerAdmission} from './collaboration-room-broker-client.js';
import {projectDshBrokerControlTarget,readBrokerControlRejection} from '../../src/runtime/multi-agent/dsh-broker-control-data.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,freeze=Object.freeze,create=Object.create,NativePromise=Promise,then=Promise.prototype.then;
const originalAbort=AbortController.prototype.abort;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason')!.get!;
type Action='baseline'|'apply'|'read';
interface SourceRow {handle:object;services:object;sources:object;client:object;binding:ReturnType<typeof readOriginalMainDshServicesBinding>;frames:ReturnType<typeof createIntrinsicSet<Frame>>;stopping:boolean;stopAttempted?:boolean;stopFailure?:{raw:unknown};negatives:ReturnType<typeof createIntrinsicSet<RoomTurnCustody>>;closing?:Promise<void>}
interface Frame {owner:SourceRow;proof:object;action:Action;input:Readonly<Record<string,unknown>>;challenge:string;signal:AbortSignal;controller:AbortController;stock:RoomTurnCustody;native?:ReturnType<typeof readOriginalMainDshBootstrapAuthority>;service?:ReturnType<typeof readOriginalKSwarmServiceIdentity>;retired:boolean;body?:Readonly<Record<string,unknown>>}
const sources=new WeakMap<object,SourceRow>(),byServices=new WeakMap<object,SourceRow>(),frames=new WeakMap<object,Frame>(),replies=new WeakMap<object,Frame>();
function fail():never{throw Error('BROKER_DSH_ORIGINAL_CONTROL_SOURCE_REQUIRED');}
function rowFor(source:unknown):SourceRow {const row=apply(get,sources,[source]) as SourceRow|undefined;if(!row)fail();return row;}
function local(frame:Frame):void {if(frame.retired||frame.owner.stopping||apply(aborted,frame.signal,[]))fail();if(!frame.native||!frame.service)fail();frame.native.assertLocal();frame.service.assertLocal();if(frame.retired||frame.owner.stopping)fail();}
function current(frame:Frame):void {
 try{local(frame);try{frame.stock.syncVoid(frame.native!.assertCurrent,undefined,[]);frame.stock.syncVoid(frame.service!.assertCurrent,undefined,[]);}catch(raw){frame.owner.stopping=true;throw raw;}local(frame);}catch(raw){frame.retired=true;throw raw;}
}
export interface OriginalMainDshBrokerFrame {
 readonly action:Action;readonly input:Readonly<Record<string,unknown>>;readonly challenge:string;readonly signal:AbortSignal;readonly stock:RoomTurnCustody;readonly service:object;
 assertCurrent():void;assertLocal():void;
}
/** Exact private request membership before any candidate attributes. */
export function readOriginalMainDshBrokerFrame(source:unknown,proof:unknown):OriginalMainDshBrokerFrame {
 const owner=rowFor(source),frame=apply(get,frames,[proof]) as Frame|undefined;if(!frame||frame.owner!==owner)fail();
 return freeze({action:frame.action,input:frame.input,challenge:frame.challenge,signal:frame.signal,stock:frame.stock,service:owner.binding.kswarmService,assertCurrent:()=>current(frame),assertLocal:()=>local(frame)});
}
export function retireOriginalMainDshBrokerFrame(source:unknown,proof:unknown):void {
 const owner=rowFor(source),frame=apply(get,frames,[proof]) as Frame|undefined;if(!frame||frame.owner!==owner)fail();owner.stopping=true;frame.retired=true;
}
export interface OriginalMainDshBrokerReply {
 readonly operation:'baseline'|'apply'|'read';readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly input:Readonly<Record<string,unknown>>;readonly output:Readonly<Record<string,unknown>>;
 waitKnown():Promise<void>;assertKnown():void;assertCurrent():void;assertLocal():void;
}
export function readOriginalMainDshBrokerReply(reply:unknown,realm:unknown,store:unknown,authoritySource:unknown):OriginalMainDshBrokerReply {
 const frame=apply(get,replies,[reply]) as Frame|undefined;
 if(!frame||!frame.body||frame.owner.binding.store!==store||frame.owner.binding.lease.realm!==realm||authoritySource!==realm)fail();
 return freeze({operation:frame.action,scope:frame.owner.binding.lease.scope,input:frame.input,output:frame.body,waitKnown:()=>frame.stock.waitPhysicalKnown(),assertKnown:()=>frame.stock.assertPhysicalKnown(),assertCurrent:()=>current(frame),assertLocal:()=>local(frame)});
}
export interface MainDshBrokerControlSource {
 prepareOwner(signal:AbortSignal):Promise<object>;applyControl(operationId:string,ownerDomain:string,signal:AbortSignal):Promise<object>;readControl(operationId:string,ownerDomain:string,signal:AbortSignal):Promise<object>;
 reconcileControls(signal:AbortSignal):Promise<void>;release(reply:object):void;stopAccepting():void;close():Promise<void>;
}
export function readOriginalMainDshBrokerControlSource(source:unknown,realm:unknown,store:unknown):MainDshBrokerControlSource {
 const row=rowFor(source);if(row.binding.store!==store||row.binding.lease.realm!==realm||row.stopping)fail();return row.handle as MainDshBrokerControlSource;
}
/** Same original Services/Sources/client tuple only. No caller URL, token,
 * transport, permission callback or alternative Store enters this factory. */
export async function createMainDshBrokerControlSource(raw:unknown):Promise<MainDshBrokerControlSource> {
 const input=captureGithubOpaqueRecord(raw,['services','sources','client']),services=input.services as object,exactSources=input.sources as object,client=input.client as object;
 const reader=await loadOriginalBrokerServicesReader();
 const binding=reader.readOriginalMainDshServicesBinding(services,exactSources);assertOriginalBrokerAdmissionClient(client,binding.kswarmService);
 const previous=apply(get,byServices,[services]) as SourceRow|undefined;
 if(previous){if(previous.sources!==exactSources||previous.client!==client||previous.stopping)fail();return previous.handle as MainDshBrokerControlSource;}
 const owner:SourceRow={handle:create(null),services,sources:exactSources,client,binding,frames:createIntrinsicSet(),negatives:createIntrinsicSet(),stopping:false};
 let baseline:Readonly<Record<string,unknown>>|undefined,reconciling:Promise<void>|undefined;
 function begin(action:Action,data:unknown,signal:AbortSignal):Frame {
  if(owner.stopping)fail();const stock=createRoomTurnCustody(),controller=new AbortController();
  // Guards return fixed resource views. The guard SDK calls themselves are
  // stock-owned before their errors/visible own-symbol tails can escape.
  const frame:Frame={owner,proof:freeze(create(null)),action,input:githubReadFreeze(captureGithubReadData(data)) as Readonly<Record<string,unknown>>,challenge:'',signal:AbortSignal.any([signal,controller.signal]),controller,stock,retired:false};
  apply(set,frames,[frame.proof,frame]);owner.frames.add(frame);return frame;
 }
 async function send(action:Action,build:(frame:Frame)=>unknown,signal:AbortSignal):Promise<object> {
  const frame=begin(action,{},signal);let failure:{raw:unknown}|undefined;
  try{
   frame.body=await frame.stock.root(async()=>{frame.stock.syncVoid(()=>{frame.challenge=randomBytes(32).toString('hex');frame.native=readOriginalMainDshBootstrapAuthority(binding.lease.realm,binding.store,binding.lease.realm);frame.service=readOriginalKSwarmServiceIdentity(binding.kswarmService);frame.input=githubReadFreeze(captureGithubReadData(build(frame))) as Readonly<Record<string,unknown>>;},undefined,[]);current(frame);const body=await performOriginalBrokerAdmission(client,owner.handle,frame.proof);current(frame);return body;});
  }catch(raw){failure={raw};frame.stock.inventory(raw);}
  try{await frame.stock.waitPhysicalKnown();owner.frames.delete(frame);}catch(raw){failure??={raw};}
  if(failure){frame.retired=true;throw failure.raw;}if(!frame.body)fail();
  const reply=freeze(create(null));apply(set,replies,[reply,frame]);return reply;
 }
 function authority(){const value=readOriginalDshDomainMetadata(binding.lease.realm,binding.store,binding.lease.realm,binding.lease.scope);return {authorityId:value.authorityId,authorityEpoch:value.authorityEpoch};}
 async function prepareOwner(signal:AbortSignal){
  const reply=await send('baseline',frame=>{
   const a=authority(),state=readOriginalDshDesktopState(binding.lease.realm,binding.store,binding.lease.realm,binding.lease.scope);let registered:Record<string,unknown>|undefined;
   for(let i=0;i<state.authorizations.ownerDomains.length;i++){const domain=state.authorizations.ownerDomains[i]!;if(domain.writerProfile==='broker_dsh_control_v1'){if(registered)fail();registered=domain;}}
   if(registered){const baseline=registered.brokerBaseline as Record<string,unknown>;if(dshAJson(baseline.authority)!==dshAJson(a)){owner.stopping=true;throw Error('DSH_A_BROKER_REBASELINE_REQUIRED');}frame.action='read';return {schemaVersion:1,scope:binding.lease.scope,authority:a,realmId:registered.storeId,operationId:baseline.operationId};}
   return {schemaVersion:1,scope:binding.lease.scope,authority:a,operationId:'broker-baseline:'+dshAHash({scope:binding.lease.scope,authority:a}),visibility:{kind:'no_visibility'}};
  },signal),view=readOriginalMainDshBrokerReply(reply,binding.lease.realm,binding.store,binding.lease.realm);if(baseline&&dshAJson(baseline.domain)!==dshAJson(view.output.domain)){owner.stopping=true;fail();}baseline=view.output;return reply;
 }
 function target(operationId:string,ownerDomain:string){
  if(!baseline)fail();const domain=baseline.domain;dshAFields(domain,['schemaVersion','kind','ownerKind','domainId','storeId','scope','writerProfile','writerSchemaVersion']);if(domain.domainId!==ownerDomain)fail();
  const port=readOriginalDshAdmissionPort(binding.store,binding.lease.realm),history=port.readOperation(binding.lease.realm.openReadHistory({schemaVersion:1,query:{kind:'control',operationId,ownerDomain}}),{requestSource:'scheduler'});
  dshAFields(history,['ok','control','delivery','receipt']);if(history.ok!==true)fail();const result=history.control;dshAFields(result,['schemaVersion','scopeId','operationId','ownerDomain','controlId','epoch','canonicalHash','command']);if(result.operationId!==operationId||result.ownerDomain!==ownerDomain)fail();return {domain,target:result};
 }
 function project(original:Record<string,unknown>){return projectDshBrokerControlTarget(original,binding.lease.scope,authority(),(baseline!.domain as Record<string,unknown>).storeId);}
 async function applyControl(operationId:string,ownerDomain:string,signal:AbortSignal){return send('apply',()=>project(target(operationId,ownerDomain).target),signal);}
 async function readControl(operationId:string,ownerDomain:string,signal:AbortSignal){return send('read',()=>{const {domain}=target(operationId,ownerDomain);return {schemaVersion:1,scope:binding.lease.scope,authority:authority(),realmId:domain.storeId,operationId};},signal);}
 function reconcileControls(signal:AbortSignal):Promise<void> {
  if(reconciling)return reconciling;
  const operation=(async()=>{
   if(!baseline)return;
   const state=readOriginalDshDesktopState(binding.lease.realm,binding.store,binding.lease.realm,binding.lease.scope),domain=baseline.domain as Record<string,unknown>,port=readOriginalDshAdmissionPort(binding.store,binding.lease.realm);
   for(let i=0;i<state.pendingOwnerCommands.length;i++){
    const command=state.pendingOwnerCommands[i]!;if(command.ownerDomain!==domain.domainId)continue;if(command.operation!=='apply_dsh_control')fail();
    let reply:object;
    try{reply=command.reconcileOnly?await readControl(command.commandId,command.ownerDomain,signal):await applyControl(command.commandId,command.ownerDomain,signal);}catch(raw){if(readBrokerControlRejection(raw)==='admission_epoch_conflict')continue;throw raw;}
    try{await port.importBrokerControlReceipt(reply,{requestSource:'scheduler',bootstrapAuthority:binding.lease.realm});}finally{release(reply);}
   }
  })();
  reconciling=operation;apply(then,operation,[()=>{reconciling=undefined;},()=>{reconciling=undefined;}]);return operation;
 }
 function release(reply:object){const frame=apply(get,replies,[reply]) as Frame|undefined;if(!frame||frame.owner!==owner)fail();frame.retired=true;}
 function existingFailure():{raw:unknown}|undefined {
  for(const frame of owner.frames.snapshot())try{frame.stock.current();}catch(raw){return {raw};}return undefined;
 }
 function stopAccepting():void {
  owner.stopping=true;if(owner.stopAttempted)return;owner.stopAttempted=true;
  let failure=existingFailure();
  // Negative SDKs own a fresh inventory per handle. A failed positive frame
  // cannot prevent actual abort of this request or its sibling request.
  for(const frame of owner.frames.snapshot()){
   const negative=createRoomTurnCustody();owner.negatives.add(negative);
   try{negative.syncVoid(originalAbort,frame.controller,[Error('BROKER_DSH_CONTROL_CLOSED')]);}catch(raw){failure??={raw};}
  }
  owner.stopFailure=failure;if(failure)throw failure.raw;
 }
 function close():Promise<void>{
  if(owner.closing)return owner.closing;let yes!:()=>void,no!:(raw:unknown)=>void;
  owner.closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
  const operation=(async()=>{
   let failure=owner.stopFailure??existingFailure();try{stopAccepting();}catch(raw){failure??={raw};}
   const pending=owner.frames.snapshot();for(let i=0;i<pending.length;i++)try{await pending[i]!.stock.waitPhysicalKnown();}catch(raw){failure??={raw};}
   const negatives=owner.negatives.snapshot();for(let i=0;i<negatives.length;i++)try{await negatives[i]!.waitPhysicalKnown();}catch(raw){failure??={raw};}
   if(failure)throw failure.raw;
  })();
  apply(then,operation,[yes,no]);return owner.closing;
 }
 const source=freeze({prepareOwner,applyControl,readControl,reconcileControls,release,stopAccepting,close});owner.handle=source;apply(set,sources,[source,owner]);apply(set,byServices,[services,owner]);return source;
}
