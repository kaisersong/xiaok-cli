import { createHash, Hash } from 'node:crypto';
import { types } from 'node:util';
// Capture trusted package startup references once; invoke without mutable method lookup.
const nativeApply = Reflect.apply;
const NativeTypeError = TypeError;
function appendOwnArrayValue(array, index, value) { ownDataObjectDefineProperty(array, index, { __proto__: null, value, enumerable: true, writable: true, configurable: true }); }
const nativeownDataArrayIsArray = Array.isArray;
const nativeownDataArrayIsArrayReceiver = Array;
export const ownDataArrayIsArray = ((...args) => nativeApply(nativeownDataArrayIsArray, nativeownDataArrayIsArrayReceiver, args));
const nativeownDataObjectKeys = Object.keys;
const nativeownDataObjectKeysReceiver = Object;
export const ownDataObjectKeys = ((...args) => nativeApply(nativeownDataObjectKeys, nativeownDataObjectKeysReceiver, args));
const nativeownDataBufferByteLength = Buffer.byteLength;
const nativeownDataBufferByteLengthReceiver = Buffer;
export const ownDataBufferByteLength = ((...args) => nativeApply(nativeownDataBufferByteLength, nativeownDataBufferByteLengthReceiver, args));
const nativeownDataObjectFreeze = Object.freeze;
const nativeownDataObjectFreezeReceiver = Object;
export const ownDataObjectFreeze = ((...args) => nativeApply(nativeownDataObjectFreeze, nativeownDataObjectFreezeReceiver, args));
const nativeownDataJSONParse = JSON.parse;
const nativeownDataJSONParseReceiver = JSON;
export const ownDataJSONParse = ((...args) => nativeApply(nativeownDataJSONParse, nativeownDataJSONParseReceiver, args));
const nativeownDataString = String;
export const ownDataString = ((...args) => nativeApply(nativeownDataString, undefined, args));
/** Diagnostic text for already captured, acyclic plain data only. */
export function ownDataCapturedDiagnosticString(value) {
    if (value === null || typeof value !== 'object')
        return nativeApply(nativeownDataString, undefined, [value]);
    if (ownDataObjectHasOwn(value, 'toString'))
        throw new NativeTypeError('Cannot convert object to primitive value');
    if (!ownDataArrayIsArray(value))
        return '[object Object]';
    let result = '';
    for (let index = 0; index < value.length; index++) {
        if (index)
            result += ',';
        const item = value[index];
        if (item !== null && item !== undefined)
            result += ownDataCapturedDiagnosticString(item);
    }
    return result;
}
const nativeownDataObjectValues = Object.values;
const nativeownDataObjectValuesReceiver = Object;
export const ownDataObjectValues = ((...args) => nativeApply(nativeownDataObjectValues, nativeownDataObjectValuesReceiver, args));
const nativeownDataNumberIsSafeInteger = Number.isSafeInteger;
const nativeownDataNumberIsSafeIntegerReceiver = Number;
export const ownDataNumberIsSafeInteger = ((...args) => nativeApply(nativeownDataNumberIsSafeInteger, nativeownDataNumberIsSafeIntegerReceiver, args));
const nativeownDataNumberIsFinite = Number.isFinite;
const nativeownDataNumberIsFiniteReceiver = Number;
export const ownDataNumberIsFinite = ((...args) => nativeApply(nativeownDataNumberIsFinite, nativeownDataNumberIsFiniteReceiver, args));
const nativeownDataNumber = Number;
export const ownDataNumber = ((...args) => nativeApply(nativeownDataNumber, undefined, args));
const nativeownDataObjectFromEntries = Object.fromEntries;
const nativeownDataObjectFromEntriesReceiver = Object;
export const ownDataObjectFromEntries = ((...args) => nativeApply(nativeownDataObjectFromEntries, nativeownDataObjectFromEntriesReceiver, args));
const nativeownDataObjectEntries = Object.entries;
const nativeownDataObjectEntriesReceiver = Object;
export const ownDataObjectEntries = ((...args) => nativeApply(nativeownDataObjectEntries, nativeownDataObjectEntriesReceiver, args));
const nativeownDataCryptoCreateHash = createHash;
export const ownDataCryptoCreateHash = ((...args) => nativeApply(nativeownDataCryptoCreateHash, undefined, args));
const nativeownDataBufferFrom = Buffer.from;
const nativeownDataBufferFromReceiver = Buffer;
export const ownDataBufferFrom = ((...args) => nativeApply(nativeownDataBufferFrom, nativeownDataBufferFromReceiver, args));
const nativeownDataMathCeil = Math.ceil;
const nativeownDataMathCeilReceiver = Math;
export const ownDataMathCeil = ((...args) => nativeApply(nativeownDataMathCeil, nativeownDataMathCeilReceiver, args));
const nativeownDataObjectHasOwn = Object.hasOwn;
const nativeownDataObjectHasOwnReceiver = Object;
export const ownDataObjectHasOwn = ((...args) => nativeApply(nativeownDataObjectHasOwn, nativeownDataObjectHasOwnReceiver, args));
const nativeownDataReflectOwnKeys = Reflect.ownKeys;
const nativeownDataReflectOwnKeysReceiver = Reflect;
export const ownDataReflectOwnKeys = ((...args) => nativeApply(nativeownDataReflectOwnKeys, nativeownDataReflectOwnKeysReceiver, args));
const nativeownDataReflectGet = Reflect.get;
const nativeownDataReflectGetReceiver = Reflect;
export const ownDataReflectGet = ((...args) => nativeApply(nativeownDataReflectGet, nativeownDataReflectGetReceiver, args));
const nativeownDataMathMin = Math.min;
const nativeownDataMathMinReceiver = Math;
export const ownDataMathMin = ((...args) => nativeApply(nativeownDataMathMin, nativeownDataMathMinReceiver, args));
const nativeownDataBufferCompare = Buffer.compare;
const nativeownDataBufferCompareReceiver = Buffer;
export const ownDataBufferCompare = ((...args) => nativeApply(nativeownDataBufferCompare, nativeownDataBufferCompareReceiver, args));
const nativeownDataObjectDefineProperty = Object.defineProperty;
const nativeownDataObjectDefinePropertyReceiver = Object;
export const ownDataObjectDefineProperty = ((...args) => nativeApply(nativeownDataObjectDefineProperty, nativeownDataObjectDefinePropertyReceiver, args));
const nativeownDataUtilTypesIsProxy = types.isProxy;
const nativeownDataUtilTypesIsProxyReceiver = types;
export const ownDataUtilTypesIsProxy = ((...args) => nativeApply(nativeownDataUtilTypesIsProxy, nativeownDataUtilTypesIsProxyReceiver, args));
const nativeownDataMathMax = Math.max;
const nativeownDataMathMaxReceiver = Math;
export const ownDataMathMax = ((...args) => nativeApply(nativeownDataMathMax, nativeownDataMathMaxReceiver, args));
const nativeownDataObjectGetPrototypeOf = Object.getPrototypeOf;
const nativeownDataObjectGetPrototypeOfReceiver = Object;
export const ownDataObjectGetPrototypeOf = ((...args) => nativeApply(nativeownDataObjectGetPrototypeOf, nativeownDataObjectGetPrototypeOfReceiver, args));
const nativeownDataObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const nativeownDataObjectGetOwnPropertySymbolsReceiver = Object;
export const ownDataObjectGetOwnPropertySymbols = ((...args) => nativeApply(nativeownDataObjectGetOwnPropertySymbols, nativeownDataObjectGetOwnPropertySymbolsReceiver, args));
const nativeownDataBufferIsBuffer = Buffer.isBuffer;
const nativeownDataBufferIsBufferReceiver = Buffer;
export const ownDataBufferIsBuffer = ((...args) => nativeApply(nativeownDataBufferIsBuffer, nativeownDataBufferIsBufferReceiver, args));
const nativeownDataArrayPrototypeJoin = Array.prototype.join;
export function ownDataArrayPrototypeJoin(value, separator) { return nativeApply(nativeownDataArrayPrototypeJoin, value, [separator]); }
const nativeownDataArrayPrototypeSort = Array.prototype.sort;
export function ownDataArrayPrototypeSort(value, compare) { return nativeApply(nativeownDataArrayPrototypeSort, value, [compare]); }
const nativeownDataArrayPrototypeIncludes = Array.prototype.includes;
export function ownDataArrayPrototypeIncludes(value, search, fromIndex) { return nativeApply(nativeownDataArrayPrototypeIncludes, value, [search, fromIndex]); }
const nativeownDataArrayPrototypeForEach = Array.prototype.forEach;
export function ownDataArrayPrototypeForEach(value, callback, thisArg) { return nativeApply(nativeownDataArrayPrototypeForEach, value, [callback, thisArg]); }
const nativeownDataArrayPrototypeEvery = Array.prototype.every;
export function ownDataArrayPrototypeEvery(value, callback, thisArg) { return nativeApply(nativeownDataArrayPrototypeEvery, value, [callback, thisArg]); }
const nativeownDataArrayPrototypeSome = Array.prototype.some;
export function ownDataArrayPrototypeSome(value, callback, thisArg) { return nativeApply(nativeownDataArrayPrototypeSome, value, [callback, thisArg]); }
const nativeownDataArrayPrototypePush = Array.prototype.push;
export function ownDataArrayPrototypePush(value, ...items) { return nativeApply(nativeownDataArrayPrototypePush, value, items); }
const nativeownDataStringPrototypeTrim = String.prototype.trim;
export function ownDataStringPrototypeTrim(value) { return nativeApply(nativeownDataStringPrototypeTrim, value, []); }
const nativeownDataStringPrototypeSplit = String.prototype.split;
export function ownDataStringPrototypeSplit(value, separator, limit) { return nativeApply(nativeownDataStringPrototypeSplit, value, [separator, limit]); }
const nativeownDataStringPrototypeToLowerCase = String.prototype.toLowerCase;
export function ownDataStringPrototypeToLowerCase(value) { return nativeApply(nativeownDataStringPrototypeToLowerCase, value, []); }
const nativeownDataStringPrototypeCharCodeAt = String.prototype.charCodeAt;
export function ownDataStringPrototypeCharCodeAt(value, index) { return nativeApply(nativeownDataStringPrototypeCharCodeAt, value, [index]); }
const nativeownDataSetPrototypeHas = Set.prototype.has;
export function ownDataSetPrototypeHas(value, key) { return nativeApply(nativeownDataSetPrototypeHas, value, [key]); }
const nativeownDataSetPrototypeAdd = Set.prototype.add;
export function ownDataSetPrototypeAdd(value, key) { return nativeApply(nativeownDataSetPrototypeAdd, value, [key]); }
const nativeownDataMapPrototypeGet = Map.prototype.get;
export function ownDataMapPrototypeGet(value, key) { return nativeApply(nativeownDataMapPrototypeGet, value, [key]); }
const nativeownDataMapPrototypeSet = Map.prototype.set;
export function ownDataMapPrototypeSet(value, key, item) { return nativeApply(nativeownDataMapPrototypeSet, value, [key, item]); }
const nativeownDataWeakMapPrototypeGet = WeakMap.prototype.get;
export function ownDataWeakMapPrototypeGet(value, key) { return nativeApply(nativeownDataWeakMapPrototypeGet, value, [key]); }
const nativeownDataWeakMapPrototypeSet = WeakMap.prototype.set;
export function ownDataWeakMapPrototypeSet(value, key, item) { return nativeApply(nativeownDataWeakMapPrototypeSet, value, [key, item]); }
const nativeownDataBufferPrototypeToString = Buffer.prototype.toString;
export function ownDataBufferPrototypeToString(value, encoding, start, end) { return nativeApply(nativeownDataBufferPrototypeToString, value, [encoding, start, end]); }
const nativeownDataBufferPrototypeEquals = Buffer.prototype.equals;
export function ownDataBufferPrototypeEquals(value, other) { return nativeApply(nativeownDataBufferPrototypeEquals, value, [other]); }
const nativeownDataHashPrototypeUpdate = Hash.prototype.update;
export function ownDataHashPrototypeUpdate(value, data, encoding) { return nativeApply(nativeownDataHashPrototypeUpdate, value, encoding === undefined ? [data] : [data, encoding]); }
const nativeownDataHashPrototypeDigest = Hash.prototype.digest;
export function ownDataHashPrototypeDigest(value, encoding) { return nativeApply(nativeownDataHashPrototypeDigest, value, [encoding]); }
const nativeownDataTextDecoderPrototypeDecode = TextDecoder.prototype.decode;
export function ownDataTextDecoderPrototypeDecode(value, bytes) { return nativeApply(nativeownDataTextDecoderPrototypeDecode, value, [bytes]); }
const nativeSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
export function ownDataSetPrototypeSizeGetter(value) { return nativeApply(nativeSetSize, value, []); }
const nativeRegexExec = RegExp.prototype.exec;
export function ownDataRegExpPrototypeTest(value, input) { return nativeApply(nativeRegexExec, value, [input]) !== null; }
const NativeTextDecoder = TextDecoder;
export function ownDataTextDecoder(encoding) { return new NativeTextDecoder(encoding, { __proto__: null, fatal: true, ignoreBOM: false }); }
const hex = '0123456789abcdef';
export function ownDataFixedAsciiEscape(value) { let result = ''; for (let i = 0; i < value.length; i++) {
    const c = nativeApply(nativeownDataStringPrototypeCharCodeAt, value, [i]);
    if (c >= 0x007f)
        result += '\\u' + hex[(c >>> 12) & 15] + hex[(c >>> 8) & 15] + hex[(c >>> 4) & 15] + hex[c & 15];
    else
        result += value[i];
} return result; }
/** Ordinary arrays without consulting caller-replaceable constructor/species hooks. */
export function ownDataArrayPrototypeMap(value, callback, thisArg) {
    const length = value.length;
    if (typeof callback !== 'function')
        throw new NativeTypeError('callback must be callable');
    const result = [];
    result.length = length;
    for (let i = 0; i < length; i++)
        if (i in value)
            appendOwnArrayValue(result, i, nativeApply(callback, thisArg, [value[i], i, value]));
    return result;
}
export function ownDataArrayPrototypeFilter(value, callback, thisArg) {
    const length = value.length;
    if (typeof callback !== 'function')
        throw new NativeTypeError('callback must be callable');
    const result = [];
    let count = 0;
    for (let i = 0; i < length; i++)
        if (i in value) {
            const item = value[i];
            if (nativeApply(callback, thisArg, [item, i, value]))
                appendOwnArrayValue(result, count++, item);
        }
    return result;
}
export function ownDataArrayPrototypeFlatMap(value, callback, thisArg) {
    const length = value.length;
    if (typeof callback !== 'function')
        throw new NativeTypeError('callback must be callable');
    const result = [];
    let count = 0;
    for (let i = 0; i < length; i++)
        if (i in value) {
            const projected = nativeApply(callback, thisArg, [value[i], i, value]);
            if (ownDataArrayIsArray(projected)) {
                const childLength = projected.length;
                for (let j = 0; j < childLength; j++)
                    if (j in projected)
                        appendOwnArrayValue(result, count++, projected[j]);
            }
            else
                appendOwnArrayValue(result, count++, projected);
        }
    return result;
}
