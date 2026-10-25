import { types } from 'node:util';
import type { ToolDefinition } from '../types.js';

/** Descriptions only: never an execution, permission, or retry contract. */
export interface ToolDescriptionMetadata {
  outputSchema?: unknown;
  effect?: 'none' | 'read' | 'write' | 'execute' | 'mixed' | 'unknown';
  idempotency?: 'idempotent' | 'non-idempotent' | 'unknown';
}
export interface ToolDiscovery { coreDefinition: ToolDefinition; metadata?: Readonly<ToolDescriptionMetadata> }
const isProxy = types.isProxy, descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
const prototype = Object.getPrototypeOf, objectPrototype = Object.prototype, arrayPrototype = Array.prototype;
const arrayIsArray = Array.isArray, define = Object.defineProperty, freeze = Object.freeze, create = Object.create;
const apply = Reflect.apply, hasOwn = Object.prototype.hasOwnProperty, finite = Number.isFinite;
const NativeSet = Set, add = Set.prototype.add, has = Set.prototype.has, remove = Set.prototype.delete;
const bytes = Buffer.byteLength, NativeError = Error, safeInteger = Number.isSafeInteger, includes = Array.prototype.includes;
function contains(values:readonly unknown[],value:unknown):boolean{return apply(includes,values,[value]) as boolean;}
function own(value: object, key: PropertyKey): boolean { return apply(hasOwn, value, [key]) as boolean; }
function fail(): never { throw new NativeError('tool_description_metadata_invalid'); }
function data(value: object, key: PropertyKey): PropertyDescriptor {
  const d = descriptor(value, key); if (!d || !own(d, 'value') || d.enumerable !== true) fail(); return d;
}
function field(target: object, key: PropertyKey, value: unknown): void {
  const attributes=create(null) as PropertyDescriptor;attributes.value=value;attributes.enumerable=true;define(target,key,attributes);
}

/** Capture only explicitly registered own data, without invoking getters or Proxy traps. */
export function captureToolDescriptionMetadata(raw?: ToolDescriptionMetadata): Readonly<ToolDescriptionMetadata> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || isProxy(raw) || arrayIsArray(raw) || !contains([objectPrototype, null],prototype(raw))) fail();
  const result: ToolDescriptionMetadata = {};
  const seen = new NativeSet<object>(); let nodes = 0, stringBytes = 0;
  const charge = (text: string) => { stringBytes += bytes(text, 'utf8'); if (stringBytes > 65536) fail(); };
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 64) fail();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { charge(value); return value; }
    if (typeof value === 'number' && finite(value)) return value;
    if (!value || typeof value !== 'object' || isProxy(value) || apply(has, seen, [value])) fail();
    const array = arrayIsArray(value), p = prototype(value);
    if (array ? p !== arrayPrototype : p !== objectPrototype && p !== null) fail();
    const names = keys(value); if (names.length > 4097) fail();
    apply(add, seen, [value]);
    try {
      const target: any = array ? [] : {};
      if (array) {
        const ld = descriptor(value, 'length'); if (!ld || !own(ld, 'value')) fail();
        const length = ld.value; if (!safeInteger(length) || length < 0 || names.length !== length + 1) fail();
        for (let i = 0; i < length; i++) field(target, String(i), copy(data(value, String(i)).value, depth + 1));
      } else {
        for (let i = 0; i < names.length; i++) { const key = names[i]; if (typeof key !== 'string') fail(); charge(key); field(target, key, copy(data(value, key).value, depth + 1)); }
      }
      return freeze(target);
    } finally { apply(remove, seen, [value]); }
  };
  const names = keys(raw); if (names.length > 3) fail();
  for (let i = 0; i < names.length; i++) {
    const key = names[i]; if (key !== 'outputSchema' && key !== 'effect' && key !== 'idempotency') fail();
    const value = data(raw, key).value; if (value === undefined) continue;
    if (key === 'effect' && !contains(['none', 'read', 'write', 'execute', 'mixed', 'unknown'],value)) fail();
    if (key === 'idempotency' && !contains(['idempotent', 'non-idempotent', 'unknown'],value)) fail();
    field(result, key, key === 'outputSchema' ? copy(value, 0) : value);
  }
  return keys(result).length ? freeze(result) : undefined;
}
export const BUILTIN_READ_DESCRIPTION: Readonly<ToolDescriptionMetadata> = captureToolDescriptionMetadata({ outputSchema: { type: 'string' }, effect: 'read', idempotency: 'unknown' })!;
