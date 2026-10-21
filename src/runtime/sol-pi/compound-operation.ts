import {validateManagedTurnLedger,mergeManagedTurnLedgers,type ManagedTurnLedger} from './compound-managed-turn.js';
import {validateProviderAttempt,validateProviderTombstone,assertProviderAttemptTransition,type CompoundProviderAttempt,type ProviderAttemptTombstoneBinding} from './compound-provider-attempt.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
import { validateDirectOperationRecord, assertDirectOperationTransition, type DirectOperationRecord } from './compound-direct-operation.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {validateCompoundTreeBudget,mergeCompoundTreeBudgets,type CompoundTreeBudget} from './compound-tree-budget.js';

export const COMPOUND_LIMITS = Object.freeze({ operations: 256, tombstones: 4096, recordBytes: 32768, tombstoneBytes: 1024, indexBytes: 1024 * 1024, bytes: 16 * 1024 * 1024 });
export interface CompoundDispatchIdentity { sessionIdentity: string; hostProviderInvocationId: string; originalToolUseId: string }
export type CompoundStage = 'prepared' | 'edit_started' | 'edit_committed' | 'validation_started' | 'settled' | 'outcome_unknown';
export type CompoundStepStatus = 'not_started' | 'pending' | 'denied' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export interface CompoundOperationInput { dispatch: CompoundDispatchIdentity; inputHash: string; toolName: 'edit' | 'write'; ownerId: string; requestSource: 'user' | 'agent' | 'scheduler'; scopeId: string; permissionGeneration: number }
export interface CompoundOperationRecord extends CompoundOperationInput {
  id: string; editInvocationId: string; validationInvocationId: string; finalInputHash: string | null;
  stage: CompoundStage; editStatus: CompoundStepStatus; validation: { status: CompoundStepStatus; exitCode: number | null };
  file: { path: string; beforeHash: string | null; afterHash: string } | null;
  physicalExecution?: QuiescenceExpectation;
  reservation: { recordBytes: number; tombstoneBytes: number; tombstoneSlot: 1 };
}
export interface CompoundOperationTombstone { id: string; dispatch: CompoundDispatchIdentity; inputHash: string; terminalKind: 'settled'; providerAttempt?:ProviderAttemptTombstoneBinding }
export interface CompoundOperationLedger { version: 1; generation: number; operations: CompoundOperationRecord[]; directOperations?: DirectOperationRecord[]; providerAttempts?:CompoundProviderAttempt[]; treeBudget?:CompoundTreeBudget; managedTurns?:ManagedTurnLedger; tombstones: CompoundOperationTombstone[] }
const stages: CompoundStage[] = ['prepared','edit_started','edit_committed','validation_started','settled','outcome_unknown'];
const statuses: CompoundStepStatus[] = ['not_started','pending','denied','succeeded','failed','cancelled','unknown'];
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function invalid(): never { throw Error('compound_ledger_invalid'); }
function exact(v: unknown, keys: string[]): asserts v is Record<string,unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype,null].includes(Object.getPrototypeOf(v))
    || Object.keys(v).length !== keys.length || keys.some(k=>!Object.hasOwn(v,k)) || Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!('value'in d))) invalid();
}
function validateDispatch(value: unknown): asserts value is CompoundDispatchIdentity {
  exact(value,['sessionIdentity','hostProviderInvocationId','originalToolUseId']);if(!Object.values(value).every(id))invalid();
}
function dispatchKey(dispatch: CompoundDispatchIdentity): string { return JSON.stringify([dispatch.sessionIdentity,dispatch.hostProviderInvocationId,dispatch.originalToolUseId]); }
function validateInput(value: CompoundOperationInput): void {
  validateDispatch(value.dispatch);if(!hash(value.inputHash)||!['edit','write'].includes(value.toolName)||!id(value.ownerId)||!['user','agent','scheduler'].includes(value.requestSource)||!id(value.scopeId)||!integer(value.permissionGeneration))invalid();
}
const recordKeys=['dispatch','inputHash','toolName','ownerId','requestSource','scopeId','permissionGeneration','id','editInvocationId','validationInvocationId','finalInputHash','stage','editStatus','validation','file','reservation'];
function validateRecord(value: unknown): asserts value is CompoundOperationRecord {
  exact(value,[...recordKeys,...(value&&typeof value==='object'&&Object.hasOwn(value,'physicalExecution')?['physicalExecution']:[])]);const r=value as unknown as CompoundOperationRecord;validateInput(r);
  if(!id(r.id)||!id(r.editInvocationId)||!id(r.validationInvocationId)||r.editInvocationId===r.validationInvocationId||!stages.includes(r.stage)||!statuses.includes(r.editStatus)||(r.finalInputHash!==null&&!hash(r.finalInputHash)))invalid();
  exact(r.validation,['status','exitCode']);if(!statuses.includes(r.validation.status)||!(r.validation.exitCode===null||Number.isSafeInteger(r.validation.exitCode)))invalid();
  exact(r.reservation,['recordBytes','tombstoneBytes','tombstoneSlot']);if(r.reservation.recordBytes!==COMPOUND_LIMITS.recordBytes||r.reservation.tombstoneBytes!==COMPOUND_LIMITS.tombstoneBytes||r.reservation.tombstoneSlot!==1)invalid();
  if(r.file!==null){exact(r.file,['path','beforeHash','afterHash']);if(typeof r.file.path!=='string'||!r.file.path||Buffer.byteLength(r.file.path)>4096||(r.file.beforeHash!==null&&!hash(r.file.beforeHash))||!hash(r.file.afterHash))invalid();}
  if(r.stage==='prepared'&&(r.editStatus!=='not_started'||!['not_started','pending','denied'].includes(r.validation.status)))invalid();
  if(r.stage==='edit_started'&&(r.editStatus!=='pending'||r.finalInputHash===null))invalid();
  if(['edit_committed','validation_started'].includes(r.stage)&&(r.editStatus!=='succeeded'||!r.file||r.finalInputHash===null))invalid();
  if(r.physicalExecution){
    exact(r.physicalExecution,['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity','scopeDigest']);
    if(!Object.values(r.physicalExecution).every(id)||!hash(r.physicalExecution.scopeDigest)||r.physicalExecution.sessionIdentity!==r.dispatch.sessionIdentity||r.physicalExecution.compoundOperationId!==r.id||r.physicalExecution.validationInvocationId!==r.validationInvocationId)invalid();
    if(!['validation_started','settled','outcome_unknown'].includes(r.stage))invalid();
  }else if(Object.hasOwn(r,'physicalExecution'))invalid();
  if(r.stage==='validation_started'&&(r.validation.status!=='pending'||!r.physicalExecution))invalid();
  if(['succeeded','failed','unknown'].includes(r.validation.status)&&!r.physicalExecution)invalid();
  if(r.stage==='edit_started'&&r.validation.status!=='not_started')invalid();
  if(r.stage==='settled'){
    if(!['denied','succeeded','failed','cancelled'].includes(r.editStatus)||['pending','unknown'].includes(r.validation.status))invalid();
    if(r.editStatus==='succeeded'&&(!r.file||!r.finalInputHash))invalid();
    if(r.editStatus!=='succeeded'&&r.validation.status!=='not_started')invalid();
  }
  if(r.stage==='outcome_unknown'&&!((r.editStatus==='unknown'&&r.validation.status==='not_started')||(r.editStatus==='succeeded'&&r.validation.status==='unknown'&&r.file&&r.finalInputHash)))invalid();
  if(r.validation.status==='succeeded'&&r.validation.exitCode!==0)invalid();
  if(Buffer.byteLength(JSON.stringify(r))>COMPOUND_LIMITS.recordBytes)throw Error('compound_capacity');
}
export function createCompoundOperationLedger(): CompoundOperationLedger {return {version:1,generation:0,operations:[],tombstones:[]};}
export function validateCompoundOperationLedger(value: unknown): CompoundOperationLedger {
  exact(value,['version','generation','operations','tombstones', ...(value && typeof value === 'object' && Object.hasOwn(value,'directOperations') ? ['directOperations'] : []), ...(value && typeof value === 'object' && Object.hasOwn(value,'providerAttempts') ? ['providerAttempts'] : []), ...(value && typeof value === 'object' && Object.hasOwn(value,'treeBudget') ? ['treeBudget'] : []), ...(value && typeof value === 'object' && Object.hasOwn(value,'managedTurns') ? ['managedTurns'] : [])]);
  if(value.version!==1||!integer(value.generation)||!Array.isArray(value.operations)||!Array.isArray(value.tombstones))invalid();
  if (Object.hasOwn(value,'directOperations') && !Array.isArray(value.directOperations)) invalid();
  if (Object.hasOwn(value,'providerAttempts') && !Array.isArray(value.providerAttempts)) invalid();
  if (Object.hasOwn(value,'treeBudget')) validateCompoundTreeBudget(value.treeBudget);
  if (Object.hasOwn(value,'managedTurns')) validateManagedTurnLedger(value.managedTurns);
  const ledger=value as unknown as CompoundOperationLedger;const direct=ledger.directOperations??[],providers=ledger.providerAttempts??[];const keys=new Set<string>(),ids=new Set<string>();
  for(const r of ledger.operations)validateRecord(r);
  for(const r of direct)validateDirectOperationRecord(r);
  for(const r of providers)validateProviderAttempt(r);
  for(const t of ledger.tombstones){exact(t,['id','dispatch','inputHash','terminalKind',...(Object.hasOwn(t,'providerAttempt')?['providerAttempt']:[])]);if(Object.hasOwn(t,'providerAttempt'))validateProviderTombstone(t);validateDispatch(t.dispatch);if(!id(t.id)||!hash(t.inputHash)||t.terminalKind!=='settled')invalid();if(Buffer.byteLength(JSON.stringify(t))>COMPOUND_LIMITS.tombstoneBytes)throw Error('compound_capacity');}
  for(const r of [...ledger.operations,...direct,...providers,...ledger.tombstones]){const key=dispatchKey(r.dispatch);if(keys.has(key)||ids.has(r.id))invalid();keys.add(key);ids.add(r.id);}
  const turns=ledger.managedTurns?.records.length??0;
  const reserved=COMPOUND_LIMITS.indexBytes+(ledger.operations.length+direct.length+providers.length+turns)*(COMPOUND_LIMITS.recordBytes+COMPOUND_LIMITS.tombstoneBytes)+ledger.tombstones.length*COMPOUND_LIMITS.tombstoneBytes;
  if(ledger.operations.length+direct.length+providers.length+turns>COMPOUND_LIMITS.operations||ledger.operations.length+direct.length+providers.length+turns+ledger.tombstones.length>COMPOUND_LIMITS.tombstones||reserved>COMPOUND_LIMITS.bytes||Buffer.byteLength(JSON.stringify(ledger))>COMPOUND_LIMITS.bytes)throw Error('compound_capacity');
  return structuredClone(ledger);
}
export function createOrGetCompoundOperation(value: CompoundOperationLedger, input: CompoundOperationInput) {
  const ledger=validateCompoundOperationLedger(value);validateInput(input);
  if(ledger.directOperations?.some(r=>dispatchKey(r.dispatch)===dispatchKey(input.dispatch)))throw Error('dispatch_identity_conflict');
  const existing=[...ledger.operations,...ledger.tombstones].find(r=>dispatchKey(r.dispatch)===dispatchKey(input.dispatch));
  if(existing){if(existing.inputHash!==input.inputHash)throw Error('dispatch_identity_conflict');return {ledger,operation:structuredClone(existing),created:false};}
  const operationId=randomUUID();const operation:CompoundOperationRecord={...structuredClone(input),id:operationId,editInvocationId:`${operationId}:edit`,validationInvocationId:`${operationId}:validation`,finalInputHash:null,stage:'prepared',editStatus:'not_started',validation:{status:'not_started',exitCode:null},file:null,reservation:{recordBytes:32768,tombstoneBytes:1024,tombstoneSlot:1}};
  ledger.operations.push(operation);ledger.generation++;return {ledger:validateCompoundOperationLedger(ledger),operation:structuredClone(operation),created:true};
}
export interface CompoundAdvance { stage: CompoundStage; physicalExecution?: QuiescenceExpectation; finalInputHash?: string; editStatus?: CompoundStepStatus; validation?: {status:CompoundStepStatus;exitCode:number|null}; file?: NonNullable<CompoundOperationRecord['file']> }
function permitted(previous: CompoundStage, next: CompoundStage): boolean {
  return ({prepared:['prepared','edit_started','settled'],edit_started:['edit_committed','outcome_unknown','settled'],edit_committed:['edit_committed','validation_started','settled'],validation_started:['settled','outcome_unknown'],settled:[],outcome_unknown:[]} as Record<CompoundStage,CompoundStage[]>)[previous].includes(next);
}
function assertTransition(previous: CompoundOperationRecord, next: CompoundOperationRecord): void {
  if (!permitted(previous.stage, next.stage)) throw Error('compound_transition_invalid');
  if(previous.physicalExecution&&!isDeepStrictEqual(previous.physicalExecution,next.physicalExecution))throw Error('compound_physical_identity_changed');
  if(!previous.physicalExecution&&next.physicalExecution&&next.stage!=='validation_started')throw Error('compound_transition_invalid');
  if (next.stage === 'settled') {
    if (['prepared','edit_started'].includes(previous.stage) && (next.editStatus === 'succeeded' || next.validation.status !== 'not_started')) throw Error('compound_transition_invalid');
    if (previous.stage === 'edit_committed' && (next.validation.status === 'succeeded' || next.validation.exitCode !== null)) throw Error('compound_transition_invalid');
  }
}
export function advanceCompoundOperation(value: CompoundOperationLedger, operationId: string, change: CompoundAdvance): CompoundOperationLedger {
  const ledger=validateCompoundOperationLedger(value),r=ledger.operations.find(r=>r.id===operationId);if(!r||!permitted(r.stage,change.stage))throw Error('compound_transition_invalid');
  if(r.finalInputHash&&change.finalInputHash&&r.finalInputHash!==change.finalInputHash)throw Error('compound_input_changed');
  const previous=structuredClone(r);const before=r.stage;r.stage=change.stage;
  if(change.finalInputHash!==undefined)r.finalInputHash=change.finalInputHash;
  if(change.physicalExecution!==undefined)r.physicalExecution=structuredClone(change.physicalExecution);
  if(change.file!==undefined)r.file=structuredClone(change.file);
  if(change.editStatus!==undefined)r.editStatus=change.editStatus;
  if(change.validation!==undefined)r.validation=structuredClone(change.validation);
  if(change.stage==='edit_started')r.editStatus='pending';
  if(change.stage==='edit_committed')r.editStatus='succeeded';
  if(change.stage==='validation_started')r.validation={status:'pending',exitCode:null};
  if(change.stage==='outcome_unknown'){if(before==='edit_started')r.editStatus='unknown';else r.validation={status:'unknown',exitCode:null};}
  if(change.stage==='settled'&&(['pending','unknown'].includes(r.editStatus)||['pending','unknown'].includes(r.validation.status)))throw Error('compound_transition_invalid');
  assertTransition(previous,r);ledger.generation++;return validateCompoundOperationLedger(ledger);
}
/** Pure journal transform; the host service must authorize user cleanup. */
export function retireCompoundOperation(value: CompoundOperationLedger, operationId: string): CompoundOperationLedger {
 const ledger=validateCompoundOperationLedger(value);const index=ledger.operations.findIndex(r=>r.id===operationId),r=ledger.operations[index];if(!r||r.stage!=='settled')throw Error('compound_not_settled');
 ledger.tombstones.push({id:r.id,dispatch:r.dispatch,inputHash:r.inputHash,terminalKind:'settled'});ledger.operations.splice(index,1);ledger.generation++;return validateCompoundOperationLedger(ledger);
}
export function mergeCompoundOperationLedgers(previous: CompoundOperationLedger|undefined,next:CompoundOperationLedger|undefined):CompoundOperationLedger|undefined{
 if(!previous)return next===undefined?undefined:validateCompoundOperationLedger(next);
 const old=validateCompoundOperationLedger(previous);if(next===undefined)return old;const current=validateCompoundOperationLedger(next);
 if(current.generation<old.generation||(current.generation===old.generation&&!isDeepStrictEqual(old,current)))throw Error('compound_journal_regression');
 mergeCompoundTreeBudgets(old.treeBudget,current.treeBudget);
 mergeManagedTurnLedgers(old.managedTurns,current.managedTurns);
 for(const tombstone of old.tombstones)if(!current.tombstones.some(t=>isDeepStrictEqual(t,tombstone)))throw Error('compound_journal_regression');
 for(const record of old.providerAttempts??[]){const updated=current.providerAttempts?.find(r=>r.id===record.id);
  if(!updated){if(!['drained','cancelled_before_send'].includes(record.transportState)||!current.tombstones.some(t=>t.id===record.id&&t.inputHash===record.inputHash&&isDeepStrictEqual(t.dispatch,record.dispatch)&&t.providerAttempt?.requestHash===record.requestHash&&t.providerAttempt.transportState===record.transportState))throw Error('compound_journal_regression');continue;}
  if(!isDeepStrictEqual(record,updated))assertProviderAttemptTransition(record,updated);
 }
 for(const record of old.directOperations??[]){const updated=current.directOperations?.find(r=>r.id===record.id);
  if(!updated){if(record.stage!=='settled'||!current.tombstones.some(t=>t.id===record.id&&t.inputHash===record.inputHash&&isDeepStrictEqual(t.dispatch,record.dispatch)))throw Error('compound_journal_regression');continue;}
  if(!isDeepStrictEqual(record,updated))assertDirectOperationTransition(record,updated);
 }
 for(const record of old.operations){const updated=current.operations.find(r=>r.id===record.id);if(!updated){if(record.stage!=='settled'||!current.tombstones.some(t=>t.id===record.id&&t.inputHash===record.inputHash&&isDeepStrictEqual(t.dispatch,record.dispatch)))throw Error('compound_journal_regression');continue;}
  for(const key of ['dispatch','inputHash','toolName','ownerId','requestSource','scopeId','permissionGeneration','editInvocationId','validationInvocationId','reservation'] as const)if(!isDeepStrictEqual(record[key],updated[key]))throw Error('compound_journal_regression');
  if(!isDeepStrictEqual(record,updated))assertTransition(record,updated);
  if(record.finalInputHash&&record.finalInputHash!==updated.finalInputHash)throw Error('compound_journal_regression');
  if(record.file&&!isDeepStrictEqual(record.file,updated.file))throw Error('compound_journal_regression');
 }
 return current;
}
