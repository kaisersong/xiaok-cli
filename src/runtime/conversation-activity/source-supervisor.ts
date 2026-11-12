import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import {types} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors,settleIntrinsicOperations} from '../verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import type {ActivityOwnerConfig} from './owner-runtime.js';
import {createOwnedKSwarmPrefixV2Client,prepareOwnedKSwarmPrefixV2Hello,assertOwnedKSwarmPrefixV2HelloCurrent,captureOwnedConfigurationData,type KSwarmPrefixHelloAudience} from './owned-kswarm-control.js';
import {createOwnedKSwarmBusiness,prepareOwnedKSwarmBusinessHello,assertOwnedKSwarmBusinessHelloCurrent,assertOwnedKSwarmPreparationHelloCurrent,readOwnedKSwarmPreparationFacet,type KSwarmBusinessAudience,type KSwarmPreparationFacet,type KSwarmPreparationWork,type KSwarmPreparationAudience} from './owned-kswarm-business.js';
import {captureDispatchBusinessData,dispatchBusinessProtocolTag} from './dispatch-business-data.js';
import {assertCanonicalBusinessEndpoint,readCanonicalBusinessCommand,readCanonicalPreparationBinding,readCanonicalPreparationCommand,revokeCanonicalBusinessTarget,observeCanonicalBusinessTargetClose,type CanonicalBusinessTargetAudience,type CanonicalSupervisedBusinessPort,type CanonicalPreparationBinding} from './canonical-dispatch-business.js';
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, statSync,realpathSync } from 'node:fs';
import { z } from 'zod';
import { join, isAbsolute } from 'node:path';

