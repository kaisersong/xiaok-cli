import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { DesktopShutdownCoordinator, type ShutdownReport } from '../../electron/desktop-shutdown-coordinator.js';
import { disposeDesktopLifetimeSteps } from '../../electron/desktop-before-quit.js';
import { assertStandardIpcPromise } from '../../electron/ipc-native-promise.js';

type Step = { name: string; run(): Promise<void> };
type RegistrationOptions = {
  isOpen(): boolean; acquireWriter(): { release(): void };
  registerFinalLifetime(dispose: () => Promise<void>): void;
  register(): Promise<{ dispose: () => Promise<void> }>; startBridge(): void;
  reportRegistrationFailure(error: unknown): void; reportOwnershipFailure(error: unknown): void;
};
type RegistrationStart = (options: RegistrationOptions) => { registered: Promise<boolean>; dispose(): Promise<void> };
function isRegistrationStart(value: unknown): value is RegistrationStart { return typeof value === 'function'; }
type Owner = { registered: Promise<boolean>; dispose(): Promise<void>; installNormalCleanup(): void };
type Slice = { start(): Owner; appendOrdinary(name: string, run: () => Promise<void>): void; disposeLifetimeResources(): Promise<void> };
function isSlice(value: unknown): value is Slice {
  return typeof value === 'object' && value !== null && 'start' in value && typeof value.start === 'function'
    && 'appendOrdinary' in value && typeof value.appendOrdinary === 'function'
    && 'disposeLifetimeResources' in value && typeof value.disposeLifetimeResources === 'function';
}
const FINAL_MAIN_SHA = 'f25ac6d5034918fef0d3207780429bd7773adc1b7e932b0dc3707e4d8c1d5d40';
function boundActualMain(): string {
  const actual = readFileSync(new URL('../../electron/main.ts', import.meta.url));
  const snapshot = readFileSync(new URL('../fixtures/remediation-20261022-main-reviewed.txt', import.meta.url));
  if (!actual.equals(snapshot) || createHash('sha256').update(actual).digest('hex') !== FINAL_MAIN_SHA)
    throw Error('r324_actual_Main_source_binding_NOT_READY');
  // The following AST is built from this same actual applied read, never a fallback golden.
  return actual.toString('utf8');
}
function one<T>(values: readonly T[], label: string): T {
  if (values.length !== 1) throw Error(`actual_Main_selection:${label}`);
  return values[0]!;
}
function actualPromiseDependencies(tree: ts.SourceFile): string {
  const imports = tree.statements.filter((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './ipc-native-promise.js');
  const binding = one(imports, 'actual_ipc_native_promise_import').importClause?.namedBindings;
  if (!binding || !ts.isNamedImports(binding) || binding.elements.length !== 1)
    throw Error('actual_Main_promise_dependency_changed');
  const imported = binding.elements[0];
  if (!imported || imported.name.text !== 'assertStandardIpcPromise' || imported.propertyName)
    throw Error('actual_Main_promise_dependency_changed');
  const names = new Set(['McpNativePromise', 'mcpPromiseGlobal', 'mcpPromiseOwnDescriptor', 'mcpPromisePrototype', 'mcpPromiseInitialThen', 'mcpPreProducerWitness']);
  const constants = tree.statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(tree))));
  if (constants.length !== names.size) throw Error('actual_Main_promise_constants_population_changed');
  for (const name of names) one(constants.filter(node => node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === name)), name);
  const ambient = one(tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && node.name?.text === 'assertMcpRegistrationPromiseAmbient'), 'actual_ambient_function');
  // No reproduced witness logic: all constants and checks are actual Main text.
  return `${constants.map(node => node.getText(tree)).join('\n')}\n${ambient.getText(tree)}`;
}
export function actualMcpRegistrationFunction(): RegistrationStart {
  const tree = ts.createSourceFile('actual-main.ts', boundActualMain(), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const helper = one(tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && node.name?.text === 'startOwnedMcpRegistration'), 'actual_registration_function');
  const code = `${actualPromiseDependencies(tree)}\n${helper.getText(tree)}\nreturn startOwnedMcpRegistration;`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw Error('actual_Main_promise_function_transpile_failed');
  const value: unknown = compileFunction(output.outputText, ['assertStandardIpcPromise'])(assertStandardIpcPromise);
  if (!isRegistrationStart(value)) throw Error('actual_Main_registration_function_missing');
  return value;
}
function selectedMainCode(source: string): string {
  const tree = ts.createSourceFile('actual-main.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const moduleFunction = (name: string) => one(tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name), name);
  const initial = moduleFunction('createInitialWindowResources');
  if (!initial.body) throw Error('actual_Main_initial_body_missing');
  const statements = initial.body.statements;
  const variable = (name: string) => one(statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === name)), name);
  const helper = moduleFunction('startOwnedMcpRegistration'), register = moduleFunction('registerLifetimeDisposerStep');
  const owner = variable('mcpRegistrationOwner'), status = variable('mcpRegistrationPromise');
  const entry = one(statements.filter((node): node is ts.ExpressionStatement => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'assertMcpRegistrationPromiseAmbient'), 'actual_registration_entry_check');
  const registrationNodes = new Set<ts.Statement>([entry, owner, status]);
  const stateNames = new Set(['runtimeBridgeStarted', 'runtimeBridgeStartEpoch', 'runtimeBridgeFallbackTimer']);
  const states = statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => stateNames.has(declaration.name.getText(tree))));
  if (states.length !== 3) throw Error('actual_Main_bridge_state_population_changed');
  const normalNames = new Set(['provider-runtime', 'kswarm-and-bridges']);
  // Filter preserves actual source registration order. No provider/bridge order is rebuilt here.
  const normal = statements.filter((node): node is ts.ExpressionStatement => {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression) || node.expression.expression.getText(tree) !== 'registerLifetimeDisposerStep') return false;
    const first = node.expression.arguments[0]; return first !== undefined && ts.isStringLiteral(first) && normalNames.has(first.text);
  });
  if (normal.length !== 2) throw Error('actual_Main_normal_lifetime_population_changed');
  for (const name of normalNames) {
    const matches = normal.filter(node => ts.isCallExpression(node.expression) && node.expression.arguments[0]?.getText(tree) === `'${name}'`);
    if (matches.length !== 1) throw Error(`actual_Main_normal_lifetime_missing:${name}`);
  }
  const gatewayState = variable('mobileGatewayStopRetirement');
  const gatewaySuffix = variable('mobileGatewaySuffixFailure');
  const gatewayFinal = one(statements.filter((node): node is ts.ExpressionStatement => {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression) || node.expression.expression.getText(tree) !== 'desktopFinalLifetimeSteps.unshift') return false;
    const argument = node.expression.arguments[0];
    return argument !== undefined && ts.isObjectLiteralExpression(argument) && argument.properties.some(property => ts.isPropertyAssignment(property)
      && property.name.getText(tree) === 'name' && ts.isStringLiteral(property.initializer) && property.initializer.text === 'mobile-gateway-stop');
  }), 'actual_gateway_final_registration');
  registrationNodes.add(gatewayState); registrationNodes.add(gatewaySuffix); registrationNodes.add(gatewayFinal);
  const registrationStatements = statements.filter(node => registrationNodes.has(node));
  const normalSetup = normal;
  const coordinator = one(tree.statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'desktopShutdownCoordinator')), 'desktopShutdownCoordinator');
  const declaration = one(coordinator.declarationList.declarations.filter(node => node.name.getText(tree) === 'desktopShutdownCoordinator'), 'coordinator_declaration');
  if (!declaration.initializer || !ts.isNewExpression(declaration.initializer)) throw Error('actual_Main_coordinator_constructor_changed');
  const config = declaration.initializer.arguments?.[0];
  if (!config || !ts.isObjectLiteralExpression(config)) throw Error('actual_Main_coordinator_config_changed');
  const lifetime = one(config.properties.filter((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && node.name.getText(tree) === 'disposeLifetimeResources'), 'disposeLifetimeResources');
  if (!ts.isArrowFunction(lifetime.initializer)) throw Error('actual_Main_lifetime_callback_changed');
  // All orchestration below is verbatim selected Main AST source. Wrappers expose
  // handles and one explicit own ordinary sentinel, not a replacement pipeline.
  const code = `${actualPromiseDependencies(tree)}\n${helper.getText(tree)}\n${register.getText(tree)}\n${states.map(node => node.getText(tree)).join('\n')}\nreturn {
    start:()=>{${registrationStatements.map(node => node.getText(tree)).join('\n')}\nreturn {
      registered:mcpRegistrationPromise,dispose:mcpRegistrationOwner.dispose,
      installNormalCleanup:()=>{${normalSetup.map(node => node.getText(tree)).join('\n')}}
    };},
    appendOrdinary:(name,run)=>registerLifetimeDisposerStep(name,run),
    disposeLifetimeResources:${lifetime.initializer.getText(tree)}
  };`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw Error('actual_Main_selected_callbacks_transpile_failed');
  return output.outputText;
}
function deferred<T>() {
  let complete!: (value: T) => void, fail!: (error: unknown) => void, settled = false;
  const promise = new Promise<T>((resolve, reject) => { complete = resolve; fail = reject; });
  void promise.catch(() => undefined);
  return { promise, resolve(value: T) { if (!settled) { settled = true; complete(value); } }, reject(error: unknown) { if (!settled) { settled = true; fail(error); } } };
}
export const turn = () => new Promise<void>(resolve => setImmediate(resolve));

