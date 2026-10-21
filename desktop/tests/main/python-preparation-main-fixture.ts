import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { DesktopShutdownCoordinator, type ShutdownReport } from '../../electron/desktop-shutdown-coordinator.js';
import { disposeDesktopLifetimeSteps } from '../../electron/desktop-before-quit.js';
import type { DeployResult, BundledPluginFileDeployment } from '../../electron/deploy-bundled-plugins.js';

type Step = { name: string; run: () => Promise<void> };
type Slice = { run(): Promise<unknown>; disposeLifetime(): Promise<void>; managed(): unknown };
function isSlice(value: unknown): value is Slice {
  return typeof value === 'object' && value !== null && 'run' in value && typeof value.run === 'function'
    && 'disposeLifetime' in value && typeof value.disposeLifetime === 'function'
    && 'managed' in value && typeof value.managed === 'function';
}
const SOURCE_SHA = Object.freeze({
  before: 'e8e4319e6ef72aa5ffb3323df969ea61ea97e375b4c08fe1993e939d5ee79bdc',
  post: '9c874df44ea458ed7f780355081e5b2b0fa788970393c8d19b20f03895df377f',
});
function frozenSource(stage: 'before' | 'candidate'): Buffer {
  const bytes = readFileSync(new URL(`../fixtures/r299-main-${stage}.txt`, import.meta.url));
  const expected = stage === 'before' ? SOURCE_SHA.before : SOURCE_SHA.post;
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('office_python_frozen_Main_snapshot_drift');
  return bytes;
}
function currentBinding(phase: 'before' | 'post') {
  const actual = readFileSync(new URL('../../electron/main.ts', import.meta.url));
  const snapshot = frozenSource(phase === 'before' ? 'before' : 'candidate');
  // Compare full bytes as well as the pinned hash; do not normalize, strip
  // comments, select an AST subset or fall back to a candidate snapshot.
  if (!actual.equals(snapshot)) throw Error(`office_python_Main_source_binding_NOT_READY:${phase}`);
  return { actual, snapshot, sha256: createHash('sha256').update(actual).digest('hex') };
}
/** A byte-binding observation, not an execution/native/root-retirement grant. */
export function assertMainSourceBinding(phase: 'before' | 'post') {
  const binding = currentBinding(phase);
  return Object.freeze({ phase, currentSHA256: binding.sha256, snapshotSHA256: binding.sha256, bytes: binding.actual.length, byteEqual: true });
}
export function mainSource(stage: 'before' | 'candidate'): string {
  // Historical BEFORE2 uses the pinned original snapshot only. Owner-before
  // current==before is a separate receipt, never a per-call POST requirement.
  if (stage === 'before') return frozenSource('before').toString('utf8');
  // Candidate11 extracts this same read of actual applied Main only after full
  // byte equality with the pinned corrected candidate; no snapshot fallback.
  return currentBinding('post').actual.toString('utf8');
}
function extractMain(source: string) {
  const ast = ts.createSourceFile('actual-main.ts', source, ts.ScriptTarget.ES2022, true);
  const initial = ast.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'createInitialWindowResources');
  const register = ast.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'registerLifetimeDisposerStep');
  if (initial.length !== 1 || !initial[0].body || register.length !== 1) throw Error('actual_Main_function_identity_changed');
  const body = initial[0].body, marker = '// Python discovery, venv creation and dependency checks are intentionally';
  const start = source.indexOf(marker, body.getStart(ast));
  if (start < body.getStart(ast) || start >= body.end || source.indexOf(marker, start + 1) !== -1) throw Error('actual_Python_segment_not_unique');
  const statements = body.statements.filter(n => n.getStart(ast) > start);
  const last = statements[statements.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression || last.expression.getText(ast) !== 'window') throw Error('actual_segment_end_changed');
  let prepareCalls = 0;
  const count = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(ast) === 'prepareBundledPluginPythonRuntime') prepareCalls++; ts.forEachChild(n, count); };
  for (const n of statements) count(n);
  if (prepareCalls !== 1) throw Error('actual_prepare_call_population_changed');
  let lifetime: ts.Expression | undefined;
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(ast) !== 'desktopShutdownCoordinator' || !declaration.initializer || !ts.isNewExpression(declaration.initializer)) continue;
      const argument = declaration.initializer.arguments?.[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) throw Error('actual_shutdown_configuration_changed');
      const property = argument.properties.find((n): n is ts.PropertyAssignment => ts.isPropertyAssignment(n) && n.name.getText(ast) === 'disposeLifetimeResources');
      if (property) lifetime = property.initializer;
    }
  }
  if (!lifetime) throw Error('actual_Main_lifetime_callback_missing');
  // Actual source, unchanged statements. This evaluates neither the Main module,
  // its imports, full createWindow, Electron, deploy helper nor any real SDK.
  const code = `let managedPythonCommand;\n${register[0].getText(ast)}\nreturn {run:async()=>{\n${statements.map(n => n.getText(ast)).join('\n')}\n},disposeLifetime:${lifetime.getText(ast)},managed:()=>managedPythonCommand};`;
  const emitted = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (emitted.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error('Main_slice_transpile_failed');
  return emitted.outputText;
}
export const turn = () => new Promise<void>(resolve => setImmediate(resolve));
export function observed(promise: Promise<unknown>) { return Promise.allSettled([promise]).then(([value]) => value); }
export function readyResult(): DeployResult { return { deployed: [], pythonAvailable: true, venvReady: true, pythonCommand: 'own-logical-python-data' }; }

