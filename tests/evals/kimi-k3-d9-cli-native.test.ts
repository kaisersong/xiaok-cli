import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

function writeMachO(path: string, cpuType = 0x0100000c): void {
  const header = Buffer.alloc(32);
  header.set([0xcf, 0xfa, 0xed, 0xfe], 0);
  header.writeUInt32LE(cpuType, 4);
  writeFileSync(path, header);
}

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/native-graph.mjs',
  )).href);
}

describe('Kimi K3 D9 native dependency graph', () => {
  it('classifies unreachable Mach-O, ELF, and PE artifacts without selecting foreign roots', async () => {
    const { buildNativeDependencyGraph } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-native-'));
    roots.push(root);
    mkdirSync(join(root, 'runtime/node/bin'), { recursive: true });
    mkdirSync(join(root, 'node_modules/native/bin'), { recursive: true });
    writeMachO(join(root, 'runtime/node/bin/node'));
    writeMachO(join(root, 'node_modules/native/bin/darwin.node'));
    writeFileSync(join(root, 'node_modules/native/bin/linux.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    writeFileSync(join(root, 'node_modules/native/bin/windows.node'), Buffer.from('MZ'));

    const graph = await buildNativeDependencyGraph({
      closureRoot: root,
      nodeExecutable: 'runtime/node/bin/node',
      reachableNativeRoots: ['node_modules/native/bin/darwin.node'],
      allNativeArtifacts: [
        'node_modules/native/bin/darwin.node',
        'node_modules/native/bin/linux.node',
        'node_modules/native/bin/windows.node',
      ],
      expectedArch: 'arm64',
      inspectMachO: async () => ({ dependencies: [], rpaths: [] }),
    });

    expect(graph.classifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'node_modules/native/bin/linux.node', format: 'elf', reachable: false }),
      expect.objectContaining({ relativePath: 'node_modules/native/bin/windows.node', format: 'pe', reachable: false }),
    ]));
  });

  it('rejects selected foreign format and wrong architecture', async () => {
    const { buildNativeDependencyGraph } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-native-invalid-'));
    roots.push(root);
    mkdirSync(join(root, 'runtime/node/bin'), { recursive: true });
    mkdirSync(join(root, 'node_modules/native'), { recursive: true });
    writeMachO(join(root, 'runtime/node/bin/node'));
    writeFileSync(join(root, 'node_modules/native/foreign.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    writeMachO(join(root, 'node_modules/native/x64.node'), 0x01000007);

    for (const selected of ['node_modules/native/foreign.node', 'node_modules/native/x64.node']) {
      await expect(buildNativeDependencyGraph({
        closureRoot: root,
        nodeExecutable: 'runtime/node/bin/node',
        reachableNativeRoots: [selected],
        allNativeArtifacts: [selected],
        expectedArch: 'arm64',
        inspectMachO: async () => ({ dependencies: [], rpaths: [] }),
      })).rejects.toThrow(/KIMI_D9_NATIVE_(FOREIGN|ARCH_MISMATCH)/u);
    }
  });

  it('requires an exact modules-ABI or Node-API compatibility attestation for selected addons', async () => {
    const { buildNativeDependencyGraph } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-native-abi-'));
    roots.push(root);
    mkdirSync(join(root, 'runtime/node/bin'), { recursive: true });
    mkdirSync(join(root, 'node_modules/native'), { recursive: true });
    writeMachO(join(root, 'runtime/node/bin/node'));
    writeMachO(join(root, 'node_modules/native/addon.node'));
    const base = {
      closureRoot: root,
      nodeExecutable: 'runtime/node/bin/node',
      reachableNativeRoots: ['node_modules/native/addon.node'],
      allNativeArtifacts: ['node_modules/native/addon.node'],
      expectedArch: 'arm64',
      expectedModulesAbi: '137',
      expectedNodeApi: '10',
      inspectMachO: async () => ({ dependencies: [], rpaths: [] }),
    };

    await expect(buildNativeDependencyGraph(base)).rejects
      .toThrow('KIMI_D9_NATIVE_COMPATIBILITY_MISSING');
    await expect(buildNativeDependencyGraph({
      ...base,
      compatibilityByRelativePath: {
        'node_modules/native/addon.node': { kind: 'node-api', version: '11' },
      },
    })).rejects.toThrow('KIMI_D9_NATIVE_NAPI_INCOMPATIBLE');
    await expect(buildNativeDependencyGraph({
      ...base,
      compatibilityByRelativePath: {
        'node_modules/native/addon.node': { kind: 'modules-abi', version: '137' },
      },
    })).resolves.toBeDefined();
  });

  it('recurses through non-system dylibs and rejects a dependency outside the closure', async () => {
    const { buildNativeDependencyGraph } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-native-deps-'));
    roots.push(root);
    mkdirSync(join(root, 'runtime/node/bin'), { recursive: true });
    mkdirSync(join(root, 'runtime/lib'), { recursive: true });
    writeMachO(join(root, 'runtime/node/bin/node'));
    writeMachO(join(root, 'runtime/lib/libinside.dylib'));

    const inside = await buildNativeDependencyGraph({
      closureRoot: root,
      nodeExecutable: 'runtime/node/bin/node',
      reachableNativeRoots: [],
      allNativeArtifacts: [],
      expectedArch: 'arm64',
      inspectMachO: async (path: string) => path.endsWith('/bin/node')
        ? { dependencies: ['@executable_path/../../lib/libinside.dylib'], rpaths: [] }
        : { dependencies: ['/usr/lib/libSystem.B.dylib'], rpaths: [] },
    });
    expect(inside.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolvedRelativePath: 'runtime/lib/libinside.dylib' }),
      expect.objectContaining({ system: true }),
    ]));

    await expect(buildNativeDependencyGraph({
      closureRoot: root,
      nodeExecutable: 'runtime/node/bin/node',
      reachableNativeRoots: [],
      allNativeArtifacts: [],
      expectedArch: 'arm64',
      inspectMachO: async () => ({ dependencies: ['/opt/evil/libescape.dylib'], rpaths: [] }),
    })).rejects.toThrow('KIMI_D9_NATIVE_DEPENDENCY_ESCAPE');
  });
});
