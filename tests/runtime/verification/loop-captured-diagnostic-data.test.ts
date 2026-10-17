import {describe,expect,it} from 'vitest';
import {ownDataCapturedDiagnosticString} from '../../../src/runtime/verification/application-native-intrinsics.js';
import {createLoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopVariant} from '../../support/application-own-data-r64-fixtures.js';

describe('Loop captured-data diagnostics',()=>{
 it.each([
  [undefined,'undefined'],[null,'null'],[true,'true'],[42,'42'],['fixed','fixed'],
  [{},'[object Object]'],[[], ''],[[null,undefined,1,{}],',,1,[object Object]'],
  [[[1,2],[3]],'1,2,3'],
 ])('formats captured data without dispatch (%s)',(value,text)=>{
  expect(ownDataCapturedDiagnosticString(value)).toBe(text);
 });
 it('preserves non-callable own toString rejection',()=>{
  expect(()=>ownDataCapturedDiagnosticString({toString:0})).toThrow(TypeError);
 });
 it.each([{},['parallel']])('rejects malformed concurrency enum (%s)',value=>{
  const candidate=loopVariant('template');
  if(candidate.contract.kind!=='user-template')throw Error('fixture kind');
  const valid=candidate.contract.loopContract;
  expect(()=>createLoopApplicationBinding({...candidate,contract:{...candidate.contract,loopContract:{...valid,concurrencyPolicy:{...valid.concurrencyPolicy,perLoop:value as unknown as typeof valid.concurrencyPolicy.perLoop}}}})).toThrow('Unsupported LoopContract concurrency perLoop: '+(Array.isArray(value)?'parallel':'[object Object]'));
 });
 it.each([{},['read_only']])('rejects malformed permission enum (%s)',value=>{
  const candidate=loopVariant('template');
  if(candidate.contract.kind!=='user-template')throw Error('fixture kind');
  const valid=candidate.contract.loopContract;
  expect(()=>createLoopApplicationBinding({...candidate,contract:{...candidate.contract,loopContract:{...valid,permissionPolicy:{...valid.permissionPolicy,mode:value as unknown as typeof valid.permissionPolicy.mode}}}})).toThrow('Unsupported LoopContract permission mode: '+(Array.isArray(value)?'read_only':'[object Object]'));
 });
 it.each(['throwing','forged'] as const)('does not invoke prototype conversion hooks (%s)',mode=>{
  const candidate=loopVariant('template');
  if(candidate.contract.kind!=='user-template')throw Error('fixture kind');
  const valid=candidate.contract.loopContract;
  const malformed={...candidate,contract:{...candidate.contract,loopContract:{...valid,concurrencyPolicy:{...valid.concurrencyPolicy,perLoop:{} as typeof valid.concurrencyPolicy.perLoop}}}};
  const original=Object.getOwnPropertyDescriptor(Object.prototype,'toString')!;
  let calls=0;let result:unknown;let thrown:unknown;
  const poisoned=mode==='throwing'?{__proto__:null,configurable:true,get(){calls++;throw Error('unexpected conversion');}}:{__proto__:null,configurable:true,writable:true,value(){calls++;return 'parallel';}};
  try{
   Object.defineProperty(Object.prototype,'toString',poisoned);
   try{result=createLoopApplicationBinding(malformed);}catch(error){thrown=error;}
  }finally{Object.defineProperty(Object.prototype,'toString',original);}
  expect(result).toBeUndefined();expect(calls).toBe(0);
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe('Unsupported LoopContract concurrency perLoop: [object Object]');
  expect(()=>createLoopApplicationBinding(candidate)).not.toThrow();
 });
});
