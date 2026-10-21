// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../../electron/kswarm-service.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('kswarm-service.ts', source, ts.ScriptTarget.Latest, true);
function actual(name: string) {
  let text = ''; const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
  expect(text).not.toBe(''); return ts.transpileModule(text + '\nreturn ' + name + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
it('preserves the complete actual SDK health projection from its real function body', async () => {
  const health = vi.fn(async (urls: string[]) => urls[0] === 'kswarm' ? { ok: true, body: { brokerConnected: false } } : { ok: false, error: 'owned-health-error' });
  const fn = compileFunction(actual('getServiceStatus'), ['fetchHealthJsonFromUrls', 'KSWARM_HEALTH_URLS', 'BROKER_HEALTH_URLS', 'running', 'child', 'restartCount', 'lastError', 'brokerChild', 'KSWARM_PORT', 'BROKER_PORT'])(health, ['kswarm'], ['broker'], false, { pid: 1234 }, 2, null, null, 4400, 4318);
  const result = await fn();
  expect(result.checkedAt).toEqual(expect.any(Number)); expect(result.services).toEqual([
    { id: 'kswarm', label: 'KSwarm', running: true, reachable: true, port: 4400, pid: 1234, restartCount: 2, lastError: null, detail: 'broker disconnected' },
    { id: 'intent-broker', label: 'Intent Broker', running: false, reachable: false, port: 4318, pid: null, restartCount: 0, lastError: 'owned-health-error', detail: 'health check failed' },
  ]); expect(health).toHaveBeenCalledTimes(2);
});
it('records the real SDK otherwise-Broker branch without pretending to restart a real process', async () => {
  const restart = vi.fn(async () => undefined), stopBroker = vi.fn(async () => undefined), ensureBroker = vi.fn(async () => true), notify = vi.fn();
  const fn = compileFunction(actual('restartRelatedService'), ['restart', 'stopOwnedBroker', 'ensureBroker', 'notifyListeners'])(restart, stopBroker, ensureBroker, notify);
  await fn('kswarm'); expect(restart).toHaveBeenCalledTimes(1); expect(stopBroker).not.toHaveBeenCalled();
  for (const target of ['intent-broker', 'unknown-id', 'runtime-bridge']) await fn(target);
  expect(stopBroker).toHaveBeenCalledTimes(3); expect(ensureBroker).toHaveBeenCalledTimes(3); expect(notify).toHaveBeenCalledTimes(3);
});
