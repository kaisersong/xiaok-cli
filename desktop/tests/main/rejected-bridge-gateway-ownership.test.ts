// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { withActualMainRegistration, turn } from './mcp-registration-actual-main-fixture.js';

type OwnClient = { start(): Promise<void>; stop(): Promise<void> };
type StopProbe = { stop(): Promise<void>; current(): Promise<void> | undefined };
function isProbe(value: unknown): value is StopProbe { return typeof value === 'object' && value !== null && 'stop' in value && typeof value.stop === 'function' && 'current' in value && typeof value.current === 'function'; }
function ownRaw<T>() {
  let complete!: (value: T) => void, fail!: (error: unknown) => void, settled = false;
  const promise = new Promise<T>((resolve, reject) => { complete = resolve; fail = reject; }); void promise.catch(() => undefined);
  return { promise, resolve(value: T) { if (!settled) { settled = true; complete(value); } }, reject(error: unknown) { if (!settled) { settled = true; fail(error); } } };
}
function actualStopProbe(clients: OwnClient[]): StopProbe {
  const actual = readFileSync(new URL('../../electron/main.ts', import.meta.url)), snapshot = readFileSync(new URL('../fixtures/r299-main-candidate.txt', import.meta.url));
  if (!actual.equals(snapshot) || createHash('sha256').update(actual).digest('hex') !== '9c874df44ea458ed7f780355081e5b2b0fa788970393c8d19b20f03895df377f') throw Error('r334_actual_Main_binding_NOT_READY');
  const tree = ts.createSourceFile('actual-main.ts', actual.toString('utf8'), ts.ScriptTarget.ES2022, true);
  const initial = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'createInitialWindowResources');
  if (initial.length !== 1 || !initial[0]?.body) throw Error('actual_Main_initial_missing');
  const names = new Set(['runtimeBridgeClients', 'runtimeBridgeStarted', 'runtimeBridgeFallbackTimer', 'runtimeBridgeStartEpoch', 'runtimeBridgeStopping', 'stopRuntimeBridge']);
  const declarations = initial[0].body.statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => names.has(value.name.getText(tree))));
  if (declarations.length !== names.size) throw Error('actual_Main_stop_declarations_changed');
  for (const name of names) if (declarations.filter(node => node.declarationList.declarations.some(value => value.name.getText(tree) === name)).length !== 1) throw Error('actual_Main_stop_dependency_missing');
  // Exact real stop/state source on own callbacks; no SDK class/factory or reproduced stop loop.
  const code = `${declarations.map(node => node.getText(tree)).join('\n')}\nruntimeBridgeClients.push(...inputs); return {stop:stopRuntimeBridge,current:()=>runtimeBridgeStopping};`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (output.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error)) throw Error('actual_stop_probe_transpile_failed');
  const value: unknown = compileFunction(output.outputText, ['inputs'])(clients); if (!isProbe(value)) throw Error('actual_stop_probe_shape'); return value;
}
function requiredRaw(values: readonly Promise<void>[]): Promise<void> { const raw = values[0]; if (!raw) throw Error('actual_Main_group_raw_missing'); return raw; }

it('G1 actual Main starts gateway then relay/MCP before held raw join; prefix sees pre-registered final fallback', async () => {
  await withActualMainRegistration(async f => {
    const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const fallback = f.finalSteps.find(step => step.name === 'mobile-gateway-stop'); if (!fallback) throw Error('actual_gateway_final_missing');
    let prefixFallback: Promise<void> | undefined, fallbackDone = false;
    f.hooks.gateway = () => { prefixFallback = fallback.run(); void prefixFallback.then(() => { fallbackDone = true; }); };
    const closing = f.close(); let done = false; void closing.then(() => { done = true; });
    await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1)); await turn();
    expect(f.index('callback:mobile.stop')).toBeLessThan(f.index('callback:relay.stop'));
    expect(f.index('callback:relay.stop')).toBeLessThan(f.index('callback:mcp.dispose'));
    expect(prefixFallback).toBeDefined(); expect(fallbackDone).toBe(false); expect(done).toBe(false);
    expect(f.count('own:ordinary.after-main')).toBe(0); expect(f.count('own:final')).toBe(0);
    expect(f.gatewayReceivers).toEqual([f.gatewayCarrier]); expect(f.gatewayArguments).toEqual([[]]);
    f.gateway.resolve(); await closing; await prefixFallback;
    expect(fallbackDone).toBe(true); expect(f.count('callback:mobile.stop')).toBe(1); expect(f.count('callback:mcp.dispose')).toBe(1);
  }, { holdGateway: true });
}, 15000);

it('G2 actual Main logs gateway original E once and retains exact E on group/final failure ACK', async () => {
  await withActualMainRegistration(async f => {
    const error = Error('own gateway close rejected'); f.allowError(error);
    const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const closing = f.close(); await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1)); f.gateway.reject(error);
    const report = await closing; expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(await Promise.allSettled([requiredRaw(f.groupRaws)])).toEqual([{ status: 'rejected', reason: error }]);
    expect(f.logs.filter(value => value.event === 'mobileGateway.stop failed')).toEqual([{ event: 'mobileGateway.stop failed', detail: error.message }]);
    expect(f.count('callback:mobile.stop')).toBe(1); expect(f.count('callback:mcp.dispose')).toBe(1);
  }, { holdGateway: true });
}, 15000);

