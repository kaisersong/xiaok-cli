import {types} from 'node:util';
import {createIntrinsicSet} from '../verification/intrinsic-async-collection.js';
const descriptors=Object.getOwnPropertyDescriptors,descriptor=Object.getOwnPropertyDescriptor,ownKeys=Reflect.ownKeys,own=Object.hasOwn;
const prototype=Object.getPrototypeOf,create=Object.create,define=Object.defineProperty,setPrototype=Object.setPrototypeOf,freeze=Object.freeze;
const NativeArray=Array,isArray=Array.isArray,isProxy=types.isProxy,isPromise=types.isPromise,finite=Number.isFinite,integer=Number.isSafeInteger;
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype,json=JSON.stringify,bytes=Buffer.byteLength,number=Number,string=String;
/** Closed JSON data only. This is never an admission proof. Unsafe originals
 * are retained by the owner before this function rejects their shape. */
export function captureDispatchBusinessData(raw:unknown,onUnsafe:(raw:unknown)=>void=()=>{},omitUndefinedObjectFields=false):unknown{
 const path=createIntrinsicSet<object>(),unsafe=createIntrinsicSet<unknown>();let nodes=0,invalid=false;
 const bad=(value:unknown)=>{invalid=true;if(value!==null&&(typeof value==='object'||typeof value==='function'))unsafe.add(value);};
 function walk(value:unknown,depth:number):unknown{
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!finite(value))invalid=true;return value;}
  if(!value||typeof value!=='object'&&typeof value!=='function'){bad(value);return null;}
  if(isProxy(value)){bad(value);return null;}
  if(typeof value==='function'||isPromise(value))bad(value);
  const array=isArray(value),proto=prototype(value);
  if(array?proto!==arrayPrototype&&proto!==null:proto!==objectPrototype&&proto!==null)bad(value);
  if(++nodes>1_000_000||depth>128||path.has(value)){bad(value);return null;}path.add(value);
  const rows=descriptors(value),names=ownKeys(rows),length=array?rows.length?.value:0;
  if(own(rows,'then'))bad(value);
  const validLength=!array||integer(length)&&length>=0&&length<=1_000_000;if(!validLength)bad(value);
  const out=array&&validLength?new NativeArray(length):create(null);if(array&&validLength)setPrototype(out,null);
  for(let i=0;i<names.length;i++){
   const name=names[i]!,row=rows[name as string]!;if(array&&name==='length')continue;
   if(!own(row,'value')){bad(value);continue;}
   if(typeof name!=='string'||!row.enumerable){bad(value);walk(row.value,depth+1);continue;}
   if(!array&&omitUndefinedObjectFields===true&&row.value===undefined)continue;
   if(array){const index=number(name);if(!validLength||!integer(index)||index<0||index>=length||string(index)!==name){bad(value);walk(row.value,depth+1);continue;}}
   define(out,name,{__proto__:null,value:walk(row.value,depth+1),enumerable:true} as PropertyDescriptor);
  }
  if(array&&names.length!==length+1)bad(value);path.delete(value);return freeze(out);
 }
 const result=walk(raw,0),retained=unsafe.snapshot();for(let i=0;i<retained.length;i++)onUnsafe(retained[i]);
 if(invalid||bytes(json(result),'utf8')>8*1024*1024)throw Error('DISPATCH_BUSINESS_DATA_INVALID');return result;
}
/** Fixed foreign-protocol routing, never sender or user authentication. */
export function dispatchBusinessProtocolTag(raw:unknown):string|undefined{
 if(!raw||typeof raw!=='object'||isProxy(raw)||isArray(raw))return;
 const row=descriptor(raw,'protocol');return row&&own(row,'value')&&typeof row.value==='string'?row.value:undefined;
}
