// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Hash } from "node:crypto";
import { readCapturedGroupsSchema } from "../../../src/runtime/verification/groups-source-schema.js";
import * as original from "../../electron/desktop-multi-agent-store.js";
import { dshAObservation } from "../../../src/runtime/multi-agent/dsh-admission-data.js";
import { ActivityNativeIdentityRepository } from "../../../src/runtime/conversation-activity/native-identity.js";
import { dshSourceObjectIdentity } from "../../electron/dsh-source-object-head.js";
const capabilityDb = new DatabaseSync(":memory:");
const nativeTransactionAvailable =
  typeof Object.getOwnPropertyDescriptor(capabilityDb, "isTransaction")?.get ===
  "function";
capabilityDb.close();
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
const thread = {
  sourceBindingId: "source-binding",
  tenantId: "tenant",
  workspaceId: "workspace",
  provider: "github",
  repositoryId: "repo",
  kind: "issue",
  threadId: "42",
};
const authScope = {
  tenantId: "tenant",
  workspaceId: "workspace",
  connectionId: "connection",
  providerAccountId: "account",
  repositoryId: "repo",
  credentialEpoch: 1,
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-a-store-")),
    file = join(root, "groups.sqlite"),
    frames = new WeakMap<
      object,
      {
        purpose: string;
        data: unknown;
      }
    >();
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let current = true,
    resolveHook: ((purpose: string, data: unknown) => unknown) | undefined;
  const source = {
    resolve(frame: object, purpose: string) {
      const row = frames.get(frame);
      if (!row || row.purpose !== purpose)
        throw Error("FIXTURE_PRIVATE_SOURCE_REQUIRED");
      if (resolveHook) return resolveHook(purpose, row.data);
      return {
        data: row.data,
        assertCurrent() {
          if (!current && purpose !== "read" && purpose !== "narrow_source")
            throw Error("FIXTURE_REVOKED");
        },
      };
    },
  };
  const store = new original.DesktopMultiAgentStore(file, {
    dshAdmissionSource: source,
  } as ConstructorParameters<typeof original.DesktopMultiAgentStore>[1]);
  cleanup.push(() => {
    try {
      store.close();
    } catch (error) {
      (
        store as unknown as {
          db: DatabaseSync;
        }
      ).db.close();
      console.log(
        JSON.stringify({
          fixtureOnlyForceNativeClose: true,
          notProductionClose: true,
          error: String(error),
        }),
      );
    }
  });
  store.claimBootOwnership();
  const read = (
    original as unknown as {
      readOriginalDshAdmissionPort?: (store: unknown, source: unknown) => any;
    }
  ).readOriginalDshAdmissionPort;
  expect(typeof read).toBe("function");
  const port = read!(store, source),
    issue = (purpose: string, data: unknown) => {
      const frame = Object.freeze(Object.create(null));
      frames.set(frame, { purpose, data });
      return frame;
    };
  const snapshot = () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return {
        version: db.prepare("PRAGMA user_version").get()?.user_version,
        rows: db
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      };
    } finally {
      db.close();
    }
  };
  const initialize = () =>
    port.initialize(issue("initialize", { schemaVersion: 1 }), {
      requestSource: "user",
    });
  const bind = () =>
    port.establishSourceBinding(
      issue("bind_source", {
        bindingId: thread.sourceBindingId,
        provider: "github",
        authScope,
        sourceBindingVersion: 1,
        roleMappingVersion: 1,
        provenanceVersion: 1,
      }),
      { requestSource: "user" },
    );
  const input = (kind = "created", proofVersion = 1) => ({
    thread,
    authScope,
    providerEventId: null,
    objectKind: "issue",
    objectId: "42",
    providerRevision: "rev1",
    contentHash: "a".repeat(64),
    receivedAt: "2026-11-06T00:00:00.000Z",
    objectAuthorId: "author",
    actorEvidence: {
      kind: "verified_event",
      eventRef: "event",
      triggerActorId: "actor",
    },
    actorMappingVersion: 1,
    provenanceVersion: proofVersion,
    actorEvidenceHash: "b".repeat(64),
    kind,
    trust: "external_untrusted",
    snapshotRef: "owned-safe-snapshot",
    completeness: "complete",
    paginationComplete: true,
    authorizationCheckedAt: "2026-11-06T00:00:00.000Z",
  });
  const importInput = (value = input(), comparison: unknown = null) =>
    port.importVerifiedInput(
      issue("import_input", {
        bindingId: thread.sourceBindingId,
        expectedBindingRevision: 1,
        envelope: value,
        comparison,
      }),
      { requestSource: "scheduler" },
    );
  return {
    root,
    file,
    store,
    port,
    source,
    issue,
    initialize,
    bind,
    input,
    importInput,
    snapshot,
    hookResolve(hook?: (purpose: string, data: unknown) => unknown) {
      resolveHook = hook;
    },
    revoke() {
      current = false;
    },
  };
}
describe.skipIf(!nativeTransactionAvailable)(
  "A1 original Store admission child; controlled Source is not Native/provider authority",
  () => {
    it("explicitly installs5 only on the original claimed connection, then ordinary groups remain usable", () => {
      const f = fixture();
      expect(f.snapshot().version).toBe(4);
      const result = f.initialize();
      expect(result.ok).toBe(true);
      expect(f.snapshot().version).toBe(5);
      f.store.registerThread({
        threadId: "old-thread",
        profileId: "profile",
        workspaceId: "workspace",
        cwd: f.root,
      });
      expect(f.store.createGroup("old-thread").threadId).toBe("old-thread");
    });
    it("atomically imports canonical input/head and keeps kind and proof revisions separate", () => {
      const f = fixture();
      f.initialize();
      expect(f.bind().ok).toBe(true);
      const first = f.importInput(),
        duplicate = f.importInput(),
        edited = f.importInput(f.input("edited")),
        proof = f.importInput(f.input("created", 2));
      expect(first.ok).toBe(true);
      expect(duplicate.input.inputId).toBe(first.input.inputId);
      expect(edited.input.inputId).not.toBe(first.input.inputId);
      expect(proof.input.inputId).toBe(first.input.inputId);
      expect(proof.proof.provenanceVersion).toBe(2);
      expect(first.objectHead.current.providerRevision).toBe("rev1");
      expect(first.objectId).toBe(
        dshSourceObjectIdentity(dshAObservation(f.input())),
      );
    });
    it("requires private frame/source and independent metadata authority after local revocation", () => {
      const f = fixture(),
        before = f.snapshot();
      expect(() => f.port.initialize({}, { requestSource: "user" })).toThrow();
      expect(f.snapshot()).toEqual(before);
      f.initialize();
      f.bind();
      const first = f.importInput();
      expect(() =>
        f.port.importVerifiedInput(
          f.issue("import_input", {
            bindingId: "source-binding",
            expectedBindingRevision: 1,
            envelope: f.input(),
            comparison: null,
          }),
          { requestSource: "agent" },
        ),
      ).toThrow();
      f.revoke();
      const result = f.port.readSourceInput(
        f.issue("read", {
          bindingId: "source-binding",
          inputId: first.input.inputId,
        }),
        { requestSource: "user" },
      );
      expect(result.input.inputId).toBe(first.input.inputId);
      expect(() =>
        f.port.readSourceInput({}, { requestSource: "user" }),
      ).toThrow();
    });
  },
);
it.skipIf(!nativeTransactionAvailable)(
  "actual schema5 is fully recognized by the original capture schema and preserves old held-writer refusal",
  () => {
    const f = fixture(),
      old = new DatabaseSync(f.file);
    cleanup.push(() => old.close());
    const prepared = old.prepare(
      "INSERT INTO thread_bindings(thread_id,profile_id,workspace_id,cwd) VALUES('old-held','profile','workspace','cwd')",
    );
    f.initialize();
    f.bind();
    f.importInput();
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      const schema = db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
        )
        .all() as unknown as Parameters<typeof readCapturedGroupsSchema>[0];
      expect(readCapturedGroupsSchema(schema, 5).version).toBe(5);
    } finally {
      db.close();
    }
    expect(() => prepared.run()).toThrow(/xiaok_main_dsh|dsh_a_writer/);
  },
);
it.skipIf(!nativeTransactionAvailable)(
  "a Source callback accessor is unknown without invocation and cannot rearm a later request",
  () => {
    const f = fixture();
    let reads = 0;
    f.hookResolve((_purpose, data) =>
      Object.defineProperty({ data }, "assertCurrent", {
        enumerable: true,
        get() {
          reads++;
          return () => {};
        },
      }),
    );
    expect(() => f.initialize()).toThrow();
    f.hookResolve();
    let rejected = false;
    try {
      f.initialize();
    } catch {
      rejected = true;
    }
    console.log(
      JSON.stringify({ sourceAccessorReads: reads, secondRejected: rejected }),
    );
    expect(reads).toBe(0);
    expect(rejected).toBe(true);
    expect(() => f.store.close()).toThrow(/SDK_BUSY/);
  },
);
it.skipIf(!nativeTransactionAvailable)(
  "Source mixed unknown and known held SDK tail waits for the known tail before reporting unconfirmed",
  async () => {
    const f = fixture();
    let release!: () => void,
      reads = 0;
    const held = new Promise<void>((yes) => {
        release = yes;
      }),
      failure = Error("original mixed Source fate", { cause: held });
    Object.defineProperty(failure, "unknownSdk", {
      get() {
        reads++;
        return null;
      },
    });
    f.hookResolve(() => {
      throw failure;
    });
    expect(() => f.initialize()).toThrow(failure);
    let finished = false;
    const known = f.port.waitKnown().then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    await new Promise((yes) => setImmediate(yes));
    const early = finished;
    release();
    await known;
    console.log(
      JSON.stringify({
        mixedEarlyFinished: early,
        reads,
        afterKnown: finished,
      }),
    );
    expect(early).toBe(false);
    expect(reads).toBe(0);
    expect(finished).toBe(true);
    expect(() => f.store.close()).toThrow(/SDK_BUSY/);
  },
);
it.skipIf(nativeTransactionAvailable)(
  "missing actual Native transaction SDK denies A writes while keeping ordinary schema4 usable",
  () => {
    const f = fixture();
    const before = f.snapshot();
    expect(() => f.initialize()).toThrow(
      "DSH_A_NATIVE_TRANSACTION_UNAVAILABLE",
    );
    expect(f.snapshot()).toEqual(before);
    expect(f.snapshot().version).toBe(4);
    f.store.registerThread({
      threadId: "ordinary-no-native-a",
      profileId: "profile",
      workspaceId: "workspace",
      cwd: f.root,
    });
    expect(f.store.createGroup("ordinary-no-native-a").threadId).toBe(
      "ordinary-no-native-a",
    );
  },
);
it.skipIf(!nativeTransactionAvailable)(
  "schema5 original identity stays on ordinary threads and closes a malformed cold connection",
  () => {
    const f = fixture();
    f.initialize();
    f.bind();
    f.importInput();
    f.store.registerThread({
      threadId: "ordinary-identity",
      profileId: "profile",
      workspaceId: "workspace",
      cwd: f.root,
    });
    const identity = new ActivityNativeIdentityRepository({
      kind: "desktop",
      profileId: "profile",
      path: f.file,
    });
    try {
      expect(identity.getThread("ordinary-identity")?.workspaceId).toBe(
        "workspace",
      );
      expect(identity.getThread("42")).toBeNull();
    } finally {
      identity.close();
    }
    const raw = new DatabaseSync(f.file);
    try {
      raw.exec("DROP TABLE dsh_a_input_proofs");
    } finally {
      raw.close();
    }
    const closed = vi.spyOn(DatabaseSync.prototype, "close");
    try {
      expect(
        () =>
          new ActivityNativeIdentityRepository({
            kind: "desktop",
            profileId: "profile",
            path: f.file,
          }),
      ).toThrow("captured_groups_schema");
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      closed.mockRestore();
    }
  },
);

it.skipIf(!nativeTransactionAvailable).each(["digest", "update"] as const)(
  "original A canonical input and object identities resist a late Native Hash %s hook",
  (method) => {
    const f = fixture();
    f.initialize();
    f.bind();
    const originalDigest = Hash.prototype.digest,
      originalUpdate = Hash.prototype.update;
    let hooks = 0;
    if (method === "digest")
      Hash.prototype.digest = function () {
        hooks++;
        return "c".repeat(64);
      } as typeof originalDigest;
    else
      Hash.prototype.update = function () {
        hooks++;
        return this;
      } as typeof originalUpdate;
    try {
      const first = f.importInput(),
        second = f.importInput({ ...f.input(), providerRevision: "rev2" });
      console.log(
        JSON.stringify({
          method,
          lateHashHooks: hooks,
          first: first.input.inputId,
          second: second.input.inputId,
        }),
      );
      expect(second.input.inputId).not.toBe(first.input.inputId);
      expect(hooks).toBe(0);
    } finally {
      Hash.prototype.digest = originalDigest;
      Hash.prototype.update = originalUpdate;
    }
  },
);
