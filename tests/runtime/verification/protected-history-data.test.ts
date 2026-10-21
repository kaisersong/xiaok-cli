import {describe, expect, it} from 'vitest';
import {hasProtectedIntentProducerHistory} from '../../../src/runtime/intent-delegation/intent-commit-boundary.js';
import type {IntentProtectedHistoryData} from '../../../src/runtime/intent-delegation/protected-history-data.js';
import type {StoredSessionIntentLedgerInput} from '../../../src/runtime/intent-delegation/stored-intent-clone.js';

// Real existing public boundary entry; its unchanged module initialization requires separate finite scope review.
// Scripted DATA only: no SDK/client/issuer/native business methods are called by these cases.
const acceptsRaw: (ledger: StoredSessionIntentLedgerInput | undefined) => boolean = hasProtectedIntentProducerHistory;

describe('protected history existing public DATA boundary', () => {
  it('accepts a full Raw API type without claiming that ordinary legacy data is Modern', () => {
    expect(typeof acceptsRaw).toBe('function');
    const legacy = {intentType:'review', steps:[{role:'review'}], producerReports:[{protectionMode:'ordinary'}]};
    const raw = {nativeContracts:[], intents:[legacy], latestPlan:legacy, unknownProtectedHistory:{retained:true}};
    const before = structuredClone(raw);
    expect(hasProtectedIntentProducerHistory(raw)).toBe(false);
    expect(raw).toEqual(before);
    expect(Object.hasOwn(legacy,'stages')).toBe(false);
  });

  it('keeps native presence first and does not inspect rows in a nonempty native case', () => {
    const events:string[]=[];
    const data:IntentProtectedHistoryData={get nativeContracts(){events.push('native');return [{}];},get intents(){throw Error('must_not_read');},get latestPlan(){throw Error('must_not_read');}};
    expect(hasProtectedIntentProducerHistory(data)).toBe(true);
    expect(events).toEqual(['native']);
    // [{}] is only nonempty history DATA, not a claimed valid native contract.
  });

  it.each(['protected',undefined,null,false,42,'future-protection'])('keeps every non-ordinary marker protected (%s)', protectionMode => {
    expect(hasProtectedIntentProducerHistory({intents:[{producerReports:[{protectionMode}]}]})).toBe(true);
  });

  it('preserves nullish absence and latestPlan-only detection', () => {
    expect(hasProtectedIntentProducerHistory(undefined)).toBe(false);
    expect(hasProtectedIntentProducerHistory(null)).toBe(false);
    expect(hasProtectedIntentProducerHistory({nativeContracts:null,intents:null,latestPlan:null})).toBe(false);
    expect(hasProtectedIntentProducerHistory({latestPlan:{producerReports:[{}]}})).toBe(true);
  });

  it('preserves copy/plan/property read order including duplicate latestPlan access', () => {
    const events:string[]=[];
    const report={get protectionMode(){events.push('mode');return 'ordinary';}};
    const row={get producerReports(){events.push('reports');return [report];}};
    const intents=[row];
    Object.defineProperty(intents,Symbol.iterator,{value:function*(){events.push('iterate');yield row;}});
    const data:IntentProtectedHistoryData={get nativeContracts(){events.push('native');return [];},get intents(){events.push('intents');return intents;},get latestPlan(){events.push('plan');return row;}};
    expect(hasProtectedIntentProducerHistory(data)).toBe(false);
    expect(events).toEqual(['native','intents','iterate','plan','plan','reports','mode','reports','mode']);
  });

  it('does not cache a first latestPlan value to hide a malformed second read', () => {
    let reads=0;
    const data:IntentProtectedHistoryData={intents:[],get latestPlan(){reads+=1;return reads===1?{producerReports:[{protectionMode:'ordinary'}]}:undefined;}};
    expect(()=>hasProtectedIntentProducerHistory(data)).toThrow();
    expect(reads).toBe(2);
    // Old code also rejects the undefined row; this is expected before PASS, not runtime RED.
  });

  it('stops report iteration on the first protected marker', () => {
    const second={get protectionMode(){throw Error('must_not_read');}};
    expect(hasProtectedIntentProducerHistory({intents:[{producerReports:[{},second]}]})).toBe(true);
  });

  it.each([
    {nativeContracts:{}}, {nativeContracts:{length:0}}, {nativeContracts:'x'},
    {intents:{}}, {intents:[null]}, {intents:[{producerReports:{some(){return false;}}}]},
    {intents:[{producerReports:[null]}]},
  ])('rejects present malformed history instead of replacing it with an empty list', data => {
    expect(()=>hasProtectedIntentProducerHistory(data)).toThrow();
  });
});
