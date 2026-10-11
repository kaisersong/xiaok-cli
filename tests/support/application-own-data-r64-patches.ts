// Approved R65 regression support future worker patch helper. Never executed during this phase.
import {createRequire} from 'node:module';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const capturedDefine=Object.defineProperty,capturedGet=Object.getOwnPropertyDescriptor,capturedError=Error;
const capturedDelete=Reflect.deleteProperty;
const capturedGetPrototypeOf=Object.getPrototypeOf;
const capturedSync=syncBuiltinESMExports;
export interface PoisonPatch {calls:()=>number;restore:()=>void;descriptorRestored:()=>boolean}
export function preparePoisonInstaller(operation:string):()=>PoisonPatch {
 let target:object,key:PropertyKey,getter=false,sync=false,allowAbsent=false;
 switch(operation){
  case 'Object.prototype.get': target=Object.prototype;key='get';getter=true;allowAbsent=true;break;
  case 'Object.prototype.set': target=Object.prototype;key='set';getter=true;allowAbsent=true;break;
  case 'Array[Symbol.species]': target=Array;key=Symbol.species;getter=true;break;
  case 'Object.prototype.fatal': target=Object.prototype;key='fatal';getter=true;allowAbsent=true;break;
  case 'Object.prototype.ignoreBOM': target=Object.prototype;key='ignoreBOM';getter=true;allowAbsent=true;break;
  case 'RegExp.prototype.exec': target=RegExp.prototype;key='exec';break;
  case 'RegExp.prototype[Symbol.replace]': target=RegExp.prototype;key=Symbol.replace;break;
  case "Array.isArray": target=Array; key="isArray"; getter=false; sync=false; break;
  case "Array.prototype.join": target=Array.prototype; key="join"; getter=false; sync=false; break;
  case "Array.prototype.sort": target=Array.prototype; key="sort"; getter=false; sync=false; break;
  case "Object.keys": target=Object; key="keys"; getter=false; sync=false; break;
  case "String.prototype.trim": target=String.prototype; key="trim"; getter=false; sync=false; break;
  case "Buffer.byteLength": target=Buffer; key="byteLength"; getter=false; sync=false; break;
  case "RegExp.prototype.test": target=RegExp.prototype; key="test"; getter=false; sync=false; break;
  case "Set.prototype.has": target=Set.prototype; key="has"; getter=false; sync=false; break;
  case "Array.prototype.includes": target=Array.prototype; key="includes"; getter=false; sync=false; break;
  case "Set.prototype.add": target=Set.prototype; key="add"; getter=false; sync=false; break;
  case "Object.freeze": target=Object; key="freeze"; getter=false; sync=false; break;
  case "String.prototype.padStart": target=String.prototype; key="padStart"; getter=false; sync=false; break;
  case "Number.prototype.toString": target=Number.prototype; key="toString"; getter=false; sync=false; break;
  case "String.prototype.charCodeAt": target=String.prototype; key="charCodeAt"; getter=false; sync=false; break;
  case "JSON.parse": target=JSON; key="parse"; getter=false; sync=false; break;
  case "String.prototype.replace": target=String.prototype; key="replace"; getter=false; sync=false; break;
  case "String": target=globalThis; key="String"; getter=false; sync=false; break;
  case "Array.prototype.forEach": target=Array.prototype; key="forEach"; getter=false; sync=false; break;
  case "Object.values": target=Object; key="values"; getter=false; sync=false; break;
  case "Array.prototype.every": target=Array.prototype; key="every"; getter=false; sync=false; break;
  case "Number.isSafeInteger": target=Number; key="isSafeInteger"; getter=false; sync=false; break;
  case "String.prototype.split": target=String.prototype; key="split"; getter=false; sync=false; break;
  case "Array.prototype.map": target=Array.prototype; key="map"; getter=false; sync=false; break;
  case "Number.isFinite": target=Number; key="isFinite"; getter=false; sync=false; break;
  case "Number": target=globalThis; key="Number"; getter=false; sync=false; break;
  case "Object.fromEntries": target=Object; key="fromEntries"; getter=false; sync=false; break;
  case "Array.prototype.filter": target=Array.prototype; key="filter"; getter=false; sync=false; break;
  case "Object.entries": target=Object; key="entries"; getter=false; sync=false; break;
  case "Hash.prototype.digest": target=capturedGetPrototypeOf(createHash('sha256')); key="digest"; getter=false; sync=false; break;
  case "Hash.prototype.update": target=capturedGetPrototypeOf(createHash('sha256')); key="update"; getter=false; sync=false; break;
  case "node:crypto.createHash": target=require('node:crypto'); key="createHash"; getter=false; sync=true; break;
  case "Array.prototype.some": target=Array.prototype; key="some"; getter=false; sync=false; break;
  case "Set.prototype.size:getter": target=Set.prototype; key="size"; getter=true; sync=false; break;
  case "Buffer.from": target=Buffer; key="from"; getter=false; sync=false; break;
  case "Buffer.prototype.toString": target=Buffer.prototype; key="toString"; getter=false; sync=false; break;
  case "String.prototype.toLowerCase": target=String.prototype; key="toLowerCase"; getter=false; sync=false; break;
  case "Math.ceil": target=Math; key="ceil"; getter=false; sync=false; break;
  case "Object.hasOwn": target=Object; key="hasOwn"; getter=false; sync=false; break;
  case "Reflect.ownKeys": target=Reflect; key="ownKeys"; getter=false; sync=false; break;
  case "Map.prototype.get": target=Map.prototype; key="get"; getter=false; sync=false; break;
  case "Map.prototype.set": target=Map.prototype; key="set"; getter=false; sync=false; break;
  case "Reflect.get": target=Reflect; key="get"; getter=false; sync=false; break;
  case "Math.min": target=Math; key="min"; getter=false; sync=false; break;
  case "Buffer.compare": target=Buffer; key="compare"; getter=false; sync=false; break;
  case "Object.defineProperty": target=Object; key="defineProperty"; getter=false; sync=false; break;
  case "node:util.types.isProxy": target=require('node:util').types; key="isProxy"; getter=false; sync=false; break;
  case "WeakMap.prototype.set": target=WeakMap.prototype; key="set"; getter=false; sync=false; break;
  case "WeakMap.prototype.get": target=WeakMap.prototype; key="get"; getter=false; sync=false; break;
  case "Array.prototype.flatMap": target=Array.prototype; key="flatMap"; getter=false; sync=false; break;
  case "Math.max": target=Math; key="max"; getter=false; sync=false; break;
  case "Array.prototype.push": target=Array.prototype; key="push"; getter=false; sync=false; break;
  case "Object.getPrototypeOf": target=Object; key="getPrototypeOf"; getter=false; sync=false; break;
  case "Object.getOwnPropertySymbols": target=Object; key="getOwnPropertySymbols"; getter=false; sync=false; break;
  case "Buffer.isBuffer": target=Buffer; key="isBuffer"; getter=false; sync=false; break;
  case "TextDecoder.prototype.decode": target=TextDecoder.prototype; key="decode"; getter=false; sync=false; break;
  case "TextDecoder": target=globalThis; key="TextDecoder"; getter=false; sync=false; break;
  case "Buffer.prototype.equals": target=Buffer.prototype; key="equals"; getter=false; sync=false; break;
  default:throw new capturedError('unsupported_patch:'+operation);
 }
 const original=capturedGet(target,key); if(!original&&!allowAbsent)throw new capturedError('missing_original_descriptor:'+operation);
 return ()=>{let calls=0;let restored=false; const restoreOriginal=()=>{if(original)capturedDefine(target,key,original);else capturedDelete(target,key);}; const poison=function(){calls++;throw new capturedError('poisoned_intrinsic');};
  const patch = {calls:()=>calls,descriptorRestored:()=>{const now=capturedGet(target,key);if(!original)return now===undefined;if(!now)return false;return now.value===original.value&&now.get===original.get&&now.set===original.set&&now.writable===original.writable&&now.configurable===original.configurable&&now.enumerable===original.enumerable;},restore:()=>{if(!restored){restoreOriginal();if(sync)capturedSync();restored=true;}}};
  try {capturedDefine(target,key,getter?{__proto__:null,configurable:original?.configurable??true,enumerable:original?.enumerable??false,get:poison}:{__proto__:null,...original,value:poison});if(sync)capturedSync();}
  catch(error){restoreOriginal();if(sync)capturedSync();throw error;}
  return patch;
 };
}
