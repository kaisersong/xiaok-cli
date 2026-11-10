// @vitest-environment node
import {expect,it} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
import {settleIntrinsicOperations} from '../../../src/runtime/verification/intrinsic-async-collection.js';

it('invokes every operation, joins the held raw, and preserves its value and a synchronous sibling failure',async()=>{
 const value=[Error('original drain failure')],failure=Error('synchronous sibling failure');
 let release!:(value:Error[])=>void;
 const raw=new Promise<Error[]>(yes=>{release=yes;});
 const invoked:number[]=[];
 let settled=false;
 const closing=settleIntrinsicOperations([0,1],index=>{
  invoked.push(index);
  if(index===0)throw failure;
  return raw;
 }).then(result=>{settled=true;return result;});
 expect(invoked).toEqual([0,1]);
 await delay(10);
 expect(settled).toBe(false);
 release(value);
 const results=await closing;
 expect(results[0]).toEqual({status:'rejected',reason:failure});
 expect(results[1]?.status).toBe('fulfilled');
 if(results[1]?.status==='fulfilled')expect(results[1].value).toBe(value);
});
