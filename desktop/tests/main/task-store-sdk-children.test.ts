// @vitest-environment node
import {expect,it} from 'vitest';
import {scanTaskStoreSdkChildren} from '../../../src/runtime/task-host/source-sdk-children.js';

it('inventories symbol/non-enumerable and Error.cause raws without calling sibling accessors',()=>{
 const raw=new Promise<void>(()=>{}),failure=new Error('original',{cause:{raw}});
 const value=Object.create(null);let reads=0;
 Object.defineProperty(value,Symbol('actual-sdk-sidecar'),{value:failure});
 Object.defineProperty(value,'unsafe',{get(){reads++;return raw;}});
 const result=scanTaskStoreSdkChildren(value);
 expect(reads).toBe(0);expect(result.promises.length).toBe(1);expect(result.promises[0]).toBe(raw);expect(result.unknowns.some(row=>row===value)).toBe(true);
 expect(scanTaskStoreSdkChildren(new Error('actual V8 error')).unknowns).toEqual([]);
});
it('retains a truncated original while still inventorying its independently visible sibling raw',()=>{
 let deep:any={};const original=deep;
 for(let i=0;i<140;i++)deep=deep.next={};
 const raw=new Promise<void>(()=>{}),result=scanTaskStoreSdkChildren({deep:original,raw});
 expect(result.promises).toEqual([raw]);expect(result.unknowns.length).toBeGreaterThan(0);
});