const configPromise=Promise,configThen=Promise.prototype.then,configApply=Reflect.apply,configFreeze=Object.freeze,configCreate=Object.create,configDefine=Object.defineProperty;
const ConfigWeakMap=WeakMap;
const configWeakGet=WeakMap.prototype.get,configWeakSet=WeakMap.prototype.set,configPrototype=Object.getPrototypeOf,configQueue=queueMicrotask,configSetPrototype=Object.setPrototypeOf;
const configAsyncPrototype=configPrototype(async()=>{}),configJson=JSON.stringify,configBytes=Buffer.byteLength,configRemove=process.removeListener;
const configBirths=new WeakMap<object,{configFile:string;channel:object;send:NonNullable<NodeJS.Process['send']>;used:boolean}>();
type ConfigScope=Readonly<{profileId:string;workspaceId:string}>;
interface ConfigRetirement {raw?:Promise<void>;completion:Promise<void>;complete():void;failure?:unknown;unknown:boolean}
interface ConfigTarget {child:ChildProcess;generation:number;scope:ConfigScope;revoked:boolean;client?:ReturnType<typeof createOwnedKSwarmPrefixV2Client>;retirement?:ConfigRetirement}
interface ConfigEndpointObserver {targetRevoked(target:ConfigTarget):void}
interface ConfigSupervisor {ownerEpoch:string;generation:number;target?:ConfigTarget;retirements:ReturnType<typeof createIntrinsicSet<ConfigRetirement>>;endpoints:ReturnType<typeof createIntrinsicSet<ConfigEndpointObserver>>;isCurrent(target:ConfigTarget):boolean;configBound:boolean;business?:{revoke(target:ConfigTarget):void;join():Promise<unknown[]>}}
const configSupervisors=new WeakMap<object,ConfigSupervisor>(),configMapGet=Map.prototype.get,configObjectKeys=Object.keys,configOwn=Object.hasOwn,configDescriptors=Object.getOwnPropertyDescriptors,configCharCode=String.prototype.charCodeAt;
function configHex(raw:unknown):raw is string{if(typeof raw!=='string'||raw.length!==64)return false;for(let i=0;i<64;i++){const n=configApply(configCharCode,raw,[i]);if(!(n>=48&&n<=57||n>=97&&n<=102))return false;}return true;}
function configScope(raw:unknown):ConfigScope|undefined{if(!raw||typeof raw!=='object'||types.isProxy(raw))return;const rows=configDescriptors(raw),names=configObjectKeys(rows);if(names.length!==2)return;const profile=rows.profileId,workspace=rows.workspaceId;if(!profile||!workspace||!configOwn(profile,'value')||!configOwn(workspace,'value')||!configHex(profile.value)||!configHex(workspace.value))return;return configFreeze({profileId:profile.value,workspaceId:workspace.value});}
function sameConfigScope(a:ConfigScope,b:ConfigScope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
function configOwner(supervisor:object):ConfigSupervisor|undefined{return configApply(configWeakGet,configSupervisors,[supervisor]) as ConfigSupervisor|undefined;}
function retireConfigTarget(owner:ConfigSupervisor,target:ConfigTarget):ConfigRetirement|undefined{
 if(target.retirement||!target.client)return target.retirement;
 let complete!:()=>void;const record:ConfigRetirement={completion:new configPromise<void>(yes=>{complete=yes;}),complete(){complete();},unknown:false};configDefine(record.completion,'constructor',{__proto__:null,value:configPromise} as PropertyDescriptor);target.retirement=record;owner.retirements.add(record);
 try{const raw=target.client.sealAndDrainPrefix();record.raw=raw;assertStandardIpcPromise(raw,'activity_config_target_tail_unknown');void configApply(configThen,raw,[()=>{complete();},(error:unknown)=>{record.failure=error;complete();}]);}catch(error){record.unknown=true;record.failure=error;}
 return record;
}
function revokeConfigTarget(owner:ConfigSupervisor):void{
 const target=owner.target;if(!target||target.revoked)return;target.revoked=true;
 owner.business?.revoke(target);
 const endpoints=owner.endpoints.snapshot();for(let i=0;i<endpoints.length;i++)endpoints[i]!.targetRevoked(target);
 retireConfigTarget(owner,target);
}
/** Negative-only original lifecycle seam. It cannot install or execute. */
export function revokeSupervisedKSwarmConfigTarget(supervisor:object):void{const owner=configOwner(supervisor);if(!owner)throw Error('activity_config_original_supervisor_required');revokeConfigTarget(owner);}

/** Fixed lower-hop binding. The original supervisor and canonical endpoint
 * both precede any supplied field; no operation table or caller target getter. */
export function bindOriginalSupervisedBusinessEndpoint(supervisor:object,endpoint:object):CanonicalSupervisedBusinessPort {
 const owner=configOwner(supervisor);if(!owner)throw Error('activity_business_original_supervisor_required');assertCanonicalBusinessEndpoint(endpoint,supervisor);
 if(owner.business)throw Error('activity_business_endpoint_already_bound');
 type Record={target:ConfigTarget;client?:ReturnType<typeof createOwnedKSwarmBusiness>;audience?:CanonicalBusinessTargetAudience;hello?:object;assertPreparationCurrent?:()=>void;preparationFacet?:KSwarmPreparationFacet;preparationWorks?:WeakMap<object,KSwarmPreparationWork>;retirement?:Promise<void>;raw?:unknown;failure?:unknown;done:boolean;unknown:boolean};
 const records=createIntrinsicSet<Record>(),unknown=createIntrinsicSet<unknown>(),byTarget=new WeakMap<object,Record>(),byAudience=new WeakMap<object,Record>();let closing=false,closed:Promise<void>|undefined;
 const ctor=Object.getOwnPropertyDescriptor,species=Symbol.species,originalSpecies=ctor(configPromise,species),promisePrototype=configPromise.prototype;
 function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const promise=new configPromise<T>((yes,no)=>{resolve=yes;reject=no;});configDefine(promise,'constructor',{__proto__:null,value:configPromise} as PropertyDescriptor);return{promise,resolve,reject};}
 function observed(raw:unknown):raw is Promise<unknown>{
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||!types.isPromise(raw)||configPrototype(raw)!==promisePrototype||ctor(raw,'then'))return false;
  const own=ctor(raw,'constructor'),current=ctor(configPromise,species);return !!own&&configOwn(own,'value')&&own.value===configPromise&&!!current&&!!originalSpecies&&!configOwn(current,'value')&&current.get===originalSpecies.get&&current.set===originalSpecies.set;
 }
 function ordinary(record:Record){if(closing||record.retirement||!owner!.isCurrent(record.target))throw Error('activity_business_target_revoked');if(closing||record.retirement||record.target.revoked||owner!.target!==record.target)throw Error('activity_business_target_revoked');}
 function retire(record:Record):Promise<void>{
  if(record.retirement)return record.retirement;const done=deferred<void>();record.retirement=done.promise;
  let upper=false,lower=false;const finish=()=>{if(upper&&lower){record.done=true;done.resolve();}};
  observeCanonicalBusinessTargetClose(endpoint,supervisor,record.audience,()=>{upper=true;finish();});
  if(!record.client){lower=true;finish();return done.promise;}
  try{record.client.seal();const raw=record.client.sealAndDrainPrefix();record.raw=raw;if(!observed(raw)){record.unknown=true;unknown.add(raw);return done.promise;}
   configApply(configThen,raw,[()=>{lower=true;finish();},(error:unknown)=>{record.failure=error;lower=true;finish();}]);
  }catch(error){record.failure=error;record.unknown=true;unknown.add(record.raw);}return done.promise;
 }
 function join():Promise<unknown[]>{
  const result=deferred<unknown[]>(),rows=records.snapshot(),waits:Promise<void>[]=[],selected:Record[]=[];
  for(let i=0;i<rows.length;i++)if(rows[i]!.retirement){appendIntrinsic(selected,rows[i]!);appendIntrinsic(waits,retire(rows[i]!));}
  const raw=(async()=>{const errors:unknown[]=configSetPrototype([],null);for(let i=0;i<waits.length;i++){await waits[i]!;if(selected[i]!.failure)appendIntrinsic(errors,selected[i]!.failure);}return errors;})();
  configDefine(raw,'constructor',{__proto__:null,value:configPromise} as PropertyDescriptor);if(!observed(raw)){unknown.add(raw);return result.promise;}configApply(configThen,raw,[result.resolve,result.reject]);return result.promise;
 }
 const population={revoke(target:ConfigTarget){const record=configApply(configWeakGet,byTarget,[target]) as Record|undefined;if(record){revokeCanonicalBusinessTarget(endpoint,supervisor);retire(record);}},join};owner.business=population;
 function fromAudience(audience:object):Record {const record=configApply(configWeakGet,byAudience,[audience]) as Record|undefined;if(!record)throw Error('activity_business_original_target_required');ordinary(record);if(record.audience!==audience||!record.hello||!record.client)throw Error('activity_business_original_target_required');assertOwnedKSwarmBusinessHelloCurrent(record.client,record.hello);ordinary(record);return record;}
 function fromPreparationAudience(audience:object):Record{
  const record=configApply(configWeakGet,byAudience,[audience]) as Record|undefined;
  if(!record||record.audience!==audience||!record.hello||!record.client||!record.assertPreparationCurrent)throw Error('activity_preparation_target_revoked');
  record.assertPreparationCurrent();if(record.target.revoked||owner!.target!==record.target||!owner!.isCurrent(record.target))throw Error('activity_preparation_target_revoked');
  record.assertPreparationCurrent();if(record.target.revoked||owner!.target!==record.target)throw Error('activity_preparation_target_revoked');return record;
 }
 function fromSettlementAudience(audience:object):Record{
  const record=configApply(configWeakGet,byAudience,[audience]) as Record|undefined;
  if(!record||record.audience!==audience||!record.hello||!record.client||!record.assertPreparationCurrent||record.target.revoked||owner!.target!==record.target)throw Error('activity_preparation_settlement_target_revoked');
  record.assertPreparationCurrent();if(record.target.revoked||owner!.target!==record.target)throw Error('activity_preparation_settlement_target_revoked');return record;
 }
 const port:CanonicalSupervisedBusinessPort={ownerEpoch:owner.ownerEpoch,configBound:()=>owner.configBound,
  prepare(scope){
   const result=deferred<CanonicalBusinessTargetAudience>();let record:Record|undefined;
   try{
    const captured=captureDispatchBusinessData(scope) as ConfigScope,target=owner.target;if(closing||!target||!owner.isCurrent(target)||!sameConfigScope(captured,target.scope))throw Error('activity_business_target_not_owned');
    record=configApply(configWeakGet,byTarget,[target]) as Record|undefined;
    if(!record){
     const value=configCreate(null),fields=['target','client','audience','hello','assertPreparationCurrent','preparationFacet','preparationWorks','retirement','raw','failure','done','unknown'];for(let i=0;i<fields.length;i++){const key=fields[i]!;configDefine(value,key,{__proto__:null,value:key==='target'?target:key==='done'||key==='unknown'?false:undefined,writable:true,enumerable:true} as PropertyDescriptor);}record=value as Record;records.add(record);configApply(configWeakSet,byTarget,[target,record]);
     const original=record;
     const custodies=new ConfigWeakMap<object,CanonicalPreparationBinding>();record.preparationWorks=new ConfigWeakMap();
     const preparationSource=configFreeze({resolveWork(proof:object,audience:KSwarmPreparationAudience){
      if(!original.audience)throw Error('activity_preparation_target_required');fromPreparationAudience(original.audience);const binding=readCanonicalPreparationBinding(endpoint,supervisor,proof,original.audience);binding.assertAudience(audience);configApply(configWeakSet,custodies,[binding.custody,binding]);return{workId:binding.workId,sourceIncarnation:binding.sourceIncarnation,custody:binding.custody};
     },observeWork(custody:object,observer:(cut:unknown)=>void){const binding=configApply(configWeakGet,custodies,[custody]) as CanonicalPreparationBinding|undefined;if(!binding)throw Error('activity_preparation_original_custody_required');binding.observeProducer(observer);},sealWork(custody:object){const binding=configApply(configWeakGet,custodies,[custody]) as CanonicalPreparationBinding|undefined;if(!binding)throw Error('activity_preparation_original_custody_required');binding.sealProducer();}});
     const preparationAdmission=(proof:object,audience:KSwarmPreparationAudience)=>{if(!original.audience)throw Error('activity_preparation_target_required');fromPreparationAudience(original.audience);readCanonicalPreparationBinding(endpoint,supervisor,proof,original.audience).assertAudience(audience);};
     const hostSettlementSource=configFreeze({resolveRegistration(custody:object,audience:KSwarmPreparationAudience){
      if(!original.audience)throw Error('activity_preparation_target_required');fromPreparationAudience(original.audience);const binding=configApply(configWeakGet,custodies,[custody]) as CanonicalPreparationBinding|undefined;if(!binding)throw Error('activity_preparation_original_custody_required');return binding.resolveHost(audience,false);
     },resolveNoEffectSettlement(custody:object,audience:KSwarmPreparationAudience){
      if(!original.audience)throw Error('activity_preparation_target_required');fromSettlementAudience(original.audience);const binding=configApply(configWeakGet,custodies,[custody]) as CanonicalPreparationBinding|undefined;if(!binding)throw Error('activity_preparation_original_custody_required');return binding.resolveHost(audience,true);
     }});
     record.client=createOwnedKSwarmBusiness({child:target.child,scope:target.scope,serviceOwner:supervisor,isCurrent:()=>target.child.connected===true,preparationSource,preparationAdmission,hostSettlementSource,admit(proof,audience:KSwarmBusinessAudience){
      ordinary(original);if(!original.audience||audience.serviceOwner!==supervisor)throw Error('activity_business_original_command_required');
      const command=readCanonicalBusinessCommand(endpoint,supervisor,proof,original.audience,audience);
      if(configJson(command.input)!==configJson(audience.input))throw Error('activity_business_command_payload_mismatch');ordinary(original);command.assertCurrent();
     }});
     record.preparationFacet=readOwnedKSwarmPreparationFacet(record.client,preparationSource,preparationAdmission);
     const actualClient=record.client;record.assertPreparationCurrent=()=>assertOwnedKSwarmPreparationHelloCurrent(actualClient,preparationSource,preparationAdmission,original.hello!);
    }
    ordinary(record);const original=record,raw=prepareOwnedKSwarmBusinessHello(record.client!);record.raw=raw;
    if(!observed(raw)){record.unknown=true;unknown.add(raw);throw Error('activity_business_hello_unknown');}
    configApply(configThen,raw,[(hello:object)=>{try{ordinary(original);assertOwnedKSwarmBusinessHelloCurrent(original.client!,hello);if(!original.audience){original.hello=hello;const value=configCreate(null),fields=['scope','targetGeneration','childBoot'],values=[target.scope,target.generation,(hello as {boot:string}).boot];for(let i=0;i<fields.length;i++)configDefine(value,fields[i]!,{__proto__:null,value:values[i],enumerable:true} as PropertyDescriptor);original.audience=configFreeze(value) as CanonicalBusinessTargetAudience;configApply(configWeakSet,byAudience,[original.audience,original]);}ordinary(original);result.resolve(original.audience!);}catch(error){result.reject(error);}},result.reject]);
   }catch(error){result.reject(error);}return result.promise;
  },
  assertCurrent(audience){fromAudience(audience);},
  assertPreparationCurrent(audience){fromPreparationAudience(audience);},
  openPreparationWork(audience,proof){
   const record=fromPreparationAudience(audience),binding=readCanonicalPreparationBinding(endpoint,supervisor,proof,audience);
   if(!record.preparationFacet||!record.preparationWorks||configApply(configWeakGet,record.preparationWorks,[proof]))throw Error('activity_preparation_work_already_open');
   const work=record.preparationFacet.openWork(binding.projectId,binding.lookup,{requestSource:'scheduler',preparationProof:proof,signal:binding.signal});configApply(configWeakSet,record.preparationWorks,[proof,work]);return work;
  },
  assertSettlementCurrent(audience){fromSettlementAudience(audience);},
  invokePreparation(audience,proof){
   try{const record=fromSettlementAudience(audience),command=readCanonicalPreparationCommand(endpoint,supervisor,proof,audience),work=record.preparationWorks&&configApply(configWeakGet,record.preparationWorks,[command.workProof]) as KSwarmPreparationWork|undefined;if(!work)throw Error('activity_preparation_original_work_required');command.assertCurrent();
    if(command.operation==='register_host')return work.registerHost();if(command.operation==='finish_host_no_effect')return work.finishHostNoEffect();if(command.operation==='read_preparation_basis')return work.readBasis();if(command.operation==='prepare_intent')return work.prepareIntent(command.input);if(command.operation==='admit_send')return work.admitSend(command.input);if(command.operation==='read_prepare_call')return work.readCall(command.input);if(command.operation==='ack_prepared')return work.acknowledge(command.input);throw Error('activity_preparation_operation_forbidden');
   }catch(error){const result=deferred<unknown>();result.reject(error);return result.promise;}
  },
  invoke(audience,commandFrame,requestSource){
   try{if(requestSource!=='user')throw Error('activity_business_user_source_required');const record=fromAudience(audience),command=readCanonicalBusinessCommand(endpoint,supervisor,commandFrame,audience),context={requestSource,admission:commandFrame,signal:command.signal};command.assertCurrent();
    if(command.op==='read_plan')return record.client!.readPlan(command.projectId,context);if(command.op==='capture_default_dispatch')return record.client!.captureDefaultDispatch(command.projectId,command.input,context);if(command.op==='read_operation')return record.client!.readOperation(command.projectId,command.input,context);throw Error('activity_business_operation_forbidden');
   }catch(error){const result=deferred<unknown>();result.reject(error);return result.promise;}
  },
  sealAndDrain(){
   if(closed)return closed;const result=deferred<void>();closed=result.promise;closing=true;const rows=records.snapshot();for(let i=0;i<rows.length;i++)retire(rows[i]!);
   const raw=join();if(!observed(raw)){unknown.add(raw);return result.promise;}configApply(configThen,raw,[(errors:unknown[])=>{if(errors.length||unknown.size)result.reject(aggregateIntrinsicErrors(errors,'activity_business_targets_unconfirmed'));else result.resolve();},result.reject]);return result.promise;
  },
 };return configFreeze(port);
}
function registerConfigTarget(supervisor:ActivitySourceSupervisor,child:ChildProcess,source:ActivityManagedSource,env:NodeJS.ProcessEnv):void{
 if(source.name!=='kswarm')return;const owner=configOwner(supervisor);if(!owner)return;revokeConfigTarget(owner);
 const fields=configDescriptors(source.env),p=fields.KSWARM_DESKTOP_PROFILE_ID,w=fields.KSWARM_DESKTOP_WORKSPACE_ID;
 if(!p||!w||!configOwn(p,'value')||!configOwn(w,'value')||!configHex(p.value)||!configHex(w.value)||env.KSWARM_DESKTOP_PROFILE_ID!==p.value||env.KSWARM_DESKTOP_WORKSPACE_ID!==w.value||child.connected!==true)return;
 if(!Number.isSafeInteger(owner.generation+1))return;const target:ConfigTarget={child,generation:++owner.generation,scope:configFreeze({profileId:p.value,workspaceId:w.value}),revoked:false};owner.target=target;
 const revoke=()=>{if(owner.target===target)revokeConfigTarget(owner);};child.once('error',revoke);child.once('disconnect',revoke);child.once('exit',revoke);child.once('close',revoke);
}

