import {createHash, Hash} from 'node:crypto';
import {types} from 'node:util';

// Capture trusted package startup references once; invoke without mutable method lookup.
const nativeApply = Reflect.apply;
const NativeTypeError = TypeError;
function appendOwnArrayValue<T>(array:T[],index:number,value:T):void { ownDataObjectDefineProperty(array,index,{__proto__:null,value,enumerable:true,writable:true,configurable:true} as PropertyDescriptor); }
const nativeownDataArrayIsArray = Array.isArray;
const nativeownDataArrayIsArrayReceiver = Array;
export const ownDataArrayIsArray = ((...args: any[]) => nativeApply(nativeownDataArrayIsArray, nativeownDataArrayIsArrayReceiver, args)) as typeof Array.isArray;
const nativeownDataObjectKeys = Object.keys;
const nativeownDataObjectKeysReceiver = Object;
export const ownDataObjectKeys = ((...args: any[]) => nativeApply(nativeownDataObjectKeys, nativeownDataObjectKeysReceiver, args)) as typeof Object.keys;
const nativeownDataBufferByteLength = Buffer.byteLength;
const nativeownDataBufferByteLengthReceiver = Buffer;
export const ownDataBufferByteLength = ((...args: any[]) => nativeApply(nativeownDataBufferByteLength, nativeownDataBufferByteLengthReceiver, args)) as typeof Buffer.byteLength;
const nativeownDataObjectFreeze = Object.freeze;
const nativeownDataObjectFreezeReceiver = Object;
export const ownDataObjectFreeze = ((...args: any[]) => nativeApply(nativeownDataObjectFreeze, nativeownDataObjectFreezeReceiver, args)) as typeof Object.freeze;
const nativeownDataJSONParse = JSON.parse;
const nativeownDataJSONParseReceiver = JSON;
export const ownDataJSONParse = ((...args: any[]) => nativeApply(nativeownDataJSONParse, nativeownDataJSONParseReceiver, args)) as typeof JSON.parse;
const nativeownDataString = String;
export const ownDataString = ((...args: any[]) => nativeApply(nativeownDataString, undefined, args)) as typeof String;

