import {types} from 'node:util';
const nativeProxy=types.isProxy,NativeError=Error;
import {assertRegistrationIntrinsics} from './registration-intrinsics.js';
/** Private comparison data only. No SQL/current result or authorization is cached. */
export function captureRegistrationSnapshot<T>(input:T,freeze=true):T{
 assertRegistrationIntrinsics();
 const ancestors=new Set<object>();
 const visit=(value:unknown):unknown=>{
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value===0?0:value;
  if(value!==null&&typeof value==='object'&&nativeProxy(value))throw new NativeError('verification_invalid_record');
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))throw new NativeError('verification_invalid_record');
  if(ancestors.has(value))throw new NativeError('verification_invalid_record');
  ancestors.add(value);
  try{
   const descriptors=Object.getOwnPropertyDescriptors(value) as Record<PropertyKey,PropertyDescriptor>;
   for(const key of Reflect.ownKeys(descriptors))if(!Object.hasOwn(descriptors[key]!,'value'))throw new NativeError('verification_accessor_denied');
   let result:unknown[]|Record<string,unknown>;
   if(Array.isArray(value)){
    result=[];
    for(let i=0;i<value.length;i++){
     const key=String(i);
     if(!Object.hasOwn(descriptors,key))throw new NativeError('verification_invalid_record');
     const descriptor=descriptors[key]!;
     if(!Object.hasOwn(descriptor,'value'))throw new NativeError('verification_invalid_record');
     Object.defineProperty(result,i,{__proto__:null,value:visit(descriptor.value),enumerable:true,writable:true,configurable:true} as PropertyDescriptor);
    }
   }else{
    result={};
    for(const key of Object.keys(value))Object.defineProperty(result,key,{__proto__:null,value:visit(descriptors[key]!.value),enumerable:true,writable:true,configurable:true} as PropertyDescriptor);
   }
   return freeze?Object.freeze(result):result;
  }finally{ancestors.delete(value);}
 };
 return visit(input) as T;
}
