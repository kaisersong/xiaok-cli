import {types} from 'node:util';
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys,define=Object.defineProperty as (target:object,key:PropertyKey,attributes:PropertyDescriptor&{__proto__?:null})=>object;
function denied():never{throw Error('KSWARM_ORIGINAL_CHILD_SOURCE_REQUIRED');}
export function data(value:unknown,fields:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||types.isProxy(value))return denied();const ds=Object.getOwnPropertyDescriptors(value),names=keys(ds);if(names.length!==fields.length)return denied();for(let index=0;index<names.length;index++){let found=false;for(let field=0;field<fields.length;field++)if(names[index]===fields[field])found=true;if(!found)return denied();}const result=Object.create(null) as Record<string,unknown>;for(let index=0;index<fields.length;index++){const name=fields[index]!;const d=ds[name];if(!d||!own(d,'value'))return denied();define(result,name,{__proto__:null,value:d.value,enumerable:true});}return result;
}
export function method(value:object,name:string):Function{const d=descriptor(value,name);if(!d||!own(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))return denied();return d.value;}
export function setField(target:Record<string,unknown>,name:string,value:unknown):void{define(target,name,{__proto__:null,value,writable:true,enumerable:true,configurable:false});}