/** Diagnostic text for already captured, acyclic plain data only. */
export function ownDataCapturedDiagnosticString(value:unknown):string {
 if(value===null||typeof value!=='object')return nativeApply(nativeownDataString,undefined,[value]) as string;
 if(ownDataObjectHasOwn(value,'toString'))throw new NativeTypeError('Cannot convert object to primitive value');
 if(!ownDataArrayIsArray(value))return '[object Object]';
 let result='';
 for(let index=0;index<value.length;index++){
  if(index)result+=',';
  const item=value[index];
  if(item!==null&&item!==undefined)result+=ownDataCapturedDiagnosticString(item);
 }
 return result;
}
const nativeownDataObjectValues = Object.values;
const nativeownDataObjectValuesReceiver = Object;
export const ownDataObjectValues = ((...args: any[]) => nativeApply(nativeownDataObjectValues, nativeownDataObjectValuesReceiver, args)) as typeof Object.values;
const nativeownDataNumberIsSafeInteger = Number.isSafeInteger;
const nativeownDataNumberIsSafeIntegerReceiver = Number;
export const ownDataNumberIsSafeInteger = ((...args: any[]) => nativeApply(nativeownDataNumberIsSafeInteger, nativeownDataNumberIsSafeIntegerReceiver, args)) as typeof Number.isSafeInteger;
const nativeownDataNumberIsFinite = Number.isFinite;
const nativeownDataNumberIsFiniteReceiver = Number;
export const ownDataNumberIsFinite = ((...args: any[]) => nativeApply(nativeownDataNumberIsFinite, nativeownDataNumberIsFiniteReceiver, args)) as typeof Number.isFinite;
const nativeownDataNumber = Number;
export const ownDataNumber = ((...args: any[]) => nativeApply(nativeownDataNumber, undefined, args)) as typeof Number;
const nativeownDataObjectFromEntries = Object.fromEntries;
const nativeownDataObjectFromEntriesReceiver = Object;
export const ownDataObjectFromEntries = ((...args: any[]) => nativeApply(nativeownDataObjectFromEntries, nativeownDataObjectFromEntriesReceiver, args)) as typeof Object.fromEntries;
const nativeownDataObjectEntries = Object.entries;
const nativeownDataObjectEntriesReceiver = Object;
export const ownDataObjectEntries = ((...args: any[]) => nativeApply(nativeownDataObjectEntries, nativeownDataObjectEntriesReceiver, args)) as typeof Object.entries;
const nativeownDataCryptoCreateHash = createHash;
export const ownDataCryptoCreateHash = ((...args: any[]) => nativeApply(nativeownDataCryptoCreateHash, undefined, args)) as typeof createHash;
const nativeownDataBufferFrom = Buffer.from;
const nativeownDataBufferFromReceiver = Buffer;
export const ownDataBufferFrom = ((...args: any[]) => nativeApply(nativeownDataBufferFrom, nativeownDataBufferFromReceiver, args)) as typeof Buffer.from;
const nativeownDataMathCeil = Math.ceil;
const nativeownDataMathCeilReceiver = Math;
export const ownDataMathCeil = ((...args: any[]) => nativeApply(nativeownDataMathCeil, nativeownDataMathCeilReceiver, args)) as typeof Math.ceil;
const nativeownDataObjectHasOwn = Object.hasOwn;
const nativeownDataObjectHasOwnReceiver = Object;
export const ownDataObjectHasOwn = ((...args: any[]) => nativeApply(nativeownDataObjectHasOwn, nativeownDataObjectHasOwnReceiver, args)) as typeof Object.hasOwn;
const nativeownDataReflectOwnKeys = Reflect.ownKeys;
const nativeownDataReflectOwnKeysReceiver = Reflect;
export const ownDataReflectOwnKeys = ((...args: any[]) => nativeApply(nativeownDataReflectOwnKeys, nativeownDataReflectOwnKeysReceiver, args)) as typeof Reflect.ownKeys;
const nativeownDataReflectGet = Reflect.get;
const nativeownDataReflectGetReceiver = Reflect;
export const ownDataReflectGet = ((...args: any[]) => nativeApply(nativeownDataReflectGet, nativeownDataReflectGetReceiver, args)) as typeof Reflect.get;
const nativeownDataMathMin = Math.min;
const nativeownDataMathMinReceiver = Math;
export const ownDataMathMin = ((...args: any[]) => nativeApply(nativeownDataMathMin, nativeownDataMathMinReceiver, args)) as typeof Math.min;
const nativeownDataBufferCompare = Buffer.compare;
const nativeownDataBufferCompareReceiver = Buffer;
export const ownDataBufferCompare = ((...args: any[]) => nativeApply(nativeownDataBufferCompare, nativeownDataBufferCompareReceiver, args)) as typeof Buffer.compare;
const nativeownDataObjectDefineProperty = Object.defineProperty;
const nativeownDataObjectDefinePropertyReceiver = Object;
export const ownDataObjectDefineProperty = ((...args: any[]) => nativeApply(nativeownDataObjectDefineProperty, nativeownDataObjectDefinePropertyReceiver, args)) as typeof Object.defineProperty;
const nativeownDataUtilTypesIsProxy = types.isProxy;
const nativeownDataUtilTypesIsProxyReceiver = types;
export const ownDataUtilTypesIsProxy = ((...args: any[]) => nativeApply(nativeownDataUtilTypesIsProxy, nativeownDataUtilTypesIsProxyReceiver, args)) as typeof types.isProxy;
const nativeownDataMathMax = Math.max;
const nativeownDataMathMaxReceiver = Math;
export const ownDataMathMax = ((...args: any[]) => nativeApply(nativeownDataMathMax, nativeownDataMathMaxReceiver, args)) as typeof Math.max;
const nativeownDataObjectGetPrototypeOf = Object.getPrototypeOf;
const nativeownDataObjectGetPrototypeOfReceiver = Object;
export const ownDataObjectGetPrototypeOf = ((...args: any[]) => nativeApply(nativeownDataObjectGetPrototypeOf, nativeownDataObjectGetPrototypeOfReceiver, args)) as typeof Object.getPrototypeOf;
const nativeownDataObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const nativeownDataObjectGetOwnPropertySymbolsReceiver = Object;
export const ownDataObjectGetOwnPropertySymbols = ((...args: any[]) => nativeApply(nativeownDataObjectGetOwnPropertySymbols, nativeownDataObjectGetOwnPropertySymbolsReceiver, args)) as typeof Object.getOwnPropertySymbols;
const nativeownDataBufferIsBuffer = Buffer.isBuffer;
const nativeownDataBufferIsBufferReceiver = Buffer;
export const ownDataBufferIsBuffer = ((...args: any[]) => nativeApply(nativeownDataBufferIsBuffer, nativeownDataBufferIsBufferReceiver, args)) as typeof Buffer.isBuffer;
const nativeownDataArrayPrototypeJoin = Array.prototype.join;
export function ownDataArrayPrototypeJoin(value:readonly unknown[], separator?:string):string { return nativeApply(nativeownDataArrayPrototypeJoin,value,[separator]) as string; }
const nativeownDataArrayPrototypeSort = Array.prototype.sort;
export function ownDataArrayPrototypeSort<T>(value:T[], compare?:(a:T,b:T)=>number):T[] { return nativeApply(nativeownDataArrayPrototypeSort,value,[compare]) as T[]; }
const nativeownDataArrayPrototypeIncludes = Array.prototype.includes;
export function ownDataArrayPrototypeIncludes(value:readonly unknown[], search:unknown, fromIndex?:number):boolean { return nativeApply(nativeownDataArrayPrototypeIncludes,value,[search,fromIndex]) as boolean; }
const nativeownDataArrayPrototypeForEach = Array.prototype.forEach;
export function ownDataArrayPrototypeForEach<T>(value:readonly T[], callback:(value:T,index:number,array:T[])=>void, thisArg?:unknown):void { return nativeApply(nativeownDataArrayPrototypeForEach,value,[callback,thisArg]) as void; }
const nativeownDataArrayPrototypeEvery = Array.prototype.every;
export function ownDataArrayPrototypeEvery<T>(value:readonly T[], callback:(value:T,index:number,array:T[])=>unknown, thisArg?:unknown):boolean { return nativeApply(nativeownDataArrayPrototypeEvery,value,[callback,thisArg]) as boolean; }
const nativeownDataArrayPrototypeSome = Array.prototype.some;
export function ownDataArrayPrototypeSome<T>(value:readonly T[], callback:(value:T,index:number,array:T[])=>unknown, thisArg?:unknown):boolean { return nativeApply(nativeownDataArrayPrototypeSome,value,[callback,thisArg]) as boolean; }
const nativeownDataArrayPrototypePush = Array.prototype.push;
export function ownDataArrayPrototypePush<T>(value:T[], ...items:T[]):number { return nativeApply(nativeownDataArrayPrototypePush,value,items) as number; }
const nativeownDataStringPrototypeTrim = String.prototype.trim;
export function ownDataStringPrototypeTrim(value:string):string { return nativeApply(nativeownDataStringPrototypeTrim,value,[]) as string; }
const nativeownDataStringPrototypeSplit = String.prototype.split;
export function ownDataStringPrototypeSplit(value:string, separator:string|RegExp, limit?:number):string[] { return nativeApply(nativeownDataStringPrototypeSplit,value,[separator,limit]) as string[]; }
const nativeownDataStringPrototypeToLowerCase = String.prototype.toLowerCase;
export function ownDataStringPrototypeToLowerCase(value:string):string { return nativeApply(nativeownDataStringPrototypeToLowerCase,value,[]) as string; }
const nativeownDataStringPrototypeCharCodeAt = String.prototype.charCodeAt;
export function ownDataStringPrototypeCharCodeAt(value:string, index:number):number { return nativeApply(nativeownDataStringPrototypeCharCodeAt,value,[index]) as number; }
const nativeownDataSetPrototypeHas = Set.prototype.has;
export function ownDataSetPrototypeHas<T>(value:ReadonlySet<T>, key:T):boolean { return nativeApply(nativeownDataSetPrototypeHas,value,[key]) as boolean; }
const nativeownDataSetPrototypeAdd = Set.prototype.add;
export function ownDataSetPrototypeAdd<T>(value:Set<T>, key:T):Set<T> { return nativeApply(nativeownDataSetPrototypeAdd,value,[key]) as Set<T>; }
const nativeownDataMapPrototypeGet = Map.prototype.get;
export function ownDataMapPrototypeGet<K,V>(value:ReadonlyMap<K,V>, key:K):V|undefined { return nativeApply(nativeownDataMapPrototypeGet,value,[key]) as V|undefined; }
const nativeownDataMapPrototypeSet = Map.prototype.set;
export function ownDataMapPrototypeSet<K,V>(value:Map<K,V>, key:K, item:V):Map<K,V> { return nativeApply(nativeownDataMapPrototypeSet,value,[key,item]) as Map<K,V>; }
const nativeownDataWeakMapPrototypeGet = WeakMap.prototype.get;
export function ownDataWeakMapPrototypeGet<K extends object,V>(value:WeakMap<K,V>, key:K):V|undefined { return nativeApply(nativeownDataWeakMapPrototypeGet,value,[key]) as V|undefined; }
const nativeownDataWeakMapPrototypeSet = WeakMap.prototype.set;
export function ownDataWeakMapPrototypeSet<K extends object,V>(value:WeakMap<K,V>, key:K, item:V):WeakMap<K,V> { return nativeApply(nativeownDataWeakMapPrototypeSet,value,[key,item]) as WeakMap<K,V>; }
const nativeownDataBufferPrototypeToString = Buffer.prototype.toString;
export function ownDataBufferPrototypeToString(value:Buffer, encoding?:BufferEncoding, start?:number, end?:number):string { return nativeApply(nativeownDataBufferPrototypeToString,value,[encoding,start,end]) as string; }
const nativeownDataBufferPrototypeEquals = Buffer.prototype.equals;
export function ownDataBufferPrototypeEquals(value:Buffer, other:Uint8Array):boolean { return nativeApply(nativeownDataBufferPrototypeEquals,value,[other]) as boolean; }
const nativeownDataHashPrototypeUpdate = Hash.prototype.update;
export function ownDataHashPrototypeUpdate(value:Hash, data:any, encoding?:any):Hash { return nativeApply(nativeownDataHashPrototypeUpdate,value,encoding===undefined?[data]:[data,encoding]) as Hash; }
const nativeownDataHashPrototypeDigest = Hash.prototype.digest;
export function ownDataHashPrototypeDigest(value:Hash, encoding:any):any { return nativeApply(nativeownDataHashPrototypeDigest,value,[encoding]) as any; }
const nativeownDataTextDecoderPrototypeDecode = TextDecoder.prototype.decode;
export function ownDataTextDecoderPrototypeDecode(value:TextDecoder, bytes:AllowSharedBufferSource):string { return nativeApply(nativeownDataTextDecoderPrototypeDecode,value,[bytes]) as string; }
const nativeSetSize = Object.getOwnPropertyDescriptor(Set.prototype,'size')!.get!;
export function ownDataSetPrototypeSizeGetter<T>(value:ReadonlySet<T>):number { return nativeApply(nativeSetSize,value,[]) as number; }
const nativeRegexExec=RegExp.prototype.exec;
export function ownDataRegExpPrototypeTest(value:RegExp,input:string):boolean { return nativeApply(nativeRegexExec,value,[input])!==null; }
const NativeTextDecoder=TextDecoder;
export function ownDataTextDecoder(encoding:string):TextDecoder { return new NativeTextDecoder(encoding,{__proto__:null,fatal:true,ignoreBOM:false} as TextDecoderOptions); }
const hex='0123456789abcdef';
export function ownDataFixedAsciiEscape(value:string):string { let result=''; for(let i=0;i<value.length;i++){ const c=nativeApply(nativeownDataStringPrototypeCharCodeAt,value,[i]) as number; if(c>=0x007f)result+='\\u'+hex[(c>>>12)&15]+hex[(c>>>8)&15]+hex[(c>>>4)&15]+hex[c&15]; else result+=value[i]; } return result; }

