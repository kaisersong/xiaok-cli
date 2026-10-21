// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const methods = ['listPluginMcpServers', 'listAvailablePlugins', 'listPluginDependencyStatuses'] as const;
async function fixture() {
  resetIpcSchemaRegistryForTests();
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const servers = [{ name: 'owned', pluginName: 'owned-plugin', connected: true, enabled: true, toolCount: 2, lastErrorDetail: { category: null, message: 'retained', future: ['kept'] }, future: { flag: true } }];
  const available = [{ name: 'owned-plugin', display_name: 'Owned', description: 'Read only', version: '1', installed: false, category: 'owned', keywords: ['owned'], repo: 'owner/repo', path: 'plugins/owned', dependencies: { runtime: 'node', install: 'unused', test: 'unused' }, future: [null, true, { key: 'value' }] }];
  const statuses = [{ pluginName: 'owned-plugin', pluginInstalled: true, dependencyId: 'owned', displayName: 'Owned dependency', state: 'degraded', code: 'future_business_code', canInstall: false, canUpdate: false, canDiagnose: false, resolvedBinary: 'C:\\owned\\driver.exe', version: '1.2.3', detail: 'actual retained', task: { taskId: 'owned-task', dependencyId: 'owned', state: 'cancelling', future: true }, future: ['kept'] }];
  const services = { listPluginMcpServers: vi.fn(() => servers), listAvailablePlugins: vi.fn(async () => available), listPluginDependencyStatuses: vi.fn(async () => statuses) };
  const source = readFileSync(new URL('../../electron/ipc.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(ast) === 'registerPluginCatalogIpc') selected.push(node.getText(ast));
      else if (call.expression.getText(ast) === 'ipcMain.handle' && ts.isStringLiteral(call.arguments[0]!) && methods.some(method => call.arguments[0]!.getText(ast).includes('desktop:' + method))) selected.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }; visit(ast); expect(selected.length).toBeGreaterThan(0);
  let register: unknown;
  if (source.includes('registerPluginCatalogIpc')) register = (await import('../../electron/plugin-catalog-typed-ipc.js')).registerPluginCatalogIpc;
  const js = ts.transpileModule(selected.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  compileFunction(js, ['ipcMain', 'services', 'registerPluginCatalogIpc'])({ handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => listeners.set(channel, listener) }, services, register);
  expect([...listeners.keys()].sort()).toEqual(methods.map(method => 'desktop:' + method).sort());
  return { services, servers, available, statuses, invoke: (method: string, ...args: unknown[]) => listeners.get('desktop:' + method)!({ sender: {} }, ...args) };
}
describe('actual plugin catalog IPC3 registration', () => {
  it('registers exactly the original three in the existing typed runtime round26', async () => {
    await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()].sort()).toEqual(methods.map(method => 'desktop:' + method).sort());
    for (const entry of IPC_SCHEMA_REGISTRY.values()) { expect(entry.rolloutRound).toBe(26); expect(entry.payloadMode).toBe('tuple'); }
  });
  it.each(methods)('rejects extra args for %s before reading any producer', async method => {
    const f = await fixture(); await expect(async () => f.invoke(method, {})).rejects.toThrow('plugin_catalog_input_invalid');
    for (const read of Object.values(f.services)) expect(read).not.toHaveBeenCalled();
  });
  it('preserves every field and unknown extras as a detached complete snapshot', async () => {
    const f = await fixture();
    for (const [method, owner] of [[methods[0], f.servers], [methods[1], f.available], [methods[2], f.statuses]] as const) {
      const result = await f.invoke(method); expect(result).toEqual(owner); expect(result).not.toBe(owner); expect((result as unknown[])[0]).not.toBe(owner[0]);
    }
    const view = await f.invoke(methods[0]) as typeof f.servers;
    view[0]!.future.flag = false; expect(f.servers[0]!.future.flag).toBe(true);
  });
  it('rejects malformed data without modifying owner facts', async () => {
    const f = await fixture(); f.servers[0]!.toolCount = Number.NaN;
    await expect(async () => f.invoke(methods[0])).rejects.toThrow('plugin_catalog_projection_unavailable'); expect(Number.isNaN(f.servers[0]!.toolCount)).toBe(true);
  });
  it('preserves original sync and async business failures with no retry or empty fallback', async () => {
    const f = await fixture(), failure = Error('owned_dependency_io_failure');
    f.services.listPluginMcpServers.mockImplementation(() => { throw failure; });
    f.services.listPluginDependencyStatuses.mockRejectedValue(failure);
    await expect(async () => f.invoke(methods[0])).rejects.toBe(failure); await expect(async () => f.invoke(methods[2])).rejects.toBe(failure);
    expect(f.services.listPluginMcpServers).toHaveBeenCalledTimes(1); expect(f.services.listPluginDependencyStatuses).toHaveBeenCalledTimes(1);
  });
});
