import {expect,it} from 'vitest';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,parseIntentApplicationBinding} from '../../../src/runtime/verification/intent-application-binding.js';
import {parseIntentBusinessContract,intentBusinessContractHash} from '../../../src/runtime/verification/intent-business-contract.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

function mutableCandidate(){return structuredClone(intentApplicationCandidate());}
function proxy(){let calls=0;return {value:new Proxy({},{get(){calls++;throw Error('trap');},getPrototypeOf(){calls++;throw Error('trap');},ownKeys(){calls++;throw Error('trap');},getOwnPropertyDescriptor(){calls++;throw Error('trap');}}),calls:()=>calls};}
it.each(['create','parse'] as const)('rejects a contract Proxy without traps through actual %s application',mode=>{
 const raw:any=mode==='create'?mutableCandidate():structuredClone(createIntentApplicationBinding(mutableCandidate())),trapped=proxy();raw.contract=trapped.value;
 expect(()=>mode==='create'?createIntentApplicationBinding(raw):parseIntentApplicationBinding(raw)).toThrow('intent_application_data');expect(trapped.calls()).toBe(0);
});
it.each(['accessor','symbol','hole','cycle','nodes','depth'])('preserves complete contract data rejection before semantic parsing: %s',mode=>{
 const raw:any=mutableCandidate();let reads=0;
 if(mode==='accessor')Object.defineProperty(raw.contract.stages[0],'label',{get(){reads++;return 'poison';},enumerable:true});
 else if(mode==='symbol')raw.contract.stages[0][Symbol('hidden')]=true;
 else if(mode==='hole')delete raw.contract.stages[0];
 else if(mode==='cycle')raw.contract.stages[0].steps[0].dependsOn=[raw.contract];
 else if(mode==='nodes')raw.contract.explicitConstraints=Array(65536).fill('');
 else {let nested:any=null;for(let i=0;i<65;i++)nested={next:nested};raw.contract.unrecognized=nested;}
 expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_data');expect(reads).toBe(0);
});
it('keeps the exact whole contract byte boundary, hashes and deep immutable capture',()=>{
 const raw=mutableCandidate();raw.contract.rawIntent='';raw.contract.rawIntent='x'.repeat(65536-Buffer.byteLength(json(raw.contract)));
 expect(Buffer.byteLength(json(raw.contract))).toBe(65536);const parsed=createIntentApplicationBinding(raw);
 expect(parsed.contract).toEqual(raw.contract);expect(parsed.contractHash).toBe(intentBusinessContractHash(raw.contract));expect(Object.isFrozen(parsed.contract.stages[0]!.steps)).toBe(true);
 raw.contract.rawIntent+='x';expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_limit');expect(()=>parseIntentBusinessContract(raw.contract)).toThrow('intent_contract_limit');expect(parsed.contract.rawIntent.length).toBe(raw.contract.rawIntent.length-1);
});
it.each(['shape','version','bytes'])('keeps contract %s errors ahead of body Proxy errors without traps',mode=>{
 const raw:any=mutableCandidate(),trapped=proxy();raw.body=trapped.value;
 if(mode==='shape')raw.contract.unrecognized=true;else if(mode==='version')raw.contract.version=2;else raw.contract.rawIntent='x'.repeat(65537);
 expect(()=>createIntentApplicationBinding(raw)).toThrow(mode==='shape'?'intent_contract_shape':mode==='version'?'intent_contract_version':'intent_application_limit');expect(trapped.calls()).toBe(0);
});
it('still rejects a body Proxy after complete valid contract parsing',()=>{
 const raw:any=mutableCandidate(),trapped=proxy();raw.body=trapped.value;expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_data');expect(trapped.calls()).toBe(0);
});
it('keeps negative zero and independent snapshots of shared input arrays',()=>{
 const raw=mutableCandidate();raw.contract.stages[0]!.order=-0;const shared=['original repeated text'];raw.contract.explicitConstraints=shared;raw.contract.delegationBoundary=shared;
 const parsed=createIntentApplicationBinding(raw);expect(Object.is(parsed.contract.stages[0]!.order,-0)).toBe(true);expect(parsed.contract.explicitConstraints).not.toBe(parsed.contract.delegationBoundary);expect(parsed.contract.explicitConstraints).toEqual(shared);
 shared.push('late caller change');expect(parsed.contract.explicitConstraints).toEqual(['original repeated text']);expect(Object.isFrozen(parsed.contract.delegationBoundary)).toBe(true);
});
it('treats missing and inherited body kind as the original missing-body error without reading Object.prototype',()=>{
 const raw:any=structuredClone(createIntentApplicationBinding(mutableCandidate()));delete raw.body.kind;const prior=Object.getOwnPropertyDescriptor(Object.prototype,'kind');let reads=0,error='';
 try{Object.defineProperty(Object.prototype,'kind',{configurable:true,get(){reads++;return 'intent-stage';}});try{parseIntentApplicationBinding(raw);}catch(e){error=(e as Error).message;}}
 finally{if(prior)Object.defineProperty(Object.prototype,'kind',prior);else Reflect.deleteProperty(Object.prototype,'kind');}
 expect(error).toBe('intent_application_body');expect(reads).toBe(0);
});
