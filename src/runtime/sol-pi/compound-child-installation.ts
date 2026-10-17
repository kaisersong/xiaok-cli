import {captureCompoundFollowupPreparationSupervision} from './compound-managed-lifecycle.js';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {prepareManagedTurn,advanceManagedTurn,getManagedTurnDispatch,type ManagedTurnRecord} from './compound-managed-turn.js';
import {createCompoundOperationLedger} from './compound-operation.js';
import {getManagedCompoundAdmissionBinding,type ManagedCompoundAdmission} from './compound-managed-admission.js';
import type {Tool} from '../../types.js';
import type {ToolRegistry} from '../../ai/tools/index.js';
import type {AgentSessionState} from '../../ai/runtime/session.js';
import {computeSessionHistoryDigest,type SessionStore,type StoredSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext,type SessionExecutionLease,type SessionExecutionAuthority} from '../../ai/runtime/session-store/execution-authority.js';
import {createSessionExecutionChain,acquireSessionExecutionFactChain,getSessionExecutionAncestorLease,type SessionExecutionChain} from '../../ai/runtime/session-store/execution-chain.js';
import {createCompoundSessionJournal} from './compound-session-journal.js';
import {createCompoundProviderAdmission,type ProviderAncestorAdmission} from './compound-provider-admission.js';
import {getObservationSessionOwnerHostBinding,bindObservationProviderAdmission,type ObservationSessionOwner} from './observation-session-owner.js';
import {assertDelegatedObservationOwner,assertDelegatedObservationPaused} from './delegated-session-owner.js';
import type {DirectOperationRecord} from './compound-direct-operation.js';
import type {CompoundValidationBackend} from './compound-validation.js';
import type {ProductCompoundCoordinator} from './product-compound-coordinator.js';

export interface CompoundTreeOwner {root:string;sessionIdentity:string;authority:SessionExecutionAuthority;journal:ReturnType<typeof createCompoundSessionJournal>;domain?:ReturnType<typeof import('./compound-execution-domain.js').openCompoundExecutionDomain>}
export interface CompoundParentAdmission {root:string;sessionIdentity:string;operationId:string;generation:number;store:SessionStore}
type CompoundTurnSnapshotData=Readonly<Pick<StoredSessionSnapshot,'compoundOperations'>>;
export interface BoundCompoundCoordinatorInput {
 owner:ObservationSessionOwner;recallTool:Tool;authority:SessionExecutionAuthority;executionSignal:AbortSignal;
 session:AgentSessionState;store:SessionStore;root:string;registry:ToolRegistry;journal:ReturnType<typeof createCompoundSessionJournal>;
 assertCurrent():void;persistCurrentHistory(lease:SessionExecutionLease):Promise<void>;
 executionChain?:SessionExecutionChain;validationBackend?:CompoundValidationBackend;treeRoot?:CompoundTreeOwner;ancestors?:readonly CompoundParentAdmission[];
 providerAdmission?:ProviderAncestorAdmission;
 getActiveTurnOrigin?():Readonly<{session:AgentSessionState;nativeInvocationId:string}>|undefined;
 assertTurnCurrent?(snapshot:CompoundTurnSnapshotData):void;
}
/** Host-only common installation. It accepts an already durable exact parent
 * admission and authenticates the actual D1 owner/session; no tool context can
 * supply this installer or manufacture its live completion facts. */
