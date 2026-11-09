import {withDecisionCleanup} from './decision-model-cleanup.js';
import { DecisionModelMetadata, decisionModelView as asView } from './decision-model-metadata.js';
import { decisionStockMap } from './decision-model-stock.js';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { join, resolve } from 'node:path';
import { types } from 'node:util';
import { DECISION_MODEL_CATALOG } from './decision-model-catalog.js';
import { DecisionModelFiles } from './decision-model-files.js';
import { verifyDecisionFile, downloadDecisionFile } from './decision-model-download.js';
import { startDecisionModelRuntime, settleDecisionModelRuntimes, type DecisionModelRuntime } from './decision-model-runtime.js';
import { encodeDecisionData, parseDecisionData } from './decision-model-data.js';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import type { DecisionModelManifest, DecisionModelSelection, DecisionModelView } from '../shared/decision-model-types.js';
type Source = {
  requestSource: 'user' | 'agent' | 'scheduler';
};
type Root = {
  join: Promise<void>;
};
const NativePromise = Promise, then = Promise.prototype.then, apply = Reflect.apply;
const isProxy = types.isProxy, actorProto = Object.getPrototypeOf, actorRow = Object.getOwnPropertyDescriptor, actorKeys = Reflect.ownKeys, hasOwn = Object.hasOwn, plainProto = Object.prototype;
const QUALITY = 'not-qualified-r12' as const;
const models = parseDecisionData(encodeDecisionData(DECISION_MODEL_CATALOG)) as DecisionModelManifest[];
const services = decisionStockMap<string, DecisionModelService>();
function errorCode(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const row = Object.getOwnPropertyDescriptor(raw, 'message');
    if (row && hasOwn(row, 'value') && typeof row.value === 'string')
      return row.value;
  }
  return 'source_unconfirmed';
}
/** One Main owner; renderer never provides a transport, source namespace, path,
* model manifest, Python command, or alleged physical-close result. */
export class DecisionModelService {
  private readonly files: DecisionModelFiles;
  private readonly metadata: DecisionModelMetadata;
  private readonly events = createRoomTurnCustody();
  private readonly roots = createIntrinsicSet<Root>();
  private readonly listeners = createIntrinsicSet<(views: DecisionModelView[]) => void>();
  private readonly views = new Map<string, DecisionModelView>(models.map(m => [m.id, asView(m)]));
  private initialization?: Promise<void>;
  private closed = false;
  private busy = false;
  private disposeWork?: Promise<void>;
  private failure?: {
    raw: unknown;
  };
  private selected: string | null = null;
  private pythonCommand?: () => string | undefined;
  private job?: {
    id: string;
    controller: AbortController;
    work: Promise<void>;
    failure?: {
      raw: unknown;
    };
  };
  private loading?: {
    id: string;
    controller: AbortController;
    work: Promise<void>;
  };
  private runtime?: {
    id: string;
    handle: DecisionModelRuntime;
  };
  constructor(dataRoot: string) { this.files = new DecisionModelFiles(dataRoot); this.metadata = new DecisionModelMetadata(this.files, models); }
  private user(source: Source, negative = false): void {
    if (source?.requestSource !== 'user')
      throw Error('user_only');
    if (!negative) {
      if (this.closed)
        throw Error('closed');
      if (this.failure)
        throw Error('decision_source_unconfirmed', { cause: this.failure.raw });
    }
  }
  private model(id: string): DecisionModelManifest {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id))
      throw Error('unknown_model');
    const model = models.find(m => m.id === id);
    if (!model)
      throw Error('unknown_model');
    for (const file of model.files)
      if (file.name.split('/').some(p => !p || p === '.' || p === '..' || !/^[a-zA-Z0-9_.-]+$/.test(p)))
        throw Error('unsafe_path');
    return model;
  }
  private track<T>(work: () => Promise<T>): Promise<T> {
    let settle!: () => void;
    const root: Root = { join: new NativePromise<void>(yes => { settle = yes; }) };
    this.roots.add(root);
    return new NativePromise<T>((yes, no) => {
      const end = () => { this.roots.delete(root); settle(); };
      try {
        const raw = work();
        apply(then, raw, [(value: T) => { end(); yes(value); }, (raw: unknown) => { this.files.retain(raw); end(); no(raw); }]);
      }
      catch (raw) {
        this.files.retain(raw);
        end();
        no(raw);
      }
    });
  }
  /** Main-owned sender check; only the fixed synchronous Main actor contract is admitted.
  * The root exists before the check can reenter or throw an original tail. */
  async guardSender(check: (event: unknown) => unknown, event: unknown): Promise<void> {
    if (this.closed)
      throw Error('closed');
    return this.track(async () => {
      let value: unknown;
      try {
        value = check(event);
      }
      catch (raw) {
        this.failure ??= { raw };
        this.files.retain(raw);
        throw raw;
      }
      if (value === null)
        throw Error('unauthorized_sender');
      this.files.retain(value);
      if (value && typeof value === 'object' && isProxy(value)) {
        const raw = Error('decision_sender_contract', { cause: value });
        this.failure ??= { raw };
        throw raw;
      }
      const proto = value && typeof value === 'object' ? actorProto(value) : undefined;
      const row = value && typeof value === 'object' ? actorRow(value, 'actorId') : undefined;
      if (!value || typeof value !== 'object' || proto !== plainProto && proto !== null || actorKeys(value).length !== 1 || !row || !hasOwn(row, 'value') || typeof row.value !== 'string' || !row.value.startsWith('desktop-user:')) {
        const raw = Error('decision_sender_contract', { cause: value });
        this.failure ??= { raw };
        throw raw;
      }
      // The actor comes from Main's captured live window/frame/URL authorizer,
      // never from the transport payload; its shape alone grants no authority.
    });
  }
  retainHostOutcome(raw: unknown): never { this.files.retain(raw); const error = Error('decision_host_contract', { cause: raw }); this.failure ??= { raw: error }; throw error; }
  private snapshot(): DecisionModelView[] { return [...this.views.values()].map(v => ({ ...v, selected: v.id === this.selected, automaticMemoryRerank: QUALITY })); }
  private async emit(): Promise<void> {
    if (this.closed)
      return;
    for (const listener of this.listeners.snapshot()) {
      try {
        await this.events.sdk(listener, undefined, [this.snapshot()]);
      }
      catch (raw) {
        this.failure ??= { raw };
        this.files.retain(raw);
        throw raw;
      }
    }
  }
  subscribe(listener: (views: DecisionModelView[]) => void): () => void {
    if (this.closed)
      throw Error('closed');
    if (typeof listener !== 'function')
      throw Error('decision_listener');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  setPythonCommandResolver(resolver: () => string | undefined): void {
    if (this.closed)
      throw Error('closed');
    if (this.pythonCommand && this.pythonCommand !== resolver)
      throw Error('decision_python_owner');
    this.pythonCommand = resolver;
  }
  private initialize(): Promise<void> {
    if (this.initialization)
      return this.initialization;
    let yes!: () => void, no!: (raw: unknown) => void;
    this.initialization = new NativePromise<void>((ok, bad) => { yes = ok; no = bad; });
    const work = this.track(async () => {
      this.metadata.loadSelection();
      this.selected = this.metadata.selected;
      for (const m of models)
        this.metadata.initializeModel(m, this.views.get(m.id)!);
    });
    apply(then, work, [yes, no]);
    return this.initialization;
  }
  async list(): Promise<DecisionModelView[]> {
    if (this.closed)
      return this.snapshot();
    return this.track(async () => {
      await this.initialize();
      if (this.runtime && !this.runtime.handle.alive()) {
        const view = this.views.get(this.runtime.id)!;
        view.state = 'failed';
        view.reason = 'runtime_failed';
        view.endpoint = null;
        view.runtimePid = null;
      }
      return this.snapshot();
    });
  }
  async download(id: string, source: Source): Promise<void> {
    this.user(source);
    const m = this.model(id);
    if (this.busy || this.job || this.loading)
      throw Error('busy');
    if (!this.views.get(id)!.supported)
      throw Error('unsupported_platform');
    const controller = new AbortController();
    let finish!: () => void;
    // Publish the actual job root before any SDK can synchronously reenter.
    const admitted = new NativePromise<void>(yes => { finish = yes; });
    const job = { id, controller, work: admitted } as NonNullable<DecisionModelService['job']>;
    this.job = job;
    const work = this.track(async () => {
      const view = this.views.get(id)!;
      const timer = setTimeout(() => controller.abort(), 2 * 60 * 60 * 1000);
      await withDecisionCleanup(async () => {
        try {
          await this.initialize();
          controller.signal.throwIfAborted();
          const path = this.metadata.directory(m, true)!;
          const available = this.files.availableBytes();
          view.availableDiskBytes = available <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(available) : null;
          if (available * 100n < BigInt(m.sizeBytes) * 105n)
            throw Error('disk_space');
          view.state = 'downloading';
          view.reason = null;
          view.verified = false;
          view.downloadedBytes = 0;
          await this.emit();
          let done = 0, last = 0;
          for (const file of m.files) {
            controller.signal.throwIfAborted();
            const dest = join(path, ...file.name.split('/'));
            if (!await verifyDecisionFile(dest, file, this.files, controller.signal)) {
              view.currentFile = file.name;
              const part = dest + '.part';
              await downloadDecisionFile(`https://huggingface.co/${m.repo}/resolve/${m.revision}/${file.name}`, part, file, controller.signal, async (bytes) => {
                view.downloadedBytes = done + bytes;
                if (Date.now() - last > 250) {
                  last = Date.now();
                  await this.emit();
                }
              }, this.files);
              controller.signal.throwIfAborted();
              this.files.rename(part, dest);
            }
            done += file.size;
            view.downloadedBytes = done;
            await this.emit();
          }
          controller.signal.throwIfAborted();
          view.state = 'checking';
          await this.emit();
          this.metadata.recordVerified(m, path);
          view.state = 'installed';
          view.verified = true;
          view.currentFile = null;
          await this.emit();
        }
        catch (raw) {
          job.failure = { raw };
          this.files.retain(raw);
          view.state = controller.signal.aborted ? 'interrupted' : 'failed';
          view.reason = controller.signal.aborted ? 'cancelled' : errorCode(raw);
          throw raw;
        }
      }, async () => {
        clearTimeout(timer);
        try {
          await this.files.settle();
        }
        catch (raw) {
          this.failure ??= { raw };
          job.failure ??= { raw };
          view.state = 'failed';
          view.reason = 'source_unconfirmed';
          throw raw;
        }
        finally {
          finish();
          if (!this.failure && this.job === job)
            this.job = undefined;
        }
      });
    });
    // Observe background business failure, retain it on the original job, and
    // keep physical/unknown stocks independently joined by cancel/dispose.
    void work.then(() => undefined, raw => { job.failure ??= { raw }; });
  }
  async cancel(id: string, source: Source): Promise<void> {
    this.user(source, true);
    this.model(id);
    const job = this.job;
    if (!job || job.id !== id)
      return;
    job.controller.abort();
    await job.work;
    await this.files.settle();
    if (job.failure && job.failure.raw !== job.controller.signal.reason && errorCode(job.failure.raw) !== 'AbortError' && errorCode(job.failure.raw) !== 'cancelled' && errorCode(job.failure.raw) !== 'This operation was aborted')
      throw job.failure.raw;
  }
  async start(id: string, approve: boolean, source: Source): Promise<void> {
    this.user(source);
    const m = this.model(id);
    if (!approve)
      throw Error('runtime_approval_required');
    if (!this.views.get(id)!.supported)
      throw Error('unsupported_platform');
    if (this.busy || this.job || this.loading)
      throw Error('busy');
    this.busy = true;
    const controller = new AbortController();
    let finish!: () => void;
    const loading = { id, controller, work: new NativePromise<void>(yes => { finish = yes; }) };
    this.loading = loading;
    return this.track(async () => {
      const view = this.views.get(id)!;
      try {
        await this.initialize();
        controller.signal.throwIfAborted();
        if (this.runtime?.id === id && this.runtime.handle.alive())
          return;
        if (this.runtime)
          await this.stopOwned(this.runtime.id);
        const path = this.metadata.directory(m);
        if (!path)
          throw Error('not_installed');
        view.state = 'checking';
        await this.emit();
        for (const file of m.files)
          if (!await verifyDecisionFile(join(path, ...file.name.split('/')), file, this.files, controller.signal))
            throw Error('hash_mismatch');
        this.metadata.recordVerified(m, path);
        controller.signal.throwIfAborted();
        view.state = 'loading';
        view.reason = null;
        await this.emit();
        const command = this.pythonCommand?.();
        if (!command || typeof command !== 'string')
          throw Error('runtime_missing');
        const handle = await startDecisionModelRuntime(m, path, this.files, controller.signal, command);
        this.runtime = { id, handle };
        if (controller.signal.aborted || this.closed) {
          await handle.stop();
          throw Error('runtime_cancelled');
        }
        view.state = 'ready';
        view.verified = true;
        view.endpoint = handle.endpoint;
        view.runtimePid = handle.pid ?? null;
        view.runtimeInfo = handle.info;
        this.files.atomic(join(path, '.trusted.json'), { revision: m.revision, codeHash: m.codeHash });
        await this.emit();
      }
      catch (raw) {
        this.files.retain(raw);
        view.state = 'failed';
        view.reason = errorCode(raw);
        if (errorCode(raw) === 'hash_mismatch')
          view.verified = false;
        const cleanup: unknown[] = [];
        try {
          await settleDecisionModelRuntimes(this.files);
        }
        catch (error) {
          cleanup.push(error);
        }
        try {
          await this.files.settle();
        }
        catch (error) {
          cleanup.push(error);
        }
        if (cleanup.length) {
          this.failure ??= { raw };
          view.reason = 'source_unconfirmed';
          throw new AggregateError([raw, ...cleanup], 'decision_start_inventory', { cause: raw });
        }
        throw raw;
      }
      finally {
        finish();
        if (this.loading === loading)
          this.loading = undefined;
        this.busy = false;
      }
    });
  }
  private async stopOwned(id: string): Promise<void> {
    const run = this.runtime;
    if (!run || run.id !== id)
      return;
    try {
      await run.handle.stop();
      if (this.runtime === run)
        this.runtime = undefined;
      const view = this.views.get(id)!;
      view.state = 'installed';
      view.endpoint = null;
      view.runtimePid = null;
      await this.emit();
    }
    catch (raw) {
      this.failure ??= { raw };
      this.views.get(id)!.state = 'failed';
      this.views.get(id)!.reason = 'source_unconfirmed';
      throw raw;
    }
  }
  async stop(id: string, source: Source): Promise<void> {
    this.user(source, true);
    this.model(id);
    const loading = this.loading;
    if (loading?.id === id) {
      loading.controller.abort();
      await loading.work;
    }
    await this.stopOwned(id);
    await settleDecisionModelRuntimes(this.files);
  }
  async remove(id: string, source: Source): Promise<void> {
    this.user(source);
    const m = this.model(id);
    if (this.busy)
      throw Error('busy');
    this.busy = true;
    return this.track(async () => {
      try {
        await this.cancel(id, source);
        await this.stop(id, source);
        this.user(source);
        const path = this.metadata.directory(m);
        if (path)
          this.files.removeDirectory(path);
        this.views.set(id, asView(m));
        await this.emit();
      }
      finally {
        this.busy = false;
      }
    });
  }
  async use(id: string, source: Source): Promise<DecisionModelSelection> {
    this.user(source);
    const m = this.model(id);
    return this.track(async () => {
      await this.initialize();
      this.user(source);
      const run = this.runtime;
      if (!run || run.id !== id || !run.handle.alive() || this.views.get(id)!.state !== 'ready')
        throw Error('model_unavailable');
      this.files.ensureRoot();
      this.user(source);
      this.files.atomic(join(this.files.root, 'selection.json'), { version: 1, modelId: id, revision: m.revision });
      this.selected = id;
      await this.emit();
      return { version: 1, modelId: id, revision: m.revision, automaticMemoryRerank: QUALITY };
    });
  }
  beginShutdown(): void { this.closed = true; this.files.sealEffects(); this.job?.controller.abort(); this.loading?.controller.abort(); }
  dispose(): Promise<void> {
    if (this.disposeWork)
      return this.disposeWork;
    this.beginShutdown();
    this.disposeWork = (async () => {
      const errors: unknown[] = [], negative: Promise<void>[] = [];
      // Start independent negative controls before joining any admitted read/work.
      // The second fixed inventory cut covers a previously entered SDK birth.
      if (this.runtime)
        negative.push(this.stopOwned(this.runtime.id));
      negative.push(settleDecisionModelRuntimes(this.files));
      const observed = negative.map(work => work.then(() => undefined, raw => { errors.push(raw); }));
      while (this.roots.size) {
        const cut = this.roots.snapshot();
        await NativePromise.all(cut.map(row => row.join));
      }
      await NativePromise.all(observed);
      try {
        await settleDecisionModelRuntimes(this.files);
      }
      catch (raw) {
        errors.push(raw);
      }
      try {
        await this.files.settle();
      }
      catch (raw) {
        errors.push(raw);
      }
      try {
        await this.events.waitPhysicalKnown();
      }
      catch (raw) {
        errors.push(raw);
      }
      if (this.failure)
        errors.unshift(this.failure.raw);
      if (errors.length)
        throw new AggregateError(errors, 'decision_manager_close_unconfirmed', { cause: errors[0] });
      this.runtime = undefined;
      for (const listener of this.listeners.snapshot())
        this.listeners.delete(listener);
    })();
    return this.disposeWork;
  }
}
export function getDecisionModelService(dataRoot: string): DecisionModelService {
  const key = resolve(dataRoot);
  let service = services.get(key);
  if (!service) {
    service = new DecisionModelService(key);
    services.set(key, service);
  }
  return service;
}