type FixtureOptions = { holdStop?: boolean; holdDispose?: boolean; holdGateway?: boolean; bridgeStop?: () => Promise<void> };
export function actualMainRegistrationFixture(options: FixtureOptions = {}) {
  const gate = new DesktopShutdownGate(), steps: Step[] = [], finalSteps: Step[] = [];
  const events: string[] = [], logs: Array<{ event: string; detail: unknown }> = [];
  const registration = deferred<{ dispose: () => Promise<void> }>(), stop = deferred<void>(), disposal = deferred<void>(), gateway = deferred<void>();
  if (!options.holdStop) stop.resolve(); if (!options.holdDispose) disposal.resolve();
  if (!options.holdGateway) gateway.resolve();
  const hooks: { register?: () => void; dispose?: () => void; gateway?: () => void; relay?: () => void; log?: (event: string) => void } = {};
  const registrationReceivers: unknown[] = [], disposeReceivers: unknown[] = [];
  const gatewayReceivers: unknown[] = [], gatewayArguments: unknown[][] = [], groupRaws: Promise<void>[] = [], gatewayFinalRaws: Promise<void>[] = [];
  const observedSteps: Array<{ name: string; raw: Promise<void> }> = [];
  const expectedErrors = new Set<unknown>(), allowedCleanup = new Set<string>();
  let owner: Owner | undefined;
  const record = (event: string) => { events.push(event); };
  // These own property holders resolve only the selected source's callback names.
  // They are NOT DesktopServices, SDK, provider-facade or bridge instances, and
  // carry no brand/authority. No vendor class/type is imported or reconstructed.
  const registrationCarrier = {
    registerMcpTools() { registrationReceivers.push(this); record('callback:mcp.register'); hooks.register?.(); return registration.promise; },
  };
  async function exactOwnReturnedDispose(this: unknown): Promise<void> {
    disposeReceivers.push(this); record('callback:mcp.dispose'); hooks.dispose?.(); await disposal.promise;
  }
  const returned = { dispose: exactOwnReturnedDispose };
  const pluginProviderCallback = { async dispose() { record('callback:provider.dispose'); } };
  const streamCallback = { dispose() { record('callback:stream.dispose'); } };
  const schedulerCallback = { stop() { record('callback:timed.stop'); } };
  const bonjourCallback = { stop() { record('callback:bonjour.stop'); } };
  const mobileCallback = { async stop(...args: unknown[]) { gatewayReceivers.push(this); gatewayArguments.push(args); record('callback:mobile.stop'); hooks.gateway?.(); await gateway.promise; } };
  const relayCallback = { stop() { record('callback:relay.stop'); hooks.relay?.(); } };
  finalSteps.push({ name: 'own-final-sentinel', async run() { record('own:final'); } });
  const produced: unknown = compileFunction(selectedMainCode(boundActualMain()), [
    'desktopShutdownGate', 'desktopLifetimeSteps', 'desktopFinalLifetimeSteps', 'services', 'startRuntimeBridge', 'debugMain',
    'pluginProviderRuntime', 'kswarmStreamBridge', 'stopRuntimeBridge', 'timedActionScheduler', 'mobileBonjourAdvertiser', 'mobileGateway', 'mobileRelayBridge', 'disposeDesktopLifetimeSteps', 'assertStandardIpcPromise',
  ])(gate, steps, finalSteps, registrationCarrier, () => record('callback:bridge.start'),
    (event: string, detail?: unknown) => { logs.push({ event, detail }); hooks.log?.(event); },
    pluginProviderCallback, streamCallback, () => { record('callback:bridge.stop'); return options.bridgeStop ? options.bridgeStop() : stop.promise; },
    schedulerCallback, bonjourCallback, mobileCallback, relayCallback, disposeDesktopLifetimeSteps, assertStandardIpcPromise);
  if (!isSlice(produced)) throw Error('actual_Main_selected_slice_shape_changed');
  const slice = produced;
  // Real gate/coordinator/step traversal. These phase callbacks describe a known
  // empty own protected set and plain counters, never a fabricated SDK/DB ACK.
  const coordinator = new DesktopShutdownCoordinator({ gate,
    providerRuntime: {
      beginShutdown() { record('phase:beginShutdown'); return { leases: [], async waitForSettled() { return true; } }; },
      hideAndAbortNonProtected() { record('phase:hide'); },
      async closeOrdinaryProviders() { record('phase:ordinaryProviders'); return { cleanupFailed: [] }; },
    },
    ingressOwners: [],
    durableStores: [{ name: 'own-counter-no-database', async close() { record('own:store.close'); } }],
    destroyWindows() { record('own:destroyWindows'); },
    disposeLifetimeResources: slice.disposeLifetimeResources,
    async releaseMainSourcePin() { record('own:pin.release'); }, continuation() { record('own:continuation'); },
    log(event, detail) { logs.push({ event, detail }); },
    // Original production defaults: no deadline replacement and no fake timer.
  });
  let closing: Promise<ShutdownReport> | undefined;
  function close(): Promise<ShutdownReport> {
    const result = coordinator.onBeforeQuit().shutdown;
    if (!closing) { closing = result; void result.catch(() => undefined); }
    return result;
  }
  function finalRegistration(): Step {
    return one(finalSteps.filter(step => step.name === 'mcp-tools-registration'), 'actual_early_final_registration');
  }
  function knownError(error: unknown): boolean {
    if (expectedErrors.has(error)) return true;
    if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(knownError);
    return error instanceof Error && error.cause !== undefined && knownError(error.cause);
  }
  function allowError(error: Error) {
    expectedErrors.add(error); allowedCleanup.add('lifetime_resources');
    for (const name of ['kswarm-and-bridges', 'mcp-tools-registration', 'mobile-gateway-stop']) allowedCleanup.add(`lifetime_resources:${name}: ${error.message}`);
  }
  async function cleanup() {
    registration.resolve(returned); stop.resolve(); disposal.resolve(); gateway.resolve();
    const inputs = await Promise.allSettled([registration.promise, stop.promise, disposal.promise, gateway.promise]);
    const unexpected: unknown[] = inputs.flatMap(value => value.status === 'rejected' && !knownError(value.reason) ? [value.reason] : []);
    const report = await close();
    for (const observation of observedSteps) {
      const result = (await Promise.allSettled([observation.raw]))[0];
      if (result?.status === 'rejected') {
        if (!knownError(result.reason)) unexpected.push(result.reason);
        else {
          allowedCleanup.add('lifetime_resources');
          allowedCleanup.add(`lifetime_resources:${observation.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        }
      }
    }
    for (const failure of report.cleanupFailed) if (!allowedCleanup.has(failure)) unexpected.push(Error(failure));
    if (owner) {
      const outcomes = await Promise.allSettled([owner.registered, owner.dispose()]);
      for (const outcome of outcomes) if (outcome.status === 'rejected' && !knownError(outcome.reason)) unexpected.push(outcome.reason);
    }
    if (unexpected.length) throw new AggregateError(unexpected, 'actual_Main_callback_fixture_cleanup_failed');
  }
  return { gate, coordinator, steps, finalSteps, events, logs, registration, stop, disposal, gateway, hooks, returned, registrationCarrier, registrationReceivers, disposeReceivers, gatewayReceivers, gatewayArguments, gatewayCarrier: mobileCallback, groupRaws, gatewayFinalRaws,
    start(settings: { installNormal?: boolean } = {}) {
      if (owner) throw Error('actual_Main_fixture_start_once'); owner = slice.start();
      if (settings.installNormal !== false) owner.installNormalCleanup();
      // Observational forwarding only: exact original receiver/args and raw Promise.
      for (const step of [...steps, ...finalSteps]) {
        if (step.name !== 'kswarm-and-bridges' && step.name !== 'mobile-gateway-stop') continue;
        const actualRun = step.run;
        step.run = function (this: Step): Promise<void> {
          const raw: Promise<void> = Reflect.apply(actualRun, this, []);
          observedSteps.push({ name: step.name, raw }); if (step.name === 'kswarm-and-bridges') groupRaws.push(raw); else gatewayFinalRaws.push(raw);
          void (async () => { try { await raw; } catch {} })();
          return raw;
        };
      }
      slice.appendOrdinary('own-after-main-lifetime', async () => { record('own:ordinary.after-main'); });
      return owner;
    },
    close, finalRegistration, allowError, cleanup,
    count(event: string) { return events.filter(value => value === event).length; },
    index(event: string) { const value = events.indexOf(event); if (value < 0) throw Error(`actual_callback_event_missing:${event}`); return value; },
  };
}
export async function withActualMainRegistration(body: (fixture: ReturnType<typeof actualMainRegistrationFixture>) => Promise<void>, options: FixtureOptions = {}) {
  const fixture = actualMainRegistrationFixture(options); let failed = false, primary: unknown;
  try { await body(fixture); }
  catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { await fixture.cleanup(); }
    catch (error) { throw new AggregateError([...(failed ? [primary] : []), error], 'actual_Main_body_and_cleanup'); }
  }
}
