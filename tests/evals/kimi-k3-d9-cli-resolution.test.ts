import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kimi-d9-resolution-'));
  roots.push(root);
  for (const directory of [
    'dist',
    'node_modules/pkg-a',
    'node_modules/pkg-b',
    'node_modules/pkg-c',
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'dist/index.js'), [
    "import value from 'pkg-a';",
    "const lazy = await import('pkg-c');",
    "export { value, lazy };",
  ].join('\n'));
  writeFileSync(
    join(root, 'node_modules/pkg-a/package.json'),
    '{"name":"pkg-a","main":"index.cjs"}',
  );
  writeFileSync(join(root, 'node_modules/pkg-a/index.cjs'), [
    "const b = require('pkg-b');",
    "module.exports = b;",
  ].join('\n'));
  writeFileSync(
    join(root, 'node_modules/pkg-b/package.json'),
    '{"name":"pkg-b","type":"module","exports":"./index.js"}',
  );
  writeFileSync(join(root, 'node_modules/pkg-b/index.js'), [
    "import { createRequire } from 'node:module';",
    'const localRequire = createRequire(import.meta.url);',
    "export default localRequire.resolve('pkg-c');",
  ].join('\n'));
  writeFileSync(
    join(root, 'node_modules/pkg-c/package.json'),
    '{"name":"pkg-c","main":"index.cjs"}',
  );
  writeFileSync(join(root, 'node_modules/pkg-c/index.cjs'), 'module.exports = 3;\n');
  return root;
}

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/resolution-graph.mjs',
  )).href);
}

