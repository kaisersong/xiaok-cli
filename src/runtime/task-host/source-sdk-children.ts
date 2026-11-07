import {types} from 'node:util';
import {createIntrinsicSet,appendIntrinsic} from '../verification/intrinsic-async-collection.js';
const descriptors=Object.getOwnPropertyDescriptors,keys=Reflect.ownKeys,own=Object.hasOwn,prototype=Object.getPrototypeOf;
const descriptor=Object.getOwnPropertyDescriptor,create=Object.create,define=Object.defineProperty;
const isPromise=types.isPromise,isProxy=types.isProxy,isError=types.isNativeError,isArray=Array.isArray;
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype;
const stack=Object.getOwnPropertyDescriptor(new Error(),'stack');

/** Inspect only own descriptors. The Store retains/observes returned originals;
 * this pure inventory neither grants custody nor calls a getter/then/toJSON. */
export function scanTaskStoreSdkChildren(root:unknown,rootPromise=false):{promises:unknown[];unknowns:unknown[]}{
 const seen=createIntrinsicSet<object>(),promises:unknown[]=[],unknowns:unknown[]=[];
 let nodes=0;
 function walk(value:unknown,depth:number,skipPromise=false):void{
  if(value===null||typeof value!=='object'&&typeof value!=='function')return;
  if(isProxy(value)){appendIntrinsic(unknowns,value);return;}
  if(seen.has(value))return;seen.add(value);
  if(++nodes>65536||depth>128){appendIntrinsic(unknowns,value);return;}
  const promise=isPromise(value);
  if(promise&&!skipPromise){appendIntrinsic(promises,value);return;}
  const error=isError(value),proto=prototype(value);
  if(!promise&&!error&&(typeof value==='function'||proto!==null&&proto!==objectPrototype&&(!isArray(value)||proto!==arrayPrototype)))appendIntrinsic(unknowns,value);
  // Read descriptors only. An unrelated unknown accessor must not hide known
  // own data siblings, including a Promise stored under the name stack.
  let rows:PropertyDescriptorMap;
  if(error){
   rows=create(null);const names=keys(value);
   for(let i=0;i<names.length;i++){const name=names[i]!,row=descriptor(value,name);if(row)define(rows,name,{__proto__:null,value:row,enumerable:true} as PropertyDescriptor);}
  }else rows=descriptors(value);
  const names=keys(rows);
  for(let i=0;i<names.length;i++){
   const name=names[i]!,row=rows[name as string]!;
   if(!own(row,'value')){
    // V8's module-born lazy Error.stack is not a caller accessor. It is never
    // evaluated; all custom accessors, including cause, remain unconfirmed.
    if(error&&name==='stack'&&stack&&typeof stack.get==='function'&&!own(stack,'value')&&row.get===stack.get&&row.set===stack.set)continue;
    appendIntrinsic(unknowns,value);continue;
   }
   walk(row.value,depth+1);
  }
 }
 walk(root,0,rootPromise);return{promises,unknowns};
}
