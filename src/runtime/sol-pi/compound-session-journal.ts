import {reserveProviderAttempt,settleProviderAttempt,retireProviderAttempt,type CompoundProviderAttempt,type CompoundProviderAttemptInput,type ProviderTransportState} from './compound-provider-attempt.js';
import {createOrGetDirectOperation,advanceDirectOperation,retireDirectOperation,type DirectOperationAdvance,type DirectOperationRecord} from './compound-direct-operation.js';
import { isDeepStrictEqual } from 'node:util';
import {reserveCompoundTreeAllocation,type CompoundTreeAllocationInput} from './compound-tree-budget.js';
import type { SessionStore, PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { assertSessionExecutionLease, type SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { advanceCompoundOperation, createCompoundOperationLedger, createOrGetCompoundOperation, retireCompoundOperation,
  validateCompoundOperationLedger, type CompoundAdvance, type CompoundOperationInput, type CompoundOperationLedger, type CompoundOperationRecord } from './compound-operation.js';

type Delivery = Pick<CompoundOperationInput, 'inputHash' | 'toolName' | 'permissionGeneration'> & {
  hostProviderInvocationId: string; originalToolUseId: string;
};
/** Host-bound journal adapter. It owns no second lock and never invokes tools or
 * approvals. Caller must hold the one shared execution lease across effects. */
export function createCompoundSessionJournal(options: {
  store: SessionStore; root: string; sessionIdentity: string; ownerId: string;
  scopeId: string; requestSource: 'user' | 'agent' | 'scheduler'; assertCurrent(): void;
  /** Fixed host allocator; no tool input supplies this port. Called only before
   * a new native record, while all required ancestor leases are already held. */
  reserveMutation?(identity:{dispatch:CompoundOperationInput['dispatch'];inputHash:string},lease:SessionExecutionLease):Promise<void>;
}) {
  const { store, root, sessionIdentity, ownerId, scopeId, requestSource, assertCurrent } = options;
  if (!store.compareAndSave) throw Error('compound_store_cas_required');
  const issuedProviderAttempts = new Map<string, CompoundProviderAttempt>();
  const issuedCommittedEdits = new Map<string, CompoundOperationRecord>();
  const unissuedProviderFailures=new WeakMap<object,{record:CompoundProviderAttempt;consuming:boolean}>();
  const unissuedProviderKeys=new Set<string>();
  const issuedPreparedCompound = new Map<string, CompoundOperationRecord>();
  const issuedPreparedDirect = new Map<string, DirectOperationRecord>();
  const check = (lease: SessionExecutionLease) => { assertCurrent(); assertSessionExecutionLease(lease, { root, sessionIdentity }); };
  async function current(lease: SessionExecutionLease): Promise<PersistedSessionSnapshot> {
    check(lease); const snapshot = await store.load(sessionIdentity); check(lease);
    if (!snapshot || snapshot.sessionId !== sessionIdentity || snapshot.storeRevision === undefined || snapshot.historyDigest === undefined) throw Error('compound_session_not_initialized');
    return snapshot;
  }
  async function commit(snapshot: PersistedSessionSnapshot, ledger: CompoundOperationLedger, lease: SessionExecutionLease, beforeCommit?:(candidate:PersistedSessionSnapshot)=>void): Promise<void> {
    check(lease);
    await store.compareAndSave!({ expectedStoreRevision: snapshot.storeRevision!, expectedHistoryDigest: snapshot.historyDigest!,
      nextSnapshot: { ...snapshot, compoundOperations: ledger }, lease, beforeCommit: () => {
        check(lease);
        const result:unknown=beforeCommit?.(structuredClone({...snapshot,compoundOperations:ledger}));
        if(result!==undefined){if(result&&(typeof result==='object'||typeof result==='function')&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});throw Error('compound_admission_guard_must_be_synchronous');}
        check(lease);
      } });
    check(lease);
  }
  return Object.freeze({
    async reserveTreeAllocation(input:CompoundTreeAllocationInput,lease:SessionExecutionLease){
      const captured=structuredClone(input),snapshot=await current(lease);
      const ledger=snapshot.compoundOperations??createCompoundOperationLedger();
      const result=reserveCompoundTreeAllocation(ledger.treeBudget,sessionIdentity,captured);
      if(result.created){ledger.treeBudget=result.budget;ledger.generation++;await commit(snapshot,validateCompoundOperationLedger(ledger),lease);}
      return{allocationId:result.allocationId,created:result.created};
    },
    async reserveProviderAttempt(input:CompoundProviderAttemptInput,lease:SessionExecutionLease,beforeCommit?:(candidate:PersistedSessionSnapshot)=>void){
      const captured=structuredClone(input),snapshot=await current(lease);
      const key=JSON.stringify([captured.logicalInvocationId,captured.attemptIndex]);
      if(unissuedProviderKeys.has(key))throw Error('compound_provider_unissued_pending');
      const result=reserveProviderAttempt(snapshot.compoundOperations??createCompoundOperationLedger(),sessionIdentity,captured);
      if(result.created){
        try{await commit(snapshot,result.ledger,lease,beforeCommit);}
        catch(cause){
          // No result (and therefore no send ticket) has escaped this method.
          // Permanently close this attempt to issuance before exposing failure.
          const failure=new Error(cause instanceof Error?cause.message:'compound_provider_reservation_failed',{cause});
          unissuedProviderKeys.add(key);
          unissuedProviderFailures.set(failure,{record:structuredClone(result.ledger.providerAttempts!.find(row=>row.id===result.reservationId)!),consuming:false});
          throw failure;
        }
        issuedProviderAttempts.set(result.reservationId,structuredClone(result.ledger.providerAttempts!.find(row=>row.id===result.reservationId)!));
      }
      return{reservationId:result.reservationId,created:result.created,bindingHash:result.bindingHash};
    },
    isUnissuedProviderAttemptFailure(error:unknown):boolean{return !!error&&typeof error==='object'&&unissuedProviderFailures.has(error);},
    async cancelUnissuedProviderAttempt(error:unknown,lease:SessionExecutionLease):Promise<void>{
      const fact=error&&typeof error==='object'?unissuedProviderFailures.get(error):undefined;
      if(!fact||fact.consuming)throw Error('compound_provider_unissued_issuer_mismatch');
      fact.consuming=true;
      const checkFacts=()=>assertSessionExecutionLease(lease,{root,sessionIdentity});
      try{
        checkFacts();const snapshot=await store.load(sessionIdentity);checkFacts();
        if(!snapshot||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('compound_session_not_initialized');
        let ledger=validateCompoundOperationLedger(snapshot.compoundOperations??createCompoundOperationLedger());
        const actual=ledger.providerAttempts?.find(row=>row.id===fact.record.id);
        if(actual){if(!['reserved','cancelled_before_send'].includes(actual.transportState)||!isDeepStrictEqual({...actual,transportState:'reserved'},fact.record))throw Error('compound_provider_unissued_issuer_mismatch');}
        else{
          const {issuerIncarnation,logicalInvocationId,attemptIndex,serializedBodySha256,destination,closureDigest,parentAdmission,rootAdmission}=fact.record;
          const candidate=reserveProviderAttempt(ledger,sessionIdentity,{issuerIncarnation,logicalInvocationId,attemptIndex,serializedBodySha256,destination,closureDigest,...(rootAdmission?{rootAdmission}:{parentAdmission})});
          if(!candidate.created)throw Error('compound_provider_unissued_issuer_mismatch');
          ledger=candidate.ledger;ledger.providerAttempts![ledger.providerAttempts!.length-1]=structuredClone(fact.record);
        }
        ledger=settleProviderAttempt(ledger,fact.record.id,'cancelled_before_send');
        await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:checkFacts});checkFacts();
        unissuedProviderFailures.delete(error as object);unissuedProviderKeys.delete(JSON.stringify([fact.record.logicalInvocationId,fact.record.attemptIndex]));
      }catch(cause){fact.consuming=false;throw cause;}
    },
    /** Factual finalization only. The issuing transport must authenticate actual
     * local drain or irrevocable cancellation before calling. Revocation stops
     * new work, but cannot prevent recording an already issued attempt's fate.
     * This instance-local port does not authorize restored JSON or new sends. */
    async settleIssuedProviderAttemptFacts(input:{reservationId:string;transportState:Exclude<ProviderTransportState,'reserved'>},lease:SessionExecutionLease){
      const captured=structuredClone(input),issued=issuedProviderAttempts.get(captured.reservationId);
      if(!issued)throw Error('compound_provider_issuer_mismatch');
      const checkFacts=()=>assertSessionExecutionLease(lease,{root,sessionIdentity});
      checkFacts();const snapshot=await store.load(sessionIdentity);checkFacts();
      if(!snapshot||snapshot.sessionId!==sessionIdentity||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('compound_session_not_initialized');
      const prior=snapshot.compoundOperations&&validateCompoundOperationLedger(snapshot.compoundOperations);
      const actual=prior?.providerAttempts?.find(row=>row.id===captured.reservationId);
      if(!actual||!isDeepStrictEqual({...actual,transportState:'reserved'},issued))throw Error('compound_provider_issuer_mismatch');
      const ledger=settleProviderAttempt(prior!,captured.reservationId,captured.transportState);
      await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,
        nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:checkFacts});
      checkFacts();issuedProviderAttempts.delete(captured.reservationId);
    },
    async settleProviderAttempt(input:{reservationId:string;transportState:Exclude<ProviderTransportState,'reserved'>},lease:SessionExecutionLease){
      const captured=structuredClone(input),snapshot=await current(lease);
      const ledger=settleProviderAttempt(snapshot.compoundOperations??createCompoundOperationLedger(),captured.reservationId,captured.transportState);
      await commit(snapshot,ledger,lease);
      issuedProviderAttempts.delete(captured.reservationId);
    },
    async retireProviderAttempt(reservationId:string,context:{requestSource:'user'|'agent'|'scheduler'},lease:SessionExecutionLease){
      if(context.requestSource!=='user')throw Error('compound_cleanup_user_required');
      const snapshot=await current(lease),ledger=retireProviderAttempt(snapshot.compoundOperations??createCompoundOperationLedger(),reservationId);
      await commit(snapshot,ledger,lease);
      issuedProviderAttempts.delete(reservationId);
    },
    async read(lease: SessionExecutionLease): Promise<CompoundOperationLedger> {
      const snapshot = await current(lease);
      return snapshot.compoundOperations ? validateCompoundOperationLedger(snapshot.compoundOperations) : createCompoundOperationLedger();
    },
    async createOrGet(input: Delivery, lease: SessionExecutionLease) {
      const captured = structuredClone(input);
      let snapshot = await current(lease);
      const parameters={
        dispatch: { sessionIdentity, hostProviderInvocationId: captured.hostProviderInvocationId, originalToolUseId: captured.originalToolUseId },
        inputHash: captured.inputHash, toolName: captured.toolName, permissionGeneration: captured.permissionGeneration,
        ownerId, requestSource, scopeId,
      };
      let result = createOrGetCompoundOperation(snapshot.compoundOperations ?? createCompoundOperationLedger(), parameters);
      if(result.created&&options.reserveMutation){
        await options.reserveMutation({dispatch:parameters.dispatch,inputHash:parameters.inputHash},lease);
        snapshot=await current(lease);
        result=createOrGetCompoundOperation(snapshot.compoundOperations??createCompoundOperationLedger(),parameters);
      }
      if (result.created) {await commit(snapshot, result.ledger, lease);issuedPreparedCompound.set(result.operation.id,structuredClone(result.operation as CompoundOperationRecord));}
      return { operation: structuredClone(result.operation), created: result.created };
    },
    async createOrGetDirect(input: Omit<Delivery,'toolName'> & {toolName:string}, lease: SessionExecutionLease) {
      const captured=structuredClone(input);let snapshot=await current(lease);
      const parameters={
        dispatch:{sessionIdentity,hostProviderInvocationId:captured.hostProviderInvocationId,originalToolUseId:captured.originalToolUseId},
        inputHash:captured.inputHash,toolName:captured.toolName,permissionGeneration:captured.permissionGeneration,ownerId,scopeId,requestSource,
      };
      let result=createOrGetDirectOperation(snapshot.compoundOperations??createCompoundOperationLedger(),parameters);
      if(result.created&&options.reserveMutation){
        await options.reserveMutation({dispatch:parameters.dispatch,inputHash:parameters.inputHash},lease);
        snapshot=await current(lease);
        result=createOrGetDirectOperation(snapshot.compoundOperations??createCompoundOperationLedger(),parameters);
      }
      if(result.created){
        await commit(snapshot,result.ledger,lease);
        issuedPreparedDirect.set(result.operation.id,structuredClone(result.operation as DirectOperationRecord));
      }
      return{operation:structuredClone(result.operation),created:result.created};
    },
    /** Original native preparation only; never a child-runtime/physical receipt.
     * Exact prepared row equality proves this issuer has not advanced effects. */
    async settleIssuedPreparedDirectFacts(input:{operationId:string;outcome:'cancelled'|'denied'|'invalid'},lease:SessionExecutionLease){
      const captured=structuredClone(input),issued=issuedPreparedDirect.get(captured.operationId);
      if(!issued||!['cancelled','denied','invalid'].includes(captured.outcome))throw Error('compound_prepared_issuer_mismatch');
      const checkFacts=()=>assertSessionExecutionLease(lease,{root,sessionIdentity});
      checkFacts();const snapshot=await store.load(sessionIdentity);checkFacts();
      if(!snapshot||snapshot.sessionId!==sessionIdentity||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('compound_session_not_initialized');
      const prior=snapshot.compoundOperations&&validateCompoundOperationLedger(snapshot.compoundOperations);
      const actual=prior?.directOperations?.find(row=>row.id===captured.operationId);
      if(!actual||actual.stage!=='prepared'||!isDeepStrictEqual(actual,issued))throw Error('compound_prepared_issuer_mismatch');
      const ledger=advanceDirectOperation(prior!,captured.operationId,{stage:'settled',outcome:captured.outcome});
      await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,
        nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:checkFacts});
      checkFacts();issuedPreparedDirect.delete(captured.operationId);
    },
    async settleIssuedPreparedCompoundFacts(input:{operationId:string;outcome:'cancelled'|'denied'|'failed'},lease:SessionExecutionLease){
      const captured=structuredClone(input),issued=issuedPreparedCompound.get(captured.operationId);
      if(!issued||!['cancelled','denied','failed'].includes(captured.outcome))throw Error('compound_prepared_issuer_mismatch');
      const checkFacts=()=>assertSessionExecutionLease(lease,{root,sessionIdentity});
      checkFacts();const snapshot=await store.load(sessionIdentity);checkFacts();
      if(!snapshot||snapshot.sessionId!==sessionIdentity||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('compound_session_not_initialized');
      const prior=snapshot.compoundOperations&&validateCompoundOperationLedger(snapshot.compoundOperations);
      const actual=prior?.operations.find(row=>row.id===captured.operationId);
      if(!actual||actual.stage!=='prepared'||!isDeepStrictEqual(actual,issued))throw Error('compound_prepared_issuer_mismatch');
      const ledger=advanceCompoundOperation(prior!,captured.operationId,{stage:'settled',editStatus:captured.outcome});
      await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,
        nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:checkFacts});
      checkFacts();issuedPreparedCompound.delete(captured.operationId);
    },
    /** A durable native edit is kept. Only its still-undispatched validation may
     * be closed by this original issuer after the execution grant is revoked. */
    async settleIssuedCommittedEditFacts(input:{operationId:string;validationStatus:'cancelled'|'denied'},lease:SessionExecutionLease){
      const captured=structuredClone(input),issued=issuedCommittedEdits.get(captured.operationId);
      if(!issued||!['cancelled','denied'].includes(captured.validationStatus))throw Error('compound_committed_edit_issuer_mismatch');
      const checkFacts=()=>assertSessionExecutionLease(lease,{root,sessionIdentity});
      checkFacts();const snapshot=await store.load(sessionIdentity);checkFacts();
      if(!snapshot||snapshot.sessionId!==sessionIdentity||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('compound_session_not_initialized');
      const prior=snapshot.compoundOperations&&validateCompoundOperationLedger(snapshot.compoundOperations);
      const actual=prior?.operations.find(row=>row.id===captured.operationId);
      if(!actual||actual.stage!=='edit_committed'||actual.physicalExecution||!isDeepStrictEqual(actual,issued))throw Error('compound_committed_edit_issuer_mismatch');
      const ledger=advanceCompoundOperation(prior!,captured.operationId,{stage:'settled',validation:{status:captured.validationStatus,exitCode:null}});
      await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,
        nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:checkFacts});
      checkFacts();issuedCommittedEdits.delete(captured.operationId);
    },
    async advanceDirect(operationId:string,change:DirectOperationAdvance,lease:SessionExecutionLease,beforeCommit?:()=>void){
      const captured=structuredClone(change),snapshot=await current(lease);
      const ledger=advanceDirectOperation(snapshot.compoundOperations??createCompoundOperationLedger(),operationId,captured);
      await commit(snapshot,ledger,lease,beforeCommit);issuedPreparedDirect.delete(operationId);return structuredClone(ledger.directOperations!.find(r=>r.id===operationId)!);
    },
    async advance(operationId: string, change: CompoundAdvance, lease: SessionExecutionLease) {
      const captured = structuredClone(change); const snapshot = await current(lease);
      const ledger = advanceCompoundOperation(snapshot.compoundOperations ?? createCompoundOperationLedger(), operationId, captured);
      await commit(snapshot, ledger, lease); issuedPreparedCompound.delete(operationId);
      const record=structuredClone(ledger.operations.find(item=>item.id===operationId)!);
      if(record.stage==='edit_committed')issuedCommittedEdits.set(operationId,structuredClone(record));else issuedCommittedEdits.delete(operationId);
      return record;
    },
    async retire(operationId: string, context: {requestSource: 'user' | 'agent' | 'scheduler'}, lease: SessionExecutionLease): Promise<void> {
      if (context.requestSource !== 'user') throw Error('compound_cleanup_user_required');
      const snapshot = await current(lease);
      const prior = snapshot.compoundOperations ?? createCompoundOperationLedger();
      const ledger = prior.directOperations?.some(r=>r.id===operationId) ? retireDirectOperation(prior,operationId) : retireCompoundOperation(prior, operationId);
      if (!isDeepStrictEqual(ledger, prior)) await commit(snapshot, ledger, lease);
    },
  });
}
