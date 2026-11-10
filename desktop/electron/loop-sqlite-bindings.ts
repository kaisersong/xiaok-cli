import {types} from 'node:util';

const isProxy=types.isProxy,keys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor;
const prototype=Object.getPrototypeOf,plain=Object.prototype,array=Array.isArray;
const freeze=Object.freeze,create=Object.create,define=Object.defineProperty;
const arrayPrototype=Array.prototype,hasOwn=Object.prototype.hasOwnProperty,apply=Reflect.apply;
const integer=Number.isSafeInteger,number=Number,toString=String,NativeError=Error;
type Scalar=null|string|number|bigint;
function scalar(value:unknown):Scalar {
 if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='bigint')return value;
 throw new NativeError('loop_sqlite_binding_value');
}
/** Data projection only, never a Source/SQL permission. No caller objects are
 * passed to Native after the writer's final fresh check. */
export function captureLoopSQLiteBindings(args:readonly unknown[]):readonly unknown[] {
 if(isProxy(args)||!array(args)||prototype(args)!==arrayPrototype)throw new NativeError('loop_sqlite_binding_arguments');
 const length=descriptor(args,'length');
 if(!length||!apply(hasOwn,length,['value'])||!integer(length.value)||length.value<0)throw new NativeError('loop_sqlite_binding_arguments');
 for(const key of keys(args))if(key!=='length'&&(typeof key!=='string'||!integer(number(key))||number(key)<0||number(key)>=length.value||toString(number(key))!==key))throw new NativeError('loop_sqlite_binding_arguments');
 const values:unknown[]=[];
 for(let i=0;i<length.value;i++){
  const slot=descriptor(args,toString(i));if(!slot||!apply(hasOwn,slot,['value']))throw new NativeError('loop_sqlite_binding_arguments');
  define(values,toString(i),{value:slot.value,enumerable:true,writable:true,configurable:true});
 }
 if(values.length===1&&values[0]!==null&&typeof values[0]==='object'){
  const named=values[0];if(isProxy(named))throw new NativeError('loop_sqlite_binding_object');
  const parent=prototype(named);if(parent!==null&&parent!==plain)throw new NativeError('loop_sqlite_binding_object');
  const snapshot=create(null) as Record<string,Scalar>;
  for(const key of keys(named)){
   if(typeof key!=='string')throw new NativeError('loop_sqlite_binding_key');
   const field=descriptor(named,key);
   if(!field||!apply(hasOwn,field,['value'])||field.enumerable!==true)throw new NativeError('loop_sqlite_binding_descriptor');
   define(snapshot,key,{value:scalar(field.value),enumerable:true,writable:true,configurable:true});
  }
  return freeze([freeze(snapshot)]);
 }
 const result:Scalar[]=[];
 for(let i=0;i<values.length;i++)define(result,toString(i),{value:scalar(values[i]),enumerable:true,writable:true,configurable:true});
 return freeze(result);
}
