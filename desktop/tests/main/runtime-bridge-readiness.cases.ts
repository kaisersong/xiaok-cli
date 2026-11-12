import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {reportRuntimeBridgeStartupFailure} from '../../electron/kswarm-service-lifetime.js';

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
  const warning = vi.fn(),debug=vi.fn(),degraded=vi.fn();
  const actual = new Function('brokerReady', 'console', 'desktopShutdownGate', 'dshSources', 'debugMain', 'reportRuntimeBridgeStartupFailure', 'desktopServicesDegradedNoticeOnce', `
    let runtimeBridgeStopping, runtimeBridgeStarted = false, runtimeBridgeStartEpoch = 0, runtimeBridgeFallbackTimer = null;
    ${compiled}
    return { start: startRuntimeBridge, started: () => runtimeBridgeStarted };
  `)(ready, { warn: warning }, { isOpen: true }, qualified?{}:undefined, debug, (error:unknown,onDegraded:(code:string)=>void)=>{const original=console.warn;console.warn=warning;try{reportRuntimeBridgeStartupFailure(error,onDegraded);}finally{console.warn=original;}}, degraded);
  return {...actual,ready,warning,debug,degraded};
}
it('clears the actual Main runtime bridge startup flag after readiness rejection so recovery retries', async () => {
  const {start,started,ready,warning,degraded}=runtimeBridgeHarness(false);
  start();
  await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
  expect(degraded).toHaveBeenCalledWith('fixture startup failure');
  expect(started()).toBe(false);
  start();
  expect(ready).toHaveBeenCalledTimes(2);
  expect(started()).toBe(true);
});
it('retains the qualified Main startup flag after unconfirmed readiness and refuses an implicit retry',async()=>{
  const {start,started,ready,warning,debug,degraded}=runtimeBridgeHarness(true);
  start();
  await vi.waitFor(()=>expect(debug).toHaveBeenCalledWith('runtime-bridge:startup-unconfirmed'));
  expect(started()).toBe(true);
  start();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
  expect(degraded).not.toHaveBeenCalled();
});
