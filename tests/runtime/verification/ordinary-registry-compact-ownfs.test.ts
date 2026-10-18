import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoveryData} from './ordinary-registry-compact-fixture.js';
const state = vi.hoisted(() => ({home: '', route: 'ordinary', failDirectorySync: false}));
vi.mock('node:os', async load => { const actual = await load<typeof import('node:os')>(); return {...actual, userInfo: () => ({...actual.userInfo(), homedir: state.home})}; });
vi.mock('node:fs', async load => { const actual = await load<typeof import('node:fs')>(); return {...actual, fsyncSync: (fd: number) => {
  if (state.failDirectorySync && actual.fstatSync(fd).isDirectory()) throw Error('owned-registry-directory-sync'); actual.fsyncSync(fd);
}}; });
// Test-only route outcome. Not evidence of installed/native admission or SDK qualification.
vi.mock('../../../src/runtime/verification/migration-markers.js', () => ({readInstalledCurrentProfile: () => ({kind: state.route})}));
import {registerOrdinaryProfileSource, readOrdinaryProfileSources, parseOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import {encodeOrdinaryProfileSourceStorage as encode} from '../../../src/runtime/verification/ordinary-profile-source-storage-codec.js';
let root = '';
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'ordinary-registry-compact-'))); state.home = join(root, 'account'); mkdirSync(state.home); state.route = 'ordinary'; state.failDirectorySync = false; });
afterEach(() => { state.failDirectorySync = false; if (root) rmSync(root, {recursive: true, force: true}); root = ''; });
function registryPath() { return join(state.home, '.xiaok/profile-sources/registry.json'); }
function initial() { const directory = join(root, 'actual-source'); mkdirSync(directory); registerOrdinaryProfileSource({kind: 'session-root', directory}); return directory; }
function nearCapacity() {
  initial(); const original = readOrdinaryProfileSources()!;
  const fixture = discoveryData(1300); // Plain historical DTO; no claim that missing old directories are owned/live.
  const next = {...original, generation: '1301', sources: [...fixture.sources, ...original.sources]};
  expect(Buffer.byteLength(JSON.stringify(next))).toBeGreaterThan(512 * 1024);
  writeFileSync(registryPath(), JSON.stringify(encode(next))); return next;
}
it('decodes a real owned registry file through the original reader and preserves no-op generation', () => {
  const expected = nearCapacity(); expect(readOrdinaryProfileSources()).toEqual(expected);
  const before = readFileSync(registryPath(), 'utf8');
  const directory = expected.sources.at(-1)!.directory.canonicalPath;
  registerOrdinaryProfileSource({kind: 'session-root', directory}); expect(readFileSync(registryPath(), 'utf8')).toBe(before);
});
it('appends an actual source while retaining every historical tuple and original identity', () => {
  const before = nearCapacity(); const directory = join(root, 'new-source'); mkdirSync(directory);
  registerOrdinaryProfileSource({kind: 'task-root', directory}); const after = readOrdinaryProfileSources()!;
  expect(after.sources.slice(0, before.sources.length)).toEqual(before.sources); expect(after.sources).toHaveLength(before.sources.length + 1);
  expect(after.generation).toBe(String(BigInt(before.generation) + 1n)); expect(after.legacyInventoryRequired).toBe(true);
  expect(JSON.parse(readFileSync(registryPath(), 'utf8')).version).toBe(3); expect(lstatSync(registryPath()).size).toBeLessThanOrEqual(512 * 1024);
});
it('keeps the original ordinary route denial and byte-identical prior file', () => {
  nearCapacity(); const bytes = readFileSync(registryPath(), 'utf8'); state.route = 'protected';
  expect(() => registerOrdinaryProfileSource({kind: 'task-root', directory: root})).toThrow('profile_source_registry_route');
  expect(readFileSync(registryPath(), 'utf8')).toBe(bytes);
});
it('preserves the original physical namespace identity rejection', () => {
  const directory = initial(); const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
  raw.sources[0].sourceId = '0'.repeat(64); writeFileSync(registryPath(), JSON.stringify(encode(raw)));
  expect(() => readOrdinaryProfileSources()).toThrow('profile_source_registry_schema');
  expect(() => registerOrdinaryProfileSource({kind: 'session-root', directory})).toThrow('profile_source_registry_schema');
});
it('retains the original visible-rename/fsync failure and no-op rebarrier', () => {
  nearCapacity(); const directory = join(root, 'sync-source'); mkdirSync(directory); state.failDirectorySync = true;
  expect(() => registerOrdinaryProfileSource({kind: 'task-root', directory})).toThrow('owned-registry-directory-sync');
  expect(() => registerOrdinaryProfileSource({kind: 'task-root', directory})).toThrow('owned-registry-directory-sync');
  state.failDirectorySync = false; registerOrdinaryProfileSource({kind: 'task-root', directory});
  expect(readdirSync(join(state.home, '.xiaok/profile-sources'))).not.toContain('.profile-source-registry.lock');
});
it('retains duplicate/hash/generation validation for the captured consumer public parser', () => {
  const facts = discoveryData(1); expect(parseOrdinaryProfileSources(encode(facts), facts.uid)).toEqual(facts);
  const duplicate = {...facts, sources: [...facts.sources, ...facts.sources]};
  expect(() => parseOrdinaryProfileSources(encode(duplicate), facts.uid)).toThrow('profile_source_registry_schema');
  expect(() => parseOrdinaryProfileSources(encode({...facts, generation: '18446744073709551616'}), facts.uid)).toThrow('profile_source_registry_schema');
});
