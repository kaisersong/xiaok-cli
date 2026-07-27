import { resolve } from 'node:path';
import { inspectModuleEdges } from './resolution-graph.mjs';

const DARWIN_ARM64_EDGE_SPECIFICATIONS = Object.freeze([
  Object.freeze({
    importerRelativePath: 'node_modules/nodejieba/index.js',
    astLocation: '14:17',
    pattern: 'require(BINARY_PATH)',
    targets: Object.freeze(['./build/Release/nodejieba.node']),
  }),
  Object.freeze({
    importerRelativePath: 'node_modules/onnxruntime-node/dist/binding.js',
    astLocation: '11:1',
    pattern:
      'require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)',
    targets: Object.freeze([
      '../bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
    ]),
  }),
  Object.freeze({
    importerRelativePath: 'node_modules/better-sqlite3/lib/database.js',
    astLocation: '52:11',
    pattern:
      "requireFunc(path.resolve(nativeBinding).replace(/(\\.node)?$/, '.node'))",
    targets: Object.freeze(['../build/Release/better_sqlite3.node']),
  }),
  Object.freeze({
    importerRelativePath: 'node_modules/bindings/bindings.js',
    astLocation: '112:23',
    pattern: 'requireFunc.resolve(n)',
    targets: Object.freeze([
      '../better-sqlite3/build/Release/better_sqlite3.node',
    ]),
  }),
  Object.freeze({
    importerRelativePath: 'node_modules/bindings/bindings.js',
    astLocation: '112:48',
    pattern: 'requireFunc(n)',
    targets: Object.freeze([
      '../better-sqlite3/build/Release/better_sqlite3.node',
    ]),
  }),
]);

function fail(code) {
  throw new Error(code);
}

export async function createDarwinArm64ComputedEdgeAllowlist(closureRoot) {
  const byImporter = new Map();
  for (const specification of DARWIN_ARM64_EDGE_SPECIFICATIONS) {
    const specifications = byImporter.get(specification.importerRelativePath)
      ?? [];
    specifications.push(specification);
    byImporter.set(specification.importerRelativePath, specifications);
  }

  const allowlist = [];
  for (const [importerRelativePath, specifications] of byImporter) {
    const edges = (await inspectModuleEdges(
      resolve(closureRoot, importerRelativePath),
    )).filter(edge => edge.computed);
    if (edges.length !== specifications.length) {
      fail('KIMI_D9_COMPUTED_EDGE_SPECIFICATION_DRIFT');
    }
    for (const specification of specifications) {
      const edge = edges.find(candidate => (
        candidate.astLocation === specification.astLocation
        && candidate.pattern === specification.pattern
      ));
      if (!edge) fail('KIMI_D9_COMPUTED_EDGE_SPECIFICATION_DRIFT');
      allowlist.push(Object.freeze({
        importerSha256: edge.importerSha256,
        astLocation: edge.astLocation,
        pattern: edge.pattern,
        targets: specification.targets,
      }));
    }
  }
  return Object.freeze(allowlist);
}
