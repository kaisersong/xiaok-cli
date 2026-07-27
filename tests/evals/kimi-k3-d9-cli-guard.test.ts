import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const guardPath = join(
  process.cwd(),
  'scripts/evals/kimi-k3-d9/runtime-guard.mjs',
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function loadModule(): Promise<any> {
  return import(pathToFileURL(guardPath).href);
}

function runGuarded(entry: string, closureRoot: string, allowedRealpaths: string[]) {
  return spawnSync(process.execPath, [
    '--no-global-search-paths',
    '--import',
    guardPath,
    entry,
  ], {
    cwd: closureRoot,
    env: {
      PATH: process.env.PATH,
      XIAOK_D9_RUNTIME_GUARD_POLICY: JSON.stringify({
        closureRoot,
        allowedRealpaths,
      }),
    },
    encoding: 'utf8',
  });
}

describe('Kimi K3 D9 synchronous runtime guard', () => {
  it('fails before product entry evaluation when synchronous hooks are unavailable', async () => {
    const { assertRuntimeGuardSupport } = await loadModule();
    expect(() => assertRuntimeGuardSupport({ registerHooks: undefined }))
      .toThrow('KIMI_D9_GUARD_UNSUPPORTED');
  });

  it.each([
    {
      name: 'ESM import',
      extension: 'mjs',
      source: (outsideUrl: string) => `import ${JSON.stringify(outsideUrl)};\n`,
    },
    {
      name: 'CJS require',
      extension: 'cjs',
      source: (outsidePath: string) => `require(${JSON.stringify(outsidePath)});\n`,
    },
    {
      name: 'createRequire',
      extension: 'mjs',
      source: (outsidePath: string) => [
        "import { createRequire } from 'node:module';",
        'const require = createRequire(import.meta.url);',
        `require(${JSON.stringify(outsidePath)});`,
      ].join('\n'),
    },
  ])('blocks $name before outside top-level side effects', ({ extension, source }) => {
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-guard-'));
    roots.push(root);
    const closure = join(root, 'closure');
    mkdirSync(closure);
    const sideEffect = join(root, 'outside-ran');
    const outside = join(root, 'outside.cjs');
    writeFileSync(outside, `require('node:fs').writeFileSync(${JSON.stringify(sideEffect)}, 'ran');\n`);
    const entry = join(closure, `entry.${extension}`);
    const edgeTarget = extension === 'mjs' && !source('').includes('createRequire')
      ? pathToFileURL(outside).href
      : outside;
    writeFileSync(entry, source(edgeTarget));

    const result = runGuarded(entry, closure, [entry]);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain('KIMI_D9_GUARD_RESOLUTION_ESCAPE');
    expect(existsSync(sideEffect)).toBe(false);
  });

  it('detects guard bytes and mode drift in the digest used by every launch', async () => {
    const { digestGuardTree, verifyGuardTree } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-guard-tree-'));
    roots.push(root);
    mkdirSync(join(root, 'runtime/guard'), { recursive: true });
    const copiedGuard = join(root, 'runtime/guard/runtime-guard.mjs');
    writeFileSync(copiedGuard, 'export {};\n');
    const digest = await digestGuardTree(join(root, 'runtime/guard'));

    writeFileSync(copiedGuard, 'export const drift = true;\n');
    await expect(verifyGuardTree(join(root, 'runtime/guard'), digest))
      .rejects.toThrow('KIMI_D9_GUARD_DIGEST_MISMATCH');

    writeFileSync(copiedGuard, 'export {};\n');
    chmodSync(copiedGuard, 0o700);
    await expect(verifyGuardTree(join(root, 'runtime/guard'), digest))
      .rejects.toThrow('KIMI_D9_GUARD_DIGEST_MISMATCH');
  });
});
