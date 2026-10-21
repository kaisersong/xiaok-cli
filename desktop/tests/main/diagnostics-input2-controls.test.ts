// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { it, expect, vi } from 'vitest';
import { fixture, METHODS, TARGET, CHANNELS, outputFailure, deferred, type Method } from '../support/diagnostics-input-fixture.js';
import { IPC_SCHEMA_REGISTRY } from '../../electron/ipc-runtime.js';
import { registerDiagnosticsIpc } from '../../electron/diagnostics-typed-ipc.js';
const invalid: unknown[][] = [[], [undefined], [null], [{}], [{ kind: 'future-kind', id: 'missing' }], [{ kind: 'project', id: 7 }], [TARGET, {}], [TARGET, undefined]];
it('INPUT2_META registers two exact target tuples while keeping stats, output/source/risk/round owner', async () => {
  await fixture();
  for (const method of METHODS) {
    const entry = IPC_SCHEMA_REGISTRY.get(CHANNELS[method]);
    expect(entry).toMatchObject({ payloadMode: 'tuple', inputStage: 'beforeHandler', rolloutRound: 35, sourceFile: 'desktop/electron/diagnostics-typed-ipc.ts' });
    expect(entry?.input.description).toBe('qualified-target-tuple');
  }
  expect(IPC_SCHEMA_REGISTRY.get('desktop:getSkillStats')).toMatchObject({ payloadMode: 'tuple', rolloutRound: 19 });
  expect(IPC_SCHEMA_REGISTRY.get('desktop:getSkillStats')?.input.description).toBe('qualified-zero-tuple');
});
it.each(METHODS)('INPUT2_BAD %s rejects malformed/surplus wire before real service/log/network/file effect', async method => {
  const f = await fixture(), producer = vi.spyOn(f.service, method), logger = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const args of invalid) await expect(f.invoke(method, ...args)).rejects.toThrow('diagnostics_input_invalid');
  expect(producer).not.toHaveBeenCalled(); expect(logger).not.toHaveBeenCalled(); expect(f.requests).toEqual([]); expect(existsSync(join(f.data, 'traces'))).toBe(false);
});
it.each(METHODS)('INPUT2_GETTER %s rejects accessor/proxy/serializer/cycle without execution', async method => {
  const f = await fixture(), producer = vi.spyOn(f.service, method); let reads = 0;
  const getter = Object.defineProperty({ id: 'project-1' }, 'kind', { enumerable: true, get() { reads++; return 'project'; } });
  const proxy = new Proxy({}, { ownKeys() { reads++; throw Error('owned-trap'); } });
  const cycle: { kind: string; id: string; future?: unknown } = { ...TARGET }; cycle.future = cycle;
  const serializer = { ...TARGET, toJSON() { reads++; return TARGET; } };
  for (const input of [getter, proxy, cycle, serializer]) await expect(f.invoke(method, input)).rejects.toThrow('diagnostics_input_invalid');
  expect(reads).toBe(0); expect(producer).not.toHaveBeenCalled(); expect(f.requests).toEqual([]);
});
it.each(METHODS)('INPUT2_DETACH %s keeps complete target metadata/type-only id, with per-invoke detached input', async method => {
  const f = await fixture(), result = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]), inputs: unknown[] = [];
  vi.spyOn(f.service, method).mockImplementation(((input: unknown) => { inputs.push(input); return Promise.resolve(result); }) as never);
  const input = { ...TARGET, futureMetadata: { rows: [1, null, 'owned'] }, requestSource: 'agent' };
  await f.invoke(method, input); await f.invoke(method, input);
  expect(inputs[0]).toEqual(input); expect(inputs[0]).not.toBe(input); expect(inputs[1]).not.toBe(inputs[0]);
  expect((inputs[0] as typeof input).futureMetadata).not.toBe(input.futureMetadata);
  // requestSource is inert passthrough metadata, not a new service principal. Parent debt is explicit.
});
it('BUSINESS_PROJECT TS+CJS preserve real file commit, target/evidence/actions and full report', async () => {
  const f = await fixture(), exported = await f.preload.exportTraceBundle(TARGET); expect(exported.ok).toBe(true);
  expect(dirname(exported.path!)).toBe(join(f.data, 'traces')); expect(JSON.parse(readFileSync(exported.path!, 'utf8')).scope).toMatchObject({ kind: 'project', projectId: 'project-1' });
  const report = await f.cjs.diagnose(TARGET); expect(report.primaryFinding).toMatchObject({ category: 'blocked_task', evidenceIds: ['task:blocked-1'] });
  expect(report.recommendedActions.some(action => action.id === 'split_or_reassign_review')).toBe(true);
});
it.each([404, 500])('BUSINESS_HTTP%s keeps export false/error and diagnosis rejection through both preload implementations', async status => {
  const f = await fixture(status), error = 'kswarm project detail request failed: HTTP ' + status;
  for (const consumer of [f.preload, f.cjs]) {
    expect(await consumer.exportTraceBundle(TARGET)).toEqual({ ok: false, error }); await expect(consumer.diagnose(TARGET)).rejects.toThrow(error);
  }
});
it('BUSINESS_TASK_SESSION uses actual store and keeps historical task-to-session attribution', async () => {
  const f = await fixture(); await f.seedSnapshot();
  for (const kind of ['task', 'session'] as const) {
    const target = { kind, id: kind === 'task' ? 'task-1' : 'session-1' }, result = await f.preload.exportTraceBundle(target);
    expect(result.ok).toBe(true); expect(JSON.parse(readFileSync(result.path!, 'utf8')).scope).toMatchObject({ kind: 'session', sessionId: 'session-1' });
    expect((await f.cjs.diagnose(target)).target).toEqual({ kind: 'session', id: 'session-1' });
  }
});
it.each(['task', 'session'] as const)('BUSINESS_MISSING_%s and legitimate empty string id retain exact original failures', async kind => {
  const f = await fixture();
  for (const id of ['missing', '']) {
    const target = { kind, id }, error = kind === 'task' ? (id === '' ? 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' : 'task snapshot not found: ' + id) : 'no snapshots found for session: ' + id;
    expect(await f.preload.exportTraceBundle(target)).toEqual({ ok: false, error }); await expect(f.cjs.diagnose(target)).rejects.toThrow(error);
  }
});
it.each(METHODS)('SOURCE %s rejects unknown/oldMain/subframe/wrongURL/destroyed before input getter and service', async method => {
  for (const mode of ['unknown', 'oldMain', 'subframe', 'wrongURL', 'destroyed']) {
    const f = await fixture(), producer = vi.spyOn(f.service, method); let reads = 0;
    const raw = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; return 'project'; } });
    if (mode === 'oldMain') f.authority.setMain({ webContents: { mainFrame: f.frame, isDestroyed: () => false }, isDestroyed: () => false });
    if (mode === 'wrongURL') f.frame.url = 'https://owned.invalid/foreign';
    const sender = mode === 'unknown' ? { mainFrame: f.frame, isDestroyed: () => false } : mode === 'destroyed' ? { mainFrame: f.frame, isDestroyed: () => true } : f.sender;
    const frame = mode === 'subframe' ? { url: f.frame.url } : f.frame;
    await expect(f.invokeEvent(method, { sender, senderFrame: frame }, raw)).rejects.toThrow('desktop_user_sender_forbidden');
    expect(reads).toBe(0); expect(producer).not.toHaveBeenCalled(); expect(f.requests).toEqual([]); expect(f.gate.outstanding).toBe(0);
  }
});
it.each(METHODS)('SOURCE_RECORDER %s retains legal Recorder population and ordinary token cleanup', async method => {
  const f = await fixture(); const result = await f.invokeEvent(method, { sender: f.recorder, senderFrame: f.recorderFrame }, TARGET);
  expect(result).toBeDefined(); expect(f.requests).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('TOKEN %s actual held SDK work retains original physical token beyond ordinary five seconds', async method => {
  const f = await fixture(), held = deferred<Response>(); f.setResponse(() => held.promise); vi.useFakeTimers();
  const pending = f.invoke(method, TARGET); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  try { const drain = f.gate.drain(5000); await vi.advanceTimersByTimeAsync(5001); expect(await drain).toBe(false); expect(f.gate.outstanding).toBe(1); expect(f.requests).toHaveLength(1); }
  finally { held.resolve(Response.json(f.detail)); await pending; } expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('P1_P2_SYNC %s native fulfilled/rejected and sync result/throw preserve existing boundary semantics', async method => {
  const f = await fixture(), real = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]), producer = vi.spyOn(f.service, method), error = Error('owned-rejection');
  producer.mockImplementation((() => real) as never); expect(await f.invoke(method, TARGET)).toEqual(real);
  producer.mockImplementation((() => Promise.resolve(real)) as never); expect(await f.invoke(method, TARGET)).toEqual(real);
  producer.mockImplementation((() => Promise.reject(error)) as never); await expect(f.invoke(method, TARGET)).rejects.toBe(error);
  producer.mockImplementation((() => { throw error; }) as never); await expect(f.invoke(method, TARGET)).rejects.toBe(error);
});
it.each(METHODS)('P3 %s own-then getter is ignored by the already approved intrinsic receiver', async method => {
  const f = await fixture(), real = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]), result = Promise.resolve(real); let reads = 0;
  Object.defineProperty(result, 'then', { get() { reads++; throw Error('owned-then'); } }); f.service[method] = (() => result) as never;
  const captured = await f.invoke(method, TARGET); expect(captured).toEqual(real); expect(captured).not.toBe(real);
  const dataThen = Promise.resolve(real); Object.defineProperty(dataThen, 'then', { value() { reads++; throw Error('owned-data-then'); } }); f.service[method] = (() => dataThen) as never;
  expect(await f.invoke(method, TARGET)).toEqual(real); expect(reads).toBe(0);
});
it.each(METHODS)('P4_P5 %s constructor accessor/foreign data rejected without reads; original Promise data allowed', async method => {
  const f = await fixture(), real = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]); let reads = 0;
  const accessor = Promise.resolve(real); Object.defineProperty(accessor, 'constructor', { get() { reads++; return Promise; } });
  const foreign = Promise.resolve(real); Object.defineProperty(foreign, 'constructor', { value: new Proxy({}, { get() { reads++; throw Error('owned-constructor'); } }) });
  for (const promise of [accessor, foreign]) { f.service[method] = (() => promise) as never; await expect(f.invoke(method, TARGET)).rejects.toThrow(outputFailure(method)); }
  const permitted = Promise.resolve(real); Object.defineProperty(permitted, 'constructor', { value: Promise }); f.service[method] = (() => permitted) as never;
  expect(await f.invoke(method, TARGET)).toEqual(real); expect(reads).toBe(0);
});
it.each(METHODS)('P6 %s subclass/foreign-prototype/proxy/thenable rejected without traps or then reads', async method => {
  const f = await fixture(), real = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]); let reads = 0;
  class Derived extends Promise<unknown> {}
  const derived = new Derived(resolve => resolve(real)), foreign = runInNewContext('Promise.resolve({ok:true})');
  const proxy = new Proxy(Promise.resolve(real), { get() { reads++; throw Error('owned-proxy'); }, ownKeys() { reads++; return []; } });
  const thenable = Object.defineProperty({}, 'then', { enumerable: true, get() { reads++; throw Error('owned-thenable'); } });
  for (const result of [derived, foreign, proxy, thenable]) { f.service[method] = (() => result) as never; await expect(f.invoke(method, TARGET)).rejects.toThrow(outputFailure(method)); }
  expect(reads).toBe(0);
});
it.each(METHODS)('P7 %s altered global species accessor/data rejected without executing getter', async method => {
  const f = await fixture(), real = await Reflect.apply(f.service[method], f.service, method === 'exportTraceBundle' ? [TARGET, 'user'] : [TARGET]), original = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!; let reads = 0;
  for (const descriptor of [{ configurable: true, get() { reads++; return Promise; } }, { configurable: true, value: Promise }]) {
    const result = Promise.resolve(real); f.service[method] = (() => result) as never; let pending: Promise<unknown>;
    Object.defineProperty(Promise, Symbol.species, descriptor);
    try { pending = f.invoke(method, TARGET); } finally { Object.defineProperty(Promise, Symbol.species, original); }
    await expect(pending!).rejects.toThrow(outputFailure(method));
  }
  expect(reads).toBe(0);
});
it.each(METHODS)('OUTPUT %s capture faults reject in production/development, before getters/serializers and with no retry', async method => {
  const f = await fixture(), producer = vi.spyOn(f.service, method); let reads = 0; const old = process.env.NODE_ENV;
  const accessor = Object.defineProperty({}, 'ok', { enumerable: true, get() { reads++; return true; } }), cycle: { self?: unknown } = {}; cycle.self = cycle;
  try { for (const env of ['production', 'development']) { process.env.NODE_ENV = env;
    for (const result of [accessor, cycle, { toJSON() { reads++; return {}; } }, new Proxy({}, { ownKeys() { reads++; return []; } }), { malformed: true }]) {
      producer.mockReset().mockImplementation((() => result) as never); await expect(f.invoke(method, TARGET)).rejects.toThrow(outputFailure(method)); expect(producer).toHaveBeenCalledTimes(1);
    }
  } } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  expect(reads).toBe(0);
});
it('OUTPUT_EXPORT after an actual committed file capture failure is unknown, never retried or rolled back', async () => {
  const f = await fixture(), actual = f.service.exportTraceBundle.bind(f.service); let path = '', reads = 0;
  const producer = vi.spyOn(f.service, 'exportTraceBundle').mockImplementation(async input => {
    const result = await Reflect.apply(actual, f.service, [input, 'user']); expect(result.ok).toBe(true); path = result.path!;
    return Object.defineProperty({ ok: true }, 'path', { enumerable: true, get() { reads++; return path; } });
  });
  await expect(f.preload.exportTraceBundle(TARGET)).rejects.toThrow('diagnostics_export_operation_unknown');
  expect(producer).toHaveBeenCalledTimes(1); expect(reads).toBe(0); expect(JSON.parse(readFileSync(path, 'utf8')).scope).toMatchObject({ kind: 'project', projectId: 'project-1' }); expect(f.requests).toHaveLength(1);
});
it('OWNER null first owner is before inputcapture; same-owner partial registration repair stays exact', async () => {
  const listeners = new Map<string, Function>(), calls: string[] = []; let fail = true;
  const registrar = { handle(channel: string, listener: Function) { calls.push(channel); if (channel === CHANNELS.exportTraceBundle && fail) { fail = false; throw Error('owned-partial'); } if (listeners.has(channel)) throw Error('owned-duplicate'); listeners.set(channel, listener); } };
  expect(() => registerDiagnosticsIpc(registrar as never)).toThrow('owned-partial'); registerDiagnosticsIpc(registrar as never); registerDiagnosticsIpc(registrar as never);
  expect(listeners.size).toBe(3); expect(calls.filter(channel => channel === 'desktop:getSkillStats')).toHaveLength(1); let reads = 0;
  const raw = Object.defineProperty({}, 'kind', { get() { reads++; return 'project'; } });
  for (const channel of Object.values(CHANNELS)) await expect(Promise.resolve().then(() => listeners.get(channel)!({}, raw))).rejects.toThrow('diagnostics_runtime_unavailable');
  expect(reads).toBe(0); const f = await fixture(); expect(() => registerDiagnosticsIpc(registrar as never, f.service)).toThrow('diagnostics_registrar_owner_conflict');
});
it.each([undefined, 'agent', 'scheduler'] as const)('SERVICE_SOURCE_%s direct export denies before network or file effect', async source => {
  const f = await fixture();
  await expect(Reflect.apply(f.service.exportTraceBundle, f.service, [TARGET, source])).rejects.toThrow('diagnostics_export_request_source_forbidden');
  expect(f.requests).toEqual([]); expect(existsSync(join(f.data, 'traces'))).toBe(false);
});
it('SERVICE_SOURCE getter input and source-looking payload cannot grant missing/agent source', async () => {
  const f = await fixture(); let reads = 0;
  const input = Object.defineProperty({ id: 'project-1', requestSource: 'user' }, 'kind', { enumerable: true, get() { reads++; return 'project'; } });
  for (const source of [undefined, 'agent', 'scheduler']) await expect(Reflect.apply(f.service.exportTraceBundle, f.service, [input, source])).rejects.toThrow('diagnostics_export_request_source_forbidden');
  expect(reads).toBe(0); expect(f.requests).toEqual([]); expect(existsSync(join(f.data, 'traces'))).toBe(false);
});
it('SERVICE_USER actual Main writer injects only export literal user; diagnose keeps readonly routing', async () => {
  const f = await fixture(), writer = vi.spyOn(f.service, 'exportTraceBundle'), reader = vi.spyOn(f.service, 'diagnose');
  expect((await f.preload.exportTraceBundle(TARGET)).ok).toBe(true); expect(writer).toHaveBeenCalledExactlyOnceWith(TARGET, 'user');
  await f.preload.diagnose(TARGET); expect(reader).toHaveBeenCalledExactlyOnceWith(TARGET);
  const direct = await Reflect.apply(f.service.exportTraceBundle, f.service, [TARGET, 'user']); expect(direct.ok).toBe(true); expect(existsSync(direct.path!)).toBe(true);
});
it.each(METHODS)('TOKEN_REJECT %s real held SDK rejection still releases only at actual settle', async method => {
  const f = await fixture(), held = deferred<Response>(), failure = Error('owned-sdk-failure'); f.setResponse(() => held.promise);
  const pending = f.invoke(method, TARGET); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  held.reject(failure);
  if (method === 'exportTraceBundle') expect(await pending).toEqual({ ok: false, error: failure.message }); else await expect(pending).rejects.toBe(failure);
  expect(f.gate.outstanding).toBe(0); expect(f.requests).toHaveLength(1);
});
it('OUTPUT_FULL_METADATA original report/schema guard retains future evidence and historical nonfinite data without clipping', async () => {
  const f = await fixture(), real = await f.service.diagnose(TARGET);
  const report = { ...real, futureTop: { kept: true }, evidence: [...real.evidence, { id: 'owned-future', label: 'Owned future evidence', data: { nested: { rows: [NaN, Infinity, -Infinity, 'owned'] } } }] };
  vi.spyOn(f.service, 'diagnose').mockImplementation((() => Promise.resolve(report)) as never);
  const result = await f.cjs.diagnose(TARGET); expect(result).toEqual(report); expect(result).not.toBe(report); expect(result.evidence).not.toBe(report.evidence);
});
