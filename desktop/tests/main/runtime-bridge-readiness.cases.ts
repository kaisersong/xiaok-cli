import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';

function runtimeBridgeHarness(qualified:boolean) {
  const repoRoot=join(__dirname,'..','..','..');
  const source = readFileSync(join(repoRoot, 'desktop/electron/main.ts'), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  let declaration: ts.VariableDeclaration | undefined;
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'startRuntimeBridge') declaration = node;
    ts.forEachChild(node, find);
  };
  find(ast);
  expect(declaration?.initializer).toBeDefined();
  const compiled = ts.transpileModule(`const startRuntimeBridge = ${declaration!.initializer!.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ready = vi.fn().mockRejectedValueOnce(new Error('fixture startup failure')).mockImplementation(() => new Promise(() => {}));
  const warning = vi.fn(),debug=vi.fn();
  const actual = new Function('brokerReady', 'console', 'desktopShutdownGate', 'dshSources', 'debugMain', `
    let runtimeBridgeStopping, runtimeBridgeStarted = false, runtimeBridgeStartEpoch = 0, runtimeBridgeFallbackTimer = null;
    ${compiled}
    return { start: startRuntimeBridge, started: () => runtimeBridgeStarted };
  `)(ready, { warn: warning }, { isOpen: true }, qualified?{}:undefined, debug);
  return {...actual,ready,warning,debug};
}
it('clears the actual Main runtime bridge startup flag after readiness rejection so recovery retries', async () => {
  const {start,started,ready,warning}=runtimeBridgeHarness(false);
  start();
  await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
  expect(started()).toBe(false);
  start();
  expect(ready).toHaveBeenCalledTimes(2);
  expect(started()).toBe(true);
});
it('retains the qualified Main startup flag after unconfirmed readiness and refuses an implicit retry',async()=>{
  const {start,started,ready,warning,debug}=runtimeBridgeHarness(true);
  start();
  await vi.waitFor(()=>expect(debug).toHaveBeenCalledWith('runtime-bridge:startup-unconfirmed'));
  expect(started()).toBe(true);
  start();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});