let configMinted=false,configMinting=false,configMintPoisoned=false;
const configProtocol='activity_desktop_config_v1';
function configNonce(){const bytes=randomBytes(32),alphabet='0123456789abcdef';let value='';for(let i=0;i<bytes.length;i++){const byte=bytes[i]!;value+=alphabet[byte>>>4]!+alphabet[byte&15]!;}return value;}
function configPathSame(left:string,right:string){try{return realpathSync.native(left)===realpathSync.native(right);}catch{return false;}}
/** No caller argv, role, verifier or admin flag. This proves a canonical parent
 * descriptor component birth, not that the parent is an Electron Main. */
export function mintCanonicalDesktopConfigBirth():object|undefined {
 if(configMinting){configMintPoisoned=true;throw Error('activity_config_birth_reentry');}
 if(configMinted||configMintPoisoned||!process.argv[1]||!process.argv[2]||!configPathSame(process.argv[1],fileURLToPath(new URL('./owner-entry.js',import.meta.url))))return;
 configMinting=true;
 try{
  const channel=process.channel,send=process.send;if(!channel||process.connected!==true||typeof send!=='function'||types.isProxy(send)||types.isAsyncFunction(send)||configPrototype(send)===configAsyncPrototype)return;
  if(configMintPoisoned)throw Error('activity_config_birth_reentry');
  const birth=configFreeze(configCreate(null));configApply(configWeakSet,configBirths,[birth,{configFile:realpathSync.native(process.argv[2]),channel,send,used:false}]);configMinted=true;return birth;
 }finally{configMinting=false;}
}
export interface CanonicalDesktopConfigEndpoint {sealAndDrain():Promise<void>}
const configCloseCustody=new WeakMap<object,(settled:(error?:unknown)=>void)=>void>();
export function observeCanonicalDesktopConfigClose(endpoint:object,settled:(error?:unknown)=>void):void{
 const observe=configApply(configWeakGet,configCloseCustody,[endpoint]) as ((settled:(error?:unknown)=>void)=>void)|undefined;if(!observe)throw Error('activity_config_original_endpoint_required');observe(settled);
}
interface ConfigSend {completion:Promise<void>;complete():void;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;invoked:boolean;done:boolean;raw?:unknown;failure?:unknown}
interface ConfigRoot {completion:Promise<void>;complete():void;raw?:unknown;workRaw?:unknown;send?:ConfigSend;failure?:unknown}
interface ConfigOffer extends ConfigRoot {wire:Record<string,unknown>;audience?:KSwarmPrefixHelloAudience;nonce?:string;invocation?:ConfigRoot;challengeStarted:boolean}
/** Original canonical channel + supervisor binding. No JSON role, replacement
 * operation table, receipt or health response can manufacture this endpoint. */
