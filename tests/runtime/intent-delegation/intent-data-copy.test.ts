import {expect,it} from 'vitest';
import {captureIntentData} from '../../../src/runtime/intent-delegation/data.js';

it('captures a fresh mutable copy, preserving shared inputs as independent outputs',()=>{
 const child={name:'original'},raw={first:child,second:child,array:[child]};
 const copied=captureIntentData(raw);
 expect(copied).toEqual(raw);expect(copied).not.toBe(raw);
 expect(copied.first).not.toBe(child);expect(copied.first).not.toBe(copied.second);
 expect(copied.array[0]).not.toBe(child);
 copied.first.name='changed';expect(child.name).toBe('original');expect(copied.second.name).toBe('original');
});

it('retains own hidden data and safe __proto__ data, while omitting undefined object fields',()=>{
 const raw=Object.create(null);
 Object.defineProperty(raw,'hidden',{value:7,enumerable:false});
 Object.defineProperty(raw,'__proto__',{value:{polluted:'data'},enumerable:true});
 Object.defineProperty(raw,'missing',{value:undefined,enumerable:true});
 const copied=captureIntentData(raw);
 expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
 expect(Object.getOwnPropertyDescriptor(copied,'hidden')).toMatchObject({value:7,enumerable:true,writable:true,configurable:true});
 expect(Object.getOwnPropertyDescriptor(copied,'__proto__')?.value).toEqual({polluted:'data'});
 expect(Object.hasOwn(copied,'missing')).toBe(false);expect(Object.hasOwn(Object.prototype,'polluted')).toBe(false);
});

it('does not invoke own input getters or array accessors',()=>{
 let reads=0;const raw={};Object.defineProperty(raw,'secret',{get(){reads++;throw Error('getter');}});
 expect(()=>captureIntentData(raw)).toThrow('intent_commit_accessor');
 const array=[1];Object.defineProperty(array,'0',{get(){reads++;throw Error('array getter');}});
 expect(()=>captureIntentData(array)).toThrow('intent_commit_data');expect(reads).toBe(0);
});

it('rejects root and nested proxies without invoking any trap',()=>{
 let traps=0;const proxy=new Proxy({a:1},{ownKeys(){traps++;return ['a'];},getOwnPropertyDescriptor(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},get(){traps++;throw Error('trap');}});
 expect(()=>captureIntentData(proxy)).toThrow('intent_commit_data');
 expect(()=>captureIntentData({nested:proxy})).toThrow('intent_commit_data');expect(traps).toBe(0);
});

it('rejects nonplain prototypes without reading inherited getters',()=>{
 let reads=0;const prototype={get value(){reads++;throw Error('inherited');}};
 expect(()=>captureIntentData(Object.create(prototype))).toThrow('intent_commit_data');expect(reads).toBe(0);
 expect(()=>captureIntentData(new Date(0))).toThrow('intent_commit_data');
});

it('rejects cycles but accepts repeated acyclic references',()=>{
 const raw:{child?:unknown}={};raw.child=raw;
 expect(()=>captureIntentData(raw)).toThrow('intent_commit_data');
 const child={x:1};expect(captureIntentData({a:child,b:child})).toEqual({a:{x:1},b:{x:1}});
});

it.each([{value:undefined},{value:1n},{value:()=>1},{value:NaN},{value:Infinity},{value:Symbol('x')}])('rejects unsupported scalar $value',({value})=>{
 expect(()=>captureIntentData(value)).toThrow('intent_commit_data');
});

it('rejects symbol keys before reading accessor values',()=>{
 let reads=0;const raw={};Object.defineProperty(raw,'a',{get(){reads++;throw Error('getter');}});
 Object.defineProperty(raw,Symbol('extra'),{value:1});
 expect(()=>captureIntentData(raw)).toThrow('intent_commit_accessor');expect(reads).toBe(0);
});

it('retains dense-array checks and rejects extra names and undefined entries',()=>{
 expect(captureIntentData([1,null,'three'])).toEqual([1,null,'three']);
 expect(()=>captureIntentData(new Array(1))).toThrow('intent_commit_array');
 const extra=[1];Object.defineProperty(extra,'extra',{value:1});
 expect(()=>captureIntentData(extra)).toThrow('intent_commit_array');
 expect(()=>captureIntentData([undefined])).toThrow('intent_commit_data');
});

it('preserves the original depth128 object boundary',()=>{
 let accepted:unknown={};for(let i=0;i<128;i++)accepted={next:accepted};
 expect(()=>captureIntentData(accepted)).not.toThrow();
 expect(()=>captureIntentData({next:accepted})).toThrow('intent_commit_data');
});

it('preserves the original16MiB serialized-byte boundary',()=>{
 const maximum=16*1024*1024;
 expect(captureIntentData('a'.repeat(maximum-2)).length).toBe(maximum-2);
 expect(()=>captureIntentData('a'.repeat(maximum-1))).toThrow('intent_commit_limit');
});

it('does not consult the mutable global Array iterator or input toJSON accessors',()=>{
 const original=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator)!;
 let reads=0,copied:unknown,failure:unknown;
 try{
  Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,get(){reads++;throw Error('global iterator');}});
  copied=captureIntentData({array:[1,2]});
 }catch(error){failure=error;}finally{Object.defineProperty(Array.prototype,Symbol.iterator,original);}
 expect(failure).toBeUndefined();expect(reads).toBe(0);expect(copied).toEqual({array:[1,2]});
 const raw={};Object.defineProperty(raw,'toJSON',{get(){reads++;throw Error('toJSON');}});
 expect(()=>captureIntentData(raw)).toThrow('intent_commit_accessor');expect(reads).toBe(0);
});
