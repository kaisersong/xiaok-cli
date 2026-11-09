import type {Database} from 'better-sqlite3';
import type {VerificationOwner} from './proof-authority.js';
import {types} from 'node:util';
import {canonicalVerificationJson as json} from './protocol.js';
import {captureRegistrationSnapshot} from './registration-value-snapshot.js';
import {readIntentSqlContract} from './intent-sql-parsing-context.js';
import {isIntentContractOwner,type IntentContractEnrollment} from './intent-contract-enrollment.js';
import {intentHostSubjectOwner} from './intent-host-subject.js';
import {REGISTRATION_TABLE_KEYS} from './registration-table-keys.js';

interface RegistrationCensusRead {
 readonly evidence:unknown;
 records(sql:string,args?:unknown[]):Record<string,any>[];
 groups(table:keyof typeof REGISTRATION_TABLE_KEYS,keys:readonly string[]):Map<string,Record<string,any>[]>;
 finish():void;
}

const pvProxy=types.isProxy,pvPrototype=Object.getPrototypeOf,pvDescriptor=Object.getOwnPropertyDescriptor;
const pvOwnKeys=Reflect.ownKeys,pvOwn=Object.hasOwn,pvArray=Array.isArray,pvInteger=Number.isSafeInteger;
const pvApply=Reflect.apply,pvDefine=Object.defineProperty,pvSort=Array.prototype.sort,pvMapGet=Map.prototype.get;
const pvArrayPrototype=Array.prototype,pvObjectPrototype=Object.prototype,pvKeys=Object.keys;
function pvAppend<T>(array:T[],value:T):void{const descriptor={__proto__:null,value,enumerable:true,writable:true,configurable:true};pvDefine(array,array.length,descriptor);}
function pvAt(array:readonly unknown[],index:number):unknown{return pvDescriptor(array,`${index}`)?.value;}
function pvGet<K,V>(map:Map<K,V>,key:K):V|undefined{return pvApply(pvMapGet,map,[key]);}
function pvDense(value:unknown):value is unknown[]{
 if(value===null||typeof value!=='object'||pvProxy(value)||!pvArray(value)||pvPrototype(value)!==pvArrayPrototype)return false;
 const length=pvDescriptor(value,'length');
 if(!length||!pvOwn(length,'value')||typeof length.value!=='number'||!pvInteger(length.value)||length.value<0||pvOwnKeys(value).length!==length.value+1)return false;
 for(let i=0;i<length.value;i++){const d=pvDescriptor(value,`${i}`);if(!d||!pvOwn(d,'value')||d.enumerable!==true)return false;}
 return true;
}
function pvStrings(value:unknown):value is string[]{
 if(!pvDense(value))return false;for(let i=0;i<value.length;i++)if(typeof pvAt(value,i)!=='string')return false;return true;
}
function pvRows(value:unknown):value is Record<string,unknown>[]{
 if(!pvDense(value))return false;
 for(let i=0;i<value.length;i++){
  const row=pvAt(value,i);if(row===null||typeof row!=='object'||pvProxy(row)||pvPrototype(row)!==null)return false;
  const keys=pvOwnKeys(row);
  for(let j=0;j<keys.length;j++){
   const key=keys[j]!;if(typeof key!=='string'||key==='__proto__')return false;
   const d=pvDescriptor(row,key);if(!d||!pvOwn(d,'value')||d.enumerable!==true)return false;
   const cell:unknown=d.value;if(cell!==null&&typeof cell!=='string'&&(typeof cell!=='number'||!pvInteger(cell)))return false;
  }
 }
 return true;
}
function pvIdentity(value:unknown):boolean{
 if(value===null||typeof value!=='object'||pvProxy(value))return false;
 const parent=pvPrototype(value);if(parent!==null&&parent!==pvObjectPrototype||pvOwnKeys(value).length!==3)return false;
 const p=pvDescriptor(value,'profileId'),k=pvDescriptor(value,'ownerKind'),o=pvDescriptor(value,'ownerId');
 return !!p&&!!k&&!!o&&pvOwn(p,'value')&&pvOwn(k,'value')&&pvOwn(o,'value')&&typeof p.value==='string'&&typeof k.value==='string'&&typeof o.value==='string';
}

