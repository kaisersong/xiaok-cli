import {expect, it} from 'vitest';
import {decodeOrdinaryProfileSourceStorage as decode, encodeOrdinaryProfileSourceStorage as encode} from '../../../src/runtime/verification/ordinary-profile-source-storage-codec.js';
import {discoveryData} from './ordinary-registry-compact-fixture.js';
function input() { return JSON.parse(JSON.stringify(encode(discoveryData(1)))); }
it('rejects own version and tuple accessors without reading either getter', () => {
  let versionReads = 0, tupleReads = 0; const a = input(), b = input();
  Object.defineProperty(a, 'version', {enumerable: true, get() { versionReads++; return 3; }});
  Object.defineProperty(b.sources[0], '0', {enumerable: true, get() { tupleReads++; return 'a'.repeat(64); }});
  expect(() => decode(a)).toThrow('profile_source_registry_schema');
  expect(() => decode(b)).toThrow('profile_source_registry_schema'); expect(versionReads).toBe(0); expect(tupleReads).toBe(0);
});
it('rejects input toJSON before invoking it or observing nested getter', () => {
  let calls = 0, reads = 0; const raw = input(), header = input(); raw.toJSON = () => { calls++; return {}; };
  Object.defineProperty(header, 'uid', {enumerable: true, get() { reads++; return 1; }});
  expect(() => decode(raw)).toThrow('profile_source_registry_schema'); expect(() => decode(header)).toThrow('profile_source_registry_schema'); expect(calls).toBe(0); expect(reads).toBe(0);
});
it('rejects a Proxy without invoking its traps', () => {
  let traps = 0; const raw = new Proxy(input(), {get() { traps++; throw Error('get'); }, ownKeys() { traps++; throw Error('keys'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); }, getPrototypeOf() { traps++; throw Error('proto'); }});
  expect(() => decode(raw)).toThrow('profile_source_registry_schema'); expect(traps).toBe(0);
});
it('rejects an Array subclass without observing its species getter', () => {
  let reads = 0; const raw = input(); class SpeciesArray extends Array {}
  Object.defineProperty(SpeciesArray, Symbol.species, {get() { reads++; return Array; }});
  Object.setPrototypeOf(raw.sources, SpeciesArray.prototype);
  expect(() => decode(raw)).toThrow('profile_source_registry_schema'); expect(reads).toBe(0);
});
it('rejects poisoned ambient species before map/getter/iterator effects and restores it', () => {
  const raw = input(), descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
  let reads = 0, error: unknown;
  try {
    Object.defineProperty(Array, Symbol.species, {configurable: true, get() { reads++; throw Error('species'); }});
    try { decode(raw); } catch (value) { error = value; }
  } finally { Object.defineProperty(Array, Symbol.species, descriptor); }
  expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('profile_source_registry_schema'); expect(reads).toBe(0);
});
it('rejects inherited ambient toJSON without calling it and restores the original descriptor', () => {
  const raw = input(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  let calls = 0, error: unknown;
  try {
    Object.defineProperty(Object.prototype, 'toJSON', {configurable: true, value() { calls++; return {}; }});
    try { decode(raw); } catch (value) { error = value; }
  } finally { if (descriptor) Object.defineProperty(Object.prototype, 'toJSON', descriptor); else Reflect.deleteProperty(Object.prototype, 'toJSON'); }
  expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('profile_source_registry_schema'); expect(calls).toBe(0);
});
