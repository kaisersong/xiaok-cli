import { randomUUID } from 'node:crypto';
import { acquireHarnessOwnerLock } from './harness-optimization-owner-lock.js';
import { HarnessOptimizationLifecycle } from './harness-optimization-lifecycle.js';
import type { HarnessCloseIntent } from './harness-optimization-lifecycle.js';
import { HarnessOptimizationStore } from './harness-optimization-store.js';
import type { HarnessStoreState } from './harness-optimization-store.js';
import { DEFAULT_HARNESS_OPTIMIZATION_CONFIG, validateHarnessConfigPatch, validateStoredHarnessConfig } from './harness-optimization-config.js';
import { validateRegisteredHarnessManifest } from './harness-research-controller.js';
import type { HarnessAttemptTicket, HarnessResearchManifest, HarnessUserContext, HarnessOptimizationState, HarnessBudgetSnapshot } from './harness-optimization-types.js';

interface Options {
  dataRoot: string; profileId: string; workspaceId: string;
  authorizeUser(context: HarnessUserContext): boolean;
  manifestLookup(id: string): HarnessResearchManifest | undefined;
  now?: () => number;
}
interface CloseOperation {
  intent: HarnessCloseIntent; journalAck: boolean; phase: 'working' | 'closed' | 'failed';
  work: Promise<unknown>; result?: unknown;
}
export async function createHarnessOptimizationRuntime(options: Options) {
  const now = options.now ?? Date.now;
  let lock: ReturnType<typeof acquireHarnessOwnerLock> | undefined;
  let lifecycle: HarnessOptimizationLifecycle | undefined, witness: Awaited<ReturnType<HarnessOptimizationLifecycle['prepare']>>['witness'] | undefined;
  let store: HarnessOptimizationStore | undefined, state: HarnessStoreState | undefined;
  let unavailable = false, reason = 'optimization_unavailable', disposed = false, clockBlocked = false, budgetPending = 0, admissionSeq = 0;
  let disposePromise: Promise<void> | undefined;
  const tickets = new WeakSet<object>();
  const ticketControllers = new Map<string, { ticket: HarnessAttemptTicket; controller: AbortController }>();
  const runs = new Map<string, { manifestId: string; revoked: boolean }>();
  const operations = new Map<string, CloseOperation>();
  const knownSends = new Set<string>();
  const authority = (ctx: HarnessUserContext) => {
    if (!ctx || ctx.requestSource !== 'user' || !options.authorizeUser(ctx)) throw new Error('actor_forbidden');
  };
  const ready = () => { if (disposed || unavailable || !state || !store || !lock?.held()) throw new Error('optimization_unavailable'); };
  const publish = (value: HarnessStoreState) => { validateStoredHarnessConfig(value.config); state = value; clockBlocked ||= value.clockGuard; };
  const scopeMatches = (op: CloseOperation, runId: string) => !op.intent.manifestId || runs.get(runId)?.manifestId === op.intent.manifestId;
  const blocked = (runId?: string) => budgetPending > 0 || [...operations.values()].some(op => op.phase !== 'closed' && (!runId || scopeMatches(op, runId)));
  const checkTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('clock_invalid');
    if (state && value < state.highWaterMark - 2000) {
      clockBlocked = true;
      queueMicrotask(() => { void store?.call('observe_time', { now: value }).catch(() => { unavailable = true; }); });
    }
    if (clockBlocked) throw new Error('clock_rollback');
    return value;
  };
  const manifest = (id: string) => {
    ready();
    return validateRegisteredHarnessManifest(options.manifestLookup(id), {
      ownerId: state!.ownerId, profileId: options.profileId, workspaceId: options.workspaceId,
    }, checkTime());
  };
  try {
    lock = acquireHarnessOwnerLock(options.dataRoot);
    lifecycle = new HarnessOptimizationLifecycle(lock);
    const prepared = await lifecycle.prepare(); witness = prepared.witness;
    store = new HarnessOptimizationStore({ dbPath: lifecycle.dbPath, root: lock.root, identity: lock.identity,
      ownerId: witness.ownerId, initOperationId: witness.initOperationId, initializing: prepared.initializing,
      now: now(), defaultConfig: structuredClone(DEFAULT_HARNESS_OPTIMIZATION_CONFIG) }, () => { unavailable = true; });
    publish(await store.ready);
    await lifecycle.ready(witness);
    for (const intent of await lifecycle.journals()) {
      if (intent.ownerId !== witness.ownerId) throw new Error('journal_owner_mismatch');
      await store.call('revoke', intent); await lifecycle.clearJournal(intent.operationId);
    }
    publish(await store.call<HarnessStoreState>('activate', { dirty: prepared.previousDirty }));
  } catch (error) {
    unavailable = true;
    reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'optimization_unavailable';
    try { await store?.dispose(); } catch {} lock?.release();
  }

  async function startClose(op: CloseOperation) {
    op.phase = 'working';
    op.work = (async () => {
      try {
        if (!op.journalAck) { await lifecycle!.writeJournal(op.intent); op.journalAck = true; }
        const summary = await store!.call('revoke', op.intent);
        publish(await store!.call<HarnessStoreState>('read'));
        await lifecycle!.clearJournal(op.intent.operationId);
        op.phase = 'closed'; op.result = { phase: 'closed', ...summary as object };
        return op.result;
      } catch { op.phase = 'failed'; return { phase: 'close_persistence_failed', operationId: op.intent.operationId }; }
    })();
  }
  async function revoke(input: { scope: 'all' | 'research'; manifestId?: string }, ctx: HarnessUserContext, disable = false): Promise<unknown> {
    authority(ctx); ready();
    if (!input || !['all', 'research'].includes(input.scope) || Object.keys(input).some(k => !['scope', 'manifestId'].includes(k))
      || (input.scope === 'all' && input.manifestId !== undefined)
      || (input.manifestId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.manifestId))) throw new Error('revoke_invalid');
    const key = `${input.scope}:${input.manifestId ?? ''}:${disable}`;
    let op = operations.get(key);
    if (!op || op.phase === 'closed') {
      admissionSeq++;
      const intent: HarnessCloseIntent = { ...input, ownerId: state!.ownerId, ownerEpoch: state!.ownerEpoch, operationId: randomUUID(), disable, knownSends: [...knownSends] };
      op = { intent, journalAck: false, phase: 'working', work: Promise.resolve() }; operations.set(key, op);
      for (const [runId, r] of runs) if (!input.manifestId || r.manifestId === input.manifestId) {
        r.revoked = true;
        for (const value of ticketControllers.values()) if (value.ticket.runId === runId) value.controller.abort();
      }
      void startClose(op);
    } else if (op.phase === 'failed') void startClose(op);
    const active = op;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([active.work, new Promise(resolve => {
        timeout = setTimeout(() => resolve({ phase: active.journalAck ? 'closing_pending' : 'close_persistence_failed', operationId: active.intent.operationId }), 1000);
      })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
  const api = {
    async read(): Promise<HarnessOptimizationState> {
      if (unavailable || disposed || !state) return { status: 'unavailable', publicStatus: 'unavailable', reason };
      return structuredClone({ status: 'ready' as const, publicStatus: 'unavailable' as const,
        ownerId: state.ownerId, ownerEpoch: state.ownerEpoch, config: state.config, recoveryGuard: state.recoveryGuard,
        dispatchBlocked: blocked() || clockBlocked,
        highWaterMark: state.highWaterMark,
        closeOperations: [...operations.values()].map(op => ({ operationId: op.intent.operationId, phase: op.phase, journalAcknowledged: op.journalAck })) });
    },
    async saveConfig(input: unknown, ctx: HarnessUserContext) {
      authority(ctx); ready(); const patch = validateHarnessConfigPatch(input);
      const lower = Object.entries(patch).some(([key, value]) => ['maxExtraRequestTokensPerUtcDay', 'maxExtraRequestsPerUtcDay', 'maxTotalOptimizationTokensPerUtcDay'].includes(key)
        && typeof value === 'number' && value < (state!.config as unknown as Record<string, number>)[key]);
      if (lower) {
        budgetPending++; admissionSeq++;
        for (const r of runs.values()) r.revoked = true;
        for (const value of ticketControllers.values()) value.controller.abort();
      }
      try { publish(await store!.call<HarnessStoreState>('save_config', { patch })); return api.read(); }
      catch (error) { if (lower) unavailable = true; throw error; }
      finally { if (lower) budgetPending--; }
    },
    async setEnabled(enabled: boolean, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (typeof enabled !== 'boolean') throw new Error('invalid_config');
      if (enabled) { if (blocked()) throw new Error('closing_pending'); throw new Error('public_unavailable'); }
      const active = [...operations.values()].find(op => op.intent.disable && op.phase !== 'closed');
      if (!state!.config.enabled && !active) return { noOp: true };
      return revoke({ scope: 'all' }, ctx, true);
    },
    async issueResearchIntent(input: { manifestId: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (blocked()) throw new Error('closing_pending');
      const m = manifest(input.manifestId);
      return store!.call<{ requestId: string }>('intent', { manifest: m, now: checkTime() });
    },
    async startResearch(input: { manifestId: string; requestId: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (blocked()) throw new Error('closing_pending');
      const m = manifest(input.manifestId), seq = admissionSeq;
      const result = await store!.call<{ runId: string }>('start', { manifest: m, requestId: input.requestId, now: checkTime() });
      if (admissionSeq !== seq || blocked()) { await store!.call('cancel_run', result); throw new Error('admission_changed'); }
      runs.set(result.runId, { manifestId: m.id, revoked: false }); return result;
    },
    revoke,
    async resetClockGuard(input: { expectedHighWaterMark: number; correctionEventId?: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (!input || Object.keys(input).some(k => !['expectedHighWaterMark', 'correctionEventId'].includes(k))
        || !Number.isSafeInteger(input.expectedHighWaterMark) || (input.correctionEventId !== undefined && typeof input.correctionEventId !== 'string')) throw new Error('clock_reset_forbidden');
      publish(await store!.call<HarnessStoreState>('reset_clock', { ...input, now: now() })); clockBlocked = false; return api.read();
    },
  };
  const driver = {
    async prepareAttempt(input: { runId: string; stepId: string; bodyHash: string }) {
      ready(); if (blocked(input.runId) || runs.get(input.runId)?.revoked) throw new Error('grant_revoked');
      const ticket = await store!.call<HarnessAttemptTicket>('prepare', { ...input, now: checkTime() });
      if (blocked(input.runId) || runs.get(input.runId)?.revoked) throw new Error('grant_revoked');
      Object.freeze(ticket); tickets.add(ticket); ticketControllers.set(ticket.invocationId, { ticket, controller: new AbortController() }); return ticket;
    },
    async send(ticket: HarnessAttemptTicket, dispatch: (signal: AbortSignal) => unknown) {
      ready(); if (!tickets.has(ticket)) throw new Error('ticket_invalid');
      if (blocked(ticket.runId) || runs.get(ticket.runId)?.revoked) throw new Error('grant_revoked');
      checkTime();
      tickets.delete(ticket);
      publish(await store!.call<HarnessStoreState>('marker', { ticket, now: checkTime() }));
      const control = ticketControllers.get(ticket.invocationId)!;
      // Pure memory compare-and-send. No await or I/O until after dispatch.
      const dispatchTime = checkTime();
      if (dispatchTime > ticket.latestSendAt || new Date(dispatchTime).toISOString().slice(0, 10) !== ticket.utcDay) throw new Error('research_expired');
      if (!lock!.held() || unavailable || disposed || blocked(ticket.runId) || runs.get(ticket.runId)?.revoked
        || control.controller.signal.aborted || ticket.ownerEpoch !== state!.ownerEpoch || ticket.researchGeneration !== state!.config.researchGeneration) throw new Error('grant_revoked');
      knownSends.add(ticket.invocationId);
      const result = dispatch(control.controller.signal);
      void store!.call('send_started', { invocationId: ticket.invocationId }).catch(() => { unavailable = true; });
      return result;
    },
    async settle(input: { invocationId: string; inputTokens: number; outputTokens: number }) {
      ready(); if (![input.inputTokens, input.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) throw new Error('usage_invalid');
      publish(await store!.call<HarnessStoreState>('settle', input));
    },
    async audit() { ready(); return store!.call<{ budget: HarnessBudgetSnapshot; [key: string]: unknown }>('audit'); },
  };
  function dispose(): Promise<void> {
    if (!disposePromise) disposePromise = (async () => {
      disposed = true; admissionSeq++;
      for (const value of ticketControllers.values()) value.controller.abort();
      try {
        await Promise.all([...operations.values()].map(op => op.work));
        await store?.dispose();
        if (!unavailable && [...operations.values()].every(op => op.phase === 'closed') && witness) await lifecycle!.clean(witness);
      } finally { lock?.release(); }
    })();
    return disposePromise;
  }
  return { api, driver, dispose };
}
