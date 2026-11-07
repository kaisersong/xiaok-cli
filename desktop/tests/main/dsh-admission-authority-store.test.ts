// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  DesktopMultiAgentStore,
  readOriginalDshAdmissionPort,
} from "../../electron/desktop-multi-agent-store.js";
import { DSH_A_DIGEST } from "../../../src/runtime/multi-agent/dsh-admission-data.js";

const capabilityDb = new DatabaseSync(":memory:");
const nativeTransactionAvailable =
  typeof Object.getOwnPropertyDescriptor(capabilityDb, "isTransaction")?.get ===
  "function";
capabilityDb.close();

// This constructor-pinned private fixture Source proves only the Store protocol.
// It is not a Native Main, provider, budget, egress or model authority producer.
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-a-authority-"));
  const file = join(root, "groups.sqlite");
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const frames = new WeakMap<object, { purpose: string; data: unknown }>();
  let resolveCalls = 0;
  const source = Object.freeze({
    resolve(frame: object, purpose: string) {
      resolveCalls++;
      const row = frames.get(frame);
      if (!row || row.purpose !== purpose)
        throw Error("FIXTURE_PRIVATE_SOURCE_REQUIRED");
      return { data: row.data, assertCurrent() {} };
    },
  });
  const store = new DesktopMultiAgentStore(file, {
    dshAdmissionSource: source,
  });
  cleanups.push(() => store.close());
  store.claimBootOwnership();
  const port = readOriginalDshAdmissionPort(store, source) as unknown as Record<
    string,
    (...args: unknown[]) => any
  >;
  const issue = (purpose: string, data: unknown) => {
    const frame = Object.freeze(Object.create(null));
    frames.set(frame, { purpose, data });
    return frame;
  };
  const initialized = port.initialize!(
    issue("initialize", { schemaVersion: 1 }),
    { requestSource: "user" },
  );
  expect(initialized.ok).toBe(true);
  const version = () => {
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
      return reader.prepare("PRAGMA user_version").get()!.user_version;
    } finally {
      reader.close();
    }
  };
  expect(version()).toBe(5);
  return {
    store,
    source,
    port,
    issue,
    version,
    file,
    resolveCalls: () => resolveCalls,
  };
}

describe.skipIf(!nativeTransactionAvailable)(
  "A admission authority: original Store API foundation",
  () => {
    it("explicitly upgrades the claimed original schema5 connection", () => {
      const f = fixture();
      expect(typeof f.port.upgradeAdmission).toBe("function");
      const result = f.port.upgradeAdmission!(
        f.issue("migrate_admission", {
          schemaVersion: 1,
          expectedProfileDigest: DSH_A_DIGEST,
        }),
        { requestSource: "user" },
      );
      expect(result.ok).toBe(true);
      expect(f.version()).toBe(6);
    });

    it("has a fixed current proof and Head basis read on that original child", () => {
      const f = fixture();
      expect(typeof f.port.readEvaluationBasis).toBe("function");
    });

    it("reserves original assessment attempts and imports separate candidates", () => {
      const f = fixture();
      expect(typeof f.port.reserveAssessment).toBe("function");
      expect(typeof f.port.importAssessmentCandidate).toBe("function");
    });

    it("owns the operational window on the original admission child", () => {
      const f = fixture();
      expect(typeof f.port.establishWindow).toBe("function");
    });

    it("owns the decision/outbox commit and authenticated receipt reconciliation", () => {
      const f = fixture();
      expect(typeof f.port.commitAdmission).toBe("function");
      expect(typeof f.port.importOwnerReceipt).toBe("function");
      expect(typeof f.port.readOperation).toBe("function");
    });
  },
);

