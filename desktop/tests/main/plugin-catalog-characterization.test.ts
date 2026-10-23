// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { join, win32 } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { getPluginDependencyStatus } from '../../electron/plugin-dependency-service.js';
const source = readFileSync(new URL('../../electron/desktop-services.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('desktop-services.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function actualNode(name: string) {
  let text = '';
  const visit = (node: ts.Node) => {
    if ((ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name) text = node.getText(ast);
    ts.forEachChild(node, visit);
  }; visit(ast); expect(text).not.toBe(''); return text;
}
function actualMethod(name: string, names: string[], values: unknown[]) {
  const js = ts.transpileModule(`return ({ ${actualNode(name)} });`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return compileFunction(js, names)(...values)[name];
}
describe('actual plugin catalog readonly producer characterization', () => {
  it('records the current live MCP array alias without inventing a projection', () => {
    const owner = [{ name: 'owned', pluginName: 'owned-plugin', connected: true, enabled: true, toolCount: 1 }];
    const read = actualMethod('listPluginMcpServers', ['pluginMcpServers'], [owner]);
    expect(read()).toBe(owner);
  });
  it('keeps every actual sibling registry field and unknown JSON extras; local installation overrides the wire flag', async () => {
    const registry = JSON.parse(readFileSync(new URL('../../../../kai-xiaok-plugins/registry.json', import.meta.url), 'utf8'));
    registry.plugins[0].future = { value: ['preserved'] }; registry.plugins[0].installed = false;
    const fetch = vi.fn(async () => ({ ok: true, json: async () => registry }));
    const exists = vi.fn((path: string) => path === join('owned-plugins', registry.plugins[0].name, 'plugin.json'));
    const read = actualMethod('listAvailablePlugins', ['fetch', 'existsSync', 'join', 'pluginRootDir'], [fetch, exists, join, 'owned-plugins']);
    const result = await read();
    expect(result).toEqual(registry.plugins.map((p: { name: string }) => ({ ...p, installed: p.name === registry.plugins[0].name })));
    expect(Object.keys(result[0]).sort()).toEqual([...Object.keys(registry.plugins[0])].sort());
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry.json');
  });
  it('preserves original HTTP, parsing and malformed-data empty fallbacks', async () => {
    for (const fetch of [async () => ({ ok: false }), async () => { throw Error('network'); }, async () => ({ ok: true, json: async () => { throw Error('parse'); } }), async () => ({ ok: true, json: async () => ({ plugins: 42 }) })]) {
      expect(await actualMethod('listAvailablePlugins', ['fetch', 'existsSync', 'join', 'pluginRootDir'], [fetch, () => false, join, 'owned-plugins'])()).toEqual([]);
    }
  });
  it('uses the complete real dependency status and task producer while preserving Windows release-read branch', async () => {
    const facts = { platform: 'win32', appArch: 'x64', nativeOsArch: 'x64', pathEnv: '', exists: () => true, isFile: () => true, runCommand: vi.fn(async () => ({ exitCode: 0, stdout: '1.2.3', stderr: '' })) };
    const dependency = { id: 'cua-driver', displayName: 'Owned test dependency', kind: 'native_cli', supportedPlatforms: ['win32'], binaryCandidates: ['C:\\owned\\driver.exe'], minVersion: '1.2.3', health: { version: ['ignored', '--version'] } };
    const create = vi.fn(() => dependency); const resolve = vi.fn(async () => 'owned-release');
    const text = `const ${actualNode('getDependencyStatusView')}; return getDependencyStatusView;`;
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const getView = compileFunction(js, ['dependencyStatusOptions','options','process','createWindowsCuaDependency','join','homedir','resolveActivePrivateCuaRelease','isPluginInstalled','getPluginDependencyStatus','dependencyTasks'])(async () => facts, { dataRoot: 'owned-data' }, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\owned' } }, create, win32.join, () => 'C:\\owned-home', resolve, () => true, getPluginDependencyStatus, { get: () => ({ taskId: 'owned-task', dependencyId: 'cua-computer-use:cua-driver', state: 'cancelling' }) });
    const entry = { pluginName: 'cua-computer-use', dependency };
    const read = actualMethod('listPluginDependencyStatuses', ['pluginDependencies', 'getDependencyStatusView'], [[entry], getView]);
    expect(await read()).toEqual([{ pluginName: entry.pluginName, pluginInstalled: true, dependencyId: dependency.id, displayName: dependency.displayName, canInstall: false, canUpdate: false, canDiagnose: false, state: 'ready', code: 'ready', resolvedBinary: 'C:\\owned\\driver.exe', version: '1.2.3', task: { taskId: 'owned-task', dependencyId: 'cua-computer-use:cua-driver', state: 'cancelling' } }]);
    expect(create).toHaveBeenCalledExactlyOnceWith('C:\\owned', 'owned-release'); expect(resolve).toHaveBeenCalledExactlyOnceWith('owned-data');
    expect(facts.runCommand).toHaveBeenCalledExactlyOnceWith('C:\\owned\\driver.exe', ['--version']);
    expect(await getPluginDependencyStatus({ ...dependency, supportedPlatforms: ['darwin'] } as never, facts)).toMatchObject({ state: 'unsupported', code: 'unsupported_platform', canInstall: false });
    expect(await getPluginDependencyStatus(dependency as never, { ...facts, exists: () => false, isFile: () => false })).toMatchObject({ state: 'missing', code: 'binary_missing' });
  });
});