export function bindCanonicalDesktopConfigBirth(birth:object,supervisor:ActivitySourceSupervisor,configFile:string,config:ActivityOwnerConfig):CanonicalDesktopConfigEndpoint {
 const born=configApply(configWeakGet,configBirths,[birth]) as {configFile:string;channel:object;send:NonNullable<NodeJS.Process['send']>;used:boolean}|undefined;
 const owner=configOwner(supervisor);
 if(!born||born.used||!owner||typeof owner.ownerEpoch!=='string'||!owner.ownerEpoch.length||owner.ownerEpoch.length>256||config.identity.kind!=='desktop'||!configPathSame(configFile,born.configFile)||!process.argv[2]||!configPathSame(configFile,process.argv[2])||process.channel!==born.channel||process.connected!==true||process.send!==born.send)throw Error('activity_config_original_birth_required');
 born.used=true;owner.configBound=true;
 const sends=createIntrinsicSet<ConfigSend>(),roots=createIntrinsicSet<ConfigRoot>(),retained=createIntrinsicSet<unknown>(),errors:unknown[]=[];
 const daemonBoot=configNonce(),installChallenge=configNonce();
 let admissionClosed=false,terminal=false,unknown=false,faultSent=false,businessPrefixQualified=false,closing:Promise<void>|undefined,prefix:ConfigRoot|undefined;
 let target:ConfigTarget|undefined,session:Record<string,unknown>|undefined,installRoot:ConfigRoot|undefined,offer:ConfigOffer|undefined,lastOfferId=0,lastInvokeId=0;
 let greeting:ConfigSend|undefined,birthComplete!:()=>void;
 const birthDone=new configPromise<void>(yes=>{birthComplete=yes;});
 const localPromises=new WeakSet<object>(),localAdd=WeakSet.prototype.add,localHas=WeakSet.prototype.has,localDescriptor=Object.getOwnPropertyDescriptor,localSpecies=localDescriptor(configPromise,Symbol.species);
 function local<T>(raw:Promise<T>):Promise<T>{configDefine(raw,'constructor',{__proto__:null,value:configPromise} as PropertyDescriptor);configApply(localAdd,localPromises,[raw]);return raw;}
 function localObserve(raw:Promise<unknown>,yes:()=>void,no:(error:unknown)=>void):boolean{
  const species=localDescriptor(configPromise,Symbol.species),ownCtor=localDescriptor(raw,'constructor');
  if(!configApply(localHas,localPromises,[raw])||!types.isPromise(raw)||types.isProxy(raw)||configPrototype(raw)!==configPromise.prototype||localDescriptor(raw,'then')||ownCtor?.value!==configPromise||!species||!localSpecies||species.get!==localSpecies.get||species.set!==localSpecies.set||configOwn(species,'value')){unknown=true;retained.add(raw);return false;}
  try{configApply(configThen,raw,[yes,no]);return true;}catch(error){unknown=true;retained.add(raw);remember(error);return false;}
 }
 local(birthDone);
 const remember=(error:unknown)=>appendIntrinsic(errors,error);
 function fail(error:unknown){admissionClosed=true;terminal=true;remember(error);if(target)retireConfigTarget(owner!,target);}
 function invalid():never{throw Error('activity_config_protocol_invalid');}
 function exact(row:Record<string,unknown>,names:readonly string[]){const keys=configObjectKeys(row);if(keys.length!==names.length)invalid();for(let i=0;i<names.length;i++)if(!configOwn(row,names[i]!))invalid();}
 function put(row:object,key:string,value:unknown){configDefine(row,key,{__proto__:null,value,enumerable:true} as PropertyDescriptor);}
 function object(fields:Record<string,unknown>):Record<string,unknown>{const row=configCreate(null),keys=configObjectKeys(fields);for(let i=0;i<keys.length;i++)put(row,keys[i]!,fields[keys[i]!]);return row;}
 // Only captured data enters SDK serialization; no inherited toJSON/then hook.
 function inert(raw:unknown):unknown {if(!raw||typeof raw!=='object')return raw;const fields=configDescriptors(raw),keys=configObjectKeys(fields),row=Array.isArray(raw)?[]:configCreate(null);if(Array.isArray(row))Object.setPrototypeOf(row,null);for(let i=0;i<keys.length;i++){const key=keys[i]!,field=fields[key]!;if(key==='length'&&Array.isArray(raw))continue;if(!configOwn(field,'value'))invalid();put(row,key,inert(field.value));}return row;}
 function frame(type:string,fields?:Record<string,unknown>):Record<string,unknown>{const row=object({protocol:configProtocol,type});if(fields){const keys=configObjectKeys(fields);for(let i=0;i<keys.length;i++)put(row,keys[i]!,fields[keys[i]!]);}return row;}
 function withSession(type:string,fields:Record<string,unknown>={}){if(!session)invalid();const row=object(session!);put(row,'type',type);const keys=configObjectKeys(fields);for(let i=0;i<keys.length;i++)put(row,keys[i]!,fields[keys[i]!]);return row;}
 function root():ConfigRoot{let complete!:()=>void;const row:ConfigRoot={completion:local(new configPromise<void>(yes=>{complete=yes;})),complete(){roots.delete(row);complete();}};roots.add(row);return row;}
 function observe(row:ConfigRoot,work:()=>Promise<void>){try{const raw=work();row.workRaw=raw;assertStandardIpcPromise(raw,'activity_config_root_tail_unknown');void configApply(configThen,raw,[()=>{row.complete();},(error:unknown)=>{row.failure=error;fail(error);row.complete();}]);}catch(error){unknown=true;row.failure=error;fail(error);if(row.workRaw)retained.add(row.workRaw);}}
 function sendRecord():ConfigSend{let complete!:()=>void;const row:ConfigSend={completion:local(new configPromise<void>(yes=>{complete=yes;})),complete(){sends.delete(row);complete();},returned:false,callback:false,rawDone:true,rawUnknown:false,invoked:false,done:false};sends.add(row);return row;}
 function publishFor(root:ConfigRoot|undefined,output:Record<string,unknown>):ConfigSend {
  const row=sendRecord();if(root)root.send=row;if(output.type==='daemon_hello')greeting=row; // reserve/store BEFORE SDK reentry
  const finish=()=>{if(row.done||!row.returned||!row.rawDone&&!row.rawUnknown||row.invoked&&!row.callback)return;row.done=true;row.complete();};
  try{
   const wire=inert(captureOwnedConfigurationData(output)) as object;
   if(process.channel!==born!.channel||process.connected!==true)throw Error('activity_config_channel_closed');
   row.invoked=true;
   const raw=configApply(born!.send,process,[wire,(error:Error|null)=>{row.callback=true;if(error){row.failure=error;fail(error);}finish();}]);
   if(raw!==true&&raw!==false){
    row.raw=raw;row.failure=Error('activity_config_send_return_unknown');fail(row.failure);
    if(raw&&typeof raw==='object'||typeof raw==='function'){
     row.rawDone=false;try{assertStandardIpcPromise(raw,'activity_config_send_tail_unknown');void configApply(configThen,raw,[()=>{row.rawDone=true;finish();},(error:unknown)=>{row.failure=error;fail(error);row.rawDone=true;finish();}]);}catch(error){row.rawUnknown=!types.isPromise(raw);unknown=true;retained.add(raw);fail(error);}
    }
   }
   row.returned=true;finish();
  }catch(error){row.failure=error;fail(error);row.returned=true;if(row.invoked)unknown=true;finish();}
  return row;
 }
 async function sent(row:ConfigSend){assertStandardIpcPromise(row.completion,'activity_config_send_completion_unknown');await row.completion;if(row.failure)throw row.failure;if(terminal)throw Error('activity_config_terminal');}
 function active(){if(terminal||!target||!owner!.isCurrent(target))throw Error('activity_config_target_revoked');}
 function sessionInput(row:Record<string,unknown>){if(!session)invalid();const names=configObjectKeys(session!);for(let i=0;i<names.length;i++){const key=names[i]!;if(key==='scope'){const scope=configScope(row.scope);if(!scope||!sameConfigScope(scope,target!.scope))invalid();}else if(row[key]!==session![key])invalid();}}
 const I=['protocol','type','daemonBoot','ownerEpoch','installChallenge','mainLaunchNonce','scope'];
 const S=['protocol','type','daemonBoot','ownerEpoch','mainLaunchNonce','scope','configConnectionIncarnation'];
 const O=[...S,'offerId','op'],C=[...O,'targetGeneration','childBoot','commandNonce'];
 function validOperation(op:unknown):op is 'inspect_writer'|'prepare_initial_plan_writer'{return op==='inspect_writer'||op==='prepare_initial_plan_writer';}
 function errorData(error:unknown,depth=0):Record<string,unknown>{
  const fields=error&&typeof error==='object'&&!types.isProxy(error)?configDescriptors(error):configCreate(null);
  const own=(key:string)=>fields[key]&&configOwn(fields[key],'value')?fields[key].value:undefined;
  const text=(key:string,fallback:string)=>typeof own(key)==='string'?(own(key) as string).slice(0,2048):fallback;
  const result=object({name:text('name','Error'),message:text('message','activity_config_execution_failed'),code:text('code','ACTIVITY_CONFIG_EXECUTION_FAILED'),durableCommitted:own('durableCommitted')===true});
  const cause=own('remoteError')??own('cause');if(cause!==undefined&&depth<4)put(result,'cause',errorData(cause,depth+1));return result;
 }
 function install(row:Record<string,unknown>){
  exact(row,I);const scope=configScope(row.scope);
  if(installRoot||row.protocol!==configProtocol||row.daemonBoot!==daemonBoot||row.ownerEpoch!==owner!.ownerEpoch||row.installChallenge!==installChallenge||!configHex(row.mainLaunchNonce)||!scope)invalid();
  const candidate=owner!.target;target=candidate&&owner!.isCurrent(candidate)&&sameConfigScope(candidate.scope,scope)?candidate:undefined;
  const record=root();installRoot=record;
  if(target){session=object({protocol:configProtocol,daemonBoot,ownerEpoch:owner!.ownerEpoch,mainLaunchNonce:row.mainLaunchNonce,scope:target.scope,configConnectionIncarnation:configNonce()});}
  observe(record,async()=>{
   if(!greeting)invalid();await sent(greeting!);if(terminal)throw Error('activity_config_terminal');
   if(!target){admissionClosed=true;await sent(publishFor(record,frame('install_unavailable',{daemonBoot,ownerEpoch:owner!.ownerEpoch,installChallenge,mainLaunchNonce:row.mainLaunchNonce,scope,reason:'target_not_owned'})));return;}
   active();await sent(publishFor(record,frame('installed',{daemonBoot,ownerEpoch:owner!.ownerEpoch,installChallenge,mainLaunchNonce:row.mainLaunchNonce,scope:target.scope,configConnectionIncarnation:session!.configConnectionIncarnation})));
  });
 }
 function admitOffer(row:Record<string,unknown>){
  exact(row,O);sessionInput(row);if(!Number.isSafeInteger(row.offerId)||row.offerId!==lastOfferId+1||!validOperation(row.op))invalid();
  // At most one successor behind each actual predecessor publication.
  const predecessor=offer?offer.invocation?.send:installRoot?.send;
  if(offer&&!offer.invocation?.send||!installRoot||!predecessor)invalid();
  const previousRoot=offer?.invocation??installRoot;
  const record=Object.assign(root(),{wire:row,challengeStarted:false}) as ConfigOffer;offer=record;lastOfferId=row.offerId as number;
  observe(record,async()=>{
   await previousRoot!.completion;if(terminal)throw Error('activity_config_terminal');
   if(admissionClosed){await sent(publishFor(record,withSession('offer_cancelled',{offerId:row.offerId,op:row.op,reason:'configuration_closing'})));return;}
   active();target!.client??=createOwnedKSwarmPrefixV2Client({child:target!.child,scope:target!.scope});
   const raw=prepareOwnedKSwarmPrefixV2Hello(target!.client);record.raw=raw;assertStandardIpcPromise(raw,'activity_config_hello_tail_unknown');record.audience=await raw;
   if(terminal)throw Error('activity_config_terminal');active();assertOwnedKSwarmPrefixV2HelloCurrent(target!.client,record.audience!);
   if(admissionClosed){await sent(publishFor(record,withSession('offer_cancelled',{offerId:row.offerId,op:row.op,reason:'configuration_closing'})));return;}
   record.nonce=configNonce();record.challengeStarted=true;
   await sent(publishFor(record,withSession('command_challenge',{offerId:row.offerId,op:row.op,targetGeneration:target!.generation,childBoot:record.audience!.boot,commandNonce:record.nonce})));
  });
 }
 function admitInvoke(row:Record<string,unknown>){
  exact(row,C);sessionInput(row);const prior=offer;
  if(!prior||!prior.challengeStarted||!prior.send||prior.invocation||row.offerId!==prior.wire.offerId||row.op!==prior.wire.op||!validOperation(row.op)||row.targetGeneration!==target?.generation||row.childBoot!==prior.audience?.boot||row.commandNonce!==prior.nonce)invalid();
  active();const record=root();prior!.invocation=record;lastInvokeId=row.offerId as number;
  observe(record,async()=>{
   await prior!.completion;active();assertOwnedKSwarmPrefixV2HelloCurrent(target!.client!,prior!.audience!);
   // Ordinary seal retains already fully-admitted commands; terminal revoke does not.
   const raw=row.op==='inspect_writer'?target!.client!.inspectWriter():target!.client!.prepareInitialPlanWriter();record.raw=raw;assertStandardIpcPromise(raw,'activity_config_invoke_tail_unknown');
   let result:unknown;try{result=await raw;}catch(error){fail(error);const wire=withSession('command_result',{offerId:row.offerId,op:row.op,targetGeneration:row.targetGeneration,childBoot:row.childBoot,commandNonce:row.commandNonce,error:errorData(error)});const errorSend=publishFor(record,wire);await errorSend.completion;throw error;}
   active();assertOwnedKSwarmPrefixV2HelloCurrent(target!.client!,prior!.audience!);
   await sent(publishFor(record,withSession('command_result',{offerId:row.offerId,op:row.op,targetGeneration:row.targetGeneration,childBoot:row.childBoot,commandNonce:row.commandNonce,result})));
  });
 }
 async function drainRoots(cut:readonly ConfigRoot[]){const results=await settleIntrinsicOperations(cut,row=>row.completion);for(let i=0;i<results.length;i++)if(results[i]!.status==='rejected')remember((results[i] as PromiseRejectedResult).reason);}
 async function drainSends(){const results=await settleIntrinsicOperations(sends.snapshot(),row=>row.completion);for(let i=0;i<results.length;i++)if(results[i]!.status==='rejected')remember((results[i] as PromiseRejectedResult).reason);}
 async function drainTarget(){if(!target?.client)return;const tail=retireConfigTarget(owner!,target)!;await tail.completion;if(tail.failure)throw tail.failure;}
 function seal(row:Record<string,unknown>){
  exact(row,[...S,'throughInvokeId','sealNonce']);sessionInput(row);if(prefix||!Number.isSafeInteger(row.throughInvokeId)||row.throughInvokeId!==lastInvokeId||!configHex(row.sealNonce))invalid();
  admissionClosed=true;const cut=roots.snapshot(),record=root();prefix=record;
  observe(record,async()=>{
   await birthDone;if(unknown)throw Error('activity_config_drain_unconfirmed');await drainRoots(cut);await drainSends();if(terminal)throw Error('activity_config_terminal');
   await drainTarget();if(terminal||unknown||errors.length)throw aggregateIntrinsicErrors(errors,'activity_config_drain_unconfirmed');
   businessPrefixQualified=true;
   // The terminal notification is excluded from the business prefix it reports,
   // while its original SendRecord is still held by endpoint lifecycle close.
   publishFor(record,withSession('prefix_drained',{throughInvokeId:row.throughInvokeId,sealNonce:row.sealNonce}));
  });
 }
 const observer:ConfigEndpointObserver={targetRevoked(revoked){if(target===revoked)fail(Error('activity_config_target_revoked'));}};owner.endpoints.add(observer);
 function protocolFailure(error:unknown){fail(error);if(!faultSent){faultSent=true;publishFor(undefined,frame('fault',{code:'activity_config_not_installed'}));}}
 const onMessage=(raw:unknown,handle:unknown)=>{
  try{if(handle!==undefined&&handle!==null){unknown=true;retained.add(handle);invalid();}if(dispatchBusinessProtocolTag(raw)==='activity_dispatch_business_v1'&&owner.business)return;if(admissionClosed)return;
   const row=captureOwnedConfigurationData(raw);if(!row||typeof row!=='object')invalid();
   if(row.type==='install')install(row);else if(row.type==='offer')admitOffer(row);else if(row.type==='invoke')admitInvoke(row);else if(row.type==='seal_prefix')seal(row);else invalid();
  }catch(error){protocolFailure(error);}
 };
 const onDisconnect=()=>{
  admissionClosed=true;if(!businessPrefixQualified)fail(Error('activity_config_parent_disconnected'));
  const raw=port.sealAndDrain();retained.add(raw);try{assertStandardIpcPromise(raw,'activity_config_disconnect_tail_unknown');void configApply(configThen,raw,[()=>{retained.delete(raw);},()=>{retained.delete(raw);process.stderr.write('activity_desktop_config_lane_unconfirmed\n');}]);}catch(error){unknown=true;remember(error);process.stderr.write('activity_desktop_config_lane_unconfirmed\n');}
 };
 const port=configFreeze({sealAndDrain():Promise<void>{
  if(closing)return closing;admissionClosed=true;let resolve!:()=>void,reject!:(error:unknown)=>void;const result=local(new configPromise<void>((yes,no)=>{resolve=yes;reject=no;}));closing=result;
  const joinLocal=(rows:readonly {completion:Promise<void>}[])=>local(new configPromise<void>(yes=>{let remaining=rows.length;if(!remaining){yes();return;}for(let i=0;i<rows.length;i++)localObserve(rows[i]!.completion,()=>{if(--remaining===0)yes();},error=>{remember(error);if(--remaining===0)yes();});}));
  const cut=roots.snapshot(),run=async()=>{
   await birthDone;await joinLocal(cut);
   // A failed remote retirement must never skip this endpoint's known SDK tails.
   await joinLocal(sends.snapshot());try{await local(drainTarget());}catch(error){remember(error);}
   try{configApply(configRemove,process,['message',onMessage]);}catch(error){remember(error);}
   try{configApply(configRemove,process,['disconnect',onDisconnect]);}catch(error){remember(error);}
   owner!.endpoints.delete(observer);if(unknown||errors.length)throw aggregateIntrinsicErrors(errors,'activity_config_drain_unconfirmed');
  };
  try{const raw=local(run());retained.add(raw);localObserve(raw,()=>{retained.delete(raw);resolve();},(error:unknown)=>{retained.delete(raw);reject(error);});}catch(error){remember(error);unknown=true;}return result;
 }});
 configApply(configWeakSet,configCloseCustody,[port,(settled:(error?:unknown)=>void)=>{const raw=port.sealAndDrain();localObserve(raw,()=>settled(),error=>settled(error));}]);
 configQueue(()=>{try{if(!admissionClosed){process.on('message',onMessage);process.once('disconnect',onDisconnect);greeting=publishFor(undefined,frame('daemon_hello',{daemonBoot,ownerEpoch:owner!.ownerEpoch,installChallenge}));}}catch(error){fail(error);}finally{birthComplete();}});
 return port;
}

