import {createHash as initialCreateHash, Hash as InitialHash} from 'node:crypto';
import {types} from 'node:util';

// Trusted fixed-package startup references. No caller reader, callback or grant.
const nativeCreateHash=initialCreateHash, nativeHashUpdate=InitialHash.prototype.update, nativeHashDigest=InitialHash.prototype.digest;
const NativeError=Error, NativeWeakSet=WeakSet, NativeSet=Set;
const nativeProxy=types.isProxy, nativePrototype=Object.getPrototypeOf, objectPrototype=Object.prototype;
const nativeDescriptors=Object.getOwnPropertyDescriptors, nativeOwn=Object.hasOwn, nativeKeys=Object.keys;
const nativeOwnKeys=Reflect.ownKeys, nativeApply=Reflect.apply, nativeDefine=Object.defineProperty, nativeFreeze=Object.freeze;
const nativeArray=Array.isArray, nativeSort=Array.prototype.sort, nativeIncludes=Array.prototype.includes;
const nativeJson=JSON.stringify, nativeFinite=Number.isFinite, nativeInteger=Number.isSafeInteger, nativeByteLength=Buffer.byteLength;
const nativeWeakHas=WeakSet.prototype.has, nativeWeakAdd=WeakSet.prototype.add, nativeWeakDelete=WeakSet.prototype.delete;
const nativeSetHas=Set.prototype.has, nativeSetAdd=Set.prototype.add, nativeRegexTest=RegExp.prototype.test;
const hashPattern=/^[a-f0-9]{64}$/, controlPattern=/[\x00-\x1f\x7f]/;
const ownerKinds=nativeFreeze(['task','intent','goal','loop','project']);
function fail(message:string):never {throw new NativeError(message);}
function includes(values:readonly unknown[],value:unknown):boolean {return nativeApply(nativeIncludes,values,[value]);}
function defineData(target:object,key:PropertyKey,value:unknown):void {
  nativeDefine(target,key,{__proto__:null,value,enumerable:true,writable:true,configurable:true} as PropertyDescriptor);
}

