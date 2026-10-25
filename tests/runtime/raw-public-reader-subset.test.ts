import {describe, expect, it} from 'vitest';
import {freezeMigrationSnapshot, computeSessionSnapshotHash} from '../../src/ai/runtime/session-store/migration.js';
import {assertNoIntentNativeJournal, type IntentNativeAbsenceData} from '../../src/runtime/intent-delegation/native-contract-journal.js';
import {createEmptySessionIntentLedger} from '../../src/runtime/intent-delegation/types.js';
import type {StoredSessionSnapshot} from '../../src/ai/runtime/session-store/stored-snapshot-types.js';
import type {StoredSessionIntentLedgerInput, StoredIntentRecordInput} from '../../src/runtime/intent-delegation/stored-intent-clone.js';
import type {PersistedSessionSnapshot} from '../../src/ai/runtime/session-store/store.js';

// Ordinary DATA fixture; no actor, producer, Store, native contract or SDK grant.
function rawFixture(): {snapshot:StoredSessionSnapshot;ledger:StoredSessionIntentLedgerInput} {
  const record:StoredIntentRecordInput={intentId:'legacy-intent',instanceId:'owner',sessionId:'session',rawIntent:'legacy',normalizedIntent:'legacy',intentType:'review',deliverable:'report',explicitConstraints:[],delegationBoundary:[],riskTier:'low',templateId:'template',steps:[{stepId:'step',dependsOn:[],role:'review'}],activeStepId:'step',overallStatus:'drafting_plan',attemptCount:1,createdAt:1,updatedAt:1};
  const ledger:StoredSessionIntentLedgerInput={sessionId:'session',latestPlan:record,intents:[record],breadcrumbs:[],receipt:null,salvage:null,ownership:{state:'owned',ownerInstanceId:'owner',updatedAt:1},updatedAt:1};
  return {ledger,snapshot:{sessionId:'session',cwd:'/data-only',createdAt:1,updatedAt:1,lineage:['session'],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[],intentDelegation:ledger}};
}

describe('existing public storage DATA reader contracts',()=>{
  it('retains full raw and legacy data through clone/freeze without normalization',()=>{
    const {snapshot,ledger}=rawFixture();
    ledger.publicationCandidates={unknownProtectedHistory:['retained']};
    const before=computeSessionSnapshotHash(snapshot);
    const frozen:StoredSessionSnapshot=freezeMigrationSnapshot(snapshot);
    expect(frozen).toEqual(snapshot);
    expect(frozen).not.toBe(snapshot);
    expect(computeSessionSnapshotHash(frozen)).toBe(before);
    expect(Object.isFrozen(frozen.intentDelegation?.intents)).toBe(true);
    expect(frozen.intentDelegation?.intents[0].intentType).toBe('review');
    expect(Object.hasOwn(frozen.intentDelegation?.intents[0]??{},'stages')).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(false);
  });

  it('retains the strong modern return overload',()=>{
    const {snapshot}=rawFixture();
    const modern:PersistedSessionSnapshot={...snapshot,intentDelegation:createEmptySessionIntentLedger('session',1)};
    const frozen:PersistedSessionSnapshot=freezeMigrationSnapshot(modern);
    expect(frozen).toEqual(modern);
  });

  it('accepts raw absence and real parser empty DATA without inspecting legacy records',()=>{
    const {snapshot,ledger}=rawFixture();
    expect(()=>assertNoIntentNativeJournal(snapshot)).not.toThrow();
    ledger.nativeContracts=[];
    expect(()=>assertNoIntentNativeJournal(snapshot)).not.toThrow();
    ledger.nativeContracts=undefined;
    expect(()=>assertNoIntentNativeJournal(snapshot)).not.toThrow();
    expect(()=>assertNoIntentNativeJournal(null)).not.toThrow();
    expect(()=>assertNoIntentNativeJournal(undefined)).not.toThrow();
  });

  it('keeps malformed native DATA rejection at the real parser',()=>{
    const {snapshot,ledger}=rawFixture();
    ledger.nativeContracts={notAnArray:true};
    expect(()=>assertNoIntentNativeJournal(snapshot)).toThrow('intent_native_journal');
    ledger.nativeContracts=[{}];
    expect(()=>assertNoIntentNativeJournal(snapshot)).toThrow();
  });

  it('retains the existing second-read protection: empty then nonempty still rejects (before PASS)',()=>{
    const events:string[]=[];
    const data:IntentNativeAbsenceData={get sessionId(){events.push('sessionId');return 'session';},intentDelegation:{get nativeContracts(){events.push('nativeContracts');return events.filter(event=>event==='nativeContracts').length===1?[]:[{}];}}};
    expect(()=>assertNoIntentNativeJournal(data)).toThrow('intent_native_journal_retained');
    expect(events).toEqual(['nativeContracts','sessionId','nativeContracts']);
    // The pre-API helper also rejects this flip; it is NOT runtime RED evidence.
  });

  it('preserves intentDelegation getter access count and original argument/read order',()=>{
    const events:string[]=[];
    const ledger={get nativeContracts(){events.push('nativeContracts');return [];}};
    const data:IntentNativeAbsenceData={get sessionId(){events.push('sessionId');return 'session';},get intentDelegation(){events.push('intentDelegation');return ledger;}};
    expect(()=>assertNoIntentNativeJournal(data)).not.toThrow();
    expect(events).toEqual(['intentDelegation','intentDelegation','intentDelegation','nativeContracts','sessionId','intentDelegation','nativeContracts']);
  });

  it.each([undefined,null])('preserves nullish second-read semantics (%s)',current=>{
    let reads=0;
    const data:IntentNativeAbsenceData={sessionId:'session',intentDelegation:{get nativeContracts(){reads+=1;return reads===1?[]:current;}}};
    expect(()=>assertNoIntentNativeJournal(data)).not.toThrow();
    expect(reads).toBe(2);
  });

  it('does not perform the second read after the original parser rejects the first value',()=>{
    const events:string[]=[];
    const data:IntentNativeAbsenceData={get sessionId(){events.push('sessionId');return 'session';},intentDelegation:{get nativeContracts(){events.push('nativeContracts');return {};}}};
    expect(()=>assertNoIntentNativeJournal(data)).toThrow('intent_native_journal');
    expect(events).toEqual(['nativeContracts','sessionId']);
  });

  it.each([{}, {length:0}, '', 0, false])('explicitly rejects a non-array second value (%j)',current=>{
    let reads=0;
    const data:IntentNativeAbsenceData={sessionId:'session',intentDelegation:{get nativeContracts(){reads+=1;return reads===1?[]:current;}}};
    expect(()=>assertNoIntentNativeJournal(data)).toThrow('intent_native_journal');
    expect(reads).toBe(2);
    // Stricter JS behavior: the old optional .length could silently accept these.
  });

  it('preserves the original own-key gate, not an invented inherited-key parser path',()=>{
    const delegation={};Object.setPrototypeOf(delegation,{nativeContracts:[{}]});
    const inherited:IntentNativeAbsenceData={sessionId:'session',intentDelegation:delegation};
    expect(()=>assertNoIntentNativeJournal(inherited)).not.toThrow();
  });
});