it('G3 gateway E/log L plus relay S remain ordered original errors; relay throw still skips normal MCP and final fallback retires once', async () => {
  await withActualMainRegistration(async f => {
    const gatewayError = Error('own close E'), logError = Error('own log L'), relayError = Error('own relay S');
    for (const error of [gatewayError, logError, relayError]) f.allowError(error);
    f.hooks.log = event => { if (event === 'mobileGateway.stop failed') throw logError; }; f.hooks.relay = () => { throw relayError; };
    const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const closing = f.close(); await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1));
    expect(f.index('own:ordinary.after-main')).toBeLessThan(f.index('callback:mcp.dispose'));
    f.gateway.reject(gatewayError); await closing;
    expect(await Promise.allSettled([requiredRaw(f.groupRaws)])).toEqual([{ status: 'rejected', reason: relayError }]);
    const outcome = (await Promise.allSettled([requiredRaw(f.gatewayFinalRaws)]))[0];
    if (!outcome || outcome.status !== 'rejected' || !(outcome.reason instanceof AggregateError)) throw Error('actual_group_aggregate_missing');
    const gatewayFailure: unknown = outcome.reason.errors[0]; if (!(gatewayFailure instanceof AggregateError)) throw Error('actual_gateway_aggregate_missing');
    expect(gatewayFailure.errors).toEqual([gatewayError, logError]); expect(outcome.reason.errors).toEqual([gatewayFailure, relayError]);
    expect(f.index('own:ordinary.after-main')).toBeLessThan(f.index('callback:mcp.dispose'));
    expect(f.count('callback:mcp.dispose')).toBe(1); expect(f.count('callback:mobile.stop')).toBe(1);
  }, { holdGateway: true });
}, 15000);

it('G4 MCP rejects first while gateway held: actual group and final fallback still join original gateway before completing', async () => {
  await withActualMainRegistration(async f => {
    const error = Error('own MCP E'); f.allowError(error);
    const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const closing = f.close(); let done = false; void closing.then(() => { done = true; });
    await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1)); f.disposal.reject(error); await turn();
    await vi.waitFor(() => expect(f.count('own:ordinary.after-main')).toBe(1));
    expect(done).toBe(false); expect(f.count('own:final')).toBe(0); f.gateway.resolve(); await closing;
    expect(await Promise.allSettled([requiredRaw(f.groupRaws)])).toEqual([{ status: 'rejected', reason: error }]);
    expect(f.count('callback:mobile.stop')).toBe(1); expect(f.count('callback:mcp.dispose')).toBe(1);
  }, { holdGateway: true, holdDispose: true });
}, 15000);

it('G5 actual stop waits every returned raw after one rejection; pending does not advance dependent closes', async () => {
  const a = ownRaw<void>(), b = ownRaw<void>(), error = Error('own client raw rejected');
  const first = { async start() {}, stop() { return a.promise; } }, second = { async start() {}, stop() { return b.promise; } };
  const probe = actualStopProbe([first, second]);
  await withActualMainRegistration(async f => {
    f.allowError(error); const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const closing = f.close(); let done = false; void closing.then(() => { done = true; });
    try {
      await vi.waitFor(() => expect(probe.current()).toBeDefined()); a.reject(error); await turn();
      expect(done).toBe(false); expect(f.count('callback:mobile.stop')).toBe(0); expect(f.count('callback:relay.stop')).toBe(0);
      b.resolve(); await closing; const stopping = probe.current(); if (!stopping) throw Error('actual_stop_memo_missing');
      const bridge = (await Promise.allSettled([stopping]))[0], group = (await Promise.allSettled([requiredRaw(f.groupRaws)]))[0];
      if (!bridge || bridge.status !== 'rejected' || !group || group.status !== 'rejected') throw Error('actual_rejection_missing');
      expect(group.reason).toBe(bridge.reason); expect(f.count('callback:mobile.stop')).toBe(0); expect(f.count('callback:mcp.dispose')).toBe(1);
    } finally { a.resolve(); b.resolve(); }
  }, { bridgeStop: probe.stop });
}, 15000);

it('G6 actual stop sync pre-effect throw can leave a client unsealed: no new dependent release; existing MCP fallback is not qualification', async () => {
  let sealed = false, calls = 0, allowSeal = false; const error = Error('own callback pre-effect stop throw');
  const client = { async start() {}, stop(): Promise<void> { calls++; if (!allowSeal) throw error; sealed = true; return Promise.resolve(); } };
  const probe = actualStopProbe([client]);
  await withActualMainRegistration(async f => {
    f.allowError(error); const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const report = await f.close(); expect(report.cleanupFailed).toContain('lifetime_resources');
    allowSeal = true; const retained = probe.current(); if (!retained) throw Error('actual_stop_retained_memo_missing'); expect(probe.stop()).toBe(retained);
    expect(sealed).toBe(false); expect(calls).toBe(1); expect(f.count('callback:mobile.stop')).toBe(0); expect(f.count('callback:relay.stop')).toBe(0);
    expect(f.count('callback:mcp.dispose')).toBe(1); // Existing final fallback only; no physical/grant assertion.
  }, { bridgeStop: probe.stop });
});
