import {validateCompoundDelegationRecord,assertCompoundDelegationTransition,type CompoundDelegationRecord} from './compound-delegation-record.js';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {COMPOUND_LIMITS,validateCompoundOperationLedger,type CompoundOperationLedger,type CompoundOperationInput,type CompoundOperationTombstone} from './compound-operation.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
export interface DirectOperationInput extends Omit<CompoundOperationInput,'toolName'> {toolName:string}
export interface DirectOperationRecord extends DirectOperationInput {
 id:string; finalInputHash:string|null; stage:'prepared'|'started'|'settled'|'outcome_unknown';
 outcome:null|'denied'|'cancelled'|'invalid'|'completed'|'failed'|'unknown';
 quiescence:null|'synchronous_file'|'isolated_tree'|'delegated_tree'|'metadata_commit'; physicalExecution:QuiescenceExpectation|null;
 /** A main database commit is not evidence that a child or process stopped. */
 metadataCommit?:{adapter:'desktop-service-metadata-v1';kind:'send'|'followup';operationId:string;requestHash:string;resultHash:string;groupId:string;actorId:string;epoch:number};
 delegation?:CompoundDelegationRecord;
 fileFacts?:{adapter:'synchronous-native-file-v1';path:string;beforeHash:string|null;afterHash:string};
 reservation:{recordBytes:number;tombstoneBytes:number;tombstoneSlot:1};
}
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function invalid():never{throw Error('compound_direct_invalid');}
function exact(v:unknown,keys:string[]):asserts v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!('value'in d)))invalid();
}
const key=(r:{dispatch:DirectOperationInput['dispatch']})=>JSON.stringify([r.dispatch.sessionIdentity,r.dispatch.hostProviderInvocationId,r.dispatch.originalToolUseId]);
function validateInput(r:DirectOperationInput):void{
 exact(r.dispatch,['sessionIdentity','hostProviderInvocationId','originalToolUseId']);
 if(!Object.values(r.dispatch).every(identifier)||!identifier(r.toolName)||!identifier(r.ownerId)||!identifier(r.scopeId)||!hash(r.inputHash)||!['user','agent','scheduler'].includes(r.requestSource)||!Number.isSafeInteger(r.permissionGeneration)||r.permissionGeneration<0)invalid();
}
export function validateDirectOperationRecord(v:unknown):asserts v is DirectOperationRecord{
 exact(v,['dispatch','inputHash','toolName','ownerId','requestSource','scopeId','permissionGeneration','id','finalInputHash','stage','outcome','quiescence','physicalExecution','reservation',...(v&&typeof v==='object'&&Object.hasOwn(v,'fileFacts')?['fileFacts']:[]),...(v&&typeof v==='object'&&Object.hasOwn(v,'delegation')?['delegation']:[]),...(v&&typeof v==='object'&&Object.hasOwn(v,'metadataCommit')?['metadataCommit']:[])]);const r=v as unknown as DirectOperationRecord;validateInput(r);
 if(!identifier(r.id)||(r.finalInputHash!==null&&!hash(r.finalInputHash))||!['prepared','started','settled','outcome_unknown'].includes(r.stage)||![null,'denied','cancelled','invalid','completed','failed','unknown'].includes(r.outcome)||![null,'synchronous_file','isolated_tree','delegated_tree','metadata_commit'].includes(r.quiescence))invalid();
 exact(r.reservation,['recordBytes','tombstoneBytes','tombstoneSlot']);if(r.reservation.recordBytes!==COMPOUND_LIMITS.recordBytes||r.reservation.tombstoneBytes!==COMPOUND_LIMITS.tombstoneBytes||r.reservation.tombstoneSlot!==1)invalid();
 if(r.physicalExecution!==null){exact(r.physicalExecution,['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity','scopeDigest']);if(!Object.values(r.physicalExecution).every(identifier)||r.physicalExecution.sessionIdentity!==r.dispatch.sessionIdentity||r.physicalExecution.compoundOperationId!==r.id||!hash(r.physicalExecution.scopeDigest))invalid();}
 if(Object.hasOwn(r,'fileFacts')){
  exact(r.fileFacts,['adapter','path','beforeHash','afterHash']);
  if(r.fileFacts.adapter!=='synchronous-native-file-v1'||!['write','edit'].includes(r.toolName)||r.stage==='prepared'||typeof r.fileFacts.path!=='string'||!r.fileFacts.path||Buffer.byteLength(r.fileFacts.path)>4096||(r.fileFacts.beforeHash!==null&&!hash(r.fileFacts.beforeHash))||!hash(r.fileFacts.afterHash))invalid();
 }
 if(Object.hasOwn(r,'delegation')){
  validateCompoundDelegationRecord(r.delegation);
  if(r.stage==='prepared'||r.fileFacts||r.physicalExecution||r.delegation.childSessionIdentity===r.dispatch.sessionIdentity)invalid();
 }
 if(Object.hasOwn(r,'metadataCommit')){
  const m=r.metadataCommit;exact(m,['adapter','kind','operationId','requestHash','resultHash','groupId','actorId','epoch']);
  if(m.adapter!=='desktop-service-metadata-v1'||!['send','followup'].includes(m.kind)||r.toolName!==(m.kind==='send'?'send_message':'followup_task')||r.stage!=='settled'||r.outcome!=='completed'||r.quiescence!=='metadata_commit'||r.physicalExecution||r.fileFacts||r.delegation||![m.operationId,m.groupId,m.actorId].every(identifier)||![m.requestHash,m.resultHash].every(hash)||!Number.isSafeInteger(m.epoch)||m.epoch<0)invalid();
 }
 if(r.quiescence==='metadata_commit'&&!r.metadataCommit)invalid();
 if(r.stage==='prepared'&&(r.finalInputHash!==null||r.outcome!==null||r.quiescence!==null||r.physicalExecution!==null))invalid();
 if(r.stage==='started'&&(!r.finalInputHash||r.outcome!==null||r.quiescence!==null))invalid();
 if(r.stage==='outcome_unknown'&&(!r.finalInputHash||r.outcome!=='unknown'||r.quiescence!==null))invalid();
 if(r.stage==='settled'){
  if(!['denied','cancelled','invalid','completed','failed'].includes(r.outcome!))invalid();
  if(['completed','failed'].includes(r.outcome!)&&(!r.finalInputHash||r.quiescence===null))invalid();
  if(r.quiescence==='synchronous_file'&&!['write','edit'].includes(r.toolName))invalid();
  if(r.quiescence==='isolated_tree'&&!r.physicalExecution)invalid();
  if(r.quiescence==='delegated_tree'&&(!r.delegation||r.delegation.state!=='closed'||r.delegation.childPhase!=='drained'))invalid();
  if(r.delegation&&r.quiescence!=='delegated_tree')invalid();
 }
 if(Buffer.byteLength(JSON.stringify(r))>COMPOUND_LIMITS.recordBytes)throw Error('compound_capacity');
}
export function assertDirectOperationTransition(previous:DirectOperationRecord,next:DirectOperationRecord):void{
 const edges={prepared:['started','settled'],started:['settled','outcome_unknown'],settled:[],outcome_unknown:[]};
 const sameDelegationStage=previous.stage===next.stage&&['started','outcome_unknown'].includes(previous.stage)&&!!previous.delegation&&!!next.delegation;
 if(!sameDelegationStage&&!(edges[previous.stage] as string[]).includes(next.stage))throw Error('compound_direct_transition');
 if(sameDelegationStage&&!isDeepStrictEqual({...previous,delegation:next.delegation},next))throw Error('compound_direct_transition');
 if(previous.delegation){if(!next.delegation)invalid();if(!isDeepStrictEqual(previous.delegation,next.delegation))assertCompoundDelegationTransition(previous.delegation,next.delegation);}
 else if(next.delegation&&(next.stage!=='started'||next.delegation.generation!==1||next.delegation.state!=='live'||next.delegation.childPhase!=='not_started'))invalid();
 for(const field of ['id','dispatch','inputHash','toolName','ownerId','scopeId','requestSource','permissionGeneration','reservation'] as const)if(!isDeepStrictEqual(previous[field],next[field]))throw Error('compound_journal_regression');
 if(previous.fileFacts&&!isDeepStrictEqual(previous.fileFacts,next.fileFacts))throw Error('compound_journal_regression');
 if(previous.metadataCommit&&!isDeepStrictEqual(previous.metadataCommit,next.metadataCommit))throw Error('compound_journal_regression');
 if(!previous.metadataCommit&&next.metadataCommit&&(previous.stage!=='started'||next.stage!=='settled'))throw Error('compound_direct_transition');
 if(!previous.fileFacts&&next.fileFacts&&next.stage!=='started')throw Error('compound_direct_transition');
 if(previous.finalInputHash!==null&&previous.finalInputHash!==next.finalInputHash)throw Error('compound_journal_regression');
 if(previous.physicalExecution&&!isDeepStrictEqual(previous.physicalExecution,next.physicalExecution))throw Error('compound_journal_regression');
 if(previous.stage==='prepared'&&next.stage==='settled'&&(!['denied','cancelled','invalid'].includes(next.outcome!)||next.quiescence!==null||next.physicalExecution!==null||next.finalInputHash!==null))throw Error('compound_direct_transition');
 if(previous.stage==='started'&&next.stage==='settled'&&(next.quiescence===null||(next.quiescence==='isolated_tree'&&!previous.physicalExecution)))throw Error('compound_direct_transition');
}
/** Pure facts transform. Only the host execution owner may authenticate terminal
 * receipts and commit this ledger through an active store CAS lease. */
