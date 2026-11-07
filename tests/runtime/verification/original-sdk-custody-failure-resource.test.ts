import {expect,it} from 'vitest';
import {createRoomTurnCustody} from '../../../src/runtime/verification/original-sdk-custody.js';

it('a fixed failure resource retains the original first cause and joins its actual memory resource',async()=>{
 const custody=createRoomTurnCustody(),error=Object.assign(new Error('fixture SDK rejection'),{headers:new Headers({'x-fixture':'owned'})});
 function close(){}
 await expect(custody.sdk(()=>Promise.reject(error),undefined,[],{accept:()=>false,consumer:close,failureResource:{accept:value=>value===error,consumer:close,strictProxyGraph:true}})).rejects.toBe(error);
 expect(()=>custody.accepted()).toThrow(error);expect(()=>custody.assertPhysicalKnown()).toThrow();
 await custody.consumeResource(close,error,[]);await custody.waitPhysicalKnown();custody.assertPhysicalKnown();
 // Data custody alone supplies no Native port, permit or original SDK receipt.
});
it('ordinary rejection behavior still treats an unowned Native object as unknown',async()=>{
 const custody=createRoomTurnCustody(),error=Object.assign(new Error('ordinary SDK error'),{headers:new Headers()});
 await expect(custody.sdk(()=>Promise.reject(error),undefined,[])).rejects.toBe(error);
 await expect(custody.waitPhysicalKnown()).rejects.toThrow();
});
it('strict failure resource reflection rejects nested Proxy and accessor without invoking either and retains a sibling tail',async()=>{
 const custody=createRoomTurnCustody();let traps=0,getters=0,release!:()=>void;
 const tail=new Promise<void>(yes=>{release=yes;}),error=Object.assign(new Error('fixture source'),{headers:new Headers()});
 Object.defineProperty(error,'untrusted',{get(){getters++;throw Error('forbidden getter');}});
 (error as unknown as Record<symbol,unknown>)[Symbol('proxy')]=new Proxy({}, {ownKeys(){traps++;throw Error('forbidden ownKeys');},getOwnPropertyDescriptor(){traps++;throw Error('forbidden descriptor');},get(){traps++;throw Error('forbidden get');}});
 (error as unknown as Record<symbol,unknown>)[Symbol('sibling')]=tail;
 function close(){}
 await expect(custody.sdk(()=>Promise.reject(error),undefined,[],{accept:()=>false,consumer:close,failureResource:{accept:value=>value===error,consumer:close,strictProxyGraph:true}})).rejects.toBe(error);
 await custody.consumeResource(close,error,[]);let settled=false;const ending=custody.waitPhysicalKnown().then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(yes=>setTimeout(yes,10));expect(settled).toBe(false);expect(traps).toBe(0);expect(getters).toBe(0);release();await ending;expect(()=>custody.assertPhysicalKnown()).toThrow();expect(traps).toBe(0);expect(getters).toBe(0);
});
it('a new original error symbol tail added before its fixed cleanup cannot be dropped',async()=>{
 const custody=createRoomTurnCustody(),error=Object.assign(new Error('fixture late tail'),{headers:new Headers()});let release!:()=>void;const tail=new Promise<void>(yes=>{release=yes;});function close(){}
 await expect(custody.sdk(()=>Promise.reject(error),undefined,[],{accept:()=>false,consumer:close,failureResource:{accept:value=>value===error,consumer:close,strictProxyGraph:true}})).rejects.toBe(error);
 (error as unknown as Record<symbol,unknown>)[Symbol('late')]=tail;await custody.consumeResource(close,error,[]);let settled=false;const ending=custody.waitPhysicalKnown().then(()=>{settled=true;});await new Promise(yes=>setTimeout(yes,10));expect(settled).toBe(false);release();await ending;custody.assertPhysicalKnown();
});
