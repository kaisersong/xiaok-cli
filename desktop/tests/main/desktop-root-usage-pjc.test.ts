// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { ModelStreamPhysicalOwner } from '../../../src/ai/runtime/model-stream-physical-owner.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { createDesktopServices, getDesktopMemoryStore } from '../../electron/desktop-services.js';
import { assertDesktopModelPhysicalIdle } from '../../electron/desktop-task-stream.js';
import { withRootUsageOwner, deferred, turn } from '../fixtures/root-usage-ownership.js';

const probe = vi.hoisted(() => ({ active: undefined as any }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: function(this: unknown, ...args: any[]) {
    return probe.active ? probe.active.append(actual.appendFile, this, args) : Reflect.apply(actual.appendFile, this, args);
  } };
});
vi.mock('../../electron/desktop-model-usage-admission.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-model-usage-admission.js')>();
  return { ...actual, mapDesktopModelUsageAdmission: function(this: unknown, ...args: Parameters<typeof actual.mapDesktopModelUsageAdmission>) {
    const raw = Reflect.apply(actual.mapDesktopModelUsageAdmission, this, args);
    probe.active?.maps.push({ original: args[0], callback: args[1], cap: raw }); return raw;
  } };
});
vi.mock('../../../src/ai/runtime/provider-conversation-authorization.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/runtime/provider-conversation-authorization.js')>();
  return { ...actual, streamDesktopTaskProviderConversation: function(this: unknown, ...args: Parameters<typeof actual.streamDesktopTaskProviderConversation>) {
    const raw = Reflect.apply(actual.streamDesktopTaskProviderConversation, this, args);
    probe.active?.sources.push(raw); return raw;
  } };
});
vi.mock('../../../src/ai/runtime/model-stream-recovery.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/runtime/model-stream-recovery.js')>();
  return { ...actual, recoverModelStream: function(this: unknown, ...args: Parameters<typeof actual.recoverModelStream>) {
    const state = probe.active, input = args[0];
    if (state) {
      const open = input.open;
      input.open = function(this: unknown, ...openArgs: Parameters<typeof open>) {
        const source = Reflect.apply(open, this, openArgs);
        state.checkedSources.push(source); state.installReturn(source, 'outer'); return source;
      };
      state.recoverInputs.push({ input, originalOpen: open, signal: input.signal, physicalRun: input.physicalRun });
    }
    return Reflect.apply(actual.recoverModelStream, this, args);
  } };
});
vi.mock('../../electron/desktop-task-stream.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-task-stream.js')>();
  return { ...actual, closeDesktopModelPhysicalScope: function(this: unknown, ...args: Parameters<typeof actual.closeDesktopModelPhysicalScope>) {
    const raw = Reflect.apply(actual.closeDesktopModelPhysicalScope, this, args);
    probe.active?.closed(args[0], args[1], raw, new Error('owned close observation').stack); return raw;
  } };
});
vi.mock('../../electron/goal-store-sqlite.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/goal-store-sqlite.js')>();
  return { ...actual, SqliteGoalStore: function(...args: ConstructorParameters<typeof actual.SqliteGoalStore>) {
    const original = Reflect.construct(actual.SqliteGoalStore, args); probe.active?.goals.push(original); return original;
  } };
});
vi.mock('../../electron/artifact-workspace-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/artifact-workspace-store.js')>();
  return { ...actual, ArtifactWorkspaceStore: function(...args: ConstructorParameters<typeof actual.ArtifactWorkspaceStore>) {
    const original = Reflect.construct(actual.ArtifactWorkspaceStore, args); probe.active?.artifacts.push(original); return original;
  } };
});

