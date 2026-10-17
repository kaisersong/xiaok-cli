import {types} from 'node:util';
/** Capture handles only; no caller getters, iterator, Proxy or owner authority. */
export function captureOwnerBindingBatch(raw:readonly object[]):object[]{
 if(types.isProxy(raw)||!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype)throw Error('metadata_owner_batch');
 const length=Object.getOwnPropertyDescriptor(raw,'length')!.value as number;
 if(length<1||length>131073||Reflect.ownKeys(raw).length!==length+1)throw Error('metadata_owner_batch');
 const captured:object[]=[];
 for(let i=0;i<length;i++){
  const field=Object.getOwnPropertyDescriptor(raw,String(i));
  if(!field||!('value'in field)||!field.value||typeof field.value!=='object')throw Error('metadata_owner_batch');
  captured.push(field.value as object);
 }
 return captured;
}