/** Internal controller protocol. Parsing or possession of a DTO never grants authority. */
export interface VerificationDependency {
  kind?: 'inherited'; originOwner?: {profileId:string;ownerKind:VerificationTuple['ownerKind'];ownerId:string}; originalObligationId?:string;
  obligationId: string; predicateId: string; predicateVersion: string; definitionHash: string;
  activeAttemptId: string; attemptEpoch: number; sourceRunId: string; runNonce: string;
  subjectId: string; contentRoot: string; coreId: string; coreHash: string; coreFinalRevision: number;
  proofId: string; proofHash: string; proofRevision: number; requiredScopeId: string; scopeRevision: number; invalidationEpoch: number;
}
/** A direct identifier can never alias an inherited identity, regardless of its text. */
export function verificationDependencyKey(value: VerificationDependency): string {
  const input=record(value);
  return canonicalVerificationJson(ownValue(input,'kind') === 'inherited'
    ? ['inherited',ownValue(input,'originOwner'),ownValue(input,'originalObligationId')]
    : ['direct',ownValue(input,'obligationId')]);
}
export function compareVerificationDependencies(a:VerificationDependency,b:VerificationDependency):number {
  const x=verificationDependencyKey(a),y=verificationDependencyKey(b);return x<y?-1:x>y?1:0;
}
export interface VerificationTuple {
  schemaVersion: 1; profileId: string; ownerKind: 'task' | 'intent' | 'goal' | 'loop' | 'project' | 'kswarm'; ownerId: string;
  migrationEpoch: number; expectedBusinessRevision: number; obligationSetRevision: number; obligationSetHash: string;
  obligations: readonly Readonly<VerificationDependency>[];
  operationId: string; immutablePayloadHash: string; receiverId: string; receiverProtocolVersion: 1;
  receiverInstanceEpoch: number; reservationId: string; nonce: string;
  notBefore: number; validUntil: number; clockDomainId: string; clockQualificationEpoch: number;
}
export const VERIFICATION_BUDGET = nativeFreeze({
  profileBytes: 2048 * 1024 ** 2, controlDatabaseBytes: 128 * 1024 ** 2,
  rollbackAndTemporaryBytes: 144 * 1024 ** 2, outboxPayloadBytes: 32 * 1024 ** 2,
  auxiliaryBytes: 16 * 1024 ** 2, maximumCounterOwners: 64, counterOwnerBytes: 4 * 1024 ** 2,
  archiveBytes: 1472 * 1024 ** 2, sessionBytes: 256 * 1024 ** 2, recordBytes: 16 * 1024 ** 2,
  maximumOutboxRecords: 4096, maximumObligationsPerOwner: 256, maximumObligationsPerProfile: 4096, maximumExecutionAttempts: 131072, maximumChecks: 4096, rpcBytes: 1024 ** 2,
});
const dependencyFields = {
  obligationId: 'id', predicateId: 'id', predicateVersion: 'id', definitionHash: 'hash', activeAttemptId: 'id',
  attemptEpoch: 'integer', sourceRunId: 'id', runNonce: 'id', subjectId: 'id', contentRoot: 'hash', coreId: 'id',
  coreHash: 'hash', coreFinalRevision: 'integer', proofId: 'id', proofHash: 'hash', proofRevision: 'integer',
  requiredScopeId: 'id', scopeRevision: 'integer', invalidationEpoch: 'integer',
} as const;
const tupleFields = {
  schemaVersion: 'integer', profileId: 'id', ownerKind: 'id', ownerId: 'id', migrationEpoch: 'integer',
  expectedBusinessRevision: 'integer', obligationSetRevision: 'integer', obligationSetHash: 'hash',
  operationId: 'id', immutablePayloadHash: 'hash', receiverId: 'id', receiverProtocolVersion: 'integer',
  receiverInstanceEpoch: 'integer', reservationId: 'id', nonce: 'id', notBefore: 'integer', validUntil: 'integer',
  clockDomainId: 'id', clockQualificationEpoch: 'integer',
} as const;
// Native descriptor metadata has own data fields. Never consult an inherited
// `value`, execute a Proxy trap, or ask an input for map/species/toJSON behavior.
function dataDescriptors(input:unknown,allowArray=false):Record<PropertyKey,PropertyDescriptor> {
  if(input===null||typeof input!=='object'||nativeProxy(input))fail('verification_invalid_record');
  if(nativeArray(input)) {if(!allowArray)fail('verification_invalid_record');}
  else {const proto=nativePrototype(input);if(proto!==objectPrototype&&proto!==null)fail('verification_invalid_record');}
  const descriptors=nativeDescriptors(input) as Record<PropertyKey,PropertyDescriptor>,keys=nativeOwnKeys(descriptors);
  for(let i=0;i<keys.length;i++)if(!nativeOwn(descriptors[keys[i]!]!,'value'))fail('verification_accessor_denied');
  return descriptors;
}
function ownValue(input:Record<string,unknown>,key:string):unknown {return nativeOwn(input,key)?input[key]:undefined;}
function record(input:unknown):Record<string,unknown> {
  const descriptors=dataDescriptors(input),keys=nativeKeys(input as object),result:Record<string,unknown>={};
  for(let i=0;i<keys.length;i++){const key=keys[i]!;defineData(result,key,descriptors[key]!.value);}
  return result;
}
function fields(input:Record<string,unknown>,expected:Record<string,'id'|'integer'|'hash'>,extra:string[]=[]):void {
  const keys=nativeKeys(input),expectedKeys=nativeKeys(expected);
  if(keys.length!==expectedKeys.length+extra.length)fail('verification_tuple_fields');
  for(let i=0;i<keys.length;i++)if(!nativeOwn(expected,keys[i]!)&&!includes(extra,keys[i]))fail('verification_tuple_fields');
  for(let i=0;i<expectedKeys.length;i++) {
    const key=expectedKeys[i]!,kind=expected[key],value=ownValue(input,key);
    if(kind==='integer') {
      if(!nativeInteger(value)||(value as number)<0)fail('verification_invalid_integer');
    }else if(typeof value!=='string'||(kind==='hash'
      ? !nativeApply(nativeRegexTest,hashPattern,[value])
      : !value.length||nativeByteLength(value)>160||nativeApply(nativeRegexTest,controlPattern,[value])))fail('verification_invalid_string');
  }
}
nativeFreeze(dependencyFields);nativeFreeze(tupleFields);
const maximumObligations=VERIFICATION_BUDGET.maximumObligationsPerOwner,maximumRpcBytes=VERIFICATION_BUDGET.rpcBytes;
export function parseVerificationTuple(input:unknown):Readonly<VerificationTuple> {
  const value=record(input);fields(value,tupleFields,['obligations']);
  if(value.schemaVersion!==1||value.receiverProtocolVersion!==1||!includes(ownerKinds,value.ownerKind))fail('verification_protocol_version');
  if((value.validUntil as number)<=(value.notBefore as number))fail('verification_invalid_window');
  const raw=ownValue(value,'obligations');
  if(raw===null||typeof raw!=='object'||nativeProxy(raw))fail('verification_invalid_record');
  if(!nativeArray(raw))fail('verification_obligation_count');
  const descriptors=dataDescriptors(raw,true),length=descriptors.length!.value as number;
  if(!length||length>maximumObligations)fail('verification_obligation_count');
  const obligations:Readonly<VerificationDependency>[]=[];
  for(let i=0;i<length;i++) {
    const key=`${i}`;if(!nativeOwn(descriptors,key))fail('verification_invalid_record');
    const item=record(descriptors[key]!.value);
    if(ownValue(item,'kind')==='inherited') {
      fields(item,{...dependencyFields,kind:'id',originalObligationId:'id'},['originOwner']);
      const origin=record(ownValue(item,'originOwner'));fields(origin,{profileId:'id',ownerKind:'id',ownerId:'id'});
      if(!includes(ownerKinds,origin.ownerKind)||origin.profileId!==value.profileId||item.originalObligationId!==item.obligationId
        ||origin.ownerKind===value.ownerKind&&origin.ownerId===value.ownerId)fail('verification_dependency_origin');
      defineData(item,'originOwner',nativeFreeze(origin));
    }else fields(item,dependencyFields);
    defineData(obligations,i,nativeFreeze(item));
  }
  nativeApply(nativeSort,obligations,[compareVerificationDependencies]);
  const identities=new NativeSet<string>();
  for(let i=0;i<obligations.length;i++) {
    const key=verificationDependencyKey(obligations[i]!);
    if(nativeApply(nativeSetHas,identities,[key]))fail('verification_duplicate_obligation');
    nativeApply(nativeSetAdd,identities,[key]);
  }
  defineData(value,'obligations',nativeFreeze(obligations));
  const result=nativeFreeze(value) as unknown as Readonly<VerificationTuple>;
  if(nativeByteLength(canonicalVerificationJson(result))>maximumRpcBytes)fail('verification_rpc_limit');
  return result;
}
export function canonicalVerificationJson(value:unknown):string {
  const ancestors=new NativeWeakSet<object>();
  function visit(input:unknown):string {
    if(input===null||typeof input==='boolean'||typeof input==='string')return nativeJson(input);
    if(typeof input==='number'&&nativeFinite(input))return nativeJson(input);
    const descriptors=dataDescriptors(input,true),object=input as object;
    if(nativeApply(nativeWeakHas,ancestors,[object]))fail('verification_invalid_record');
    nativeApply(nativeWeakAdd,ancestors,[object]);
    try {
      if(nativeArray(object)) {
        const length=descriptors.length!.value as number;let result='[';
        for(let i=0;i<length;i++) {
          const key=`${i}`;if(!nativeOwn(descriptors,key))fail('verification_invalid_record');
          if(i)result+=',';result+=visit(descriptors[key]!.value);
        }
        return result+']';
      }
      const keys=nativeKeys(object);nativeApply(nativeSort,keys,[]);let result='{';
      for(let i=0;i<keys.length;i++) {const key=keys[i]!;if(i)result+=',';result+=nativeJson(key)+':'+visit(descriptors[key]!.value);}
      return result+'}';
    }finally {nativeApply(nativeWeakDelete,ancestors,[object]);}
  }
  return visit(value);
}
export function hashVerificationTuple(value:unknown):string {
  const hash=nativeCreateHash('sha256');
  nativeApply(nativeHashUpdate,hash,[canonicalVerificationJson(parseVerificationTuple(value))]);
  return nativeApply(nativeHashDigest,hash,['hex']);
}
const transitions: Record<string, Record<string, readonly string[]>> = {
  attempt: { prepared: ['running', 'unknown', 'cancelled_before_dispatch'], running: ['termination_pending', 'unknown', 'terminal'], termination_pending: ['unknown', 'terminal'], unknown: ['terminal'], terminal: ['superseded'] },
  proof: { pending: ['pass', 'fail', 'unverified'], pass: ['revoked', 'superseded', 'expired'] },
  settlement: { prepared: ['committed', 'aborted'] },
  outbox: { staged: ['ready', 'failed_before_dispatch', 'cancelled'], ready: ['dispatching', 'failed_before_dispatch', 'cancelled'], dispatching: ['receiver_committed', 'delivery_unknown', 'cancelled'], delivery_unknown: ['receiver_committed', 'cancelled'] },
  reservation: { pending: ['commit_authorized', 'cancelled'], commit_authorized: ['consumed', 'cancelled'] },
  revocation: { active: ['revocation_pending'], revocation_pending: ['revoked'] },
  obligation: { registered_unsatisfied: ['satisfied'], satisfied: ['registered_unsatisfied'] },
  receiver: { prepared: ['committed', 'cancelled'] },
};
/** Structural edge check only; service must also enforce source, facts, tuple and revision. */
export function assertVerificationTransition(kind: string, from: string, to: string): void {
  if(typeof kind!=='string'||typeof from!=='string'||typeof to!=='string'||!nativeOwn(transitions,kind)||!nativeOwn(transitions[kind]!,from)||!includes(transitions[kind]![from]!,to))fail('verification_illegal_transition');
}