vi.mock('../../electron/desktop-multi-agent-service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-multi-agent-service.js')>();
  function ObservedService(...args: ConstructorParameters<typeof actual.DesktopMultiAgentService>) {
    const original = Reflect.construct(actual.DesktopMultiAgentService, args);
    const owner = probe.active?.owner;
    if (owner) { owner.service = owner.keep('service', original); owner.attachStore(args[0].store); owner.coordinator = owner.keep('coordinator', args[0].coordinator); }
    return original;
  }
  ObservedService.prototype = actual.DesktopMultiAgentService.prototype;
  return { ...actual, DesktopMultiAgentService: ObservedService };
});
vi.mock('../../../src/ai/memory/layered-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/memory/layered-store.js')>();
  function ObservedMemory(...args: ConstructorParameters<typeof actual.LayeredMemoryStore>) {
    const original = Reflect.construct(actual.LayeredMemoryStore, args);
    if (probe.active) { probe.active.memoryCandidates.push(original); probe.active.owner.keep('memoryCandidates', probe.active.memoryCandidates); }
    return original;
  }
  ObservedMemory.prototype = actual.LayeredMemoryStore.prototype;
  return { ...actual, LayeredMemoryStore: ObservedMemory };
});

it('default Main keeps exact P/J/D/C and both original physical returns through cancellation', ctx => withRootUsageOwner(ctx, 'factory', async owner => {
  const readEntered = deferred(), releaseRead = deferred(), nativeWritten = deferred(), releaseJournal = deferred();
  const returnEntered = deferred(), releaseReturn = deferred();
  owner.rescues.push(() => releaseRead.resolve(), () => releaseJournal.resolve(), () => releaseReturn.resolve());
  let seq = 0, taskId = '', context: any, cap: any, rootP!: Promise<unknown>, hostSignal!: AbortSignal, actualScope: any;
  let nativeIterator: any, leafR!: Promise<unknown>, outerR!: Promise<unknown>, J!: Promise<void>;
  let streamCalls = 0, nativeAppends = 0, nativeReturnCalls = 0, outerReturnCalls = 0;
  const maps: any[] = [], sources: any[] = [], checkedSources: any[] = [], recoverInputs: any[] = [];
  const queuePromises: Promise<unknown>[] = [];
  const tracks: Array<{ owner: ModelStreamPhysicalOwner; raw: Promise<unknown>; created: number }> = [];
  const closes: Array<{ scope: any; reason: unknown; raw: Promise<void>; stack?: string; created: number }> = [];
  const events: Array<{ kind: string; seq: number }> = [], observerErrors: unknown[] = [];
  const event = (kind: string) => { const value = ++seq; events.push({ kind, seq: value }); return value; };
  const state: any = { owner, memoryCandidates: [], maps, sources, checkedSources, recoverInputs, goals: owner.goals, artifacts: owner.artifacts,
    append: (original: Function, receiver: unknown, args: any[]) => {
      let target = false;
      try {
        if (taskId && basename(String(args[0])) === `${taskId}.journal.jsonl`) {
          const record = JSON.parse(String(args[1]));
          target = record.taskId === taskId && Array.isArray(record.events) && record.events.some((entry: any) => entry.type === 'usage_recorded');
          if (target) {
            nativeAppends++;
            if (nativeAppends !== 1) observerErrors.push(Error('root_usage_second_native_usage_append'));
            try { expect(record.events.filter((entry: any) => entry.type === 'usage_recorded')).toEqual([{ type: 'usage_recorded', inputTokens: 17, outputTokens: 19 }]); }
            catch (error) { observerErrors.push(error); }
          }
        }
      } catch (error) { observerErrors.push(error); }
      const native = Reflect.apply(original, receiver, args);
      // Non-target append calls keep their original Promise identity.
      if (!target) return native;
      owner.watch('actualNativeAppendSubOperation', native);
      const heldReceipt = native.then(() => { event('native-append-completed'); nativeWritten.resolve(); return releaseJournal.promise; });
      return owner.watch('controlledNativeAppendSubReceipt', heldReceipt);
    },
    installReturn: (iterator: any, kind: 'leaf' | 'outer') => {
      try {
        const original = iterator.return;
        if (typeof original !== 'function') throw Error('root_usage_original_return_missing');
        if (kind === 'outer' && (typeof Object.getOwnPropertyDescriptor(iterator, Symbol.asyncIterator)?.value !== 'function'
          || typeof Object.getOwnPropertyDescriptor(iterator, 'next')?.value !== 'function')) throw Error('root_usage_checked_source_shape');
        Object.defineProperty(iterator, 'return', { configurable: true, writable: true, value: function(this: unknown, ...args: unknown[]) {
          const raw = Reflect.apply(original, this, args);
          try {
            if (this !== iterator) throw Error('root_usage_actual_return_receiver_changed');
            owner.watch(`${kind}OriginalReturn`, raw);
            if (kind === 'leaf') { nativeReturnCalls++; leafR = raw; } else { outerReturnCalls++; outerR = raw; }
            event(`${kind}-return-created`); void raw.then(() => event(`${kind}-return-fulfilled`), () => event(`${kind}-return-rejected`));
          } catch (error) { observerErrors.push(error); }
          return raw;
        } });
      } catch (error) { observerErrors.push(error); }
    },
    closed: (scope: any, reason: unknown, raw: Promise<void>, stack?: string) => {
      closes.push({ scope, reason, raw, stack, created: event('production-close-created') }); owner.watch('originalProductionClose', raw);
    },
  };
  probe.active = owner.keep('hoistedObserverState', state);
  owner.keep('events', events); owner.keep('observerErrors', observerErrors); owner.keep('tracks', tracks); owner.keep('queuePromises', queuePromises); owner.keep('closes', closes);
  const oldConfig = process.env.XIAOK_CONFIG_DIR, oldMetrics = process.env.XIAOK_METRICS_DIR, oldPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
  const configRoot = join(owner.root, 'immutable-config'); mkdirSync(configRoot);
  process.env.XIAOK_CONFIG_DIR = configRoot; delete process.env.XIAOK_METRICS_DIR; process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
  owner.restores.push(() => {
    for (const [key, value] of [['XIAOK_CONFIG_DIR', oldConfig], ['XIAOK_METRICS_DIR', oldMetrics], ['XIAOK_DISABLE_GLOBAL_PLUGINS', oldPlugins]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    probe.active = undefined;
  });
  writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current',
    providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'owned-no-network' } },
    models: { current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] } }, defaultMode: 'interactive', channels: {} }));
  const exec = DatabaseSync.prototype.exec;
  const dbSpy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(this: DatabaseSync, ...args) {
    owner.captureNative(this); return Reflect.apply(exec, this, args);
  }); owner.restores.push(() => dbSpy.mockRestore());
  const originalTrack = (ModelStreamPhysicalOwner.prototype as any).track;
  const trackSpy = vi.spyOn(ModelStreamPhysicalOwner.prototype as any, 'track').mockImplementation(function(this: ModelStreamPhysicalOwner, ...args: any[]) {
    tracks.push({ owner: this, raw: args[0], created: event('actual-owner-track') }); owner.watch('actualOwnerTrack', args[0]);
    return Reflect.apply(originalTrack, this, args);
  }); owner.restores.push(() => trackSpy.mockRestore());
  const start = InProcessTaskRuntimeHost.prototype.startTask;
  const startSpy = vi.spyOn(InProcessTaskRuntimeHost.prototype, 'startTask').mockImplementation(function(this: InProcessTaskRuntimeHost, ...args) {
    owner.host = owner.keep('actualHost', this); return Reflect.apply(start, this, args);
  }); owner.restores.push(() => startSpy.mockRestore());
  const appendUsage = (InProcessTaskRuntimeHost.prototype as any).appendUsage;
  const journalSpy = vi.spyOn(InProcessTaskRuntimeHost.prototype as any, 'appendUsage').mockImplementation(function(this: InProcessTaskRuntimeHost, ...args: any[]) {
    const raw = Reflect.apply(appendUsage, this, args);
    if (args[0] === taskId) { if (J) observerErrors.push(Error('root_usage_second_actual_J')); J = owner.watch('originalHostAppendUsageJ', raw); }
    return raw;
  }); owner.restores.push(() => journalSpy.mockRestore());
  const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(function() {
    streamCalls++;
    async function* originalNativeProvider() {
      try { readEntered.resolve(); await releaseRead.promise; yield { type: 'usage' as const, usage: { inputTokens: 17, outputTokens: 19 } };
        yield { type: 'text' as const, delta: 'LATE_TEXT_MUST_NOT_APPEAR' }; yield { type: 'done' as const }; }
      finally { event('native-finally-entered'); returnEntered.resolve(); await releaseReturn.promise; }
    }
    nativeIterator = originalNativeProvider(); owner.keep('nativeProviderIterator', nativeIterator); state.installReturn(nativeIterator, 'leaf'); return nativeIterator;
  }); owner.restores.push(() => streamSpy.mockRestore());
  const gateway = { start: async () => {}, stop: async () => {}, restart: async () => {},
    getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {},
    getDesktopMutationToken: () => 'owned-fixture', request: async () => new Response('{}', { status: 503 }) };
  const services = createDesktopServices({ dataRoot: join(owner.root, 'data'), workspaceRoot: owner.root, knowledgeDbPath: join(owner.root, 'knowledge.sqlite'),
    pluginRootDir: join(owner.root, 'plugins'), pluginDependencies: [], kswarmService: gateway as any });
  owner.services = owner.keep('services', services); await services.multiAgent!.ready;
  const service = owner.service = owner.keep('service', services.multiAgent!.service);
  const internals = service as any; owner.attachStore(internals.options.store); owner.coordinator = owner.keep('coordinator', internals.options.coordinator);
  owner.memory = owner.keep('memory', getDesktopMemoryStore(services.getDataRoot()) as any);
  let queueObserved = false;
  const originalCapture = service.captureAdmittedUsage;
  const captureSpy = vi.spyOn(service, 'captureAdmittedUsage').mockImplementation(function(this: typeof service, ...args) {
    const raw = Reflect.apply(originalCapture, this, args); context = args[0]; cap = raw; owner.keep('actualRootContext', context); owner.keep('serviceCap', cap);
    if (!queueObserved) {
      const queue = internals.groups.get(context.groupId).commands, run = queue.run;
      const queueSpy = vi.spyOn(queue, 'run').mockImplementation(function(this: unknown, ...runArgs: unknown[]) {
        const original = Reflect.apply(run, this, runArgs); queuePromises.push(original); owner.watch('actualSequencerP', original); return original;
      }); owner.restores.push(() => queueSpy.mockRestore()); queueObserved = true;
    }
    return raw;
  }); owner.restores.push(() => captureSpy.mockRestore());
  const originalScope = service.captureRootModelPhysicalScope;
  const scopeSpy = vi.spyOn(service, 'captureRootModelPhysicalScope').mockImplementation(function(this: typeof service, ...args) {
    const raw = Reflect.apply(originalScope, this, args); actualScope = owner.keep('actualRootScope', raw); return raw;
  }); owner.restores.push(() => scopeSpy.mockRestore());
  let rootActionP!: Promise<unknown>, rootActionContext: unknown, rootActionCalls = 0;
  const originalRun = service.runRoot;
  const rootSpy = vi.spyOn(service, 'runRoot').mockImplementation(function(this: typeof service, ...args) {
    const originalAction = args[1]; owner.keep('originalMainRootAction', originalAction);
    const observedAction = function(this: unknown, ...actionArgs: Parameters<typeof originalAction>) {
      const rawAction = Reflect.apply(originalAction, this, actionArgs);
      rootActionCalls++; rootActionContext = actionArgs[0];
      rootActionP = owner.watch('originalMainRootActionPromise', rawAction); return rawAction;
    };
    owner.keep('observedMainRootAction', observedAction);
    const raw = Reflect.apply(originalRun, this, [args[0], observedAction]); hostSignal = args[0].signal; rootP = owner.watch('actualRunRootP', raw); return raw;
  }); owner.restores.push(() => rootSpy.mockRestore());
  const created = await services.createTask({ prompt: 'Reply once using the owned provider leaf.', materials: [], context: { threadId: 'root-pjc' } }); taskId = created.taskId;
  await readEntered.promise; expect(cap).toBeDefined(); expect(maps).toHaveLength(2); expect(maps[0].original).toBe(cap); expect(maps[1].original).toBe(maps[0].cap);
  expect(sources).toHaveLength(1); expect(sources[0]).toBe(nativeIterator); expect(recoverInputs).toHaveLength(1);
  await services.cancelTask(taskId); expect(context.signal.aborted).toBe(true);
  const hostDrain = owner.watch('actualRequestedHostDrain', owner.host!.drain());
  expect(() => service.captureAdmittedUsage(context, 'new-after-stop')).toThrow();
  const ordinary = owner.watch('ordinaryUsageMustReject', service.recordUsage(context, { usageId: 'new-after-stop', inputTokens: 1, outputTokens: 1 }));
  const ordinaryResult = await owner.outcome(ordinary); expect(ordinaryResult.ok).toBe(false);
  if (ordinaryResult.ok) throw Error('root_usage_unadmitted_operation_accepted');
  expect(ordinaryResult.error).toBeInstanceOf(Error); expect((ordinaryResult.error as Error).message).toBe('stale or invalid multi-agent authority');
  expect(Object.hasOwn(ordinaryResult.error as object, 'cause')).toBe(false); expect(Object.hasOwn(ordinaryResult.error as object, 'errors')).toBe(false);
  owner.acceptRejection(ordinary, ordinaryResult.error);
  const cancelled = (await services.recoverTask(taskId)).snapshot; const terminal = cancelled.events.findIndex(entry => entry.type === 'task_terminal');
  expect(terminal).toBeGreaterThanOrEqual(0); releaseRead.resolve(); await nativeWritten.promise;
  const queuedBeforeMemoRead = owner.keep('queuedBeforeMemoRead', [...queuePromises]);
  const tracksBeforeMemoRead = owner.keep('tracksBeforeMemoRead', [...tracks]);
  const queueCountBeforeMemoRead = queuePromises.length;
  const P = owner.watch('originalServiceMemoP', cap.commit(17, 19));
  const D = owner.watch('originalJournalMapMemoD', maps[0].cap.commit(17, 19));
  const C = owner.watch('originalCompleteMemoC', maps[1].cap.commit(17, 19));
  expect(queuePromises).toHaveLength(queueCountBeforeMemoRead);
  expect(queuedBeforeMemoRead.filter(raw => raw === P)).toHaveLength(1);
  expect(owner.result(P)?.ok).toBe(true);
  expect(tracksBeforeMemoRead.filter(record => record.raw === C)).toHaveLength(1);
  await P; await turn(); expect(cap.commit(17, 19)).toBe(P); expect(maps[0].cap.commit(17, 19)).toBe(D); expect(maps[1].cap.commit(17, 19)).toBe(C);
  expect(queuePromises.filter(raw => raw === P)).toHaveLength(1); expect(Object.isFrozen(cap)).toBe(true); expect(Object.isFrozen(maps[0].cap)).toBe(true); expect(Object.isFrozen(maps[1].cap)).toBe(true);
  expect(P).not.toBe(D); expect(C).not.toBe(P); expect(C).not.toBe(D); expect(owner.result(J)).toBeUndefined(); expect(owner.result(D)).toBeUndefined(); expect(owner.result(C)).toBeUndefined();
  expect(tracks.filter(record => record.raw === C)).toHaveLength(1); expect(owner.result(rootP)).toBeUndefined(); expect(owner.result(hostDrain)).toBeUndefined(); expect(owner.host!.inFlightTaskIds()).toContain(taskId); expect(context.memberTicket.released).toBe(false);
  expect(() => assertDesktopModelPhysicalIdle(actualScope)).toThrow(); expect(owner.nativeOpen((owner.store as any).db)).toBe(true);
  const cold = () => new FileTaskSnapshotStore(join(owner.root, 'data', 'tasks')).recoverTask(taskId);
  const native = (await cold())!; expect(native.usage).toEqual({ inputTokens: 17, outputTokens: 19, known: true }); expect(native.events[terminal]).toEqual(cancelled.events[terminal]);
  releaseJournal.resolve(); await J; await D; await C; await returnEntered.promise;
  await vi.waitFor(() => { expect(leafR).toBeDefined(); expect(outerR).toBeDefined(); expect(closes).toHaveLength(1); });
  expect(sources).toHaveLength(1); expect(sources[0]).toBe(nativeIterator); expect(checkedSources).toHaveLength(1); expect(leafR).not.toBe(outerR);
  expect(owner.result(leafR)).toBeUndefined(); expect(owner.result(outerR)).toBeUndefined(); expect(owner.result(closes[0].raw)).toBeUndefined();
  expect(closes[0].scope).toBe(actualScope); expect(closes[0].stack).toContain('desktop-services.ts:8340');
  expect(owner.result(rootP)).toBeUndefined(); expect(owner.result(hostDrain)).toBeUndefined(); expect(owner.host!.inFlightTaskIds()).toContain(taskId); expect(context.memberTicket.released).toBe(false); expect(() => assertDesktopModelPhysicalIdle(actualScope)).toThrow();
  expect(cap.commit(17, 19)).toBe(P); expect(streamCalls).toBe(1); expect(nativeAppends).toBe(1);
  releaseReturn.resolve(); await leafR; await outerR;
  const rootResult = await owner.outcome(rootP); expect(rootResult.ok).toBe(false);
  if (rootResult.ok) throw Error('root_usage_cancelled_root_fulfilled');
  expect(rootActionCalls).toBe(1); expect(rootActionContext).toBe(context);
  const actionResult = await owner.outcome(rootActionP); expect(actionResult.ok).toBe(false);
  if (actionResult.ok) throw Error('root_usage_cancelled_main_action_fulfilled');
  expect(rootResult.error).toBe(actionResult.error);
  expect(rootResult.error).toBeInstanceOf(DOMException);
  const originalAbort = rootResult.error as DOMException;
  expect(originalAbort.name).toBe('AbortError'); expect(originalAbort.message).toBe('user_cancelled'); expect(originalAbort.code).toBe(20);
  expect(originalAbort.stack).toContain('desktop-services.ts:6513');
  expect(Object.hasOwn(originalAbort, 'cause')).toBe(false); expect(Object.hasOwn(originalAbort, 'errors')).toBe(false);
  expect(context.signal.aborted).toBe(true); expect(hostSignal.aborted).toBe(true);
  expect(originalAbort).not.toBe(context.signal.reason); expect(originalAbort).not.toBe(hostSignal.reason);
  owner.acceptRejection(rootActionP, actionResult.error); owner.acceptRejection(rootP, rootResult.error);
  await hostDrain;
  expect(closes).toHaveLength(2); expect(closes[1].scope).toBe(actualScope); expect(closes[1].raw).toBe(closes[0].raw); expect(closes[1].stack).toContain('desktop-multi-agent-service.ts:2492'); await closes[0].raw;
  expect(nativeReturnCalls).toBe(1); expect(outerReturnCalls).toBe(1); expect(tracks).toHaveLength(3);
  const physicalOwner = tracks.find(record => record.raw === C)!.owner;
  for (const raw of [C, leafR, outerR]) expect(tracks.filter(record => record.owner === physicalOwner && record.raw === raw)).toHaveLength(1);
  expect(events.find(entry => entry.kind === 'outer-return-fulfilled')!.seq).toBeGreaterThan(events.find(entry => entry.kind === 'leaf-return-fulfilled')!.seq);
  expect(() => cap.commit(17, 19)).toThrow('desktop_model_usage_admission_revoked'); assertDesktopModelPhysicalIdle(actualScope);
  expect(context.memberTicket.released).toBe(true); expect(owner.coordinator!.snapshot().active).toBe(0);
  const usage = owner.store!.readEvents(context.groupId, 0, 1000).filter(entry => entry.kind === 'usage'); expect(usage).toHaveLength(1);
  expect(owner.store!.getAgent(context.groupId, context.agentId)?.usage).toEqual({ inputTokens: 17, outputTokens: 19 });
  const operationId = 'usage:' + createHash('sha256').update(`${context.agentId}:${context.turnId}:${String(usage[0].payload.usageId)}`).digest('hex');
  expect(owner.store!.getOperation(context.groupId, operationId)).toMatchObject({ command: 'usage', applyState: 'applied' });
  expect((owner.store as any).db.prepare("SELECT COUNT(*) AS count FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='usage'").get(context.groupId)).toEqual({ count: 1 });
  const final = (await cold())!; expect(final.events.filter(entry => entry.type === 'usage_recorded')).toHaveLength(1);
  expect(final.events.some(entry => JSON.stringify(entry).includes('LATE_TEXT_MUST_NOT_APPEAR'))).toBe(false);
  await owner.originalDispose(); expect(closes).toHaveLength(2); expect(service.runtimeStatus().blocked).toBe(false); expect(observerErrors).toEqual([]);
}));
