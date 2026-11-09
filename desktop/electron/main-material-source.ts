import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { types } from 'node:util';
import { resolve } from 'node:path';
import {
  createRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
import {
  createIntrinsicSet,
  settleIntrinsicOperations,
} from '../../src/runtime/verification/intrinsic-async-collection.js';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import { readCurrentOriginalRootExecutionContext } from '../../src/runtime/verification/original-root-execution-context.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { readCurrentOriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import {
  readOriginalMainDshControlSourceBinding,
  readOriginalMainMaterialEvent,
  type MainMaterialEventView,
} from './main-dsh-control-source.js';
import {
  readOriginalKnowledgeSourceReceipt,
  type OriginalKnowledgeSourceReceipt,
} from './kb-store-sqlite.js';
import { readOriginalKnowledgeExtractorBinding } from './kb-source-extractor.js';
import type { SourceExtractionResult } from './kb-store.js';
const apply = Reflect.apply,
  get = WeakMap.prototype.get,
  set = WeakMap.prototype.set,
  descriptor = Object.getOwnPropertyDescriptor,
  keys = Reflect.ownKeys,
  own = Object.hasOwn;
const freeze = Object.freeze,
  create = Object.create,
  define = Object.defineProperty,
  NativePromise = Promise,
  then = Promise.prototype.then;
const isProxy = types.isProxy,
  isPromise = types.isPromise,
  buffer = Buffer.isBuffer,
  originalReadFile = readFile;
const scope = new AsyncLocalStorage<object>(),
  scopeGet = AsyncLocalStorage.prototype.getStore,
  scopeRun = AsyncLocalStorage.prototype.run;
const sources = new WeakMap<object, SourceRow>(),
  requests = new WeakMap<object, RequestRow>();
