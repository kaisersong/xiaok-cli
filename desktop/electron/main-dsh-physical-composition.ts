import { types } from "node:util";
import { readOriginalMainDshBootstrapAuthority } from "./main-dsh-bootstrap-authority.js";
import { readOriginalDshBudgetRuntimeBinding } from "./harness-optimization-service.js";
import { captureDispatchBusinessData } from "../../src/runtime/conversation-activity/dispatch-business-data.js";
import { assertStandardIpcPromise } from "../../src/runtime/verification/native-ipc-promise.js";
import { retainSourceErrorTails } from "../../src/runtime/verification/source-error-tails.js";
import { createIntrinsicSet } from "../../src/runtime/verification/intrinsic-async-collection.js";
import type { OriginalMainPhysicalCompositionView } from "./main-room-root-admission.js";

const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor,
  own = Object.hasOwn,
  define = Object.defineProperty;
const freeze = Object.freeze,
  NativePromise = Promise,
  then = Promise.prototype.then;
const isProxy = types.isProxy,
  isPromise = types.isPromise;
interface Row {
  realm: object;
  store: object;
  runtime: object;
  source: object;
  native: ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
  budget: ReturnType<typeof readOriginalDshBudgetRuntimeBinding>;
  assert: Function;
  draft: Function;
  calls: ReturnType<typeof createIntrinsicSet<object>>;
  tails: ReturnType<typeof createIntrinsicSet<object>>;
  unknown: ReturnType<typeof createIntrinsicSet<unknown>>;
}
const rows = createIntrinsicSet<Row>(),
  unfinished = createIntrinsicSet<object>();
const denied = () => Error("DSH_ORIGINAL_PHYSICAL_COMPOSITION_REQUIRED");
function find(
  realm: unknown,
  store: unknown,
  runtime: unknown,
  source: unknown,
): Row | undefined {
  const all = rows.snapshot();
  for (let i = 0; i < all.length; i++) {
    const row = all[i]!;
    if (
      row.realm === realm &&
      row.store === store &&
      row.runtime === runtime &&
      row.source === source
    )
      return row;
  }
}
function inventory(row: Row, value: unknown): void {
  retainSourceErrorTails(value, (raw, kind) => {
    if (kind === "unknown") {
      row.unknown.add(raw);
      return;
    }
    if (!isPromise(raw) || isProxy(raw) || row.calls.has(raw as object)) return;
    row.calls.add(raw as object);
    const tail = { raw };
    row.tails.add(tail);
    try {
      assertStandardIpcPromise(raw, "DSH_COMPOSITION_SDK_UNCONFIRMED");
      apply(then, raw, [
        (value: unknown) => finish(value),
        (error: unknown) => finish(error),
      ]);
    } catch (error) {
      row.unknown.add(raw);
      inventory(row, error);
      row.tails.delete(tail);
    }
    function finish(value: unknown) {
      try {
        inventory(row, value);
      } finally {
        row.tails.delete(tail);
      }
    }
  });
}
function invoke<T>(
  row: Row,
  fn: Function,
  args: unknown[],
  voidResult = false,
): T {
  const call = {};
  row.calls.add(call);
  try {
    const raw = apply(fn, undefined, args);
    define(call, "raw", { value: raw });
    if (voidResult && raw !== undefined) {
      inventory(row, raw);
      row.unknown.add(raw);
      throw denied();
    }
    return raw as T;
  } catch (error) {
    define(call, "error", { value: error });
    inventory(row, error);
    throw error;
  } finally {
    // The caller still owns the returned stack value while it validates it;
    // unknowns and discovered SDK tails have their own strong inventories.
    row.calls.delete(call);
  }
}
function current(row: Row): OriginalMainPhysicalCompositionView {
  if (row.tails.size || row.unknown.size) throw denied();
  invoke(row, row.native.assertCurrent, [], true);
  invoke(row, row.budget.assertCurrent, [], true);
  const raw = invoke<unknown>(row, row.assert, [
    row.realm,
    row.store,
    row.runtime,
    row.source,
  ]);
  let view: OriginalMainPhysicalCompositionView;
  try {
    view = captureDispatchBusinessData(raw, (value) =>
      inventory(row, value),
    ) as unknown as OriginalMainPhysicalCompositionView;
  } catch (error) {
    inventory(row, raw);
    inventory(row, error);
    throw error;
  }
  if (
    view.kind !== "original_main_physical_composition_v1" ||
    (view.profile !== "isolated_native_fixture" &&
      view.profile !== "installed_production") ||
    typeof view.productionQualified !== "boolean"
  )
    throw denied();
  invoke(row, row.native.assertLocal, [], true);
  invoke(row, row.budget.assertLocal, [], true);
  if (row.tails.size || row.unknown.size) throw denied();
  return freeze(view);
}
/** Only this fixed import can supply the reader. There is no register, verifier,
 * callback or caller profile input; the original Native owner remains issuer. */
