import process from 'node:process';
import { expect, inject, type TestContext } from 'vitest';
import { mkdtempSync, realpathSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import type { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import type { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { createDesktopServices } from '../../electron/desktop-services.js';

export type Box<T> = { ok: true; value: T } | { ok: false; error: unknown };
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
export const turn = () => new Promise<void>(yes => setImmediate(yes));

// A unique helper-module instance key, never Symbol.for. The actual worker's
// native process remains a strong root even if Vitest clears this module cache.
const retainedOwners: RootUsageOwner[] = [];
// The same process-anchored registry also holds lifecycle callbacks before an
// owner may be allocated, including the hook-registration-failure path.
const retainedLifecycles: Array<Record<string, unknown>> = [];
Object.defineProperty(retainedOwners, Symbol('root-usage-lifecycles'), {
  value: retainedLifecycles, enumerable: false, configurable: false, writable: false,
});
const anchor = Symbol('root-usage-ownership-worker-lifetime');
Object.defineProperty(process, anchor, { value: retainedOwners, enumerable: false, configurable: false, writable: false });
const descriptor = Object.getOwnPropertyDescriptor(process, anchor)!;
expect(descriptor.value).toBe(retainedOwners);
expect([descriptor.enumerable, descriptor.configurable, descriptor.writable]).toEqual([false, false, false]);

function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message, { cause: failures[0] });
}

type Services = ReturnType<typeof createDesktopServices>;
type Watched = { raw: Promise<unknown>; outcome: Promise<Box<unknown>>; result?: Box<unknown>; accepted?: unknown; names: string[] };
type Store = { close(): unknown; db?: DatabaseSync };
export class RootUsageOwner {
  readonly references = new Map<string, unknown>();
  readonly promises = new Map<Promise<unknown>, Watched>();
  readonly cleanupErrors: unknown[] = [];
  readonly rescues: Array<() => void> = [];
  readonly restores: Array<() => void> = [];
  readonly native = new Map<DatabaseSync, () => boolean>();
  readonly root!: string;
  readonly identity!: { root: string; nonce: string; runToken: string; runTokenSource: 'explicit-parent-env' | 'profile-account-global'; workerPid: number; workerPpid: number; uid: number; dev: number; ino: number; birthtimeMs: number };
  readonly registryIndex: number;
  readonly goals: Store[] = [];
  readonly artifacts: Store[] = [];
  service?: DesktopMultiAgentService;
  store?: DesktopMultiAgentStore;
  coordinator?: DesktopExecutionCoordinator;
  host?: InProcessTaskRuntimeHost;
  materials?: MaterialRegistry;
  services?: Services;
  memory?: { close?(): unknown; db?: { open: boolean } };
  private disposal?: Promise<void>;
  private finishPromise?: Promise<void>;
  private expectedRetention?: { root: Promise<unknown>; error: unknown };
  private body?: { error: unknown };

  constructor(readonly kind: 'factory' | 'nullable') {
    const supplied = [process.env.XIAOK_USAGE_ADMISSION_RUN_TOKEN,
      process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN, process.env.XIAOK_ADMITTED_USAGE_RUN_NONCE];
    let token: string;
    let runTokenSource: 'explicit-parent-env' | 'profile-account-global';
    if (supplied.some(value => value !== undefined)) {
      if (!supplied.every(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && value === supplied[0]))
        throw Error('root_usage_run_token_missing_or_different');
      token = supplied[0]!; runTokenSource = 'explicit-parent-env';
    } else {
      // Default Vitest already owns this run's account root and nonce. Reuse its
      // actual provided metadata, never generate a second token or set env.
      const ownership = inject('profileTestAccountOwnership' as never) as unknown;
      if (!ownership || typeof ownership !== 'object') throw Error('root_usage_profile_account_run_token_missing');
      const descriptor = Object.getOwnPropertyDescriptor(ownership, 'runNonce');
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string'
        || !/^[a-f0-9]{32}$/.test(descriptor.value)) throw Error('root_usage_profile_account_run_token_missing');
      token = descriptor.value; runTokenSource = 'profile-account-global';
      this.keep('providedProfileAccountOwnership', ownership);
    }
    this.keep('runTokenProvenance', { token, runTokenSource });
    this.registryIndex = retainedOwners.length; retainedOwners.push(this);
    this.references.set('owner', this); this.references.set('registry', retainedOwners);
    const nonce = randomUUID(); this.references.set('allocationNonce', nonce);
    let allocated: string | undefined;
    try {
      allocated = mkdtempSync(join(tmpdir(), 'desktop-root-usage-')); this.references.set('allocatedRoot', allocated);
      this.root = realpathSync(allocated); const st = lstatSync(this.root);
      this.identity = { root: this.root, nonce, runToken: token, runTokenSource, workerPid: process.pid, workerPpid: process.ppid,
        uid: st.uid, dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs };
      this.keep('identity', this.identity); this.record('CREATED');
    } catch (error) {
      this.keep('partialAllocationFailure', { error });
      try { console.info('XIAOK_ROOT_USAGE_PARTIAL ' + JSON.stringify({ root: allocated, nonce, runToken: token, runTokenSource,
        workerPid: process.pid, workerPpid: process.ppid, registryIndex: this.registryIndex, registered: true, unknownRetained: true })); }
      catch (diagnostic) { throw new AggregateError([error, diagnostic], 'root_usage_partial_and_diagnostic_failed', { cause: error }); }
      throw error;
    }
  }
  keep<T>(name: string, value: T): T { this.references.set(name, value); return value; }
  watch<T>(name: string, raw: Promise<T>): Promise<T> {
    let known = this.promises.get(raw);
    if (known) known.names.push(name);
    else {
      known = { raw, outcome: undefined!, names: [name] };
      const record = known;
      record.outcome = raw.then(value => record.result = { ok: true, value }, error => record.result = { ok: false, error });
      this.promises.set(raw, record); this.keep(`promise:${name}`, record);
    }
    return raw;
  }
  result<T>(raw: Promise<T>): Box<T> | undefined { return this.promises.get(raw)?.result as Box<T> | undefined; }
  async outcome<T>(raw: Promise<T>): Promise<Box<T>> {
    const known = this.promises.get(raw); if (!known) throw Error('root_usage_unregistered_original_promise');
    return known.outcome as Promise<Box<T>>;
  }
  acceptRejection(raw: Promise<unknown>, original: unknown): void {
    const known = this.promises.get(raw);
    expect(known?.result?.ok).toBe(false);
    if (!known || !known.result || known.result.ok) throw Error('root_usage_rejection_not_observed');
    expect(known.result.error).toBe(original); known.accepted = { error: original };
  }
  retainVerifiedRoot(raw: Promise<unknown>, original: unknown): void {
    this.acceptRejection(raw, original);
    expect(this.coordinator!.snapshot().active).toBe(0);
    this.expectedRetention = { root: raw, error: original };
    this.keep('verifiedRetainedRoot', this.expectedRetention);
  }
  captureNative(db: DatabaseSync): void {
    if (this.native.has(db)) return;
    const d = Object.getOwnPropertyDescriptor(db, 'isOpen'), get = d?.get;
    if (d?.configurable !== false || typeof get !== 'function') throw Error('root_usage_native_receipt_missing');
    this.native.set(db, () => {
      const value: unknown = Reflect.apply(get, db, []);
      if (typeof value !== 'boolean') throw Error('root_usage_native_receipt_invalid');
      return value;
    });
    this.keep(`native:${this.native.size}`, db);
  }
  nativeOpen(db: DatabaseSync): boolean { const read = this.native.get(db); if (!read) throw Error('root_usage_native_unobserved'); return read(); }
  attachStore(store: DesktopMultiAgentStore): void {
    this.store = this.keep('store', store);
    this.captureNative((store as unknown as { db: DatabaseSync }).db);
  }
  originalDispose(): Promise<void> {
    if (!this.disposal) {
      const raw = this.services ? this.services.disposeMultiAgent() : this.service!.dispose();
      this.disposal = this.watch('originalDisposal', raw);
    }
    return this.disposal;
  }
  private async attempt(action: () => unknown | Promise<unknown>): Promise<void> {
    try { await action(); } catch (error) { this.cleanupErrors.push(error); }
  }
  private record(kind: string, extra: Record<string, unknown> = {}): void {
    const d = Object.getOwnPropertyDescriptor(process, anchor);
    expect(d?.value).toBe(retainedOwners); expect(retainedOwners[this.registryIndex]).toBe(this);
    console.info(`XIAOK_ROOT_USAGE_${kind} ` + JSON.stringify({ ...this.identity, registered: true,
      registryIndex: this.registryIndex, registrySize: retainedOwners.length, referenceCount: this.references.size, ...extra }));
  }
  stop(): void {
    for (const release of this.rescues) { try { release(); } catch (error) { this.cleanupErrors.push(error); } }
    try { this.host?.stopAccepting('root_usage_fixture_end'); } catch (error) { this.cleanupErrors.push(error); }
    try { this.host?.abortAllActive('app_shutdown'); } catch (error) { this.cleanupErrors.push(error); }
  }
  finish(body?: { error: unknown }): Promise<void> {
    if (this.finishPromise) return this.finishPromise;
    this.body = body;
    this.finishPromise = (async () => {
      this.stop();
      if (this.host) await this.attempt(() => this.watch('cleanupHostDrain', this.host!.drain()));
      if (this.service) await this.attempt(() => this.originalDispose());
      for (const known of this.promises.values()) {
        const result = await known.outcome;
        if (!result.ok && !(known.accepted && (known.accepted as { error: unknown }).error === result.error)) this.cleanupErrors.push(result.error);
      }
      // Retention is a narrow, explicitly checked original root failure. An
      // independent disposal/observer/body failure still makes the case red.
      let healthy = !body && this.cleanupErrors.length === 0 && !this.expectedRetention;
      if (healthy) {
        await this.attempt(() => { expect(this.coordinator!.snapshot().active).toBe(0); expect(this.service!.runtimeStatus().blocked).toBe(false); });
        if (this.cleanupErrors.length === 0) {
          if (this.services) {
            await this.attempt(() => this.services!.closeTaskSourceWritersForMigration());
            await this.attempt(() => this.services!.closeMaterialRegistryAndArtifactFileManagerInstances());
            await this.attempt(() => this.services!.sealAndDrainArtifactWorkspaceServiceInstance());
            await this.attempt(async () => { expect(await this.services!.goalShutdown.ingress.drain(0)).toBe(true); });
          } else {
            await this.attempt(() => this.materials!.sealAndDrainInstanceMutations());
            await this.attempt(() => this.host!.closeSourceWriterForMigration());
          }
        }
        // Failed drains retain journals. Only a full gate authorizes the
        // independent durable closers; once admitted, each close is attempted.
        if (this.cleanupErrors.length === 0) await this.attempt(() => {
          expect(this.coordinator!.snapshot().active).toBe(0); expect(this.service!.runtimeStatus().blocked).toBe(false);
          if (this.services) { expect(this.goals).toHaveLength(1); expect(this.artifacts).toHaveLength(1); }
        });
        if (this.cleanupErrors.length === 0) {
          if (this.services) {
            await this.attempt(() => this.services!.goalShutdown.durable.close());
            await this.attempt(() => this.artifacts[0].close());
            await this.attempt(() => this.services!.getKnowledgeBaseStore().close());
            await this.attempt(async () => {
              if (!this.memory?.close) throw Error('root_usage_memory_owner_missing'); await this.memory.close();
              if (this.memory.db) expect(this.memory.db.open).toBe(false);
            });
          }
          await this.attempt(() => this.store!.close());
          await this.attempt(() => { expect(this.native.size).toBeGreaterThan(0); });
          for (const isOpen of this.native.values()) await this.attempt(() => { expect(isOpen()).toBe(false); });
        }
        healthy = this.cleanupErrors.length === 0;
      }
      if (healthy) {
        for (let n = this.restores.length - 1; n >= 0; n--) await this.attempt(this.restores[n]);
        healthy = this.cleanupErrors.length === 0;
      }
      if (healthy) await this.attempt(() => {
        const st = lstatSync(this.root); expect(st.isSymbolicLink()).toBe(false); expect(realpathSync(this.root)).toBe(this.root);
        expect([st.uid, st.dev, st.ino, st.birthtimeMs]).toEqual([this.identity.uid, this.identity.dev, this.identity.ino, this.identity.birthtimeMs]);
        rmSync(this.root, { recursive: true, force: false }); expect(existsSync(this.root)).toBe(false);
        this.record('DELETED', { nativeClosed: true });
      });
      if (!healthy || this.cleanupErrors.length) await this.attempt(() => this.record('RETAINED', {
        expectedRootFailureVerified: Boolean(this.expectedRetention), nativeOpen: [...this.native.values()].map(read => read()),
      }));
      throwFailures([...(body ? [body.error] : []), ...this.cleanupErrors], 'root_usage_body_and_cleanup_failed');
    })();
    this.keep('finish', this.finishPromise); return this.finishPromise;
  }
}