it.skipIf(!nativeTransactionAvailable)(
  "reads the specified real proof and Head after same-owner migration without granting effects",
  () => {
    const f = fixture();
    f.port.upgradeAdmission!(
      f.issue("migrate_admission", {
        schemaVersion: 1,
        expectedProfileDigest: DSH_A_DIGEST,
      }),
      { requestSource: "user" },
    );
    const thread = {
      sourceBindingId: "source",
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
    f.port.establishSourceBinding!(
      f.issue("bind_source", {
        bindingId: "source",
        provider: "github",
        authScope,
        sourceBindingVersion: 1,
        roleMappingVersion: 1,
        provenanceVersion: 1,
      }),
      { requestSource: "user" },
    );
    const envelope = {
      thread,
      authScope,
      providerEventId: null,
      providerOccurredAt: "2026-11-06T00:00:00.000Z",
      providerTimeEvidenceRef: "original-owned-event-ref",
      objectKind: "issue",
      objectId: "42",
      providerRevision: "revision1",
      contentHash: "a".repeat(64),
      receivedAt: "2026-11-06T00:00:00.000Z",
      objectAuthorId: "author",
      actorEvidence: {
        kind: "verified_event",
        eventRef: "event",
        triggerActorId: "actor",
      },
      actorMappingVersion: 1,
      provenanceVersion: 1,
      actorEvidenceHash: "b".repeat(64),
      kind: "created",
      trust: "external_untrusted",
      snapshotRef: "metadata-only-snapshot-ref",
      completeness: "complete",
      paginationComplete: true,
      authorizationCheckedAt: "2026-11-06T00:00:00.000Z",
    };
    const imported = f.port.importVerifiedInput!(
      f.issue("import_input", {
        bindingId: "source",
        expectedBindingRevision: 1,
        envelope,
        comparison: null,
      }),
      { requestSource: "scheduler" },
    );
    const result = f.port.readEvaluationBasis!(
      f.issue("read_basis", {
        schemaVersion: 1,
        bindingId: "source",
        inputId: imported.input.inputId,
        proofVersion: 1,
        mandateId: "mandate",
      }),
      { requestSource: "scheduler" },
    );
    expect(result.ok).toBe(true);
    expect(result.basis.input.envelope.providerOccurredAt).toBe(envelope.providerOccurredAt);
    expect(result.basis.input.envelope.providerTimeEvidenceRef).toBe(envelope.providerTimeEvidenceRef);
    expect(result.basis.proof.data.provenanceVersion).toBe(1);
    expect(result.basis.head.state.current.providerRevision).toBe("revision1");
    expect(result.externalFacts).toEqual({
      state: "unknown",
      reason: "producer_unavailable",
    });
    expect(() => f.port.importVerifiedInput!(
      f.issue('import_input', {
        bindingId: 'source', expectedBindingRevision: 1,
        envelope: { ...envelope, providerOccurredAt: 'not-an-event-time' }, comparison: null,
      }),
      { requestSource: 'scheduler' },
    )).toThrow();
    f.store.close();
    const reopened = new DesktopMultiAgentStore(f.file, {
      dshAdmissionSource: Object.freeze({
        resolve() {
          throw Error("NO_REOPEN_GRANT");
        },
      }),
    });
    reopened.close();
  },
);

it.skipIf(!nativeTransactionAvailable)(
  "a constructor-only metadata Source cannot self-sign a Main enrollment purpose",
  () => {
    const f = fixture(),
      before = f.resolveCalls();
    expect(() =>
      f.port.enrollAuthority!(
        {},
        { requestSource: "user", bodyHash: "a".repeat(64), bootstrapAuthority:f.source },
      ),
    ).toThrow("MAIN_DSH_USER_AUTHORITY_REQUIRED");
    expect(f.resolveCalls()).toBe(before);
    expect(f.version()).toBe(5);
  },
);

it.runIf(!nativeTransactionAvailable)(
  "denies original A initialization before any schema5 or A6 write without Native autocommit facts",
  () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-a-unqualified-native-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "groups.sqlite");
    const proof = Object.freeze(Object.create(null));
    const source = Object.freeze({
      resolve(frame: object, purpose: string) {
        if (frame !== proof || purpose !== "initialize")
          throw Error("FIXTURE_SOURCE_REQUIRED");
        return { data: { schemaVersion: 1 }, assertCurrent() {} };
      },
    });
    const store = new DesktopMultiAgentStore(file, {
      dshAdmissionSource: source,
    });
    cleanups.push(() => store.close());
    store.claimBootOwnership();
    const port = readOriginalDshAdmissionPort(store, source);
    expect(() => port.initialize(proof, { requestSource: "user" })).toThrow(
      "DSH_A_NATIVE_TRANSACTION_UNAVAILABLE",
    );
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
      expect(reader.prepare("PRAGMA user_version").get()!.user_version).toBe(4);
      expect(
        reader
          .prepare(
            "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'dsh_a_%'",
          )
          .get()!.n,
      ).toBe(0);
    } finally {
      reader.close();
    }
  },
);