export async function cacheOriginalMainDshPhysicalComposition(
  realm: object,
  store: object,
  runtime: object,
  budgetSource: object,
): Promise<void> {
  const operation = {};
  unfinished.add(operation);
  try {
    const native = readOriginalMainDshBootstrapAuthority(realm, store, realm);
    const budget = readOriginalDshBudgetRuntimeBinding(runtime, budgetSource);
    const existing = find(realm, store, runtime, budgetSource);
    if (existing) {
      current(existing);
      return;
    }
    const row: Row = {
      realm,
      store,
      runtime,
      source: budgetSource,
      native,
      budget,
      assert: () => {
        throw denied();
      },
      draft: () => {
        throw denied();
      },
      calls: createIntrinsicSet<object>(),
      tails: createIntrinsicSet<object>(),
      unknown: createIntrinsicSet<unknown>(),
    };
    // The raw import is retained before classification. Its successful namespace
    // is a fixed package module, not a Source DTO or caller-supplied resource.
    const raw = import("./main-room-root-admission.js");
    row.calls.add(raw);
    inventory(row, raw);
    let loaded: typeof import("./main-room-root-admission.js");
    try {
      assertStandardIpcPromise(raw, "DSH_COMPOSITION_IMPORT_UNCONFIRMED");
      loaded = await new NativePromise((yes, no) => {
        apply(then, raw, [
          yes,
          (error: unknown) => {
            inventory(row, error);
            no(error);
          },
        ]);
      });
    } catch (error) {
      inventory(row, error);
      row.unknown.add(raw);
      rows.add(row);
      throw error;
    }
    const method = descriptor(
      loaded,
      "assertOriginalMainDshPhysicalComposition",
    );
    if (
      !method ||
      !own(method, "value") ||
      typeof method.value !== "function" ||
      isProxy(method.value)
    )
      throw denied();
    const draft = descriptor(loaded, "readOriginalMainDshDraftAdmission");
    if (
      !draft ||
      !own(draft, "value") ||
      typeof draft.value !== "function" ||
      isProxy(draft.value)
    )
      throw denied();
    row.assert = method.value;
    row.draft = draft.value;
    current(row);
    rows.add(row);
  } finally {
    unfinished.delete(operation);
  }
}
/** Synchronous passive lookup followed by the captured original live reader.
 * A previous successful cache never replaces the current Native/owner checks. */
export function assertOriginalMainDshPhysicalCompositionCached(
  realm: unknown,
  store: unknown,
  runtime: unknown,
  budgetSource: unknown,
): OriginalMainPhysicalCompositionView {
  const row = find(realm, store, runtime, budgetSource);
  if (!row) throw denied();
  return current(row);
}

/** The already-pinned original Owner supplies a semantic draft facet. This
 * takes no port/callback and never imports the heavy Owner at module load. */
export function readOriginalMainDshDraftAdmissionCached(
  realm: object,
  store: object,
  runtime: object,
  budgetSource: object,
  businessSource: object,
): import("./main-room-root-admission.js").OriginalMainDshDraftAdmissionPort {
  const row = find(realm, store, runtime, budgetSource);
  if (!row) throw denied();
  current(row);
  return invoke(row, row.draft, [
    realm,
    store,
    runtime,
    budgetSource,
    businessSource,
  ]);
}
