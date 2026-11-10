import {expect,it} from 'vitest';
import {retainSourceErrorTails} from '../../../src/runtime/verification/source-error-tails.js';
it('accepts only the captured native Promise constructor metadata and keeps own-symbol siblings',()=>{
 const raw=Promise.resolve(),tail=new Promise<void>(()=>{}),rows:Array<{raw:unknown;kind:string}>=[];
 Object.defineProperty(raw,'constructor',{value:Promise});Object.defineProperty(raw,Symbol('owned-sdk-tail'),{value:tail});
 retainSourceErrorTails(raw,(raw,kind)=>rows.push({raw,kind}));
 expect(rows.filter(row=>row.kind==='unknown')).toEqual([]);expect(rows.filter(row=>row.kind==='promise').map(row=>row.raw)).toEqual(expect.arrayContaining([raw,tail]));
});
it('does not hide a new SDK tail on the actual intrinsic constructor, or a foreign/getter constructor',()=>{
 const key=Symbol('intrinsic-extra-tail'),tail=new Promise<void>(()=>{}),raw=Promise.resolve(),rows:unknown[]=[];
 Object.defineProperty(raw,'constructor',{value:Promise});Object.defineProperty(Promise,key,{value:tail,configurable:true});
 try{retainSourceErrorTails(raw,(value,kind)=>{if(kind==='promise')rows.push(value);});expect(rows).toContain(tail);}finally{Reflect.deleteProperty(Promise,key);}
 let calls=0;const getter=Object.defineProperty(Promise.resolve(),'constructor',{get(){calls++;throw Error('must not read');}}),unknown:unknown[]=[];
 retainSourceErrorTails(getter,(value,kind)=>{if(kind==='unknown')unknown.push(value);});expect(calls).toBe(0);expect(unknown).toContain(getter);
 const foreign=Object.defineProperty(Promise.resolve(),'constructor',{value:function Foreign(){}});unknown.length=0;
 retainSourceErrorTails(foreign,(value,kind)=>{if(kind==='unknown')unknown.push(value);});expect(unknown.length).toBeGreaterThan(0);
});