export interface ActivityManagedSource {
  name: 'kswarm' | 'broker'; executable: string; entryPath: string; cwd: string;
  env: Record<string, string>; healthUrl: string; healthHeaders?: Record<string, string>;
  args?: string[]; expectedHealth: Record<string, string | number | boolean>;
}
export interface SourceReceipt { name: string; pid: number; birth: string; entryHash: string; ownerEpoch: string; external: boolean; instanceId?: string }

function birth(pid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = process.platform === 'win32'
      ? ['-NoProfile','-NonInteractive','-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]
      : ['-p', String(pid), '-o', 'lstart='];
    execFile(process.platform === 'win32' ? 'powershell.exe' : '/bin/ps', args, { timeout: 3000 }, (error, stdout) => {
      if (error || !stdout.trim()) reject(new Error('activity_source_birth_unavailable')); else resolve(stdout.trim());
    });
  });
}

/** Supervision is independent of UI lifetime. No unknown PID is killed or
 * taken over; durable receipts bind process birth and exact entry identity. */
export class ActivitySourceSupervisor {
  private readonly children = new Map<string, ChildProcess>();
  private readonly receipts = new Map<string, SourceReceipt>();
  private readonly pending = new Map<string, Promise<SourceReceipt>>();
  private closing = false;
  private shutdown?: Promise<void>;
  private readonly stopping = new Set<Promise<void>>();
  // Actual handles created by this instance, never ledger/PID-derived handles.
  private readonly childCloses = new Map<ChildProcess, Promise<void>>();
  private trackChildClose(child: ChildProcess): void {
    const closed = new Promise<void>(resolve => child.once('close', () => {
      this.childCloses.delete(child); resolve();
    }));
    this.childCloses.set(child, closed);
  }
  /** Passive ownership barrier only; does not signal or certify service quiescence. */
  sealAndDrainSpawned(): Promise<void> {
    const owner=configOwner(this);if(owner)revokeConfigTarget(owner);
    this.closing = true;
    return this.shutdown ??= (async () => {
      const admissions = await Promise.allSettled([...this.pending.values(), ...this.stopping]);
      // A late admitted ensure can create the actual target after initial seal.
      if(owner){revokeConfigTarget(owner);await owner.business?.join();}
      // Admitted ensures may finish producing a handle; snapshot AFTER they settle.
      // Never resolve this barrier just because a request's own timeout expired.
      await Promise.all([...this.childCloses.values()]);
      const failures = admissions.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'activity_source_shutdown_failed');
    })();
  }

  constructor(private readonly root: string, readonly ownerEpoch: string) {
    const ledger = join(root, ACTIVITY_STORAGE_NAMES.supervision);
    if (existsSync(ledger)) {
      const state = statSync(ledger);
      if (state.size > 16_384 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)) throw new Error('activity_source_ledger_not_private');
      const document = z.object({ version: z.literal(1), sources: z.array(z.object({ name: z.enum(['broker','kswarm']), pid: z.number().int().nonnegative(), birth: z.string().max(256), entryHash: z.string().length(64), ownerEpoch: z.string().min(1).max(256), external: z.boolean(), instanceId: z.string().max(256).optional() }).strict()).max(2) }).strict().parse(JSON.parse(readFileSync(ledger, 'utf8')));
      for (const receipt of document.sources) this.receipts.set(receipt.name, receipt);
    }
    const owner:ConfigSupervisor={ownerEpoch,generation:0,configBound:false,business:undefined,retirements:createIntrinsicSet<ConfigRetirement>(),endpoints:createIntrinsicSet<ConfigEndpointObserver>(),isCurrent:target=>!this.closing&&!target.revoked&&owner.target===target&&configApply(configMapGet,this.children,['kswarm'])===target.child&&target.child.connected===true&&target.child.exitCode===null&&target.child.signalCode===null};configApply(configWeakSet,configSupervisors,[this,owner]);
  }
  private save(): void {
    const file = join(this.root, ACTIVITY_STORAGE_NAMES.supervision), temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, sources: [...this.receipts.values()] }), { mode: 0o600 }); chmodPrivateActivityFile(temporary); renameSync(temporary, file);
  }
  private async healthy(source: ActivityManagedSource, pid?: number): Promise<boolean> {
    try {
      const response = await fetch(source.healthUrl, { headers: source.healthHeaders, signal: AbortSignal.timeout(1000) });
      if (!response.ok || !Object.keys(source.expectedHealth).length) return false;
      const payload = await response.json() as unknown;
      if (pid !== undefined && (payload as { service?: { pid?: number } })?.service?.pid !== pid) return false;
      return Object.entries(source.expectedHealth).every(([path, expected]) => {
        let actual: unknown = payload;
        for (const key of path.split('.')) actual = actual && typeof actual === 'object' ? (actual as Record<string, unknown>)[key] : undefined;
        return actual === expected;
      });
    }
    catch { return false; }
  }
  private alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new Error('activity_source_liveness_unconfirmed'); }
  }
  ensure(source: ActivityManagedSource): Promise<SourceReceipt> {
    if (this.closing) return Promise.reject(new Error('activity_source_closing'));
    const existing = this.pending.get(source.name); if (existing) return existing;
    const pending = this.ensureSource(source).finally(() => { if (this.pending.get(source.name) === pending) this.pending.delete(source.name); });
    this.pending.set(source.name, pending); return pending;
  }
  private async ensureSource(source: ActivityManagedSource): Promise<SourceReceipt> {
    if (!isAbsolute(source.entryPath) || !isAbsolute(source.cwd) || !existsSync(source.entryPath)) throw new Error('activity_source_entry_invalid');
    const entryHash = createHash('sha256').update(readFileSync(source.entryPath)).digest('hex');
    const previous = this.receipts.get(source.name);
    if (previous && !previous.external) {
      if (!this.alive(previous.pid)) {if(source.name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}this.receipts.delete(source.name); this.save(); return this.ensureSource(source); }
      if (previous.entryHash !== entryHash || await birth(previous.pid) !== previous.birth) throw new Error('activity_source_identity_mismatch');
      if (await this.healthy(source, previous.pid)) { const receipt = { ...previous, ownerEpoch: this.ownerEpoch }; this.receipts.set(source.name, receipt); this.save(); return receipt; }
      throw new Error('activity_supervised_source_unhealthy');
    }
    if (await this.healthy(source)) {
      // A verified independent external endpoint may be observed, but it is
      // not an owned PID and cannot acquire this supervisor's kill authority.
      const receipt = { name: source.name, pid: 0, birth: '', entryHash, ownerEpoch: this.ownerEpoch, external: true };
      this.receipts.set(source.name, receipt); this.save(); return receipt;
    }
    if(source.name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    const logPath = join(this.root, source.name === 'kswarm' ? ACTIVITY_STORAGE_NAMES.kswarmLog : ACTIVITY_STORAGE_NAMES.brokerLog);
    const log = openSync(logPath, 'a', 0o600);
    const launchEnv=Object.freeze({...process.env,...source.env});
    let child: ChildProcess;
    try {
      chmodPrivateActivityFile(logPath);
      child = spawn(source.executable, source.args ?? [source.entryPath], { cwd: source.cwd, env: launchEnv, detached: true,
        stdio: source.name === 'kswarm' ? ['ignore', log, log, 'ipc'] : ['ignore', log, log], windowsHide: true });
      this.trackChildClose(child);
    } finally { closeSync(log); }
    let failure: unknown; child.once('error', error => { failure = error; }); child.unref();
    // Preserve the original idle-parent lifetime; unref is not a drain receipt.
    if (source.name === 'kswarm') child.channel?.unref();
    if (!child.pid) throw new Error('activity_source_spawn_failed');
    this.children.set(source.name, child);
    // From spawn until a receipt is returned, any failure (birth lookup,
    // receipt save, health probe, timeout) reaps the actual child first. A
    // child left running keeps its cwd and listener and becomes an orphan.
    try {
      registerConfigTarget(this,child,source,launchEnv);
      const receipt: SourceReceipt = { name: source.name, pid: child.pid, birth: await birth(child.pid), entryHash, ownerEpoch: this.ownerEpoch, external: false };
      this.receipts.set(source.name, receipt); this.save();
      const until = Date.now() + 10_000;
      while (Date.now() < until) { if (failure || child.exitCode !== null) throw new Error('activity_source_start_failed'); if (await this.healthy(source, child.pid)) return receipt; await new Promise(resolve => setTimeout(resolve, 100)); }
      // A child that never proved health is not a usable source. Leaving it
      // running orphans its listener (e.g. Broker on 4318) once the owner exits,
      // and every later launcher then fails with EADDRINUSE.
      throw new Error('activity_source_start_timeout');
    } catch (error) {
      await this.reapUnstarted(source.name, child);
      throw error;
    }
  }
  /** Kill an actual child handle this instance spawned that never became healthy, and wait for its exit. */
  private async reapUnstarted(name: string, child: ChildProcess): Promise<void> {
    if(name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    const closed = this.childCloses.get(child);
    if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    if (closed) await closed;
    if (this.children.get(name) === child) this.children.delete(name);
    if (this.receipts.get(name)?.pid === child.pid) { this.receipts.delete(name); this.save(); }
  }
  async protectedPid(pid: number): Promise<boolean> {
    const receipt = [...this.receipts.values()].find(item => !item.external && item.pid === pid);
    return Boolean(receipt && this.alive(pid) && await birth(pid) === receipt.birth);
  }
  stopOwned(name: string, expectedOwnerEpoch: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('activity_source_closing'));
    const pending = this.stopOwnedSource(name, expectedOwnerEpoch).finally(() => { this.stopping.delete(pending); });
    this.stopping.add(pending); return pending;
  }
  private async stopOwnedSource(name: string, expectedOwnerEpoch: string): Promise<void> {
    if (expectedOwnerEpoch !== this.ownerEpoch) throw new Error('activity_source_stale_lease');
    const ledger = JSON.parse(readFileSync(join(this.root, ACTIVITY_STORAGE_NAMES.supervision), 'utf8')) as { sources: SourceReceipt[] };
    if (ledger.sources.find(item => item.name === name)?.ownerEpoch !== this.ownerEpoch) throw new Error('activity_source_stale_lease');
    const receipt = this.receipts.get(name);
    if (!receipt || receipt.external) throw new Error('activity_source_stop_unconfirmed');
    if(name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    if (!this.alive(receipt.pid)) { this.receipts.delete(name); this.children.delete(name); this.save(); return; }
    if (!await this.protectedPid(receipt.pid)) throw new Error('activity_source_stop_unconfirmed');
    process.kill(receipt.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (this.alive(receipt.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (this.alive(receipt.pid)) throw new Error('activity_source_stop_pending');
    this.receipts.delete(name); this.children.delete(name); this.save();
  }
}
