import {expect,it} from 'vitest';
import {nativeJournalLengthData} from '../../../src/runtime/intent-delegation/data.js';

it.each([undefined,null])('preserves nullish %s without a fabricated length',value=>{
 expect(nativeJournalLengthData(value)).toBeUndefined();
});
it.each([
 {label:'empty',value:[],length:0},
 {label:'mixed entries',value:[null,Symbol('ordinary-data')],length:2},
 {label:'sparse',value:new Array(3),length:3},
])('reads only the actual $label array length',({value,length})=>{
 expect(nativeJournalLengthData(value)).toBe(length);
});
it.each([
 {label:'arraylike object',value:{length:2}},
 {label:'string',value:'ab'},
 {label:'number',value:0},
 {label:'boolean',value:false},
 {label:'symbol',value:Symbol('ordinary-data')},
 {label:'function',value:()=>[]},
])('rejects $label with the original error',({value})=>{
 expect(()=>nativeJournalLengthData(value)).toThrowError(new Error('intent_native_journal'));
});
it('does not read a nonarray length getter',()=>{
 let reads=0;
 const value={get length(){reads++;throw Error('unexpected length read');}};
 expect(()=>nativeJournalLengthData(value)).toThrowError(new Error('intent_native_journal'));
 expect(reads).toBe(0);
});
it('does not inspect array entries or run an entry getter',()=>{
 let reads=0;const value:unknown[]=[];
 Object.defineProperty(value,'0',{get(){reads++;throw Error('unexpected entry read');},configurable:true});
 expect(nativeJournalLengthData(value)).toBe(1);
 expect(reads).toBe(0);
});
it('reads an array proxy length once through the original property access',()=>{
 let reads=0;
 const value=new Proxy([1,2],{get(target,key,receiver){if(key==='length')reads++;return Reflect.get(target,key,receiver);}});
 expect(nativeJournalLengthData(value)).toBe(2);
 expect(reads).toBe(1);
});
it('preserves the original Array.isArray TypeError for a revoked proxy',()=>{
 const value=Proxy.revocable([],{});value.revoke();
 expect(()=>nativeJournalLengthData(value.proxy)).toThrow(TypeError);
});
