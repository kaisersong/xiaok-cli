import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadModule(name: string): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9',
    name,
  )).href);
}

describe('Kimi K3 D9 CLI computed loader edges', () => {
  it('accounts for the fixed helper through literal imports without computed grants', async () => {
    const { inspectModuleEdges } = await loadModule('resolution-graph.mjs');
    for (const name of ['resolution-graph.mjs', 'fixed-nodejieba-edge.mjs']) {
      const edges = await inspectModuleEdges(join(process.cwd(), 'scripts/evals/kimi-k3-d9', name));
      expect(edges.length).toBeGreaterThan(0);
      if (name === 'fixed-nodejieba-edge.mjs') {
        expect(edges.every((edge: any) => !edge.computed)).toBe(true);
      } else {
        expect(edges).toContainEqual(expect.objectContaining({ specifier: './fixed-nodejieba-edge.mjs' }));
      }
    }
  });
  it('freezes every current darwin-arm64 computed loader target and closes the graph', async () => {
    const { createDarwinArm64ComputedEdgeAllowlist } =
      await loadModule('cli-computed-edges.mjs');
    const { buildReachableResolutionGraph } =
      await loadModule('resolution-graph.mjs');
    const allowlist = await createDarwinArm64ComputedEdgeAllowlist(
      process.cwd(),
    );

    expect(allowlist).toHaveLength(7);
    expect(allowlist).toContainEqual(expect.objectContaining({
      astLocation: '191:13',
      pattern: "require(join(dirname(require.resolve('nodejieba')), 'build', 'Release', 'nodejieba.node'))",
      targets: ['../../../node_modules/nodejieba/build/Release/nodejieba.node'],
    }));
    expect(allowlist).toContainEqual(expect.objectContaining({
      pattern: 'require(dir + "/" + name + ".node")',
      targets: ['../prebuilds/darwin-arm64/pty.node'],
    }));
    const graph = await buildReachableResolutionGraph({
      closureRoot: process.cwd(),
      entryRelativePath: 'dist/index.js',
      computedEdgeAllowlist: allowlist,
    });
    expect(graph.modules).toContain(
      'node_modules/nodejieba/build/Release/nodejieba.node',
    );
    expect(graph.modules).toContain(
      'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
    );
    expect(graph.modules).toContain(
      'node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
    );
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        specifier: 'utf-8-validate',
        optional: true,
        optionalMissing: true,
      }),
    ]));
  });
});