it('keeps original constructor authority and user-control ports separate', async () => {
  const api=await import('../../electron/desktop-multi-agent-store.js');
  const reader=(api as unknown as {readOriginalDshUserControlPort:(store:unknown,source:unknown)=>unknown}).readOriginalDshUserControlPort;
  expect(typeof reader).toBe('function');
  const root=mkdtempSync(join(tmpdir(),'dsh-a-dual-source-'));
  cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
  let authorityCalls=0,userCalls=0;
  const authority=Object.freeze({resolve(){authorityCalls++;throw Error('AUTHORITY_PURPOSE_ONLY');}});
  const user=Object.freeze({resolve(){userCalls++;throw Error('USER_PURPOSE_ONLY');}});
  const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:authority,dshUserControlSource:user} as ConstructorParameters<typeof DesktopMultiAgentStore>[1]);
  cleanups.push(()=>store.close());
  expect(readOriginalDshAdmissionPort(store,authority)).toBe(reader(store,user));
  expect(()=>readOriginalDshAdmissionPort(store,user)).toThrow();
  expect(()=>reader(store,authority)).toThrow();
  let traps=0;
  expect(()=>reader(new Proxy({}, {get(){traps++;throw Error('TRAP');}}),user)).toThrow();
  expect(traps).toBe(0);expect(authorityCalls).toBe(0);expect(userCalls).toBe(0);
});

it.skipIf(!nativeTransactionAvailable)('has fixed original B-domain registration and warm command custody APIs',()=>{
  const f=fixture();
  expect(typeof f.port.registerOwnerDomain).toBe('function');
  expect(typeof f.port.claimCommand).toBe('function');
});

it.skipIf(!nativeTransactionAvailable)('has the original explicit user egress policy publishing port',()=>{
  const f=fixture();expect(typeof f.port.publishEgressPolicy).toBe('function');
});

it.skipIf(!nativeTransactionAvailable)('prepares a draft slot through the same original admission writer',()=>{
  const f=fixture();expect(typeof f.port.prepareDraft).toBe('function');
});

it.skipIf(!nativeTransactionAvailable)('rejects copied draft claim before reading a slot or a Source callback', async()=>{
  const api=await import('../../electron/desktop-multi-agent-store.js'),f=fixture();
  let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('NOT_ORIGINAL');}}),before=f.resolveCalls();
  expect(()=>api.readOriginalDshDraftSourceBody(f.source,f.store,f.source,fake,fake)).toThrow('DSH_A_ORIGINAL_DRAFT_CLAIM_REQUIRED');
  expect(getters).toBe(0);expect(f.resolveCalls()).toBe(before);
});

it.skipIf(!nativeTransactionAvailable)('requires original settlement delivery before any accounting audience lookup', async () => {
  const api = await import('../../electron/desktop-multi-agent-store.js');
  const read = (api as unknown as {
    readOriginalDshBudgetSettlementAudience: (...args: unknown[]) => unknown;
  }).readOriginalDshBudgetSettlementAudience;
  expect(typeof read).toBe('function');
  const f = fixture();
  let getters = 0;
  const delivery = new Proxy({}, { get() { getters++; throw Error('NOT_A_DELIVERY'); } });
  const before = f.resolveCalls();
  expect(() => read(f.source, f.store, f.source, delivery, {}, {})).toThrow();
  expect(() => read(f.source, {}, f.source, delivery, {}, {})).toThrow();
  expect(getters).toBe(0);
  expect(f.resolveCalls()).toBe(before);
  expect(f.version()).toBe(5);
});
