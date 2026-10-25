import {expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {decodeOrdinaryProfileSourceStorage as decode, encodeOrdinaryProfileSourceStorage as encode,
  serializeOrdinaryProfileSourceStorage as serialize, ORDINARY_REGISTRY_STORAGE_MAX_BYTES as MAX,
  ORDINARY_REGISTRY_DECODED_MAX_BYTES as DECODED_MAX} from '../../../src/runtime/verification/ordinary-profile-source-storage-codec.js';
import {discoveryData} from './ordinary-registry-compact-fixture.js';
it.each([1, 2] as const)('roundtrips every field without changing public version %s', version => {
  const facts = discoveryData(4, version); expect(decode(JSON.parse(JSON.stringify(encode(facts))))).toEqual(facts);
  expect(facts.sources).toHaveLength(4); expect(facts.legacyInventoryRequired).toBe(true);
});
it('does not transform legacy v1/v2 inputs', () => {
  for (const version of [1, 2] as const) { const facts = discoveryData(1, version); expect(decode(facts)).toBe(facts); expect(JSON.parse(serialize(facts))).toEqual(facts); }
});
it('retains exact database and cumulative layout observations', () => {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const directory = {canonicalPath: '/owned-codec-data/loop', device: '1', inode: '2'};
  const database = {basename: 'loop.sqlite', device: '1', inode: '3'};
  const observations = [['loop'], ['completion', 'loop']].map(components => {
    const tuple = {version: 1 as const, components: components as Array<'loop'|'completion'>, layoutRevision: components.length};
    return {...tuple, layoutHash: digest(tuple)};
  }).sort((a,b) => a.layoutHash.localeCompare(b.layoutHash));
  const facts = {version: 2 as const, uid: 1, generation: '18446744073709551615', legacyInventoryRequired: true as const,
    sources: [{kind: 'sqlite-db' as const, directory, database, snapshotFormat: 'loop-sqlite-v1',
      sourceId: digest(['sqlite-db', '1', '2', database]), namespaceId: digest([directory.canonicalPath, 'sqlite-db', database.basename]),
      componentHistory: {historyUnknown: true as const, components: ['completion', 'loop'] as Array<'loop'|'completion'>, observations}}]};
  expect(decode(JSON.parse(JSON.stringify(encode(facts))))).toEqual(facts);
});
it('switches only above the flat budget and preserves all data below the same physical cap', () => {
  const facts = discoveryData(1300); expect(Buffer.byteLength(JSON.stringify(facts))).toBeGreaterThan(MAX);
  const bytes = serialize(facts); expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(MAX);
  expect(JSON.parse(bytes).version).toBe(3); expect(decode(JSON.parse(bytes))).toEqual(facts);
  expect(Buffer.byteLength(JSON.stringify(facts))).toBeLessThanOrEqual(DECODED_MAX);
});
it('fails closed when compact bytes still exceed the unchanged cap', () => {
  expect(() => serialize(discoveryData(3000))).toThrow('profile_source_registry_capacity');
});
it.each(['extra-envelope', 'wrong-version', 'short-source', 'bad-hash', 'bad-db', 'bad-history'])(
  'rejects malformed fixed tuple %s', kind => {
    const raw = JSON.parse(JSON.stringify(encode(discoveryData(1))));
    if (kind === 'extra-envelope') raw.extra = true;
    if (kind === 'wrong-version') raw.sourceVersion = 3;
    if (kind === 'short-source') raw.sources[0].pop();
    if (kind === 'bad-hash') raw.sources[0][0] = 'bad';
    if (kind === 'bad-db') raw.sources[0][7] = ['one'];
    if (kind === 'bad-history') raw.sources[0][8] = [[]];
    expect(() => decode(raw)).toThrow('profile_source_registry_schema');
  });
it('rejects compact raw objects above the physical byte gate before expansion', () => {
  const raw = JSON.parse(JSON.stringify(encode(discoveryData(1)))); raw.sources[0][3] = '/' + 'x'.repeat(MAX);
  expect(() => decode(raw)).toThrow('profile_source_registry_capacity');
});