export function createCompoundChildInstallation(input:{
 root:string;store:SessionStore;sessionIdentity:string;childSession:AgentSessionState;record:DirectOperationRecord;
 parent:CompoundParentAdmission;ancestors:readonly CompoundParentAdmission[];treeRoot:CompoundTreeOwner;
 chain:SessionExecutionChain;journal:ReturnType<typeof createCompoundSessionJournal>;
 executionSignal:AbortSignal;signal:AbortSignal;assertCurrent():void;validationBackend?:CompoundValidationBackend;
 installCoordinator(input:BoundCompoundCoordinatorInput):ProductCompoundCoordinator;
 managedTurn?:{admission:ManagedCompoundAdmission;followup?:import('./compound-managed-followup.js').ManagedCompoundFollowupAdapter;turnId:string;initialMessage:string;assertApplied():void;assertResourceCurrent():void};
}) {
 const {root,store,sessionIdentity,childSession,parent,ancestors,treeRoot,chain,journal,executionSignal,signal,assertCurrent,validationBackend,installCoordinator}=input;
 const childIdentity=childSession.exportSnapshot().sessionId;let record=structuredClone(input.record);
 let childDrained=false,childInstalled=false;let assertInstalledLive:(()=>void)|undefined;
    const install=async(child:{owner:ObservationSessionOwner;session:AgentSessionState;registry:ToolRegistry;recallTool:Tool})=>{
     if(childInstalled||child.session!==childSession)throw Error('compound_child_installation_invalid');childInstalled=true;
     assertDelegatedObservationOwner(child.owner,child.session,child.registry);
     const childAuthority=createSessionExecutionAuthority({root,sessionIdentity:childIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:childIdentity,scopeId:childIdentity})});
     const childHost=getObservationSessionOwnerHostBinding(child.owner),lifetime=new AbortController();
     let activeTurnOrigin:Readonly<{session:AgentSessionState;nativeInvocationId:string}>|undefined;
     let turnRecord:ManagedTurnRecord|undefined,installingProvider=true,activation:Promise<void>|undefined;
     const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
     const assertTurnCurrent=(snapshot:CompoundTurnSnapshotData)=>{if(!input.managedTurn)return;const row=snapshot.compoundOperations?.managedTurns?.records.at(-1);if(!turnRecord||turnRecord.state!=='active'||!isDeepStrictEqual(row,turnRecord))throw Error('compound_managed_turn_not_active');input.managedTurn.assertResourceCurrent();};
     const childSignal=AbortSignal.any([signal,executionSignal,lifetime.signal]);
     const childAssert=()=>{childSignal.throwIfAborted();child.owner.assertSession(childSession);};assertInstalledLive=childAssert;
     const checkParent=async(requireActiveTurn=true)=>{const snapshot=await store.load(sessionIdentity),edge=snapshot?.compoundOperations?.directOperations?.find(r=>r.id===record.id);if(edge?.stage!=='started'||edge.delegation?.state!=='live'||edge.delegation.generation!==1||edge.delegation.childPhase!=='running'||edge.delegation.childSessionIdentity!==childIdentity)throw Error('compound_parent_admission_not_current');if(requireActiveTurn&&input.managedTurn&&!installingProvider){const own=await store.load(childIdentity);if(!own)throw Error('compound_managed_turn_missing');assertTurnCurrent(own);}};
     const childChain=createSessionExecutionChain({parent:chain,target:{root,sessionIdentity:childIdentity,authority:childAuthority},validate:async()=>{childAssert();await checkParent();},validatePublication:async()=>{childAssert();await checkParent(false);}});
     let childJournal:ReturnType<typeof createCompoundSessionJournal>;
     childJournal=createCompoundSessionJournal({root,store,sessionIdentity:childIdentity,ownerId:childIdentity,scopeId:childIdentity,requestSource:'agent',assertCurrent:childAssert,reserveMutation:async(identity,lease)=>{const allocation=await treeRoot.journal.reserveTreeAllocation({...identity,recordKind:'native'},getSessionExecutionAncestorLease(lease,treeRoot));if(!allocation.created)throw Error('compound_tree_unpublished_reservation');}});
     const unsubscribe=store.onCommit!(snapshot=>{if(snapshot.sessionId===childIdentity)childSession.updatePersistenceFacts(snapshot);});
     let childCoordinator:ProductCompoundCoordinator|undefined,disposed:Promise<void>|undefined;
     try{
      const initializing=await acquireSessionExecutionFactChain(childChain,{invocationId:`child-initialize:${randomUUID()}`});
      try{
       assertCurrent();childAssert();const current=await store.load(sessionIdentity),edge=current?.compoundOperations?.directOperations?.find(r=>r.id===record.id);
       if(edge?.delegation?.childPhase!=='not_started'||edge.stage!=='started'||edge.delegation.state!=='live'||edge.delegation.childSessionIdentity!==childIdentity)throw Error('compound_parent_admission_not_current');
       const previous=await store.load(childIdentity),snapshot=previous??childSession.exportSnapshot();
       await store.compareAndSave!({expectedStoreRevision:previous?.storeRevision??0,expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot:snapshot,lease:initializing.childLease,beforeCommit:childAssert});
       record=await journal.advanceDirect(record.id,{stage:'started',delegation:{...record.delegation!,childPhase:'running'}},getSessionExecutionAncestorLease(initializing.childLease,parent));

      }finally{await initializing.releaseAfterDrain();}
      const cap=await createCompoundProviderAdmission({chain:childChain,parent,ancestors:[...ancestors,parent],child:{root,sessionIdentity:childIdentity,authority:childAuthority,journal:childJournal,store},rootBudget:treeRoot,treeRoot,issuerIncarnation:randomUUID(),executionSignal:childSignal,owner:child.owner,registry:child.registry});
      installingProvider=false;bindObservationProviderAdmission(child.owner,cap);
      const publish=async(lease:SessionExecutionLease)=>{
       childAssert();const basis=childSession.getPublishedHistoryBasis(),live=childSession.exportSnapshot(),revision=childSession.planCompaction().sourceRevision,digest=computeSessionHistoryDigest(live),previous=await store.load(childIdentity);
       if(!previous||previous.historyDigest!==basis)throw Error('compound_live_history_stale');
       await store.compareAndSave!({expectedStoreRevision:previous.storeRevision!,expectedHistoryDigest:previous.historyDigest!,nextSnapshot:{...previous,...live},lease,beforeCommit:()=>{childAssert();if(childSession.planCompaction().sourceRevision!==revision||computeSessionHistoryDigest(childSession.exportSnapshot())!==digest)throw Error('compound_live_history_changed');}});childSession.notePublishedHistory(live,basis);
      };
      childCoordinator=installCoordinator({owner:child.owner,recallTool:child.recallTool,authority:childAuthority,executionSignal:childSignal,session:childSession,store,root,registry:child.registry,journal:childJournal,assertCurrent:childAssert,persistCurrentHistory:publish,executionChain:childChain,validationBackend:validationBackend,treeRoot,ancestors:[...ancestors,parent],providerAdmission:cap,assertTurnCurrent,getActiveTurnOrigin:()=>{if(turnRecord?.state!=='active')return;childAssert();input.managedTurn?.assertResourceCurrent();return activeTurnOrigin;}});
      let preparation:Promise<void>|undefined;
      const prepareInitialTurn=()=>preparation??=(async()=>{
       if(!input.managedTurn)throw Error('compound_managed_turn_not_enabled');childAssert();
       const preparing=await acquireSessionExecutionFactChain(childChain,{invocationId:`managed-turn-prepare:${randomUUID()}`});
       try{
       if(input.managedTurn){
        const binding=getManagedCompoundAdmissionBinding(input.managedTurn.admission);
        if(binding.childSessionId!==childIdentity||binding.parentOperationId!==record.id||binding.parentSessionId!==sessionIdentity)throw Error('compound_managed_turn_identity');
        const own=(await store.load(childIdentity))!,ledger=own.compoundOperations??createCompoundOperationLedger();
        if(ledger.managedTurns)throw Error('compound_managed_turn_already_initialized');
        const prepared=prepareManagedTurn(undefined,{admissionId:binding.admissionId,childSessionId:childIdentity,operationId:binding.operationId,turnId:input.managedTurn.turnId,rootEpoch:binding.rootEpoch,inputHash:hash(input.managedTurn.initialMessage),closureDigest:hash(childSession.getProtectedObservationClosure()??null)});
        const allocation=await treeRoot.journal.reserveTreeAllocation({dispatch:getManagedTurnDispatch(prepared.record),inputHash:prepared.record.inputHash,recordKind:'turn'},getSessionExecutionAncestorLease(preparing.childLease,treeRoot));if(!allocation.created)throw Error('compound_managed_turn_reservation_duplicate');
        await store.compareAndSave!({expectedStoreRevision:own.storeRevision!,expectedHistoryDigest:own.historyDigest!,nextSnapshot:{...own,compoundOperations:{...ledger,generation:ledger.generation+1,managedTurns:prepared.ledger}},lease:preparing.childLease,beforeCommit:childAssert});turnRecord=prepared.record;
       }
       }finally{await preparing.releaseAfterDrain();}
      })();
      const assertTurnInput=()=>{
       if(!input.managedTurn)return;childAssert();input.managedTurn.assertResourceCurrent();
       const message=childSession.exportSnapshot().messages.at(-1);
       if(!turnRecord||turnRecord.state!=='active'||message?.role!=='user'||message.content.length!==1||message.content[0].type!=='text'||hash(message.content[0].text)!==turnRecord.inputHash||hash(childSession.getProtectedObservationClosure()??null)!==turnRecord.closureDigest)throw Error('compound_managed_turn_input_changed');
      };
      const followups=new WeakMap<object,Promise<import('./compound-managed-followup.js').PreparedManagedCompoundFollowup>>();
      const prepareManagedFollowup=(request:{preparation:unknown;pausedTicket:object})=>{
       if(!request.preparation||typeof request.preparation!=='object')throw Error('compound_followup_preparation');
       const old=followups.get(request.preparation);if(old)return old;
       const operation=(async()=>{
        const turn=input.managedTurn,adapter=turn?.followup;if(!turn||!adapter)throw Error('compound_followup_not_enabled');
        childAssert();turn.assertResourceCurrent();assertDelegatedObservationPaused(child.owner,request.pausedTicket);
        const preparation=request.preparation as object,original=adapter.inspectPreparation(preparation),expected=Object.freeze({...original,...(original.origin?{origin:Object.freeze({...original.origin})}:{}),closure:structuredClone(original.closure)}),binding=getManagedCompoundAdmissionBinding(turn.admission);
        const check=()=>{childAssert();turn.assertResourceCurrent();assertDelegatedObservationPaused(child.owner,request.pausedTicket);const facts=adapter.inspectPreparation(preparation);
         if(facts.admission!==turn.admission||facts.childSession!==childSession||facts.rootEpoch!==binding.rootEpoch||!['user','agent'].includes(facts.requestSource)||(facts.requestSource==='agent'&&!facts.origin)||(facts.requestSource==='user'&&!!facts.origin)||facts.origin?.session!==expected.origin?.session||!isDeepStrictEqual(facts,expected)||!isDeepStrictEqual(facts.closure,childSession.getProtectedObservationClosure()))throw Error('compound_followup_facts_changed');
        };
        check();if(!turnRecord||!['active','cancelled_before_activation'].includes(turnRecord.state)||turnRecord.state==='active'&&turnRecord.turnId!==expected.previousTurnId)throw Error('compound_followup_previous_turn');
        await childCoordinator!.drainCurrentTurn();check();
        const acquired=await acquireSessionExecutionFactChain(childChain,{invocationId:`managed-followup-prepare:${randomUUID()}`});
        let preparedRecord:ManagedTurnRecord;
        try{check();const own=(await store.load(childIdentity))!,ledger=own.compoundOperations;
         if(!ledger?.managedTurns||!isDeepStrictEqual(ledger.managedTurns.records.at(-1),turnRecord)||ledger.operations.some(row=>row.stage!=='settled')||ledger.directOperations?.some(row=>row.stage!=='settled'&&(row.stage!=='started'||!row.delegation?.managed))||ledger.providerAttempts?.some(row=>!['drained','cancelled_before_send'].includes(row.transportState)))throw Error('compound_followup_old_turn_not_drained');
         // Open managed resources outlive a turn. Only the original live tree
         // issuers and fully published ACKs can account for their started rows.
         const recheckResources=captureCompoundFollowupPreparationSupervision(treeRoot,getSessionExecutionAncestorLease(acquired.childLease,treeRoot),expected.origin);
         // This path supports drained turns whose resources remain open. Active
         // descendants need the separate preparation wait protocol; do not
         // admit them and then invalidate their next request with our new turn.
         const descendants=(ledger.directOperations??[]).flatMap(row=>row.delegation?[row.delegation.childSessionIdentity]:[]),seen=new Set<string>([childIdentity]);
         for(let index=0;index<descendants.length;index++){
          const id=descendants[index];if(seen.has(id)||seen.size>=128)throw Error('compound_followup_descendant_inventory');seen.add(id);
          const snapshot=await store.load(id);check();const effects=snapshot?.compoundOperations;
          if(!effects||effects.operations.some(row=>row.stage!=='settled')
            ||effects.directOperations?.some(row=>row.stage!=='settled'&&(row.stage!=='started'||!row.delegation?.managed))
            ||effects.providerAttempts?.some(row=>!['drained','cancelled_before_send'].includes(row.transportState))
            ||snapshot.semanticCompaction?.reservations.some(row=>!['settled','cancelled_before_dispatch'].includes(row.status)))throw Error('compound_followup_descendant_not_drained');
          descendants.push(...(effects.directOperations??[]).flatMap(row=>row.delegation?[row.delegation.childSessionIdentity]:[]));
         }
         recheckResources();
         const previousApplied=ledger.managedTurns.records.filter(row=>row.appliedDigest!==null).at(-1);if(previousApplied?.turnId!==expected.previousTurnId)throw Error('compound_followup_previous_turn');
         const drained=turnRecord.state==='active'?advanceManagedTurn(advanceManagedTurn(ledger.managedTurns,turnRecord.generation,{state:'retiring'}),turnRecord.generation,{state:'drained'}):ledger.managedTurns;
         const next=prepareManagedTurn(drained,{admissionId:binding.admissionId,childSessionId:childIdentity,operationId:expected.operationId,turnId:expected.nextTurnId,rootEpoch:expected.rootEpoch,inputHash:hash(expected.message),closureDigest:hash(expected.closure??null)});
         const reserved=await treeRoot.journal.reserveTreeAllocation({dispatch:getManagedTurnDispatch(next.record),inputHash:next.record.inputHash,recordKind:'turn'},getSessionExecutionAncestorLease(acquired.childLease,treeRoot));if(!reserved.created)throw Error('compound_followup_reservation_duplicate');
         await store.compareAndSave!({expectedStoreRevision:own.storeRevision!,expectedHistoryDigest:own.historyDigest!,nextSnapshot:{...own,compoundOperations:{...ledger,generation:ledger.generation+1,managedTurns:next.ledger}},lease:acquired.childLease,beforeCommit:()=>{check();recheckResources();}});turnRecord=preparedRecord=next.record;
        }finally{await acquired.releaseAfterDrain();}
        const finish=async(receipt:unknown,cancel:boolean)=>{
         const inspect=()=>{const fact=cancel?adapter.inspectCancelled(receipt):adapter.inspectApplied(receipt);if(fact.preparation!==preparation||fact.operationId!==expected.operationId||fact.nextTurnId!==expected.nextTurnId)throw Error('compound_followup_receipt');return fact;};
         inspect();const facts=await acquireSessionExecutionFactChain(childChain,{invocationId:`managed-followup-commit:${randomUUID()}`});
         try{const fact=inspect(),own=(await store.load(childIdentity))!,ledger=own.compoundOperations;
          if(!ledger?.managedTurns||!isDeepStrictEqual(ledger.managedTurns.records.at(-1),preparedRecord)||!isDeepStrictEqual(turnRecord,preparedRecord))throw Error('compound_followup_generation_changed');
          if(!cancel){childAssert();turn.assertResourceCurrent();assertDelegatedObservationPaused(child.owner,request.pausedTicket);}
          const next=cancel?advanceManagedTurn(ledger.managedTurns,preparedRecord.generation,{state:'cancelled_before_activation'}):advanceManagedTurn(advanceManagedTurn(ledger.managedTurns,preparedRecord.generation,{state:'prepared',appliedDigest:(fact as {appliedDigest:string}).appliedDigest}),preparedRecord.generation,{state:'active'});
          await store.compareAndSave!({expectedStoreRevision:own.storeRevision!,expectedHistoryDigest:own.historyDigest!,nextSnapshot:{...own,compoundOperations:{...ledger,generation:ledger.generation+1,managedTurns:next}},lease:facts.childLease,beforeCommit:()=>{inspect();facts.assertCurrent();if(!cancel){childAssert();turn.assertResourceCurrent();assertDelegatedObservationPaused(child.owner,request.pausedTicket);}}});turnRecord=next.records.at(-1);activeTurnOrigin=cancel?undefined:expected.origin;
         }finally{await facts.releaseAfterDrain();}
        };
        let resolution:{receipt:unknown;cancel:boolean;work:Promise<void>}|undefined;
        const resolve=(receipt:unknown,cancel:boolean)=>{
         try{const fact=cancel?adapter.inspectCancelled(receipt):adapter.inspectApplied(receipt);if(fact.preparation!==preparation||fact.operationId!==expected.operationId||fact.nextTurnId!==expected.nextTurnId)throw Error('compound_followup_receipt');}catch(error){return Promise.reject(error);}
         if(resolution){if(resolution.receipt!==receipt||resolution.cancel!==cancel)return Promise.reject(Error('compound_followup_resolution_conflict'));return resolution.work;}
         const work=finish(receipt,cancel);resolution={receipt,cancel,work};return work;
        };
        return Object.freeze({commitApplied:(receipt:unknown)=>resolve(receipt,false),cancelBeforeApplied:(receipt:unknown)=>resolve(receipt,true)});
       })();followups.set(request.preparation,operation);return operation;
      };
      const activateInitialTurn=()=>activation??=(async()=>{
       if(!input.managedTurn)throw Error('compound_managed_turn_not_enabled');childAssert();input.managedTurn.assertApplied();
       const facts=await acquireSessionExecutionFactChain(childChain,{invocationId:`managed-turn-activate:${randomUUID()}`});
       try{
        const own=(await store.load(childIdentity))!,ledger=own?.compoundOperations,actual=ledger?.managedTurns?.records.at(-1),message=childSession.exportSnapshot().messages.at(-1);
        if(!ledger?.managedTurns||!turnRecord||!isDeepStrictEqual(actual,turnRecord)||turnRecord.state!=='prepared'||message?.role!=='user'||message.content.length!==1||message.content[0].type!=='text'||message.content[0].text!==input.managedTurn.initialMessage||hash(childSession.getProtectedObservationClosure()??null)!==turnRecord.closureDigest)throw Error('compound_managed_turn_initial_input_changed');
        const appliedDigest=hash({binding:getManagedCompoundAdmissionBinding(input.managedTurn.admission),turnId:turnRecord.turnId,inputHash:turnRecord.inputHash,closureDigest:turnRecord.closureDigest});
        const applied=advanceManagedTurn(ledger.managedTurns,1,{state:'prepared',appliedDigest}),active=advanceManagedTurn(applied,1,{state:'active'});
        await store.compareAndSave!({expectedStoreRevision:own.storeRevision!,expectedHistoryDigest:own.historyDigest!,nextSnapshot:{...own,compoundOperations:{...ledger,generation:ledger.generation+1,managedTurns:active}},lease:facts.childLease,beforeCommit:()=>{childAssert();input.managedTurn!.assertApplied();}});turnRecord=active.records[0];
       }finally{await facts.releaseAfterDrain();}
      })();
      return {assertTurnInput:input.managedTurn?assertTurnInput:undefined,prepareManagedFollowup:input.managedTurn?prepareManagedFollowup:undefined,prepareInitialTurn:input.managedTurn?prepareInitialTurn:undefined,activateInitialTurn:input.managedTurn?activateInitialTurn:undefined,prepareManagedChild:(args:Parameters<ProductCompoundCoordinator['prepareManagedChild']>[0])=>childCoordinator!.prepareManagedChild(args),bindRegistry:(registry:ToolRegistry)=>childCoordinator!.rebindRegistry(registry),dispose:()=>disposed??=(async()=>{
       lifetime.abort(new DOMException('Child execution stopped','AbortError'));await childCoordinator!.dispose();child.owner.dispose();await childHost.drainTransport();
       const facts=await acquireSessionExecutionFactChain(childChain,{invocationId:`child-drain:${randomUUID()}`});
       try{const snapshot=await store.load(childIdentity),ledger=snapshot?.compoundOperations;if(ledger&&(ledger.operations.some(r=>r.stage!=='settled')||ledger.directOperations?.some(r=>r.stage!=='settled')||ledger.providerAttempts?.some(r=>r.transportState==='reserved'||r.transportState==='unknown')))throw Error('compound_child_drain_unknown');
        if(ledger?.managedTurns){if(!turnRecord||!isDeepStrictEqual(ledger.managedTurns.records.at(-1),turnRecord))throw Error('compound_child_turn_drain_unknown');
         let terminal=ledger.managedTurns;
         if(turnRecord.state==='prepared'&&!activation)terminal=advanceManagedTurn(terminal,turnRecord.generation,{state:'cancelled_before_activation'});
         else if(turnRecord.state==='active')terminal=advanceManagedTurn(advanceManagedTurn(terminal,turnRecord.generation,{state:'retiring'}),turnRecord.generation,{state:'drained'});
         else if(!['drained','cancelled_before_activation'].includes(turnRecord.state))throw Error('compound_child_turn_drain_unknown');
         await store.compareAndSave!({expectedStoreRevision:snapshot!.storeRevision!,expectedHistoryDigest:snapshot!.historyDigest!,nextSnapshot:{...snapshot!,compoundOperations:{...ledger,generation:ledger.generation+1,managedTurns:terminal}},lease:facts.childLease,beforeCommit:()=>facts.assertCurrent()});turnRecord=terminal.records.at(-1);
        }
       }
       finally{try{await facts.releaseAfterDrain();}finally{unsubscribe();childAuthority.dispose();}}
       childDrained=true;
      })()};
     }catch(error){unsubscribe();child.owner.dispose();await childHost.drainTransport();childAuthority.dispose();throw error;}
    };
 return Object.freeze({install,assertLive(){if(!childInstalled||childDrained||!assertInstalledLive)throw Error('compound_child_not_live');assertInstalledLive();},hasInstalled:()=>childInstalled,hasDrained:()=>childDrained});
}
