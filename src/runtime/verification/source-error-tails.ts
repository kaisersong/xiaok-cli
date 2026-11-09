import {types,transferableAbortController} from 'node:util';
import {createIntrinsicSet} from './intrinsic-async-collection.js';
const keys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,prototype=Object.getPrototypeOf;
const isProxy=types.isProxy,isPromise=types.isPromise,isError=types.isNativeError,isArray=Array.isArray;
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype;
const NativePromise=Promise,nativePromisePrototype=NativePromise.prototype;
const intrinsicMetadata=new WeakMap<object,{proto:object|null;rows:Array<{name:PropertyKey;row:PropertyDescriptor}>}>();
const intrinsicApply=Reflect.apply,intrinsicGet=WeakMap.prototype.get,intrinsicSet=WeakMap.prototype.set;
// The native constructor slot is legal Promise metadata. Capture its actual
// baseline graph, so later own/symbol additions are still inventoried rather
// than exempting the whole mutable constructor/prototype graph.
function captureIntrinsic(value:object):void {
 if(intrinsicApply(intrinsicGet,intrinsicMetadata,[value])||isProxy(value))return;
 const rows:Array<{name:PropertyKey;row:PropertyDescriptor}>=[];intrinsicApply(intrinsicSet,intrinsicMetadata,[value,{proto:prototype(value),rows}]);
 const names=keys(value);for(let i=0;i<names.length;i++){const name=names[i]!,row=descriptor(value,name);if(!row)continue;rows[rows.length]={name,row};if(own(row,'value'))captureChild(row.value);else{captureChild(row.get);captureChild(row.set);}}
 function captureChild(child:unknown){if(child!==null&&(typeof child==='object'||typeof child==='function'))captureIntrinsic(child);}
}
captureIntrinsic(NativePromise);
const originalStack=descriptor(new Error(),'stack'),stackGet=originalStack?.get,stackSet=originalStack?.set;
// Take the genuine Node brand from its internal AbortController, rather than
// a replaceable DOMException global (including a renderer/jsdom implementation).
// No signal is transferred, so this creates no MessagePort or timer.
const domNameGet=(()=>{
 const controller=transferableAbortController();controller.abort();
 return descriptor(prototype(controller.signal.reason),'name')?.get;
})();
function hasOriginalDomBrand(value:object):boolean {
 if(typeof domNameGet!=='function')return false;
 // The captured Node getter checks its private WeakMap, without reading any
 // user slot. An invalid receiver is an expected brand miss, not an SDK result.
 try{intrinsicApply(domNameGet,value,[]);return true;}catch{return false;}
}
/** Inventory original SDK failure/outcome data without formatting it. V8's
 * diagnostic stack getter may execute name/message getters: inspect only its
 * descriptor, never its formatted value.
 * This supplies no authority: the original owner retains the error and raws. */
export function retainSourceErrorTails(error:unknown,retain:(raw:unknown,kind:'promise'|'unknown')=>void):void {
  const seen=createIntrinsicSet<unknown>(),reportedPromises=createIntrinsicSet<unknown>(),reportedUnknown=createIntrinsicSet<unknown>();let count=0;
  const hold=(value:unknown,kind:'promise'|'unknown'='unknown')=>{const reported=kind==='promise'?reportedPromises:reportedUnknown;if(!reported.has(value)){reported.add(value);retain(value,kind);}};
  const nativeSeen=createIntrinsicSet<object>();
  function nativeMetadata(value:object,depth:number):void {
    if(nativeSeen.has(value))return;nativeSeen.add(value);
    if(++count>100000||depth>128||isProxy(value)){hold(value);return;}
    const baseline=intrinsicApply(intrinsicGet,intrinsicMetadata,[value]) as {proto:object|null;rows:Array<{name:PropertyKey;row:PropertyDescriptor}>}|undefined;if(!baseline){walk(value,depth);return;}
    if(prototype(value)!==baseline.proto)hold(value);
    const names=keys(value),present=createIntrinsicSet<PropertyKey>();
    for(let i=0;i<names.length;i++){
      const name=names[i]!;present.add(name);const row=descriptor(value,name);let old:PropertyDescriptor|undefined;
      for(let j=0;j<baseline.rows.length;j++)if(baseline.rows[j]!.name===name){old=baseline.rows[j]!.row;break;}
      if(!row){hold(value);continue;}
      if(!old){if(!own(row,'value'))hold(value);else walk(row.value,depth+1);continue;}
      const same=row.configurable===old.configurable&&row.enumerable===old.enumerable&&own(row,'value')===own(old,'value')&&(own(row,'value')?row.value===old.value&&row.writable===old.writable:row.get===old.get&&row.set===old.set);
      if(!same){hold(value);if(own(row,'value'))walk(row.value,depth+1);continue;}
      const inspect=(child:unknown)=>{if(child!==null&&(typeof child==='object'||typeof child==='function'))nativeMetadata(child,depth+1);};if(own(row,'value'))inspect(row.value);else{inspect(row.get);inspect(row.set);}
    }
    for(let i=0;i<baseline.rows.length;i++)if(!present.has(baseline.rows[i]!.name))hold(value);
  }
  function walk(value:unknown,depth:number):void {
    if(value===null||typeof value!=='object'&&typeof value!=='function'||seen.has(value))return;
    seen.add(value);if(isProxy(value)){hold(value);return;}
    if(++count>100000||depth>128){hold(value);return;}
    const promise=isPromise(value),array=isArray(value),proto=prototype(value);
    const nativeError=isError(value)||(!promise&&!array&&typeof value==='object'&&proto!==objectPrototype&&proto!==null&&hasOriginalDomBrand(value));
    if(promise)hold(value,'promise');
    else if(typeof value==='function'||!nativeError&&(array?proto!==arrayPrototype&&proto!==null:proto!==objectPrototype&&proto!==null))hold(value);
    const names=keys(value);
    for(let i=0;i<names.length;i++){
      const name=names[i]!,row=descriptor(value,name);
      // Only the captured Native diagnostic accessor is exempt. An own data
      // property named stack is ordinary outcome data and can contain tails.
      if(nativeError&&name==='stack'&&row&&!own(row,'value')&&typeof stackGet==='function'&&row.get===stackGet&&row.set===stackSet)continue;
      if(!row||!own(row,'value')){hold(value);continue;}
      if(promise&&proto===nativePromisePrototype&&name==='constructor'&&row.value===NativePromise){nativeMetadata(NativePromise,depth+1);continue;}
      if(name==='then')hold(value);
      walk(row.value,depth+1);
    }
  }
  walk(error,0);
}
