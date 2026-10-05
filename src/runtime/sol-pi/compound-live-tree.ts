import {matchesSemanticSummaryProviderReservation,type SemanticSummaryProviderScope} from './semantic-summary-attempt.js';
import {getManagedTurnDispatch} from './compound-managed-turn.js';
import {createHash} from 'node:crypto';
import {basename,join} from 'node:path';
import {lstatSync,realpathSync,opendirSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {assertSessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {readCompoundDeletionBytes} from '../../ai/runtime/session-store/compound-deletion-census.js';
import {toDurableSessionSnapshot,computeSessionHistoryDigest,type PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {readSessionAliases} from '../../ai/runtime/session-store/aliases.js';
import {inspectCompoundSourceInventory,assertCompoundSourceInventoryCurrent} from './compound-source-inventory.js';
import {getCompoundExecutionDomainBinding} from './compound-execution-domain.js';
import {createCompoundOperationLedger,validateCompoundOperationLedger} from './compound-operation.js';
import type {CompoundTreeOwner} from './compound-child-installation.js';
function fail(reason:string):never{throw Error(`compound_live_tree_${reason}`);}
/** Synchronous canonical census under the shared root lease. The callback must
 * authenticate actual private issuers; disk "live" fields alone are not enough. */
export function inspectCompoundLiveTree(input:{treeRoot:CompoundTreeOwner;lease:SessionExecutionLease;candidate?:PersistedSessionSnapshot;semanticScope?:SemanticSummaryProviderScope;assertLive(snapshot:PersistedSessionSnapshot):void}){
 const {treeRoot,lease}=input,root=realpathSync(treeRoot.root);assertSessionExecutionLease(lease,treeRoot);
 const retired=new Set<string>();
 if(treeRoot.domain){const binding=getCompoundExecutionDomainBinding(treeRoot.domain);if(binding.canonicalSessionId!==treeRoot.sessionIdentity||binding.storeRoot!==root)fail('domain');for(const id of treeRoot.domain.retiredSessionIdentities(lease))retired.add(id);}
 const inventory=inspectCompoundSourceInventory([root]),facts=assertCompoundSourceInventoryCurrent(inventory),snapshots=new Map<string,PersistedSessionSnapshot>();let remaining=16*1024*1024;
 const source=new Map(facts.snapshots.map(row=>[row.sessionId,row]));
 const load=(id:string)=>{
  if(snapshots.has(id)||!/^[A-Za-z0-9_-]{1,160}$/.test(id)||snapshots.size>=256||retired.has(id))fail('identity');
  const original=source.get(id);if(!original)fail('missing');
  const bytes=readCompoundDeletionBytes(join(root,`${id}.json`),remaining);remaining-=bytes.length;
  const {schemaVersion,...document}=JSON.parse(bytes.toString('utf8'));if(schemaVersion!==1)fail('schema');
  let snapshot=toDurableSessionSnapshot(document);
  if(input.candidate?.sessionId===id){
   const candidate=toDurableSessionSnapshot(input.candidate),before=validateCompoundOperationLedger(snapshot.compoundOperations??createCompoundOperationLedger()),after=validateCompoundOperationLedger(candidate.compoundOperations??createCompoundOperationLedger());
   const priorSnapshot={...candidate};if(Object.hasOwn(snapshot,'compoundOperations'))priorSnapshot.compoundOperations=snapshot.compoundOperations;else delete priorSnapshot.compoundOperations;
   const added=after.providerAttempts?.at(-1),prior={...after,generation:before.generation};if(before.providerAttempts===undefined)delete prior.providerAttempts;else prior.providerAttempts=before.providerAttempts;
   if(!added||added.transportState!=='reserved'||(after.providerAttempts?.length??0)!==(before.providerAttempts?.length??0)+1||!isDeepStrictEqual(after.providerAttempts!.slice(0,-1),before.providerAttempts??[]))fail('candidate_provider_set');
   if(!isDeepStrictEqual(prior,before)||after.generation!==before.generation+1)fail('candidate_ledger');
   if(!isDeepStrictEqual(JSON.parse(JSON.stringify(priorSnapshot)),JSON.parse(JSON.stringify(snapshot))))fail('candidate_history');
   snapshot=candidate;
  }
  if(snapshot.sessionId!==id||!snapshot.executionProtected||snapshot.historyDigest!==computeSessionHistoryDigest(snapshot))fail('snapshot');snapshots.set(id,snapshot);return snapshot;
 };
 let layer=[treeRoot.sessionIdentity];load(treeRoot.sessionIdentity);
 while(layer.length){const next:string[]=[];for(const id of layer){const snapshot=snapshots.get(id)!,ledger=validateCompoundOperationLedger(snapshot.compoundOperations??createCompoundOperationLedger());
   if(snapshot.semanticCompaction?.reservations.some(row=>!['settled','cancelled_before_dispatch'].includes(row.status)&&(!input.semanticScope||!matchesSemanticSummaryProviderReservation(input.semanticScope,snapshot,row,lease))))fail('semantic_unsettled');
   const unsettled=ledger.managedTurns?.records.some(row=>!['drained','cancelled_before_activation'].includes(row.state))||ledger.operations.some(row=>row.stage!=='settled')||ledger.directOperations?.some(row=>row.stage!=='settled')||ledger.providerAttempts?.some(row=>!['drained','cancelled_before_send'].includes(row.transportState));
   if(unsettled){const result:unknown=input.assertLive(snapshot);if(result!==undefined){if(result&&(typeof result==='object'||typeof result==='function')&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});fail('supervision_must_be_synchronous');}}
   for(const row of ledger.directOperations??[]){if(!row.delegation)continue;if(realpathSync(row.delegation.childStoreRoot)!==root)fail('child_root');const child=row.delegation.childSessionIdentity;load(child);next.push(child);}
  }layer=next;}
 for(const row of facts.snapshots){if(snapshots.has(row.sessionId))continue;if(!retired.has(row.sessionId)||row.hasUnsettledExecution)fail('unregistered');}
 if(input.candidate&&!snapshots.has(input.candidate.sessionId))fail('candidate_missing');
 const ledgers=[...snapshots.values()].map(snapshot=>({sessionId:snapshot.sessionId,ledger:validateCompoundOperationLedger(snapshot.compoundOperations??createCompoundOperationLedger())}));
 const budget=ledgers.find(row=>row.sessionId===treeRoot.sessionIdentity)!.ledger.treeBudget;
 if(snapshots.size>1&&!budget)fail('budget_missing');
 for(const allocation of budget?.allocations??[]){if(allocation.state==='tombstone')continue;
  if(allocation.recordKind==='delegation'){
   const match=ledgers.flatMap(row=>row.ledger.directOperations??[]).find(row=>row.delegation?.childSessionIdentity===allocation.dispatch.sessionIdentity&&allocation.dispatch.hostProviderInvocationId===`child:${row.id}`&&allocation.dispatch.originalToolUseId===row.id&&row.finalInputHash===allocation.inputHash);if(!match)fail('allocation');
  }else if(allocation.recordKind==='turn'){const target=ledgers.find(row=>row.sessionId===allocation.dispatch.sessionIdentity)?.ledger;const match=target?.managedTurns?.records.find(row=>isDeepStrictEqual(getManagedTurnDispatch(row),allocation.dispatch)&&row.inputHash===allocation.inputHash);if(!match)fail('allocation');
  }else{const ledger=ledgers.find(row=>row.sessionId===allocation.dispatch.sessionIdentity)?.ledger;if(!ledger)fail('allocation');const match=[...ledger.operations,...(ledger.directOperations??[]),...(ledger.providerAttempts??[]),...ledger.tombstones].find(row=>isDeepStrictEqual(row.dispatch,allocation.dispatch)&&row.inputHash===allocation.inputHash);if(!match||((allocation.recordKind==='provider')!==('transportState'in match||'providerAttempt'in match)))fail('allocation');}
 }
 const knownIds=new Set([...snapshots.keys(),...retired]);
 for(const alias of readSessionAliases(root))if(!knownIds.has(alias.targetSessionId))fail('alias');
 for(const path of facts.unclassifiedEntries){const name=basename(path),stat=lstatSync(path);if(stat.isSymbolicLink())fail('metadata');
  if(input.candidate&&name===`${input.candidate.sessionId}.json.save-lock`){if(!stat.isFile()||stat.size>16384)fail('candidate_lock');continue;}
  if(['.session-aliases.json','.session-aliases-enabled','.session-store-lock'].includes(name)){if(!stat.isFile())fail('metadata');continue;}
  if(name!=='.session-execution'||!stat.isDirectory())fail('metadata');
  const names=new Set([...knownIds].flatMap(id=>{const file=createHash('sha256').update(id.toLowerCase()).digest('hex')+'.sqlite';return[file,file+'-journal'];}));const directory=opendirSync(path);let count=0;
  try{for(let item=directory.readSync();item;item=directory.readSync()){const stat=lstatSync(join(path,item.name));if(++count>4096||!names.has(item.name)||!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('metadata');}}finally{directory.closeSync();}
 }
 assertCompoundSourceInventoryCurrent(inventory);assertSessionExecutionLease(lease,treeRoot);return Object.freeze({sessionIds:Object.freeze([...snapshots.keys()].sort())});
}
