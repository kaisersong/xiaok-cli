// Copy non-compiled assets into .test-dist so sandbox tests resolve the same files as dev runs.
// tsc (tsconfig.tests.json) only emits .js for .ts inputs; tests reference fixtures, loaders,
// workers and spawned `.ts` entries by path (e.g. tests/support/*.mjs, src/**/controller-entry.ts
// spawned with `--import tsx`). Without this copy those paths only exist in dev, not in .test-dist.
import { cp, mkdir } from 'node:fs/promises';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, '.test-dist');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}


// 1) tests/**: everything except *.test.ts (compiled by tsc) and *.d.mts (type-only).
// Never delete .test-dist/tests first: tsc emits compiled .js there.
const testsOut = join(out, 'tests');
await mkdir(testsOut, { recursive: true });
let testsCopied = 0;
for await (const file of walk(join(root, 'tests'))) {
  const rel = file.slice(join(root, 'tests').length + 1);
  if (rel.endsWith('.test.ts') || rel.endsWith('.d.mts')) continue;
  await mkdir(join(testsOut, rel, '..'), { recursive: true });
  await cp(file, join(testsOut, rel));
  testsCopied++;
}

// 2) src/**/*.ts: spawned child entries load TS sources with `--import tsx` (e.g.
// controller-entry.ts, ordinary-profile-source-registry.ts, capacity modules); their internal
// `.js` import specifiers resolve to the compiled siblings emitted next to them.
let srcCopied = 0;
for await (const file of walk(join(root, 'src'))) {
  if (!file.endsWith('.ts')) continue;
  const rel = file.slice(join(root, 'src').length + 1);
  await mkdir(join(out, 'src', rel, '..'), { recursive: true });
  await cp(file, join(out, 'src', rel));
  srcCopied++;
}
// 3) scripts/** non-TS assets: sandbox tests resolve assets relative to .test-dist
// (e.g. scripts/verification/artifact-export-toolchain.lock.json, build-artifact-export-helper.mjs).
let scriptsCopied = 0;
const scriptsRoot = join(root, 'scripts');
for await (const file of walk(scriptsRoot)) {
  if (file.endsWith('.ts') || file.endsWith('.d.mts')) continue;
  const rel = file.slice(scriptsRoot.length + 1);
  if (rel.includes('__pycache__')) continue;
  await mkdir(join(out, 'scripts', rel, '..'), { recursive: true });
  await cp(file, join(out, 'scripts', rel));
  scriptsCopied++;
}
console.log(`copy-test-assets: tests=${testsCopied} srcTs=${srcCopied} scripts=${scriptsCopied}`);