export function registrationRows<T extends Record<string,any>>(rows:readonly T[]):T[]{
  if(rows.length<2)return [...rows];
  return rows.map(row=>({row,key:json(row)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(value=>value.row);
 }

export function registrationVector(nodes:readonly Record<string,any>[]):Record<string,any>[]{
  const sorted=[...nodes].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  for(let index=0;index<sorted.length;index++)if(typeof sorted[index]!.key!=='string'||(index>0&&sorted[index-1]!.key===sorted[index]!.key))throw Error('application_registration_changed');
  return captureRegistrationSnapshot(sorted);
 }

export function privatePrimitiveVector(keys:string[],pending:string[],identities:Map<string,VerificationOwner>,profiles:Map<string,Record<string,unknown>[]>,logical:Map<string,string[]>,dependencies:Map<string,Record<string,unknown>[]>,grouped:Map<keyof typeof REGISTRATION_TABLE_KEYS,Map<string,Record<string,unknown>[]>>,storage:Record<string,unknown>[]):Record<string,unknown>[]|undefined{
  const tables=pvKeys(REGISTRATION_TABLE_KEYS) as Array<keyof typeof REGISTRATION_TABLE_KEYS>;
  // Eligibility is not a validator: all uncertainty returns to the original
  // table/owner error order over these SAME already-read SQL results.
  try{
   if(!pvStrings(keys)||!pvStrings(pending)||!pvRows(storage))return undefined;
   for(let i=0;i<keys.length;i++){
    const key=pvAt(keys,i) as string;if(!pvIdentity(pvGet(identities,key))||!pvRows(pvGet(profiles,key))||!pvRows(pvGet(dependencies,key)))return undefined;
    const lookups=pvGet(logical,key);if(!pvStrings(lookups))return undefined;
    for(let j=0;j<tables.length;j++){
     const table=pvAt(tables,j) as keyof typeof REGISTRATION_TABLE_KEYS;if(table==='verification_owner_dependencies')continue;
     const groups=pvGet(grouped,table);if(!groups)return undefined;
     if(REGISTRATION_TABLE_KEYS[table]==='logical_owner_key'){
      for(let k=0;k<lookups.length;k++)if(!pvRows(pvGet(groups,pvAt(lookups,k) as string)))return undefined;
     }else if(!pvRows(pvGet(groups,key)))return undefined;
    }
   }
  }catch{return undefined;}
  function sorted(rows:readonly Record<string,unknown>[]):Record<string,unknown>[]{
   const decorated:{row:Record<string,unknown>;key:string}[]=[],result:Record<string,unknown>[]=[];
   if(rows.length<2){for(let i=0;i<rows.length;i++)pvAppend(result,pvAt(rows,i) as Record<string,unknown>);return result;}
   for(let i=0;i<rows.length;i++){
    const row=pvAt(rows,i) as Record<string,unknown>;pvAppend(decorated,{row,key:json(row)});
   }
   pvApply(pvSort,decorated,[(a:{key:string},b:{key:string})=>a.key<b.key?-1:a.key>b.key?1:0]);
   for(let i=0;i<decorated.length;i++){const d=pvDescriptor(decorated,`${i}`)!;pvAppend(result,d.value.row);}
   return result;
  }
  function rows(table:keyof typeof REGISTRATION_TABLE_KEYS,key:string):Record<string,unknown>[]{return sorted(pvGet(pvGet(grouped,table)!,key)!);}
  function combined(table:keyof typeof REGISTRATION_TABLE_KEYS,lookups:readonly string[]):Record<string,unknown>[]{
   const result:Record<string,unknown>[]=[];
   for(let i=0;i<lookups.length;i++){
    const part=rows(table,pvAt(lookups,i) as string);for(let j=0;j<part.length;j++)pvAppend(result,pvAt(part,j) as Record<string,unknown>);
   }
   return sorted(result);
  }
  const storageFeatures=sorted(storage),vectors:Record<string,unknown>[]=[];
  for(let i=0;i<keys.length;i++){
   const key=pvAt(keys,i) as string,lookups=pvGet(logical,key)!,owners=rows('verification_registered_owners',key),invocations=rows('verification_registered_invocations',key);
   pvAppend(vectors,{key,profiles:pvGet(profiles,key)!,dependencies:sorted(pvGet(dependencies,key)!),intents:combined('owner_enrollment_intents',lookups),owner:owners,verification:rows('verification_owners',key),mandatory:rows('mandatory_observation_checks',key),invocations,invocationReceipts:rows('owner_enrollment_invocation_receipts',key),goalSessions:rows('owner_enrollment_goal_sessions',key),loopSubjects:rows('owner_enrollment_loop_subjects',key),intentContracts:rows('owner_enrollment_intent_contracts',key),kswarmSubjects:combined('owner_enrollment_kswarm_subjects',lookups),storageFeatures,migration:rows('migration_publication_intents',key),application:rows('verification_application_pointers',key),history:rows('verification_application_history',key),transitions:rows('verification_application_transitions',key)});
  }
  // Copies EACH occurrence, including profiles/dependencies/storage aliases.
  // This detached result, not the raw rows, is what crosses the original finish.
  return captureRegistrationSnapshot(vectors,false);
 }

export function readGenericRegistrationData(db:Database,census:RegistrationCensusRead,owner:VerificationOwner,activation?:{owner:VerificationOwner;invocations:readonly unknown[]},originalIntent?:IntentContractEnrollment):{vector:Record<string,any>[];evidence:unknown}{
   const root=json(owner),pending=[root],identities=new Map<string,VerificationOwner>(),dependencies=new Map<string,Record<string,any>[]>();
   if(isIntentContractOwner(owner)){
    const receipt=census.groups('owner_enrollment_intent_contracts',[root]).get(root)![0];
    if(receipt||originalIntent){const binding=originalIntent??readIntentSqlContract(db,receipt!.contract_json);for(const stageId of [null,...binding.contract.stages.map(stage=>stage.stageId)])pending.push(json({...intentHostSubjectOwner({...binding.subject,stageId}),profileId:owner.profileId}));}
   }
   while(pending.length){const frontier:string[]=[];while(pending.length){const key=pending.pop()!;if(identities.has(key))continue;identities.set(key,JSON.parse(key));if(identities.size>4096)throw Error('application_registration_changed');frontier.push(key);}const found=census.groups('verification_owner_dependencies',frontier);for(const key of frontier){const edges=found.get(key)!;dependencies.set(key,edges);for(const edge of edges)pending.push(edge.child_key);}}
   const keys=[...identities.keys()],profileRows=new Map(keys.map(key=>[key,census.records('SELECT * FROM main.verification_profiles WHERE profile_id=? OR uid IN (SELECT uid FROM main.verification_registered_owners WHERE owner_key=?) ORDER BY uid',[identities.get(key)!.profileId,key])])),logicalByOwner=new Map<string,string[]>(),logicalKeys=new Set<string>();
   for(const key of keys){const identity=identities.get(key)!,logical=profileRows.get(key)!.map(p=>json({uid:p.uid,accountGeneration:p.account_id.toUpperCase(),ownerKind:identity.ownerKind,ownerId:identity.ownerId}));logicalByOwner.set(key,logical);for(const value of logical)logicalKeys.add(value);}
   const grouped=new Map<keyof typeof REGISTRATION_TABLE_KEYS,Map<string,Record<string,any>[]>>();
   for(const table of Object.keys(REGISTRATION_TABLE_KEYS) as Array<keyof typeof REGISTRATION_TABLE_KEYS>){if(table==='verification_owner_dependencies')continue;grouped.set(table,census.groups(table,REGISTRATION_TABLE_KEYS[table]==='logical_owner_key'?[...logicalKeys]:keys));}
   const rawStorageFeatures=census.records('SELECT * FROM main.verification_storage_features ORDER BY feature');
   let vectors=activation===undefined?privatePrimitiveVector(keys,pending,identities,profileRows,logicalByOwner,dependencies,grouped,rawStorageFeatures):undefined;
   if(vectors===undefined){
   const rows=(table:keyof typeof REGISTRATION_TABLE_KEYS,key:string)=>captureRegistrationSnapshot(registrationRows(grouped.get(table)!.get(key)??[]),false),storageFeatures=registrationRows(rawStorageFeatures);
   vectors=[];
   for(const key of keys){const identity=identities.get(key)!,profiles=profileRows.get(key)!,logical=logicalByOwner.get(key)!,owners=rows('verification_registered_owners',key),invocations=rows('verification_registered_invocations',key);
    if(activation&&identity.profileId===activation.owner.profileId)for(const profile of profiles)profile.state='active';
    if(activation&&key===json(activation.owner)){for(const row of owners)row.state='active';for(const row of invocations)if(activation.invocations.some(v=>json(v)===row.invocation_json))row.state='active';}
    vectors.push({key,profiles,dependencies:registrationRows(dependencies.get(key)!),intents:registrationRows(logical.flatMap(value=>rows('owner_enrollment_intents',value))),owner:owners,verification:rows('verification_owners',key),mandatory:rows('mandatory_observation_checks',key),invocations,invocationReceipts:rows('owner_enrollment_invocation_receipts',key),goalSessions:rows('owner_enrollment_goal_sessions',key),loopSubjects:rows('owner_enrollment_loop_subjects',key),intentContracts:rows('owner_enrollment_intent_contracts',key),kswarmSubjects:registrationRows(logical.flatMap(value=>rows('owner_enrollment_kswarm_subjects',value))),storageFeatures:captureRegistrationSnapshot(storageFeatures),migration:rows('migration_publication_intents',key),application:rows('verification_application_pointers',key),history:rows('verification_application_history',key),transitions:rows('verification_application_transitions',key)});
   }
   }
   census.finish();const vector=registrationVector(vectors);return {vector,evidence:census.evidence};
}