const births = new WeakMap<object, WeakMap<object, Promise<object>>>();
const retainedFailures = createIntrinsicSet<object>();
interface ServicesBinding {
  storageScope: Readonly<{ profileId: string; workspaceId: string }>;
  principalId: string;
  parseOfficeDocument: Function;
}
interface SourceRow {
  userSource: object;
  services: object;
  binding: ServicesBinding;
  custody: RoomTurnCustody;
  active: ReturnType<typeof createIntrinsicSet<RequestRow>>;
  used: WeakMap<
    object,
    {
      receipt: unknown;
      extractor: unknown;
      promise: Promise<SourceExtractionResult>;
    }
  >;
  closed: boolean;
  physicalUnconfirmed: boolean;
}
interface RequestRow {
  owner: SourceRow;
  frame: MainMaterialEventView;
  receipt: OriginalKnowledgeSourceReceipt;
  token: object;
  active: boolean;
  custody: RoomTurnCustody;
  executionRef: string;
}
export interface OriginalMainMaterialContext {
  readonly kind: 'original_main_material_context_v1';
  readonly executionClass: 'material_turn';
  readonly executionRef: string;
  readonly source: object;
  readonly services: object;
  readonly scope: Readonly<{
    profileId: string;
    workspaceId: string;
    principalId: string;
  }>;
  readonly parentRef: null;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  assertLocal(): void;
}
function denied(): Error {
  return Error('MAIN_MATERIAL_ORIGINAL_SOURCE_REQUIRED');
}
function sourceRow(value: unknown): SourceRow {
  const row = apply(get, sources, [value]) as SourceRow | undefined;
  if (!row) throw denied();
  return row;
}
function local(row: RequestRow): void {
  if (!row.active || row.owner.closed || row.owner.physicalUnconfirmed)
    throw denied();
  row.frame.assertLocal();
  row.receipt.assertLocal();
  row.custody.local();
}
function current(row: RequestRow): void {
  local(row);
  row.custody.syncVoid(row.frame.assertCurrent, undefined, []);
  row.custody.syncVoid(row.receipt.assertCurrent, undefined, []);
  local(row);
}
const consumeExports = () => {};
async function loadServicesReader(
  custody: RoomTurnCustody,
): Promise<(services: unknown, source: unknown) => ServicesBinding> {
  const held = create(null) as Record<string, unknown>;
  const raw = import('./desktop-services.js');
  define(held, 'raw', { __proto__: null, value: raw } as PropertyDescriptor);
  function children() {
    let malformed = false;
    const names = keys(raw);
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!,
        d = descriptor(raw, name);
      if (
        name === 'constructor' &&
        d &&
        own(d, 'value') &&
        d.value === NativePromise
      )
        continue;
      if (!d || !own(d, 'value')) {
        malformed = true;
        continue;
      }
      custody.inventory(d.value);
    }
    if (malformed) {
      custody.inventory(raw);
      throw denied();
    }
  }
  // Stock every visible child before a constructor/species precondition can
  // reject the import. Rejecting its shape must not abandon a known sibling.
  children();
  assertStandardIpcPromise(raw, 'MAIN_MATERIAL_IMPORT_UNCONFIRMED');
  const namespace = await new NativePromise<
    typeof import('./desktop-services.js')
  >((yes, no) => {
    const observer = apply(then, raw, [
      (value: typeof import('./desktop-services.js')) => {
        define(held, 'namespace', {
          __proto__: null,
          value,
        } as PropertyDescriptor);
        try {
          children();
          yes(value);
        } catch (error) {
          custody.inventory(error);
          no(error);
        }
      },
      (error: unknown) => {
        custody.inventory(error);
        try {
          children();
        } catch (other) {
          custody.inventory(other);
        }
        no(error);
      },
    ]);
    define(held, 'observer', {
      __proto__: null,
      value: observer,
    } as PropertyDescriptor);
    custody.inventory(observer);
  });
  if (!namespace || isProxy(namespace)) throw denied();
  const entry = descriptor(
    namespace,
    'readOriginalMainMaterialServicesBinding',
  );
  if (!entry) throw denied();
  // This one package-literal export is trusted module code, not a caller namespace.
  // esbuild's fixed shell uses a getter; own/symbol data on its function is stocked.
  const shell = await custody.sdk<object>(
    () => {
      const fn = own(entry, 'value')
        ? entry.value
        : typeof entry.get === 'function' && !isProxy(entry.get)
          ? apply(entry.get, namespace, [])
          : undefined;
      if (typeof fn !== 'function' || isProxy(fn)) throw denied();
      const out = create(null);
      define(out, 'value', {
        __proto__: null,
        value: fn,
      } as PropertyDescriptor);
      return out;
    },
    undefined,
    [],
    {
      accept: (value) =>
        !!value && typeof value === 'object' && !isProxy(value),
      consumer: consumeExports,
    },
  );
  const fn = (
    shell as { value: (services: unknown, source: unknown) => ServicesBinding }
  ).value;
  await custody.consumeResource(consumeExports, shell, []);
  return fn;
}
/** Passive identity construction; no event, path, callback or verifier can grant P. */
export function createMainMaterialSource(options: {
  userSource: object;
  services: object;
}): Promise<object> {
  if (!options || isProxy(options)) throw denied();
  const sourceSlot = descriptor(options, 'userSource'),
    servicesSlot = descriptor(options, 'services');
  if (
    keys(options).length !== 2 ||
    !sourceSlot ||
    !servicesSlot ||
    !own(sourceSlot, 'value') ||
    !own(servicesSlot, 'value') ||
    !servicesSlot.value ||
    typeof servicesSlot.value !== 'object' ||
    isProxy(servicesSlot.value)
  )
    throw denied();
  const original = readOriginalMainDshControlSourceBinding(sourceSlot.value);
  original.assertLocal();
  let byService = apply(get, births, [sourceSlot.value]) as
    | WeakMap<object, Promise<object>>
    | undefined;
  if (!byService) {
    byService = new WeakMap();
    apply(set, births, [sourceSlot.value, byService]);
  }
  const previous = apply(get, byService, [servicesSlot.value]) as
    | Promise<object>
    | undefined;
  if (previous) return previous;
  let accept!: (source: object) => void, reject!: (error: unknown) => void;
  const completion = new NativePromise<object>((yes, no) => {
    accept = yes;
    reject = no;
  });
  // One original birth per exact pair, including pending or failed births.
  // The slot exists before the fixed import or Services callback can reenter.
  apply(set, byService, [servicesSlot.value, completion]);
  const custody = createRoomTurnCustody(),
    held = { custody, options };
  void (async () => {
    try {
      const reader = await loadServicesReader(custody);
      const binding = await custody.sdk<ServicesBinding>(
        reader,
        undefined,
        [servicesSlot.value, sourceSlot.value],
        {
          accept: (value) =>
            !!value && typeof value === 'object' && !isProxy(value),
          consumer: consumeExports,
        },
      );
      original.assertLocal();
      if (
        binding.storageScope.profileId !== original.storageScope.profileId ||
        binding.storageScope.workspaceId !==
          original.storageScope.workspaceId ||
        binding.principalId !== original.principalId
      )
        throw denied();
      await custody.consumeResource(consumeExports, binding, []);
      await custody.waitPhysicalKnown();
      const source = freeze(create(null));
      apply(set, sources, [
        source,
        {
          userSource: sourceSlot.value,
          services: servicesSlot.value,
          binding,
          custody,
          active: createIntrinsicSet<RequestRow>(),
          used: new WeakMap(),
          closed: false,
          physicalUnconfirmed: false,
        },
      ]);
      accept(source);
    } catch (error) {
      custody.inventory(error);
      retainedFailures.add(held);
      try {
        await custody.waitPhysicalKnown();
      } catch {}
      reject(error);
    }
  })();
  return completion;
}
export function readOriginalMainMaterialSourceBinding(
  source: unknown,
  services: unknown,
): Readonly<{
  storageScope: ServicesBinding['storageScope'];
  principalId: string;
}> {
  const row = sourceRow(source);
  if (row.services !== services || row.closed || row.physicalUnconfirmed)
    throw denied();
  row.custody.local();
  return freeze({
    storageScope: row.binding.storageScope,
    principalId: row.binding.principalId,
  });
}
/** No public callback dispatch: only this original extractor's captured method. */
export function dispatchSourceExtract(
  source: unknown,
  proof: unknown,
  store: unknown,
  receipt: unknown,
  extractor: unknown,
): Promise<SourceExtractionResult> {
  const owner = sourceRow(source);
  if (owner.closed || owner.physicalUnconfirmed) throw denied();
  owner.custody.local();
  const frame = readOriginalMainMaterialEvent(owner.userSource, proof);
  const original = readOriginalKnowledgeSourceReceipt(
    store,
    receipt,
    frame.knowledgeDatabasePath,
  );
  const extraction = readOriginalKnowledgeExtractorBinding(extractor);
  if (
    extraction.officeParse !== owner.binding.parseOfficeDocument ||
    original.requestSource !== 'user' ||
    original.source.kind !== 'file' ||
    original.source.parseStatus !== 'pending' ||
    original.source.collectionId !== frame.body.input.collectionId ||
    original.source.title !== frame.body.input.title ||
    resolve(original.source.rawPath) !== resolve(frame.body.input.filePath) ||
    frame.storageScope.profileId !== owner.binding.storageScope.profileId ||
    frame.storageScope.workspaceId !== owner.binding.storageScope.workspaceId ||
    frame.principalId !== owner.binding.principalId
  )
    throw denied();
  const prior = apply(get, owner.used, [proof]) as
    | {
        receipt: unknown;
        extractor: unknown;
        promise: Promise<SourceExtractionResult>;
      }
    | undefined;
  if (prior) {
    if (prior.receipt !== receipt || prior.extractor !== extractor)
      throw denied();
    return prior.promise;
  }
  const token = freeze(create(null)),
    custody = createRoomTurnCustody();
  const row: RequestRow = {
    owner,
    frame,
    receipt: original,
    token,
    active: true,
    custody,
    executionRef: 'material:' + original.source.id + ':' + frame.bodyHash,
  };
  apply(set, requests, [token, row]);
  owner.active.add(row);
  let resolveResult!: (result: SourceExtractionResult) => void,
    rejectResult!: (error: unknown) => void;
  const outward = new NativePromise<SourceExtractionResult>((yes, no) => {
    resolveResult = yes;
    rejectResult = no;
  });
  // Reserve the exact request before any Source/SDK can synchronously reenter.
  // Every replay returns this same physical-joining completion, never the short
  // extractor result alone.
  apply(set, owner.used, [proof, { receipt, extractor, promise: outward }]);
  const operation = custody.root<SourceExtractionResult>(async () => {
    current(row);
    return custody.sdk<SourceExtractionResult>(
      () =>
        apply(scopeRun, scope, [
          token,
          () =>
            custody.sdk<SourceExtractionResult>(extraction.extract, extractor, [
              {
                filePath: original.source.rawPath,
                mimeType:
                  typeof frame.body.input.mimeType === 'string'
                    ? frame.body.input.mimeType
                    : 'application/octet-stream',
              },
            ]),
        ]),
      undefined,
      [],
    );
  });
  void (async () => {
    let result: SourceExtractionResult | undefined,
      failure: { error: unknown } | undefined;
    try {
      result = await operation;
      current(row);
    } catch (error) {
      failure = { error };
      custody.inventory(error);
    }
    try {
      await custody.waitPhysicalKnown();
    } catch (error) {
      failure ??= { error };
      owner.physicalUnconfirmed = true;
      // Physical unknown remains owned even after the caller releases its
      // frame. A new proof/factory call cannot replace this original stock.
      retainedFailures.add(row);
    }
    row.active = false;
    owner.active.delete(row);
    if (failure) rejectResult(failure.error);
    else resolveResult(result!);
  })();
  return outward;
}
/** Inherited contexts are verified again by the original Native Owner, never DTOs. */
export function captureOriginalMaterialExecutionParent(): object | null {
  const token = apply(scopeGet, scope, []) as object | undefined;
  if (token) {
    const row = apply(get, requests, [token]) as RequestRow | undefined;
    if (!row) throw denied();
    current(row);
    return token;
  }
  return (
    readCurrentOriginalTaskRunnerResourceContext() ??
    readCurrentOriginalRootExecutionContext()
  );
}
/** A signal is cancellation data, never an authority or a replacement context. */
export function readOptionalOriginalMaterialExecutionSignal(
  context: unknown,
): AbortSignal | null {
  const row = apply(get, requests, [context]) as RequestRow | undefined;
  return row?.frame.signal ?? null;
}
/** Pure membership-based lifetime, not a creator or an effect permission. */
export function readOptionalOriginalMaterialExecutionLifetime(
  context: unknown,
): Readonly<{
  signal: AbortSignal;
  assertCurrent(): void;
  assertLocal(): void;
}> | null {
  const row = apply(get, requests, [context]) as RequestRow | undefined;
  if (!row) return null;
  return freeze({
    signal: row.frame.signal,
    assertCurrent: () => current(row),
    assertLocal: () => local(row),
  });
}
export function readOriginalMainMaterialOperationContext(
  context: unknown,
  source: unknown,
  services: unknown,
): OriginalMainMaterialContext | null {
  const row = apply(get, requests, [context]) as RequestRow | undefined;
  if (!row) return null;
  if (row.owner !== sourceRow(source) || row.owner.services !== services)
    throw denied();
  local(row);
  return freeze({
    kind: 'original_main_material_context_v1',
    executionClass: 'material_turn',
    executionRef: row.executionRef,
    source: source as object,
    services: services as object,
    scope: freeze({
      ...row.owner.binding.storageScope,
      principalId: row.owner.binding.principalId,
    }),
    parentRef: null,
    signal: row.frame.signal,
    assertCurrent: () => current(row),
    assertLocal: () => local(row),
  });
}
/** The original extractor alone uses this fixed file producer within its frame. */
export async function readOriginalMaterialSourceBytes(
  path: string,
): Promise<Buffer> {
  const token = apply(scopeGet, scope, []) as object | undefined;
  if (!token) {
    // The original Host reader checks private runner birth and current local
    // membership. A bare Root ALS carrier is not a KB restoration authority.
    if (
      hasOriginalMainSdkBridgeInstallation() &&
      !readCurrentOriginalTaskRunnerResourceContext()
    )
      throw Error('MATERIAL_PENDING_RECOVERY_AUTHORITY_REQUIRED');
    return originalReadFile(path);
  }
  const row = apply(get, requests, [token]) as RequestRow | undefined;
  if (!row || resolve(path) !== resolve(row.receipt.source.rawPath))
    throw denied();
  current(row);
  const consume = () => {};
  const value = await row.custody.sdk<Buffer>(
    originalReadFile,
    undefined,
    [path],
    {
      accept: (raw) =>
        !!raw && typeof raw === 'object' && !isProxy(raw) && buffer(raw),
      consumer: consume,
    },
  );
  current(row);
  await row.custody.consumeResource(consume, value, []);
  return value;
}
/** Preserve a caught original file/decoder outcome before making a UI result. */
export function retainOriginalMaterialSourceFailure(error: unknown): void {
  const token = apply(scopeGet, scope, []) as object | undefined;
  if (!token) return;
  const row = apply(get, requests, [token]) as RequestRow | undefined;
  if (!row) throw denied();
  row.custody.inventory(error);
}
export async function sealAndDrainMainMaterialSource(
  source: unknown,
): Promise<void> {
  const row = sourceRow(source);
  row.closed = true;
  const result = await settleIntrinsicOperations(
    row.active.snapshot(),
    (value) => value.custody.waitPhysicalKnown(),
  );
  for (let i = 0; i < result.length; i++)
    if (result[i]!.status === 'rejected')
      throw (result[i] as PromiseRejectedResult).reason;
  await row.custody.waitPhysicalKnown();
  if (row.physicalUnconfirmed)
    throw Error('MAIN_MATERIAL_PHYSICAL_UNCONFIRMED');
}