export function withRootUsageOwner(ctx: TestContext, kind: 'factory' | 'nullable', work: (owner: RootUsageOwner) => Promise<void>): Promise<void> {
  const lifecycle: Record<string, unknown> = { ctx, work };
  retainedLifecycles.push(lifecycle);
  let hookFailure: { error: unknown } | undefined;
  const scenario = (async () => {
    // Hook registration below completes synchronously before any owner/root,
    // production constructor, work prefix or signal listener is allocated.
    await Promise.resolve();
    if (hookFailure) throw hookFailure.error;
    const owner = new RootUsageOwner(kind); lifecycle.owner = owner;
    owner.keep('lifecycle', lifecycle); owner.keep('testContext', ctx); owner.keep('work', work);
    let signal: AbortSignal | undefined;
    const stop = () => owner.stop();
    const abort = () => { try { stop(); } catch (error) { owner.cleanupErrors.push(error); } };
    lifecycle.stop = stop; lifecycle.abort = abort;
    owner.keep('stopCallback', stop); owner.keep('abortCallback', abort);
    let failure: { error: unknown } | undefined;
    try {
      signal = ctx.signal; lifecycle.signal = signal;
      signal.addEventListener('abort', abort, { once: true });
      signal.throwIfAborted(); await work(owner);
    } catch (error) { failure = { error }; }
    const finish = () => owner.finish(failure);
    lifecycle.finish = finish; owner.keep('finishCallback', finish);
    const failures: unknown[] = [];
    try { await finish(); } catch (error) { failures.push(error); }
    const cleanupCountBeforeRemoval = owner.cleanupErrors.length;
    // Removal can throw or synchronously run our stop callback: retain each
    // resulting original value independently of the original finish outcome.
    let removalFailure: { error: unknown } | undefined;
    if (signal) {
      try { signal.removeEventListener('abort', abort); }
      catch (error) { removalFailure = { error }; }
    }
    for (let n = cleanupCountBeforeRemoval; n < owner.cleanupErrors.length; n++) failures.push(owner.cleanupErrors[n]);
    if (removalFailure) failures.push(removalFailure.error);
    if (signal?.aborted) {
      const reason = signal.reason;
      if (!failures.some(error => error === reason)) failures.push(reason);
    }
    lifecycle.finalFailures = failures;
    throwFailures(failures, 'root_usage_finish_listener_or_abort_failed');
  })();
  lifecycle.scenario = scenario;
  const finished = () => scenario;
  lifecycle.finished = finished;
  try { ctx.onTestFinished(finished); }
  catch (error) { hookFailure = { error }; lifecycle.hookFailure = hookFailure; }
  return scenario;
}
