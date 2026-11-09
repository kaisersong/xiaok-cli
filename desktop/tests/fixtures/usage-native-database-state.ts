import {expect} from 'vitest';
import {types} from 'node:util';
import type {DatabaseSync} from 'node:sqlite';
/** Test-only native observations. No result is supplied to production custody or authorization. */
export function captureUsageNativeOpen(db:DatabaseSync):()=>boolean {
 const descriptor=Object.getOwnPropertyDescriptor(db,'isOpen');
 if(descriptor){
  if(descriptor.configurable!==false||typeof descriptor.get!=='function')throw Error('usage_native_descriptor_invalid');
  const get=descriptor.get;
  return ()=>{const value:unknown=Reflect.apply(get,db,[]);if(typeof value!=='boolean')throw Error('usage_native_state_invalid');return value;};
 }
 // Node 22.14 has no isOpen accessor. Verify the real SQLite operation and
 // exact native closed-database error; any other failure is retained raw.
 return ()=>{
  let row:unknown;
  try{row=db.prepare('SELECT 1 AS alive').get();}
  catch(error){
   if(types.isNativeError(error)&&Object.getOwnPropertyDescriptor(error,'code')?.value==='ERR_INVALID_STATE'&&
     Object.getOwnPropertyDescriptor(error,'message')?.value==='database is not open')return false;
   throw error;
  }
  expect(row).toEqual({alive:1});return true;
 };
}
