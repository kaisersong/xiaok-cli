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


// Static graph fixtures only: these files are never imported or dlopened.
const fixedNativePattern = "require(join(dirname(require.resolve('nodejieba')), 'build', 'Release', 'nodejieba.node'))";
const fixedNativeTarget = '../../../node_modules/nodejieba/build/Release/nodejieba.node';
function fixedNativeFixture(change: (source: string) => string = source => source) {
  const root = fixtureRoot(), importer = join(root, 'dist/ai/memory/segment.js');
  mkdirSync(dirname(importer), { recursive: true });
  mkdirSync(join(root, 'node_modules/nodejieba/build/Release'), { recursive: true });
  writeFileSync(join(root, 'node_modules/nodejieba/package.json'), '{"main":"index.js"}');
  writeFileSync(join(root, 'node_modules/nodejieba/index.js'), 'module.exports = {};\n');
  writeFileSync(join(root, 'node_modules/nodejieba/build/Release/nodejieba.node'), 'static graph placeholder, not Native qualification');
  const source = [
    "import { createRequire } from 'node:module';",
    "import { dirname, join } from 'node:path';",
    'const require = createRequire(import.meta.url);',
    'export function check() { try { ' + fixedNativePattern + '; } catch {} }',
  ].join('\n');
  writeFileSync(importer, change(source));
  writeFileSync(join(root, 'dist/index.js'), "import './ai/memory/segment.js';\n");
  return { root, importer };
}

it('derives only the original fixed nodejieba binding and still requires its exact allowlist', async () => {
  const { inspectModuleEdges, buildReachableResolutionGraph } = await loadModule();
  const { root, importer } = fixedNativeFixture();
  const edge = (await inspectModuleEdges(importer)).find((value: any) => value.pattern === fixedNativePattern);
  expect(edge.runtimeTargets).toEqual([fixedNativeTarget]);
  await expect(buildReachableResolutionGraph({ closureRoot: root })).rejects.toThrow('KIMI_D9_COMPUTED_EDGE_NOT_ALLOWED');
  const entry = { importerSha256: edge.importerSha256, astLocation: edge.astLocation, pattern: edge.pattern, targets: [fixedNativeTarget] };
  const graph = await buildReachableResolutionGraph({ closureRoot: root, computedEdgeAllowlist: [entry] });
  expect(graph.modules).toContain('node_modules/nodejieba/build/Release/nodejieba.node');
  await expect(buildReachableResolutionGraph({ closureRoot: root, computedEdgeAllowlist: [{ ...entry, targets: ['../../../node_modules/pkg-c/index.cjs'] }] })).rejects.toThrow('KIMI_D9_COMPUTED_EDGE_RUNTIME_TARGET_MISMATCH');
});

const fixedBindingAttacks: Array<[string, (source: string) => string]> = [
  ['function shadow', s => s + '\nfunction join() {}'],
  ['class shadow', s => s + '\nclass dirname {}'],
  ['spread argument', s => s.replace("'build', 'Release'", "...['build'], 'Release'")],
  ['loader argument escape', s => s + '\nhelper(require);'],
  ['require update', s => s + '\nrequire++;'],
  ['require parameter', s => s.replace('function check()', 'function check(require)')],
  ['join parameter', s => s.replace('function check()', 'function check(join)')],
  ['dirname parameter', s => s.replace('function check()', 'function check(dirname)')],
  ['createRequire parameter', s => s.replace('function check()', 'function check(createRequire)')],
  ['destructured shadow', s => s.replace('function check()', 'function check({ require })')],
  ['catch shadow', s => s.replace('try { ' + fixedNativePattern + '; } catch {}', 'try {} catch (require) { ' + fixedNativePattern + '; }')],
  ['block shadow', s => s.replace('try { ', "try { const join = () => ''; ")],
  ['wrong path import', s => s.replace("from 'node:path'", "from 'foreign-path'")],
  ['aliased path import', s => s.replace('{ dirname, join }', '{ dirname, resolve as join }')],
  ['nonconst require', s => s.replace('const require =', 'let require =')],
  ['different base', s => s.replace('createRequire(import.meta.url)', "createRequire('file:///foreign.js')")],
  ['resolve write', s => s.replace('export function', "require.resolve = () => '/foreign.js';\nexport function")],
  ['loader escape', s => s.replace('export function', 'const alias = require;\nexport function')],
  ['resolve escape', s => s.replace('export function', 'const alias = require.resolve;\nexport function')],
  ['callee escape', s => s.replace('export function', 'const alias = join;\nexport function')],
  ['define loader property', s => s.replace('export function', "Object.defineProperty(require, 'resolve', { value() {} });\nexport function")],
  ['direct eval', s => s.replace('export function', "eval('require.resolve = other');\nexport function")],
  ['different release path', s => s.replace("'Release'", "'Debug'")],
  ['different package', s => s.replace("'nodejieba'", "'foreign-package'")],
  ['extra path argument', s => s.replace("'build', 'Release'", "'extra', 'build', 'Release'")],
  ['escaped literal', s => s.replace("'Release'", "'Rele\\u0061se'")],
  ['template literal', s => s.replace("'Release'", '`Release`')],
  ['bracket resolve', s => s.replace('require.resolve', "require['resolve']")],
  ['optional call', s => s.replace('require(join(', 'require?.(join(')],
  ['call alias', s => s.replace('require(join(', 'require.call(null, join(')],
];
it.each(fixedBindingAttacks)('refuses fixed nodejieba computed binding drift: %s', async (_name, change) => {
  const { inspectModuleEdges } = await loadModule();
  const { importer } = fixedNativeFixture(change);
  await expect(inspectModuleEdges(importer)).rejects.toThrow('KIMI_D9_FIXED_NODEJIEBA_');
});

it('does not derive the fixed target from a nearer substitute package', async () => {
  const { inspectModuleEdges } = await loadModule();
  const { importer } = fixedNativeFixture();
  const nested = join(dirname(importer), 'node_modules/nodejieba');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package.json'), '{"main":"index.js"}');
  writeFileSync(join(nested, 'index.js'), 'module.exports = {};\n');
  await expect(inspectModuleEdges(importer)).rejects.toThrow('KIMI_D9_FIXED_NODEJIEBA_TARGET');
});

it('keeps absent-package and native symlink targets failclosed', async () => {
  const { inspectModuleEdges, buildReachableResolutionGraph } = await loadModule();
  const missing = fixedNativeFixture();
  rmSync(join(missing.root, 'node_modules/nodejieba'), { recursive: true });
  await expect(inspectModuleEdges(missing.importer)).rejects.toThrow('KIMI_D9_FIXED_NODEJIEBA_TARGET');
  const { root, importer } = fixedNativeFixture();
  const edge = (await inspectModuleEdges(importer)).find((value: any) => value.pattern === fixedNativePattern);
  const native = join(root, 'node_modules/nodejieba/build/Release/nodejieba.node');
  rmSync(native);
  symlinkSync(join(missing.root, 'package.json'), native);
  await expect(buildReachableResolutionGraph({ closureRoot: root, computedEdgeAllowlist: [{ ...edge, targets: [fixedNativeTarget] }] })).rejects.toThrow('KIMI_D9_RESOLUTION_ESCAPE');
});
