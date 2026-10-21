import { describe, expect, it } from 'vitest';
import { captureToolDescriptionMetadata } from '../../src/shared/tool-description-metadata.js';

describe('descriptive metadata capture', () => {
 it('copies and freezes snapshots without freezing input; permits shared references',()=>{
  const shared={type:'string'},raw={outputSchema:{properties:{a:shared,b:shared}},effect:'read' as const,idempotency:'unknown' as const};
  const snapshot=captureToolDescriptionMetadata(raw)!;shared.type='number';
  expect(snapshot.outputSchema).toEqual({properties:{a:{type:'string'},b:{type:'string'}}});expect(Object.isFrozen(snapshot)).toBe(true);expect(Object.isFrozen(raw)).toBe(false);
 });
 it('omits unspecified fields and ignores inherited getters',()=>{
  expect(captureToolDescriptionMetadata(undefined)).toBeUndefined();expect(captureToolDescriptionMetadata({effect:undefined})).toBeUndefined();
  const inherited=Object.getOwnPropertyDescriptor(Object.prototype,'effect');let calls=0;
  try {Object.defineProperty(Object.prototype,'effect',{configurable:true,get(){calls++;throw Error('getter');}});expect(captureToolDescriptionMetadata({outputSchema:{type:'string'}})).toEqual({outputSchema:{type:'string'}});expect(calls).toBe(0);}
  finally {if(inherited)Object.defineProperty(Object.prototype,'effect',inherited);else delete (Object.prototype as any).effect;}
 });
 it('rejects root/nested proxies and accessors without executing user code',()=>{
  let calls=0;const proxy=new Proxy({}, {ownKeys(){calls++;throw Error('trap');},getPrototypeOf(){calls++;throw Error('trap');}});
  for(const raw of [proxy,{outputSchema:proxy},Object.defineProperty({},'effect',{enumerable:true,get(){calls++;return 'read';}}),{outputSchema:Object.defineProperty({},'type',{enumerable:true,get(){calls++;return 'string';}})}])expect(()=>captureToolDescriptionMetadata(raw as any)).toThrow();expect(calls).toBe(0);
 });
 it('rejects unknown keys, sparse/cyclic/non-json values and budgets',()=>{
  const cycle:any={};cycle.a=cycle;
  for(const raw of [{unknown:'read'},{effect:'wrong'},{outputSchema:[,1]},{outputSchema:cycle},{outputSchema:{x:()=>1}},{outputSchema:{x:'x'.repeat(65537)}},{outputSchema:Array(4097).fill(0)},Object.defineProperty({},'effect',{value:'read'})])expect(()=>captureToolDescriptionMetadata(raw as any)).toThrow();
 });
});


it('enforces exact inclusive output budgets and deep immutable data',()=>{
 expect(captureToolDescriptionMetadata({outputSchema:'x'.repeat(65536)})?.outputSchema).toHaveLength(65536);
 expect(()=>captureToolDescriptionMetadata({outputSchema:'x'.repeat(65537)})).toThrow();
 expect((captureToolDescriptionMetadata({outputSchema:Array(4095).fill(0)})?.outputSchema as any[])).toHaveLength(4095);
 expect(()=>captureToolDescriptionMetadata({outputSchema:Array(4096).fill(0)})).toThrow();
 let nested:any='leaf';for(let i=0;i<64;i++)nested={x:nested};expect(captureToolDescriptionMetadata({outputSchema:nested})).toBeDefined();nested={x:nested};expect(()=>captureToolDescriptionMetadata({outputSchema:nested})).toThrow();
 const schema:any=captureToolDescriptionMetadata({outputSchema:{properties:{x:{type:'string'}}}})?.outputSchema;expect(Object.isFrozen(schema.properties.x)).toBe(true);
});


it.each(['get','set'])('never invokes inherited internal descriptor %s accessors',key=>{
 let calls=0,error:unknown,snapshot:unknown;const attributes=Object.create(null);attributes.configurable=true;attributes.get=()=>{calls++;throw Error('prototype descriptor getter');};
 const previous=Object.getOwnPropertyDescriptor(Object.prototype,key);Object.defineProperty(Object.prototype,key,attributes);
 try{snapshot=captureToolDescriptionMetadata({effect:'read'});}catch(e){error=e;}
 finally{if(previous)Object.defineProperty(Object.prototype,key,previous);else delete (Object.prototype as any)[key];}
 expect(calls).toBe(0);expect(error).toBeUndefined();expect(snapshot).toEqual({effect:'read'});
});