describe('Kimi K3 D9 recursive resolution graph', () => {
  it('walks ESM, CJS, dynamic import, createRequire, and require.resolve to a fixed point', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });

    expect(graph.modules).toEqual(expect.arrayContaining([
      'dist/index.js',
      'node_modules/pkg-a/index.cjs',
      'node_modules/pkg-b/index.js',
      'node_modules/pkg-c/index.cjs',
    ]));
    expect(graph.edges.map((edge: any) => edge.kind)).toEqual(expect.arrayContaining([
      'import',
      'dynamic-import',
      'require',
      'create-require-resolve',
    ]));
  });

  it('allows a computed edge only with exact importer hash, location, pattern, and finite targets', async () => {
    const { buildReachableResolutionGraph, inspectModuleEdges } = await loadModule();
    const root = fixtureRoot();
    const importer = join(root, 'dist/computed.js');
    const source = "const name = 'pkg-c'; export default import(name);\n";
    writeFileSync(importer, source);
    writeFileSync(join(root, 'dist/index.js'), "import './computed.js';\n");
    const inspected = await inspectModuleEdges(importer);
    const computed = inspected.find((edge: any) => edge.computed);

    await expect(buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    })).rejects.toThrow('KIMI_D9_COMPUTED_EDGE_NOT_ALLOWED');

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [{
        importerSha256: computed.importerSha256,
        astLocation: computed.astLocation,
        pattern: computed.pattern,
        targets: ['pkg-c'],
      }],
    });
    expect(graph.modules).toContain('node_modules/pkg-c/index.cjs');

    await expect(buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [{
        importerSha256: computed.importerSha256,
        astLocation: computed.astLocation,
        pattern: computed.pattern,
        targets: ['pkg-a', 'pkg-c'],
      }],
    })).rejects.toThrow('KIMI_D9_COMPUTED_EDGE_RUNTIME_TARGET_MISMATCH');
  });

  it('uses import and require conditions independently for package exports', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    mkdirSync(join(root, 'node_modules/conditional'), { recursive: true });
    writeFileSync(join(root, 'node_modules/conditional/package.json'), JSON.stringify({
      name: 'conditional',
      type: 'module',
      exports: {
        import: './esm.js',
        require: './cjs.cjs',
      },
    }));
    writeFileSync(join(root, 'node_modules/conditional/esm.js'), 'export default "esm";\n');
    writeFileSync(join(root, 'node_modules/conditional/cjs.cjs'), 'module.exports = "cjs";\n');
    writeFileSync(join(root, 'node_modules/pkg-a/index.cjs'), [
      "require('conditional');",
      'module.exports = 1;',
    ].join('\n'));
    writeFileSync(join(root, 'dist/index.js'), [
      "import 'conditional';",
      "import 'pkg-a';",
    ].join('\n'));

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });
    expect(graph.modules).toEqual(expect.arrayContaining([
      'node_modules/conditional/esm.js',
      'node_modules/conditional/cjs.cjs',
    ]));
  });

  it('resolves exact Node package-exports wildcard substitutions', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    mkdirSync(join(root, 'node_modules/wild/dist/feature'), { recursive: true });
    writeFileSync(join(root, 'node_modules/wild/package.json'), JSON.stringify({
      name: 'wild',
      type: 'module',
      exports: {
        './*': {
          import: './dist/*',
          require: './cjs/*',
        },
      },
    }));
    writeFileSync(
      join(root, 'node_modules/wild/dist/feature/index.js'),
      'export const feature = true;\n',
    );
    writeFileSync(
      join(root, 'dist/index.js'),
      "import 'wild/feature/index.js';\n",
    );

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });
    expect(graph.modules).toContain(
      'node_modules/wild/dist/feature/index.js',
    );
  });

  it('does not classify a function-local Browserify require parameter as Node require', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    writeFileSync(join(root, 'dist/index.js'), [
      '(function bundledModule(require) {',
      "  require('missing-browserify-module');",
      "  require.resolve('missing-browserify-module');",
      '})(function localRequire() {});',
    ].join('\n'));

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });
    expect(graph.modules).toEqual(['dist/index.js']);
    expect(graph.edges).toEqual([]);
  });

  it('classifies a local alias of the Node require loader as a computed edge', async () => {
    const { buildReachableResolutionGraph, inspectModuleEdges } =
      await loadModule();
    const root = fixtureRoot();
    const importer = join(root, 'dist/index.js');
    writeFileSync(importer, [
      'const runtimeRequire = globalThis.webpack ? otherRequire : require;',
      "const target = 'pkg-c';",
      'module.exports = runtimeRequire(target);',
    ].join('\n'));
    const computed = (await inspectModuleEdges(importer))
      .find((edge: any) => edge.computed);

    await expect(buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    })).rejects.toThrow('KIMI_D9_COMPUTED_EDGE_NOT_ALLOWED');

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [{
        importerSha256: computed.importerSha256,
        astLocation: computed.astLocation,
        pattern: computed.pattern,
        targets: ['pkg-c'],
      }],
    });
    expect(graph.modules).toContain('node_modules/pkg-c/index.cjs');
  });

  it('records an absent require inside a guarded try block without resolving outside the closure', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    writeFileSync(join(root, 'dist/index.js'), [
      'try {',
      "  require('missing-optional-accelerator');",
      '} catch {}',
      'module.exports = 1;',
    ].join('\n'));

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });
    expect(graph.modules).toEqual(['dist/index.js']);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        specifier: 'missing-optional-accelerator',
        optional: true,
        optionalMissing: true,
      }),
    ]);
  });

  it('resolves package imports from the importer package scope', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      type: 'module',
      imports: {
        '#local-runtime': {
          import: './dist/local.js',
          default: './dist/fallback.js',
        },
      },
    }));
    writeFileSync(join(root, 'dist/local.js'), 'export const local = true;\n');
    writeFileSync(join(root, 'dist/fallback.js'), 'export const fallback = true;\n');
    writeFileSync(join(root, 'dist/index.js'), "import '#local-runtime';\n");

    const graph = await buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    });
    expect(graph.modules).toContain('dist/local.js');
    expect(graph.modules).not.toContain('dist/fallback.js');
  });

  it('rejects unregistered module-loader hooks and process.dlopen edges', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    for (const source of [
      "import { registerHooks } from 'node:module'; registerHooks({});\n",
      "process.dlopen({}, '/tmp/escape.node');\n",
      "require.extensions['.js'] = () => {};\n",
    ]) {
      writeFileSync(join(root, 'dist/index.js'), source);
      await expect(buildReachableResolutionGraph({
        closureRoot: root,
        entryRelativePath: 'dist/index.js',
        computedEdgeAllowlist: [],
      })).rejects.toThrow(/KIMI_D9_(UNKNOWN_LOADER_HOOK|DLOPEN_NOT_ALLOWED)/u);
    }
  });

  it('rejects missing, absolute, ancestor, and nested-symlink escapes', async () => {
    const { buildReachableResolutionGraph } = await loadModule();
    const root = fixtureRoot();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'kimi-d9-resolution-outside-'));
    roots.push(outsideRoot);
    mkdirSync(join(outsideRoot, 'node_modules/escape'), { recursive: true });
    writeFileSync(join(outsideRoot, 'node_modules/escape/index.js'), 'export default 1;\n');
    writeFileSync(
      join(outsideRoot, 'node_modules/escape/package.json'),
      '{"name":"escape","type":"module","main":"index.js"}',
    );

    for (const source of [
      "import 'missing-package';\n",
      `import ${JSON.stringify(pathToFileURL(join(outsideRoot, 'outside.js')).href)};\n`,
      "import 'escape';\n",
    ]) {
      writeFileSync(join(root, 'dist/index.js'), source);
      await expect(buildReachableResolutionGraph({
        closureRoot: root,
        entryRelativePath: 'dist/index.js',
        computedEdgeAllowlist: [],
      })).rejects.toThrow(/KIMI_D9_(MISSING_MODULE|RESOLUTION_ESCAPE)/u);
    }

    mkdirSync(join(root, 'node_modules/nested'), { recursive: true });
    symlinkSync(
      join(outsideRoot, 'node_modules/escape'),
      join(root, 'node_modules/nested/escape'),
    );
    writeFileSync(
      join(root, 'node_modules/nested/package.json'),
      '{"name":"nested","main":"index.cjs"}',
    );
    writeFileSync(join(root, 'node_modules/nested/index.cjs'), "module.exports=require('./escape');\n");
    writeFileSync(join(root, 'dist/index.js'), "import 'nested';\n");
    await expect(buildReachableResolutionGraph({
      closureRoot: root,
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: [],
    })).rejects.toThrow('KIMI_D9_RESOLUTION_ESCAPE');
  });
});
