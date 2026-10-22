// @vitest-environment node
import {describe,it,expect,inject} from 'vitest';
import {realpathSync} from 'node:fs';
import {userInfo} from 'node:os';
import {randomUUID} from 'node:crypto';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';
import {DatabaseSync} from 'node:sqlite';
import {Ap10NativeFaultProbe,isExactAp10LedgerResult,isAp10UpstreamReceiptSet,isAp10ScopeReceiptSet,throwAp10Original} from '../fixtures/ap10-native-fault-cleanup.js';
import type {SqliteWithAuthorizer} from '../fixtures/multi-agent-authorization.js';
const guardReferences:Map<string,unknown>[]=[];
Object.defineProperty(process,Symbol('ap10-native-guard-owners'),{value:guardReferences,writable:false,configurable:false});
const multi=(a:unknown,b:unknown)=>new AggregateError([a,b],'multi_agent_identity_and_stop_failed',{cause:a});
describe('AP10 actual native provenance and strict closed-ledger guards',()=>{
 it('observes the actual same-DB Statement.run reauthorization fault only in G without disk or provider',()=>{
  const retained=new Map<string,unknown>();guardReferences.push(retained);
  const account=inject('profileTestAccountOwnership' as never);retained.set('accountOwnership',account);assertProfileAccountWorkerReleased(account);
  const lease=acquireProfileAccountLease(account,realpathSync(userInfo().homedir),randomUUID().replaceAll('-',''));retained.set('accountLease',lease);
  const db=new DatabaseSync(':memory:') as SqliteWithAuthorizer;retained.set('database',db);
  let probe:Ap10NativeFaultProbe|undefined,restored=false;
  try{
   db.exec('CREATE TABLE groups(group_id TEXT)');
   probe=new Ap10NativeFaultProbe(db);retained.set('probe',probe);probe.install();probe.runNativeGuard();
   const receipts=probe.diagnostics();expect(receipts.guardFaults).toHaveLength(1);
   expect(receipts.guardFaults[0]).toMatchObject({method:'run'});expect(receipts.guardFaults[0]!.denies).toBeGreaterThan(0);
   expect(receipts.nativeFaults).toEqual([]);expect(receipts.ledgerCount).toBe(0);expect(receipts.businessDenies).toBe(0);expect(receipts.observerErrors).toBe(0);
   probe.restore();restored=true;
  }finally{if(restored){db.close();lease.release();retained.set('released',true);}}
 });
 it('accepts one exact native Error and refuses a same-text different object',()=>{
  const f=new Error('native');expect(isExactAp10LedgerResult(f,[f])).toBe(true);
  expect(isExactAp10LedgerResult(new Error('native'),[f])).toBe(false);
 });
 it.for([undefined,null] as const)('keeps nullable %s in presence and rejects it as a native F',value=>{
  expect(isExactAp10LedgerResult(value,[value])).toBe(false);
  let observed:{error:unknown}|undefined;try{throwAp10Original([value]);}catch(error){observed={error};}
  expect(observed).toBeDefined();expect(observed!.error).toBe(value);
 });
 it('accepts the exact native multi-leaf shape and rejects wrong order or extra U',()=>{
  const a=new Error('a'),b=new Error('b'),u=new Error('U');
  expect(isExactAp10LedgerResult(multi(a,b),[a,b])).toBe(true);
  expect(isExactAp10LedgerResult(multi(b,a),[a,b])).toBe(false);
  expect(isExactAp10LedgerResult(new AggregateError([a,b,u],'multi_agent_identity_and_stop_failed',{cause:a}),[a,b])).toBe(false);
 });
 it('rejects wrong cause, extra own data and hidden leaf cause without traversing the unknown object',()=>{
  const a=new Error('a'),b=new Error('b'),u=new Error('U');
  const wrong=multi(a,b);Object.defineProperty(wrong,'cause',{value:u});expect(isExactAp10LedgerResult(wrong,[a,b])).toBe(false);
  const extra=multi(a,b);Object.defineProperty(extra,'unexpected',{value:u});expect(isExactAp10LedgerResult(extra,[a,b])).toBe(false);
  Object.defineProperty(a,'cause',{value:u});expect(isExactAp10LedgerResult(a,[a])).toBe(false);
 });
 it('never calls arbitrary top/array/leaf getters or Proxy traps',()=>{
  const a=new Error('a'),b=new Error('b');let reads=0;
  for(const key of ['message','cause','errors','stack']){
   const value=multi(a,b);Object.defineProperty(value,key,{get(){reads++;throw Error('getter');},configurable:true});
   expect(isExactAp10LedgerResult(value,[a,b])).toBe(false);
  }
  const value=multi(a,b);const list=[a,b];Object.defineProperty(list,'0',{get(){reads++;throw Error('array getter');}});Object.defineProperty(value,'errors',{value:list});
  expect(isExactAp10LedgerResult(value,[a,b])).toBe(false);
  Object.defineProperty(a,'message',{get(){reads++;throw Error('leaf getter');}});expect(isExactAp10LedgerResult(a,[a])).toBe(false);
  const proxied=new Proxy(multi(new Error('x'),b),{getOwnPropertyDescriptor(){reads++;throw Error('trap');},getPrototypeOf(){reads++;throw Error('trap');},ownKeys(){reads++;throw Error('trap');}});
  expect(isExactAp10LedgerResult(proxied,[b,b])).toBe(false);expect(reads).toBe(0);
 });
 it('preserves multiple original cleanup refs and cause without deduplicating nullable slots',()=>{
  const u=new Error('U');let result:unknown;
  try{throwAp10Original([undefined,u,null]);}catch(error){result=error;}
  expect(result).toBeInstanceOf(AggregateError);const aggregate=result as AggregateError;
  expect(aggregate.errors).toHaveLength(3);expect(aggregate.errors[0]).toBeUndefined();expect(aggregate.errors[1]).toBe(u);expect(aggregate.errors[2]).toBeNull();
  expect(Object.getOwnPropertyDescriptor(aggregate,'cause')!.value).toBeUndefined();
 });
 it('rejects any missing/pending/rejected or foreign upstream receipt even when public C is the expected ref',()=>{
  // These are unit inputs to the actual receipt verifier, not physical release
  // evidence or factory/actor capabilities. No product API consumes them.
  const captured={services:{},service:{},host:{},codex:{},approval:{}};
  const expected=new Error('F');
  const row=(name:string,receiver:object,ok=true)=>({name,receiver,args:[],raw:Promise.resolve(),rawWritten:true,outcome:ok?{ok:true,value:undefined}:{ok:false,error:expected}});
  const slots=[row('facadeDispose',captured.services,false),row('serviceDispose',captured.service,false),row('rawDisposeOwned',captured.service),row('codexDispose',captured.codex),row('approvalDispose',captured.approval),row('hostDrain',captured.host)];
  type Rows=Parameters<typeof isAp10UpstreamReceiptSet>[0];type Captured=Parameters<typeof isAp10UpstreamReceiptSet>[1];
  const check=(rows:unknown)=>isAp10UpstreamReceiptSet(rows as Rows,captured as Captured,expected);
  expect(check(slots)).toBe(true);
  for(let i=0;i<slots.length;i++){
   expect(check(slots.filter((_,j)=>i!==j))).toBe(false);
   expect(check(slots.map((r,j)=>i===j?{...r,outcome:undefined}:r))).toBe(false);
   expect(check(slots.map((r,j)=>i===j?{...r,receiver:{}}:r))).toBe(false);
  }
  expect(check([...slots,slots[2]])).toBe(false);
  expect(check(slots.map((r,i)=>i===2?{...r,outcome:{ok:false,error:new Error('U')}}:r))).toBe(false);
  expect(check(slots.map((r,i)=>i===0?{...r,outcome:{ok:true,value:undefined}}:r))).toBe(false);
  expect(check(slots.map((r,i)=>i===1?{...r,raw:slots[2]!.raw}:r))).toBe(false);
 });
 it('requires the one actual handle dispose receipt and its original authority signal to be aborted',()=>{
  const handle={},controller=new AbortController();controller.abort();
  const row={name:'scopeDispose',receiver:handle,args:[],raw:undefined,rawWritten:true,outcome:{ok:true as const,value:undefined}};
  const scopes=[{handle,signal:controller.signal,calls:[row]}];
  expect(isAp10ScopeReceiptSet(scopes)).toBe(true);expect(isAp10ScopeReceiptSet([])).toBe(false);
  expect(isAp10ScopeReceiptSet([{...scopes[0]!,calls:[]}])).toBe(false);
  expect(isAp10ScopeReceiptSet([{...scopes[0]!,calls:[row,row]}])).toBe(false);
  expect(isAp10ScopeReceiptSet([{...scopes[0]!,calls:[{...row,outcome:{ok:false,error:new Error('U')}}]}])).toBe(false);
  expect(isAp10ScopeReceiptSet([{...scopes[0]!,signal:new AbortController().signal}])).toBe(false);
 });

});