export function pythonFixture(stage: 'before' | 'candidate', count = 1, holdRegistration = false) {
  const gate = new DesktopShutdownGate(), steps: Step[] = [], finalSteps: Step[] = [], knownSteps: Step[] = [];
  const pending: Promise<unknown>[] = [], releaseInputs: Array<() => void> = [], expected = new Set<unknown>();
  function hold<T>(fallback: T) {
    let complete!: (value: T) => void, fail!: (error: unknown) => void, settled = false;
    const promise = new Promise<T>((resolve, reject) => { complete = resolve; fail = reject; });
    pending.push(promise); void Promise.allSettled([promise]);
    const value = { promise, resolve(result: T) { if (!settled) { settled = true; complete(result); } }, reject(error: unknown) { if (!settled) { settled = true; fail(error); } } };
    releaseInputs.push(() => value.resolve(fallback)); return value;
  }
  const preparations = Array.from({ length: count }, () => hold(readyResult())), registration = hold(true);
  if (!holdRegistration) registration.resolve(true);
  const hooks: { prepare?: () => void; register?: () => Promise<void>; provider?: () => Promise<{ started: boolean }> } = {};
  const calls = { prepare: 0, register: 0, provider: 0, unavailable: 0, storeClose: 0, pinRelease: 0, continuation: 0 };
  const logs: Array<{ event: string; detail: unknown }> = [], inputs: BundledPluginFileDeployment[] = [], receivers: unknown[] = [];
  const deployment: BundledPluginFileDeployment = { deployed: [], pythonState: 'not_started', bundledDir: null, slideWheelhouseCompatTargets: [] };
  // Plain public callback inputs only. These are deliberate own surrogates for
  // expensive OS/SDK dependencies; they make NO Python/native retirement claim.
  function prepare(input: BundledPluginFileDeployment): Promise<DeployResult> {
    inputs.push(input); const next = preparations[calls.prepare++];
    if (!next) throw Error('unexpected_extra_prepare'); hooks.prepare?.(); return next.promise;
  }
  const services = {
    async registerDeferredPythonMcpTools() { calls.register++; receivers.push(this); await hooks.register?.(); },
    async startPluginProviderRuntime() { calls.provider++; receivers.push(this); return hooks.provider ? await hooks.provider() : { started: true }; },
    markDeferredPythonMcpToolsUnavailable() { calls.unavailable++; receivers.push(this); },
  };
  const windowData = Object.freeze({ own: 'window-data-only-no-BrowserWindow' });
  const js = extractMain(mainSource(stage));
  const produced: unknown = compileFunction(js, ['desktopShutdownGate', 'desktopLifetimeSteps', 'desktopFinalLifetimeSteps', 'prepareBundledPluginPythonRuntime', 'pluginDeployment', 'mcpRegistrationPromise', 'services', 'debugMain', 'window', 'disposeDesktopLifetimeSteps'])(
    gate, steps, finalSteps, prepare, deployment, registration.promise, services, (event: string, detail?: unknown) => { logs.push({ event, detail }); }, windowData, disposeDesktopLifetimeSteps,
  );
  if (!isSlice(produced)) throw Error('actual_Main_slice_shape_missing'); const slice = produced;
  const closings: Promise<ShutdownReport>[] = [];
  // The coordinator/gate and Main lifetime callback are production. The facade
  // represents this fixture's known empty provider set, never a fake SDK grant.
  const coordinator = new DesktopShutdownCoordinator({ gate,
    providerRuntime: { beginShutdown() { return { leases: [], async waitForSettled() { return true; } }; }, hideAndAbortNonProtected() {}, async closeOrdinaryProviders() { return { cleanupFailed: [] }; } },
    ingressOwners: [], durableStores: [{ name: 'own-counter-no-database', async close() { calls.storeClose++; } }],
    destroyWindows() {}, disposeLifetimeResources: slice.disposeLifetime,
    async releaseMainSourcePin() { calls.pinRelease++; }, continuation() { calls.continuation++; },
    log(event, detail) { logs.push({ event, detail }); },
    // Intentionally omit ordinaryCleanupDeadlineMs: use actual default5000ms.
  });
  function remember() { for (const step of steps) if (!knownSteps.includes(step)) knownSteps.push(step); }
  function close() { remember(); const value = coordinator.onBeforeQuit().shutdown; if (!closings.includes(value)) { closings.push(value); void Promise.allSettled([value]); } return value; }
  function retirement() { remember(); return knownSteps.map(step => step.run()); }
  function expectedError(error: unknown): boolean {
    if (expected.has(error)) return true;
    if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(expectedError);
    return error instanceof Error && error.cause !== undefined && expectedError(error.cause);
  }
  async function cleanup() {
    for (const release of releaseInputs) release();
    await Promise.allSettled(pending); await turn(); await turn(); remember();
    const actual = closings.length ? closings : [slice.disposeLifetime()];
    const outcomes = await Promise.allSettled([...actual, ...retirement()]);
    const failures = outcomes.flatMap(value => value.status === 'rejected' && !expectedError(value.reason) ? [value.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'actual_Main_fixture_retirement_unconfirmed');
  }
  return { gate, steps, coordinator, preparations, registration, hooks, calls, logs, inputs, receivers, services, deployment, windowData,
    run() { const raw = slice.run(); pending.push(raw); void Promise.allSettled([raw]); remember(); return raw; },
    close, retirement, managed: slice.managed, allowRetirementError(error: unknown) { expected.add(error); }, cleanup };
}
export async function withPythonFixture(stage: 'before' | 'candidate', body: (fixture: ReturnType<typeof pythonFixture>) => Promise<void>, count = 1, holdRegistration = false) {
  const f = pythonFixture(stage, count, holdRegistration); let failed = false, primary: unknown;
  try { await body(f); } catch (error) { failed = true; primary = error; throw error; }
  finally { try { await f.cleanup(); } catch (error) { throw new AggregateError([...(failed ? [primary] : []), error], 'actual_Main_control_and_cleanup'); } }
}
