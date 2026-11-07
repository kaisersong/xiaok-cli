// @vitest-environment node
import { afterAll, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopTaskObservationStore } from '../../../src/runtime/task-host/protected-observation-store.js';
import { compileProtectionWorkerEntry, preserveOriginalModuleUrls, PROTECTION_WORKER_COMPILE_TIMEOUT_MS } from '../fixtures/desktop-protection-worker-entry.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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
  mkdirSync(join(root, 'protected-observation-sessions'));
  const store = new DesktopTaskObservationStore(root, join(root, 'canonical'));
  expect(await store.readProtectionInWorker('ordinary-task')).toEqual({});
  expect(physical.starts).toBe(1); expect(physical.exits).toBe(1);
}, PROTECTION_WORKER_COMPILE_TIMEOUT_MS);

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

// Master 615c6deb went red because a hook awaiting a fresh, fully type-checked
// protection Worker compile kept a 20s budget that loaded CI runners exceed.
// Every such call in the cross-platform CI list must use the shared budget.
it('gives every fresh protection Worker compile in the cross-platform CI list the shared runner budget', () => {
  expect(PROTECTION_WORKER_COMPILE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  const desktopRoot = fileURLToPath(new URL('../../', import.meta.url));
  const workflow = readFileSync(join(desktopRoot, '../.github/workflows/desktop-cross-platform.yml'), 'utf8');
  const step = workflow.slice(workflow.indexOf('name: Run cross-platform path tests'));
  const listed = [...step.slice(0, step.indexOf('- name:', 1)).matchAll(/tests\/\S+\.test\.tsx?/g)].map(match => match[0]);
  const hooks = new Set(['beforeAll', 'beforeEach', 'it', 'test']);
  const sites: Array<{ file: string; hook: string; timeout: string }> = [];
  for (const file of listed) {
    const text = readFileSync(join(desktopRoot, file), 'utf8');
    if (!text.includes('compileProtectionWorkerEntry(')) continue;
    const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'compileProtectionWorkerEntry') {
        let owner: ts.Node | undefined = node.parent;
        while (owner && !(ts.isCallExpression(owner) && ts.isIdentifier(owner.expression) && hooks.has(owner.expression.text))) owner = owner.parent;
        const call = owner as ts.CallExpression | undefined;
        const last = call?.arguments[call.arguments.length - 1];
        sites.push({ file, hook: call ? (call.expression as ts.Identifier).text : 'none',
          timeout: last && !ts.isFunctionLike(last) ? last.getText(syntax) : 'default' });
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
  }
  expect(sites.map(site => site.file)).toEqual(expect.arrayContaining([
    'tests/main/desktop-protection-ordinary-read.test.ts', 'tests/main/desktop-protection-worker-compiled-entry.test.ts']));
  for (const site of sites) expect(site, `${site.file} (${site.hook})`).toMatchObject({ timeout: 'PROTECTION_WORKER_COMPILE_TIMEOUT_MS' });
});
