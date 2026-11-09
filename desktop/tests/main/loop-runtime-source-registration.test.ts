// @vitest-environment node
import {afterAll, afterEach, beforeEach, expect, it, vi} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const isolated = await vi.hoisted(async () => {
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-runtime-registry-config-')));
  fs.chmodSync(root, 0o700);
  const previous = process.env.XIAOK_CONFIG_DIR;
  const config = path.join(root, 'initial', '.xiaok');
  fs.mkdirSync(config, {recursive: true, mode: 0o700});
  process.env.XIAOK_CONFIG_DIR = config;
  return {root, previous};
});
vi.unmock('../../electron/loop-database-source-observation.js');
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
vi.mock('../../../src/runtime/verification/migration-markers.js', () => ({
  readInstalledCurrentProfile: () => ({kind: 'ordinary'}),
}));

import {createDesktopLoopRuntime} from '../../electron/loop-executor.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';

const runtimes: ReturnType<typeof createDesktopLoopRuntime>[] = [];
const roots: string[] = [];
let serial = 0, root: string, config: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-runtime-registry-data-')));
  roots.push(root);
  config = join(isolated.root, 'case-' + ++serial, '.xiaok');
  mkdirSync(config, {recursive: true, mode: 0o700});
  process.env.XIAOK_CONFIG_DIR = config;
});
afterEach(() => {
  const failures: unknown[] = [];
  for (const runtime of runtimes.splice(0).reverse()) {
    try { runtime.close(); } catch (error) { failures.push(error); }
  }
  for (const path of roots.splice(0)) rmSync(path, {recursive: true, force: true});
  if (failures.length) throw new AggregateError(failures, 'loop_runtime_registry_test_cleanup');
});
afterAll(() => {
  if (isolated.previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = isolated.previous;
  rmSync(isolated.root, {recursive: true, force: true});
});

it.skipIf(process.platform === 'win32')('registers the actual shared runtime and its successful component history without a manual observation call', () => {
  const runtime = createDesktopLoopRuntime({dataRoot: root, now: () => 123});
  runtimes.push(runtime);
  const facts = readOrdinaryProfileSources();
  expect(facts).toBeDefined();
  expect(facts!.legacyInventoryRequired).toBe(true);
  expect(facts!.sources).toHaveLength(1);
  const row = facts!.sources[0]!;
  expect(row.database?.basename).toBe('loop-evidence.sqlite');
  expect(row.componentHistory).toMatchObject({
    historyUnknown: true,
    components: ['artifactScanner', 'completion', 'healthScanner', 'loop'],
  });
  expect(row.componentHistory!.observations.map(value => value.layoutRevision).sort()).toEqual([0, 1, 2, 3, 4]);
  expect(row.componentHistory).not.toHaveProperty('historyComplete');
  expect(facts).not.toHaveProperty('productionQualified');
});

it.skipIf(process.platform === 'win32')('registers the two actual runtime databases with their own component populations', () => {
  const runtime = createDesktopLoopRuntime({dataRoot: root, loopDbPath: join(root, 'loops.sqlite'),
    completionEvidenceDbPath: join(root, 'evidence.sqlite'), now: () => 123});
  runtimes.push(runtime);
  const facts = readOrdinaryProfileSources();
  expect(facts?.sources).toHaveLength(2);
  expect(facts!.sources.find(row => row.database?.basename === 'loops.sqlite')?.componentHistory)
    .toMatchObject({historyUnknown: true, components: ['loop']});
  expect(facts!.sources.find(row => row.database?.basename === 'evidence.sqlite')?.componentHistory)
    .toMatchObject({historyUnknown: true, components: ['artifactScanner', 'completion', 'healthScanner']});
  expect(facts!.legacyInventoryRequired).toBe(true);
});

it.skipIf(process.platform === 'win32')('preserves the actual source identity and unknown component history across a closed runtime restart', () => {
  const first = createDesktopLoopRuntime({dataRoot: root, now: () => 123});
  runtimes.push(first);
  const before = readOrdinaryProfileSources()!;
  const original = before.sources[0]!;
  expect(original.componentHistory!.observations).toHaveLength(5);
  first.close();
  const second = createDesktopLoopRuntime({dataRoot: root, now: () => 456});
  runtimes.push(second);
  const after = readOrdinaryProfileSources()!;
  expect(after.sources).toHaveLength(1);
  expect(after.sources[0]!.sourceId).toBe(original.sourceId);
  expect(after.sources[0]!.componentHistory).toEqual(original.componentHistory);
  expect(after.legacyInventoryRequired).toBe(true);
  expect(after.sources[0]!.componentHistory!.historyUnknown).toBe(true);
  expect(after.sources[0]!.componentHistory).not.toHaveProperty('historyComplete');
});

it('keeps a real memory runtime usable without creating a durable discovery registry', () => {
  const runtime = createDesktopLoopRuntime({dataRoot: root, loopDbPath: ':memory:', now: () => 123});
  runtimes.push(runtime);
  expect(runtime.loopStore.listLoopDefinitions().length).toBeGreaterThan(0);
  expect(existsSync(join(config, 'profile-sources', 'registry.json'))).toBe(false);
});

it.skipIf(process.platform !== 'win32')('keeps actual Windows ordinary runtime startup outside the POSIX discovery registry', () => {
  const runtime = createDesktopLoopRuntime({dataRoot: root, now: () => 123});
  runtimes.push(runtime);
  expect(runtime.loopStore.listLoopDefinitions().length).toBeGreaterThan(0);
  expect(existsSync(join(config, 'profile-sources', 'registry.json'))).toBe(false);
});
