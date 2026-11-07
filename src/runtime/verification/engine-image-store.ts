import {types} from 'node:util';

/** Data check only. The installed lifecycle independently authenticates the engine. */
export function assertPrivateEngineImageStore(info: unknown): void {
 const fail=()=>{throw Error('private_engine_image_store');};
 const data=(value:object,key:PropertyKey):unknown=>{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))return fail();
  return descriptor.value;
 };
 if(!info||typeof info!=='object'||types.isProxy(info))return fail();
 if(data(info,'Driver')!=='overlay2')return fail();
 const rows=data(info,'DriverStatus');
 if(!Array.isArray(rows)||types.isProxy(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length>64||Reflect.ownKeys(rows).length!==rows.length+1)return fail();
 for(let index=0;index<rows.length;index++){
  const row=data(rows,String(index));
  if(!Array.isArray(row)||types.isProxy(row)||Object.getPrototypeOf(row)!==Array.prototype||row.length!==2||Reflect.ownKeys(row).length!==3)return fail();
  const key=data(row,'0'),value=data(row,'1');
  if(typeof key!=='string'||!key.length||key.length>1024||typeof value!=='string'||value.length>1024||key==='driver-type')return fail();
 }
}
