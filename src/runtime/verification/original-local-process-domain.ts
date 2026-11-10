import { createRequire } from 'node:module';
import { fileURLToPath, URL as NativeURL } from 'node:url';
import { types } from 'node:util';
import {
  createRoomTurnCustody,
  type RoomTurnCustody,
} from './original-sdk-custody.js';
import { loadOriginalProcessSdk } from './original-process-sdk-loader.js';
import {
  appendIntrinsic,
  createIntrinsicSet,
} from './intrinsic-async-collection.js';

// Fixed producer adapter. A Native observation is never an execution/exit grant.
const requireAddon = createRequire(import.meta.url);
const addonPath = fileURLToPath(
  new NativeURL(
    '../../../native/original-process-domain/build/Release/original_process_domain.node',
    import.meta.url,
  ),
);
const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor;
const own = Object.hasOwn,
  freeze = Object.freeze,
  create = Object.create;
const get = WeakMap.prototype.get,
  set = WeakMap.prototype.set;
const NativePromise = Promise,
  nativeThen = Promise.prototype.then;
const isProxy = types.isProxy,
  isPromise = types.isPromise;
const consume = () => {};
interface Api {
  openOriginal(): object;
  readSelf(domain: object): Readonly<Record<string, unknown>>;
  observePid(domain: object, pid: number): object;
  readObservation(
    domain: object,
    observed: object,
  ): Readonly<Record<string, unknown>>;
  assertObservationCurrent(domain: object, observed: object): void;
  readFence(domain: object): Readonly<Record<string, unknown>>;
  fence(domain: object): void;
  close(domain: object): void;
}
interface KernelAssociation {
  readonly context: object | null;
  readonly invocationId: string;
  readonly specHash: string;
  readonly pid: number;
  readonly nativeMetered: boolean;
  assertLocal(): void;
}
interface Row {
  readonly stock: RoomTurnCustody;
  readonly operations: RoomTurnCustody[];
  api?: Api;
  native?: object;
  self?: Readonly<Record<string, unknown>>;
  stopped: boolean;
  unknown: boolean;
}
interface Observed {
  readonly row: Row;
  readonly native: object;
  readonly association: KernelAssociation;
  readonly data: Readonly<Record<string, unknown>>;
  readonly stock: RoomTurnCustody;
}
const domains = new WeakMap<object, Row>();
const observations = new WeakMap<object, Observed>();
// A failed birth has no returned token. Its original unknown/raw inventory
// must remain strongly owned even after the rejected caller Promise settles.
const retainedRows = createIntrinsicSet<Row>();
let birth: Promise<object> | undefined;
function member(domain: unknown): Row {
  const row = apply(get, domains, [domain]) as Row | undefined;
  if (!row) throw Error('OS_DOMAIN_ORIGINAL_MEMBER_REQUIRED');
  return row;
}
function active(row: Row): void {
  if (row.stopped || row.unknown) throw Error('OS_DOMAIN_UNCONFIRMED');
  row.stock.current();
}
async function resource<T extends object>(
  stock: RoomTurnCustody,
  fn: Function,
): Promise<T> {
  let actual: unknown;
  const value = await stock.sdk<T>(
    () => {
      actual = apply(fn, undefined, []);
      // Synchronous Native functions must not smuggle a Promise as a resource.
      if (isPromise(actual)) {
        stock.inventory(actual);
        throw Error('OS_DOMAIN_SYNC_REQUIRED');
      }
      return actual;
    },
    undefined,
    [],
    {
      accept: (raw) =>
        raw === actual &&
        raw !== null &&
        typeof raw === 'object' &&
        !isProxy(raw),
      consumer: consume,
    },
  );
  await stock.consumeResource(consume, value, []);
  return value;
}
/** One fixed artifact and one birth slot. Failure/fence never reopens a realm. */
export function openOriginalLocalProcessDomain(): Promise<object> {
  if (birth) return birth;
  let yes!: (value: object) => void, no!: (raw: unknown) => void;
  birth = new NativePromise<object>((resolve, reject) => {
    yes = resolve;
    no = reject;
  });
  const row: Row = {
    stock: createRoomTurnCustody(),
    operations: [],
    api: undefined,
    native: undefined,
    self: undefined,
    stopped: false,
    unknown: false,
  };
  retainedRows.add(row);
  const token = freeze(create(null));
  apply(set, domains, [token, row]);
  // Slot and strong row precede require/init/kernel SDK, including synchronous reentry.
  const running = row.stock.root(async () => {
    const raw = await resource<Record<string, unknown>>(row.stock, () =>
      requireAddon(addonPath),
    );
    const api = create(null) as Record<string, Function>;
    const names = [
      'openOriginal',
      'readSelf',
      'observePid',
      'readObservation',
      'assertObservationCurrent',
      'readFence',
      'fence',
      'close',
    ];
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!,
        field = descriptor(raw, name);
      if (
        !field ||
        !own(field, 'value') ||
        typeof field.value !== 'function' ||
        isProxy(field.value)
      )
        throw Error('OS_DOMAIN_ORIGINAL_ABI_REQUIRED');
      api[name] = field.value;
    }
    row.api = freeze(api) as unknown as Api;
    row.native = await resource<object>(row.stock, () =>
      apply(row.api!.openOriginal, raw, []),
    );
    row.self = await row.stock.sdk<Readonly<Record<string, unknown>>>(
      row.api.readSelf,
      raw,
      [row.native],
    );
    if (row.self.kind !== 'original_local_os_self_observation_v1')
      throw Error('OS_DOMAIN_UNCONFIRMED');
    return token;
  });
  apply(nativeThen, running, [
    async () => {
      try {
        await row.stock.waitPhysicalKnown();
        yes(token);
      } catch (raw) {
        row.unknown = true;
        no(raw);
      }
    },
    async (raw: unknown) => {
      row.unknown = true;
      try {
        await row.stock.waitPhysicalKnown();
      } catch {}
      no(raw);
    },
  ]);
  return birth;
}
/** Historic metadata only. It does not assert current PID or domain completion. */
export function readOriginalLocalProcessDomain(
  domain: unknown,
): Readonly<Record<string, unknown>> {
  const row = member(domain);
  if (!row.self) throw Error('OS_DOMAIN_UNCONFIRMED');
  return row.self;
}
/** The only public observation input is an original private SDK attempt. */
export async function observeOriginalLocalProcessAttempt(
  domain: unknown,
  attempt: unknown,
): Promise<object> {
  const row = member(domain);
  active(row);
  const stock = createRoomTurnCustody();
  appendIntrinsic(row.operations, stock);
  let association!: KernelAssociation,
    native!: object,
    data!: Readonly<Record<string, unknown>>;
  const running = stock.root(async () => {
    const sdk = await stock.sdk<
      Awaited<ReturnType<typeof loadOriginalProcessSdk>>
    >(loadOriginalProcessSdk, undefined, [], {
      accept: (value) =>
        value !== null && typeof value === 'object' && !isProxy(value),
      consumer: consume,
    });
    let rejected: { raw: unknown } | undefined;
    try {
      association = await resource<KernelAssociation>(stock, () =>
        sdk.readOriginalToolProcessKernelObservation(attempt),
      );
    } catch (raw) {
      rejected = { raw };
    }
    // This is a fixed module resource. Release its owned metadata after a
    // known membership refusal too; cleanup cannot replace the original cause.
    try {
      await stock.consumeResource(consume, sdk, []);
    } catch (raw) {
      rejected ??= { raw };
    }
    if (rejected) throw rejected.raw;
    if (!association.nativeMetered)
      throw Error('OS_DOMAIN_METERED_SOURCE_REQUIRED');
    stock.syncVoid(association.assertLocal, association, []);
    active(row);
    native = await resource<object>(stock, () =>
      row.api!.observePid(row.native!, association.pid),
    );
    data = await stock.sdk<Readonly<Record<string, unknown>>>(
      row.api!.readObservation,
      row.api,
      [row.native, native],
    );
    if (
      data.domainId !== row.self!.domainId ||
      data.observedPid !== association.pid ||
      data.hostBootIdentity !== row.self!.hostBootIdentity
    )
      throw Error('OS_DOMAIN_ASSOCIATION_UNCONFIRMED');
    stock.syncVoid(association.assertLocal, association, []);
    active(row);
  });
  let failure: { raw: unknown } | undefined;
  try {
    await running;
  } catch (raw) {
    failure = { raw };
  }
  try {
    await stock.waitPhysicalKnown();
  } catch (raw) {
    row.unknown = true;
    failure ??= { raw };
  }
  if (failure) throw failure.raw;
  const token = freeze(create(null));
  apply(set, observations, [token, { row, native, association, data, stock }]);
  return token;
}
export function readOriginalLocalProcessObservation(
  domain: unknown,
  token: unknown,
): Readonly<{
  os: Readonly<Record<string, unknown>>;
  associationKind: 'original_sdk_pid_lookup_v1';
  invocationId: string;
  specHash: string;
}> {
  const row = member(domain),
    value = apply(get, observations, [token]) as Observed | undefined;
  if (!value || value.row !== row)
    throw Error('OS_DOMAIN_ORIGINAL_OBSERVATION_REQUIRED');
  return freeze({
    os: value.data,
    associationKind: 'original_sdk_pid_lookup_v1',
    invocationId: value.association.invocationId,
    specHash: value.association.specHash,
  });
}
export function assertOriginalLocalProcessObservationCurrent(
  domain: unknown,
  token: unknown,
): void {
  const row = member(domain),
    value = apply(get, observations, [token]) as Observed | undefined;
  if (!value || value.row !== row)
    throw Error('OS_DOMAIN_ORIGINAL_OBSERVATION_REQUIRED');
  active(row);
  value.stock.syncVoid(value.association.assertLocal, value.association, []);
  value.stock.syncVoid(row.api!.assertObservationCurrent, row.api, [
    row.native,
    value.native,
  ]);
}
export function fenceOriginalLocalProcessDomain(domain: unknown): void {
  const row = member(domain);
  row.stopped = true;
  row.stock.syncVoid(row.api!.fence, row.api, [row.native]);
}
/** Stops observations and joins already-known SDK tails; never settles a P. */
export async function closeOriginalLocalProcessDomain(
  domain: unknown,
): Promise<void> {
  const row = member(domain);
  row.stopped = true;
  row.stock.syncVoid(row.api!.close, row.api, [row.native]);
  let first: { raw: unknown } | undefined;
  for (let i = 0; i < row.operations.length; i++) {
    try {
      await row.operations[i]!.waitPhysicalKnown();
    } catch (raw) {
      first ??= { raw };
    }
  }
  try {
    await row.stock.waitPhysicalKnown();
  } catch (raw) {
    first ??= { raw };
  }
  if (first) throw first.raw;
}