export function createOrGetDirectOperation(value:CompoundOperationLedger,input:DirectOperationInput):{ledger:CompoundOperationLedger;operation:DirectOperationRecord|CompoundOperationTombstone;created:boolean}{
 const ledger=validateCompoundOperationLedger(value);validateInput(input);
 if(ledger.operations.some(r=>key(r)===key(input)))throw Error('dispatch_identity_conflict');
 const existing=[...(ledger.directOperations??[]),...ledger.tombstones].find(r=>key(r)===key(input));
 if(existing){if(existing.inputHash!==input.inputHash||('toolName'in existing&&existing.toolName!==input.toolName))throw Error('dispatch_identity_conflict');return{ledger,operation:structuredClone(existing),created:false};}
 const record:DirectOperationRecord={...structuredClone(input),id:randomUUID(),finalInputHash:null,stage:'prepared',outcome:null,quiescence:null,physicalExecution:null,reservation:{recordBytes:COMPOUND_LIMITS.recordBytes,tombstoneBytes:COMPOUND_LIMITS.tombstoneBytes,tombstoneSlot:1}};
 ledger.directOperations??=[];ledger.directOperations.push(record);ledger.generation++;return{ledger:validateCompoundOperationLedger(ledger),operation:structuredClone(record),created:true};
}
export interface DirectOperationAdvance {metadataCommit?:DirectOperationRecord['metadataCommit'];delegation?:CompoundDelegationRecord;fileFacts?:DirectOperationRecord['fileFacts'];stage:DirectOperationRecord['stage'];finalInputHash?:string;outcome?:DirectOperationRecord['outcome'];quiescence?:DirectOperationRecord['quiescence'];physicalExecution?:QuiescenceExpectation}
export function advanceDirectOperation(value:CompoundOperationLedger,id:string,change:DirectOperationAdvance):CompoundOperationLedger{
 const ledger=validateCompoundOperationLedger(value),record=ledger.directOperations?.find(r=>r.id===id);if(!record)invalid();
 const previous=structuredClone(record);Object.assign(record,structuredClone(change));validateDirectOperationRecord(record);assertDirectOperationTransition(previous,record);ledger.generation++;return validateCompoundOperationLedger(ledger);
}
export function retireDirectOperation(value:CompoundOperationLedger,id:string):CompoundOperationLedger{
 const ledger=validateCompoundOperationLedger(value),index=ledger.directOperations?.findIndex(r=>r.id===id)??-1,record=ledger.directOperations?.[index];
 if(!record||record.stage!=='settled')throw Error('compound_not_settled');
 // Managed ACKs remain fully charged until explicit whole-session deletion.
 // The generic tombstone cannot retain their exact publication/resource facts.
 if(record.delegation?.managed)throw Error('compound_managed_ack_retained');
 ledger.tombstones.push({id:record.id,dispatch:record.dispatch,inputHash:record.inputHash,terminalKind:'settled'});ledger.directOperations!.splice(index,1);ledger.generation++;return validateCompoundOperationLedger(ledger);
}
