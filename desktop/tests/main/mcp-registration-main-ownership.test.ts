// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { actualMcpRegistrationFunction } from './mcp-registration-actual-main-fixture.js';

type Result = { dispose: () => Promise<void> };
type Owner = { registered: Promise<boolean>; dispose(): Promise<void> };
type Callbacks = {
  isOpen(): boolean; acquireWriter(): { release(): void };
  registerFinalLifetime(dispose: () => Promise<void>): void;
  register(): Promise<Result>; startBridge(): void;
  reportRegistrationFailure(error: unknown): void; reportOwnershipFailure(error: unknown): void;
};
type Start = (callbacks: Callbacks) => Owner;
function frozen(stage: 'before' | 'candidate'): string {
  const bytes = readFileSync(new URL(stage === 'candidate' ? '../fixtures/remediation-20261022-main-reviewed.txt' : '../fixtures/r324-main-before.txt', import.meta.url));
  const expected = stage === 'before' ? '8a98dde3a2167d32e2044b591603e4ceb2a7cad659b21ffaa90c4d22a1d563d0' : 'f25ac6d5034918fef0d3207780429bd7773adc1b7e932b0dc3707e4d8c1d5d40';
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
  return bytes.toString('utf8');
}
function ast(source: string) { return ts.createSourceFile('r324-Main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
function compileOwnCallbacks(code: string, parameters: string[] = []) {
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  expect(output.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []).toEqual([]);
  return compileFunction(output.outputText, parameters);
}
function candidate(): Start {
  return actualMcpRegistrationFunction();
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function fixture() {
  let open = true, writers = 0, starts = 0, calls = 0;
  const raw = deferred<Result>(), final: Array<() => Promise<void>> = [], failures: unknown[] = [], ownership: unknown[] = [];
  const callbacks: Callbacks = {
    isOpen: () => open,
    acquireWriter() { writers++; let held = true; return { release() { if (held) { held = false; writers--; } } }; },
    registerFinalLifetime(dispose) { final.unshift(dispose); },
    register() { calls++; return raw.promise; }, startBridge() { starts++; },
    reportRegistrationFailure(error) { failures.push(error); }, reportOwnershipFailure(error) { ownership.push(error); },
  };
  return { callbacks, raw, final, failures, ownership, close() { open = false; }, facts: () => ({ writers, starts, calls }) };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

it('BIND actual Main equals frozen candidate; Python tail is byte-preserved and actual method/cleanup binding is present', () => {
  const current = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), before = frozen('before'), post = frozen('candidate');
  expect(current).toBe(post);
  const marker = '// Python discovery, venv creation and dependency checks are intentionally';
  expect(post.slice(post.indexOf(marker))).toBe(before.slice(before.indexOf(marker)));
  expect(post).toContain('register: () => services.registerMcpTools()');
  expect(post).toContain("desktopFinalLifetimeSteps.unshift({ name: 'mcp-tools-registration', run: dispose })");
  expect(post).toContain('await mcpRegistrationOwner.dispose();');
  expect(post).not.toContain('await mcpDispose?.();');
});
it('reviewed Main evolution preserves the original promise, registration, bridge and Python ownership source exactly', () => {
  const oldBytes = readFileSync(new URL('../fixtures/r299-main-candidate.txt', import.meta.url));
  expect(createHash('sha256').update(oldBytes).digest('hex')).toBe('9c874df44ea458ed7f780355081e5b2b0fa788970393c8d19b20f03895df377f');
  const previous = oldBytes.toString('utf8'), reviewed = frozen('candidate');
  const unique = <T>(values: readonly T[], name: string): T => {
    expect(values, name).toHaveLength(1);
    return values[0]!;
  };
  const ownership = (source: string): string[] => {
    const tree = ast(source);
    const topFunction = (name: string) => unique(tree.statements.filter((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name), name);
    const initial = topFunction('createInitialWindowResources');
    expect(initial.body).toBeDefined();
    const variable = (name: string, statements: readonly ts.Statement[]) => unique(statements.filter((node): node is ts.VariableStatement =>
      ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(tree) === name)), name).getText(tree);
    const tail = '// Python discovery, venv creation and dependency checks are intentionally';
    expect(source.indexOf(tail)).toBeGreaterThan(-1);
    return [
      ...['startOwnedMcpRegistration', 'assertMcpRegistrationPromiseAmbient', 'registerLifetimeDisposerStep']
        .map(name => topFunction(name).getText(tree)),
      ...['McpNativePromise', 'mcpPromiseGlobal', 'mcpPromiseOwnDescriptor', 'mcpPromisePrototype', 'mcpPromiseInitialThen', 'mcpPreProducerWitness', 'desktopShutdownCoordinator']
        .map(name => variable(name, tree.statements)),
      ...['runtimeBridgeClients', 'runtimeBridgeStarted', 'runtimeBridgeStartEpoch', 'runtimeBridgeFallbackTimer', 'runtimeBridgeStopping', 'stopRuntimeBridge', 'mcpRegistrationOwner', 'mcpRegistrationPromise']
        .map(name => variable(name, initial.body!.statements)),
      source.slice(source.indexOf(tail)),
    ];
  };
  // This supplements, never replaces, the full actual==reviewed bytes/hash gate.
  expect(ownership(reviewed)).toEqual(ownership(previous));
});

it('pending registration is owned before producer; late close awaits exact callback once and releases writer independently', async () => {
  const f = fixture(); let prefix: unknown;
  f.callbacks.register = () => { prefix = { ...f.facts(), final: f.final.length }; return f.raw.promise; };
  const owner = candidate()(f.callbacks); expect(prefix).toEqual({ writers: 1, starts: 0, calls: 0, final: 1 });
  f.close(); const closing = owner.dispose(); expect(owner.dispose()).toBe(closing); expect(f.final[0]!()).toBe(closing);
  let done = false; void closing.then(() => { done = true; }); await turn(); expect(done).toBe(false);
  const heldDispose = deferred<void>(); let disposed = 0, receiver: unknown = 'unset';
  async function exactReturnedDispose(this: unknown) { receiver = this; disposed++; await heldDispose.promise; }
  f.raw.resolve({ dispose: exactReturnedDispose }); expect(await owner.registered).toBe(true);
  expect(f.facts().writers).toBe(0); expect(f.facts().starts).toBe(0); expect(disposed).toBe(1); expect(receiver).toBeUndefined(); expect(done).toBe(false);
  heldDispose.resolve(); await closing; expect(done).toBe(true); expect(disposed).toBe(1);
});
it('producer-prefix closure sees reservation, prevents bridge activation, and still retires returned callback', async () => {
  const f = fixture(); let closing: Promise<void> | undefined; let disposed = 0;
  f.callbacks.register = () => { expect(f.facts().writers).toBe(1); expect(f.final).toHaveLength(1); f.close(); closing = f.final[0]!(); return f.raw.promise; };
  const owner = candidate()(f.callbacks); f.raw.resolve({ async dispose() { disposed++; } });
  await owner.registered; await closing; expect(disposed).toBe(1); expect(f.facts().starts).toBe(0); expect(f.facts().writers).toBe(0);
});
it('normal cleanup keeps bridge-stop before MCP dispose; final fallback reawaits the same close', async () => {
  const f = fixture(), order: string[] = [], owner = candidate()(f.callbacks);
  f.raw.resolve({ async dispose() { order.push('mcp-dispose'); } }); expect(await owner.registered).toBe(true);
  f.close(); order.push('provider-dispose', 'bridge-stop'); const normal = owner.dispose(); await normal;
  order.push('later-ordinary'); expect(f.final[0]!()).toBe(normal); await f.final[0]!(); order.push('kswarm-final');
  expect(order).toEqual(['provider-dispose', 'bridge-stop', 'mcp-dispose', 'later-ordinary', 'kswarm-final']);
});
it('historically handled open raw failure stays false with fallback and does not turn into a later close error', async () => {
  const f = fixture(), owner = candidate()(f.callbacks), error = Error('own open registration failure');
  f.raw.reject(error); expect(await owner.registered).toBe(false); expect(f.failures).toEqual([error]); expect(f.facts().starts).toBe(1);
  f.close(); await owner.dispose(); expect(f.facts().writers).toBe(0);
});
it('closing raw failure stays identical on retirement and never starts fallback', async () => {
  const f = fixture(), owner = candidate()(f.callbacks), error = Error('own closing raw failure');
  f.close(); const closing = owner.dispose(); const observed = Promise.allSettled([closing]); f.raw.reject(error);
  expect(await owner.registered).toBe(false); expect(await observed).toEqual([{ status: 'rejected', reason: error }]);
  expect(owner.dispose()).toBe(closing); expect(f.ownership).toEqual([error]); expect(f.facts().starts).toBe(0); expect(f.facts().writers).toBe(0);
});
it('returned dispose rejection is not rewritten as registration failure and is invoked once', async () => {
  const f = fixture(), owner = candidate()(f.callbacks), error = Error('own returned-dispose rejection'); let calls = 0;
  f.raw.resolve({ async dispose() { calls++; throw error; } }); expect(await owner.registered).toBe(true);
  f.close(); const close = owner.dispose(); expect(await Promise.allSettled([close, f.final[0]!()])).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
  expect(calls).toBe(1); expect(f.failures).toEqual([]);
});
it('failed lifetime registration invokes no producer and releases the already acquired writer', async () => {
  const f = fixture(), error = Error('own lifetime registration failure'); f.callbacks.registerFinalLifetime = () => { throw error; };
  expect(() => candidate()(f.callbacks)).toThrow(error); expect(f.facts()).toEqual({ writers: 0, starts: 0, calls: 0 }); await turn();
});
it('closed-before-start denies producer; synchronous ordinary callback throw retains original closing reason', async () => {
  const f = fixture(); f.close(); expect(() => candidate()(f.callbacks)).toThrow('mcp_registration_shutdown'); expect(f.facts().calls).toBe(0);
  const g = fixture(), error = Error('own synchronous callback failure'); g.callbacks.register = () => { g.close(); throw error; };
  const owner = candidate()(g.callbacks); const closed = Promise.allSettled([owner.dispose()]); expect(await owner.registered).toBe(false);
  expect(await closed).toEqual([{ status: 'rejected', reason: error }]); expect(g.facts().writers).toBe(0);
});
it('BEFORE actual old continuation and optional-dispose statement reproduce an unclaimed late callback', async () => {
  const source = frozen('before'), tree = ast(source); let registration: ts.VariableDeclaration | undefined, optionalDispose: ts.ExpressionStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'mcpRegistrationPromise') registration = node;
    if (ts.isExpressionStatement(node) && node.getText(tree) === 'await mcpDispose?.();') optionalDispose = node;
    ts.forEachChild(node, visit);
  }
  visit(tree); const init = registration?.initializer;
  if (!init || !ts.isCallExpression(init) || !ts.isPropertyAccessExpression(init.expression)) throw Error('original_catch_missing');
  const then = init.expression.expression;
  if (!ts.isCallExpression(then) || !ts.isPropertyAccessExpression(then.expression) || !optionalDispose) throw Error('original_then_or_dispose_missing');
  const success = then.arguments[0], failure = init.arguments[0]; if (!success || !failure) throw Error('original_continuation_missing');
  const code = `let mcpDispose; return {registered: raw.then(${success.getText(tree)}).catch(${failure.getText(tree)}), dispose: async()=>{${optionalDispose.getText(tree)}}};`;
  const raw = deferred<Result>(); let disposed = 0, starts = 0;
  const value = compileOwnCallbacks(code, ['raw', 'startRuntimeBridge', 'debugMain'])(raw.promise, () => { starts++; }, () => undefined);
  function isOwner(input: unknown): input is Owner { return typeof input === 'object' && input !== null && 'dispose' in input && typeof input.dispose === 'function' && 'registered' in input && input.registered instanceof Promise; }
  if (!isOwner(value)) throw Error('original_plain_callback_shape');
  await value.dispose(); raw.resolve({ async dispose() { disposed++; } }); expect(await value.registered).toBe(true);
  expect(disposed).toBe(0); expect(starts).toBe(1);
});
it('early final fallback covers missing/failed normal cleanup without inventing a replacement callback', async () => {
  const f = fixture(), owner = candidate()(f.callbacks); let calls = 0;
  f.raw.resolve({ async dispose() { calls++; } }); await owner.registered; f.close();
  // No normal owner.dispose() call: use only the actual registered fallback.
  await f.final[0]!(); expect(calls).toBe(1); expect(owner.dispose()).toBe(f.final[0]!());
});
it('reentrant dispose observes the already memoized promise rather than invoking the callback twice', async () => {
  const f = fixture(), owner = candidate()(f.callbacks); let calls = 0, reentered: Promise<void> | undefined;
  f.raw.resolve({ async dispose() { calls++; reentered = owner.dispose(); } }); await owner.registered; f.close();
  const close = owner.dispose(); await close; expect(reentered).toBe(close); expect(calls).toBe(1);
});
it('bridge callback error after raw success cannot erase the returned disposer or masquerade as raw failure', async () => {
  const f = fixture(), error = Error('own bridge callback failure'); let calls = 0;
  f.callbacks.startBridge = () => { throw error; }; const owner = candidate()(f.callbacks);
  const status = Promise.allSettled([owner.registered]); f.raw.resolve({ async dispose() { calls++; } });
  expect(await status).toEqual([{ status: 'rejected', reason: error }]); expect(f.failures).toEqual([]);
  f.close(); await owner.dispose(); expect(calls).toBe(1); expect(f.facts().writers).toBe(0);
});
it('diagnostic error does not replace the original closing raw reason on lifetime', async () => {
  const f = fixture(), rawError = Error('own closing raw'), diagnosticError = Error('own diagnostic failure');
  f.callbacks.reportRegistrationFailure = () => { throw diagnosticError; }; const owner = candidate()(f.callbacks); f.close();
  const status = Promise.allSettled([owner.registered]), retirement = Promise.allSettled([owner.dispose()]); f.raw.reject(rawError);
  expect(await status).toEqual([{ status: 'rejected', reason: diagnosticError }]);
  expect(await retirement).toEqual([{ status: 'rejected', reason: rawError }]); expect(f.facts().writers).toBe(0);
});