/** Ordinary arrays without consulting caller-replaceable constructor/species hooks. */
export function ownDataArrayPrototypeMap<T,U>(value:readonly T[],callback:(value:T,index:number,array:T[])=>U,thisArg?:unknown):U[] {
 const length=value.length;if(typeof callback!=='function')throw new NativeTypeError('callback must be callable');
 const result:U[]=[];result.length=length;
 for(let i=0;i<length;i++)if(i in value)appendOwnArrayValue(result,i,nativeApply(callback,thisArg,[value[i],i,value]) as U);
 return result;
}
export function ownDataArrayPrototypeFilter<T>(value:readonly T[],callback:(value:T,index:number,array:T[])=>unknown,thisArg?:unknown):T[] {
 const length=value.length;if(typeof callback!=='function')throw new NativeTypeError('callback must be callable');
 const result:T[]=[];let count=0;
 for(let i=0;i<length;i++)if(i in value){const item=value[i]!;if(nativeApply(callback,thisArg,[item,i,value]))appendOwnArrayValue(result,count++,item);}
 return result;
}
export function ownDataArrayPrototypeFlatMap<T,U>(value:readonly T[],callback:(value:T,index:number,array:T[])=>U|readonly U[],thisArg?:unknown):U[] {
 const length=value.length;if(typeof callback!=='function')throw new NativeTypeError('callback must be callable');
 const result:U[]=[];let count=0;
 for(let i=0;i<length;i++)if(i in value){const projected=nativeApply(callback,thisArg,[value[i],i,value]) as U|readonly U[];
  if(ownDataArrayIsArray(projected)){const childLength=projected.length;for(let j=0;j<childLength;j++)if(j in projected)appendOwnArrayValue(result,count++,projected[j] as U);}
  else appendOwnArrayValue(result,count++,projected as U);
 }
 return result;
}
