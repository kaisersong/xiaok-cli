import {assertOriginalSupervisorImplementationContext} from './source-supervisor.js';
import { types } from 'node:util';
import { createIntrinsicSet, appendIntrinsic, aggregateIntrinsicErrors, settleIntrinsicOperations } from '../verification/intrinsic-async-collection.js';
import { assertStandardIpcPromise } from '../verification/native-ipc-promise.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';
import { createOwnedKSwarmPrefixV2Client, prepareOwnedKSwarmPrefixV2Hello, assertOwnedKSwarmPrefixV2HelloCurrent, captureOwnedConfigurationData } from './owned-kswarm-control.js';
import { dispatchBusinessProtocolTag } from './dispatch-business-data.js';
import type { canonicalConfigContext, ActivitySourceSupervisor, ConfigTarget, ConfigEndpointObserver, CanonicalDesktopConfigEndpoint, ConfigSend, ConfigRoot, ConfigOffer } from './source-supervisor.js';
export function bindCanonicalDesktopConfigBirth(birth:object,supervisor:ActivitySourceSupervisor,configFile:string,config:ActivityOwnerConfig, context:canonicalConfigContext):CanonicalDesktopConfigEndpoint {
 assertOriginalSupervisorImplementationContext(context,'config');
 const {configPromise,configThen,configApply,configFreeze,configCreate,configDefine,configWeakGet,configWeakSet,configPrototype,configQueue,configRemove,configBirths,configObjectKeys,configOwn,configDescriptors,configHex,configScope,sameConfigScope,configOwner,retireConfigTarget,configProtocol,configNonce,configPathSame,configCloseCustody}=context;
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

