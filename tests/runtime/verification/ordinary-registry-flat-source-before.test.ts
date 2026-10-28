import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoveryData} from './ordinary-registry-compact-fixture.js';
const state = vi.hoisted(() => ({home: ''}));
vi.mock('node:os', async load => { const actual = await load<typeof import('node:os')>(); return {...actual, userInfo: () => ({...actual.userInfo(), homedir: state.home})}; });
// Ordinary unit route outcome only; never an installed/native grant or real helper admission.
vi.mock('../../../src/runtime/verification/migration-markers.js', () => ({readInstalledCurrentProfile: () => ({kind: 'ordinary'})}));
// EXISTING public module and methods, present in both source-before and candidate.
// Deliberately no value import of the new storage codec or a new production API.
import {registerOrdinaryProfileSource, readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
let root = '';
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'ordinary-flat-source-before-'))); state.home = join(root, 'account');setProfileTestHome(state.home); mkdirSync(state.home); });
afterEach(() => { if (root) rmSync(root, {recursive: true, force: true}); root = ''; });
it('migrates a valid near-limit v1 flat registry only when a real new source no longer fits', () => {
  const MAX = 512 * 1024;
  const firstDirectory = join(root, 'actual-first'); mkdirSync(firstDirectory);
  registerOrdinaryProfileSource({kind: 'session-root', directory: firstDirectory});
  const initial = readOrdinaryProfileSources()!; expect(initial.version).toBe(1);
  const registry = join(state.home, '.xiaok/profile-sources/registry.json');
  const sources = [...initial.sources]; const seed = {...initial, sources};
  const ids = new Set(sources.map(source => source.sourceId));
  const namespaces = new Set(sources.map(source => source.namespaceId));
  let expectedBytes = Buffer.byteLength(JSON.stringify(seed));
  // Fill in O(n) using the exact JSON row sizes, then verify the actual whole bytes.
  // Historical DTOs are legal discovery data, not live source/custody claims.
  for (const source of discoveryData(1400).sources) {
    if (ids.has(source.sourceId) || namespaces.has(source.namespaceId)) continue;
    const additional = Buffer.byteLength(JSON.stringify(source)) + 1; // Existing array is nonempty.
    if (expectedBytes + additional > MAX) break;
    sources.push(source); ids.add(source.sourceId); namespaces.add(source.namespaceId); expectedBytes += additional;
  }
  expect(sources.length).toBeGreaterThan(initial.sources.length);
  const flat = JSON.stringify(seed); expect(Buffer.byteLength(flat)).toBe(expectedBytes);
  expect(expectedBytes).toBeLessThanOrEqual(MAX); expect(JSON.parse(flat).version).toBe(1);
  writeFileSync(registry, flat);
  // Validate the complete seeded input through the actual existing public reader first.
  expect(readOrdinaryProfileSources()).toEqual(seed);
  const directory = join(root, 'new-' + 'a'.repeat(175), 'b'.repeat(180), 'c'.repeat(180));
  mkdirSync(directory, {recursive: true});
  const headroom = MAX - Buffer.byteLength(readFileSync(registry));
  // The actual new record must at least contain this literal canonical path.
  expect(headroom).toBeLessThan(Buffer.byteLength(directory));
  // BEFORE: old producer's byte-budget branch throws capacity here.
  // AFTER: same producer must preserve all rows and commit one new generation as raw v3.
  registerOrdinaryProfileSource({kind: 'task-root', directory});
  const after = readOrdinaryProfileSources()!;
  expect(after.uid).toBe(initial.uid); expect(after.generation).toBe(String(BigInt(seed.generation) + 1n));
  expect([1, 2]).toContain(after.version); expect(after.version).toBe(seed.version);
  expect(after.legacyInventoryRequired).toBe(true); expect(after.sources).toHaveLength(seed.sources.length + 1);
  expect(after.sources.slice(0, seed.sources.length)).toEqual(seed.sources);
  expect(after.sources.at(-1)).toMatchObject({kind: 'task-root', directory: {canonicalPath: directory}});
  const persisted = readFileSync(registry); expect(persisted.byteLength).toBeLessThanOrEqual(MAX);
  const raw = JSON.parse(persisted.toString('utf8')); expect(raw.version).toBe(3); expect(raw.sourceVersion).toBe(seed.version);
});
