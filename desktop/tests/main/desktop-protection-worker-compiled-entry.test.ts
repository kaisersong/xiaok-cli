// @vitest-environment node
import { afterAll, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopTaskObservationStore } from '../../../src/runtime/task-host/protected-observation-store.js';
import { compileProtectionWorkerEntry, preserveOriginalModuleUrls } from '../fixtures/desktop-protection-worker-entry.js';
import { pathToFileURL } from 'node:url';

const physical = vi.hoisted(() => ({ entry: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async original => {
  const actual = await original<typeof import('node:worker_threads')>();
  const fixedSource = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === fixedSource;
      if (mapped && !physical.entry) throw Error('fresh fixed protection Worker is required');
      super(mapped ? physical.entry : filename, options);
      if (mapped) { physical.starts++; this.once('exit', () => physical.exits++); }
    }
  } };
});
const cleanup: string[] = [];
afterAll(() => { for (const root of cleanup) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
it('fresh full production compilation supplies an actual fixed protection Worker and physical exit', async () => {
  const compiled = await compileProtectionWorkerEntry(); cleanup.push(compiled.root);
  expect(existsSync(compiled.output)).toBe(true);
  expect(compiled.sourceSha).toMatch(/^[a-f0-9]{64}$/);
  expect(compiled.emittedSha).toMatch(/^[a-f0-9]{64}$/);
  expect(compiled.audit.length).toBeGreaterThan(1);
  for (const module of compiled.audit) expect(module.originalUrl).toBe(pathToFileURL(module.file).href);
  physical.entry = compiled.output;
  const root = mkdtempSync(join(tmpdir(), 'fresh-native-protection-account-')); cleanup.push(root);
  const store = new DesktopTaskObservationStore(root, join(root, 'canonical'));
  expect(await store.readProtectionInWorker('ordinary-task')).toEqual({});
  expect(physical.starts).toBe(1); expect(physical.exits).toBe(1);
}, 20000);

it('preserves only lexical module URLs, including spaces and hashes in the original path', () => {
  const file = join(tmpdir(), 'original emitted # module.js');
  const source = `export const url=import.meta.url; export const literal="import.meta.url"; // import.meta.url\n`;
  const transformed = preserveOriginalModuleUrls(source, file);
  expect(transformed.replacements).toBe(1);
  expect(transformed.contents).toContain(JSON.stringify(pathToFileURL(file).href));
  expect(transformed.contents).toContain('const literal="import.meta.url"; // import.meta.url');
});
it.each(["import.meta['url']", 'import.meta', 'import.meta.env', 'import.meta?.url'])('rejects unsupported lexical %s without changing its meaning', expression => {
  expect(() => preserveOriginalModuleUrls(`export const value=${expression};`, join(tmpdir(), 'original.js')))
    .toThrow('unsupported_worker_module_meta');
});
