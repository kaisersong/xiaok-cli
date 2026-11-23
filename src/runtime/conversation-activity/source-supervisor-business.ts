import {assertOriginalSupervisorImplementationContext} from './source-supervisor.js';
import { types } from 'node:util';
import { createIntrinsicSet, appendIntrinsic, aggregateIntrinsicErrors } from '../verification/intrinsic-async-collection.js';
import { createOwnedKSwarmBusiness, prepareOwnedKSwarmBusinessHello, assertOwnedKSwarmBusinessHelloCurrent, assertOwnedKSwarmPreparationHelloCurrent, readOwnedKSwarmPreparationFacet, type KSwarmBusinessAudience, type KSwarmPreparationFacet, type KSwarmPreparationWork, type KSwarmPreparationAudience } from './owned-kswarm-business.js';
import { captureDispatchBusinessData } from './dispatch-business-data.js';
import { assertCanonicalBusinessEndpoint, readCanonicalBusinessCommand, readCanonicalPreparationBinding, readCanonicalPreparationCommand, revokeCanonicalBusinessTarget, observeCanonicalBusinessTargetClose, type CanonicalBusinessTargetAudience, type CanonicalSupervisedBusinessPort, type CanonicalPreparationBinding } from './canonical-dispatch-business.js';
import { join } from 'node:path';
import type { supervisedBusinessContext, ConfigScope, ConfigTarget } from './source-supervisor.js';
export function bindOriginalSupervisedBusinessEndpoint(supervisor:object,endpoint:object, context:supervisedBusinessContext):CanonicalSupervisedBusinessPort {
 assertOriginalSupervisorImplementationContext(context,'business');
 const {configPromise,configThen,configApply,configFreeze,configCreate,configDefine,ConfigWeakMap,configWeakGet,configWeakSet,configPrototype,configSetPrototype,configJson,configOwn,sameConfigScope,configOwner}=context;
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
