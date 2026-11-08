import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {captureIntentDependencyFixtureBase,createIntentDependencyFixtureLifetime} from '../../support/intent-dependency-fixture-lifetime.js';

it('attempts the actual underlying database close when receiver close throws undefined, once and with its original receiver',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE actual(value)');let receiverCloses=0,fixtureCloses=0;
 const original={async close(preserveRoot=false){expect(this).toBe(original);expect(preserveRoot).toBe(true);fixtureCloses++;db.close();}};
 const receiver={async close(){expect(this).toBe(receiver);receiverCloses++;throw undefined;}};
 const owner=createIntentDependencyFixtureLifetime();
 await owner.captureFixture(Promise.resolve(original));await owner.captureReceiver(Promise.resolve(receiver));
 const first=owner.close();let failure:unknown;try{await first;}catch(raw){failure=raw;}
 expect(failure).toBeInstanceOf(AggregateError);expect(Object.getOwnPropertyDescriptor(failure as object,'cause')?.value).toBeUndefined();
 expect((failure as AggregateError).errors).toEqual([undefined]);expect(()=>db.prepare('SELECT 1')).toThrow();
 expect(owner.close()).toBe(first);await expect(owner.close()).rejects.toBe(failure);expect(receiverCloses).toBe(1);expect(fixtureCloses).toBe(1);
});
it('keeps an undefined setup first cause ahead of every cleanup error and still closes the actual database',async()=>{
 const db=new DatabaseSync(':memory:'),receiverFailure=new Error('receiver cleanup'),fixtureFailure=new Error('fixture cleanup');let closes=0;
 const owner=createIntentDependencyFixtureLifetime();await owner.captureFixture(Promise.resolve({async close(){closes++;db.close();throw fixtureFailure;}}));
 await owner.captureReceiver(Promise.resolve({async close(){throw receiverFailure;}}));owner.fail(undefined);
 let failure:unknown;try{await owner.close();}catch(raw){failure=raw;}
 expect((failure as AggregateError).errors).toEqual([undefined,receiverFailure,fixtureFailure]);expect(Object.getOwnPropertyDescriptor(failure as object,'cause')?.value).toBeUndefined();expect(closes).toBe(1);expect(()=>db.prepare('SELECT 1')).toThrow();
});
it('closes an acquired original fixture after receiver construction rejects without a returned receiver',async()=>{
 const db=new DatabaseSync(':memory:'),owner=createIntentDependencyFixtureLifetime(),raw=new Error('receiver construction');let closes=0;
 await owner.captureFixture(Promise.resolve({async close(preserveRoot=false){expect(preserveRoot).toBe(true);closes++;db.close();}}));
 await expect(owner.captureReceiver(Promise.reject(raw))).rejects.toBe(raw);owner.fail(raw);await owner.close();expect(closes).toBe(1);expect(()=>db.prepare('SELECT 1')).toThrow();
});
it('releases each successful per-case fixture without sharing or retaining the next case database',async()=>{
 for(let i=0;i<2;i++){
  const db=new DatabaseSync(':memory:'),owner=createIntentDependencyFixtureLifetime();let receiverCloses=0;
  await owner.captureFixture(Promise.resolve({async close(preserveRoot=false){expect(preserveRoot).toBe(false);db.close();}}));await owner.captureReceiver(Promise.resolve({async close(){receiverCloses++;}}));
  await owner.close();expect(receiverCloses).toBe(1);expect(()=>db.prepare('SELECT 1')).toThrow();
 }
});

it('publishes the exact close flight before an original receiver synchronously reenters',async()=>{
 const owner=createIntentDependencyFixtureLifetime();let entered=0,reentered:Promise<void>|undefined;
 await owner.captureFixture(Promise.resolve({async close(){}}));await owner.captureReceiver(Promise.resolve({close(){entered++;reentered=owner.close();}}));
 const first=owner.close();expect(reentered).toBe(first);await first;expect(entered).toBe(1);
});
it('attempts the immediately captured original base when the verified wrapper never returns or fails to close',async()=>{
 for(const returned of [false,true]){
  const db=new DatabaseSync(':memory:'),owner=createIntentDependencyFixtureLifetime(),failure=new Error('wrapper failure');let baseCloses=0;
  const base={async close(preserveRoot=false){expect(this).toBe(base);expect(preserveRoot).toBe(true);baseCloses++;db.close();}};
  captureIntentDependencyFixtureBase(owner,base);
  if(returned)await owner.captureFixture(Promise.resolve({async close(){throw failure;}}));
  else{await expect(owner.captureFixture(Promise.reject(failure))).rejects.toBe(failure);owner.fail(failure);}
  if(returned)await expect(owner.close()).rejects.toThrow('intent_dependency_fixture_cleanup_unknown');else await owner.close();
  expect(baseCloses).toBe(1);expect(()=>db.prepare('SELECT 1')).toThrow();
 }
});
it('foreign passive owners fail before proxy traps or a base close',()=>{
 let traps=0,closes=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
 expect(()=>captureIntentDependencyFixtureBase(proxy,{close(){closes++;}})).toThrow('intent_dependency_fixture_owner');expect(traps).toBe(0);expect(closes).toBe(0);
});
