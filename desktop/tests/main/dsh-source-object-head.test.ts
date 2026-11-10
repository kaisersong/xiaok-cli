// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  reduceDshSourceObjectHead,
  dshSourceObjectIdentity,
  type DshSourceObservation,
  type DshSourceObjectState,
} from "../../electron/dsh-source-object-head.js";
const hash = (character: string) => character.repeat(64);
function input(
  overrides: Partial<DshSourceObservation> = {},
): DshSourceObservation {
  return {
    thread: {
      sourceBindingId: "binding",
      tenantId: "tenant",
      workspaceId: "workspace",
      provider: "github",
      repositoryId: "repo",
      kind: "issue",
      threadId: "42",
    },
    objectKind: "issue",
    objectId: "42",
    providerRevision: "v1",
    contentHash: hash("a"),
    kind: "created",
    completeness: "complete",
    paginationComplete: true,
    sourceEvidenceHash: hash("b"),
    ...overrides,
  };
}
const empty: DshSourceObjectState = { current: null, freeze: null };
function start(value = input()) {
  return reduceDshSourceObjectHead(empty, value, null).state;
}
function compare(
  state: DshSourceObjectState,
  candidate: DshSourceObservation,
  relation: "same" | "newer" | "older" | "incomparable",
) {
  return {
    objectIdentity: dshSourceObjectIdentity(candidate),
    previousRevision: state.current!.providerRevision,
    candidateRevision: candidate.providerRevision,
    relation,
    evidenceHash: hash("c"),
  };
}
describe("DSH SourceObjectHead pure safety reduction (not an authority or provider comparator)", () => {
  it("creates a complete first observation and freezes all returned data", () => {
    const candidate = input(),
      result = reduceDshSourceObjectHead(empty, candidate, null);
    expect(result.disposition).toBe("accepted");
    expect(result.state.current).toEqual(candidate);
    expect(result.invalidatedRevision).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state.current!.thread)).toBe(true);
    candidate.thread.threadId = "mutated";
    expect(result.state.current!.thread.threadId).toBe("42");
  });
  it.each(["partial", "unknown"] as const)(
    "does not establish a %s head",
    (completeness) => {
      const result = reduceDshSourceObjectHead(
        empty,
        input({ completeness }),
        null,
      );
      expect(result.disposition).toBe("needs_review");
      expect(result.state).toEqual(empty);
    },
  );
  it("does not infer deletion from an incomplete page", () => {
    const state = start(),
      candidate = input({
        providerRevision: "v2",
        kind: "deleted",
        paginationComplete: false,
      });
    const result = reduceDshSourceObjectHead(
      state,
      candidate,
      compare(state, candidate, "newer"),
    );
    expect(result.state).toEqual(state);
    expect(result.invalidatedRevision).toBeNull();
    expect(result.disposition).toBe("needs_review");
  });
  it("does not freeze complete content from a partial same-revision hash", () => {
    const state = start(),
      candidate = input({ contentHash: hash("d"), completeness: "partial" });
    const result = reduceDshSourceObjectHead(state, candidate, null);
    expect(result.state).toEqual(state);
    expect(result.disposition).toBe("needs_review");
  });
  it("deduplicates same revision/content without requiring an ordering oracle", () => {
    const state = start(),
      result = reduceDshSourceObjectHead(state, input(), null);
    expect(result.disposition).toBe("duplicate");
    expect(result.state).toEqual(state);
  });
  it.each([{ contentHash: hash("d") }, { kind: "deleted" as const }])(
    "freezes same revision conflicting content or existence",
    (change) => {
      const state = start(),
        result = reduceDshSourceObjectHead(state, input(change), null);
      expect(result.reasonCode).toBe("REVISION_CONTENT_CONFLICT");
      expect(result.state.current).toEqual(state.current);
      expect(result.state.freeze).not.toBeNull();
    },
  );
  it("applies v1→v2 but never lets v2→v1 invalidate newer output", () => {
    const one = start(),
      candidate = input({
        providerRevision: "v2",
        contentHash: hash("d"),
        kind: "edited",
      });
    const two = reduceDshSourceObjectHead(
      one,
      candidate,
      compare(one, candidate, "newer"),
    );
    expect(two.disposition).toBe("accepted");
    expect(two.invalidatedRevision).toBe("v1");
    const back = reduceDshSourceObjectHead(
      two.state,
      input(),
      compare(two.state, input(), "older"),
    );
    expect(back.disposition).toBe("ignored_stale_revision");
    expect(back.invalidatedRevision).toBeNull();
    expect(back.state).toEqual(two.state);
  });
  it("does not lexically order opaque revisions or use arrival order", () => {
    const state = start(input({ providerRevision: "z" })),
      candidate = input({ providerRevision: "a", contentHash: hash("d") });
    expect(reduceDshSourceObjectHead(state, candidate, null).reasonCode).toBe(
      "REVISION_ORDER_UNPROVEN",
    );
    expect(
      reduceDshSourceObjectHead(
        state,
        candidate,
        compare(state, candidate, "newer"),
      ).state.current!.providerRevision,
    ).toBe("a");
  });
  it("freezes incomparable different content, and retains old equal content pending proof", () => {
    const state = start(),
      candidate = input({ providerRevision: "v2", contentHash: hash("d") });
    const conflict = reduceDshSourceObjectHead(
      state,
      candidate,
      compare(state, candidate, "incomparable"),
    );
    expect(conflict.state.freeze).not.toBeNull();
    expect(conflict.reasonCode).toBe("REVISION_ORDER_UNPROVEN");
    const equal = input({ providerRevision: "v2" }),
      pending = reduceDshSourceObjectHead(
        state,
        equal,
        compare(state, equal, "incomparable"),
      );
    expect(pending.state.current).toEqual(state.current);
    expect(pending.disposition).toBe("needs_review");
    expect(pending.state.freeze).toBeNull();
  });
  it("does not clear sticky freeze when a later observation claims newer", () => {
    const one = start(),
      conflict = reduceDshSourceObjectHead(
        one,
        input({ contentHash: hash("d") }),
        null,
      ).state;
    const newer = input({ providerRevision: "v3", contentHash: hash("e") });
    const result = reduceDshSourceObjectHead(
      conflict,
      newer,
      compare(conflict, newer, "newer"),
    );
    expect(result.state).toEqual(conflict);
    expect(result.reasonCode).toBe("SOURCE_OBJECT_FROZEN");
    expect(result.invalidatedRevision).toBeNull();
  });
  it("requires evidence bound to this exact domain and revision pair", () => {
    const state = start(),
      candidate = input({ providerRevision: "v2" }),
      proof = compare(state, candidate, "newer");
    for (const change of [
      { previousRevision: "old" },
      { candidateRevision: "v3" },
      { objectIdentity: "other" },
      { relation: "same" },
      { evidenceHash: "bad" },
    ]) {
      expect(() =>
        reduceDshSourceObjectHead(state, candidate, { ...proof, ...change }),
      ).toThrow("dsh_source_object_contract");
    }
    expect(() =>
      reduceDshSourceObjectHead(
        state,
        { ...candidate, objectKind: "comment" },
        proof,
      ),
    ).toThrow("dsh_source_object_domain");
  });
  it("handles genuine deletion then provably newer reappearance without treating arrival as truth", () => {
    const state = start(),
      deleted = input({
        providerRevision: "d",
        kind: "deleted",
        contentHash: hash("d"),
      });
    const gone = reduceDshSourceObjectHead(
      state,
      deleted,
      compare(state, deleted, "newer"),
    );
    const reappeared = input({ providerRevision: "r", kind: "created" }),
      back = reduceDshSourceObjectHead(
        gone.state,
        reappeared,
        compare(gone.state, reappeared, "newer"),
      );
    expect(back.state.current!.kind).toBe("created");
    expect(back.invalidatedRevision).toBe("d");
  });
  it("rejects Proxy/accessor/non-data fields without calling getters or traps", () => {
    let reads = 0;
    const value = input();
    Object.defineProperty(value, "contentHash", {
      enumerable: true,
      get() {
        reads++;
        return hash("a");
      },
    });
    expect(() => reduceDshSourceObjectHead(empty, value, null)).toThrow();
    const proxy = new Proxy(input(), {
      ownKeys() {
        reads++;
        return [];
      },
      get() {
        reads++;
        return undefined;
      },
    });
    expect(() => reduceDshSourceObjectHead(empty, proxy, null)).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      reduceDshSourceObjectHead(empty, { ...input(), extra: true }, null),
    ).toThrow();
  });
  it("keeps legal Unicode identity distinct and rejects replacement-colliding surrogates/NUL", () => {
    const a = input({ objectKind: "comment", objectId: "\u00e9" }),
      b = input({ objectKind: "comment", objectId: "e\u0301" });
    expect(dshSourceObjectIdentity(a)).not.toBe(dshSourceObjectIdentity(b));
    expect(() =>
      start(input({ objectKind: "comment", objectId: "\ufffd😀" })),
    ).not.toThrow();
    for (const objectId of ["\ud800", "\udc00", "x\u0000y"])
      expect(() => start(input({ objectKind: "comment", objectId }))).toThrow();
  });
});
it("actual Head capture cannot borrow a late WeakMap.get to return unvalidated getter input", () => {
  const raw = input();
  let reads = 0;
  Object.defineProperty(raw, "contentHash", {
    enumerable: true,
    get() {
      reads++;
      return hash("a");
    },
  });
  const get = WeakMap.prototype.get;
  let rejected = false;
  try {
    WeakMap.prototype.get = function (key: object) {
      return key;
    };
    try {
      reduceDshSourceObjectHead(empty, raw, null);
    } catch {
      rejected = true;
    }
  } finally {
    WeakMap.prototype.get = get;
  }
  expect(rejected).toBe(true);
  expect(reads).toBe(0);
});
it("actual Head positive does not call late WeakSet prototype slots", () => {
  const has = WeakSet.prototype.has;
  let hooks = 0,
    result: ReturnType<typeof reduceDshSourceObjectHead> | undefined;
  try {
    WeakSet.prototype.has = function () {
      hooks++;
      return true;
    };
    try {
      result = reduceDshSourceObjectHead(empty, input(), null);
    } catch {}
  } finally {
    WeakSet.prototype.has = has;
  }
  expect(hooks).toBe(0);
  expect(result?.disposition).toBe("accepted");
});
it("actual Head identities and transitions ignore late JSON and array methods", () => {
  const stringify = JSON.stringify,
    includes = Array.prototype.includes,
    some = Array.prototype.some;
  const original = input(),
    before = dshSourceObjectIdentity(original);
  let hooks = 0,
    after: string | undefined;
  try {
    JSON.stringify = () => {
      hooks++;
      return "forged";
    };
    Array.prototype.includes = function () {
      hooks++;
      return true;
    };
    Array.prototype.some = function () {
      hooks++;
      return false;
    };
    after = dshSourceObjectIdentity(original);
  } finally {
    JSON.stringify = stringify;
    Array.prototype.includes = includes;
    Array.prototype.some = some;
  }
  expect(hooks).toBe(0);
  expect(after).toBe(before);
});
it("actual Head does not skip Thread identity validation through a late array iterator", () => {
  const raw = input();
  (raw.thread as unknown as Record<string, unknown>).tenantId = 123;
  const iterate = Array.prototype[Symbol.iterator];
  let hooks = 0,
    rejected = false;
  try {
    Array.prototype[Symbol.iterator] = function* () {
      if (this.length === 5 && this[0] === "sourceBindingId") {
        hooks++;
        return;
      }
      yield* Reflect.apply(iterate, this, []);
    };
    try {
      reduceDshSourceObjectHead(empty, raw, null);
    } catch {
      rejected = true;
    }
  } finally {
    Array.prototype[Symbol.iterator] = iterate;
  }
  console.log(JSON.stringify({ headLateIteratorHooks: hooks, rejected }));
  expect(rejected).toBe(true);
  expect(hooks).toBe(0);
});
