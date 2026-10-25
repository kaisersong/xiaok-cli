import {assertRegistrationIntrinsics} from './registration-intrinsics.js';

// Startup-native readers only. This SDK construction check is deliberately
// separate from the general JSON/snapshot own-data boundary.
const NativeError=Error,NativeNumber=Number,NativeString=String;
const integer=Number.isInteger,ownKeys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor;
const objectPrototype=Object.prototype;
const metadataFields=['name','column','table','database','type'] as const;
function fail():never{throw new NativeError('application_registration_changed');}

/** Fresh check before SDK ArrayAppender; never a brand or authorization. */
export function assertNativeSqliteArrayConstruction():void{
 assertRegistrationIntrinsics();
 const keys=ownKeys(objectPrototype);
 for(let i=0;i<keys.length;i++){
  const key=keys[i]!;
  if(typeof key!=='string')continue;
  const index=NativeNumber(key);
  if(integer(index)&&index>=0&&index<4294967295&&NativeString(index)===key&&descriptor(objectPrototype,key)!==undefined)fail();
 }
}

/** Native columns() uses Set for these fixed fields and array indices. */
export function assertNativeSqliteColumnConstruction():void{
 assertNativeSqliteArrayConstruction();
 for(let i=0;i<metadataFields.length;i++)if(descriptor(objectPrototype,metadataFields[i]!)!==undefined)fail();
}
