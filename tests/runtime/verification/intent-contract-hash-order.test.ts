import {Hash} from 'node:crypto';
import {beforeAll,expect,it,vi} from 'vitest';
let intentApplicationCandidate:typeof import('../../support/intent-application-fixture.js')['intentApplicationCandidate'];
let createIntentApplicationBinding:typeof import('../../../src/runtime/verification/intent-application-binding.js')['createIntentApplicationBinding'];
let parseIntentApplicationBinding:typeof import('../../../src/runtime/verification/intent-application-binding.js')['parseIntentApplicationBinding'];
let intentBusinessContractHash:typeof import('../../../src/runtime/verification/intent-business-contract.js')['intentBusinessContractHash'];
const capturedObserver={active:false,contractCalls:0,recipeCalls:0,failure:undefined as Error|undefined};
beforeAll(async()=>{
 // Observe trusted first-load references; never weaken afterimport poison protection.
 vi.resetModules();
 const define=Object.defineProperty,get=Object.getOwnPropertyDescriptor,own=Object.hasOwn,apply=Reflect.apply;
 const prior:PropertyDescriptor & {__proto__?:null}={__proto__:null,...get(Hash.prototype,'update')!},update=prior.value;
 const observer=function(this:Hash,input:unknown,...args:unknown[]){
  if(capturedObserver.active){
   if(input==='xiaok-intent-business-contract-v1\0'){capturedObserver.contractCalls++;throw capturedObserver.failure;}
   capturedObserver.recipeCalls++;
  }
  return apply(update,this,[input,...args]);
 };
 const installed={__proto__:null,...prior,value:observer};define(Hash.prototype,'update',installed);
 let importFailed=false,importFailure:unknown;
 try{
  const fixture=await import('../../support/intent-application-fixture.js');
  const binding=await import('../../../src/runtime/verification/intent-application-binding.js');
  const contract=await import('../../../src/runtime/verification/intent-business-contract.js');
  intentApplicationCandidate=fixture.intentApplicationCandidate;
  createIntentApplicationBinding=binding.createIntentApplicationBinding;
  parseIntentApplicationBinding=binding.parseIntentApplicationBinding;
  intentBusinessContractHash=contract.intentBusinessContractHash;
 }catch(error){importFailed=true;importFailure=error;throw error;}
 finally{
  try{
   const current=get(Hash.prototype,'update');
   if(!current)throw Error('hash_observer_restoration_conflict');
   for(const field of ['value','writable','get','set','enumerable','configurable'] as const){
    if(own(current,field)!==own(installed,field)||own(current,field)&&current[field]!==installed[field])throw Error('hash_observer_restoration_conflict');
   }
   define(Hash.prototype,'update',prior);
  }catch(error){if(importFailed)throw new AggregateError([importFailure,error],'hash_observer_initialization_failed');throw error;}
 }
});
function withCapturedDomainFailure(run:(proof:{contractCalls:()=>number;recipeCalls:()=>number;failure:Error})=>void){
 const failure=Error('actual contract domain failure');capturedObserver.contractCalls=0;capturedObserver.recipeCalls=0;capturedObserver.failure=failure;capturedObserver.active=true;
 try{run({contractCalls:()=>capturedObserver.contractCalls,recipeCalls:()=>capturedObserver.recipeCalls,failure});}
 finally{capturedObserver.active=false;capturedObserver.failure=undefined;}
}

// Target only this documented hash domain. Goal recipe hashes must still run.
const domain='xiaok-intent-business-contract-v1\0';
function withDomainFailure(run:(proof:{contractCalls:()=>number;recipeCalls:()=>number;failure:Error})=>void){
 const prior=Object.getOwnPropertyDescriptor(Hash.prototype,'update')!,update=prior.value,apply=Reflect.apply;
 const failure=Error('actual contract domain failure');let contractCalls=0,recipeCalls=0;
 Object.defineProperty(Hash.prototype,'update',{...prior,value:function(this:Hash,input:unknown,...args:unknown[]){
  if(input===domain){contractCalls++;throw failure;}
  recipeCalls++;return apply(update,this,[input,...args]);
 }});
 try{run({contractCalls:()=>contractCalls,recipeCalls:()=>recipeCalls,failure});}
 finally{Object.defineProperty(Hash.prototype,'update',prior);}
}
for(const parent of [false,true])for(const mode of ['create','parse'] as const){
 it(`keeps ${mode} ${parent?'parent':'stage'} body errors before actual contract domain hashing`,()=>{
  const candidate=structuredClone(intentApplicationCandidate(parent));
  const valid=mode==='create'?candidate:structuredClone(createIntentApplicationBinding(candidate));
  const invalid=structuredClone(valid);invalid.body.unrecognized=true;
  const parse=mode==='create'?createIntentApplicationBinding:parseIntentApplicationBinding;
  withCapturedDomainFailure(proof=>{
   expect(()=>parse(invalid)).toThrow('intent_application_shape');
   expect(proof.contractCalls()).toBe(0);expect(proof.recipeCalls()).toBeGreaterThan(0);
   expect(()=>parse(valid)).toThrow(proof.failure);expect(proof.contractCalls()).toBe(1);
  });
 });
}
it.each(['proxy','version','accessor'])('keeps public hash domain initialization before malformed %s input',mode=>{
 let reads=0;const raw=structuredClone(intentApplicationCandidate()).contract;
 const value=mode==='proxy'?new Proxy(raw,{get(){reads++;throw Error('trap');},ownKeys(){reads++;throw Error('trap');},getPrototypeOf(){reads++;throw Error('trap');}}):raw;
 if(mode==='version')raw.version=2;
 if(mode==='accessor')Object.defineProperty(raw,'rawIntent',{enumerable:true,get(){reads++;throw Error('getter');}});
 withDomainFailure(proof=>{
  expect(()=>intentBusinessContractHash(value)).toThrow(proof.failure);
  expect(proof.contractCalls()).toBe(1);expect(proof.recipeCalls()).toBe(0);expect(reads).toBe(0);
 });
});
