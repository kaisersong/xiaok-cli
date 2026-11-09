import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
const isProxy=types.isProxy,ownKeys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf;
/** Pure data only. Reject proxies before reflection and never execute a getter,
 * toJSON, coercion or serializer supplied by a source/SDK record. */
export function captureAssistantDerivedValue<T>(raw:T):T{
 const seen=new Set<object>();let nodes=0;
 function read(value:unknown,depth:number):unknown{
  if(++nodes>200000||depth>64)throw Error('assistant_derived_data_limit');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||isProxy(value)||seen.has(value))throw Error('assistant_derived_data');
  const array=Array.isArray(value),proto=prototype(value);if(!array&&proto!==Object.prototype&&proto!==null)throw Error('assistant_derived_data');
  seen.add(value);try{
   const keys=ownKeys(value);if(keys.some(key=>typeof key!=='string'))throw Error('assistant_derived_data');
   const fields=new Map(keys.map(key=>{const d=descriptor(value,key);if(!d||!('value' in d))throw Error('assistant_derived_accessor');return [key,d.value] as const;}));
   if(array){const length=fields.get('length');if(!Number.isSafeInteger(length)||length<0||length>200000||fields.size!==length+1)throw Error('assistant_derived_data');const result=[];for(let i=0;i<length;i++){if(!fields.has(String(i)))throw Error('assistant_derived_data');result.push(read(fields.get(String(i)),depth+1));}return Object.freeze(result);}
   const entries=[...fields].filter(([,value])=>value!==undefined).map(([key,value])=>[key,read(value,depth+1)]);return Object.freeze(Object.fromEntries(entries));
  }finally{seen.delete(value);}
 }
 return read(raw,0) as T;
}
export function assistantDerivedHash(raw:unknown):string{return createHash('sha256').update(canonicalVerificationJson(captureAssistantDerivedValue(raw))).digest('hex');}
