import {assertStandardIpcPromise} from './native-ipc-promise.js';
const NativeSet=Set,NativeArray=Array,NativePromise=Promise,apply=Reflect.apply;
const add=Set.prototype.add,remove=Set.prototype.delete,has=Set.prototype.has,values=Set.prototype.values;
const size=Object.getOwnPropertyDescriptor(Set.prototype,'size')!.get!;
const next=Object.getPrototypeOf(new Set().values()).next,define=Object.defineProperty,freeze=Object.freeze;
const then=NativePromise.prototype.then,nativeString=String;
// A failed observer must not release its original raw merely because the
// caller has received an error. This helper is local bookkeeping, not custody.
const unobserved=new NativeSet<unknown>();
export function createIntrinsicSet<T>() {
 const set=new NativeSet<T>();
 return freeze({
  get size():number{return apply(size,set,[]);},
  add(value:T):void{apply(add,set,[value]);},
  delete(value:T):void{apply(remove,set,[value]);},
  has(value:T):boolean{return apply(has,set,[value]);},
  snapshot():T[]{
   const result:T[]=[],iterator=apply(values,set,[]);let index=0;
   for(;;){const row=apply(next,iterator,[]) as IteratorResult<T>;if(row.done)break;define(result,nativeString(index++),{__proto__:null,value:row.value,writable:true,configurable:true,enumerable:true} as PropertyDescriptor);}
   return result;
  },
 });
}
/** Invoke every admitted local operation and join its actual standard Promise;
 * no mutable Set/Array iterator, map or Promise constructor is consulted. */
export function settleIntrinsicOperations<T,R=void>(items:readonly T[],work:(item:T)=>Promise<R>):Promise<PromiseSettledResult<R>[]> {
 return new NativePromise(resolve=>{
  const results=new NativeArray<PromiseSettledResult<R>>(items.length);let remaining=items.length;
  if(!remaining){resolve(results);return;}
  const done=(index:number,result:PromiseSettledResult<R>)=>{define(results,nativeString(index),{__proto__:null,value:result,writable:true,configurable:true,enumerable:true} as PropertyDescriptor);if(--remaining===0)resolve(results);};
  for(let i=0;i<items.length;i++){
   let raw:unknown;
   try{raw=work(items[i]!);assertStandardIpcPromise(raw,'LOCAL_OPERATION_OBSERVATION_UNKNOWN');void apply(then,raw,[(value:R)=>done(i,{status:'fulfilled',value}),(reason:unknown)=>done(i,{status:'rejected',reason})]);}
   catch(reason){if(raw!==undefined)apply(add,unobserved,[raw]);done(i,{status:'rejected',reason});}
  }
 });
}

export function appendIntrinsic<T>(items:T[],value:T):void {
 define(items,nativeString(items.length),{__proto__:null,value,writable:true,configurable:true,enumerable:true} as PropertyDescriptor);
}
const NativeAggregateError=AggregateError;
/** Error aggregation must preserve every original reason even if a callback
 * changed Array.push, flatMap or the ambient iterator. */
export function aggregateIntrinsicErrors(errors:readonly unknown[],message:string):AggregateError {
 const iterable={
  [Symbol.iterator](){let index=0;return {next(){return index<errors.length?{done:false,value:errors[index++]}:{done:true,value:undefined};}};},
 };
 return new NativeAggregateError(iterable,message);
}
