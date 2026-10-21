import {getObservationSessionOwnerHostBinding,type ObservationSessionOwner} from './observation-session-owner.js';
import type {AgentSessionState} from '../../ai/runtime/session.js';
import type {SessionStore} from '../../ai/runtime/session-store/store.js';
import {assertSessionExecutionLease,type SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
/** Host-only identity of a durable P2 managed-child admission. Serialized facts
 * do not grant execution, prove drain, or authorize a resource-release receipt. */
declare const managedAdmissionBrand: unique symbol;
export interface ManagedCompoundAdmission { readonly [managedAdmissionBrand]: true }
export interface ManagedCompoundAdmissionBinding {
 readonly admissionId:string;
 readonly admissionGeneration:number;
 readonly childSessionId:string;
 readonly operationId:string;
 readonly parentOperationId:string;
 readonly parentSessionId:string;
 readonly groupId:string;
 readonly agentId:string;
 readonly rootEpoch:number;
}
const bindings=new WeakMap<object,Readonly<ManagedCompoundAdmissionBinding>>();
/** Serialized or copied preparation facts cannot obtain this binding. */
export function getManagedCompoundAdmissionBinding(cap:ManagedCompoundAdmission):Readonly<ManagedCompoundAdmissionBinding> {
 const binding=bindings.get(cap);
 if(!binding)throw Error('compound_managed_admission_invalid');
 return binding;
}

const issued=new WeakMap<ObservationSessionOwner,Set<string>>();
/** Internal coordinator factory: captures only a real committed parent admission
 * under its original live owner/lease. This identity receipt does not authorize
 * a tool, activate an actor, prove drain, or replace main preparation approval. */
export async function captureManagedCompoundAdmission(input:{owner:ObservationSessionOwner;session:AgentSessionState;store:SessionStore;root:string;lease:SessionExecutionLease;parentOperationId:string}):Promise<ManagedCompoundAdmission>{
 const host=getObservationSessionOwnerHostBinding(input.owner),sessionId=input.session.exportSnapshot().sessionId;
 const check=()=>{if(host.session!==input.session)throw Error('compound_managed_owner_mismatch');input.owner.assertSession(input.session);assertSessionExecutionLease(input.lease,{root:input.root,sessionIdentity:sessionId});};
 check();const snapshot=await input.store.load(sessionId);check();
 const record=snapshot?.compoundOperations?.directOperations?.find(row=>row.id===input.parentOperationId),delegation=record?.delegation,managed=delegation?.managed;
 if(!record||record.stage!=='started'||record.dispatch.sessionIdentity!==sessionId||!delegation||delegation.state!=='live'||delegation.childPhase!=='not_started'||!managed||managed.nativeInvocationId!==record.id||managed.ackReady||managed.ackPublished||managed.resourcesReleasedDigest!==null)throw Error('compound_managed_admission_not_prepared');
 let seen=issued.get(input.owner);if(!seen)issued.set(input.owner,seen=new Set());if(seen.has(record.id))throw Error('compound_managed_admission_already_issued');
 const cap=Object.freeze({}) as ManagedCompoundAdmission;
 const binding=Object.freeze({admissionId:delegation.admissionId,admissionGeneration:delegation.generation,childSessionId:delegation.childSessionIdentity,parentOperationId:record.id,parentSessionId:sessionId,operationId:managed.operationId,groupId:managed.groupId,agentId:managed.agentId,rootEpoch:managed.rootEpoch});
 check();seen.add(record.id);bindings.set(cap,binding);return cap;
}
